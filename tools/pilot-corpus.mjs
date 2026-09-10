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
    return { doc: doc.id, body: doc.body };
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
  answers: { revenueDollars: rows.company.fiscalYearRevenueCents / 100, employees: rows.company.employees },
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

// ─── answer-format tolerance ──────────────────────────────────────────────
// The prompts show the final-answer format with <placeholders>. In the pilot
// (2026-09-10) a few agents echoed the angle brackets around correct values
// and lost the check. Two guards, both generic: every prompt that shows a
// placeholder says so in words, and every KEY=value pattern tolerates one
// leading "<" (a trailing ">" already sits outside the \b anchor).
for (const t of tasks) {
  if (/=<[^>]+>/.test(t.prompt) && !t.prompt.includes("without the angle brackets")) t.prompt += " Write the values themselves, without the angle brackets.";
  for (const e of t.expectations) e.pattern = e.pattern.replace(/=\\s\*/g, "=\\s*<?");
}

// ─── static audit ────────────────────────────────────────────────────────
const problems = [];
for (const t of tasks) {
  for (const e of t.expectations) {
    if (e.kind !== "response_matches") problems.push(`${t.id}: non-response-level expectation ${e.kind}`);
    if (e.pattern.length > 512) problems.push(`${t.id}: pattern too long`);
    if (/\\[1-9]/.test(e.pattern)) problems.push(`${t.id}: backreference`);
    if (/(\*|\+|\{[^}]*\}).*(\*|\+|\{[^}]*\})[^)]*\)[*+]/.test(e.pattern)) problems.push(`${t.id}: nested quantifier`);
    if (/\(\?i\)/.test(e.pattern)) problems.push(`${t.id}: inline flag`);
  }
  // No answer digit-string may appear verbatim in its own prompt (entity codes excepted: they are the QUESTION, not the answer).
  const digits = JSON.stringify(t.answers).match(/\d{3,}/g) ?? [];
  for (const d of digits) if (t.prompt.includes(d) && !t.prompt.includes(`seed":${WS_SEED}`) && d !== String(WS_SEED)) problems.push(`${t.id}: answer digits "${d}" appear in the prompt`);
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
console.log(JSON.stringify({ tasks: tasks.length, out: OUT, cells: matrix.length, runs: matrix.length * tasks.length }));
