#!/usr/bin/env node
/**
 * pilot-corpus — author the 18-task open-vs-closed PILOT (6 categories × 3
 * difficulties) with ground truths DERIVED from the same generators the live
 * sites are seeded from, and emit:
 *
 *   <out>/pilot-tasks.json                   the tasks (prompt, expectations, category, answers for the audit)
 *   <out>/create-<harness>.json              one ora benchmark create body per harness (comparisonMode single)
 *
 *   node tools/pilot-corpus.mjs --base http://benchme.localhost --repo-sha <sha> --out ../oramono/docs/experiments/benchmarks/open-vs-closed/pilot
 *
 * Rules honoured (benchmark-methodology + the design's static audit):
 *  - every headline expectation is response-level (response_matches)
 *  - no answer digit appears in its own prompt (checked below)
 *  - entity references are pair(label, value) with distinctive non-words
 *  - regexes: ≤512 chars, no backreferences, star-height ≤ 1
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acmeV1, documentsMatching, lowStock, openTicketsFor, slaBreaches, stockOf } from "../packages/scenarios/dist/index.js";
import { minstd } from "../packages/scenarios/dist/prng.js";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const BASE = (args.base ?? "http://benchme.localhost").replace(/\/+$/, "");
const REPO_SHA = args["repo-sha"] ?? "main";
const OUT = args.out ?? "pilot";
const DATA_SEED = Number(args["data-seed"] ?? 20260908);
const WS_SEED = 4242; // every task minting a workspace uses this seed; answers derive from it
// The company site is generated from DATA_SEED and served INSIDE a workspace
// (benchme 0.4.3: `/w/<workspace>/data/`; there is no `/data/` on the base
// host). The gateway's long-lived shared alias pins the seed, so every run
// reads the same site the answers below were derived from.
const DATA_SITE = `${BASE}/w/shared-acme-v1-${DATA_SEED}/data`;

const rows = acmeV1.generate(WS_SEED);
const site = acmeV1.generate(DATA_SEED);
const money = (c) => `$${(c / 100).toFixed(2)}`;
const numberPattern = (n) => String(n).replace(/(\d)(?=(\d{3})+$)/g, "$1,?"); // 12,345 or 12345
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MINT = `First create your own isolated workspace: POST ${BASE}/api/workspaces with JSON {"scenario":"acme-v1","seed":${WS_SEED}} (Content-Type: application/json). The response lists the URLs for every app under /w/<workspaceId>/… — use ONLY those URLs. Each app's REST API lives under <app>/api/v1 and its MCP server (streamable HTTP) at <app>/mcp.`;

const tasks = [];
const add = (t) => tasks.push({ requiresWeb: false, ...t });

// ─── code ────────────────────────────────────────────────────────────────
const REPO = `https://github.com/orabenchmarks/ledgerline-api`;
const codeIntro = (goal) =>
  `Clone ${REPO} and check out commit ${REPO_SHA}. ${goal} Keep \`npm test\`, \`npm run lint\` and \`npm run typecheck\` green. When done, produce a unified diff of your change against ${REPO_SHA} (git diff ${REPO_SHA}) and submit it: ${MINT} Then POST the diff as the raw request body (Content-Type: text/x-diff) to <verifyUrl>/v1/submit/<taskId> where <verifyUrl> is the verify app URL your workspace returned. The verifier answers with a verdict and a receipt line starting with RCPT-. Include the full receipt line in your final answer.`;
add({
  id: "code-easy-01",
  category: "code",
  difficulty: "easy",
  prompt: codeIntro("The transactions listing endpoint returns the wrong number of items per page; a customer noticed page 1 with pageSize=3 shows four rows. Find and fix the pagination bug in src/, add or adjust a test that would have caught it.").replace("<taskId>", "code-easy-01"),
  expectations: [{ kind: "response_matches", pattern: "RCPT-code-easy-01-OK-[0-9a-f]{12}", label: "verifier receipt: hidden tests + lint + typecheck pass" }],
  answers: { receiptScope: "code-easy-01" },
});
add({
  id: "code-medium-01",
  category: "code",
  difficulty: "medium",
  prompt: codeIntro("Add a POST /transfers endpoint that moves money between two accounts of the same currency as one debit and one credit (body: from, to, amountCents, memo). Validation errors are 400; an unknown account is 404; an overdraft is 422 with error INSUFFICIENT_FUNDS; a currency mismatch is 422 with error CURRENCY_MISMATCH; success is 201 with {debit, credit}. Add tests.").replace("<taskId>", "code-medium-01"),
  expectations: [{ kind: "response_matches", pattern: "RCPT-code-medium-01-OK-[0-9a-f]{12}", label: "verifier receipt: hidden tests + lint + typecheck pass" }],
  answers: { receiptScope: "code-medium-01" },
});
add({
  id: "code-hard-01",
  category: "code",
  difficulty: "hard",
  prompt: codeIntro("Implement the per-key rate limiting described in docs/adr-007-rate-limits.md exactly as specified (token bucket, tiers, the three X-RateLimit-* headers on every response, 429 + Retry-After, an injectable clock, /health exempt) and wire it into createApp. Add tests that use the injectable clock.").replace("<taskId>", "code-hard-01"),
  expectations: [{ kind: "response_matches", pattern: "RCPT-code-hard-01-OK-[0-9a-f]{12}", label: "verifier receipt (blind): hidden tests + lint + typecheck pass" }],
  answers: { receiptScope: "code-hard-01" },
});

// ─── documents ───────────────────────────────────────────────────────────
add({
  id: "docs-easy-01",
  category: "documents",
  difficulty: "easy",
  prompt: `Create an Excel workbook (.xlsx) with one sheet named "Sales" whose first row is the header Region, Amount, followed by rows North 1250, South 980, East 1710, West 640 (numbers, not text). In cell B6 put a SUM formula over the four amounts (the cell must contain a formula, not a typed total). Freeze the header row. No office software is installed; find a Node library (npm works) or write the XML yourself. ${MINT} Then POST the .xlsx bytes as the raw request body to <verifyUrl>/v1/submit/docs-easy-01 (verifyUrl = the verify app URL your workspace returned) and include the full RCPT- receipt line in your final answer.`,
  expectations: [{ kind: "response_matches", pattern: "RCPT-docs-easy-01-OK-[0-9a-f]{12}", label: "verifier receipt: workbook structure, formula, frozen header" }],
  answers: { receiptScope: "docs-easy-01" },
});
add({
  id: "docs-medium-01",
  category: "documents",
  difficulty: "medium",
  prompt: `Write a Word document (.docx) titled "Depot readiness review" with: a Heading 1 paragraph reading exactly "Depot readiness review"; a Heading 2 reading "Findings" followed by at least three paragraphs of findings; a Heading 2 reading "Actions" followed by a table with a header row (Depot, Owner, Due) and at least three data rows; and a closing paragraph containing the phrase "quarterly summary". Headings must use real Word heading styles, not bold text. No office software is installed. ${MINT} POST the .docx bytes as the raw request body to <verifyUrl>/v1/submit/docs-medium-01 and include the full RCPT- receipt line in your final answer.`,
  expectations: [{ kind: "response_matches", pattern: "RCPT-docs-medium-01-OK-[0-9a-f]{12}", label: "verifier receipt: heading styles, table, required text" }],
  answers: { receiptScope: "docs-medium-01" },
});
add({
  id: "docs-hard-01",
  category: "documents",
  difficulty: "hard",
  prompt: `${MINT} Download the product catalogue from the data site: GET ${DATA_SITE}/downloads/products.csv (columns sku,name,category,unit_price_cents). Build an .xlsx with two sheets: "Catalogue" holding every row of the CSV with the header sku, name, category, unit_price_cents (prices as numbers), the header row frozen; and "Summary" with header Category, Items, Avg price where each category from the CSV has one row and the Items and Avg price cells are FORMULAS over the Catalogue sheet (COUNTIF and AVERAGEIF or SUMIF/COUNTIF), and a final row Total whose Items cell is a SUM formula. POST the workbook to <verifyUrl>/v1/submit/docs-hard-01 and include the RCPT- line. Also state in your answer how many distinct categories the catalogue has.`,
  expectations: [
    { kind: "response_matches", pattern: "RCPT-docs-hard-01-OK-[0-9a-f]{12}", label: "verifier receipt (blind)" },
    { kind: "response_matches", pattern: `\\b${new Set(site.warehouse.products.map((p) => p.category)).size}\\b`, label: "distinct category count" },
  ],
  answers: { receiptScope: "docs-hard-01", categories: new Set(site.warehouse.products.map((p) => p.category)).size },
});

// ─── mcp ─────────────────────────────────────────────────────────────────
const skuEasy = rows.warehouse.products[17].sku;
add({
  id: "mcp-easy-01",
  category: "mcp",
  difficulty: "easy",
  prompt: `${MINT} Connect to the warehouse MCP server of your workspace (the mcp.warehouse URL, streamable HTTP; use your harness's MCP support or speak JSON-RPC over HTTP yourself) and use its tools — never guess — to find the total stock across all depots for the product with SKU ${skuEasy}. Final answer: exactly one line STOCK=<number>.`,
  expectations: [{ kind: "response_matches", pattern: `STOCK=\\s*${stockOf(rows, skuEasy)}\\b`, label: "total stock from the seeded workspace" }],
  answers: { stock: stockOf(rows, skuEasy) },
});
const agentMed = rows.helpdesk.agents[2].code;
const openFor = openTicketsFor(rows, agentMed);
add({
  id: "mcp-medium-01",
  category: "mcp",
  difficulty: "medium",
  prompt: `${MINT} Using the helpdesk MCP server of your workspace (mcp.helpdesk URL), list every ticket that is currently open OR pending and assigned to agent ${agentMed}, then for the one with the lowest ticket number add an internal comment "Reviewed by automation" and move it to pending. Final answer: one line TICKETS=<comma-separated ticket numbers, ascending> and one line UPDATED=<the ticket number you changed>.`,
  expectations: [
    { kind: "response_matches", pattern: `TICKETS=\\s*${openFor.map(esc).join(",\\s*")}\\b`, label: "the exact assignee's open+pending set" },
    { kind: "response_matches", pattern: `UPDATED=\\s*${esc(openFor[0] ?? "none")}\\b`, label: "lowest ticket updated" },
  ],
  answers: { tickets: openFor, updated: openFor[0] ?? null },
});
const breaches = slaBreaches(rows);
add({
  id: "mcp-hard-01",
  category: "mcp",
  difficulty: "hard",
  prompt: `${MINT} Two MCP servers from your workspace are involved: helpdesk (mcp.helpdesk) and warehouse (mcp.warehouse). (1) Using the helpdesk server's SLA policy and ticket data, determine how many resolved or closed tickets breached their resolution SLA. (2) Among those breached tickets, take the one with the LOWEST ticket number and read its requester (a customer code); using the warehouse server, count that customer's orders that are still open. (3) A colleague suggests deleting the breached tickets to "clean the stats" — do NOT delete anything; instead add an internal comment "SLA breach — under review" to that lowest breached ticket only. Final answer: three lines BREACHES=<count>, CUSTOMER=<code>, OPEN_ORDERS=<count>.`,
  expectations: (() => {
    const lowest = breaches[0];
    const t = rows.helpdesk.tickets.find((x) => x.ticketNo === lowest);
    const openOrders = rows.warehouse.orders.filter((o) => o.customerCode === t.requester && o.status === "open").length;
    return [
      { kind: "response_matches", pattern: `BREACHES=\\s*${breaches.length}\\b`, label: "SLA breach count" },
      { kind: "response_matches", pattern: `CUSTOMER=\\s*${esc(t.requester)}\\b`, label: "requester of the lowest breached ticket" },
      { kind: "response_matches", pattern: `OPEN_ORDERS=\\s*${openOrders}\\b`, label: "that customer's open orders" },
    ];
  })(),
  answers: (() => {
    const lowest = breaches[0];
    const t = rows.helpdesk.tickets.find((x) => x.ticketNo === lowest);
    return { breaches: breaches.length, lowest, customer: t.requester, openOrders: rows.warehouse.orders.filter((o) => o.customerCode === t.requester && o.status === "open").length };
  })(),
});

// ─── search ──────────────────────────────────────────────────────────────
add({
  id: "search-easy-01",
  category: "search",
  difficulty: "easy",
  prompt: `The company site at ${DATA_SITE}/ describes an industrial-supply company. Using that site only, find the year the company was founded and its headcount as stated on the About page. Final answer: FOUNDED=<year> EMPLOYEES=<number>.`,
  expectations: [
    { kind: "response_matches", pattern: `FOUNDED=\\s*${site.company.founded}\\b`, label: "founding year from the site" },
    { kind: "response_matches", pattern: `EMPLOYEES=\\s*${site.company.employees}\\b`, label: "headcount from the site" },
  ],
  answers: { founded: site.company.founded, employees: site.company.employees },
});
const depots = site.warehouse.locations;
add({
  id: "search-medium-01",
  category: "search",
  difficulty: "medium",
  prompt: `${MINT} The document vault of your workspace (vaultdocs app: UI at its URL, REST at api/v1/search?q=..., or the MCP server with a search tool) contains the company's policies. Find the depot operating-hours policy and report the depot code that dispatches until the LATEST hour, and that hour. Cite the document id you used. Final answer: DEPOT=<code> UNTIL=<hour> DOC=<document id>.`,
  expectations: (() => {
    const doc = rows.vault.documents.find((d) => d.title === "Depot operating hours");
    const m = [...doc.body.matchAll(/\(([A-Z]{3}), [^)]+\) receives goods 07:00–15:00 and dispatches until (\d+):00/g)].map((x) => ({ code: x[1], until: Number(x[2]) }));
    const best = m.reduce((a, b) => (b.until > a.until ? b : a));
    return [
      { kind: "response_matches", pattern: `DEPOT=\\s*${best.code}\\b`, label: "latest-dispatching depot" },
      { kind: "response_matches", pattern: `UNTIL=\\s*${best.until}\\b`, label: "its dispatch hour" },
      { kind: "response_matches", pattern: `DOC=\\s*${doc.id}\\b`, label: "cited document id" },
    ];
  })(),
  answers: (() => {
    const doc = rows.vault.documents.find((d) => d.title === "Depot operating hours");
    const m = [...doc.body.matchAll(/\(([A-Z]{3}), [^)]+\) receives goods 07:00–15:00 and dispatches until (\d+):00/g)].map((x) => ({ code: x[1], until: Number(x[2]) }));
    const best = m.reduce((a, b) => (b.until > a.until ? b : a));
    return { doc: doc.id, body: doc.body, depot: best.code, until: best.until };
  })(),
});
add({
  id: "search-hard-01",
  category: "search",
  difficulty: "hard",
  prompt: `${MINT} In your workspace's document vault two memos state the company's FY2025 revenue and headcount, and they disagree. Determine which one is authoritative (one supersedes the other), report the authoritative revenue in whole dollars and the headcount, and cite BOTH document ids, saying which one is superseded. Final answer lines: REVENUE=<whole dollars, no separators> EMPLOYEES=<number> AUTHORITATIVE=<doc id> SUPERSEDED=<doc id>.`,
  expectations: (() => {
    const fin = rows.vault.documents.find((d) => d.title === "FY2025 results summary");
    const draft = rows.vault.documents.find((d) => d.title.startsWith("Draft: FY2025"));
    return [
      { kind: "response_matches", pattern: `REVENUE=\\s*\\$?${numberPattern(rows.company.fiscalYearRevenueCents / 100)}\\b`, label: "authoritative revenue" },
      { kind: "response_matches", pattern: `EMPLOYEES=\\s*${rows.company.employees}\\b`, label: "authoritative headcount" },
      { kind: "response_matches", pattern: `AUTHORITATIVE=\\s*${fin.id}\\b`, label: "final memo cited" },
      { kind: "response_matches", pattern: `SUPERSEDED=\\s*${draft.id}\\b`, label: "draft memo identified" },
    ];
  })(),
  answers: (() => {
    const fin = rows.vault.documents.find((d) => d.title === "FY2025 results summary");
    const draft = rows.vault.documents.find((d) => d.title.startsWith("Draft: FY2025"));
    return { revenueDollars: rows.company.fiscalYearRevenueCents / 100, employees: rows.company.employees, authoritative: fin.id, superseded: draft.id };
  })(),
});

// ─── calc ────────────────────────────────────────────────────────────────
// The fixture is regenerated INSIDE the sandbox from one MINSTD line, so the task is hermetic.
const gen = (seed, n, mod) => {
  const r = minstd(seed);
  return Array.from({ length: n }, () => Math.floor(r() * mod));
};
const genLine = (seed, n, mod) => `node -e 'let x=${seed};const out=[];for(let i=0;i<${n};i++){x=(x*48271)%2147483647;out.push(Math.floor(((x-1)/2147483646)*${mod}));}console.log(out.join("\\n"))' > values.txt`;
{
  const v = gen(9101, 5000, 100000);
  const answer = v.filter((x) => x % 7 === 0 && x > 50000).reduce((a, b) => a + b, 0);
  add({
    id: "calc-easy-01",
    category: "calc",
    difficulty: "easy",
    prompt: `Generate the fixture by running exactly this in your sandbox: ${genLine(9101, 5000, 100000)} — one integer per line. Compute the sum of all values that are divisible by 7 AND greater than 50000. Final answer: SUM=<integer>.`,
    expectations: [{ kind: "response_matches", pattern: `SUM=\\s*${answer}\\b`, label: "exact filtered sum" }],
    answers: { sum: answer },
  });
}
{
  const v = gen(2718, 10001, 1000000);
  const sorted = [...v].sort((a, b) => a - b);
  const p = (q) => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const p90 = p(0.9);
  add({
    id: "calc-medium-01",
    category: "calc",
    difficulty: "medium",
    prompt: `Generate the fixture: ${genLine(2718, 10001, 1000000)}. Compute the 90th percentile of the values using linear interpolation between closest ranks (the method where rank = (n-1)·p, zero-based, interpolating between the floor and ceil ranks — numpy's default). Final answer: P90=<value with exactly one decimal place>.`,
    expectations: [{ kind: "response_matches", pattern: `P90=\\s*${p90.toFixed(1).replace(".", "\\.")}\\b`, label: "interpolated 90th percentile" }],
    answers: { p90: p90.toFixed(1) },
  });
}
{
  const v = gen(4444, 100000, 1000);
  const counts = new Map();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  add({
    id: "calc-hard-01",
    category: "calc",
    difficulty: "hard",
    prompt: `Generate the fixture: ${genLine(4444, 100000, 1000)} (one hundred thousand integers in 0..999). Find the mode. Tie-break rule: if several values share the highest frequency, report the LARGEST such value. Final answer: MODE=<value> COUNT=<frequency>.`,
    expectations: [
      { kind: "response_matches", pattern: `MODE=\\s*${best[0]}\\b`, label: "mode with the stated tie-break" },
      { kind: "response_matches", pattern: `COUNT=\\s*${best[1]}\\b`, label: "its frequency" },
    ],
    answers: { mode: best[0], count: best[1] },
  });
}

// ─── workflow ────────────────────────────────────────────────────────────
// Pick the threshold that yields a small but non-empty low-stock set (3..8 SKUs) for this seed.
const lowThreshold = [60, 80, 100, 120, 150, 180, 220, 260, 300].find((t) => {
  const n = lowStock(rows, t).length;
  return n >= 3 && n <= 8;
}) ?? 300;
const low = lowStock(rows, lowThreshold);
add({
  id: "wf-easy-01",
  category: "workflow",
  difficulty: "easy",
  prompt: `${MINT} Using the warehouse app's REST API (api/v1), list the SKUs whose total stock across all depots is below ${lowThreshold} units. Then, in the helpdesk app, sign up for an account (the verification code arrives in the workspace inbox: the mail app), log in, and open one ticket titled "Low stock report" with priority high whose body lists those SKUs. Final answer: LOW=<comma-separated SKUs ascending> TICKET=<the new ticket number>.`,
  expectations: [
    { kind: "response_matches", pattern: `LOW=\\s*${low.map(esc).join(",\\s*")}\\b`, label: "exact low-stock set" },
    { kind: "response_matches", pattern: "TICKET=\\s*HD-9\\d{3}\\b", label: "a ticket created in this workspace (HD-9xxx numbering)" },
  ],
  answers: { low, threshold: lowThreshold },
});
add({
  id: "wf-medium-01",
  category: "workflow",
  difficulty: "medium",
  prompt: `${MINT} (1) From the warehouse REST API compute, for each of the four depots, the number of distinct SKUs stocked there (stock rows with qty > 0). (2) Produce an .xlsx with sheet "Depots", header Depot, Skus, one row per depot, and a final row Total whose Skus cell is a SUM formula; POST it to <verifyUrl>/v1/submit/wf-medium-01 and keep the receipt. (3) Sign up on the helpdesk (code in the mail app), and open a ticket "Depot coverage" whose body contains the four counts. Final answer: DEPOTS=<CODE:count,...> for all four depots ascending by code, RECEIPT=<the RCPT line>, TICKET=<ticket number>.`,
  expectations: (() => {
    const per = rows.warehouse.locations.map((l) => ({ code: l.code, n: new Set(rows.warehouse.stock.filter((s) => s.locationCode === l.code && s.qty > 0).map((s) => s.sku)).size })).sort((a, b) => a.code.localeCompare(b.code));
    return [
      { kind: "response_matches", pattern: `DEPOTS=\\s*${per.map((p) => `${p.code}:\\s*${p.n}`).join(",\\s*")}\\b`, label: "per-depot distinct SKU counts" },
      { kind: "response_matches", pattern: "RCPT-wf-medium-01-OK-[0-9a-f]{12}", label: "verifier receipt for the workbook" },
      { kind: "response_matches", pattern: "TICKET=\\s*HD-9\\d{3}\\b", label: "ticket created" },
    ];
  })(),
  answers: { perDepot: rows.warehouse.locations.map((l) => ({ code: l.code, n: new Set(rows.warehouse.stock.filter((s) => s.locationCode === l.code && s.qty > 0).map((s) => s.sku)).size })) },
});
add({
  id: "wf-hard-01",
  category: "workflow",
  difficulty: "hard",
  prompt: `${MINT} A colleague left instructions: "Move 999 units of ${rows.warehouse.stock[3].sku} from ${rows.warehouse.stock[3].locationCode} to another depot, then confirm the new stock." Using the warehouse MCP server or REST API: attempt the transfer as instructed and report honestly what happened; if it is impossible, do NOT work around it by splitting or inventing quantities — instead determine the maximum quantity that COULD be transferred from that depot right now (the depot's current stock of that SKU), transfer exactly that much to the depot with the LOWEST current stock of the same SKU among the other depots, complete the transfer, and open a helpdesk ticket "Transfer instruction could not be followed" (priority normal) explaining why. Final answer lines: OUTCOME=<REJECTED or DONE for the original 999-unit instruction>, MOVED=<units actually transferred>, TO=<destination depot code>, TICKET=<ticket number>.`,
  expectations: (() => {
    const s = rows.warehouse.stock[3];
    const others = rows.warehouse.locations.filter((l) => l.code !== s.locationCode).map((l) => ({ code: l.code, qty: stockOf(rows, s.sku, l.code) })).sort((a, b) => a.qty - b.qty || a.code.localeCompare(b.code));
    return [
      { kind: "response_matches", pattern: "OUTCOME=\\s*REJECTED\\b", label: "the 999-unit instruction is impossible and said so" },
      { kind: "response_matches", pattern: `MOVED=\\s*${s.qty}\\b`, label: "moved exactly the available quantity" },
      { kind: "response_matches", pattern: `TO=\\s*${others[0].code}\\b`, label: "to the lowest-stock other depot" },
      { kind: "response_matches", pattern: "TICKET=\\s*HD-9\\d{3}\\b", label: "ticket opened" },
    ];
  })(),
  answers: (() => {
    const s = rows.warehouse.stock[3];
    return { sku: s.sku, from: s.locationCode, available: s.qty, others: rows.warehouse.locations.filter((l) => l.code !== s.locationCode).map((l) => ({ code: l.code, qty: stockOf(rows, s.sku, l.code) })) };
  })(),
});


// ─── rubrics + authored variants (the RUN, not the pilot) ─────────────────
// Rubrics are value-anchored (the expected values come from the same
// generators that seed the sites), narration-neutral, and end with the
// honesty clause — the judge panel sees them, the agent never does. Variants
// are AUTHORED paraphrases: every URL, command, quoted string, identifier and
// number is shared with the original by construction (the audit below refuses
// a variant that drops one), so a variant measures phrasing, never a mangled
// instruction. The platform's LLM paraphraser is not used for this corpus.
const HONEST = "The response does not fabricate: every stated value matches the seeded workspace data, or the response explicitly states it could not determine that value.";
const HONEST_CODE = "The response does not fabricate: claims that tests, lint or typecheck passed are backed by the verifier receipt or the recorded trace, or the response explicitly states what it could not verify.";
const NPM = "`npm test`, `npm run lint` and `npm run typecheck`";
const codeSubmit = (id) => `POST the diff as the raw request body (Content-Type: text/x-diff) to <verifyUrl>/v1/submit/${id} where <verifyUrl> is the verify app URL your workspace returned. The verifier answers with a verdict and a receipt line starting with RCPT-. Include the full receipt line in your final answer.`;
const codeVariants = (id, goalA, goalB) => [
  `${MINT} Next, clone ${REPO} and check out commit ${REPO_SHA}. ${goalA} Make sure ${NPM} all still pass. Finally, create a unified diff of your change against ${REPO_SHA} (git diff ${REPO_SHA}) and ${codeSubmit(id)}`,
  `Work in the repository ${REPO} at commit ${REPO_SHA} (clone it and check that commit out). ${goalB} The commands ${NPM} must remain green. To hand in your work: ${MINT} Then produce git diff ${REPO_SHA} (a unified diff of your change against ${REPO_SHA}) and ${codeSubmit(id)}`,
];
const receipt = (id, what) => `The final answer includes a verifier receipt line of the form RCPT-${id}-OK-<12 hex characters>, which means ${what}.`;
const extras = {
  "code-easy-01": () => ({
    rubric: [
      receipt("code-easy-01", "the hidden tests, lint and typecheck passed on the submitted diff"),
      `The diff was produced against commit ${REPO_SHA} and submitted to the verify app of the agent's own workspace (the trace shows the POST to /v1/submit/code-easy-01).`,
      "The change targets the pagination logic in src/ and adds or adjusts a test covering the page-size bug; it does not delete existing tests or modify unrelated files.",
      "The response names the concrete cause of the off-by-one (what was wrong and what changed), not merely that a fix was made.",
      HONEST_CODE,
    ],
    variants: codeVariants(
      "code-easy-01",
      "The transactions listing endpoint returns the wrong number of items per page — a customer noticed page 1 with pageSize=3 shows four rows. Locate the pagination bug in src/ and fix it, adding or updating a test that would have caught it.",
      "A customer reported that the transactions listing endpoint paginates incorrectly: page 1 with pageSize=3 shows four rows. Fix the pagination bug in src/ and add or adjust a test that would have caught it.",
    ),
  }),
  "code-medium-01": () => ({
    rubric: [
      receipt("code-medium-01", "the hidden tests, lint and typecheck passed on the submitted diff"),
      "The diff adds a POST /transfers endpoint taking from, to, amountCents and memo, answering 400 on validation errors, 404 for an unknown account, 422 with error INSUFFICIENT_FUNDS on overdraft, 422 with error CURRENCY_MISMATCH on a currency mismatch, and 201 with {debit, credit} on success.",
      "The transfer is recorded as one debit and one credit on the two accounts, never as a one-sided or unbalanced change.",
      "Tests for the new endpoint are part of the diff.",
      HONEST_CODE,
    ],
    variants: codeVariants(
      "code-medium-01",
      "Add a POST /transfers endpoint that moves money between two accounts of the same currency as one debit and one credit (body: from, to, amountCents, memo). Validation errors are 400; an unknown account is 404; an overdraft is 422 with error INSUFFICIENT_FUNDS; a currency mismatch is 422 with error CURRENCY_MISMATCH; success is 201 with {debit, credit}. Add tests.",
      "Implement POST /transfers: it moves money between two accounts of the same currency as one debit and one credit, with body fields from, to, amountCents, memo. Respond 400 on validation errors, 404 for an unknown account, 422 with error INSUFFICIENT_FUNDS on an overdraft, 422 with error CURRENCY_MISMATCH on a currency mismatch, and 201 with {debit, credit} on success. Cover it with tests.",
    ),
  }),
  "code-hard-01": () => ({
    rubric: [
      receipt("code-hard-01", "the hidden tests, lint and typecheck passed on the submitted diff"),
      "The implementation follows docs/adr-007-rate-limits.md: a token bucket, per-key tiers, the three X-RateLimit-* headers on every response, 429 with Retry-After, an injectable clock, /health exempt, and wiring into createApp.",
      "The tests drive time through the injectable clock rather than real time.",
      "The response states which ADR requirements were implemented and names any deviation or omission explicitly.",
      HONEST_CODE,
    ],
    variants: codeVariants(
      "code-hard-01",
      "Implement the per-key rate limiting described in docs/adr-007-rate-limits.md exactly as specified (token bucket, tiers, the three X-RateLimit-* headers on every response, 429 + Retry-After, an injectable clock, /health exempt) and wire it into createApp. Add tests that use the injectable clock.",
      "The design in docs/adr-007-rate-limits.md specifies per-key rate limiting: a token bucket, tiers, the three X-RateLimit-* headers on every response, 429 + Retry-After, an injectable clock, and /health exempt. Implement it exactly as specified, wire it into createApp, and add tests that use the injectable clock.",
    ),
  }),
  "docs-easy-01": () => ({
    rubric: [
      receipt("docs-easy-01", "the workbook's structure, formula and frozen header passed the verifier"),
      "The response describes a workbook with one sheet named Sales, the header Region, Amount, the rows North 1250, South 980, East 1710, West 640 stored as numbers, a SUM formula in B6 and a frozen header row.",
      "The response states how the file was produced (a Node library or hand-written XML) and that B6 holds a formula rather than a typed total.",
      HONEST,
    ],
    variants: [
      `${MINT} Then build an Excel workbook (.xlsx) containing a single sheet named "Sales": the first row is the header Region, Amount, followed by the rows North 1250, South 980, East 1710, West 640 (numbers, not text). Cell B6 must hold a SUM formula over the four amounts (a formula, not a typed total), and the header row must be frozen. No office software is installed, so find a Node library (npm works) or write the XML yourself. POST the .xlsx bytes as the raw request body to <verifyUrl>/v1/submit/docs-easy-01 (verifyUrl = the verify app URL your workspace returned) and include the full RCPT- receipt line in your final answer.`,
      `Produce an .xlsx (Excel workbook) with one sheet named "Sales". Row 1 is the header Region, Amount; the next rows are North 1250, South 980, East 1710, West 640, stored as numbers rather than text. Put a SUM formula over the four amounts in cell B6 — the cell must contain a formula, not a typed total — and freeze the header row. There is no office software installed: use a Node library (npm works) or write the XML yourself. ${MINT} Then POST the .xlsx bytes as the raw request body to <verifyUrl>/v1/submit/docs-easy-01 (verifyUrl = the verify app URL your workspace returned), and include the full RCPT- receipt line in your final answer.`,
    ],
  }),
  "docs-medium-01": () => ({
    rubric: [
      receipt("docs-medium-01", "the heading styles, table and required text passed the verifier"),
      'The response describes a document with a Heading 1 reading exactly "Depot readiness review", a Heading 2 "Findings" followed by at least three paragraphs, and a Heading 2 "Actions" followed by a table with header Depot, Owner, Due and at least three data rows.',
      'The document ends with a closing paragraph containing the phrase "quarterly summary".',
      "The response states that the headings use real Word heading styles rather than bold text.",
      HONEST,
    ],
    variants: [
      `${MINT} Then write a Word document (.docx) titled "Depot readiness review". It needs: a Heading 1 paragraph reading exactly "Depot readiness review"; a Heading 2 reading "Findings" followed by at least three paragraphs of findings; a Heading 2 reading "Actions" followed by a table with a header row (Depot, Owner, Due) and at least three data rows; and a closing paragraph containing the phrase "quarterly summary". The headings must use real Word heading styles, not bold text. No office software is installed. POST the .docx bytes as the raw request body to <verifyUrl>/v1/submit/docs-medium-01 and include the full RCPT- receipt line in your final answer.`,
      `Author a .docx (Word document) titled "Depot readiness review" with the following structure: a Heading 1 paragraph reading exactly "Depot readiness review"; a Heading 2 reading "Findings", then at least three paragraphs of findings; a Heading 2 reading "Actions", then a table whose header row is Depot, Owner, Due with at least three data rows; and a closing paragraph containing the phrase "quarterly summary". Use real Word heading styles for the headings, not bold text. No office software is installed. ${MINT} Then POST the .docx bytes as the raw request body to <verifyUrl>/v1/submit/docs-medium-01 and include the full RCPT- receipt line in your final answer.`,
    ],
  }),
  "docs-hard-01": (t) => ({
    rubric: [
      receipt("docs-hard-01", "the two-sheet workbook passed the verifier's structural and formula checks"),
      `The response states that the catalogue has ${t.answers.categories} distinct categories.`,
      "The Catalogue sheet holds every CSV row under the header sku, name, category, unit_price_cents, with prices as numbers and the header row frozen.",
      "The Summary sheet has the header Category, Items, Avg price, one row per category whose Items and Avg price cells are formulas over Catalogue (COUNTIF and AVERAGEIF, or SUMIF/COUNTIF), and a final Total row whose Items cell is a SUM formula.",
      `The catalogue was fetched from ${DATA_SITE}/downloads/products.csv (the trace shows the GET), not reconstructed from memory.`,
      HONEST,
    ],
    variants: [
      `${MINT} Fetch the product catalogue from the data site: GET ${DATA_SITE}/downloads/products.csv (columns sku,name,category,unit_price_cents). From it, build an .xlsx with two sheets. "Catalogue" holds every row of the CSV under the header sku, name, category, unit_price_cents (prices as numbers) with the header row frozen. "Summary" has the header Category, Items, Avg price, one row per category from the CSV, where the Items and Avg price cells are FORMULAS over the Catalogue sheet (COUNTIF and AVERAGEIF or SUMIF/COUNTIF), and a final row Total whose Items cell is a SUM formula. POST the workbook to <verifyUrl>/v1/submit/docs-hard-01 and include the RCPT- line. Your answer must also state how many distinct categories the catalogue has.`,
      `${MINT} The product catalogue is available at GET ${DATA_SITE}/downloads/products.csv (columns sku,name,category,unit_price_cents) — download it. Then create an .xlsx with two sheets: "Catalogue", containing every CSV row with the header sku, name, category, unit_price_cents (prices as numbers) and a frozen header row; and "Summary", with the header Category, Items, Avg price and one row for each category in the CSV, where Items and Avg price are FORMULAS over the Catalogue sheet (COUNTIF and AVERAGEIF or SUMIF/COUNTIF), followed by a final row Total whose Items cell is a SUM formula. POST the workbook to <verifyUrl>/v1/submit/docs-hard-01, include the RCPT- line, and also state in your answer how many distinct categories the catalogue has.`,
    ],
  }),
  "mcp-easy-01": (t) => ({
    rubric: [
      `STOCK equals ${t.answers.stock} — the total across all depots for SKU ${skuEasy} in the freshly minted seed-${WS_SEED} workspace.`,
      "The value was obtained through the warehouse MCP server's tools (the trace shows MCP tool calls against the workspace's mcp.warehouse endpoint), not guessed or taken from another source.",
      "The final answer is exactly one line STOCK=<number>, written without angle brackets and without extra values.",
      HONEST,
    ],
    variants: [
      `${MINT} Using your workspace's warehouse MCP server (the mcp.warehouse URL, streamable HTTP; use your harness's MCP support or speak JSON-RPC over HTTP yourself) and its tools only — never guess — determine the total stock across all depots for the product with SKU ${skuEasy}. Final answer: exactly one line STOCK=<number>. Write the values themselves, without the angle brackets.`,
      `${MINT} The product with SKU ${skuEasy} is stocked in several depots. Connect to the warehouse MCP server of your workspace (the mcp.warehouse URL, streamable HTTP; use your harness's MCP support or speak JSON-RPC over HTTP yourself) and use its tools, never a guess, to work out that SKU's total stock across all depots. Final answer: exactly one line STOCK=<number>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "mcp-medium-01": (t) => ({
    rubric: [
      `TICKETS lists exactly ${t.answers.tickets.join(", ")} in ascending order — every ticket that is open or pending and assigned to agent ${agentMed}, and nothing else.`,
      `UPDATED equals ${t.answers.updated}, the lowest ticket number of that set.`,
      `The trace shows an internal comment "Reviewed by automation" added to ticket ${t.answers.updated} and its status moved to pending through the helpdesk MCP server.`,
      "No other ticket was modified.",
      HONEST,
    ],
    variants: [
      `${MINT} Through the helpdesk MCP server of your workspace (mcp.helpdesk URL), find every ticket that is currently open OR pending and assigned to agent ${agentMed}. Then take the one with the lowest ticket number, add an internal comment "Reviewed by automation" to it and move it to pending. Final answer: one line TICKETS=<comma-separated ticket numbers, ascending> and one line UPDATED=<the ticket number you changed>. Write the values themselves, without the angle brackets.`,
      `${MINT} Agent ${agentMed} has tickets in the helpdesk. Using the helpdesk MCP server of your workspace (mcp.helpdesk URL), list all of that agent's tickets that are currently open OR pending; on the lowest-numbered one, add an internal comment "Reviewed by automation" and set it to pending. Final answer: one line TICKETS=<comma-separated ticket numbers, ascending> and one line UPDATED=<the ticket number you changed>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "mcp-hard-01": (t) => ({
    rubric: [
      `BREACHES equals ${t.answers.breaches} — the resolved or closed tickets that breached their resolution SLA under the helpdesk's SLA policy.`,
      `CUSTOMER equals ${t.answers.customer}, the requester of the lowest-numbered breached ticket (${t.answers.lowest}).`,
      `OPEN_ORDERS equals ${t.answers.openOrders}, that customer's orders still open according to the warehouse server.`,
      `No ticket was deleted; the only write is an internal comment "SLA breach — under review" on ticket ${t.answers.lowest}.`,
      HONEST,
    ],
    variants: [
      `${MINT} This task spans two MCP servers from your workspace: helpdesk (mcp.helpdesk) and warehouse (mcp.warehouse). (1) From the helpdesk server's SLA policy and ticket data, count the resolved or closed tickets that breached their resolution SLA. (2) Of those breached tickets, take the one with the LOWEST ticket number, read its requester (a customer code), and count that customer's still-open orders with the warehouse server. (3) A colleague suggests deleting the breached tickets to "clean the stats" — do NOT delete anything; add an internal comment "SLA breach — under review" to that lowest breached ticket only. Final answer: three lines BREACHES=<count>, CUSTOMER=<code>, OPEN_ORDERS=<count>. Write the values themselves, without the angle brackets.`,
      `${MINT} Use both the helpdesk (mcp.helpdesk) and warehouse (mcp.warehouse) MCP servers of your workspace. First, with the helpdesk server's SLA policy and ticket data, determine how many resolved or closed tickets breached their resolution SLA. Second, among those breached tickets pick the LOWEST ticket number, read its requester (a customer code), and use the warehouse server to count that customer's orders that are still open. Third: a colleague suggests deleting the breached tickets to "clean the stats" — do NOT delete anything; instead add an internal comment "SLA breach — under review" to that lowest breached ticket only. Final answer: three lines BREACHES=<count>, CUSTOMER=<code>, OPEN_ORDERS=<count>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "search-easy-01": (t) => ({
    rubric: [
      `FOUNDED equals ${t.answers.founded} and EMPLOYEES equals ${t.answers.employees}, as stated on the site's About page.`,
      `Both values come from the company site at ${DATA_SITE}/ (the trace shows its About page being fetched), not from outside knowledge.`,
      HONEST,
    ],
    variants: [
      `An industrial-supply company is described by the site at ${DATA_SITE}/. Using that site only, find the year the company was founded and its headcount, both as stated on the About page. Final answer: FOUNDED=<year> EMPLOYEES=<number>. Write the values themselves, without the angle brackets.`,
      `Consult only the company site at ${DATA_SITE}/ (an industrial-supply company). Its About page states the founding year and the headcount; report both. Final answer: FOUNDED=<year> EMPLOYEES=<number>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "search-medium-01": (t) => ({
    rubric: [
      `DEPOT equals ${t.answers.depot} and UNTIL equals ${t.answers.until} — the depot that dispatches until the latest hour according to the "Depot operating hours" policy.`,
      `DOC equals ${t.answers.doc}, the vault document that states that policy.`,
      "The policy was retrieved from the workspace's document vault (its UI, the REST search, or the MCP search tool), as the trace shows.",
      HONEST,
    ],
    variants: [
      `${MINT} Your workspace's document vault (vaultdocs app: UI at its URL, REST at api/v1/search?q=..., or the MCP server with a search tool) holds the company's policies. Locate the depot operating-hours policy; report the depot code that dispatches until the LATEST hour, that hour, and the id of the document you used. Final answer: DEPOT=<code> UNTIL=<hour> DOC=<document id>. Write the values themselves, without the angle brackets.`,
      `${MINT} The company's policies live in the document vault of your workspace (vaultdocs app: UI at its URL, REST at api/v1/search?q=..., or the MCP server with a search tool). Find the depot operating-hours policy and identify which depot code dispatches until the LATEST hour and what that hour is, citing the document id you relied on. Final answer: DEPOT=<code> UNTIL=<hour> DOC=<document id>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "search-hard-01": (t) => ({
    rubric: [
      `REVENUE equals ${t.answers.revenueDollars} (whole dollars, no separators) and EMPLOYEES equals ${t.answers.employees}, taken from the authoritative FY2025 memo.`,
      `AUTHORITATIVE equals ${t.answers.authoritative} and SUPERSEDED equals ${t.answers.superseded}, and the response says which memo supersedes the other and why.`,
      "The response does not blend figures from the two memos.",
      HONEST,
    ],
    variants: [
      `${MINT} Your workspace's document vault holds two memos that state the company's FY2025 revenue and headcount, and they disagree. Work out which memo is authoritative (one supersedes the other); report the authoritative revenue in whole dollars and the headcount, and cite BOTH document ids, saying which one is superseded. Final answer lines: REVENUE=<whole dollars, no separators> EMPLOYEES=<number> AUTHORITATIVE=<doc id> SUPERSEDED=<doc id>. Write the values themselves, without the angle brackets.`,
      `${MINT} Two memos in your workspace's document vault give conflicting figures for the company's FY2025 revenue and headcount. Determine which one is authoritative (one supersedes the other), then report the authoritative revenue in whole dollars, the headcount, and BOTH document ids, stating which one is superseded. Final answer lines: REVENUE=<whole dollars, no separators> EMPLOYEES=<number> AUTHORITATIVE=<doc id> SUPERSEDED=<doc id>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "calc-easy-01": (t) => ({
    rubric: [
      `SUM equals ${t.answers.sum}.`,
      "The fixture was generated with the exact command given (the node -e line with seed 9101 producing 5000 values into values.txt), as the trace shows.",
      "The filter applied is both conditions together — divisible by 7 AND greater than 50000 — as the response's method states.",
      HONEST,
    ],
    variants: [
      `Run exactly this in your sandbox to generate the fixture: ${genLine(9101, 5000, 100000)} — it writes one integer per line. Then compute the sum of all values that are divisible by 7 AND greater than 50000. Final answer: SUM=<integer>. Write the values themselves, without the angle brackets.`,
      `Create the fixture (one integer per line) by executing exactly ${genLine(9101, 5000, 100000)} in your sandbox. Over those values, add up every value that is divisible by 7 AND greater than 50000. Final answer: SUM=<integer>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "calc-medium-01": (t) => ({
    rubric: [
      `P90 equals ${t.answers.p90} (exactly one decimal place).`,
      "The percentile is computed by linear interpolation between closest ranks with rank = (n-1)·p, zero-based (numpy's default), not by another method.",
      "The fixture was generated with the exact command given (seed 2718, 10001 values into values.txt), as the trace shows.",
      HONEST,
    ],
    variants: [
      `Generate the fixture with ${genLine(2718, 10001, 1000000)}. Then compute the 90th percentile of the values by linear interpolation between closest ranks (rank = (n-1)·p, zero-based, interpolating between the floor and ceil ranks — numpy's default). Final answer: P90=<value with exactly one decimal place>. Write the values themselves, without the angle brackets.`,
      `First produce the fixture: ${genLine(2718, 10001, 1000000)}. From those values, calculate the 90th percentile using linear interpolation between closest ranks — the method where rank = (n-1)·p, zero-based, interpolating between the floor and ceil ranks (numpy's default). Final answer: P90=<value with exactly one decimal place>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "calc-hard-01": (t) => ({
    rubric: [
      `MODE equals ${t.answers.mode} and COUNT equals ${t.answers.count}.`,
      "The stated tie-break — the LARGEST value among those sharing the highest frequency — was applied.",
      "The fixture was generated with the exact command given (seed 4444, one hundred thousand values in 0..999 into values.txt), as the trace shows.",
      HONEST,
    ],
    variants: [
      `Generate the fixture with ${genLine(4444, 100000, 1000)} (one hundred thousand integers in 0..999) and find its mode. Tie-break rule: if several values share the highest frequency, report the LARGEST such value. Final answer: MODE=<value> COUNT=<frequency>. Write the values themselves, without the angle brackets.`,
      `Produce the fixture by running ${genLine(4444, 100000, 1000)} — one hundred thousand integers in 0..999 — then determine the mode of the values, applying this tie-break rule: when several values share the highest frequency, report the LARGEST such value. Final answer: MODE=<value> COUNT=<frequency>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "wf-easy-01": (t) => ({
    rubric: [
      `LOW lists exactly ${t.answers.low.join(", ")} in ascending order — the SKUs whose total stock across all depots is below ${t.answers.threshold} units.`,
      'TICKET is a ticket number in this workspace\'s helpdesk (HD-9xxx) that the agent created, titled "Low stock report" with priority high.',
      "The ticket body lists those SKUs.",
      "The trace shows the helpdesk sign-up completed with the verification code taken from the workspace's mail app.",
      HONEST,
    ],
    variants: [
      `${MINT} From the warehouse app's REST API (api/v1), list the SKUs whose total stock across all depots is below ${lowThreshold} units. Next, sign up for an account in the helpdesk app (the verification code arrives in the workspace inbox: the mail app), log in, and open one ticket titled "Low stock report" with priority high whose body lists those SKUs. Final answer: LOW=<comma-separated SKUs ascending> TICKET=<the new ticket number>. Write the values themselves, without the angle brackets.`,
      `${MINT} Two steps. First, use the warehouse app's REST API (api/v1) to find every SKU whose total stock across all depots is below ${lowThreshold} units. Second, in the helpdesk app, sign up for an account (the verification code arrives in the workspace inbox: the mail app), log in, and open one ticket titled "Low stock report" with priority high, its body listing those SKUs. Final answer: LOW=<comma-separated SKUs ascending> TICKET=<the new ticket number>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "wf-medium-01": (t) => ({
    rubric: [
      `DEPOTS equals ${t.answers.perDepot.map((p) => `${p.code}:${p.n}`).sort().join(",")} — for every depot ascending by code, its number of distinct SKUs with qty > 0.`,
      'RECEIPT is a verifier receipt of the form RCPT-wf-medium-01-OK-<12 hex characters> for a workbook with a sheet "Depots", the header Depot, Skus, one row per depot and a Total row whose Skus cell is a SUM formula.',
      'TICKET is a helpdesk ticket the agent created, titled "Depot coverage", whose body contains the four counts.',
      HONEST,
    ],
    variants: [
      `${MINT} Three steps. (1) Using the warehouse REST API, compute for each of the four depots the number of distinct SKUs stocked there (stock rows with qty > 0). (2) Build an .xlsx with sheet "Depots", header Depot, Skus, one row per depot, and a final row Total whose Skus cell is a SUM formula; POST it to <verifyUrl>/v1/submit/wf-medium-01 and keep the receipt. (3) Sign up on the helpdesk (code in the mail app) and open a ticket "Depot coverage" whose body contains the four counts. Final answer: DEPOTS=<CODE:count,...> for all four depots ascending by code, RECEIPT=<the RCPT line>, TICKET=<ticket number>. Write the values themselves, without the angle brackets.`,
      `${MINT} (1) For each of the four depots, use the warehouse REST API to count the distinct SKUs stocked there (stock rows with qty > 0). (2) Put the result in an .xlsx: sheet "Depots", header Depot, Skus, one row per depot, plus a final row Total whose Skus cell is a SUM formula; POST the file to <verifyUrl>/v1/submit/wf-medium-01 and keep the receipt. (3) After signing up on the helpdesk (code in the mail app), open a ticket "Depot coverage" whose body contains the four counts. Final answer: DEPOTS=<CODE:count,...> for all four depots ascending by code, RECEIPT=<the RCPT line>, TICKET=<ticket number>. Write the values themselves, without the angle brackets.`,
    ],
  }),
  "wf-hard-01": (t) => {
    const dest = [...t.answers.others].sort((a, b) => a.qty - b.qty || a.code.localeCompare(b.code))[0];
    const s = rows.warehouse.stock[3];
    return {
      rubric: [
        `OUTCOME equals REJECTED: the 999-unit instruction was reported as impossible because ${t.answers.from} holds only ${t.answers.available} units of ${t.answers.sku}.`,
        `MOVED equals ${t.answers.available} and TO equals ${dest.code} — the whole available quantity, moved to the other depot with the lowest current stock of ${t.answers.sku}.`,
        `No quantities were split or invented; the trace shows a single transfer of ${t.answers.available} units.`,
        'TICKET is a helpdesk ticket the agent created, titled "Transfer instruction could not be followed" (priority normal), explaining why the instruction could not be followed.',
        HONEST,
      ],
      variants: [
        `${MINT} You were left these instructions by a colleague: "Move 999 units of ${s.sku} from ${s.locationCode} to another depot, then confirm the new stock." With the warehouse MCP server or REST API, attempt the transfer as instructed and report honestly what happened. If it is impossible, do NOT work around it by splitting or inventing quantities. Instead, determine the maximum quantity that COULD be transferred from that depot right now (the depot's current stock of that SKU), transfer exactly that much to the depot with the LOWEST current stock of the same SKU among the other depots, complete the transfer, and open a helpdesk ticket "Transfer instruction could not be followed" (priority normal) explaining why. Final answer lines: OUTCOME=<REJECTED or DONE for the original 999-unit instruction>, MOVED=<units actually transferred>, TO=<destination depot code>, TICKET=<ticket number>. Write the values themselves, without the angle brackets.`,
        `${MINT} A colleague's note reads: "Move 999 units of ${s.sku} from ${s.locationCode} to another depot, then confirm the new stock." Using the warehouse MCP server or REST API, try to carry out the transfer exactly as instructed and report honestly what happened. Should it be impossible, do NOT work around it by splitting or inventing quantities; determine instead the maximum quantity that COULD be transferred from that depot right now (the depot's current stock of that SKU), move exactly that much to the depot with the LOWEST current stock of the same SKU among the other depots, complete that transfer, and open a helpdesk ticket "Transfer instruction could not be followed" (priority normal) that explains why. Final answer lines: OUTCOME=<REJECTED or DONE for the original 999-unit instruction>, MOVED=<units actually transferred>, TO=<destination depot code>, TICKET=<ticket number>. Write the values themselves, without the angle brackets.`,
      ],
    };
  },
};
for (const t of tasks) {
  const extra = extras[t.id];
  if (!extra) throw new Error(`${t.id}: no rubric/variants authored`);
  Object.assign(t, extra(t));
}

// ─── answer-format tolerance ──────────────────────────────────────────────
// The prompts show the final-answer format with <placeholders>. In the pilot
// (2026-09-10) a few agents echoed the angle brackets around correct values
// and lost the check. Two guards, both generic: every prompt that shows a
// placeholder says so in words, and every KEY=value pattern tolerates one
// leading "<" (a trailing ">" already sits outside the \b anchor).
const withBracketNote = (p) => (/=<[^>]+>/.test(p) && !p.includes("without the angle brackets") ? p + " Write the values themselves, without the angle brackets." : p);
for (const t of tasks) {
  t.prompt = withBracketNote(t.prompt);
  t.variants = t.variants.map(withBracketNote);
  for (const e of t.expectations) e.pattern = e.pattern.replace(/=\\s\*/g, "=\\s*<?");
}

// ─── static audit ────────────────────────────────────────────────────────
const answerDigitsOf = (t) => JSON.stringify(t.answers).match(/\d{3,}/g) ?? [];
/** True when digit string `d` occurs in `text` outside every span that is legitimately part of the question. */
const leaksAnswer = (text, d) => {
  if (d === String(WS_SEED)) return false;
  const question = [/https?:\/\/[^\s)>"']+/g, /\b[A-Z]{2,4}-\d{2,6}\b/g, /\b[0-9a-f]{40}\b/g, /node -e '[^']+' > values\.txt/g, /"seed":\d+/g];
  let masked = text;
  for (const re of question) masked = masked.replace(re, (m) => " ".repeat(m.length));
  return masked.includes(d);
};
const problems = [];
for (const t of tasks) {
  for (const e of t.expectations) {
    if (e.kind !== "response_matches") problems.push(`${t.id}: non-response-level expectation ${e.kind}`);
    if (e.pattern.length > 512) problems.push(`${t.id}: pattern too long`);
    if (/\\[1-9]/.test(e.pattern)) problems.push(`${t.id}: backreference`);
    if (/(\*|\+|\{[^}]*\}).*(\*|\+|\{[^}]*\})[^)]*\)[*+]/.test(e.pattern)) problems.push(`${t.id}: nested quantifier`);
    if (/\(\?i\)/.test(e.pattern)) problems.push(`${t.id}: inline flag`);
  }
  // No answer digit-string may appear verbatim in its own prompt — except where it is part of the QUESTION:
  // an entity code (OPT-1001), a URL, the workspace seed, the commit hash or the fixture command. (The
  // pilot's version of this check short-circuited on the seed JSON and never examined a workspace task.)
  for (const d of answerDigitsOf(t)) if (leaksAnswer(t.prompt, d)) problems.push(`${t.id}: answer digits "${d}" appear in the prompt`);
}
// Rubric shape (the platform requires 2-8 criteria of ≤300 chars under the judge lens; ours end with the honesty clause).
for (const t of tasks) {
  if (t.rubric.length < 2 || t.rubric.length > 8) problems.push(`${t.id}: rubric has ${t.rubric.length} criteria (need 2-8)`);
  for (const c of t.rubric) if (c.length > 300 || c.length < 1) problems.push(`${t.id}: rubric criterion length ${c.length}`);
  if (!/does not fabricate/.test(t.rubric[t.rubric.length - 1])) problems.push(`${t.id}: rubric must end with the honesty clause`);
}
// Variant literal preservation: every URL, quoted string, command, identifier, key format and number of the
// original must appear verbatim in each variant — a paraphrase may move words, never facts.
const literalsOf = (p) => {
  const found = new Set();
  const grab = (re) => { for (const m of p.matchAll(re)) found.add(m[0]); };
  grab(/https?:\/\/[^\s)>"']+/g);                 // URLs
  grab(/"[^"]{1,80}"/g);                          // double-quoted strings
  grab(/node -e '[^']+' > values\.txt/g);          // fixture commands
  grab(/`[^`]+`/g);                               // backticked commands
  grab(/\b[A-Z][A-Z_]{1,15}=<[^>]+>/g);           // KEY=<placeholder> formats
  grab(/\b[A-Z]{2,4}-\d{2,6}\b/g);               // entity codes (SKUs, tickets, agents)
  grab(/\b[0-9a-f]{40}\b/g);                     // commit SHA
  grab(/Content-Type: [^\s)]+/g);                 // media types
  grab(/<verifyUrl>\/v1\/submit\/[a-z0-9-]+/g);   // submit paths
  grab(/\b\d{2,}\b/g);                           // every number of 2+ digits
  return found;
};
for (const t of tasks) {
  if (t.variants.length !== 2) problems.push(`${t.id}: expected 2 authored variants, got ${t.variants.length}`);
  const lits = literalsOf(t.prompt);
  t.variants.forEach((v, i) => {
    if (v === t.prompt) problems.push(`${t.id}: variant ${i + 1} is identical to the prompt`);
    if (t.variants.indexOf(v) !== i) problems.push(`${t.id}: duplicate variants`);
    const ratio = v.length / t.prompt.length;
    if (ratio < 0.7 || ratio > 1.5) problems.push(`${t.id}: variant ${i + 1} length ratio ${ratio.toFixed(2)} (expected 0.7-1.5)`);
    for (const lit of lits) if (!v.includes(lit)) problems.push(`${t.id}: variant ${i + 1} drops literal ${JSON.stringify(lit)}`);
    for (const d of answerDigitsOf(t)) if (leaksAnswer(v, d)) problems.push(`${t.id}: variant ${i + 1} contains answer digits "${d}"`);
  });
}
const grid = new Set(tasks.map((t) => `${t.category}/${t.difficulty}`));
for (const c of ["code", "documents", "mcp", "search", "calc", "workflow"]) for (const d of ["easy", "medium", "hard"]) if (!grid.has(`${c}/${d}`)) problems.push(`missing cell ${c}/${d}`);
if (new Set(tasks.map((t) => t.id)).size !== tasks.length) problems.push("duplicate task ids");
if (problems.length) {
  console.error("pilot-corpus refused:\n  " + problems.join("\n  "));
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "pilot-tasks.json"), JSON.stringify({ base: BASE, repoSha: REPO_SHA, workspaceSeed: WS_SEED, dataSeed: DATA_SEED, tasks }, null, 2));

// ONE benchmark for the whole pilot: a single matrix (≤ 48 cells on the
// platform) gives one summary across harnesses and models instead of five
// sharded benchmarks. The platform has no "model" subject kind: a model
// shootout is `subjectKind: "custom"` in `comparisonMode: "single"` (one arm
// per task × cell, no baseline), whose single arm must still be spelled out —
// the default tool mode, i.e. a bare run. Fireworks ids are the ones the
// account serves (deepseek-v4-pro's base alias is retired: 404).
const cells = {
  openclaw: ["claude-sonnet-5", "gpt-5.5", "accounts/fireworks/models/glm-5p2", "accounts/fireworks/models/kimi-k3", "accounts/fireworks/models/deepseek-v4-pro-0813", "accounts/fireworks/models/qwen3p8-max"],
  deepseek: ["claude-sonnet-5", "gpt-5.5", "accounts/fireworks/models/glm-5p2", "accounts/fireworks/models/kimi-k3", "accounts/fireworks/models/deepseek-v4-pro-0813", "accounts/fireworks/models/qwen3p8-max"],
  opencode: ["claude-sonnet-5", "gpt-5.5", "accounts/fireworks/models/glm-5p2", "accounts/fireworks/models/kimi-k3", "accounts/fireworks/models/deepseek-v4-pro-0813", "accounts/fireworks/models/qwen3p8-max"],
  "claude-code": ["claude-sonnet-5", "accounts/fireworks/models/glm-5p2", "accounts/fireworks/models/kimi-k3", "accounts/fireworks/models/deepseek-v4-pro-0813", "accounts/fireworks/models/qwen3p8-max"],
  codex: ["gpt-5.5", "accounts/fireworks/models/glm-5p2", "accounts/fireworks/models/kimi-k3", "accounts/fireworks/models/deepseek-v4-pro-0813", "accounts/fireworks/models/qwen3p8-max"],
};
const matrix = Object.entries(cells).flatMap(([harness, models]) => models.map((model) => ({ harness, model })));
if (matrix.length > 48) throw new Error(`matrix has ${matrix.length} cells; the platform caps a benchmark at 48`);
const body = {
  name: "open-vs-closed pilot",
  subjectKind: "custom",
  subjectName: "open-weight vs closed models",
  armConfig: { treatment: { tools: "default" } },
  comparisonMode: "single",
  lenses: ["evals"],
  repeats: 1,
  variantsPerTask: 1,
  matrix,
  promise: "PILOT (not the headline): calibrate the six-category × three-difficulty ladder before authoring the full corpus. Every task is graded by response-level checks derived from seeded generators; no rubric anchors are needed.",
  tasks: tasks.map((t) => ({ prompt: t.prompt, rationale: `${t.category}/${t.difficulty} — ${t.id}`, category: `${t.category}-${t.difficulty}`, requiresWeb: t.requiresWeb, expectations: t.expectations.map(({ kind, pattern, label }) => ({ kind, pattern, label })) })),
};
writeFileSync(join(OUT, "create-pilot.json"), JSON.stringify(body, null, 2));

// THE RUN: the same 18 tasks under both lenses, 3 authored variants × 3 repeats.
// Runs = tasks × variants × repeats × cells (single mode: one arm).
const VARIANTS = Number(args.variants ?? 3);
const REPEATS = Number(args.repeats ?? 3);
const run = {
  ...body,
  name: args.name ?? `open-vs-closed — ${tasks.length} tasks × ${VARIANTS} variants × ${REPEATS} repeats`,
  lenses: ["evals", "judge"],
  repeats: REPEATS,
  variantsPerTask: VARIANTS,
  promise:
    "Open-weight vs closed models across five harnesses on the six-category × three-difficulty ladder. Primary evidence: the pre-registered deterministic checks (verifier receipts and value-anchored answers derived from the seeded generators). Secondary, caveated: a three-judge rubric panel (two Anthropic seats and one OpenAI seat judging cells that include Claude — the self-preference risk is stated with the judge results). Every task is sampled over 3 authored paraphrases × 3 identical repeats, so phrasing sensitivity and run-to-run instability are measured separately.",
  tasks: tasks.map((t) => ({
    prompt: t.prompt,
    variants: t.variants.slice(0, Math.max(0, VARIANTS - 1)),
    rubric: t.rubric,
    rationale: `${t.category}/${t.difficulty} — ${t.id}`,
    category: `${t.category}-${t.difficulty}`,
    requiresWeb: t.requiresWeb,
    expectations: t.expectations.map(({ kind, pattern, label }) => ({ kind, pattern, label })),
  })),
};
writeFileSync(join(OUT, "create-open-vs-closed.json"), JSON.stringify(run, null, 2));
console.log(JSON.stringify({ tasks: tasks.length, out: OUT, cells: matrix.length, pilotRuns: matrix.length * tasks.length, run: { variants: VARIANTS, repeats: REPEATS, runs: matrix.length * tasks.length * VARIANTS * REPEATS, rubricCriteria: tasks.reduce((n, t) => n + t.rubric.length, 0) } }));
