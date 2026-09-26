# Intent corpus

163 natural-language intent tasks (57 state, 106 json) against a fresh `acme-v1` workspace
(`node tools/intent-corpus.mjs --seed 4242`). Every derived value comes
from `@benchme/scenarios`' generator or `answers.ts` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs, `intent-tasks.json` and `intent-corpus.json` together. All of them
assume the SAME fresh workspace (seed 4242); none of them create their own
workspace.

Two REST-shape facts, true for every task below, are worth stating once:
`GET /api/v1/orders` and `GET /api/v1/tickets` return a **paginated
envelope** `{ items, nextCursor }` (see `apps/warehouse/src/api/routes.ts`,
`apps/helpdesk/src/api/routes.ts`), not a bare array. The `state` oracle
(`apps/verify/src/oracles/state-oracle.ts`, task 10b) unwraps `items` and
follows `nextCursor` across pages (up to a bounded cap), so a `where`
filter against those two LIST routes now matches a real row instead of
silently seeing only `{items, nextCursor}` as one object. `GET
/api/v1/orders/:no` nests line items under `lines: [{sku, qty,
unitPriceCents}]` (`OrderDetail` in `orders-repo.ts`), unreachable without
a known order number — a task 10b follow-up added `rowPath`: for each
`where`-matched list row (up to a bounded cap) the oracle fetches a detail
path with `{field}` placeholders resolved from that row, then matches
`expect` against the fetched row with the list row merged underneath. An
object `expect` value against an array field is array-any (some element
satisfies every key), so `{ lines: { sku, qty } }` requires an EXACT
line, not just any line. intent-order-01 below uses this to verify the
order's actual contents, not just that an order exists. intent-ticket-01
still targets a DETAIL route (`/api/v1/tickets/:no`) directly (no
`rowPath` needed) because it targets one specific, already-known seeded
ticket number.

## intent-order-01 (state)

**Intent:** "Place a new order for customer Vidorfal Industrial (C-108) for 40 units of the Marmar Marka kit (SKU ADH-1038)."

**Prerequisites:** a fresh `acme-v1` workspace at seed 4242. Nothing is
assumed about `warehouse.counters` or prior orders — the check does not
predict an order number, so it doesn't care how many orders (if any)
already exist.

**Derivation:** the check reads `GET /api/v1/orders?customer=C-108&status=open`
(narrowed server-side by the query params the route already supports) and
filters with `where: { customerCode: "C-108", status: "open" }`
as a belt-and-suspenders match on the same fields. The seed already gives
C-108 **5** open order(s)
(counted straight from the generated rows, not hand-typed), so "at least one
open order" alone would pass with no agent action at all — the check
requires `count.min: 6`, true only once the
agent has placed (and left open) one additional order, regardless of how
many attempts it took to get there. For each such matched order, `rowPath:
"/api/v1/orders/{orderNo}"` fetches that order's detail route (`{orderNo}`
resolved from the list row), and `expect: { lines: { sku:
"ADH-1038", qty: 40 } }` requires an exact line to
appear on it (array-any against `lines[]`) — so an order for the wrong SKU
or the wrong quantity does not satisfy the check, even though it is open and
belongs to the right customer.

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

**Derivation:** `documentId` = `documentsMatching(rows, "returns and warranty policy")[0]`
= **doc-101** (packages/scenarios/src/answers.ts). The phrase was
found by running every vault document's own title back through
`documentsMatching()` and keeping the first one (preferring a `"policy"`
kind, whose title doesn't itself carry a SKU or customer name the way a
datasheet or memo title does) that resolves to exactly that one document —
see `pickUniqueDocument()` in `tools/intent-corpus.mjs`. A phrase that
matched more than one document, or zero, would make the task's answer
ambiguous or unreachable; the tool refuses to emit the corpus if that ever
happens for a given seed.

## Read tasks answerable on every surface (pages, WebMCP/MCP tools, NLWeb)

These four exist so ONE task set can compare a site's three doors. Each
answer is present in the app's pages, its tools, AND its NLWeb `/ask`
index (schema.org items). intent-stock-01 and intent-lowstock-01 are not in
this set: NLWeb's Product items carry price and availability, not per-depot
quantities.

- **intent-price-01** — ENC-1035 "Quenquen Renmar kit" is the only product with that name; `price` = unitPriceCents / 100 = **50.25** (±0.005, a number).
- **intent-customer-01** — **C-114** is the only gold-tier customer based in Quillhaven (uniqueness checked over all 40 customers).
- **intent-reporter-01** — ticket HD-5090 was reported by **C-111** (not HD-5001, which intent-ticket-01 changes).
- **intent-doc-02** — `documentsMatching(rows, "helpdesk faq")` = [**doc-137**], a faq (a different kind than intent-doc-01's document).

All derived for seed 4242.

## Templated tasks (tools/intent-corpus/templates/)

Every task below comes from a template: one kind of intent, instantiated over
distinct seeded rows, its answer key derived from those rows. No two tasks
touch the same row, so the state tasks stay independent inside one
workspace. `node tools/intent-integrity.mjs` proves each one against a live
benchme: every state task FAILS on a fresh workspace and PASSES once its
reference solution has run; every json task's answer, read back from the
live apps, is accepted, and a wrong one is refused.

### order (state, warehouse) — 5 tasks

A new order for one customer and one product (intent-order-01's shape): the customer's open orders, filtered by customer rather than a predicted order number, must number one MORE than the seed gave them, and one of them must carry the exact SKU/quantity line on its fetched detail row. The line is one none of the customer's existing open orders already carries.

- **intent-order-02** — C-121 (2 open in the seed) → one more open order with 5 × ADH-1054
- **intent-order-03** — C-112 (4 open in the seed) → one more open order with 15 × SEN-1060
- **intent-order-04** — C-110 (3 open in the seed) → one more open order with 60 × FLU-1111
- **intent-order-05** — C-130 (4 open in the seed) → one more open order with 40 × FAS-1096
- **intent-order-06** — C-124 (1 open in the seed) → one more open order with 60 × OPT-1113

### order-multi (state, warehouse) — 4 tasks

ONE new order with two lines. Two checks, each requiring one of the lines on a fetched detail row, and both capping the customer's open orders at exactly one more than the seed gave them — so two separate single-line orders fail, and neither line may already sit on one of the customer's existing open orders.

- **intent-order-multi-01** — C-137 (2 open in the seed) → exactly one more open order with 5 × FAS-1080 and 45 × ENC-1115
- **intent-order-multi-02** — C-127 (4 open in the seed) → exactly one more open order with 20 × FAS-1008 and 25 × ADH-1054
- **intent-order-multi-03** — C-119 (1 open in the seed) → exactly one more open order with 5 × FAS-1056 and 55 × FLU-1119
- **intent-order-multi-04** — C-131 (3 open in the seed) → exactly one more open order with 25 × FLU-1111 and 55 × CAB-1002

### cancel (state, warehouse) — 5 tasks

Cancel an order that is open in the seed (a shipped one cannot be cancelled — ALREADY_SHIPPED). The check reads the order's detail row for status `cancelled`. It claims the customer too: a cancellation lowers their open-order count, which an order task for the same customer counts.

- **intent-cancel-01** — SO-20086 (C-126, open in the seed) → cancelled
- **intent-cancel-02** — SO-20176 (C-102, open in the seed) → cancelled
- **intent-cancel-03** — SO-20014 (C-103, open in the seed) → cancelled
- **intent-cancel-04** — SO-20185 (C-109, open in the seed) → cancelled
- **intent-cancel-05** — SO-20065 (C-133, open in the seed) → cancelled

### transfer (state, warehouse) — 4 tasks

Move stock between depots and complete the transfer (intent-transfer-01's shape). The source row holds at least twice the quantity, no seeded pending transfer reserves it, and no seeded completed transfer already matches — so only the agent's own completed transfer passes.

- **intent-transfer-02** — 30 × ADH-1062 QHV → BRM (the seed holds 221 at QHV)
- **intent-transfer-03** — 7 × ENC-1075 QHV → VLM (the seed holds 323 at QHV)
- **intent-transfer-04** — 28 × CAB-1074 BRM → QHV (the seed holds 123 at BRM)
- **intent-transfer-05** — 18 × ENC-1091 QHV → BRM (the seed holds 183 at QHV)

### complete-transfer (state, warehouse) — 4 tasks

Complete a transfer the seed left pending. The check reads the transfer's own detail row for status `completed`; it claims the SKU, since completing moves stock another transfer task could need.

- **intent-complete-transfer-01** — TR-530 (14 × TOO-1093, BRM → QHV, pending in the seed) → completed
- **intent-complete-transfer-02** — TR-559 (10 × SEN-1052, BRM → VLM, pending in the seed) → completed
- **intent-complete-transfer-03** — TR-503 (1 × ADH-1014, QHV → VLM, pending in the seed) → completed
- **intent-complete-transfer-04** — TR-542 (11 × SEN-1060, OST → BRM, pending in the seed) → completed

### stock (json, warehouse) — 5 tasks

Total stock of one product across every depot — `stockOf(rows, sku)` (intent-stock-01's shape); `GET /api/v1/stock?sku=` reports the same `total`.

- **intent-stock-02** — ENC-1107 → 263
- **intent-stock-03** — CAB-1050 → 907
- **intent-stock-04** — TOO-1085 → 508
- **intent-stock-05** — FAS-1000 → 912
- **intent-stock-06** — SEN-1092 → 714

### depot-stock (json, warehouse) — 5 tasks

Stock of one product at ONE depot, for a product held at two or more depots — so the whole-company total is a wrong answer. `stockOf(rows, sku, depot)`.

- **intent-depot-stock-01** — ENC-1075 at OST → 113 (of 1170 in total)
- **intent-depot-stock-02** — OPT-1001 at BRM → 76 (of 429 in total)
- **intent-depot-stock-03** — OPT-1097 at OST → 371 (of 1311 in total)
- **intent-depot-stock-04** — FAS-1040 at QHV → 89 (of 484 in total)
- **intent-depot-stock-05** — FLU-1071 at VLM → 439 (of 628 in total)

### lowstock (json, warehouse) — 2 tasks

The low-stock SKU set at another threshold (intent-lowstock-01's shape) — `lowStock(rows, t)`, which counts a product with no stock rows as zero. A threshold is used only when its set has 1–20 SKUs.

- **intent-lowstock-02** — threshold 20 → ADH-1118,FAS-1048
- **intent-lowstock-03** — threshold 8 → ADH-1118,FAS-1048

### price (json, warehouse) — 5 tasks

The unit price of a product named by a name no other product carries (intent-price-01's shape): unitPriceCents / 100, ±0.005.

- **intent-price-02** — SEN-1036 "Nextru Renzy assembly" → 94
- **intent-price-03** — ADH-1110 "Lolo Vivi pack" → 23.5
- **intent-price-04** — FAS-1024 "Omquen Nextru kit" → 29
- **intent-price-05** — SEN-1100 "Martruom Vivi unit" → 129.5
- **intent-price-06** — ENC-1059 "Vizynex Renquen pack" → 148.25

### customer (json, warehouse) — 3 tasks

The one customer of a tier in a city (intent-customer-01's shape) — used only for a (tier, city) pair no other customer shares.

- **intent-customer-02** — platinum in Velmora → C-137
- **intent-customer-03** — standard in Velmora → C-107
- **intent-customer-04** — platinum in Karrow → C-115

### tier (json, warehouse) — 4 tasks

A customer's tier, asked by a name no other customer carries.

- **intent-tier-01** — Quenfalsil Industrial (C-124) → gold
- **intent-tier-02** — Omnex Supply (C-102) → gold
- **intent-tier-03** — Trulo Supply (C-132) → gold
- **intent-tier-04** — Kasilvi Systems (C-138) → gold

### open-orders (json, warehouse) — 4 tasks

How many open orders a customer has — `openOrdersFor(rows, code)`; asked only of customers with at least one.

- **intent-open-orders-01** — C-101 → 3
- **intent-open-orders-02** — C-110 → 3
- **intent-open-orders-03** — C-127 → 4
- **intent-open-orders-04** — C-115 → 2

### order-status (json, warehouse) — 4 tasks

An order's status (open, shipped or cancelled), from the seeded order row.

- **intent-order-status-01** — SO-20003 → shipped
- **intent-order-status-02** — SO-20040 → shipped
- **intent-order-status-03** — SO-20105 → shipped
- **intent-order-status-04** — SO-20167 → cancelled

### order-total (json, warehouse) — 4 tasks

An order's total value — `orderTotalCents(rows, orderNo)` / 100, ±0.005: every line's quantity × its product's unit price, for an order of two or more lines (the order detail's `totalCents`).

- **intent-order-total-01** — SO-20296 → 7093.5
- **intent-order-total-02** — SO-20102 → 8691.75
- **intent-order-total-03** — SO-20061 → 2794
- **intent-order-total-04** — SO-20156 → 16555.25

### order-line (json, warehouse) — 3 tasks

The quantity of one SKU on an order of two or more lines.

- **intent-order-line-01** — SO-20060 / ENC-1075 → 9
- **intent-order-line-02** — SO-20093 / FAS-1064 → 23
- **intent-order-line-03** — SO-20118 / CAB-1034 → 12

### transfer-destination (json, warehouse) — 3 tasks

Where a seeded transfer is headed — its destination depot code.

- **intent-transfer-destination-01** — TR-532 → VLM
- **intent-transfer-destination-02** — TR-556 → QHV
- **intent-transfer-destination-03** — TR-516 → BRM

### top-depot (json, warehouse) — 3 tasks

The depot holding the most units of a product held at two or more depots — used only when that maximum is unique.

- **intent-top-depot-01** — ENC-1035 → VLM (VLM 448, OST 304, QHV 417)
- **intent-top-depot-02** — FLU-1055 → QHV (OST 31, QHV 328, BRM 137)
- **intent-top-depot-03** — FAS-1080 → VLM (VLM 471, QHV 143)

### priciest (json, warehouse) — 3 tasks

The most expensive product in a category — used only when that maximum price is unique within it.

- **intent-priciest-01** — enclosures → ENC-1043 (186.25)
- **intent-priciest-02** — adhesives → ADH-1038 (224.25)
- **intent-priciest-03** — optics → OPT-1097 (216)

### depot-city (json, warehouse) — 2 tasks

The city a depot is in.

- **intent-depot-city-01** — QHV → Tessalind
- **intent-depot-city-02** — BRM → Tessalind

### ticket (state, helpdesk) — 4 tasks

Assign an open or pending ticket to an agent it is not already assigned to, and resolve it (intent-ticket-01's shape). Resolving requires an assignee, so the order of the two steps is part of the task.

- **intent-ticket-02** — HD-5081 (open, unassigned) → AG-16, resolved
- **intent-ticket-03** — HD-5041 (open, AG-17) → AG-11, resolved
- **intent-ticket-04** — HD-5040 (open, AG-11) → AG-13, resolved
- **intent-ticket-05** — HD-5015 (pending, AG-11) → AG-16, resolved

### priority (state, helpdesk) — 5 tasks

Change a ticket's priority to one it does not already have (a closed ticket refuses the change, so none is picked).

- **intent-priority-01** — HD-5144 normal → low
- **intent-priority-02** — HD-5089 normal → low
- **intent-priority-03** — HD-5129 high → urgent
- **intent-priority-04** — HD-5138 low → high
- **intent-priority-05** — HD-5072 high → low

### note (state, helpdesk) — 4 tasks

Add an INTERNAL note with an exact text. The check requires a comment on the ticket's detail row with that body (compared trimmed and case-insensitively) AND `internal: true` — a public reply with the same words fails.

- **intent-note-01** — HD-5074 ← internal "Escalated to logistics: the carrier has opened a damage claim."
- **intent-note-02** — HD-5021 ← internal "Customer confirmed the replacement shipped; monitoring until delivery."
- **intent-note-03** — HD-5053 ← internal "Escalated to logistics: the carrier has opened a damage claim."
- **intent-note-04** — HD-5028 ← internal "Escalated to logistics: the carrier has opened a damage claim."

### reply (state, helpdesk) — 3 tasks

Reply to the customer (a PUBLIC comment) with an exact text — the mirror of `note`: `internal: false` is part of the check.

- **intent-reply-01** — HD-5099 ← public "Our logistics team is looking into this and we will update you by tomorrow."
- **intent-reply-02** — HD-5087 ← public "We have issued a credit note for the damaged items; it will appear on your next statement."
- **intent-reply-03** — HD-5036 ← public "Thanks for reporting this. A replacement is on its way and should arrive within three business days."

### new-ticket (state, helpdesk) — 4 tasks

Open a ticket on a customer's behalf with a given subject and priority. The check lists the customer's tickets (filtered by requester — no ticket number to predict) and needs one with that subject and priority; the subject is one the customer has never reported.

- **intent-new-ticket-01** — C-136 → "Portal access for a new team member" (low)
- **intent-new-ticket-02** — C-122 → "Invoice shows the wrong billing address" (low)
- **intent-new-ticket-03** — C-124 → "Delivery window change for next week's order" (normal)
- **intent-new-ticket-04** — C-133 → "Portal access for a new team member" (normal)

### hold (state, helpdesk) — 3 tasks

Put an open ticket on hold: status open → pending.

- **intent-hold-01** — HD-5137 open → pending
- **intent-hold-02** — HD-5126 open → pending
- **intent-hold-03** — HD-5030 open → pending

### reopen (state, helpdesk) — 3 tasks

Reopen a resolved ticket: status resolved → open.

- **intent-reopen-01** — HD-5006 resolved → open
- **intent-reopen-02** — HD-5055 resolved → open
- **intent-reopen-03** — HD-5149 resolved → open

### close (state, helpdesk) — 3 tasks

Close a resolved ticket: status resolved → closed (final — nothing can change it afterwards).

- **intent-close-01** — HD-5100 resolved → closed
- **intent-close-02** — HD-5070 resolved → closed
- **intent-close-03** — HD-5140 resolved → closed

### reassign (state, helpdesk) — 3 tasks

Move an assigned, not-closed ticket to a different agent.

- **intent-reassign-01** — HD-5093 AG-16 → AG-12
- **intent-reassign-02** — HD-5082 AG-14 → AG-11
- **intent-reassign-03** — HD-5058 AG-14 → AG-12

### reporter (json, helpdesk) — 3 tasks

Which customer reported a ticket (intent-reporter-01's shape).

- **intent-reporter-02** — HD-5065 → C-124
- **intent-reporter-03** — HD-5085 → C-114
- **intent-reporter-04** — HD-5115 → C-132

### ticket-priority (json, helpdesk) — 3 tasks

A ticket's priority, from the seeded ticket row.

- **intent-ticket-priority-01** — HD-5128 → high
- **intent-ticket-priority-02** — HD-5136 → low
- **intent-ticket-priority-03** — HD-5019 → normal

### ticket-status (json, helpdesk) — 3 tasks

A ticket's status, from the seeded ticket row.

- **intent-ticket-status-01** — HD-5129 → open
- **intent-ticket-status-02** — HD-5091 → open
- **intent-ticket-status-03** — HD-5020 → open

### assignee (json, helpdesk) — 3 tasks

Which agent an assigned ticket belongs to.

- **intent-assignee-01** — HD-5025 → AG-14
- **intent-assignee-02** — HD-5069 → AG-16
- **intent-assignee-03** — HD-5063 → AG-15

### agent-team (json, helpdesk) — 3 tasks

The team an agent is on, asked by a name no other agent carries.

- **intent-agent-team-01** — Lior Kowalczyk (AG-11) → tier-2
- **intent-agent-team-02** — Danae Larrabee (AG-14) → tier-1
- **intent-agent-team-03** — Quill Ferrante (AG-12) → billing

### agent-load (json, helpdesk) — 3 tasks

How many open or pending tickets an agent holds — `openTicketsFor(rows, code)`.

- **intent-agent-load-01** — AG-11 → 10
- **intent-agent-load-02** — AG-12 → 5
- **intent-agent-load-03** — AG-10 → 6

### sla (json, helpdesk) — 2 tasks

The resolution target, in hours, of a ticket priority under the SLA policy.

- **intent-sla-01** — normal → 120 h
- **intent-sla-02** — high → 48 h

### comment-count (json, helpdesk) — 2 tasks

How many comments a ticket carries, internal notes included — asked of tickets with at least two.

- **intent-comment-count-01** — HD-5074 → 3
- **intent-comment-count-02** — HD-5029 → 4

### requester-tickets (json, helpdesk) — 2 tasks

How many tickets a customer has reported — asked of customers with at least two.

- **intent-requester-tickets-01** — C-107 → 3
- **intent-requester-tickets-02** — C-131 → 2

### doc (json, vaultdocs) — 4 tasks

The id of the one document a phrase finds (intent-doc-01's shape): the phrase is a document's own title, used only when `documentsMatching(rows, title)` returns that document alone. Datasheets are left to their own questions.

- **intent-doc-03** — "operations memo 7: loka checklist" → doc-135
- **intent-doc-04** — "operations memo 5: thoomka rollout" → doc-133
- **intent-doc-05** — "account review: viomlo supply" → doc-120
- **intent-doc-06** — "operations memo 2: rentruzy retrospective" → doc-130

### lead-time (json, vaultdocs) — 4 tasks

A product's standard supplier lead time, in business days, as its datasheet states it.

- **intent-lead-time-01** — doc-106 "Datasheet: Marquenba Silren assembly (OPT-1009)" → 11
- **intent-lead-time-02** — doc-116 "Datasheet: Visilfal Bazy unit (ENC-1099)" → 11
- **intent-lead-time-03** — doc-105 "Datasheet: Zyom Renom kit (FAS-1000)" → 2
- **intent-lead-time-04** — doc-111 "Datasheet: Lofalel Zynex assembly (ADH-1054)" → 6

### moq (json, vaultdocs) — 3 tasks

A product's minimum order quantity, as its datasheet states it.

- **intent-moq-01** — doc-114 "Datasheet: Zyloka Kafal pack (OPT-1081)" → 25
- **intent-moq-02** — doc-107 "Datasheet: Baelfal Marren pack (CAB-1018)" → 5
- **intent-moq-03** — doc-105 "Datasheet: Zyom Renom kit (FAS-1000)" → 5

### policy (json, vaultdocs) — 3 tasks

A number from a policy document: the return window, and the gold and platinum discounts.

- **intent-policy-01** — doc-102 "Customer tier discounts" → 5
- **intent-policy-02** — doc-102 "Customer tier discounts" → 9
- **intent-policy-03** — doc-101 "Returns and warranty policy" → 14

### dispatch (json, vaultdocs) — 2 tasks

Until what hour a depot dispatches, from the depot operating hours policy (each depot's own sentence).

- **intent-dispatch-01** — doc-104 "Depot operating hours" → 16
- **intent-dispatch-02** — doc-104 "Depot operating hours" → 19

### review (json, vaultdocs) — 2 tasks

When a customer's next account review is due, from the only account-review note about that customer.

- **intent-review-01** — doc-126 "Account review: Trumar Systems" → 3
- **intent-review-02** — doc-120 "Account review: Viomlo Supply" → 2

### results (json, vaultdocs) — 2 tasks

A figure from the FINAL FY2025 results summary — the vault also holds a superseded draft with near-miss numbers.

- **intent-results-01** — doc-117 "FY2025 results summary" → 614
- **intent-results-02** — doc-117 "FY2025 results summary" → 40126615

### company (json, data) — 5 tasks

A fact from the company's public website — its about page and FY2025 annual report — derived from the seed the site is built from (20260908), not the workspace's.

- **intent-company-01** — depots → 4
- **intent-company-02** — revenue → 38902497
- **intent-company-03** — employees → 856
- **intent-company-04** — headquarters → Velmora
- **intent-company-05** — founded → 1997
