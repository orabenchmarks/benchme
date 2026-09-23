# Intent corpus (task 11)

Six natural-language intent tasks against a fresh `acme-v1` workspace
(`node tools/intent-corpus.mjs --seed 4242`). Every derived value comes
from `@benchme/scenarios`' generator or `answers.ts` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs and `intent-tasks.json` together. All six assume the SAME fresh
workspace (seed 4242): none of them create their own workspace, and
intent-order-01 additionally assumes no order has been created in that
workspace yet (see below).

Two REST-shape facts, true for every task below, are worth stating once:
`GET /api/v1/orders` and `GET /api/v1/tickets` return a **paginated
envelope** `{ items, nextCursor }` (see `apps/warehouse/src/api/routes.ts`,
`apps/helpdesk/src/api/routes.ts`), not a bare array. The `state` oracle's
`asRows()` (`apps/verify/src/oracles/state-oracle.ts`) only unwraps a bare
array — a non-array object becomes exactly ONE row, whose fields are
`items`/`nextCursor`, not the fields of any individual order or ticket. A
`where` filter against those two LIST routes therefore never matches a real
row; it silently fails every time, pass or fail. This is why every `state`
check below targets a DETAIL route (`/api/v1/orders/:no`,
`/api/v1/tickets/:no`) instead — except transfers, whose list route
(`/api/v1/transfers`) is a bare array and works as a list check.

## intent-order-01 (state)

**Intent:** "Place a new order for customer Vidorfal Industrial (C-108) for 40 units of the Marmar Marka kit (SKU ADH-1038)."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242 in which no
order has yet been created through the warehouse API (i.e. `warehouse.counters`
has no `order` row). `apps/warehouse/src/db/seed.ts` `DELETE`s
`warehouse.counters` on every seed and never repopulates it, so this holds
for any just-seeded workspace.

**Derivation:** `orders-repo.ts` mints order numbers as
`SO-${30000 + counter}`, and the counter's first `INSERT` (no existing
row) returns `value = 1` — so the FIRST order an untouched workspace's API
creates is always `SO-30001`. Seed-generated orders occupy
`SO-20000..SO-20299`, so there is no
collision. `GET /api/v1/orders/:no` nests line items under `lines: [{sku,
qty, unitPriceCents}]` (`OrderDetail` in `orders-repo.ts`) — an array the
oracle's flat, per-field `expect` cannot reach into. Since the intent asks
for a single-SKU order, the second check instead asserts the order's
`totalCents` equals `40 × 22425` =
**897000** — the same "derived value" idea as
`answers.ts`' `orderTotalCents`, computed inline here since the order does
not exist in the seeded rows to call that helper against.

**Known limitation:** if the agent creates more than one order while
attempting this task (a failed or corrected attempt, say), the order that
actually satisfies the intent may land on a number other than `SO-30001` and
this check reports FAIL even though the visible intent was eventually met.
This is a real constraint of the paginated `/api/v1/orders` list (see
above) — there is no way to find "the customer's newest open order" without
either a bare-array list endpoint or a line-item-aware oracle, neither of
which exists today. The intent is worded as one unambiguous ask so a
competent agent creates exactly one order.

## intent-transfer-01 (state)

**Intent:** "Transfer 12 units of the Kalo Quendor kit (SKU FAS-1096) from depot VLM to depot OST, and complete the transfer."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242; depot
VLM holds 324 units of
FAS-1096 in the seed (≥ 12, so the transfer is not
rejected for insufficient stock — `INSUFFICIENT_STOCK` in
`orders-repo.ts`).

**Derivation:** `GET /api/v1/transfers` returns a bare
`TransferRow[]` — no pagination envelope — so the check uses a `where`
filter (`sku`, `fromCode`, `toCode`) directly against the list and
`expect`s `{ qty: 12, status: "completed" }`. The tool asserts
at generation time that no SEEDED transfer already matches this combination
(it doesn't, for seed 4242), so the check can only pass once the agent has
actually created AND completed the transfer (`POST /api/v1/transfers` then
`POST /api/v1/transfers/:no/complete` — a transfer starts `pending` and
reserves stock at the source immediately; only `complete` moves it into the
destination).

## intent-stock-01 (json)

**Intent:** "How many units of the Quentho Dordor pack (SKU ENC-1027) are currently in stock across all depots? Answer as JSON: {"qty": <number>}."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242 (stock levels
are read-only for this task — nothing needs to change first).

**Derivation:** `qty` = `stockOf(rows, "ENC-1027")` =
**683** (packages/scenarios/src/answers.ts), the same total the
warehouse app itself would compute if asked (`GET /api/v1/stock?sku=ENC-1027`
returns `{ sku, total, byLocation }` with `total` equal to this value — a
correct agent can use that endpoint directly instead of summing
`byLocation` by hand).

## intent-lowstock-01 (json)

**Intent:** "Which SKUs currently have fewer than 10 total units in stock across all depots? Answer as JSON: {"skus": "<comma-separated SKUs, ascending>"}."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242.

**Derivation:** `skus` = `lowStock(rows, 10).join(",")` =
**"ADH-1118,FAS-1048"** (packages/scenarios/src/answers.ts). `lowStock`
counts a product with NO stock rows at all as zero (not "no data"), which is
why the answer key must come from this helper rather than eyeballing
`GET /api/v1/stock/low?threshold=10` results by hand — the two
are expected to agree, and a mismatch would be a defect in the warehouse
app's own `lowStock` SQL, not in this task.

## intent-ticket-01 (state)

**Intent:** "Assign helpdesk ticket HD-5001 to agent Teodor Voss (AG-13) and mark it resolved."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242; ticket
HD-5001 is seeded with status `"open"`
and is not already assigned to AG-13, so both the assign step
and the resolve step are real actions, not no-ops.

**Derivation:** this task targets an EXISTING seeded ticket (no id
prediction needed, unlike intent-order-01). `GET /api/v1/tickets/:no`
returns a flat `TicketDetail` (`assigneeCode`, `status` are top-level
fields — see `apps/helpdesk/src/db/tickets-repo.ts`), so the check is a
single direct `expect`. Two write-side rules make the two-step instruction
load-bearing, not a phrasing choice: `transition()` refuses `resolved`
while `assignee_code IS NULL` (`UNASSIGNED`), so the agent must assign
before resolving; and `assign()`/`transition()` both refuse a `closed`
ticket, which HD-5001 is not.

## intent-doc-01 (json)

**Intent:** "Search the document vault for the document about returns and warranty policy and report its document id as JSON: {"documentId": "<id>"}."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242 (the vault is
read-only for this task).

**Derivation:** `documentId` = `documentsMatching(rows, "returns and warranty policy")[0].id`
= **doc-101** (packages/scenarios/src/answers.ts). The phrase was
found by running every vault document's own title back through
`documentsMatching()` and keeping the first one (preferring a `"policy"`
kind, whose title doesn't itself carry a SKU or customer name the way a
datasheet or memo title does) that resolves to exactly that one document —
see `pickUniqueDocument()` in `tools/intent-corpus.mjs`. A phrase that
matched more than one document, or zero, would make the task's answer
ambiguous or unreachable; the tool refuses to emit the corpus if that ever
happens for a given seed.
