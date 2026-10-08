#!/usr/bin/env node
/**
 * stripe-ledger — what the STRIPE=1 runs of the browser suite paid, looked up in Stripe and held against the stores'
 * orders. For every run record (the run.json each test attaches; Playwright's results.json carries them):
 *
 *   - the store's orders, from the workspace's internal state API (urls.apps.<store>/internal/state, through the
 *     gateway, header x-benchme-internal-secret);
 *   - the workspace's PaymentIntents: the ones the store names (orders, checkouts, payment attempts, hosted sessions'
 *     intents) and the ones Stripe's search finds by metadata['workspace'] — retried while the search has not indexed
 *     the run's payments yet;
 *   - every order: exactly one succeeded PaymentIntent (no two orders share one, and no succeeded intent of the
 *     workspace is without its order), amount == the order's chargedCents (and its total), currency usd (and shown to
 *     the shopper in dollars), livemode false, metadata.workspace / store / checkout the order's;
 *   - a run that used the decline card: a PaymentIntent with a declined last_payment_error and no order when the run
 *     ends without one; a declined charge when it paid after the decline;
 *   - a run that used the 3D Secure card: each order's intent went through requires_action (Stripe's
 *     payment_intent.requires_action event for it) and its charge shows an authenticated 3D Secure result.
 *
 *   node tools/shops-e2e/stripe-ledger.mjs [--internal-secret S] [--search-wait SECONDS] <OUT_DIR | results.json>...
 *
 * STRIPE_SECRET_KEY comes from the environment — a test-mode key (sk_test_…), never printed — and the internal
 * secret from --internal-secret, else $SHOPS_INTERNAL_SECRET, else the dev stack's fixed fake-mode one
 * (apps/shops/tools/dev-stack-secrets.mjs). A dev stack run with --payments stripe makes its own for every run and
 * prints it in its JSON line (internalSecret): pass that.
 * Prints one row per run and every mismatch; exit 0 when every run matches, 1 on any mismatch, 2 on a usage error.
 * Fake-mode records are listed as skipped: nothing of theirs is in Stripe.
 *
 * Its own tests: node --test tools/shops-e2e/stripe-ledger.test.mjs
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `stripe-ledger — every payment of the STRIPE=1 browser runs, looked up in Stripe and held against the stores' orders

Usage:
  node tools/shops-e2e/stripe-ledger.mjs [options] <OUT_DIR | results.json>...

  <OUT_DIR>                 a shops-e2e OUT_DIR (its results.json is read) or a results.json itself; several may be given
  --internal-secret <s>     the stores' SHOPS_INTERNAL_SECRET (default: $SHOPS_INTERNAL_SECRET, else the dev stack's
                            fake-mode one; a Stripe-mode dev stack prints its own as internalSecret in its JSON line)
  --search-wait <seconds>   how long to wait for Stripe's search to index a run's payments (default 90)
  --help                    print this message and exit

STRIPE_SECRET_KEY must be in the environment: a test-mode secret key (sk_test_…). It is never printed.
`;

/** The dev stack's fixed fake-mode internal secret (apps/shops/tools/dev-stack-secrets.mjs): nothing it protects is real. */
const DEV_STACK_INTERNAL_SECRET = "dev-stack-shops-internal-secret-012345678";
/** The API version the stores' Stripe SDK speaks (stripe@23), so objects come back in the shape the stores see. */
const STRIPE_VERSION = "2026-09-30.endive";
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 4;

export class UsageError extends Error {}

const q = (v) => JSON.stringify(v);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Any Stripe key in a message, masked or not, replaced. */
export function redact(text) {
  return String(text).replace(/\b(sk|pk|rk)_(test|live)_[A-Za-z0-9*]+/g, "$1_$2_[REDACTED]");
}

/* ------------------------------------------------------------------ arguments */

export function parseArgs(argv, env = {}) {
  const o = { inputs: [], help: false, searchWaitMs: 90_000, internalSecret: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--help") o.help = true;
    else if (a === "--internal-secret") o.internalSecret = value();
    else if (a === "--search-wait") {
      const s = Number(value());
      if (!Number.isFinite(s) || s < 0 || s > 600) throw new UsageError("--search-wait takes seconds, from 0 to 600");
      o.searchWaitMs = s * 1000;
    } else if (a.startsWith("--")) throw new UsageError(`unknown option ${q(a)} (see --help)`);
    else o.inputs.push(a);
  }
  if (o.help) return o;
  if (!o.inputs.length) throw new UsageError("give at least one shops-e2e OUT_DIR (or results.json) of a STRIPE=1 run");
  o.internalSecret ??= env.SHOPS_INTERNAL_SECRET || DEV_STACK_INTERNAL_SECRET;
  o.stripeKey = env.STRIPE_SECRET_KEY ?? "";
  // The message names the prefix only: a refused key is never echoed.
  if (!o.stripeKey.startsWith("sk_test_")) throw new UsageError("STRIPE_SECRET_KEY must be in the environment: a test-mode secret key (sk_test_…)");
  return o;
}

/* ------------------------------------------------------------------ run records */

/** The run records of a Playwright JSON report: each test's run.json attachment, with the test's title and status. */
export function recordsOf(results, where) {
  const out = [];
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const result = (t.results ?? []).at(-1);
          const att = (result?.attachments ?? []).find((a) => a.name === "run.json" && typeof a.body === "string");
          if (!att) continue;
          let rec;
          try {
            rec = JSON.parse(Buffer.from(att.body, "base64").toString("utf8"));
          } catch (err) {
            throw new UsageError(`${where}: the run.json of "${spec.title}" is not JSON (${err.message})`);
          }
          if (!isObject(rec) || typeof rec.task !== "string") throw new UsageError(`${where}: the run.json of "${spec.title}" is not a run record`);
          out.push({ ...rec, title: spec.title, status: result.status ?? "unknown" });
        }
      }
      walk(suite.suites);
    }
  };
  walk(results?.suites);
  return out;
}

function readResults(input) {
  const path = existsSync(input) && statSync(input).isDirectory() ? join(input, "results.json") : input;
  if (!existsSync(path)) throw new UsageError(`${path} does not exist (is it a shops-e2e OUT_DIR?)`);
  try {
    return { path, results: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    throw new UsageError(`${path}: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ what a store's state names */

/** The PaymentIntent and Checkout Session ids a store's state names: its orders, its checkouts and its events. */
export function knownRefs(state) {
  const intents = new Set();
  const sessions = new Set();
  const add = (id) => {
    if (typeof id !== "string") return;
    if (id.startsWith("pi_")) intents.add(id);
    else if (id.startsWith("cs_")) sessions.add(id);
  };
  for (const o of state.orders ?? []) add(o.paymentRef);
  for (const c of state.checkouts ?? []) {
    add(c.paymentRef);
    add(c.flags?.paymentIntent?.id);
  }
  for (const e of state.events ?? []) {
    add(e.data?.ref);
    add(e.data?.session);
    add(e.data?.paymentRef);
  }
  return { intents: [...intents].sort(), sessions: [...sessions].sort() };
}

/* ------------------------------------------------------------------ the audit of one run */

const isDeclined = (err) => isObject(err) && (err.code === "card_declined" || typeof err.decline_code === "string");
const chargeDeclined = (ch) => ch?.status === "failed" && (ch.failure_code === "card_declined" || ch.outcome?.type === "issuer_declined");

/**
 * One run against what Stripe holds. `f`: { orders (the store's), intents (Map id → PaymentIntent, its latest_charge
 * expanded), charges (Map intent id → its charges, for decline runs), requiresAction (Set of intent ids Stripe sent
 * payment_intent.requires_action for) }. Returns the summary row and every mismatch.
 */
export function auditRun(rec, f) {
  const row = { task: rec.task, run: rec.run, store: rec.store, workspace: rec.workspace ?? "-", orders: 0, paid: 0, amounts: "-", threeDs: "-", decline: "-", verdict: "ok" };
  if (rec.payments !== "stripe") return { row: { ...row, verdict: "skipped" }, problems: [] };
  const problems = [];
  const p = (m) => problems.push(m);
  if (!rec.workspace) {
    p("the run minted no workspace: there is nothing to look up");
    return { row: { ...row, verdict: "MISMATCH" }, problems };
  }
  const orders = f.orders ?? [];
  const intents = [...f.intents.values()];
  const ours = intents.filter((pi) => pi.metadata?.workspace === rec.workspace);
  const succeeded = ours.filter((pi) => pi.status === "succeeded");
  row.orders = orders.length;
  row.paid = succeeded.length;

  // Every order: its one succeeded intent, matching it.
  const byRef = new Map();
  let clean = 0;
  for (const o of orders) {
    if (byRef.has(o.paymentRef)) p(`orders ${byRef.get(o.paymentRef).orderNo} and ${o.orderNo} share the payment ${o.paymentRef}`);
    byRef.set(o.paymentRef, o);
    const pi = f.intents.get(o.paymentRef);
    if (!pi) {
      p(`order ${o.orderNo}: Stripe has no PaymentIntent ${o.paymentRef}`);
      continue;
    }
    const bad = [];
    if (pi.status !== "succeeded") bad.push(`status ${pi.status}`);
    if (pi.amount !== o.chargedCents) bad.push(`amount ${pi.amount} ≠ the order's chargedCents ${o.chargedCents === null || o.chargedCents === undefined ? "null" : o.chargedCents}`);
    if (pi.currency !== "usd") bad.push(`currency ${pi.currency}`);
    if (pi.livemode !== false) bad.push("livemode");
    if (pi.metadata?.workspace !== rec.workspace) bad.push(`metadata.workspace ${q(pi.metadata?.workspace)}`);
    if (pi.metadata?.store !== rec.store) bad.push(`metadata.store ${q(pi.metadata?.store)}`);
    if (pi.metadata?.checkout !== o.checkoutToken) bad.push(`metadata.checkout ${q(pi.metadata?.checkout)} ≠ the order's checkout ${o.checkoutToken}`);
    const shown = pi.presentment_details?.presentment_currency;
    if (shown && shown !== "usd") bad.push(`presented to the shopper in ${shown.toUpperCase()} (${pi.presentment_details.presentment_amount})`);
    if (typeof o.chargedCents === "number" && typeof o.totals?.totalCents === "number" && o.chargedCents !== o.totals.totalCents) {
      bad.push(`charged ${money(o.chargedCents)} but the order's total is ${money(o.totals.totalCents)}`);
    }
    if (bad.length) p(`order ${o.orderNo} (${pi.id}): ${bad.join("; ")}`);
    else clean++;
  }
  row.amounts = orders.length ? `${clean}/${orders.length}` : "-";
  for (const pi of succeeded) if (!byRef.has(pi.id)) p(`Stripe took ${money(pi.amount)} in ${pi.id}, but the store has no order for it`);

  // The run's own end.
  if (rec.expectClass === "none" && orders.length) p(`the run should end without an order, but the store lists ${orders.map((o) => o.orderNo).join(", ")}`);
  if (rec.expectClass !== "none" && !orders.length) p("the run should have placed an order, but the store lists none");
  for (const n of rec.orders ?? []) if (!orders.some((o) => o.orderNo === n)) p(`the shopper reached ${n}, which the store does not list`);

  // The decline card.
  if ((rec.cards ?? []).includes("decline")) {
    const declinedIntent = ours.some((pi) => isDeclined(pi.last_payment_error));
    const declinedCharge = [...f.charges.values()].flat().some(chargeDeclined);
    if (rec.expectClass === "none") {
      if (!declinedIntent) p("the decline left no PaymentIntent with a declined last_payment_error");
    } else if (!declinedIntent && !declinedCharge) {
      p("the decline card left no declined charge in Stripe");
    }
    row.decline = declinedIntent || declinedCharge ? "declined" : "MISSING";
  }

  // The 3D Secure card.
  if ((rec.cards ?? []).includes("3ds")) {
    let challenged = 0;
    for (const o of orders) {
      const pi = f.intents.get(o.paymentRef);
      if (!pi) continue;
      let ok = true;
      if (!f.requiresAction.has(pi.id)) {
        p(`order ${o.orderNo}: ${pi.id} never went through requires_action`);
        ok = false;
      }
      const tds = pi.latest_charge?.payment_method_details?.card?.three_d_secure;
      if (tds?.result !== "authenticated") {
        p(`order ${o.orderNo}: the charge of ${pi.id} shows no authenticated 3D Secure (${tds ? q(tds.result) : "none"})`);
        ok = false;
      }
      if (ok) challenged++;
    }
    row.threeDs = orders.length && challenged === orders.length ? "challenged" : "MISSING";
  }

  row.verdict = problems.length ? "MISMATCH" : "ok";
  return { row, problems };
}

/* ------------------------------------------------------------------ the network */

async function stripeGet(env, path, params = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(x));
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${env.stripeKey}`, "stripe-version": STRIPE_VERSION }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (attempt < 3) continue;
      throw new Error(`GET /v1/${path}: ${redact(err.message)}`);
    }
    const j = await res.json().catch(() => ({}));
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`GET /v1/${path} answered ${res.status}: ${redact(j.error?.message ?? "")}`);
    return j;
  }
}

/** Every page of a Stripe list. */
async function listAll(env, path, params) {
  const out = [];
  let after = null;
  for (;;) {
    const page = await stripeGet(env, path, { ...params, limit: 100, ...(after ? { starting_after: after } : {}) });
    out.push(...page.data);
    if (!page.has_more || !page.data.length) return out;
    after = page.data.at(-1).id;
  }
}

/** Every page of a Stripe search. */
async function searchAll(env, path, query) {
  const out = [];
  let next = null;
  for (;;) {
    const page = await stripeGet(env, path, { query, limit: 100, ...(next ? { page: next } : {}) });
    out.push(...page.data);
    if (!page.has_more || !page.next_page) return out;
    next = page.next_page;
  }
}

async function readState(env, rec) {
  const url = `${rec.storeUrl}/internal/state?workspace=${encodeURIComponent(rec.workspace)}`;
  const res = await fetch(url, { headers: { accept: "application/json", "x-benchme-internal-secret": env.internalSecret }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 401) throw new Error(`${url} refused the internal secret (401): pass the stack's --internal-secret (a dev stack prints it as internalSecret in its JSON line)`);
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status} (is the stack that ran the suite still up?)`);
  return res.json();
}

/** What Stripe holds for one run's workspace: its intents (by the store's ids and by search), their charges when needed. */
async function factsOf(env, rec, notes) {
  const state = await readState(env, rec);
  const known = knownRefs(state);
  const fromSessions = await Promise.all(known.sessions.map((id) => stripeGet(env, `checkout/sessions/${id}`).then((cs) => (typeof cs.payment_intent === "string" ? cs.payment_intent : (cs.payment_intent?.id ?? null)), () => null)));
  const wanted = new Set([...known.intents, ...fromSessions.filter(Boolean)]);
  // Search finds what the store never recorded; it can lag a minute behind the payments.
  const query = `metadata['workspace']:'${rec.workspace}'`;
  let found = [];
  const until = Date.now() + env.searchWaitMs;
  for (;;) {
    found = await searchAll(env, "payment_intents/search", query);
    const ids = new Set(found.map((pi) => pi.id));
    const missing = [...wanted].filter((id) => !ids.has(id));
    if (!missing.length) break;
    if (Date.now() >= until) {
      notes.push(`${rec.task}: Stripe's search had not indexed ${missing.join(", ")} yet; read by id instead`);
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const ids = [...new Set([...wanted, ...found.map((pi) => pi.id)])].sort();
  const intents = new Map();
  for (const id of ids) {
    try {
      intents.set(id, await stripeGet(env, `payment_intents/${id}`, { "expand[]": "latest_charge" }));
    } catch (err) {
      notes.push(`${rec.task}: ${err.message}`);
    }
  }
  const charges = new Map();
  if ((rec.cards ?? []).includes("decline")) {
    for (const id of intents.keys()) charges.set(id, await listAll(env, "charges", { payment_intent: id }));
  }
  return { orders: state.orders ?? [], intents, charges };
}

/** The intents Stripe sent payment_intent.requires_action for since `since` (seconds). */
async function requiresActionSince(env, since) {
  const events = await listAll(env, "events", { type: "payment_intent.requires_action", "created[gte]": since });
  return new Set(events.map((e) => e.data?.object?.id).filter(Boolean));
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ main */

function table(rows) {
  const cols = [
    ["task", "TASK"],
    ["run", "RUN"],
    ["store", "STORE"],
    ["workspace", "WORKSPACE"],
    ["orders", "ORDERS"],
    ["paid", "PAID PI"],
    ["amounts", "AMOUNTS OK"],
    ["threeDs", "3DS"],
    ["decline", "DECLINE"],
    ["verdict", "VERDICT"],
  ];
  const w = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => String(r[k]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join("  ").trimEnd();
  return [line(cols.map(([, h]) => h)), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(cols.map(([k]) => r[k])))].join("\n");
}

async function main(argv) {
  let opts;
  let records = [];
  try {
    opts = parseArgs(argv, process.env);
    if (opts.help) {
      process.stdout.write(HELP);
      return 0;
    }
    for (const input of opts.inputs) {
      const { path, results } = readResults(resolve(input));
      const rs = recordsOf(results, path);
      if (!rs.length) throw new UsageError(`${path} holds no run record (run.json): is it from this suite's tasks.spec.ts?`);
      records.push(...rs);
    }
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`stripe-ledger: ${err.message}`);
    return 2;
  }
  const env = opts;
  const stripeRuns = records.filter((r) => r.payments === "stripe" && r.workspace);
  console.log(`stripe-ledger: ${records.length} run(s), ${stripeRuns.length} paid with Stripe, from ${opts.inputs.join(", ")}`);
  const notes = [];
  const factsByRun = new Map();
  const failures = new Map();
  await pool(stripeRuns, CONCURRENCY, async (rec) => {
    try {
      factsByRun.set(rec, await factsOf(env, rec, notes));
    } catch (err) {
      failures.set(rec, redact(err.message));
    }
  });
  // requires_action events since the earliest order of a 3D Secure run (an hour of slack), once for all runs.
  let requiresAction = new Set();
  const tdsOrders = [...factsByRun.entries()].filter(([r]) => (r.cards ?? []).includes("3ds")).flatMap(([, f]) => f.orders);
  if (tdsOrders.length) {
    const earliest = Math.min(...tdsOrders.map((o) => Date.parse(o.paidAt)).filter(Number.isFinite));
    const since = Math.floor((Number.isFinite(earliest) ? earliest : Date.now()) / 1000) - 3600;
    try {
      requiresAction = await requiresActionSince(env, since);
    } catch (err) {
      notes.push(`the requires_action events could not be read: ${redact(err.message)}`);
    }
  }
  const rows = [];
  const mismatches = [];
  for (const rec of records) {
    let audit;
    if (failures.has(rec)) {
      audit = { row: { task: rec.task, run: rec.run, store: rec.store, workspace: rec.workspace, orders: "?", paid: "?", amounts: "?", threeDs: "?", decline: "?", verdict: "MISMATCH" }, problems: [failures.get(rec)] };
    } else {
      audit = auditRun(rec, { ...(factsByRun.get(rec) ?? { orders: [], intents: new Map(), charges: new Map() }), requiresAction });
    }
    rows.push(audit.row);
    for (const m of audit.problems) mismatches.push(`${rec.task} (${rec.run}, ${rec.workspace ?? "no workspace"}): ${m}`);
  }
  console.log(`\n${table(rows)}\n`);
  for (const n of notes) console.log(`note: ${n}`);
  if (mismatches.length) {
    console.log(`\n${mismatches.length} mismatch(es):`);
    for (const m of mismatches) console.log(`  - ${m}`);
  }
  const ok = rows.filter((r) => r.verdict === "ok").length;
  const skipped = rows.filter((r) => r.verdict === "skipped").length;
  console.log(`\n${rows.length} run(s): ${ok} ok${skipped ? `, ${skipped} skipped (fake mode)` : ""}, ${rows.length - ok - skipped} with a mismatch`);
  return mismatches.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
