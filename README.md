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
/w/<id>/warehouse/          products, stock, orders, transfers (UI · /api/v1 · /mcp)
/w/<id>/helpdesk/           tickets, comments, SLAs (UI · /api/v1 · /mcp)
/w/<id>/vaultdocs/          the document vault (UI · /api/v1 · /mcp with resources + prompts)
/w/<id>/verify/v1/submit/<taskId>   POST an artifact → verdict + receipt
/w/<id>/mail/               the workspace inbox (verification codes land here)
/data/                      the company site (static, generated from the seed)
POST /api/workspaces/<id>/finalize                               → a signed receipt
```

## Layout

| path | what |
| --- | --- |
| `packages/core` | config, http (healthz/readyz), ids, receipts (HMAC), pg + migrations, redis, the workspace model |
| `packages/scenarios` | seeded generators (`acme-v1`) and the derived ground truths |
| `apps/gateway` | workspace API, signed reverse proxy, portal + MCP registry, reaper |
| `packages/site-kit` | what every site shares: the gateway-scope hook, signup/verify/login + sessions + api tokens, the MCP server plumbing, the page shell |
| `apps/warehouse` | products, stock, orders, transfers: SSR UI, REST v1, a 14-tool MCP server, NLWeb `/ask`, WebMCP |
| `apps/helpdesk` | tickets, comments, SLAs, assignment: SSR UI, REST v1, an 11-tool MCP server (with a destructive `delete_ticket`), NLWeb `/ask`, WebMCP |
| `apps/vaultdocs` | ~40 seeded documents as MCP **resources** (`docs://<id>`), `search`/`get_document`/`list_documents` tools, two MCP **prompts**; full-text search UI + REST, NLWeb `/ask`, WebMCP |
| `apps/verify` | the verifier: json / xlsx / docx / patch / **state** oracles (state reads the app's own REST API after the fact — end state is the evidence, the artifact is ignored), HMAC receipts, attempt log, isolated Kubernetes Job runner; the intent corpus it ships with (generated tasks across the warehouse, helpdesk, vault and company site) is described in [`compose/specs/README.md`](compose/specs/README.md) |
| `apps/mail` | per-workspace inbox with an internal delivery endpoint |
| `apps/data` | the generated company site |
| `packages/storefront` | the stores' pure logic: money, US sales tax by ZIP, cart, pricing, the scenario-file schema, outcome classes, order numbers |
| `apps/shops` | three consumer stores and a payment page, served from one app (see [Stores](#stores)) |
| `apps/wallet` | a stand-in for a Link wallet: the HTTP API `@stripe/link-cli` calls, an approval policy, test cards bound to the run's checkout (see [Wallet](#wallet)) |
| `charts/benchme` | the Helm chart: own postgres + redis, apps, migrate job, reaper, ingress |
| `docker/app.Dockerfile` | one multi-stage Dockerfile, `--build-arg APP=<app>` |

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

## WebMCP

`warehouse`, `helpdesk` and `vaultdocs` each embed a small bridge script
(`webmcpScript` in `@benchme/site-kit`) on every page they render. It
registers one `navigator.modelContext` tool per entry in the site's own
`ToolRegistry` — the **same** catalog the site's `/mcp` server exposes, listed
once and rendered into both surfaces, so a page tool and an MCP tool can never
disagree. A tool's `execute` is a `fetch` back to the site's own `/mcp`
(`tools/call`); a browser with no `navigator.modelContext` runs nothing. The
gateway's `WEBMCP_APPS` env var (`warehouse,helpdesk,vaultdocs` by default,
same in the chart) only controls what the **portal** advertises as
WebMCP-capable — the bridge itself is unconditional on every page of the
three sites above.

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
  end that isn't coming.
- **`/ask/mcp`** is a separate, deliberately narrow MCP server: ONE read-only
  `ask` tool ("ask a natural-language question and get JSON-LD back"), not the
  site's full tool surface (that's `/mcp` — see WebMCP above).
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
open http://localhost:8080           # the portal; POST /api/workspaces to mint a workspace
docker compose down -v               # stop and drop the database volume
```

- Copy `.env.example` to `.env` to change the port, the public URL or the
  secrets (every value has a local default; change every secret before
  exposing this beyond your machine).
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
  node tools/build-specs.mjs --hidden ../benchme-hidden \
    --configmap benchme-task-specs-hidden --namespace benchme --out specs-cm.yaml
  kubectl -n benchme apply -f specs-cm.yaml     # re-run after every hidden-tasks change
  ```
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
