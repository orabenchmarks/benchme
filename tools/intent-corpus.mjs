#!/usr/bin/env node
/**
 * intent-corpus — author six natural-language intent tasks (the kind a page
 * visitor would type, not a scripted API call) with ground truths DERIVED
 * from the same generator that seeds a workspace (@benchme/scenarios,
 * acme-v1) — never transcribed by hand. Two land at a `json` oracle (the
 * agent submits an answer document) and four at a `state` oracle (task 10:
 * the verifier reads the app's own REST API after the fact and checks the
 * live row — the submitted artifact is ignored).
 *
 *   node tools/intent-corpus.mjs [--seed 4242] [--out compose/specs] [--print <id>]
 *
 * Writes compose/specs/intent-*.json (one per task, taskSpecSchema-shaped),
 * compose/specs/intent-tasks.json (the public corpus a consumer copies into
 * its own benchmark: [{id, app, intent, oracle, summary}]), and
 * compose/specs/intent-tasks.md (prerequisites + how each answer was
 * derived — read that before touching the picks below).
 *
 * Two REST-shape footguns drove several of the choices here (see the .md for
 * the full explanation): `GET /api/v1/orders` and `GET /api/v1/tickets` are
 * PAGINATED — `{items, nextCursor}`, not a bare array — and the state
 * oracle's `asRows()` only unwraps a bare array, so a `where` filter against
 * those list routes silently never matches. `GET /api/v1/orders/:no` nests
 * line items under `lines[]`, which the oracle's flat `expect` cannot
 * address directly either. Both are worked around below, not upstream —
 * this tool only authors specs, it does not touch apps/verify.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acmeV1, documentsMatching, lowStock, stockOf } from "../packages/scenarios/dist/index.js";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const SEED = Number(args.seed ?? 4242);
const OUT = args.out ?? "compose/specs";
const PRINT = args.print;

const rows = acmeV1.generate(SEED);
const problems = [];

// ─── order-01: rank-based pick, well clear of the array edges so a modest
// change in scenario sizing (ACME_V1_SIZES) doesn't walk off the end ───────
const stockedDesc = [...rows.warehouse.stock].filter((s) => s.qty > 0).sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku));
const productBySku = new Map(rows.warehouse.products.map((p) => [p.sku, p]));
const rankPick = (arr, frac) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * frac)))];

const ORDER_QTY = 40;
const orderStock = rankPick(stockedDesc, 0.05);
const orderProduct = productBySku.get(orderStock.sku);
const orderCustomer = rankPick(rows.warehouse.customers, 0.22);
// warehouse.counters is DELETEd (never repopulated) on every seed — see
// apps/warehouse/src/db/seed.ts — so the first order a fresh workspace's API
// ever creates gets counter value 1: SO-${30000+1}. Seed-generated orders
// occupy SO-20000..SO-20000+count-1, so this can never collide with them.
const PREDICTED_ORDER_NO = "SO-30001";
const orderTotalCentsExpected = ORDER_QTY * orderProduct.unitPriceCents;
if (rows.warehouse.orders.some((o) => o.orderNo === PREDICTED_ORDER_NO)) problems.push(`predicted order no ${PREDICTED_ORDER_NO} collides with a seeded order`);

// ─── transfer-01: a different SKU than the order task, plenty of stock at
// the source, and NOT already a completed transfer in the seed (else the
// check would pass with no agent action at all) ────────────────────────────
const TRANSFER_QTY = 12;
const transferCandidates = stockedDesc.filter((s) => s.qty >= TRANSFER_QTY && s.sku !== orderStock.sku);
const transferSrc = rankPick(transferCandidates, 0.4);
const transferProduct = productBySku.get(transferSrc.sku);
const locationCodes = rows.warehouse.locations.map((l) => l.code);
const transferTo = locationCodes.find((c) => c !== transferSrc.locationCode);
if (!transferTo) problems.push("no destination depot distinct from the transfer source");
if (rows.warehouse.transfers.some((t) => t.sku === transferSrc.sku && t.fromCode === transferSrc.locationCode && t.toCode === transferTo && t.qty === TRANSFER_QTY && t.status === "completed")) {
  problems.push(`a seeded transfer already matches the intent-transfer-01 checks for seed ${SEED} — pick a different rank/qty`);
}

// ─── stock-01: a third, distinct SKU (value oracle: stockOf) ──────────────
const stockRow = rankPick(
  stockedDesc.filter((s) => s.sku !== orderStock.sku && s.sku !== transferSrc.sku),
  0.6,
);
const stockProduct = productBySku.get(stockRow.sku);
const stockQty = stockOf(rows, stockRow.sku);

// ─── lowstock-01: fixed threshold per the brief (value oracle: lowStock) ──
const LOW_THRESHOLD = 10;
const lowSkus = lowStock(rows, LOW_THRESHOLD);
if (lowSkus.length === 0) problems.push(`lowStock(rows, ${LOW_THRESHOLD}) is empty for seed ${SEED} — the task would have a vacuous answer`);
if (lowSkus.length > 20) problems.push(`lowStock(rows, ${LOW_THRESHOLD}) has ${lowSkus.length} SKUs for seed ${SEED} — too large to be a reasonable list-out-loud answer`);

// ─── ticket-01: an EXISTING seeded ticket (no id-prediction needed), not
// already assigned to the target agent, and not already resolved/closed so
// the intent requires real action (assign requires status ≠ closed; resolve
// requires an assignee — apps/helpdesk/src/db/tickets-repo.ts) ────────────
const ticketAgent = rankPick(rows.helpdesk.agents, 0.375);
const ticketCandidate = rows.helpdesk.tickets.find((t) => (t.status === "open" || t.status === "pending") && t.assigneeCode !== ticketAgent.code);
if (!ticketCandidate) problems.push(`no open/pending ticket unassigned-to-${ticketAgent.code} found for seed ${SEED}`);

// ─── doc-01: the first vault document whose OWN TITLE, fed back through
// documentsMatching(), resolves to exactly that one document — i.e. a
// phrase a visitor could plausibly type that is unambiguous in this vault.
// Prefer a "policy" doc (a generic, non-identifying topic) over a datasheet
// or memo (whose titles already carry the answer, a SKU or a customer name).
function pickUniqueDocument() {
  const byKindPreference = ["policy", "faq", "memo", "meeting-notes", "datasheet"];
  for (const kind of byKindPreference) {
    for (const d of rows.vault.documents.filter((x) => x.kind === kind)) {
      const matches = documentsMatching(rows, d.title);
      if (matches.length === 1 && matches[0] === d.id) return { doc: d, phrase: d.title.toLowerCase() };
    }
  }
  return null;
}
const docPick = pickUniqueDocument();
if (!docPick) problems.push(`no vault document has a title that uniquely matches itself for seed ${SEED}`);

if (problems.length) {
  console.error(`intent-corpus refused (seed ${SEED}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// ─── assemble the six task specs (taskSpecSchema-shaped) ──────────────────
const specs = [
  {
    id: "intent-order-01",
    blind: false,
    oracle: {
      kind: "state",
      checks: [
        {
          name: "order-open-for-customer",
          app: "warehouse",
          path: `/api/v1/orders/${PREDICTED_ORDER_NO}`,
          expect: { customerCode: orderCustomer.code, status: "open" },
        },
        {
          // `lines` is a nested array (OrderDetail in orders-repo.ts) the
          // oracle's flat `expect` can't address by sku/qty directly, so
          // this asserts the DERIVED total instead — the same technique as
          // answers.ts' orderTotalCents, computed inline because the order
          // doesn't exist in the seeded rows to call that helper against.
          name: "order-line-total-cents",
          app: "warehouse",
          path: `/api/v1/orders/${PREDICTED_ORDER_NO}`,
          expect: { totalCents: orderTotalCentsExpected },
        },
      ],
    },
  },
  {
    id: "intent-transfer-01",
    blind: false,
    oracle: {
      kind: "state",
      checks: [
        {
          // /api/v1/transfers is a bare array (no pagination envelope —
          // unlike /orders and /tickets), so a where-filter works directly.
          name: "transfer-completed",
          app: "warehouse",
          path: "/api/v1/transfers",
          where: { sku: transferSrc.sku, fromCode: transferSrc.locationCode, toCode: transferTo },
          expect: { qty: TRANSFER_QTY, status: "completed" },
        },
      ],
    },
  },
  {
    id: "intent-stock-01",
    blind: false,
    oracle: { kind: "json", expect: { qty: stockQty } },
  },
  {
    id: "intent-lowstock-01",
    blind: false,
    oracle: { kind: "json", expect: { skus: lowSkus.join(",") } },
  },
  {
    id: "intent-ticket-01",
    blind: false,
    oracle: {
      kind: "state",
      checks: [
        {
          name: "ticket-assigned-and-resolved",
          app: "helpdesk",
          path: `/api/v1/tickets/${ticketCandidate.ticketNo}`,
          expect: { assigneeCode: ticketAgent.code, status: "resolved" },
        },
      ],
    },
  },
  {
    id: "intent-doc-01",
    blind: false,
    oracle: { kind: "json", expect: { documentId: docPick.doc.id } },
  },
];

// ─── the public corpus: the NL intent a visitor would type, never the
// answer for a json task (a state task's intent necessarily states the
// desired quantities — that's the instruction, not a leaked answer) ───────
const tasks = [
  {
    id: "intent-order-01",
    app: "warehouse",
    intent: `Place a new order for customer ${orderCustomer.name} (${orderCustomer.code}) for ${ORDER_QTY} units of the ${orderProduct.name} (SKU ${orderProduct.sku}).`,
    oracle: "state",
    summary: `An open order for ${orderCustomer.code} whose total equals ${ORDER_QTY} × the SKU's unit price (line items are nested, so the check compares the derived total).`,
  },
  {
    id: "intent-transfer-01",
    app: "warehouse",
    intent: `Transfer ${TRANSFER_QTY} units of the ${transferProduct.name} (SKU ${transferProduct.sku}) from depot ${transferSrc.locationCode} to depot ${transferTo}, and complete the transfer.`,
    oracle: "state",
    summary: `A completed transfer of ${TRANSFER_QTY} units of ${transferProduct.sku} from ${transferSrc.locationCode} to ${transferTo}.`,
  },
  {
    id: "intent-stock-01",
    app: "warehouse",
    intent: `How many units of the ${stockProduct.name} (SKU ${stockProduct.sku}) are currently in stock across all depots? Answer as JSON: {"qty": <number>}.`,
    oracle: "json",
    summary: `Total stock of ${stockProduct.sku} across every depot, derived by stockOf().`,
  },
  {
    id: "intent-lowstock-01",
    app: "warehouse",
    intent: `Which SKUs currently have fewer than ${LOW_THRESHOLD} total units in stock across all depots? Answer as JSON: {"skus": "<comma-separated SKUs, ascending>"}.`,
    oracle: "json",
    summary: `The low-stock SKU set at threshold ${LOW_THRESHOLD}, derived by lowStock().`,
  },
  {
    id: "intent-ticket-01",
    app: "helpdesk",
    intent: `Assign helpdesk ticket ${ticketCandidate.ticketNo} to agent ${ticketAgent.name} (${ticketAgent.code}) and mark it resolved.`,
    oracle: "state",
    summary: `Ticket ${ticketCandidate.ticketNo} assigned to ${ticketAgent.code} with status resolved.`,
  },
  {
    id: "intent-doc-01",
    app: "vaultdocs",
    intent: `Search the document vault for the document about ${docPick.phrase} and report its document id as JSON: {"documentId": "<id>"}.`,
    oracle: "json",
    summary: `The id of the single vault document matching "${docPick.phrase}", derived by documentsMatching().`,
  },
];

if (PRINT) {
  const spec = specs.find((s) => s.id === PRINT);
  const task = tasks.find((t) => t.id === PRINT);
  if (!spec || !task) {
    console.error(`no such task id: ${PRINT}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ task, spec }, null, 2));
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
for (const spec of specs) writeFileSync(join(OUT, `${spec.id}.json`), `${JSON.stringify(spec, null, 2)}\n`);
writeFileSync(join(OUT, "intent-tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`);

const md = `# Intent corpus (task 11)

Six natural-language intent tasks against a fresh \`acme-v1\` workspace
(\`node tools/intent-corpus.mjs --seed ${SEED}\`). Every derived value comes
from \`@benchme/scenarios\`' generator or \`answers.ts\` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs and \`intent-tasks.json\` together. All six assume the SAME fresh
workspace (seed ${SEED}): none of them create their own workspace, and
intent-order-01 additionally assumes no order has been created in that
workspace yet (see below).

Two REST-shape facts, true for every task below, are worth stating once:
\`GET /api/v1/orders\` and \`GET /api/v1/tickets\` return a **paginated
envelope** \`{ items, nextCursor }\` (see \`apps/warehouse/src/api/routes.ts\`,
\`apps/helpdesk/src/api/routes.ts\`), not a bare array. The \`state\` oracle's
\`asRows()\` (\`apps/verify/src/oracles/state-oracle.ts\`) only unwraps a bare
array — a non-array object becomes exactly ONE row, whose fields are
\`items\`/\`nextCursor\`, not the fields of any individual order or ticket. A
\`where\` filter against those two LIST routes therefore never matches a real
row; it silently fails every time, pass or fail. This is why every \`state\`
check below targets a DETAIL route (\`/api/v1/orders/:no\`,
\`/api/v1/tickets/:no\`) instead — except transfers, whose list route
(\`/api/v1/transfers\`) is a bare array and works as a list check.

## intent-order-01 (state)

**Intent:** "Place a new order for customer ${orderCustomer.name} (${orderCustomer.code}) for ${ORDER_QTY} units of the ${orderProduct.name} (SKU ${orderProduct.sku})."

**Prerequisites:** a fresh \`acme-v1\` workspace at seed ${SEED} in which no
order has yet been created through the warehouse API (i.e. \`warehouse.counters\`
has no \`order\` row). \`apps/warehouse/src/db/seed.ts\` \`DELETE\`s
\`warehouse.counters\` on every seed and never repopulates it, so this holds
for any just-seeded workspace.

**Derivation:** \`orders-repo.ts\` mints order numbers as
\`SO-${"$"}{30000 + counter}\`, and the counter's first \`INSERT\` (no existing
row) returns \`value = 1\` — so the FIRST order an untouched workspace's API
creates is always \`SO-30001\`. Seed-generated orders occupy
\`SO-20000..SO-${20000 + rows.warehouse.orders.length - 1}\`, so there is no
collision. \`GET /api/v1/orders/:no\` nests line items under \`lines: [{sku,
qty, unitPriceCents}]\` (\`OrderDetail\` in \`orders-repo.ts\`) — an array the
oracle's flat, per-field \`expect\` cannot reach into. Since the intent asks
for a single-SKU order, the second check instead asserts the order's
\`totalCents\` equals \`${ORDER_QTY} × ${orderProduct.unitPriceCents}\` =
**${orderTotalCentsExpected}** — the same "derived value" idea as
\`answers.ts\`' \`orderTotalCents\`, computed inline here since the order does
not exist in the seeded rows to call that helper against.

**Known limitation:** if the agent creates more than one order while
attempting this task (a failed or corrected attempt, say), the order that
actually satisfies the intent may land on a number other than \`SO-30001\` and
this check reports FAIL even though the visible intent was eventually met.
This is a real constraint of the paginated \`/api/v1/orders\` list (see
above) — there is no way to find "the customer's newest open order" without
either a bare-array list endpoint or a line-item-aware oracle, neither of
which exists today. The intent is worded as one unambiguous ask so a
competent agent creates exactly one order.

## intent-transfer-01 (state)

**Intent:** "Transfer ${TRANSFER_QTY} units of the ${transferProduct.name} (SKU ${transferProduct.sku}) from depot ${transferSrc.locationCode} to depot ${transferTo}, and complete the transfer."

**Prerequisites:** a fresh \`acme-v1\` workspace at seed ${SEED}; depot
${transferSrc.locationCode} holds ${transferSrc.qty} units of
${transferProduct.sku} in the seed (≥ ${TRANSFER_QTY}, so the transfer is not
rejected for insufficient stock — \`INSUFFICIENT_STOCK\` in
\`orders-repo.ts\`).

**Derivation:** \`GET /api/v1/transfers\` returns a bare
\`TransferRow[]\` — no pagination envelope — so the check uses a \`where\`
filter (\`sku\`, \`fromCode\`, \`toCode\`) directly against the list and
\`expect\`s \`{ qty: ${TRANSFER_QTY}, status: "completed" }\`. The tool asserts
at generation time that no SEEDED transfer already matches this combination
(it doesn't, for seed ${SEED}), so the check can only pass once the agent has
actually created AND completed the transfer (\`POST /api/v1/transfers\` then
\`POST /api/v1/transfers/:no/complete\` — a transfer starts \`pending\` and
reserves stock at the source immediately; only \`complete\` moves it into the
destination).

## intent-stock-01 (json)

**Intent:** "How many units of the ${stockProduct.name} (SKU ${stockProduct.sku}) are currently in stock across all depots? Answer as JSON: {\"qty\": <number>}."

**Prerequisites:** a fresh \`acme-v1\` workspace at seed ${SEED} (stock levels
are read-only for this task — nothing needs to change first).

**Derivation:** \`qty\` = \`stockOf(rows, "${stockProduct.sku}")\` =
**${stockQty}** (packages/scenarios/src/answers.ts), the same total the
warehouse app itself would compute if asked (\`GET /api/v1/stock?sku=${stockProduct.sku}\`
returns \`{ sku, total, byLocation }\` with \`total\` equal to this value — a
correct agent can use that endpoint directly instead of summing
\`byLocation\` by hand).

## intent-lowstock-01 (json)

**Intent:** "Which SKUs currently have fewer than ${LOW_THRESHOLD} total units in stock across all depots? Answer as JSON: {\"skus\": \"<comma-separated SKUs, ascending>\"}."

**Prerequisites:** a fresh \`acme-v1\` workspace at seed ${SEED}.

**Derivation:** \`skus\` = \`lowStock(rows, ${LOW_THRESHOLD}).join(",")\` =
**"${lowSkus.join(",")}"** (packages/scenarios/src/answers.ts). \`lowStock\`
counts a product with NO stock rows at all as zero (not "no data"), which is
why the answer key must come from this helper rather than eyeballing
\`GET /api/v1/stock/low?threshold=${LOW_THRESHOLD}\` results by hand — the two
are expected to agree, and a mismatch would be a defect in the warehouse
app's own \`lowStock\` SQL, not in this task.

## intent-ticket-01 (state)

**Intent:** "Assign helpdesk ticket ${ticketCandidate.ticketNo} to agent ${ticketAgent.name} (${ticketAgent.code}) and mark it resolved."

**Prerequisites:** a fresh \`acme-v1\` workspace at seed ${SEED}; ticket
${ticketCandidate.ticketNo} is seeded with status \`"${ticketCandidate.status}"\`
and is not already assigned to ${ticketAgent.code}, so both the assign step
and the resolve step are real actions, not no-ops.

**Derivation:** this task targets an EXISTING seeded ticket (no id
prediction needed, unlike intent-order-01). \`GET /api/v1/tickets/:no\`
returns a flat \`TicketDetail\` (\`assigneeCode\`, \`status\` are top-level
fields — see \`apps/helpdesk/src/db/tickets-repo.ts\`), so the check is a
single direct \`expect\`. Two write-side rules make the two-step instruction
load-bearing, not a phrasing choice: \`transition()\` refuses \`resolved\`
while \`assignee_code IS NULL\` (\`UNASSIGNED\`), so the agent must assign
before resolving; and \`assign()\`/\`transition()\` both refuse a \`closed\`
ticket, which ${ticketCandidate.ticketNo} is not.

## intent-doc-01 (json)

**Intent:** "Search the document vault for the document about ${docPick.phrase} and report its document id as JSON: {\"documentId\": \"<id>\"}."

**Prerequisites:** a fresh \`acme-v1\` workspace at seed ${SEED} (the vault is
read-only for this task).

**Derivation:** \`documentId\` = \`documentsMatching(rows, "${docPick.phrase}")[0].id\`
= **${docPick.doc.id}** (packages/scenarios/src/answers.ts). The phrase was
found by running every vault document's own title back through
\`documentsMatching()\` and keeping the first one (preferring a \`"policy"\`
kind, whose title doesn't itself carry a SKU or customer name the way a
datasheet or memo title does) that resolves to exactly that one document —
see \`pickUniqueDocument()\` in \`tools/intent-corpus.mjs\`. A phrase that
matched more than one document, or zero, would make the task's answer
ambiguous or unreachable; the tool refuses to emit the corpus if that ever
happens for a given seed.
`;
writeFileSync(join(OUT, "intent-tasks.md"), md);

console.log(JSON.stringify({ seed: SEED, out: OUT, tasks: tasks.map((t) => t.id) }, null, 2));
