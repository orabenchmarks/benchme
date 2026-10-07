# shops-e2e — the hidden store tasks in a real browser

`tasks.spec.ts` turns every task of a `benchme-hidden` checkout (`shops/<ID>/`) into one Playwright test
that does what a careful shopper does, through the pages, in Chromium:

1. mints its own `shops-v1` workspace (`POST /api/workspaces` with the operator key);
2. opens `urls.apps.<store>` with `?utm_campaign=<campaign>` appended, as the task's prompt says, and
   accepts the cookie banner (the newsletter pop-up is closed whenever it shows up);
3. takes the steps of the task's `reference.json` through the UI (`lib/shopper.ts`): the collection menu and
   its sort menu, the header search and its suggestions, the product page's option buttons, purchase
   options (one-time / subscribe & save and the interval) and quantity stepper, **Add to cart** and the cart
   drawer, the cart page's discount-code field, the home page's newsletter form, **Check out**, the
   information form (Wrenfield: the sender's **Your name** when the run names one, delivery date, card message,
   signature; the marketing box ticked or unticked as the step says), the shipping method and the add-on boxes,
   then the payment step — the card form, or **Continue to secure payment** and the hosted page; with
   `STRIPE=1` Stripe's own Payment Element and Checkout page ([Stripe mode](#stripe-mode-stripe1)) — with the
   price-update banner, the 3D Secure step, the outbound notice and PayLantern handled as a shopper meets them.
   The card's ZIP is its **billing ZIP**, typed over whatever the store prefilled: the pay step's `billingZip`
   (`{ "pay": { "card": "success", "billingZip": "10001" } }`), else `94107`, the billing ZIP the Link card
   carries — never the delivery address's (a florist delivers to the recipient; a card is billed to its owner);
4. reads the outcome where a shopper reads it: the confirmation page's order number must carry the store's
   prefix and the suffix that `suffixTable(SUFFIX_KEY, <ID>)` gives the run's `expectClass`; a run whose
   `expectClass` is `"none"` must end on no order page, with the page saying why (the decline message, the
   notice in place of a payment form, the late fee pushing the total over the budget, the sold-out choice);
5. fails on any uncaught script error or 5xx answer met on the store's pages, and saves a full-page screenshot
   of where it ended as `$OUT_DIR/shots/<ID>.png`; each test also attaches `run.json` (its workspace, the
   cards it paid with, the orders it reached) for [`stripe-ledger.mjs`](#the-stripe-ledger).

Every control (link, button, field, radio, checkbox, option) is found by its role and accessible name, taken
from the catalogue the page is rendered from (`apps/shops/dist/stores`); only the blocks around them (the buy
form, the product grid, the card form, the order summary's lines) are found by the page's own `data-`
attributes. A missing label, an ambiguous control or a button that needs a reload therefore fails the test
where a shopper would get stuck. The runs follow the step format that `tools/build-shop-config.mjs`
validates and replays.

The tasks are read at run time and nothing from them is written into this repository: the report, the
traces and the screenshots (which show campaign codes, prompts' buyers and review texts) go to `OUT_DIR`,
outside the checkout by default.

## Before the first run

```bash
npx tsc -b packages/storefront apps/shops        # from the repository root: the suite imports both builds
cd tools/shops-e2e && npm install && npx playwright install chromium   # once; not an npm workspace
```

The suite's own helpers have unit tests that need no stack and no browser (Node 22.18+, from the repository
root): `node --test tools/shops-e2e/lib/*.test.ts tools/shops-e2e/stripe-ledger.test.mjs`.

## Environment

| Variable | |
|---|---|
| `HIDDEN_DIR` | the `benchme-hidden` checkout (the tasks are `$HIDDEN_DIR/shops/<ID>/`) — required |
| `BASE_URL` | the gateway, e.g. `http://localhost:4310` — required |
| `OPERATOR_KEY` | the gateway's operator key — required |
| `SUFFIX_KEY` | the shops service's `SHOPS_SUFFIX_KEY` — required; the expected suffixes are computed from it (a dev stack prints its own as `suffixKey` in its JSON line: fixed in fake mode, new for every run with `--payments stripe`) |
| `ONLY` | `ONLY=<ID>,<ID>`: just these tasks (the directory names under `shops/`) |
| `RUN` | `reference` (default), or `wrong` to take each task's `wrong.json` instead and expect its class (a `"deferred": "wallet"` mistake is graded by the store like the reference until the wallet exists) |
| `ENTRY` | `prompt` (default): `urls.apps.<store>?utm_campaign=…`, exactly as the prompts write it; `slash`: `urls.apps.<store>/?utm_campaign=…`, the root page directly, without the gateway's `/w/<id>/<app>` → `/w/<id>/<app>/` redirect |
| `STRIPE` | `1`: the stack pays with Stripe test keys (`dev-stack.mjs --payments stripe`), so the runs pay through Stripe's own surfaces ([Stripe mode](#stripe-mode-stripe1)); unset or `0`: fake payments. A run in the wrong mode stops at its first payment, saying which mode the store is in. The suite itself never needs a Stripe key |
| `OUT_DIR` | where everything goes (default `$TMPDIR/shops-e2e`): `report/` (HTML), `results.json` (the same for scripts, with each test's `shopper.log`), `results/` (traces of failed tests — none with `STRIPE=1`), `shots/<ID>.png` |
| `WORKERS` | parallel browsers (default 4) |

Tests run in parallel, without retries, 120 s each (240 s with `STRIPE=1`). Open the report with
`npx playwright show-report "$OUT_DIR/report"`; each test carries a `shopper.log` attachment (what was
clicked, what the page answered, the order number) and its final screenshot.

## Against a dev stack (from source)

```bash
# from the repository root
node tools/build-shop-config.mjs --hidden ../benchme-hidden --out /tmp/shops-config/shops-scenarios.json
node apps/shops/tools/dev-stack.mjs --port 4310 --db bm_e2e --scenarios /tmp/shops-config/shops-scenarios.json &
# … wait for its JSON line ({"gateway":"http://localhost:4310", …}), then:
cd tools/shops-e2e
HIDDEN_DIR=$PWD/../../../benchme-hidden BASE_URL=http://localhost:4310 \
OPERATOR_KEY=dev-stack-operator-key-0123456789abcdef \
SUFFIX_KEY=dev-stack-shops-suffix-key-0123456789abcdef \
npx playwright test
```

The two keys above are the dev stack's fixed development secrets (`apps/shops/tools/dev-stack-secrets.mjs`), which it
runs on in fake mode, its default; its JSON line repeats the suffix key and the internal secret as `suffixKey` and
`internalSecret`. With `--payments stripe` the stores take payments and refuse such published values, so the stack
makes a fresh suffix key and internal secret for every run — take them from its JSON line ([Running it](#running-it));
the operator key stays the fixed one. Stop it with Ctrl-C (or `kill` its process) when done.

## Against the compose stack (built images)

```bash
# from the repository root; the file must be named shops-scenarios.json in SHOPS_SCENARIOS_DIR
node tools/build-shop-config.mjs --hidden ../benchme-hidden --out /tmp/shops-config/shops-scenarios.json
SHOPS_SCENARIOS_DIR=/tmp/shops-config BENCHME_PORT=18190 BENCHME_PUBLIC_URL=http://localhost:18190 RUNNER_KIND=none \
  docker compose -p bm-shops -f compose.yaml -f compose.build.yaml up -d --build --wait
cd tools/shops-e2e
HIDDEN_DIR=$PWD/../../../benchme-hidden BASE_URL=http://localhost:18190 \
OPERATOR_KEY=benchme-local-operator-key-change-me \
SUFFIX_KEY=benchme-local-suffix-key-change-me \
npx playwright test
```

Those two keys are compose's defaults; when `.env` sets `OPERATOR_KEY` or `SHOPS_SUFFIX_KEY`, pass those
instead. `SHOPS_PAYMENTS` must stay `fake` (compose's default). Take the stack down with
`docker compose -p bm-shops down` when done.

## Stripe mode (`STRIPE=1`)

The release gate: the same runs against a stack that pays with Stripe **test-mode** keys, in a real browser, through
Stripe's own surfaces. Stripe's frames are found by the titles Stripe gives their `<iframe>` elements and everything
in them by role and accessible name (`lib/stripe.ts`):

- **Payment Element** (Wrenfield's surface, and the other stores' when a scenario sets it): the frame titled
  *Secure payment input frame* inside the store's mount point; the **Card** tab (Stripe opens on it), then
  *Card number*, *Expiration*, *Security code*, *Country* (United States) and *ZIP code* (the billing ZIP, typed
  over the postal code the store passed), then the store's **Pay $…** button below the frame, which confirms with
  Stripe.js.
- **Express Checkout** (Quillfeather's surface): the same card form, under the Express Checkout Element (frame
  *Secure express checkout frame*), whose Link button is logged, not used — the runs pay by card.
- **Hosted Checkout** (Halden's surface): **Continue to secure payment**, then Stripe's page on
  `checkout.stripe.com` — *Card number*, *Expiration*, CVC, *Cardholder name*, *Country or region*, *ZIP* (the
  billing ZIP) — **Pay**,
  and back to the store's confirmation. When Stripe opens the page on the shopper's own currency (Adaptive Pricing:
  from outside the US it shows a local price first), the shopper picks the US-dollar price, which must equal the
  store's total.
- **3D Secure** (4000 0027 6000 3184): Stripe's test page in the frame titled *3DS Challenge* (inside another of
  Stripe's frames); the run clicks **Complete** once the frame holds still — again if the page is still there a
  few seconds later — and must then reach the confirmation. A 3D Secure card that pays without the challenge fails.
- **Decline** (4000 0000 0000 0002): the error under the Pay button (Stripe.js says *Your card has been declined.*;
  fake mode *Your card was declined.*), or on the hosted page Stripe Checkout's own (*Your credit card was declined.
  Try paying with a debit card instead.* and the like) — `DECLINED` in `lib/stripe.ts` accepts them all — and no order.
- **Price update**: the banner after the first Pay, the button showing the new total, then Pay again.

Stripe mode checks one thing fake mode cannot: a store that takes cards must offer **cards only**. Any tab of the
Payment Element other than *Card*, or any way to pay on the hosted page other than the card (Link's bank payment,
Klarna through Link), is a *store problem*. The run goes on to its end and its outcome is read as usual; the test
then fails with *the store's payment surfaces offer only what the store takes*, the problems listed in
`shopper.log`. Wallet buttons are not counted: the Express Checkout Element's Link button (the express surface's
design) is logged and left unused, and any wallet button Stripe Checkout shows above its card form (its own Link,
Apple Pay, Google Pay) is neither counted nor logged — the runs pay by card.

A click on the store's Pay button can be routed by where things were a moment before, into Stripe's card field just
above it, when the page is still scrolling: the button is scrolled into view and given two paints first, and a click
that never reached it is made again (the log says so).

### Running it

The keys go into the environment of the one command that needs them, read from wherever you keep secrets — never
into a file in this repository, never echoed, never in a screenshot (`…` below stands for them). Nor in a trace:
with `STRIPE=1` the suite records none (`playwright.config.ts`), since a trace keeps Stripe's frames and requests,
and those carry the publishable key; the screenshots and `shopper.log` show where a run stopped.

```bash
# from the repository root; the stack refuses anything but test-mode keys (sk_test_…, pk_test_…)
node tools/build-shop-config.mjs --hidden ../benchme-hidden --out /tmp/shops-config/shops-scenarios.json
STRIPE_SECRET_KEY=… STRIPE_PUBLISHABLE_KEY=… node apps/shops/tools/dev-stack.mjs --port 4650 --db bm_e2e \
  --payments stripe --scenarios /tmp/shops-config/shops-scenarios.json > /tmp/shops-stack.json &
# … wait for its JSON line in /tmp/shops-stack.json: this run's own suffixKey and internalSecret (the stores refuse
# the dev stack's fixed ones when they take payments); the operator key stays the fixed one. Then (no Stripe key
# needed: the page gets the publishable key from the stack):
stack() { node -p "JSON.parse(require('fs').readFileSync('/tmp/shops-stack.json', 'utf8')).$1"; }
cd tools/shops-e2e
HIDDEN_DIR=$PWD/../../../benchme-hidden BASE_URL=http://localhost:4650 \
OPERATOR_KEY=dev-stack-operator-key-0123456789abcdef SUFFIX_KEY=$(stack suffixKey) \
STRIPE=1 OUT_DIR=/tmp/shops-e2e-stripe npx playwright test
# the mistakes too, into their own OUT_DIR (results.json is rewritten by every run):
… STRIPE=1 RUN=wrong OUT_DIR=/tmp/shops-e2e-stripe-wrong npx playwright test
```

Then look every payment up in Stripe ([below](#the-stripe-ledger)) while the stack is still up — the ledger reads
the orders from it, with the stack's `internalSecret` — and stop the stack. A stack restarted makes new secrets:
the runs, the ledger and the stack belong together.

### The Stripe ledger

`stripe-ledger.mjs` holds what the runs paid in Stripe against what the stores recorded. It reads the `run.json`
of every test from `results.json`, the workspace's orders from the store's internal state API (through the gateway),
and the workspace's PaymentIntents from Stripe: the ones the store names (orders, checkouts, payment attempts, the
hosted sessions' intents) and the ones Stripe's search finds by `metadata['workspace']` (retried while the search
has not indexed the latest payments — it can lag a minute). Per run it requires:

- every order: exactly one succeeded PaymentIntent — no two orders sharing one, no succeeded intent of the
  workspace without its order — whose `amount` is the order's `chargedCents` (and its total), `currency` usd (and
  shown to the shopper in dollars), `livemode` false, and `metadata.workspace`, `store` and `checkout` the order's;
- a run with the decline card: a PaymentIntent with a declined `last_payment_error` and no order when the run ends
  without one; a declined charge when it paid after the decline;
- a run with the 3D Secure card: each order's intent went through `requires_action` (Stripe's
  `payment_intent.requires_action` event for it) and its charge shows an authenticated 3D Secure result.

```bash
# from the repository root, the test-mode secret key in the environment of this command only; the stack's own
# internal secret from its JSON line (stack(), above)
STRIPE_SECRET_KEY=… node tools/shops-e2e/stripe-ledger.mjs --internal-secret "$(stack internalSecret)" \
  /tmp/shops-e2e-stripe /tmp/shops-e2e-stripe-wrong
```

It prints one row per run (orders, succeeded intents, amounts that match, the 3D Secure and decline evidence, the
verdict) and every mismatch; exit 0 when every run matches, 1 on any mismatch, 2 on a usage error. The internal
secret is `--internal-secret`, else `$SHOPS_INTERNAL_SECRET`, else the dev stack's fixed fake-mode one — which a
Stripe-mode stack refuses: give it the `internalSecret` of the stack's JSON line. `--search-wait <seconds>` (default
90) bounds the wait for Stripe's search. Fake-mode records are listed as skipped. The key is never printed.

### What it showed (2026-10-07, dev stack from source, the 33 hidden tasks)

- **`STRIPE=1`** (Stripe sandbox): all 33 reference runs and all 33 wrong runs pass. Each reaches its outcome through
  Stripe's own surfaces — the order with the expected suffix, or no order with the page saying why — on every one of
  them: Payment Element, Express Checkout, hosted Checkout, 3D Secure (challenge completed), decline, price update,
  duplicate purchases, PayLantern.
- **Cards only**: the check is clean in every run. The Payment Element shows the card form alone
  (`wallets: { link: "never" }` keeps out the *$5 back Bank* and *Klarna* tabs Link brought; the Express Checkout
  Element is configured apart), and the hosted page offers only the card (`wallet_options: { link: { display: "never" } }`
  on the Checkout Session; `adaptive_pricing: { enabled: false }` keeps its price in US dollars).
- **The ledger** matched 66 runs of 66: each order one succeeded test-mode USD PaymentIntent of its own workspace and
  checkout, for the order's charge; the 3D Secure intents through `requires_action`; the decline's intent declined,
  with no order.
- **Fake mode** (`dev-stack.mjs` default): all 33 reference runs and all 33 wrong runs pass.
- Link's own test card, 4000 0099 9000 1984, typed into the Payment Element is refused on the spot: *Your card
  number is invalid.* — the number fails the Luhn check, so Stripe.js never sends it.

## When a test fails

- **"the campaign code never reached the store"** at *open the store*: the entry address lost its
  `?utm_campaign=…` before reaching the store, so the task's scenario is not on. With `ENTRY=prompt` that is
  the gateway's redirect from `/w/<id>/<app>` to `/w/<id>/<app>/` dropping the query string — exactly what an
  agent following the prompt would hit. `ENTRY=slash` checks everything after the entry meanwhile.
- **"order … reads as <class>; the task expects <class>"**: the store classified the order differently;
  the class named is read back from the suffix (`… of a workspace without a scenario` means the campaign
  never took).
- **a step timing out on a locator**: the page has no control with that role and name (or it never became
  usable); the trace in `results/` shows the page at that moment (fake mode; with `STRIPE=1` there is no trace —
  the final screenshot and `shopper.log` show where it stopped).
- **"the store's payment surfaces offer only what the store takes"** (`STRIPE=1`): the run reached its outcome,
  but a payment surface offered more than the card; `shopper.log` lists each *store problem*.
- **"run with STRIPE=1"** / **"drop STRIPE=1"**: the stack pays in the other mode than the suite was told.

## Not covered yet

Paying with Link itself (the Express Checkout Element's button, or Link's saved details): the runs pay by card on
every surface. The wallet stand-in's runs, and with them the deferred mistakes (`"deferred": "wallet"`).
