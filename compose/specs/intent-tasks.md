# Intent corpus (task 11)

10 natural-language intent tasks against a fresh `acme-v1` workspace
(`node tools/intent-corpus.mjs --seed 4242`). Every derived value comes
from `@benchme/scenarios`' generator or `answers.ts` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs and `intent-tasks.json` together. All of them assume the SAME fresh
workspace (seed 4242); none of them create their own workspace.

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
