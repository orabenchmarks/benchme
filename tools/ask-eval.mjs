#!/usr/bin/env node
/**
 * ask-eval — score every ranker in the grid (lexical/llm/jev) against ONE
 * running deployment's /ask, instead of redeploying per arm. Ground truth is
 * DERIVED from the same generator that seeds the workspace
 * (@benchme/scenarios, acme-v1) — never transcribed by hand — so the relevant
 * ids for a query are computed the same way the items themselves are built
 * (see apps/{warehouse,helpdesk,vaultdocs}/src/nlweb/items.ts: an item's `id`
 * is always its `url`, so a result's `url` field IS the id to match against).
 *
 *   node tools/ask-eval.mjs --base <gateway url> [--scenario acme-v1] [--seed 4242]
 *        [--rankers lexical,llm,jev] [--out ask-eval] [--operator-key <key>]
 *
 * Requires the deployment to be running with ASK_RANKER_OVERRIDE=1 (see
 * README § Rankers) — otherwise every X-Ask-Ranker header below is silently
 * ignored and every arm scores identically (whatever ASK_RANKER the
 * deployment booted with).
 *
 * Writes <out>.json (full per-query detail) and <out>.md (a results table per
 * app, a totals table, and the disclosures a reader needs: jev's
 * `description` is always the item's own boilerplate text — jev emits no
 * text, so it cannot write one — and ranker_degraded queries are counted
 * separately rather than silently folded into the healthy-ranker numbers).
 *
 * Exits non-zero if any (app, ranker) pair answered 422 or 503 — or was
 * simply unreachable — on EVERY query: that is not "this ranker scored
 * lower", it is "this arm produced no data at all" and the run should be
 * treated as failed, not published.
 */
import { writeFileSync } from "node:fs";
import { acmeV1, documentsMatching, lowStock, openTicketsFor } from "../packages/scenarios/dist/index.js";
import { highConfidenceMisses, ndcgAt, percentile, precisionAt } from "../packages/site-kit/dist/index.js";

const HELP = `ask-eval — score lexical/llm/jev rankers over seed-derived relevance labels

Usage:
  node tools/ask-eval.mjs --base <gateway url> [--scenario acme-v1] [--seed 4242]
       [--rankers lexical,llm,jev] [--out ask-eval] [--operator-key <key>]

Options:
  --base <url>          gateway base URL, e.g. http://localhost:8080 (required)
  --scenario <key>      scenario to seed the workspace with (default: acme-v1; the only one this tool's query derivation currently supports)
  --seed <n>             workspace seed (default: 4242)
  --rankers <list>       comma-separated ranker kinds to score, via X-Ask-Ranker (default: lexical,llm,jev)
  --out <path>           output basename; writes <path>.json and <path>.md (default: ask-eval)
  --operator-key <key>   x-benchme-operator-key header, so minting the workspace skips the create rate limit
  --help                 print this message and exit
`;

const RELEVANCE_K = 10; // nDCG@10
const PRECISION_K = 5; // P@5
const HIGH_CONFIDENCE_THRESHOLD = 0.75;

function printHelp() {
  process.stdout.write(HELP);
}

function parseArgs(argv) {
  const args = Object.fromEntries(argv.map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
  return {
    base: args.base,
    scenario: args.scenario ?? "acme-v1",
    seed: Number(args.seed ?? 4242),
    rankers: (args.rankers ?? "lexical,llm,jev")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    out: args.out ?? "ask-eval",
    operatorKey: args["operator-key"],
  };
}

async function mintWorkspace(base, scenario, seed, operatorKey) {
  const headers = { "content-type": "application/json" };
  if (operatorKey) headers["x-benchme-operator-key"] = operatorKey;
  const res = await fetch(`${base}/api/workspaces`, { method: "POST", headers, body: JSON.stringify({ scenario, seed }) });
  if (!res.ok) throw new Error(`POST ${base}/api/workspaces failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

/**
 * ~15 queries per app, each paired with the relevant id set DERIVED from the
 * same generated rows the workspace was seeded with — never hand-picked.
 * A candidate whose derived relevant set is empty is dropped: an empty
 * ground truth can't discriminate a ranker (every ranker "wins" vacuously —
 * see ndcgAt's own empty-relevant convention), so it would only add noise.
 */
function buildWarehouseQueries(rows, wsId) {
  const prefix = `/w/${wsId}/warehouse`;
  const queries = [];

  const byCategory = new Map();
  for (const p of rows.warehouse.products) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  }
  for (const [category, products] of byCategory) {
    queries.push({ query: `products in the ${category} category`, relevant: products.map((p) => `${prefix}/products/${p.sku}`) });
  }

  const low = lowStock(rows, 10);
  queries.push({ query: "which products are low on stock", relevant: low.map((sku) => `${prefix}/products/${sku}`) });

  const byCity = new Map();
  for (const c of rows.warehouse.customers) {
    if (!byCity.has(c.city)) byCity.set(c.city, []);
    byCity.get(c.city).push(c);
  }
  for (const [city, custs] of byCity) {
    queries.push({ query: `customers based in ${city}`, relevant: custs.map((c) => `${prefix}/customers/${c.code}`) });
  }

  return queries.filter((q) => q.relevant.length > 0);
}

function buildHelpdeskQueries(rows, wsId) {
  const prefix = `/w/${wsId}/helpdesk`;
  const queries = [];

  for (const priority of new Set(rows.helpdesk.tickets.map((t) => t.priority))) {
    const relevant = rows.helpdesk.tickets.filter((t) => t.priority === priority).map((t) => `${prefix}/tickets/${t.ticketNo}`);
    queries.push({ query: `${priority} priority tickets`, relevant });
  }
  for (const status of new Set(rows.helpdesk.tickets.map((t) => t.status))) {
    const relevant = rows.helpdesk.tickets.filter((t) => t.status === status).map((t) => `${prefix}/tickets/${t.ticketNo}`);
    queries.push({ query: `${status} tickets`, relevant });
  }
  for (const agent of rows.helpdesk.agents) {
    const relevant = openTicketsFor(rows, agent.code).map((ticketNo) => `${prefix}/tickets/${ticketNo}`);
    queries.push({ query: `open tickets assigned to ${agent.name}`, relevant });
  }

  return queries.filter((q) => q.relevant.length > 0);
}

/**
 * documentsMatching requires every word of the phrase to appear in the
 * document's title+body, so a candidate phrase is only kept when it matches
 * SOME but not ALL documents — a phrase matching nothing or everything can't
 * tell rankers apart either.
 */
function buildVaultdocsQueries(rows, wsId) {
  const prefix = `/w/${wsId}/vaultdocs`;
  const candidates = [
    "returns policy",
    "warranty policy",
    "customer tier discounts",
    "gold customers",
    "platinum customers",
    "support service levels",
    "depot operating hours",
    "FY2025 results",
    "helpdesk FAQ",
    "meeting notes",
    "operations memo",
    "lead time",
    "stock counts",
    "minimum order quantity",
    "damaged deliveries",
    "credit note",
    "public holidays",
    "board approved",
  ];
  const total = rows.vault.documents.length;
  return candidates
    .map((query) => ({ query, relevant: documentsMatching(rows, query).map((id) => `${prefix}/documents/${id}`) }))
    .filter((q) => q.relevant.length > 0 && q.relevant.length < total)
    .slice(0, 15);
}

const QUERY_BUILDERS = { warehouse: buildWarehouseQueries, helpdesk: buildHelpdeskQueries, vaultdocs: buildVaultdocsQueries };

/** One /ask call: GET with streaming=false, timed on the wall clock (not the server's own reported ranking latency — the eval cares what a caller actually waits). */
async function askOnce(askUrl, kind, query) {
  const url = `${askUrl}?query=${encodeURIComponent(query)}&streaming=false`;
  const start = performance.now();
  try {
    const res = await fetch(url, { headers: { "x-ask-ranker": kind } });
    const latencyMs = performance.now() - start;
    if (!res.ok) return { ok: false, status: res.status, latencyMs };
    const body = await res.json();
    return { ok: true, status: res.status, latencyMs, body };
  } catch (err) {
    return { ok: false, status: "ERR", latencyMs: performance.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Runs every query for one (app, ranker) pair and reduces the raw calls to the metrics the report needs. */
async function evaluateArm(askUrl, kind, queries) {
  const perQuery = [];
  for (const q of queries) {
    const relevant = new Set(q.relevant);
    const call = await askOnce(askUrl, kind, q.query);
    if (!call.ok) {
      perQuery.push({ query: q.query, relevantCount: relevant.size, httpStatus: call.status, error: call.error, latencyMs: call.latencyMs });
      continue;
    }
    const results = call.body.results ?? [];
    const rankedIds = results.map((r) => r.url);
    const scored = results.map((r) => ({ id: r.url, score: r.score }));
    perQuery.push({
      query: q.query,
      relevantCount: relevant.size,
      resultCount: results.length,
      httpStatus: call.status,
      latencyMs: call.latencyMs,
      ndcg: ndcgAt(rankedIds, relevant, RELEVANCE_K),
      precision: precisionAt(rankedIds, relevant, PRECISION_K),
      costUsd: call.body.usage?.costUsd ?? 0,
      highConfidenceMisses: highConfidenceMisses(scored, relevant, HIGH_CONFIDENCE_THRESHOLD),
      rankerDegraded: call.body.ranker_degraded === true,
      rankerAnswered: call.body.ranker,
    });
  }

  // 422/503 (or unreachable) means the arm produced no answer at all, not "a bad answer" — those never enter the quality averages.
  const answered = perQuery.filter((q) => q.ndcg !== undefined);
  const hardFailures = perQuery.filter((q) => q.ndcg === undefined);
  const degradedCount = answered.filter((q) => q.rankerDegraded).length;

  return {
    queries: perQuery,
    totalQueries: queries.length,
    answeredQueries: answered.length,
    hardFailureQueries: hardFailures.length,
    // Every query is a hard failure: this arm produced no data at all.
    totalFailure: hardFailures.length > 0 && hardFailures.length === queries.length,
    metrics: {
      ndcgAt10: avg(answered.map((q) => q.ndcg)),
      precisionAt5: avg(answered.map((q) => q.precision)),
      latencyP50Ms: percentile(answered.map((q) => q.latencyMs), 50),
      latencyP95Ms: percentile(answered.map((q) => q.latencyMs), 95),
      costPerQueryUsd: avg(answered.map((q) => q.costUsd)),
      highConfidenceMisses: sum(answered.map((q) => q.highConfidenceMisses)),
      degraded: degradedCount,
    },
  };
}

function avg(xs) {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}
function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}
function fmt(n, digits = 3) {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function renderMarkdown({ base, scenario, seed, workspaceId, rankers, perApp, totals }) {
  const lines = [];
  lines.push(`# ask-eval: ${scenario} seed ${seed}`, "", `Gateway: \`${base}\` · Workspace: \`${workspaceId}\` · Generated ${new Date().toISOString()}`, "");
  lines.push(
    "**Disclosures:** the `jev` ranker emits no generated text — a jev result's `description` is always the item's own boilerplate, not written by the ranker. " +
      "`degraded` counts queries where the named ranker fell back (its answer came from `lexical` instead, but is still counted under the ranker it was asked for) — read alongside the quality columns, not folded silently into them. " +
      "`hc miss` (high-confidence miss) is a result scored ≥ 0.75 that was NOT relevant; lexical's scores are token-overlap fractions, not a calibrated confidence, so its hc-miss count is not directly comparable to llm/jev's.",
    "",
  );

  const table = (rows) => {
    lines.push("| ranker | queries | nDCG@10 | P@5 | p50 ms | p95 ms | $/query | hc miss | degraded | failed |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows) {
      lines.push(`| ${r.kind} | ${r.answeredQueries}/${r.totalQueries} | ${fmt(r.metrics.ndcgAt10)} | ${fmt(r.metrics.precisionAt5)} | ${fmt(r.metrics.latencyP50Ms, 0)} | ${fmt(r.metrics.latencyP95Ms, 0)} | ${fmt(r.metrics.costPerQueryUsd, 5)} | ${r.metrics.highConfidenceMisses} | ${r.metrics.degraded} | ${r.hardFailureQueries} |`);
    }
    lines.push("");
  };

  for (const [app, byRanker] of Object.entries(perApp)) {
    lines.push(`## ${app}`, "");
    table(rankers.map((kind) => ({ kind, ...byRanker[kind] })));
  }

  lines.push("## totals (all apps)", "");
  table(rankers.map((kind) => ({ kind, ...totals[kind] })));

  return lines.join("\n") + "\n";
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const opts = parseArgs(argv);
  if (!opts.base) {
    printHelp();
    throw new Error("--base is required");
  }
  if (opts.scenario !== "acme-v1") {
    throw new Error(`--scenario ${opts.scenario}: query derivation here only knows acme-v1's row shapes`);
  }

  const base = opts.base.replace(/\/+$/, "");
  const workspace = await mintWorkspace(base, opts.scenario, opts.seed, opts.operatorKey);
  const rows = acmeV1.generate(workspace.seed);

  const perApp = {};
  const hardFailures = [];
  const allQueriesByKind = Object.fromEntries(opts.rankers.map((k) => [k, []]));

  for (const [app, buildQueries] of Object.entries(QUERY_BUILDERS)) {
    const askUrl = workspace.urls.ask?.[app] ?? (workspace.urls.apps[app] ? `${workspace.urls.apps[app]}/ask` : undefined);
    if (!askUrl) {
      console.warn(`skipping ${app}: not an ask-capable app on this deployment`);
      continue;
    }
    const queries = buildQueries(rows, workspace.id);
    console.error(`${app}: ${queries.length} derived queries`);

    perApp[app] = {};
    for (const kind of opts.rankers) {
      const arm = await evaluateArm(askUrl, kind, queries);
      perApp[app][kind] = arm;
      allQueriesByKind[kind].push(...arm.queries);
      if (arm.totalFailure) hardFailures.push({ app, ranker: kind });
    }
  }

  // The totals table re-derives from the pooled per-query records rather than
  // averaging the per-app averages, so an app with more queries weighs
  // proportionally more — a straight mean-of-means would not.
  const totals = {};
  for (const kind of opts.rankers) {
    const perQuery = allQueriesByKind[kind];
    const answered = perQuery.filter((q) => q.ndcg !== undefined);
    const hardFailureQueries = perQuery.length - answered.length;
    totals[kind] = {
      totalQueries: perQuery.length,
      answeredQueries: answered.length,
      hardFailureQueries,
      metrics: {
        ndcgAt10: avg(answered.map((q) => q.ndcg)),
        precisionAt5: avg(answered.map((q) => q.precision)),
        latencyP50Ms: percentile(answered.map((q) => q.latencyMs), 50),
        latencyP95Ms: percentile(answered.map((q) => q.latencyMs), 95),
        costPerQueryUsd: avg(answered.map((q) => q.costUsd)),
        highConfidenceMisses: sum(answered.map((q) => q.highConfidenceMisses)),
        degraded: answered.filter((q) => q.rankerDegraded).length,
      },
    };
  }

  const report = {
    base,
    scenario: opts.scenario,
    seed: workspace.seed,
    workspaceId: workspace.id,
    generatedAt: new Date().toISOString(),
    rankers: opts.rankers,
    apps: perApp,
    totals,
    hardFailures,
  };

  writeFileSync(`${opts.out}.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(`${opts.out}.md`, renderMarkdown({ base, scenario: opts.scenario, seed: workspace.seed, workspaceId: workspace.id, rankers: opts.rankers, perApp, totals }));
  console.error(`wrote ${opts.out}.json and ${opts.out}.md`);

  if (hardFailures.length > 0) {
    console.error(`FAILED: every query 422/503'd (or was unreachable) for: ${hardFailures.map((f) => `${f.app}/${f.ranker}`).join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
