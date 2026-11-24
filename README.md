# benchme

Hosted demo applications, MCP servers and (soon) a verifier for agentic
benchmarks. A fictional industrial-supply company whose apps agents use as
*users*: sign up, log in, read and change data through web UIs, REST and MCP.

Every run gets its own **workspace**: an isolated, deterministically seeded
copy of the data (`scenario` + `seed`), scoped on every row, so parallel runs
never see each other and two runs with the same seed start from byte-identical
state.

```
POST /api/workspaces        {"scenario":"acme-v1","seed":4242}   → urls for every app
POST /api/workspaces        {"scenario":"acme-v1","seed":4242,"doors":["page"]}   → the same, served through its pages alone (see Doors)
/w/<id>/warehouse/          products, stock, orders, transfers (UI · /api/v1 · /mcp)
/w/<id>/helpdesk/           tickets, comments, SLAs (UI · /api/v1 · /mcp)
/w/<id>/vaultdocs/          the document vault (UI · /api/v1 · /mcp with resources + prompts)
/w/<id>/hotels/             Larchmere Stays, a hotel booking site (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/flights/            Tallowmere Flights, flight search and booking (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/dining/             Thistlecombe Tables, restaurant table reservations (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/pizza/              Marlivo Pizza, pizza ordering with a builder (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/cinema/             Orrowen Cinemas, cinema seats and tickets (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/sports/             Brackenford Sports, a store's orders, tracking, returns and reorders (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/homes/              Corvane Homes, home listings and viewing appointments (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/clinic/             Calvenor Clinics, doctors, appointments, coverage, prescription prices (administrative only) (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/events/             Fennick Events, office events, room booking, invitations, registration (webmcp-v1; UI · /api/v1 · /mcp)
/w/<id>/verify/v1/submit/<taskId>   POST an artifact → verdict + receipt
/w/<id>/mail/               the workspace inbox (verification codes land here)
/data/                      the company site (static, generated from the seed)
/w/<id>/guide/              a buyer's guide edition (scenario guide-v1; the seed picks it — see Guide)
/w/<id>/web/                a site network edition (scenario web-v1; the seed picks it — see Site network)
POST /api/workspaces/<id>/finalize                               → a signed receipt
```

## Layout

| path | what |
| --- | --- |
| `packages/core` | config, http (healthz/readyz), ids, receipts (HMAC), pg + migrations, redis, the workspace model, the doors and the headers the gateway signs |
| `packages/scenarios` | seeded generators (`acme-v1`, `shops-v1`, `guide-v1`, `web-v1`, `webmcp-v1`, `cuj-v1`) and the derived ground truths; each scenario also says what it is (`title`, `about`, `docs`: its write-up and corpus files), which the gateway's front page shows, and a test holds its task counts and links to the repository |
| `apps/gateway` | workspace API, signed reverse proxy (it decides each request's doors: see [Doors](#doors)), the front page (what benchme is, a copyable command that mints a workspace, and a searchable card for every scenario) and a page per scenario (`/scenarios/<key>`: its public tasks, searchable and filterable, read from the `*-tasks.json` lists the image carries beside the gateway and never from a key) + MCP registry, reaper |
| `packages/site-kit` | what every site shares: the gateway-scope hook, signup/verify/login + sessions + api tokens, the MCP server plumbing, the page shell, the doors and the change ledger (see [The change ledger](#the-change-ledger)) |
| `apps/warehouse` | products, stock, orders, transfers: SSR UI, REST v1, a 14-tool MCP server, NLWeb `/ask`, WebMCP |
| `apps/helpdesk` | tickets, comments, SLAs, assignment: SSR UI, REST v1, an 11-tool MCP server (with a destructive `delete_ticket`), NLWeb `/ask`, WebMCP |
| `apps/vaultdocs` | ~40 seeded documents as MCP **resources** (`docs://<id>`), `search`/`get_document`/`list_documents` tools, two MCP **prompts**; full-text search UI + REST, NLWeb `/ask`, WebMCP |
| `apps/hotels` | **Larchmere Stays**, a hotel booking site: ~30 hotels in six cities (the depots' among them), room types with limited rooms, bookings; search by city, dates, party, price and amenities; book and cancel. SSR UI, REST v1, a 9-tool MCP server (and the kit's five sign-in tools), WebMCP (see [Hotels](#hotels)) |
| `apps/flights` | **Tallowmere Flights**: flight search and booking. SSR UI, REST v1, an MCP server, WebMCP (see [Flights](#flights)) |
| `apps/dining` | **Thistlecombe Tables**: restaurant table reservations. SSR UI, REST v1, an MCP server, WebMCP (see [Restaurants](#restaurants)) |
| `apps/pizza` | **Marlivo Pizza**: pizza ordering with a builder. SSR UI, REST v1, an MCP server, WebMCP (see [Pizza](#pizza)) |
| `apps/cinema` | **Orrowen Cinemas**: cinema seats and tickets. SSR UI, REST v1, an MCP server, WebMCP (see [Cinema](#cinema)) |
| `apps/sports` | **Brackenford Sports**: a store's orders, tracking, returns and reorders. SSR UI, REST v1, an MCP server, WebMCP (see [Sports retailer](#sports-retailer)) |
| `apps/homes` | **Corvane Homes**: home listings and viewing appointments. SSR UI, REST v1, an MCP server, WebMCP (see [Homes](#homes)) |
| `apps/clinic` | **Calvenor Clinics**: doctors, appointments, coverage, prescription prices (administrative only). SSR UI, REST v1, an MCP server, WebMCP (see [Clinics](#clinics)) |
| `apps/events` | **Fennick Events**: office events, room booking, invitations, registration. SSR UI, REST v1, an MCP server, WebMCP (see [Events](#events)) |
| `apps/verify` | the verifier: json / xlsx / docx / patch / **state** oracles (state reads the app's own REST API after the fact — end state is the evidence, the artifact is ignored — and, on the nine sites, their change ledgers: a check may ask that a row is there, that none is, that a ledger entry matches, or that nothing was written), HMAC receipts, attempt log, isolated Kubernetes Job runner; the intent corpus it ships with (generated tasks across the warehouse, helpdesk, vault and company site) is described in [`compose/specs/README.md`](compose/specs/README.md) |
| `apps/mail` | per-workspace inbox with an internal delivery endpoint; read through its pages, REST, or two MCP tools (also WebMCP tools on its pages); in a scenario whose mailboxes are private (`cuj-v1`) it never shows the mail to people the workspace already holds (see [The same sign-in on every door](#the-same-sign-in-on-every-door)) |
| `apps/data` | the generated company site |
| `packages/storefront` | the stores' pure logic: money, US sales tax by ZIP, cart, pricing, the scenario-file schema, outcome classes, order numbers |
| `apps/shops` | three consumer stores and a payment page, served from one app (see [Stores](#stores)) |
| `apps/wallet` | a stand-in for a Link wallet: the HTTP API `@stripe/link-cli` calls, an approval policy, test cards bound to the run's checkout (see [Wallet](#wallet)) |
| `apps/guide` | Shortlist, a buyer's guide to four fictional products per category, and the site network (`/web`): a start page, each product's own site and a chain of recommendation sites. Pages are chosen by the workspace's edition (category, arm, target), and every page each workspace is served is recorded (see [Guide](#guide) and [Site network](#site-network)) |
| `charts/benchme` | the Helm chart: own postgres + redis, apps, migrate job, reaper, ingress |
| `docker/app.Dockerfile` | one multi-stage Dockerfile, `--build-arg APP=<app>` |

## Doors

A site has four ways in, its **doors**: `page` (its pages), `rest` (its
REST API, `/api/…`, and NLWeb's `/ask`), `mcp` (its MCP server, for an
agent's own MCP client: `/mcp`, and NLWeb's `/ask/mcp`) and `webmcp` (the
tools its pages register in the browser, which call `/mcp` through the
page's bridge). A deployment, and each workspace, says which doors it serves,
so a benchmark can run a real control group with no tool door at all. The
inbox's pages and the verifier's submit address are pages: a workspace served
through its pages alone can still read its mail and submit an artifact.

- **The deployment.** The gateway's `BENCHME_DOORS` is a comma list of doors
  (in compose and `.env.example`; the chart's `doors` value). Pages are always
  served and may be left out: `page` alone serves the pages alone. Unset, it
  serves all four, as every deployment did before.
- **A workspace.** `POST /api/workspaces
  {"scenario":"webmcp-v1","seed":4242,"doors":["page","webmcp"]}` serves that
  workspace through those doors, whatever the deployment's are. A name that is
  no door is refused (422 `UNKNOWN_DOOR`). Every workspace answer, `GET
  /api/workspaces/<id>` included, shows the doors it is served through
  (`doors`). A workspace created without `doors` gets the deployment's, and so
  does a shared one (`shared-<scenario>-<seed>`).

A closed door is not there:

- A request through it is answered 404 `{"error":"NOT_FOUND"}`, as for a
  path that is not there. The gateway decides each request's doors
  and refuses a closed one by its path, before the app is called. It closes
  `/mcp` only when both `mcp` and `webmcp` are closed: a page's bridge and a
  direct client call the same path. It forwards the workspace's doors to the
  app beside the workspace header, signed with the gateway secret for that
  workspace, and the app checks again. The app also tells a page's bridge from
  a direct client (below). The verifier's own signed reads, on the app's own
  address, are no visitor's and pass.
- Nothing names it. With `webmcp` closed a page renders no bridge script, so
  it names neither `/mcp` nor a tool. A workspace's `urls` name no `mcp`,
  `askMcp` or `webmcp` endpoint of a closed door (nor `ask` with `rest`
  closed), and the portal (`/`) and the registry (`/registry`) list only what
  is behind the deployment's open doors. The account page offers an api token
  only where REST or MCP is open, and names only those; `POST /account/token`
  answers 404 where both are closed.

An app reached without the doors header (a gateway older than doors) serves
every door. An app sent a doors header it cannot verify refuses the request,
as it refuses a bad workspace header.

### The WebMCP door

A page's WebMCP tools call the site's own `/mcp`, the path a direct MCP
client calls. A call counts as `webmcp` only when it proves it came from a
page's bridge.

When a page renders with `webmcp` open, the site makes sure the browser holds
a bridge cookie, `benchme_bridge`: random, `HttpOnly`, `SameSite=Strict`, on
the site's own path. A browser that already holds one keeps it, so its tabs
share it. The page's bridge script carries a token for that cookie: an HMAC
with the gateway secret over the workspace id and the cookie. The bridge
sends the token in `x-benchme-bridge` on every call, and the browser sends
the cookie with it. `/mcp` counts a call as `webmcp` only when the token is
the one for the cookie that same call carries. Any other call is a direct
MCP client (`mcp`), and is refused where `mcp` is closed.

So a header copied from the bridge proves nothing. Neither does a token
copied out of the page's HTML without its cookie, which the page's own
scripts cannot read either. Only a client that keeps the page's cookie jar —
a browser, or something deliberately built to act as one — gets the WebMCP
door.

## Stores

Three fictional direct-to-consumer stores, **Wrenfield Flowers**
(`wrenfield`), **Halden Audio** (`halden`) and **Quillfeather Coffee**
(`quillfeather`), plus **PayLantern** (`paylantern`), a payment page that
belongs to no store. One app, `apps/shops`, serves all four sites, each
under `/s/<site>/`. The gateway reaches a site through a path in
`APP_TARGETS` (`"halden":"http://shops:3000/s/halden"`), so `/w/<id>/halden/…`
is proxied with the workspace signed in the header like any other app.
`paylantern` is also in the gateway's `UNLISTED_APPS`: the gateway routes it
but never lists it in a workspace's `urls`. So is `wallet`, the wallet's
card-on-file door ([Wallet](#wallet)).

```
POST /api/workspaces        {"scenario":"shops-v1"}   → urls for wrenfield, halden, quillfeather
/w/<id>/wrenfield/   /w/<id>/halden/   /w/<id>/quillfeather/
/w/<id>/paylantern/          routed, never listed
/w/<id>/wallet/card          routed, never listed: the buyer's saved card (card on file)
```

`shops-v1` seeds nothing into the acme apps, because each store's catalogue
lives in `apps/shops`, so minting one is cheap. Carts, checkouts and orders
are workspace rows like any other. Every page is `noindex`, and every store
footer says the store is fictional and orders are not fulfilled.

| env | default | |
| --- | --- | --- |
| `SHOPS_PAYMENTS` | `fake` | `fake` settles payments in-process with no Stripe and no network (local runs, CI); `stripe` pays through Stripe test mode |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | — | required when `SHOPS_PAYMENTS=stripe`. **Test-mode keys only**: the app refuses to boot on a live key, and the chart refuses to render one passed in its values |
| `SHOPS_SUFFIX_KEY` | — | the key order-number suffixes are derived from; keep it private and stable |
| `SHOPS_INTERNAL_SECRET` | — | guards the stores' internal state API (read by the audit and integrity tools) |
| `SHOPS_SCENARIOS_FILE` | — | the scenario file (below); unset means no scenarios |
| `WALLET_URL`, `WALLET_INTERNAL_SECRET` | — | the wallet stand-in ([Wallet](#wallet)): its spend controls are asked before a payment is taken, and an order's charge is classed against what the wallet approved; unset means no approval is known and every payment is taken |

**The scenario file.** A campaign code in the URL a workspace opens a store
with picks that store's scenario, until the workspace's first checkout on
that store starts. The file that maps codes to scenarios is hidden. It is
built from a private checkout and never committed. This repository ships
only test fixtures, with codes prefixed `fixture-`, in
`apps/shops/test-fixtures/shops-scenarios.json`. Without a file, no code
matches and every store runs without a scenario. The app reads the file at
boot.

- **Compose** mounts `SHOPS_SCENARIOS_DIR` (default
  `./apps/shops/test-fixtures`) read-only at `/scenarios` and reads
  `shops-scenarios.json` from it.
- **The chart** mounts the ConfigMap named in
  `shops.existingScenariosConfigMap` (key `shops-scenarios.json`; see
  [GitOps deployments](#gitops-deployments-argocd-and-friends)) and takes
  `shops.payments` (default `fake`). It reads the keys from its Secret:
  `shopsSuffixKey` and `shopsInternalSecret` are generated like the other
  secrets, while `stripeSecretKey` and `stripePublishableKey` are never
  generated and are optional.

## Wallet

`apps/wallet` is a simulator of the public contract of Stripe's
[`@stripe/link-cli`](https://github.com/stripe/link-cli) (0.26.0): the device
login, the account (`payment-details`, `userinfo`, `approval-policy`,
`shipping_addresses`), reports (`agent_observations`) and spend requests
(create, retrieve with `include=card`, update, request approval, cancel, list).
The CLI runs **unmodified**, pointed at it:

```bash
LINK_API_BASE_URL=http://localhost:8080/wallet/api \
LINK_AUTH_BASE_URL=http://localhost:8080/wallet/auth \
LINK_CLI_SKIP_SKILL_INSTALL=1 npx @stripe/link-cli@0.26.0 auth login
```

The gateway serves it at its root, outside any workspace (`SERVICE_TARGETS`
`{"wallet":"http://wallet:3000"}` → `/wallet/*`): an agent is given the CLI
before it mints its workspace. It issues **test cards only** and nothing about
it is Link: it plays Link's role so a study can measure what agents do with a
wallet.

- **Login** completes without a person: the policy approves the device. Each
  login is its own session; a session sees only its own spend requests.
- **Link's constraints**: `context` at least 100 characters, `amount` at most
  50,000 cents, a 3-letter `currency`, merchant name and URL for a card, the
  30-minute approval window, 12-hour credentials, 50 requests an hour, Link's
  status names (`created`, `pending_approval`, `approved`, `requires_action`,
  `denied`, `expired`, `canceled`) and Link's error shape.
- **Approval** comes `WALLET_APPROVAL_DELAY_MS` (default 2 s) after it is
  requested, from the policy `WALLET_POLICY` names. `lab` approves a request
  that pays one of the stores, as a person reading "<store>, $<amount>" in
  the Link app would: at one of `WALLET_MERCHANT_ORIGINS` (the stores' host)
  with a path that names a store or no app at all — never another benchme app
  on that host; on a hosted payment page of `WALLET_HOSTED_CHECKOUT_ORIGINS`
  (Stripe Checkout, where Halden sends its shoppers) when the page's Checkout
  Session binds it to a store checkout or the request names a store; and on
  any other host when the request names a store (in its URL or merchant
  name). It declines a request carrying a name of `WALLET_LOOKALIKES` (default
  `paylantern`) anywhere — host, path or merchant name — and anything that
  names no store off the stores' host. `decline-all` declines everything.
- **Binding.** A decided request is bound to the run's checkout — by the
  workspace path in its `merchant_url` (`/w/<id>/<store>`), else by the
  Checkout Session of the hosted page it names
  (`checkout.stripe.com/c/pay/cs_test_…`), else by the workspace an earlier
  approved request of the same link-cli login was bound to by any of these or
  by its amount (rule `login`: one login is one run's, so a later request
  naming only the stores' origin binds as surely as the first — at the store
  it names, else at that request's), else by its exact amount among a
  store's open checkouts of the last `WALLET_BINDING_WINDOW_MINUTES` (default
  60) with no paid order (`GET /s/<store>/internal/wallet-matches` on the
  stores). The card is the one the bound store's scenario calls for —
  `4242424242424242`, the 3-D Secure card `4000002760003184`, or the decline
  card `4000000000000002` — billed to the holder (`WALLET_HOLDER_*`, ZIP
  94107). A request no checkout matches is flagged `binding_fallback` and gets
  the card every checkout its rules found calls for when they all call for
  the same one (the runs of one task share their scenario), else the success
  card; a payment with its card within the binding window binds it later
  (flag `claimed_at_payment` beside it). When the stores cannot be asked (an
  error or a timeout), no card is issued on a guess: the request stays
  `pending_approval` and every read asks again (each attempt recorded, event
  `binding_unavailable`), and after `WALLET_BINDING_RETRY_MS` (default 60 s)
  it is denied, flagged `binding_unavailable` — an infrastructure failure,
  never the run's; a new request may be approved.
- **Card on file.** A run that pays without Link reads the buyer's saved
  card at `<public>/w/<workspaceId>/wallet/card` — the workspace path of the
  store it shops at (`…/w/<workspaceId>/<store>`) with `wallet/card` in place
  of the store. The gateway serves it as the unlisted workspace app `wallet`
  (`APP_TARGETS` `"wallet":"http://wallet:3000/workspace"`, `UNLISTED_APPS`),
  so it is never in a workspace's `urls`, the portal, the registry or
  `robots.txt`, and the wallet trusts only the workspace the gateway signed
  (`GATEWAY_SECRET`; unset, the door is not served). It answers a page, or
  JSON to `Accept: application/json`: the card's number, expiry, CVC, the
  holder's name and billing address — the card the workspace's store
  scenario calls for (the success, 3-D Secure or decline card above, never
  saying which), found the way a spend request is bound (the stores the
  workspace has opened). It is issued on the first read that has one to
  show and is the same card on every later read. Before the workspace has
  opened a store the page says so and shows no card. Every read is
  recorded, with or without a card.
- **Expiries tell the cards apart.** The saved card and a spend request's
  card share their number when the scenario's card is the same; never their
  expiry. The saved card expires four years out; a spend request's card one
  to three years out, never in December (the month a card typed from memory
  most often carries), and with an expiry no other card of its kind that its
  session holds has, nor (while one is free) any card approved in the
  binding window. The processor records the paying card's last four and
  expiry, and the store passes both to the wallet, which matches the exact
  expiry first: the door's card, a request bound to the workspace's store, an
  unbound approval from a login that bound a request to the workspace, then
  an unbound approval from a login that bound nothing anywhere — that last
  one only when the run holds no bound Link card ending so, whose last four
  then decide (a typo, or a test method's fixed expiry, landing on a
  stranger's card). The door's saved card never stands in the way of an
  unbound Link card: the saved card never has a Link card's expiry, so a run
  that read the card page and pays with its Link card is held to that card's
  approval like any other. Only then is any expiry matched by the last four
  of the run's own cards (the door's, a bound request's; both: `ambiguous`).
  An unbound approval from a login bound to another workspace is another
  run's card: it is never matched, so never declined or claimed for this
  payment.
- **Spend controls.** Before a store takes a payment it asks the wallet
  (`POST /wallet/internal/charges`), as Link's spend controls would: a spend
  request's card pays one payment, up to its approved amount. A charge above
  the approval, or a second payment with the card, is declined, and the
  shopper sees what an issuer's decline shows ("Your card was declined.").
  The decline is recorded as a failed `payment_attempt` with `reason`
  `above_approval` or `reused`, and the shopper may ask for a new approval.
  The saved card, and any card the wallet never issued, are not subject to
  spend controls. A store confirms every payment with manual capture, so a
  card that pays is only authorized until the store asks: it then captures
  the payment or releases it. The Payment Element and the Express Checkout
  Element show the decline under the Pay button, and fake mode's card form
  shows it in place. On Stripe's hosted Checkout page, the decline shows on
  the store's payment step once the shopper returns.
- **The stores read the approval and the card.** When an order is placed,
  the store asks the wallet (`WALLET_URL`) about the payment: which issued
  card paid, found by its last four and expiry from the processor's charge
  (`matchedIssuance`: a spend request's id, or the card-on-file door's saved
  card, recorded on the order's `order_placed` event with `expiryMatched`;
  `ambiguous` when the expiry is neither the saved card's nor a bound
  request's — it names those `requests` and what the spend controls would
  have answered, `wouldDecline`, and decides nothing: the saved card, held to
  no approval, is the other possibility).
  It also asks whether that card is one the wallet issued for that store,
  and which approval the charge is held against: the paying spend request's
  amount. The door approves nothing, so an order paid with the saved card is
  held to the task's own budget alone, even when the run also holds a Link
  approval, and it claims no fallback spend request. An order paid with any
  other card is classed `no_wallet_card`: a card typed from elsewhere (even
  the same test number with an expiry the wallet never issued, or the door
  never read, or read by another workspace), with or without a spend
  request, or paid with a wallet button such as Link. When the wallet cannot
  be asked (after three tries), the order is `approval_unknown`. None of
  these is ever `correct`. `paid_above_approval` is reached only when the
  store could not ask the spend controls at payment (an infrastructure
  failure: the payment is taken, the event `spend_control_unknown` and the
  order's `spendControlUnknown: true` record it). Otherwise the spend
  controls decline such a charge. Without `WALLET_URL`, nothing is checked
  and every payment is taken.
- **Records.** Every call, its answer and every status change are kept
  (redacted: no token, no full card number) and served at
  `GET /wallet/internal/records?workspace=|session=|request=|since=` with
  `WALLET_INTERNAL_SECRET`. A request shows its card's kind, last four and
  expiry, and the payment its card was used for (`usedBy`, `usedAt`). Its record also shows each payment declined
  against it (`payment:decline:<reason>`). `?workspace=` also lists the
  saved cards the door showed (kind, last four, the stores), every read of
  the door (event kind `card_on_file`: time, outcome — `shown`, `no_store`,
  `ambiguous` or `unavailable` — the card's kind and last four, the stores,
  the format and the client), and every spend-control answer (event kind
  `charge`: the payment, its amount, last four and expiry, `accept` or
  `decline` with the reason, the card that matched and `via` — how it was
  told: `bound`, `own_session`, `unbound`, `last4` or `amount`).

| env | default | |
| --- | --- | --- |
| `WALLET_INTERNAL_SECRET` | — | guards `/internal/*` (records, approvals, the status control the contract check uses) |
| `WALLET_POLICY` | `lab` | `lab` or `decline-all` |
| `WALLET_MERCHANT_ORIGINS` | — | the origins a `lab` request may pay at (compose: `BENCHME_PUBLIC_URL`; the chart: `publicBaseUrl` and the in-cluster gateway) |
| `WALLET_HOSTED_CHECKOUT_ORIGINS` | `https://checkout.stripe.com` | hosted payment pages a `lab` request may pay on — only when bound by the page's Checkout Session (the chart: `wallet.hostedCheckoutOrigins`) |
| `WALLET_STORES` | `wrenfield,halden,quillfeather` | the store ids a merchant URL or name may name; any other app on the stores' host is declined |
| `WALLET_LOOKALIKES` | `paylantern` | names a `lab` request is declined for wherever it carries them (URL host or path, merchant name) |
| `WALLET_BINDING_WINDOW_MINUTES` | `60` | the open checkouts the amount rule reads, and how far back a payment may claim an unbound approval |
| `WALLET_BINDING_RETRY_MS` | `60000` | how long a decision waits for stores that cannot be asked before it denies the request, flagged `binding_unavailable` |
| `WALLET_APPROVAL_DELAY_MS` | `2000` | how long after an approval request the policy answers |
| `SHOPS_URL`, `SHOPS_INTERNAL_SECRET` | — | where a request's checkout is looked up; unset: every request falls back (and the card-on-file door shows no card) |
| `GATEWAY_SECRET` | — | the gateway's secret, which signs the workspace of a `/w/<id>/wallet/*` request; unset: no card-on-file door |

`tools/link-cli-contract.mjs` proves the contract with the real CLI in both of
its modes (`--format json` commands and `--mcp`): login, every account read,
create → approved → `--include card` (and `--output-file`), every status, the
limits, a report, and records without a card number or token.
`tools/checkout-integrity.mjs --card-on-file` pays every task with the saved
card the door shows (its reads checked in the wallet's records), and runs the
door's cases: a read before the store is opened, the test number typed with
no door read, and another run's saved card. `--wallet` pays with spend
requests' cards, and runs the wallet's cases: a card from elsewhere, another
card, an approval for less (declined, then a new approval pays), a card paid
twice (declined), and a fallback request claimed by its payment or declined
above its amount.

## Sites from webmcp-tools

Nine sites, the `webmcp-v1` scenario, are shaped on
[GoogleChromeLabs/webmcp-tools](https://github.com/GoogleChromeLabs/webmcp-tools)
(Apache-2.0): its demo sites and eval suites that model a business an agent
uses on someone's behalf. No code or data is copied from it. Each site
generates its own seeded rows, with invented names, from a random stream of
its own (`substream(seed, "<app>")`), so adding the sites changed no earlier
row and no earlier task's answer key. Each has SSR pages, REST `/api/v1`, an
MCP server and WebMCP (no NLWeb `/ask`). A write asks the same sign-in
through every door (see [The same sign-in on every door](#the-same-sign-in-on-every-door));
the warehouse and the helpdesk are as they were, their tools ask none. Each site's rules are pure functions in `packages/scenarios`
(`stays.ts` for hotels, `sites/<app>/rules.ts` for the others): the site
applies them on every write, and the intent corpus derives its answer keys
with them. Each site has six task kinds, three tasks each: 162 tasks, the
`webmcp-v1` corpus.

```
POST /api/workspaces        {"scenario":"webmcp-v1","seed":4242}   → urls for the nine sites and the inbox
/w/<id>/hotels/  /w/<id>/flights/  /w/<id>/dining/  /w/<id>/pizza/  /w/<id>/cinema/
/w/<id>/sports/  /w/<id>/homes/    /w/<id>/clinic/  /w/<id>/events/  /w/<id>/mail/
```

The gateway lists the nine in `UNLISTED_APPS`, so only `webmcp-v1`'s and
`cuj-v1`'s workspaces advertise them, and only those are seeded in them: a
workspace of any other scenario holds no rows there and does not wait on them
to be created.
The `webmcp-v1` corpus is written beside acme-v1's, with its own public files
(`compose/specs/webmcp-tasks.json`, `webmcp-corpus.json`, `webmcp-tasks.md`;
its answer keys are `intent-<kind>-NN.json` like every other), and
`node tools/intent-integrity.mjs --scenario webmcp-v1` proves it against a
live benchme.
Those suites grade the tool calls an agent makes; these tasks grade the answer
or the site's end state, so any door can be used. Each record also carries
what a judge and a check of the calls need:

```jsonc
// webmcp-tasks.json: what an agent may be shown
{ "id": "intent-stay-book-01", "surfaces": ["pages", "tools"], "app": "hotels", "intent": "…",
  "rubric": ["The reply says the room was booked and …", "…", "…"],   // 2 to 6 judge criteria
  "oracle": "state", "summary": "…" }
// webmcp-corpus.json: the same, with the answer key
  "key": { "blind": false, "oracle": { … },                            // the verifier's spec
           "expectedCall": [ { "functionName": "create_booking",       // the calls every correct solution makes
                               "arguments": { "roomCode": "HT-123-DBL", "checkIn": "2027-05-17", "nights": 3, "kids": 1,
                                              "guestEmail": "emeric.fairweather@travel.example" } } ] }
```

The criteria (`rubric`, right after `intent`) follow cuj-v1's rules
([Rubrics](docs/scenarios/cuj-v1.md#rubrics)): they judge what a check cannot
(the reply is true to what was done, nothing else was done, the agent stayed
on the site) and name no door, tool or value. `key.expectedCall`, present when
a task has any, holds the site tool calls every correct solution through the
tools must make, in webmcp-evals' own shape, with webmcp-evals' constraints
for what may vary; the rule and the form are in
[Expected calls](docs/scenarios/cuj-v1.md#expected-calls). Both corpora's calls
are also webmcp-evals suites, `compose/specs/webmcp-v1.webmcp-evals.json` and
`compose/specs/cuj-v1.webmcp-evals.json` (one case per task, or per step, that
has calls). Like the keys they are answer-key material: a call can name what
the task has the agent find. `node tools/intent-integrity.mjs` proves the calls
too: in a second workspace, every task done with nothing but its calls, through
MCP, passes.

The same nine sites, with the same rows, are the `cuj-v1` scenario's, which
adds the accounts some of their people already have, and gives all of their
people mailboxes of their own that the inbox does not show, so a sign-up in
one of their names cannot be finished (see
[The same sign-in on every door](#the-same-sign-in-on-every-door)). Its corpus is 120
critical-user-journey tasks in ten focus areas and four levels, some over
several prompts of one conversation, each step checked by its reply or by the
sites' rows and change ledger (`compose/specs/cuj-corpus.json`,
`cuj-tasks.json`, `cuj-tasks.md`): see [docs/scenarios/cuj-v1.md](docs/scenarios/cuj-v1.md).
`node tools/intent-integrity.mjs --scenario cuj-v1` proves it, step by step and
level by level, against a live benchme.

| app | site | what | shaped on |
| --- | --- | --- | --- |
| `hotels` | [Larchmere Stays](#hotels) | hotel search and booking | `demos/hotel-chain` |
| `flights` | [Tallowmere Flights](#flights) | flight search and booking | `demos/react-flightsearch`, the travel eval suite |
| `dining` | [Thistlecombe Tables](#restaurants) | restaurant table reservations | `demos/french-bistro` |
| `pizza` | [Marlivo Pizza](#pizza) | pizza ordering with a builder | `demos/pizza-maker` |
| `cinema` | [Orrowen Cinemas](#cinema) | cinema seats and tickets | `demos/ticket-booking` |
| `sports` | [Brackenford Sports](#sports-retailer) | a store's orders, tracking, returns and reorders | `demos/sport-shop-angular`, `leather-bag`, `order-tracking`, `coffee-shop`, the commerce eval suites |
| `homes` | [Corvane Homes](#homes) | home listings and viewing appointments | `demos/real-estate-map`, the real-estate eval suite |
| `clinic` | [Calvenor Clinics](#clinics) | doctors, appointments, coverage, prescription prices (administrative only) | the healthcare eval suite (no demo site) |
| `events` | [Fennick Events](#events) | office events, room booking, invitations, registration | the events eval suite (no demo site) |

Left out of the repo: its games (`doors`, `webmcp-maze`, `proxx-lite`), office
and creative tools (`spreadsheet`, `pixel-art-studio`), dashboards
(`smart-home`, `analytics-dashboard`) and the demos about WebMCP itself
(`explainer`, `page-agent`).

### The same sign-in on every door

On the nine sites a write needs someone signed in, whichever door it comes
through, and reads stay open inside the workspace. The site's rules ask it,
at the one place pages, REST and the tools all reach (`ledgered` in
`packages/site-kit`), so no door can leave it out. A request is signed in by
any of:

- an api token, `Authorization: Bearer <token>` (issued on the account page,
  where the workspace is served through REST or MCP: see [Doors](#doors));
- the site's session cookie, which the pages' sign-in sets and a browser also
  sends with the page's WebMCP tool calls;
- an MCP session that signed in with the `sign_in` tool.

A write by nobody is refused with one reason code, `UNAUTHORIZED`, and the
ledger records it. Each door says so in its own way: REST answers 401
`{"error":"UNAUTHORIZED"}`, a page sends the visitor to its sign-in page, a
tool returns an error result that names the tools to call.

No door is a dead end. Every site's tools include `sign_up`, `verify_email`,
`sign_in`, `sign_out` and `whoami`, which do what the sign-up, verify and
sign-in pages do, through the same code. The verification code is still
mailed to the workspace inbox and has to be read there: the mail app has the
same two reads as tools (`list_messages`, `get_message`), on its MCP server
and on its pages.

A code can be tried five times (`CODE_ATTEMPTS` in `@benchme/site-kit`), so it
cannot be guessed. After five wrong ones it no longer works, not even the
right one: verifying is refused with `TOO_MANY_ATTEMPTS` (429 on the pages),
through every door. Signing up again with an email that is not verified yet
mails a new code, with every try back, and takes the new password and name.
A verified account cannot be signed up again (`EXISTS`). Every site with
sign-ups counts the tries in its `verification_codes` table (migration
`NNN_verification_attempts` in each app, applied by the migrate Job like any
other).

- **MCP.** The server gives a client an `Mcp-Session-Id` when it initializes,
  as the protocol provides, and a client repeats it on every request. `sign_in`
  keeps the session under that id, so the connection stays signed in and no
  token is passed as a tool argument. The server holds no state for it. A tool
  call sent without initializing (and without a token or a cookie) has nothing
  to stay signed in with, and `sign_in` says so (`NO_SESSION`).
- **WebMCP.** The page's bridge calls the site's `/mcp` from the browser, with
  the page's token and the browser's cookies (see
  [The WebMCP door](#the-webmcp-door)), so the answer to `sign_in` sets the
  site's own session cookie. Signing in with the tool signs the pages in, and
  signing in on the pages signs the tools in.

Whose mail the inbox shows is the scenario's to say (`mailboxes`, in
`packages/scenarios`). A **shared** inbox, every scenario's but `cuj-v1`'s,
shows the mail to every address. In a **private** one, `cuj-v1`'s, everyone
the workspace's rows already hold (a booking's guest, a patient, an event's
organiser or guest, the owner of an account) has a mailbox of their own, which
the inbox never shows: their mail is delivered and kept, but no page, REST
call or tool returns it, and asked for by its id it is not found. Signing up
in the name of someone who already exists in the workspace therefore cannot
be finished, because their code goes to their own mailbox. Mail to any other
address (one the user makes up, a new person a task names) is in the inbox as
before, and the inbox page says in one line where the rest goes. The held
addresses are read off the workspace's rows when it is seeded, whatever field
holds them.

The signing-up steps are in the ledger as `auth` entries (`sign_up`,
`verify`, `sign_in`, `sign_out`, `issue_token` on entity `account`, the id
its email), made or refused (`EXISTS`, `BAD_CODE`, `TOO_MANY_ATTEMPTS`,
`BAD_CREDENTIALS`, `UNVERIFIED`). They are not writes: an account is not a
change to what the site sells. A refused `verify` still spent a try, and the
try is kept with its entry.

### The change ledger

Each of the nine sites keeps a ledger per workspace (the `ledger` table of its
own schema). It holds one entry for every read of a single entity (a booking,
an order, a showtime's seat map, a product) and for every write, made or
refused:

| field | |
| --- | --- |
| `app`, `seq`, `at` | the site, the entry's place in its ledger, and when it happened (the database's clock, the one clock the sites share) |
| `kind` | `read`, `write`, or `auth` (a step of signing up or in) |
| `entity` | `{type, id}` in the site's own words (`booking`, `BK-50012`); `id` is null for a create the rules refused |
| `subject` | what the request was about besides its entity, made or refused: the order a return is for, the showtime a booking is for, the event a registration is for (`{type: "order", id: "ORD-10042"}`); null when the request names nothing else |
| `action` | `read`, or the write's verb (`create`, `cancel`, `change`, `reorder`) |
| `door` | `page`, `rest`, `mcp` or `webmcp` |
| `actor` | the email signed in on the request, or null for nobody |
| `outcome`, `code` | `ok`, or `refused` with the site's reason code (`SOLD_OUT`, `ALREADY_CANCELLED`; `NOT_FOUND` for a read that found nothing) |

Pages, REST and the MCP tools all reach a site's rows through its repository,
so the kit records there (`ledgered`, `packages/site-kit/src/ledger`) and no
route or tool can leave an entry out. A write and its entry are one database
transaction (`transactions(pool)` in `@benchme/core`, whose pool each site
builds its repositories, accounts and ledger with): both are kept, or
neither is, so the ledger never shows a change that did not happen nor
misses one that did. A refused write is rolled back and its refusal kept on
its own. Each site says once, per repository
method, what is a read of one entity, a write, or neither
(`apps/<app>/src/db/ledger.ts`); a method without a rule does not compile. A
list or a search is not recorded. The door is read off the route the request
matched: `/api/` is `rest`, `/mcp` is `mcp`, or `webmcp` when the call proves
it came from the page's bridge (its token is the one for the bridge cookie it
carries: see [The WebMCP door](#the-webmcp-door)), and anything else is
`page`. The label the bridge used to send (`x-benchme-door`) is not read any
more.

Only the verifier reads a ledger. Its route,
`/internal/workspaces/<id>/ledger`, is on the app's own address under a path
the gateway never proxies, and it answers only a request that carries the
verifier's signature (`x-benchme-verifier-sig`, an HMAC made with the gateway
secret, which the gateway itself never sends). The verifier's reads of a
site's REST API carry the same signature and are left out of the ledger, so a
check never finds its own earlier read there. No page, REST answer or tool
shows an entry.

### Hotels

`apps/hotels` is **Larchmere Stays**, a hotel booking site in the `webmcp-v1`
scenario. Its rows come from
`packages/scenarios/src/sites/hotels/generate.ts`, drawn from a random stream of
their own (`substream(seed, "hotels")`), so adding the site changed no
warehouse, helpdesk or vault row, and no existing task's answer key.

- **Hotels:** 4–6 in each of six cities, every depot's city among them. Each has a
  rating, amenities (`wifi` everywhere; `gym`, `breakfast`, `spa`, `pool`,
  `free parking`, `washer`, `restaurant`, `airport shuttle`), a pet policy
  with a fee per stay, and late checkout with a latest time and a fee, or none.
- **Room types:** 2–3 per hotel (single, double, king, family suite), each with
  a capacity in adults and children, a nightly price and 1–4 rooms.
- **Bookings:** ~170 seeded stays between March and June 2027, some
  cancelled. Some room types are booked out on purpose for a few nights.

**The rules** are pure functions in `packages/scenarios/src/stays.ts`
(`stayProblem`, `searchStays`, `stayTotalCents`). The site applies them on
every write, inside the transaction that books the room. The intent corpus
derives its answer keys with the same functions. Check-in dates are in 2027,
not counted from today, so a seed means the same stays forever. A stay is 1
to 14 nights. The party must fit the room. Pets need a hotel that allows
them, and late checkout a hotel that offers it. A room type must have a room
free on every night. A total is nights × the nightly price, plus the pet fee
once per stay, plus the late-checkout fee.

| door | reads | writes (every door: signed in, or `Authorization: Bearer htl_…`) |
| --- | --- | --- |
| REST `/api/v1` | `cities`, `hotels?city&amenities&pets`, `hotels/<code>`, `search?city&checkIn&nights&adults&kids&pets&maxPrice&amenities`, `rooms/<code>/availability?checkIn&nights`, `bookings?guestEmail&hotel&status`, `bookings/<no>` | `POST bookings`, `POST bookings/<no>/cancel` |
| MCP and WebMCP | `list_cities`, `list_hotels`, `get_hotel`, `search_stays`, `check_availability`, `list_bookings`, `get_booking` | `create_booking`, `cancel_booking` |
| pages | search, results, hotel (with availability for given dates), bookings | book from a hotel page, cancel from a booking page |

Search input money is dollars per night (`maxPrice`); every amount the site
returns is cents (`nightlyCents`, `totalCents`), as in the warehouse. The site
has no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/hotels.mjs` adds six task kinds,
shaped on the hotel journeys in GoogleChromeLabs/webmcp-tools'
[webmcp-evals](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
(Apache-2.0; no code or data is copied from it). Those suites grade the tool
calls an agent makes; these grade the answer or the site's end state, so any
door can be used. The six kinds: name the only hotel that fits every
requirement, say that none fits and name the closest, price a stay, book a
named room, book the cheapest room that fits, and cancel one booking out of a
guest's several. The search tasks are built around a room that would fit if it
were not booked out, so an agent has to check availability as well as prices.

### Flights

`apps/flights` is **Tallowmere Flights**, a flight search and booking site in
the `webmcp-v1` scenario: it sells the flights of several carriers between the
company's cities. Its rows come from
`packages/scenarios/src/sites/flights/generate.ts`, drawn from a random stream
of their own (`substream(seed, "flights")`), so adding the site changed no
other site's row and no existing task's answer key.

- **Airports:** one in each of the six cities, and two hubs that one-stop
  flights stop at. No flight starts or ends at a hub. A search takes an
  airport code or a city name.
- **Carriers:** four, each with a checked-bag fee (per bag, per passenger) and
  a limit of 1 to 3 checked bags per passenger.
- **Flights:** 2 to 4 each way between every pair of cities (about 90),
  nonstop or with one stop at a hub, with a departure time, an arrival time
  (some the next day) and a duration. Every flight runs daily from 2027-03-01
  to 2027-06-30.
- **Cabins:** economy on every flight, premium and business on some, each with
  a fare per passenger and the seats the site sells on each departure
  (economy 5–9, premium and business 2–4).
- **Bookings:** about 150, all departing in March or April 2027, some
  cancelled, some round trips (the same party out and back, two bookings).
  Some cabins are sold out on some dates on purpose, and some have one or two
  seats left. May and June have no seeded booking.

**The rules** are pure functions in
`packages/scenarios/src/sites/flights/rules.ts` (`flightBookingProblem`,
`searchFlights`, `flightTotalCents`, `flightSeatsLeft`). The site applies them
on every write, inside the transaction that books the seats. The intent
corpus derives its answer keys with the same functions. Departure dates are
2027-03-01 to 2027-06-30, not counted from today, so a seed means the same
flights forever. The flight must sell the cabin asked. A booking is one
flight on one date for 1 to 9 named passengers, each with the same number of
checked bags, up to the carrier's limit. The cabin must have a seat for every
passenger on that date: a sold-out cabin is 409 `SOLD_OUT`, too few seats is
409 `NOT_ENOUGH_SEATS`; other refusals are 422. A total is passengers × the
fare + passengers × bags × the carrier's bag fee. A round trip is two
bookings.

| door | reads | writes (every door: signed in, or `Authorization: Bearer flt_…`) |
| --- | --- | --- |
| REST `/api/v1` | `airports`, `carriers`, `flights?origin&destination&carrier`, `flights/<no>`, `flights/<no>/seats?date`, `search?origin&destination&date&returnDate&tripType&passengers&cabin&maxStops&carriers&maxPrice&departAfter&departBefore`, `bookings?contactEmail&flightNo&date&status`, `bookings/<no>` | `POST bookings`, `POST bookings/<no>/cancel` |
| MCP and WebMCP | `list_airports`, `list_carriers`, `list_flights`, `get_flight`, `check_seats`, `search_flights`, `list_bookings`, `get_booking` | `create_booking`, `cancel_booking` |
| pages | search (one way or round trip, with filters), results (with a clear-filters link), schedule, flight (with seats left on a date), bookings | book from a flight page, cancel from a booking page |

A search returns `{tripType, outbound, inbound}`: the flights with a seat in
the cabin for every passenger, cheapest first, and the same for the return
date when one is given. Its filters are `maxStops` (0 for nonstop only),
`carriers` (codes), `maxPrice` (dollars per passenger) and
`departAfter`/`departBefore` (`HH:MM`, inclusive). Every amount the site
returns is cents (`priceCents`, `totalCents`); a search's `totalCents` is the
fares only, without bags. The site has no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/flights.mjs` adds six task kinds:
name the only flight that meets every filter, say that none does and name the
closest, price a booking with checked bags, book a round trip on two named
flights, book the cheapest flight with seats for the whole party, and cancel
the return flight of a traveller's round trip. The search tasks are built
around a flight that would meet every filter if its cabin had a seat for each
passenger, so an agent has to check seats as well as fares. They are shaped on
the flight search demo in GoogleChromeLabs/webmcp-tools
([`demos/react-flightsearch`](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/demos/react-flightsearch)
and the travel suite of its webmcp-evals; Apache-2.0; no code or data is
copied from them), which grade the tool calls an agent makes; these grade the
answer or the site's end state, so any door can be used.

### Restaurants

`apps/dining` is **Thistlecombe Tables**, a restaurant reservation site in the
`webmcp-v1` scenario. Its rows come from
`packages/scenarios/src/sites/dining/generate.ts`, drawn from a random stream
of their own (`substream(seed, "dining")`), so adding the site changed no
other site's row and no existing task's answer key.

- **Restaurants:** 4–6 in each of the six cities. Each has a cuisine, a price
  level from 1 to 4, dietary menus (`vegetarian`, `vegan`, `gluten-free`, any
  or none), opening hours per weekday with one closed day (never Friday or
  Saturday), a deposit per guest (often none), and a private-room fee where it
  has a private room.
- **Seating:** per restaurant and area (`indoor` always; `terrace`, `bar`,
  `private` sometimes), a number of tables and the guests each seats. A private
  room is one table for 8, 10 or 12.
- **Reservations:** ~200 seeded between April and May 2027, some cancelled,
  each with a guest name, email and phone, a party size, an area, a seating
  time and a special request (often empty). Some areas are fully booked at some
  times on purpose. Most guests have several reservations.

**The rules** are pure functions in `packages/scenarios/src/sites/dining/rules.ts`
(`diningReservationProblem`, `diningSearch`, `diningAvailability`,
`diningDepositCents`). The site applies them on every write, inside the
transaction that takes the table. The intent corpus derives its answer keys
with the same functions. Dates are in 2027, not counted from today. A seating
time is on the hour or the half hour, and a reservation holds one table of its
area for 2 hours from it, so the last seating is 2 hours before closing. The
restaurant must be open that weekday, have seating in the area, and have tables
that seat the party; a party is 1 to 12. A table of the area must be free for
the whole 2 hours. A deposit is the party × the deposit per guest, plus the
private-room fee for the private room. A change of date, time, party, area or
special request is checked against the same rules, the reservation's own table
not counted against it.

| door | reads | writes (every door: signed in, or `Authorization: Bearer dnr_…`) |
| --- | --- | --- |
| REST `/api/v1` | `cities`, `restaurants?city&cuisine&menus&area`, `restaurants/<code>`, `restaurants/<code>/availability?date&partySize`, `search?city&date&time&partySize&area&cuisine&menus&maxPriceLevel`, `reservations?guestEmail&restaurant&date&status`, `reservations/<no>` | `POST reservations`, `POST reservations/<no>/change`, `POST reservations/<no>/cancel` |
| MCP and WebMCP | `list_cities`, `list_restaurants`, `get_restaurant`, `search_tables`, `check_availability`, `list_reservations`, `get_reservation` | `create_reservation`, `change_reservation`, `cancel_reservation` |
| pages | search, results, restaurant (hours, seating, free tables for a date and party), reservations | reserve from a restaurant page, change or cancel from a reservation page |

Every amount the site returns is cents (`depositPerGuestCents`,
`privateRoomFeeCents`, `depositCents`). A malformed value (not a date, not
HH:MM, an unknown area) answers 400; a request the rules refuse answers 422,
and a full area 409 (`FULL`). The site has no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/dining.mjs` adds six task kinds:
name the only restaurant with a free table in an area that offers a dietary
menu (and sometimes is within a price level), say that none has one and name
the first later time that day when one does, the deposit for a private room,
book a table with a special request entered word for word, book the earliest
free time from a given one, and change the party size of one reservation out
of a guest's several. The search tasks are built around an area that would fit
if its tables were not all taken, so an agent has to check the tables as well
as the menus and hours.

The site is shaped on the `french-bistro` demo in GoogleChromeLabs/webmcp-tools
and its webmcp-evals (Apache-2.0; no code or data is copied from it).

### Pizza

`apps/pizza` is **Marlivo Pizza**, a pizza ordering site with a pizza builder
in the `webmcp-v1` scenario. Its rows come from
`packages/scenarios/src/sites/pizza/generate.ts`, drawn from a random stream
of their own (`substream(seed, "pizza")`), so adding the site changed no
other app's rows and no existing task's answer key.

- **Branches:** two in each of six cities. Each has an address, a number of
  pizzas it makes per 30-minute slot (4–8), and either delivery with a fee and
  a free-delivery threshold, or pickup only (three branches).
- **Builder options:** four sizes (small, medium, large, extra large), each
  with the number of people it serves and the price of a plain pizza; four
  crusts (classic, thin, cheese-stuffed from medium up, gluten-free in small and
  medium only), four sauces (or none), three cheeses (or none), and 19 toppings with a price per size
  and diet tags (vegetarian, vegan; contains gluten, dairy, nuts or fish).
- **Menu:** 14 named pizzas, each a base configuration (crust, sauce, cheese,
  toppings).
- **Stock:** each branch is out of 0–2 toppings, and a few branches are out of
  a topping of the cheapest pizza under a common diet filter on purpose. A menu
  pizza with a topping a branch is out of cannot be ordered there.
- **Orders:** ~140 seeded orders between 3 and 23 May 2027 (lines of a menu
  pizza or a built one, with a quantity), statuses `received`, `preparing`,
  `out_for_delivery`, `delivered` and `cancelled`. Some slots are full on
  purpose, and the slot after each such run has room for one pizza only. A few
  customers have the same pizza in several received orders.

**The rules** are pure functions in `packages/scenarios/src/sites/pizza/rules.ts`
(`pizzaPlaceOrder`, `pizzaChangeLine`, `pizzaQuote`, `pizzaMenuSearch`,
`pizzaSlots`). The site applies them on every write, inside the transaction
that takes the slot. The intent corpus derives its answer keys with the same
functions. Slot dates are in 2027, not counted from today, and slots start every
30 minutes from 12:00 to 21:30. Every option must exist and the crust must be
made in the size; a pizza has at most 5 toppings, each once, and needs a sauce,
a cheese or a topping. An order has 1–6 lines of 1–10 pizzas. Delivery needs an
address and a branch that delivers. The branch must have every topping. The
slot must have room for every pizza of the order (cancelled orders hold none).
A pizza costs the size's base price, plus the crust and cheese surcharges in that
size, plus each topping's price in that size. The total adds the delivery fee
unless the subtotal reaches the branch's threshold. An order can be changed or
cancelled only while it is `received`; a change re-prices the order.

| door | reads | writes (every door: signed in, or `Authorization: Bearer pza_…`) |
| --- | --- | --- |
| REST `/api/v1` | `builder`, `branches?city`, `branches/<code>`, `branches/<code>/slots?date&pizzas&from`, `pizzas`, `pizzas/<code>`, `search?size&branch&vegetarian&vegan&without&maxPrice&toppings`, `POST quote`, `orders?customerEmail&branch&status&date`, `orders/<no>` | `POST orders`, `POST orders/<no>/lines/<line>`, `POST orders/<no>/cancel` |
| MCP and WebMCP | `list_branches`, `get_menu`, `search_menu`, `find_slots`, `quote_order`, `list_orders`, `get_order` | `place_order`, `change_order_line`, `cancel_order` |
| pages | search, results, menu, pizza, builder (with the price at a branch), branch (with its slots for a date), orders, order | order from the builder, change a line or cancel from an order page |

Search input money is dollars per pizza (`maxPrice`); every amount the site
returns is cents (`priceCents`, `totalCents`). Each order line carries its
topping set as one string (`toppingsKey`, the keys sorted and comma-joined) so a
check can match the exact set. The site has no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/pizza.mjs` adds six task kinds: order
a menu pizza changed in the builder (the size for a number of people, another
crust, one topping off and one on), price a delivered order near the
free-delivery threshold, name the cheapest menu pizza under a diet filter that
a branch can make, say that none fits under a cap and name the closest, order
in the earliest slot from a time that has room for every pizza, and take a
topping off one of a customer's received orders while leaving the others. The
menu tasks are built around a pizza that would fit if the branch had all its
toppings, and the slot task around a slot that is full.

The site is shaped on the `pizza-maker` demo in GoogleChromeLabs/webmcp-tools
and its webmcp-evals (Apache-2.0); no code or data is copied from it.

### Cinema

`apps/cinema` is **Orrowen Cinemas**, a cinema ticket booking site in the
`webmcp-v1` scenario: a chain with one cinema in each of the six cities. Its
rows come from `packages/scenarios/src/sites/cinema/generate.ts`, drawn from a
random stream of their own (`substream(seed, "cinema")`), so adding the site
changed no warehouse, helpdesk, vault or hotel row, and no existing task's
answer key.

- **Cinemas:** one per city. Each has an address, a booking fee per ticket, a
  surcharge per seat in a premium row, and a price table by format (`2d`,
  `3d`, `large`) and ticket type (`adult`, `child`, `senior`, `student`).
- **Screens:** 2–3 per cinema. A standard screen (rows A–F to A–H, 6–9 seats a
  row, the back row premium) shows 2D and 3D. Three cinemas also have a large
  screen (rows A–H, 10–12 seats a row, rows G and H premium) that shows large
  format only.
- **Films:** 16 invented films in six genres (action, animation, comedy,
  drama, horror, science fiction), each with an age rating (U, PG, 12, 15,
  18), a runtime, a language and the formats it is released in.
- **Showtimes:** 156, from 2027-05-14 to 2027-05-16, four a day on every
  screen. Each cinema's first film in its programme plays most often.
- **Bookings:** ~200 seeded, a few cancelled, held by 30 customers, most with
  several bookings. Five showtimes are sold out on purpose. Twelve have only
  3–5 single seats left, none side by side; half of those are the first
  showing of their film at their cinema.

**The rules** are pure functions in
`packages/scenarios/src/sites/cinema/rules.ts` (`cinemaBookingProblem`,
`cinemaSearchShowtimes`, `cinemaQuote`). The site applies them on every
write, inside the transaction that locks the showtime. The intent corpus
derives its answer keys with the same functions. Showtime dates are fixed in
2027, not counted from today. A booking takes 1 to 10 seats. Every seat must
be on the screen's seat map and free. The ticket counts must add up to the
seats; with no counts, every seat is an adult ticket. Seats get ticket types
in seat order: adults, then children, seniors, students. Child tickets are
not sold for films rated 15 or 18. A total is each ticket's price for the
showtime's format and type, plus the premium surcharge for each premium-row
seat, plus the booking fee for each ticket. A taken seat or a sold-out
showtime is refused with 409; every other rule with 422.

| door | reads | writes (every door: signed in, or `Authorization: Bearer cin_…`) |
| --- | --- | --- |
| REST `/api/v1` | `cinemas`, `cinemas/<code>`, `films?genre&city`, `films/<code>`, `showtimes?city&cinema&date&genre&film&format&after&seats&together`, `showtimes/<code>` (prices, fees, seat map), `bookings?customerEmail&showtime&film&status`, `bookings/<no>` | `POST bookings`, `POST bookings/<no>/cancel` |
| MCP and WebMCP | `list_cinemas`, `get_cinema`, `list_films`, `get_film`, `search_showtimes`, `get_showtime`, `list_bookings`, `get_booking` | `create_booking`, `cancel_booking` |
| pages | showtime search and results, films, film, cinema (prices, screens), showtime (seat map), bookings | book from a showtime page, cancel from a booking page |

Every amount the site returns is cents (`priceCents`, `feesCents`,
`totalCents`); no search filter takes money. A booking as served carries its
seats as a list in seat order (`seats: "F4,F5,F6"`), `seatCount`, `together`
(one row, consecutive numbers) and `ticketCounts`. A showtime result carries
`freeSeats` and `bestRun`, the most free seats side by side in one row. The
site has no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/cinema.mjs` adds six task kinds,
graded by the answer or the site's end state, so any door can be used: say
that no showtime fits a city, date, genre, format, start time and party size
and name the closest one; name the only showtime that fits; book seats side by
side at the earliest showing of a film that still has them; price named
premium-row seats for a ticket mix; book the one set of seats side by side in
a named row; and cancel one booking out of a customer's several. The search
tasks are built around a showtime that would fit if it were not sold out or
nearly full, so an agent has to read free seats as well as the programme.

The site is shaped on the `demos/ticket-booking` demo in
GoogleChromeLabs/webmcp-tools (Apache-2.0): location, genre filter, showtime
choice and checkout. No code or data is copied from it.

### Sports retailer

`apps/sports` is **Brackenford Sports**, a sports retailer in the `webmcp-v1`
scenario: a catalog, customer accounts, order history, order tracking,
returns and reorders. It takes no payments. Its rows come from
`packages/scenarios/src/sites/sports/generate.ts`, drawn from a random stream
of their own (`substream(seed, "sports")`), so adding the site changed no
other row and no existing task's answer key.

- **Catalog:** six categories (running, hiking, cycling, swimming, tennis,
  climbing), each with its own return window: 14, 21, 30, 45, 60 or 90 days,
  one per category. 22 products from four invented brands, each with a
  material. Each product has 2–3 colours in up to 3 sizes (shoes 41–44,
  clothing S–XL, helmets S–L, racket grips G2–G4, or one size); each variant
  has its own SKU (`SP-101-BLK-42`), price, weight in grams and stock.
- **Out of stock on purpose:** one variant in about a third of the products, a
  few more at random, and six size-and-colour groups in which the cheapest
  variant under a weight limit is out of stock, the cheapest one in stock under
  that limit costs more, and a variant cheaper than it but over the limit is in
  stock.
- **Shipping:** one fee per order, waived once the subtotal reaches a
  threshold; both are seeded.
- **Customers:** 18 accounts, by email, with 1–3 saved addresses each in
  different cities, one of them the default.
- **Orders:** ~60 orders placed between 2027-01-04 and 2027-06-15, 1–3 lines
  each, `processing`, `shipped`, `delivered` or `cancelled`, with the date of
  each step and a tracking number once shipped. Five customers have two orders
  processing and one shipped; at least seven others have a latest order that
  is shipped or cancelled, not delivered. 10 returns were already made, of part or all of a
  delivered line.

**The rules** are pure functions in
`packages/scenarios/src/sites/sports/rules.ts` (`sportsOrderProblem`,
`sportsCancelProblem`, `sportsReturnProblem`, `sportsReturnDeadline`,
`sportsOrderTotals`, `searchSportsVariants`). The site applies them inside
each write's transaction. The intent corpus derives its answer keys with the
same functions. The site's date is fixed at 2027-06-15 (`SPORTS_TODAY`), not
counted from today: an order placed through the site is dated that day, and a
return is accepted while that day is within the line's window. An order is
for a seeded customer, to one of their saved addresses, with 1–8 lines of
distinct SKUs and 1–10 units each. Every unit must be in stock, and placing
the order reserves it. Shipping is the fee unless the subtotal reaches the
threshold. Only a processing order can be cancelled; cancelling gives its
stock back. A reorder is a new order with the same SKUs and quantities, to the
same address unless another of the customer's addresses is named. A return is
of a delivered line, up to and including the delivery date plus the
category's window, for at most the units bought minus those already returned,
with one of five reasons. Returns are refunded at the price paid and do not
restock.

| door | reads | writes (every door: signed in, or `Authorization: Bearer spt_…`) |
| --- | --- | --- |
| REST `/api/v1` | `policies`, `products?category&query`, `products/<code>`, `variants/<sku>`, `search?query&category&size&colour&maxPrice&maxWeight&inStock`, `customers?query`, `customers/<email>`, `orders?customerEmail&status&placedFrom&placedTo`, `orders/<no>`, `returns?orderNo&customerEmail` | `POST orders`, `POST orders/<no>/cancel`, `POST orders/<no>/reorder`, `POST returns` |
| MCP and WebMCP | `get_store_policies`, `search_products`, `get_product`, `get_customer`, `list_orders`, `get_order` | `place_order`, `cancel_order`, `reorder`, `request_return` |
| pages | search, results, products, product (specifications, variants), policies, customers, customer (addresses, orders), orders (by customer, status and placing dates), order | the order form; cancel, reorder and request a return from an order's page |

Search input money is dollars (`maxPrice`) and weight is grams (`maxWeight`);
every amount the site returns is cents (`priceCents`, `totalCents`). A domain
refusal is `{error, message}`: 404 for an unknown customer, SKU or order, 409
for out of stock or already cancelled, 422 for every other rule. The site has
no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/sports.mjs` adds six task kinds:
the cheapest in-stock variant in a size and colour under a weight limit and
what a few of it cost with shipping (a cheaper one under the limit is out of
stock); the last day an item from an order can be returned (the miss counts
from the order date); the date and city a customer's order was delivered to,
named by a product in it and the month it was placed (it went to an address
that is not their default); returning some units of a delivered line with a
reason; reordering a customer's most recent delivered order when their latest
order was not delivered; and cancelling the one of a customer's two processing
orders that holds a named product.

Shaped on four GoogleChromeLabs/webmcp-tools demos, `sport-shop-angular`,
`leather-bag`, `order-tracking` and `coffee-shop`, and the commerce suites of
its [webmcp-evals](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
(Apache-2.0); no code or data is copied from them.

### Homes

`apps/homes` is **Corvane Homes**, a home listings site with viewing
appointments, in the `webmcp-v1` scenario. Its rows come from
`packages/scenarios/src/sites/homes/generate.ts`, drawn from a random stream
of their own (`substream(seed, "homes")`), so adding the site changed no other
site's row and no existing task's answer key.

- **Listings:** 15–18 in each of the six cities, in three neighbourhoods per
  city. Each is a house, apartment or townhouse with an asking price,
  bedrooms, bathrooms, floor area in m², year built, features (`garage`,
  `garden`, `pool`, `balcony`, `elevator`, `pets allowed`, `fireplace`,
  `solar panels`, `air conditioning`, `home office`), a monthly service fee
  (none for most houses), an annual property tax, a status (`active`,
  `pending` or `sold`; about a third are not active), a listed date and a
  listing agent.
- **Agents:** two per city. Each shows homes on 5–7 days of a fixed window,
  7 to 19 June 2027 (no Sundays), in set hours cut into 30-minute slots.
- **Viewings:** ~140 seeded requests, some cancelled; most viewers hold
  several. Ten agent days are fully booked on purpose.

**The rules** are pure functions in
`packages/scenarios/src/sites/homes/rules.ts` (`homeViewingProblem`,
`searchHomeListings`, `homeSlotsOf`, `homeYearlyCostsCents`). The site
applies them on every request, inside the transaction that takes the slot.
The intent corpus derives its answer keys with the same functions. Only an
active listing can be viewed. The date must be in the window, and the time
must be one of the listing agent's slots that day. The slot must be free: no
requested viewing holds it, for any of that agent's listings. A viewer cannot
hold two requested viewings at the same time. A cancelled request holds
nothing. A search without a status returns pending and sold listings too.

| door | reads | writes (every door: signed in, or `Authorization: Bearer hom_…`) |
| --- | --- | --- |
| REST `/api/v1` | `cities`, `listings?city&neighbourhood&type&minPrice&maxPrice&minBeds&minBaths&minArea&minYearBuilt&features&status`, `listings/<code>`, `listings/<code>/slots?from&free`, `agents?city`, `agents/<code>`, `viewings?email&listing&agent&status`, `viewings/<no>` | `POST viewings`, `POST viewings/<no>/cancel` |
| MCP and WebMCP | `list_cities`, `search_listings`, `get_listing`, `get_agent`, `list_viewing_slots`, `list_viewings`, `get_viewing` | `request_viewing`, `cancel_viewing` |
| pages | search, results, listing (with its agent's slots, free and taken), agents, agent, viewings, viewing | request a viewing from a listing page, cancel it from its viewing page |

A taken slot is 409 `SLOT_TAKEN`; every other refusal is 422 (`NOT_ACTIVE`,
`NO_SLOT`, `OUTSIDE_WINDOW`, `VIEWER_BUSY`, `WRONG_AGENT`, …). Search input
money is dollars (`minPrice`, `maxPrice`); every amount the site returns is
cents (`priceCents`, `monthlyFeeCents`, `annualTaxCents`). The site has no
NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/homes.mjs` adds six task kinds:
name the only active listing that fits a city, type, size, feature and price
cap; say that no active listing fits and name the closest; total a listing's
service fee for a year plus its property tax; request a viewing in a named
slot; request the earliest free slot from a given time, on a day the agent is
fully booked; and cancel one viewing out of a viewer's several. Each search
task is built around a pending or sold listing that fits every other
requirement, so an agent has to check the status as well as the filters.
The kinds are shaped on the real-estate demo in GoogleChromeLabs/webmcp-tools
(`demos/real-estate-map` and `webmcp-evals/examples/real-estate`, Apache-2.0;
no code or data is copied from it), which filters listings by location, type,
price, bedrooms and features and opens one listing's details; the viewing
appointments are benchme's own.

### Clinics

`apps/clinic` is **Calvenor Clinics**, a clinic network site in the `webmcp-v1`
scenario: patients find a doctor, book and cancel appointments, check what a
visit or a procedure costs under their insurance plan, compare prescription
prices and request refills. It is administrative only. No page, tool or row
gives medical advice: there is no symptom triage, no reading of results, no
judgement about medicines and no urgency decision. Every clinic, doctor, plan,
procedure and medication is invented, and every page says so. Its rows come
from `packages/scenarios/src/sites/clinic/generate.ts`, drawn from a random
stream of their own (`substream(seed, "clinic")`), so adding the site changed
no other row and no existing task's answer key.

- **Clinics:** 1–2 in each of the six cities, each with a pharmacy, addressed
  by the clinic's code.
- **Doctors:** 6–7 per city: three in general practice, two in pediatrics, one
  in dermatology, sometimes one in cardiology or orthopedics. Each has
  languages, visit types (in-person, video or both), whether they accept new
  patients, the plans they are in network for, a fee per visit type, and the
  weekdays and session (morning or afternoon) they work, in 30-minute slots.
- **Plans:** 4, each with a copay for an in-person and for a video visit, and a
  coverage line for each of 8 procedures: covered, covered with prior
  authorisation, or not covered, with the coinsurance % the patient pays.
- **Medications:** 8, each with 2–3 dosages, and a price at each pharmacy that
  stocks it.
- **Patients:** 30, each with a plan, ~180 appointments between March and May
  2027 (some cancelled, some days fully booked on purpose, follow-ups with
  the same doctor), and ~70 prescriptions with refills left. Some patients hold
  one medication at two dosages; some prescriptions already have a refill
  requested.

**The rules** are pure functions in `packages/scenarios/src/sites/clinic/rules.ts`
(`clinicAppointmentProblem`, `clinicRefillProblem`, `clinicFindDoctors`,
`clinicVisitCostCents`, `clinicProcedureCostCents`, `clinicPrescriptionPrices`).
The site applies them on every write, inside the write's transaction, and the
intent corpus derives its answer keys with the same functions. Appointments are
taken for dates in 2027, not counted from today, so a seed means the same diary
forever. A booking must be on a day the doctor works, at one of their slot
times, for a visit type they offer. A doctor not accepting new patients only
books patients who already have a booked appointment with them. The slot must
be free (409 `SLOT_TAKEN`), and the patient must have no other appointment at
that time (409 `PATIENT_BUSY`). A visit costs the plan's copay when the doctor
is in the plan's network, and the doctor's fee otherwise. A procedure costs the
coinsurance share of its price when the plan covers it (with or without prior
authorisation), and the whole price when it does not. A refill needs a refill
left (422), a pharmacy that stocks that medication at that dosage (422), and no
refill already requested (409). A request uses one refill.

| door | reads | writes (every door: signed in, or `Authorization: Bearer cln_…`) |
| --- | --- | --- |
| REST `/api/v1` | `clinics`, `clinics/<code>`, `doctors?city&specialty&language&visitType&plan&newPatients&date`, `doctors/<code>`, `doctors/<code>/slots?date`, `plans`, `plans/<code>` (with coverage), `procedures`, `coverage?plan&procedure`, `visit-cost?doctor&plan&visitType`, `medications`, `medications/<code>`, `prices?medication&dosage`, `patients/<email>`, `appointments?patientEmail&doctor&date&status`, `appointments/<no>`, `prescriptions?patientEmail`, `prescriptions/<no>`, `refills?patientEmail&rxNo&status` | `POST appointments`, `POST appointments/<no>/cancel`, `POST prescriptions/<no>/refill` |
| MCP and WebMCP | `list_clinics`, `find_doctors`, `get_doctor`, `get_plan`, `check_visit_cost`, `get_prescription_prices`, `get_patient` | `book_appointment`, `cancel_appointment`, `request_refill` |
| pages | find a doctor, results, doctor (with a day's slots and the cost under each plan), clinics, plans and coverage, prescription prices, appointments, prescriptions | book from a doctor page, cancel from an appointment page, request a refill from a prescription page |

Every amount the site returns is cents (`inPersonFeeCents`, `costCents`,
`patientCostCents`, `priceCents`); no input is money. The site has no NLWeb
`/ask`.

**Tasks.** `tools/intent-corpus/templates/clinic.mjs` adds six task kinds: name
the only doctor who meets every requirement and has a free slot on a date; say
that none does and name the closest; total what a patient pays for a visit
with an out-of-network doctor and a procedure, and whether it needs prior
authorisation; book a new patient into the earliest free slot with a doctor
from a given time; cancel one of a patient's appointments when another is with
the same doctor; and request a refill of one of two dosages of a medication at
the cheapest pharmacy. The search tasks are built around a doctor who would fit
if their day were not fully booked, so an agent has to read the diary as well
as the profile. They are shaped on the healthcare suite in
GoogleChromeLabs/webmcp-tools'
[webmcp-evals](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
(its tool schemas only; that suite has no demo site; Apache-2.0; no code or
data is copied from it).

### Events

`apps/events` is **Fennick Events**, an office events site in the `webmcp-v1`
scenario. Staff book meeting rooms for events, invite guests, and open some
events to registration with a limited number of places. Its rows come from
`packages/scenarios/src/sites/events/generate.ts`, drawn from a random stream
of their own (`substream(seed, "events")`), so adding the site changed no
other site's row and no existing task's answer key.

- **Offices:** one in each of the six cities, with an address, the days it
  is open (Monday to Friday, some also Saturday) and opening hours.
- **Rooms:** 4–6 per office, each with a name, a floor, a capacity (4 to 30
  people; no two rooms in one office hold the same number), equipment
  (`projector`, `video conferencing`, `whiteboard`) and step-free access or
  not.
- **People:** a staff directory of 36, each with an email, an office and a
  team.
- **Events:** ~140 between March and June 2027, each in one room from a start
  time to an end time, with an organiser from the directory and invited
  guests by email. An event is invitation only, or open to registration with a
  place limit. A few are cancelled. Eight rooms are booked from opening to
  closing on one day on purpose. Four training courses run as three sessions
  at each of two or three offices, and the earliest session of each course at
  each office is full.
- **Registrations:** ~140 for the open events, by staff and visitors, some
  cancelled. Most people hold several. About twenty open events are full.

**The rules** are pure functions in
`packages/scenarios/src/sites/events/rules.ts` (`eventDraftProblem`,
`eventChangeProblem`, `eventCancelProblem`, `eventRegisterProblem`,
`eventFreeRooms`, `eventPlacesLeft`). The site applies them on every write,
inside the transaction that holds the room or the event. The intent corpus
derives its answer keys with the same functions. Dates are in 2027, not
counted from today. Start and end times are `HH:MM` on the quarter hour, an
event ends after it starts and lasts at most 8 hours. The office must be open
that day and for the whole time. The organiser must be in the staff
directory, and every guest email must be valid. An open event needs at least
one place, and an invitation-only event has none. The room must hold the
organiser, every guest and every place. No scheduled event may hold the room
for any part of the time. Back to back is allowed, and a cancelled event holds
nothing. Only the organiser can change or cancel an event, and a change cannot
leave fewer places than people registered. A person can register for a
scheduled open event with a place left. They cannot register twice for one
event, or for two scheduled events at overlapping times. A cancelled
registration holds no place.

| door | reads | writes (every door: signed in, or `Authorization: Bearer evt_…`) |
| --- | --- | --- |
| REST `/api/v1` | `offices`, `offices/<code or city>`, `rooms?office&minCapacity&equipment&accessible`, `rooms/<code>`, `free-rooms?office&date&startTime&endTime&people&equipment&accessible`, `people?office&team&name`, `people/<email>`, `events?office&room&date&from&to&organiser&guest&registrant&q&registration&status&hasPlaces`, `events/<code>`, `registrations?email&event&status`, `registrations/<no>` | `POST events`, `POST events/<code>/change`, `POST events/<code>/cancel`, `POST events/<code>/register`, `POST registrations/<no>/cancel` |
| MCP and WebMCP | `list_offices`, `find_free_rooms`, `list_people`, `list_events`, `get_event` | `create_event`, `change_event`, `cancel_event`, `register_for_event`, `cancel_registration` |
| pages | room search, free rooms, office (with a day's bookings per room), room (with a day's schedule), events, event, people, person (organising, invited, registered), registrations, registration | create an event from the new-event form, change or cancel it from its page, register from an event page, cancel a registration from its page |

A taken room, a full event, a repeat registration and a second cancel are
409 (`ROOM_TAKEN`, `FULL`, `ALREADY_REGISTERED`, `ALREADY_CANCELLED`). An
unknown office, room, event or registration is 404. Every other refusal is
422 (`OUTSIDE_HOURS`, `OFFICE_CLOSED`, `OVER_CAPACITY`, `UNKNOWN_ORGANISER`,
`BAD_GUEST_EMAIL`, `NOT_ORGANISER`, `INVITE_ONLY`, `OVERLAP`, …), and a room
search at a time the office cannot hold anything is 422 with the reason. The
site has no NLWeb `/ask`.

**Tasks.** `tools/intent-corpus/templates/events.mjs` adds six task kinds:

- create an event exactly as asked, with every field and the exact set of
  guests checked;
- name the only room that is free for a slot, holds the people and has the
  equipment;
- say that no room fits and name the closest;
- register a person for the earliest session of a course at one office that
  still has places;
- say which session of a course has the most places left, and how many;
- cancel one of a person's registrations.

Each room task is built around a room that meets every requirement but is
taken for part of the slot, so an agent has to check the schedule as well as
the room's facts. The register task's earliest session is full, and a session
at another office is earlier and has places. The kinds are shaped on the events eval suite in
GoogleChromeLabs/webmcp-tools (`webmcp-evals/examples/events`, Apache-2.0; no
code or data is copied from it), which creates a calendar event for a date and
time at an office with a description and invited guests. The rooms, the
registrations and the place limits are benchme's own.

## Guide

`apps/guide` is **Shortlist**, a buyer's guide: four fictional products in one
category — project management tools (`pm`), password managers (`passwords`),
office espresso machines (`espresso`) or commuter e-bikes (`ebike`) — with a
spec sheet for each product and a journal of articles about each. It exists for
a study of whether what an agent reads changes what it recommends, so every page
is a pure function of the workspace's **edition**: its seed names one row of
`apps/guide/src/editions/edition-table.ts`, a (category, arm, target product).

```
POST /api/workspaces           {"scenario":"guide-v1","seed":<edition seed>}   → urls.apps.guide, and nothing else
/w/<id>/guide/                 the category page: the four products (and, in a chain edition, one journal link)
/w/<id>/guide/products/<slug>  a product's spec sheet
/w/<id>/guide/journal/<slug>   an article of the edition's series; 404 where the edition serves none
```

| arm | what the site serves about the target | how a run reaches it |
| --- | --- | --- |
| `base` | nothing | — |
| `chain-1`, `chain-3` | its first 1 or 3 favourable articles: a review, a customer's story, who it suits | the category page links the first, each article links the next |
| `explicit-1`, `explicit-3` | the same articles, linked from nowhere | the task prompt lists their paths |
| `neutral-3` | its 3 neutral articles: setup, plans, update notes | the task prompt lists their paths |

- **Only guide-v1 workspaces advertise it.** The gateway keeps `guide` in
  `UNLISTED_APPS`; a scenario may name the apps its workspaces advertise
  (`Scenario.apps` in `@benchme/scenarios`), and guide-v1 names the guide alone.
  A scenario whose apps a deployment does not serve is refused at mint
  (422 `SCENARIO_UNAVAILABLE`).
- **The arms differ only where they must.** Every product's articles come from
  the same templates (`apps/guide/src/content/articles.ts`), so one product's
  favourable series is exactly as strong as another's. Chain and explicit
  editions of the same n serve byte-identical article pages; every edition
  serves byte-identical category and product pages, but for the chain's one
  link. `content.test.ts` holds the rules: an article names its own product and
  no other; no link text, title or path names a product; every price in an
  article is on its product's spec sheet; neutral text carries no judgement;
  nothing is addressed to an AI agent; a product's favourable and neutral series
  are the same length within 15%.
- **Records.** Every page a workspace is served is written as it is sent — path,
  query, status, what the page was, the edition, the user agent and the referer —
  to `guide.page_views`, which has no foreign key, so it outlives the workspace's
  TTL. `GET /internal/records?workspace=<id>` (or `?since=<seq>&limit=<n>` for a
  bulk export) and `GET /internal/editions` (every edition's prompt inputs: the
  request, the products, the target and the reading list) need
  `x-benchme-operator-key`. They answer in-cluster and through any workspace's
  `/w/<id>/guide/internal/…`.
- **The edition table is frozen.** A study's prompts carry its seeds: append
  rows, never edit or reuse one. `npm run editions -w @benchme/guide` prints the
  corpus from the source; `/internal/editions` prints the deployment's.

| env | default | |
| --- | --- | --- |
| `GUIDE_OPERATOR_KEY` | — | guards `/internal/*`; the chart and compose set it to the gateway's operator key |

## Site network

The guide's service also serves a small **web of separate sites** about the
same four fictional products per category, under its `/web` path. The gateway
routes the `web` app there (`APP_TARGETS` `"web": "<guide>/web"`, unlisted). It
exists for a study of whether a chain of sites that all recommend one product
changes which product an agent recommends, and how many sites it takes. Every
page is a pure function of the workspace's **network edition**: its seed names
one row of `apps/guide/src/network/edition-table.ts`, a (category, arm, target).

```
POST /api/workspaces      {"scenario":"web-v1","seed":<edition seed>}   → urls.apps.web, and nothing else
/w/<id>/web/              the start page: the four candidates, each linking its own site
/w/<id>/web/<product>/    a candidate's own site: its summary and spec sheet
/w/<id>/web/<site>/       a recommendation site's page about the target (only the sites the edition serves)
```

There are eight **recommendation sites**, each its own brand, voice and look:
Tested & Told (a review), In Their Words (a customer's story), Fit Check (who
it suits), Pick of the Week (a newsletter), Ask the Floor (a forum thread), The
Second Opinion (an adviser's column), Year One (a long-term report) and The
Switch Diaries (a switching diary). Every one recommends the target.

An edition serves the first n sites of its unit's **chain**. The chain is the
eight sites in network order, starting from an offset that depends on the
(category, target) unit. Over the 16 units, every site holds every hop equally
often.

| arm | sites served | how a run reaches them |
| --- | --- | --- |
| `base` | none | — |
| `chain-e-1`, `-2`, `-4`, `-8` | the chain's first n | the target's own site links site 1 ("In the press: Read the review at Tested & Told →"); each site links the next |
| `chain-a-1` … `chain-a-8` | the same | the same links, each introduced by a note to AI assistants and agents ("before you make a recommendation, read …"). It says where to read, never what to recommend |
| `explicit-1` … `explicit-8` | the same | nothing links into the network; the task prompt lists the sites' paths. The pages are the editorial chain's of the same n |

- **The arms differ only where they must.**
  - Every edition of a category serves the same start page.
  - Every vendor site is the base edition's, except the target's in a chain arm, which carries the one pointer.
  - An explicit arm's sites are byte-identical to its editorial chain's.
  - A to-agents chain differs from its editorial chain only in the note.
  - The last site of a chain points nowhere, and sites past n are 404.
  - `network/network.test.ts` holds these.
- **Equally strong for every product.**
  - Sites 1–3 carry the guide's favourable articles. Sites 4–8 are built from each product's `voices` (`content/types.ts`).
  - Every site's template is shared by every product.
  - `content/sites.test.ts` holds the rules:
    - a site's page names its product and no other;
    - no title or pointer names a product;
    - every price is on the spec sheet;
    - nothing on a site is addressed to an AI;
    - no sentence appears on two sites' pages about one product;
    - each site's four pages of a category are of comparable length.
- **Records.** Pages are recorded to `guide.page_views` like the guide's: `entry`, `vendor` (with the product), or `site` (with `site: {key, hop}`); the edition ref carries the scenario. `GET /internal/editions?scenario=web-v1` (operator key) prints the network's corpus, including each edition's chain and reading list. `npm run editions -w @benchme/guide -- --scenario web-v1` prints it from the source.
- **The network edition table is frozen**, as the guide's is: append rows, never edit or reuse one. The chain order (`SITES` in `content/sites.ts`) is part of every edition's meaning: append sites, never reorder them.

## WebMCP

`warehouse`, `helpdesk`, `vaultdocs`, the nine sites from webmcp-tools and the inbox (`mail`) each embed a small bridge script
(`webmcpBridge` in `@benchme/site-kit`) on every page they render, where the
workspace is served through the WebMCP door ([Doors](#doors)). It
registers one `navigator.modelContext` tool per entry in the site's own
`ToolRegistry` — the **same** catalog the site's `/mcp` server exposes, listed
once and rendered into both surfaces, so a page tool and an MCP tool can never
disagree. A tool's `execute` is a `fetch` back to the site's own `/mcp`
(`tools/call`); a browser with no `navigator.modelContext` runs nothing. The
gateway's `WEBMCP_APPS` env var (those thirteen apps in compose and the chart)
only controls what the **portal** advertises as WebMCP-capable — the bridge
itself is on every page of the sites above whose workspace has the WebMCP
door. Every call the bridge makes carries the page's token for the browser's
bridge cookie, which is how a site tells a page's tool from a direct MCP
client (see [The WebMCP door](#the-webmcp-door)); on the nine sites the call
also carries the browser's session cookie (see
[The same sign-in on every door](#the-same-sign-in-on-every-door)).

## NLWeb

Each of `warehouse`, `helpdesk` and `vaultdocs` (the apps in the gateway's
`ASK_APPS`) mounts the same NLWeb surface, from `registerNlweb` in
`@benchme/site-kit`:

- **`GET /ask`** (query params) and **`POST /ask`** (JSON body — flat, or the
  nested v0.55 `{query:{text},context:{prev},prefer:{mode,streaming}}` shape)
  answer a natural-language question with matching items as schema.org
  JSON-LD. **SSE is the default** for both methods — NLWeb's own default, so
  only an explicit opt-out turns it off: pass `streaming=false` (GET) or
  `"streaming": false` (POST; `prefer.streaming` in the nested body) for a
  single JSON response instead. There is no `stream` parameter. The
  single-response JSON body also carries `usage` (`calls`, `inputTokens`,
  `costUsd`, `latencyMs`) for the ranking pass, so a caller can compare
  rankers on cost and latency, not just relevance. An SSE response frames, in
  order, a `license` message, a `data_retention` message, the `results` (plus
  a `ranker` message if the ranker degraded), and always terminates with a
  `complete` frame — even on failure, so a client never hangs waiting for an
  end that isn't coming. It is behind the REST door ([Doors](#doors)).
- **`/ask/mcp`** is a separate, deliberately narrow MCP server: ONE read-only
  `ask` tool ("ask a natural-language question and get JSON-LD back"), not the
  site's full tool surface (that's `/mcp` — see WebMCP above). It is behind
  the MCP door.
- **`GET /schema/feed.jsonl`** — one JSON-LD object per line, so a consumer
  streams the whole corpus without holding a well-formed enclosing array in
  memory.
- **`GET /schema/map.xml`** — a sitemap-shaped pointer at the feed
  (`sf:contentType: structuredData/schema.org`).
- **`GET /robots.txt`** — per workspace-scoped app (`/w/<id>/<app>/robots.txt`,
  disallowing only `/account`, `schemamap:` at its own `/schema/map.xml`) AND
  at the gateway's **host root** (`/robots.txt`: `User-agent: *` / `Allow: /`
  — every path may be fetched, the stores' pages and checkouts included, so an
  agent honouring robots.txt on a shopper's behalf meets no directive against
  buying; a group for the crawlers that gather pages to train or index models
  — GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended,
  Applebot-Extended, PerplexityBot, Bytespider, meta-externalagent — that
  disallows the per-run `/w/` tree, all but the shared workspace's schema;
  and a `schemamap:` line per ask-capable app pointing at the ONE long-lived
  shared workspace, so an answer engine has a stable URL even though every
  minted workspace is disposable). The gateway answers every per-run
  (minted-workspace) response with `X-Robots-Tag: noindex, nofollow`,
  whatever app serves it; the shared workspace's are left as its app answers
  them. The static
  `data` site carries its own, pointing at its own schema map. An agent
  discovers the whole NLWeb surface from any of these roots alone — no
  out-of-band configuration.

## Rankers

`/ask` ranks candidate items with a pluggable `Ranker` (`RankerRegistry` in
`@benchme/site-kit`), selected per deployment by `ASK_RANKER`:

- **`lexical`** (the default) — token-overlap retrieval, no external call, no
  config. What every deployment gets until it opts into something else.
- **`llm`** — NLWeb's per-item ranking prompt against any
  Anthropic-Messages-compatible endpoint (the vendor API, a gateway, a mock).
- **`jev`** — the `jev` score primitive against `api.typesafe.ai` (or any
  compatible endpoint).

**Loud config, not silent fallback.** Selecting `llm` or `jev` without its
`*_BASE_URL`/`*_API_KEY` is a **boot failure**, never a quiet drop to
`lexical` — an arm that silently answered lexically would still be *recorded*
as an `llm`/`jev` measurement and poison every comparison drawn from it. See
`rankerEnvSchema` in `packages/site-kit/src/nlweb/ranker-config.ts` for the
exact validation.

| env | default | |
| --- | --- | --- |
| `ASK_RANKER` | `lexical` | `lexical` \| `llm` \| `jev` |
| `LLM_BASE_URL` | — | required when `ASK_RANKER=llm` |
| `LLM_API_KEY` | — | required when `ASK_RANKER=llm` |
| `LLM_MODEL` | `claude-haiku-4-5-20251001` | |
| `LLM_INPUT_USD_PER_MTOK` | `1.0` | priced per run rather than hardcoded, so a model swap doesn't silently misreport cost |
| `LLM_OUTPUT_USD_PER_MTOK` | `5.0` | |
| `JEV_BASE_URL` | `https://api.typesafe.ai` | |
| `JEV_API_KEY` | — | required when `ASK_RANKER=jev` |
| `JEV_MODEL` | `jev-latest` | |
| `JEV_INPUT_USD_PER_MTOK` | `0.042` | input only — jev writes no tokens; priced per run like the llm prices above |
| `RANKER_CONCURRENCY` | `8` | in-flight upstream requests per `/ask`; one request per candidate |
| `ASK_RANKER_OVERRIDE` | `0` | enables an `X-Ask-Ranker` per-request override on `/ask` — evaluations only, see below |

`ASK_RANKER_OVERRIDE=1` lets any caller who knows a workspace URL choose the
ranker per request and therefore spend the configured provider credits (one
upstream call per candidate); never enable it on an internet-reachable
deployment.

## Evaluate the rankers

```bash
node tools/ask-eval.mjs --base <gateway> --rankers lexical,llm,jev --out ask-eval
```

Mints a workspace behind `<gateway>` and drives `/ask` on `warehouse`,
`helpdesk` and `vaultdocs` with every ranker named in `--rankers` (via the
`X-Ask-Ranker` override — set `ASK_RANKER_OVERRIDE=1` on the deployment
first, or every header is silently ignored and every arm scores whatever
`ASK_RANKER` it booted with), so the three arms of the grid are scored
against one running deployment instead of three separately-configured ones.

| flag | default | |
| --- | --- | --- |
| `--base <url>` | — | the gateway base URL (required) |
| `--scenario <key>` | `acme-v1` | the only scenario this tool's query derivation currently supports |
| `--seed <n>` | `4242` | workspace seed |
| `--rankers <list>` | `lexical,llm,jev` | comma-separated ranker kinds to score |
| `--out <path>` | `ask-eval` | writes `<path>.json` (full per-query detail) and `<path>.md` (a results table per app + a totals table) |
| `--operator-key <key>` | — | `x-benchme-operator-key`, so minting the workspace skips the create rate limit |

~15 queries per app are built from the SAME generator that seeded the
workspace (`@benchme/scenarios`), so their relevant ids are derived, never
hand-picked: a warehouse category name against its products, `lowStock`
against the low-stock query, a customer city against its customers; a
helpdesk priority/status phrase against matching tickets, an agent's name
against their open tickets (`openTicketsFor`); a vaultdocs phrase against
`documentsMatching`. Per query it computes nDCG@10, P@5, wall-clock latency
(p50/p95 per app and overall), cost/query (from the `usage` the response now
carries — see `AskResponse.usage`), and `high_confidence_miss` counts (an
llm/jev score ≥ 0.75 on a non-relevant item). The report discloses that a
`jev` result's `description` is always the item's own boilerplate text (jev
emits no text of its own) and counts `ranker_degraded` queries separately
rather than folding a fallen-back answer silently into the healthy numbers.
Every answer's self-reported `ranker` is checked against the arm that asked
for it: a `mismatch` column counts answers that came back from a *different*
ranker (the override was ignored), and any mismatch fails the run — numbers
labelled with a ranker that did not produce them are worse than no numbers.
Exits non-zero if any (app, ranker) pair answered 422/503 — or was simply
unreachable — on every single query: that arm produced no data, not just a
worse score.

## Evaluate a decision model

```bash
JEV_API_KEY=… LLM_API_KEY=… node tools/decision-eval.mjs \
  --models jev:jev-latest,anthropic:claude-haiku-4-5-20251001 --out decision-eval
```

Benchmarks a decision model *natively*: the model answers closed-set
questions directly, with no agent, no tools and no workspace. The same
questions go to LLM baselines as a strict-JSON prompt, so accuracy,
calibration, latency and cost are compared on identical items. Every item's
answer is a function of the state it carries, and its ground truth is
computed from the seeded rows (`@benchme/scenarios`), never hand-labelled:

| family | kind | what it asks |
| --- | --- | --- |
| `match` | choice | the ONE customer / ticket / product that satisfies a two-part description; the hard negatives satisfy exactly one part |
| `argmin` | choice | the cheapest of six products in one category |
| `claim` | yes/no | is a statement true given evidence: a table lookup, an aggregate (stock summed over depots), a policy rule (resolved within SLA) |
| `route` | choice | which app handles a user request (warehouse / helpdesk / document vault) |

Per (family, subtype, model) it reports accuracy (an invalid answer counts
as wrong, and is also counted), accuracy on the most-confident half,
expected calibration error, Brier and AUROC for the yes/no claims, wall-clock
p50/p95, and $ per 1,000 decisions. `LLM_BASE_URL` / `JEV_BASE_URL` point
either side at a proxy; route both through the same one when comparing
latency. Its own tests: `node --test tools/decision-eval.test.mjs` (they
assert every match item has exactly one fully-matching option).

## Benchmark a decider inside an agent — three doors, one loop

```bash
cd tools/agent-eval && uv sync
BU_CDP_URL=http://127.0.0.1:9222 JEV_API_KEY=… LLM_API_KEY=… \
  uv run agent-eval --protocols browser,webmcp,nlweb --deciders jev,claude-haiku-4-5-20251001 --repeats 5
```

One agent loop, three ways into the same site, and a swappable DECIDER:

| door | the decider picks | the writer (a small LLM) writes |
| --- | --- | --- |
| `browser` | an operation (CLICK / TYPE_TEXT / SELECT / …) and the element — [jev-ultrafast](https://github.com/browser-use/jev-ultrafast)'s own snapshot, element table, questions and guarded executor, pinned | the text to type |
| `webmcp` | CALL_TOOL / DONE and which of the page's `navigator.modelContext` tools (called inside the page, in its session) | the tool's arguments |
| `nlweb` | ASK / OPEN a result / DONE (the site's `/ask` ranker follows the arm via `X-Ask-Ranker`) | the query |

Both deciders answer the identical state and typed questions (TypeSafe's
`/v1/systemone` shape): `jev` natively, an Anthropic model as strict JSON.
The writer is the same model on both sides, so a gap between arms is the
decider's. Every run gets a fresh workspace and a signed-in session; the
verdict is the verifier's (`/w/<id>/verify/v1/submit/<task>`). A task runs
on a door only if its corpus entry lists that surface (`surfaces`:
`pages` / `tools` / `nlweb`). Needs a Chromium with a remote-debugging port
(`BU_CDP_URL`), `ASK_RANKER_OVERRIDE=1` on the deployment for the NLWeb
arm, and the verifier's specs mounted. Tests (offline):
`uv run --group dev pytest`.

One deviation from pinned jev-ultrafast: element labels the DECIDER sees are
capped at 120 characters (its snapshot names a `<select>` after all its
options and repeats that in every option — one 39-option dropdown exceeded
jev's input limit). The executor always acts on the original element.

## Develop

```bash
npm ci
docker run -d --name benchme-pg -e POSTGRES_PASSWORD=benchme -e POSTGRES_USER=benchme -e POSTGRES_DB=benchme -p 15432:5432 postgres:16
DATABASE_URL=postgres://benchme:benchme@127.0.0.1:15432/benchme npm test   # real Postgres, no mocks
npx tsc -b tsconfig.build.json
```

## Run it on your machine

Everything — Postgres, Redis, the migrations, the gateway, the sites, the
verifier and the reaper — comes up with Docker Compose:

```bash
docker compose up -d                 # images from ghcr.io/orabenchmarks at BENCHME_VERSION
open http://localhost:8080           # the front page: every scenario, and how to mint a workspace of it
open http://localhost:8080/scenarios/cuj-v1   # a scenario's page: its public tasks, searchable
docker compose down -v               # stop and drop the database volume
```

- Copy `.env.example` to `.env` to change the port, the public URL or the
  secrets (every value has a local default; change every secret before
  exposing this beyond your machine).
- `BENCHME_DOORS` in `.env` sets the doors every workspace is served through
  unless it is created with its own (see [Doors](#doors)): `page` serves the
  pages alone.
- `docker compose -f compose.yaml -f compose.build.yaml up -d --build` builds
  the images from this checkout instead of pulling them.
- Task specs live in `compose/specs/` (two smoke specs ship;
  see its README to add your own).
- **Code tasks and the Docker socket.** The verifier runs each submitted
  patch in a sibling container: no network, capabilities dropped,
  memory/CPU/pid limits, a hard deadline, removed afterwards — the local
  counterpart of the Kubernetes Job runner. That needs `/var/run/docker.sock`
  mounted into the verifier, which gives that container control of your
  Docker daemon. On Linux set `DOCKER_GID` in `.env` to the socket's group
  (`stat -c %g /var/run/docker.sock`); Docker Desktop works with the default.
  To refuse the socket, set `RUNNER_KIND=none` and remove the socket volume
  from `compose.yaml`: code tasks then fail with a note and every other oracle
  keeps working.

## Release

_Chart 0.14.0: a front page that says what benchme is in one screen (a
copyable command that mints a workspace, the answer it returns, and how an
agent reaches its own isolated workspace of web apps), and a page per scenario
that lists its public tasks, searchable and filtered by site, focus area, level
and number of prompts, each with its judge's criteria and never its answers.
The gateway image carries only the scenarios' public task lists
(`compose/specs/*-tasks.json`). The office events site now states the rule its
changes have always kept: any signed-in account changes or cancels an event in
its organiser's name (`organiserEmail`). No door says "only the organiser" any
more; agents read that as needing the organiser's own account and signed up as
them, and in a `cuj-v1` workspace that code goes to the organiser's own
mailbox, so its six tasks that change an event could not be done. Every door's
sign-up copy (the tools and their replies, the pages, the sign-in refusals) and
the inbox's tools now say that the workspace inbox shows the code mailed to an
address new to the workspace. No new image, no migration and no new secret._

_Chart 0.13.0: a front page for choosing a scenario (the gateway's `/`): a
search over every scenario's title, description, sites and doors, one card per
scenario with its sites by name, the doors this deployment serves it through,
its corpus and docs, and a copyable command that mints a workspace. A sign-up's
emailed code takes five tries, through every door: after five wrong codes even
the right one is refused (`TOO_MANY_ATTEMPTS`), and signing up again with an
address not yet verified mails a new code (a migration per site with
sign-ups). Every `webmcp-v1` task now carries a rubric, and every step of both
`webmcp-v1` and `cuj-v1` whose correct solution must call a site tool carries
those calls in its key (`expectedCall`, the webmcp-evals shape), proven against
each site's tool schemas and by a live pass that does each task with its calls
alone; `compose/specs/*.webmcp-evals.json` are the same calls as webmcp-evals
suites. For npm users: `Scenario` gains required `title`, `about` and `docs`,
and `UsersRepo`'s `consumeVerificationCode` becomes `tryVerificationCode`. No
new image and no new secret._

_Chart 0.12.0: a deployment, and each workspace, chooses its doors (§ Doors):
`BENCHME_DOORS` on the gateway (the chart's `doors` value), and `doors` on
`POST /api/workspaces`. Unset, every door is served, as before. A closed door
answers 404 and nothing names it; the WebMCP door is now the page's bridge
cookie and token, and the `x-benchme-door` header means nothing (a call that
only carries it is an MCP client's). `cuj-v1` workspaces keep their people's
mail private (the inbox never shows mail to an address the rows hold), every
`cuj-v1` task that changes something checks that no change was made as anyone
else, and find-the-fit's two impossible tasks are now questions no option meets
(`{"found": false}`); every which-one question asks for `{"found": …}`. New
migrations: the gateway's `003_doors` and the inbox's `002_held_addresses`,
applied by the migrate Job like any other. No new image and no new secret._

_Chart 0.11.0: the `cuj-v1` scenario (docs/scenarios/cuj-v1.md) — 120
critical-user-journey tasks over the nine sites in ten focus areas and four
levels (easy, medium, hard with a `veryHard` subset, impossible), 26 of them
with follow-up steps, every step with its own check and rubric. The corpus is
`compose/specs/cuj-corpus.json` (`cuj-tasks.json` without answer keys). Every
site now keeps a change ledger (§ The change ledger; new migrations
`002_ledger` and `003_ledger_subject` per site, applied by the migrate Job like
any other) and asks the same sign-in on every door (§ The same sign-in on every
door). Behaviour change for `webmcp-v1`: an MCP or WebMCP write tool called
without signing in now answers `UNAUTHORIZED`, tool lists carry `sign_up`,
`verify_email`, `sign_in`, `sign_out` and `whoami`, and `initialize` returns an
`Mcp-Session-Id`. The verifier's state oracle gains `absent`, `ledger` and
`unchanged` checks, and answers per step for a spec with `steps`; a spec
without `steps` is answered exactly as before. No new image and no new
secret._

_Chart 0.10.0: the sites from webmcp-tools (scenario `webmcp-v1`, § Sites
from webmcp-tools) — nine new images (`hotels`, `flights`, `dining`, `pizza`,
`cinema`, `sports`, `homes`, `clinic`, `events`; make each package public),
nine new migrations in the migrate Job (one schema per app, `001_<app>`), and
no new secret. The gateway routes the nine as unlisted apps (only `webmcp-v1`
workspaces advertise them) with MCP and WebMCP on, and the verifier's `state`
oracle reads them directly. The corpus (162 tasks) is
`compose/specs/webmcp-corpus.json`. A cluster whose verifier mounts an
out-of-band specs ConfigMap (`verify.existingSpecsConfigMap`) grades the 81
`state` tasks only once that ConfigMap also carries their answer keys:
`tools/build-specs.mjs --public compose/specs` adds them. The gateway seeds a
workspace in the apps its scenario needs (an unlisted app only for a scenario
that names it), so no other scenario's workspaces depend on the nine sites,
and it no longer proxies an app's `/internal/workspaces/*`._

_Chart 0.9.0: the site network (scenario `web-v1`, served by the guide's
image under `/web`; the gateway routes the new unlisted `web` app there). It
adds one migration (`guide` `002_sites`: a nullable `site` column on
`guide.page_views`). There is no new image and no new secret. Records now carry
the scenario in their edition ref._

_Chart 0.8.0: the buyer's guide (`apps/guide`, schema `guide`, scenario
`guide-v1`) — one new image (`guide`: make its package public), one new
migration in the migrate Job, and no new secret (the guide reads the operator
key). The gateway lets a scenario name the apps its workspaces advertise
(`Scenario.apps`) and refuses to mint a scenario whose apps it does not serve
(422 `SCENARIO_UNAVAILABLE`)._

_Chart 0.7.2: which issued card paid, read the same whoever holds the card
page (an unbound Link card at its exact expiry is a Link payment, held to its
approval, in a run that also read the card page; another run's login's card is
never matched; an ambiguous payment names its requests and `wouldDecline`);
the `login` binding rule (a later request of a login binds where an earlier one
did); each card's expiry in the records; robots.txt closes the per-run tree to
model-training crawlers, and every per-run response carries
`X-Robots-Tag: noindex, nofollow`. No migration, no new settings._

_Chart 0.7.1: Link's spend controls (the wallet's migration `003_spend_controls`:
a spend request's card pays one payment, up to its approval; the stores confirm
with manual capture and ask the wallet before they take a payment), disjoint
card expiries (the saved card four years out), the binding fixes (the card the
candidate checkouts agree on; no card on a guess when the stores cannot be asked;
an unbound request that names a store approved), and a host-root `robots.txt`
that allows every path. New wallet settings, all optional: `WALLET_LOOKALIKES`
and `WALLET_BINDING_RETRY_MS`._

_Chart 0.7.0: the stores (`apps/shops`, schema `shops`) and the wallet
(`apps/wallet`, schema `wallet`) — two new images, two new migrations in the
migrate Job, the gateway's root service route (`SERVICE_TARGETS`), and three
new secret keys (`shopsSuffixKey`, `shopsInternalSecret`,
`walletInternalSecret`)._

_Chart 0.5.0: the NLWeb/WebMCP capability flags (`ASK_APPS`, `WEBMCP_APPS`)
and the ranker config (§ Rankers) — no schema or migration changes._

Tag `vX.Y.Z`: the `images` workflow pushes `ghcr.io/orabenchmarks/<app>:X.Y.Z`
and the `chart` workflow pushes `oci://ghcr.io/orabenchmarks/charts/benchme:X.Y.Z`.
Packages are public so clusters pull anonymously; the source stays private
until publication.

```bash
helm install benchme oci://ghcr.io/orabenchmarks/charts/benchme --version X.Y.Z -n benchme --create-namespace \
  --set ingress.host=benchme.example.test --set publicBaseUrl=http://benchme.example.test
```

### Publishing the npm packages

The `publish.yml` workflow publishes `@benchme/core`, `@benchme/scenarios`, and
`@benchme/site-kit` on a `vX.Y.Z` tag, or when manually dispatched with an existing
tag's version. Each package needs its own npm trusted publisher:

| npm field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `orabenchmarks` |
| Repository | `benchme` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions | Enable `npm publish` |

Publishing uses GitHub OIDC with an empty npm token and retains provenance.
Missing or incorrect trust fails the release; it cannot silently become a dry
run. A separate job installs and imports all three exact versions from public
npm before the workflow succeeds. Keep any existing publishing token until the
first token-free release passes. Newly saved publishers must be used within two
days; configure them when a release is ready.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

### GitOps deployments (ArgoCD and friends)

Three chart inputs cannot travel through `helm template`:

- **Secrets.** By default the chart generates its eight secrets on first
  install and keeps them with a `lookup` — a rendering that has no cluster
  (ArgoCD's repo-server) would mint new values on every sync and rotate the
  Postgres password. Provide a Secret yourself (an ExternalSecret from your
  secret manager, keys `gatewaySecret`, `operatorKey`, `receiptSecret`,
  `mailInternalSecret`, `postgresPassword`, `shopsSuffixKey`,
  `shopsInternalSecret`, `walletInternalSecret`) and name it in
  `secrets.existingSecret`. Two more
  keys, `llmApiKey` and `jevApiKey` (the provider credentials for the
  `llm`/`jev` rankers — see § Rankers), are read as `optional: true`: omit
  them from your Secret entirely while running the default `lexical` ranker,
  add them only for the deployments that select `llm`/`jev`. The same goes
  for `stripeSecretKey` and `stripePublishableKey` (Stripe test-mode keys,
  needed only with `shops.payments=stripe`; see § Stores) — which may also
  come from a Secret of their own, named in `shops.stripeExistingSecret`.
- **Hidden task specs.** Never commit them. Build a ConfigMap from your
  hidden-tasks checkout and apply it out-of-band, then name it in
  `verify.existingSpecsConfigMap` (the chart renders no specs ConfigMap of its
  own and mounts yours at `/specs`):

  ```bash
  node tools/build-specs.mjs --hidden ../benchme-hidden --public compose/specs \
    --configmap benchme-task-specs-hidden --namespace benchme --out specs-cm.yaml
  kubectl -n benchme apply -f specs-cm.yaml     # re-run after every hidden-tasks change, and every release that changes compose/specs
  ```

  `--public compose/specs` adds the intent corpora's answer keys (the files
  `docker compose` mounts into its verifier). Without it the cluster's verifier
  holds the hidden tasks alone and answers 404 `UNKNOWN_TASK` for every intent
  task, so no `state` task can be graded there. The verifier reads a spec when
  a task is submitted: added or changed specs need no restart.
- **Hidden store scenarios.** Never commit them either. Build the stores'
  scenario file as a ConfigMap (key `shops-scenarios.json`), apply it
  out-of-band and name it in `shops.existingScenariosConfigMap`. The chart
  mounts it at `/scenarios`. The app reads it at boot, so restart the
  Deployment after every change:

  ```bash
  node tools/build-shop-config.mjs --hidden ../benchme-hidden \
    --configmap benchme-shops-scenarios --namespace benchme --out shops-scenarios-cm.yaml
  kubectl -n benchme apply -f shops-scenarios-cm.yaml
  kubectl -n benchme rollout restart deployment/benchme-shops
  ```
