# Task specs for `docker compose`

Every `<taskId>.json` here is mounted read-only at `/specs` in the verifier
(`SPECS_DIR`). The two smoke specs prove the json oracle and the Docker code
runner work out of the box:

- `calc-smoke-01` — POST `{"answer": 500500}` → `OK`.
- `code-smoke-01` — POST any non-empty unified diff → a busybox runner
  container reports one passing test → `OK`.

## The intent corpus (`intent-*.json`)

Natural-language intent tasks — the kind a page visitor would type — over
a fresh `acme-v1` workspace at seed 4242, across four apps: the
warehouse (orders, cancellations, transfers; stock, prices, customers,
orders), the helpdesk (assign, resolve, re-prioritise, comment, open, hold,
reopen, close, reassign; tickets, agents, SLA), the vault (documents,
datasheets, policies, account reviews, results) and the company's public
site (`intent-tasks.md` opens with the current counts). A `state` task is
checked by the verifier reading the app's own REST API afterwards — the
submitted artifact is ignored; a `json` task by its answer document.

- **`intent-*.json` are ANSWER KEYS. Never serve them.** Like every spec here
  they are hidden verifier input: they carry the exact ids, quantities and
  totals a correct agent has to arrive at on its own. They are mounted
  read-only into the verifier and nothing else — no app, page, feed or MCP
  tool may read from `/specs`.
- **`intent-tasks.json`** is the PUBLIC half: the corpus a consumer shows an
  agent — `[{id, surfaces, app, intent, oracle, summary}]`, the intent text
  and a one-line description of what is checked, with no answer in it.
  `surfaces` names the doors that can answer a task: `pages` (the app's web
  UI), `tools` (WebMCP / MCP), `nlweb` (its `/ask` index).
- **`intent-corpus.json`** is the public half WITH each task's answer key
  beside it (`key: {blind, oracle}`) — for a platform that grades the
  answers itself: a `json` task's `key.oracle.expect` is the answer document
  (every field must be present and equal — strings trimmed and
  case-insensitive, numbers exact or within `{value, tolerance}`); a `state`
  task is graded by submitting to this verifier after the agent is done.
- **`intent-tasks.md`** records how every answer was derived. Read it before
  changing a task.

## The webmcp-v1 corpus (`webmcp-*.json`)

The same kind of tasks over a fresh `webmcp-v1` workspace at seed 4242: the
nine sites from webmcp-tools (README § Sites from webmcp-tools) — hotels,
flights, dining, pizza, cinema, sports, homes, clinic and events, six task
kinds each, such as the only option that fits, none fits and the closest, a
total with fees, a write, the cheapest write that fits, and changing or
cancelling one of several. Its answer keys are `intent-<kind>-NN.json` files
like the rest (no id is in both corpora); its public files are
**`webmcp-tasks.json`**, **`webmcp-corpus.json`** and **`webmcp-tasks.md`**, the
twins of the three above. `node tools/intent-corpus.mjs` writes both corpora,
and `node tools/intent-integrity.mjs --scenario webmcp-v1` proves this one.
- **`tools/intent-corpus.mjs` regenerates all of them.** The first ten tasks
  are `tools/intent-corpus/original.mjs`; every other kind is a TEMPLATE in
  `tools/intent-corpus/templates/` (the contract is in its `index.mjs`),
  instantiated over distinct seeded rows with its answer derived from those
  rows — never typed by hand — so a different seed regenerates matching keys:

  ```bash
  node tools/intent-corpus.mjs --seed 4242 --out compose/specs   # --scale 2 doubles every template
  node tools/intent-corpus.mjs --check                           # CI: the committed files ARE the tool's output
  ```

  Hand-editing an `intent-*.json` is how an answer key drifts from the data it
  claims to describe; change the tool and re-run it instead.
- **`tools/intent-integrity.mjs` proves every task bites** against a running
  benchme serving these specs: every state task FAILS on a fresh workspace,
  PASSES once its reference solution has run through the REST API, and still
  passes after all of them ran; every json task accepts the answer read back
  from the LIVE apps and refuses a wrong one. It also signs an account up and
  in through MCP tools alone on every site whose tools sign in (the code read
  with the inbox's tools), so no door is a dead end. CI runs it on every
  change.

  ```bash
  docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait
  node tools/intent-integrity.mjs --base http://localhost:8080
  ```

The company site is static — built once, at image build time, from its own
seed (`DEFAULT_DATA_SEED` in `apps/data/src/site.ts`), the same pages for
every workspace — so its tasks are derived from that seed's company, not the
workspace's (the vault's memos describe the workspace's company; the two need
not agree). The mail app holds no seeded content (only the verification mail
a sign-up produces), so no task is about it.

## What a `state` check can ask

A `state` oracle is a list of named checks, run in order, all of which must
pass. Each is one of four kinds (`apps/verify/src/specs/spec.ts` has the
schema of each, `apps/verify/src/oracles/state/` the code). A check without a
`kind` is a `row` check, which is every check written before there were kinds.

```jsonc
// row: at least one row survives `where` and satisfies `expect` (count, rowPath as before).
// `entity` is optional: the row's entity in the site's ledger, its id filled from the row. With it, a passing
// check reports when the row was last written.
{ "name": "cancelled", "app": "hotels", "path": "/api/v1/bookings?guestEmail=ilsa%40example.com",
  "where": { "bookingNo": "BK-10001" }, "expect": { "status": "cancelled" },
  "entity": { "type": "booking", "id": "{bookingNo}" } }

// absent: no row survives `where` and (if given) satisfies `expect`. With neither, the list must be empty.
{ "kind": "absent", "name": "no second booking", "app": "hotels",
  "path": "/api/v1/bookings?guestEmail=ilsa%40example.com", "where": { "status": "confirmed" } }

// ledger: an entry of a site's change ledger matches. Every field of a matcher but `app` is optional (at least one
// is needed); `match` may be a list, of which any one will do; `after` names an earlier check, and only entries
// later than the one it stood on count. A read is "action": "read"; "actor": null is nobody signed in.
{ "kind": "ledger", "name": "looked, or was refused for the reason", "match": [
    { "app": "sports", "entity": { "type": "order", "id": "SO-1042" }, "action": "read" },
    { "app": "sports", "entity": { "type": "return" }, "action": "create", "outcome": "refused",
      "code": "RETURN_WINDOW_CLOSED", "door": "mcp", "actor": "ilsa@example.com" } ],
  "after": "signed in" }

// unchanged: the ledgers of `scope.apps` hold no successful write (optionally: by one actor, on one entity type
// or one entity), except the writes `except` names, as ledger matchers.
{ "kind": "unchanged", "name": "nothing changed",
  "scope": { "apps": ["sports"], "actor": "ilsa@example.com", "entity": { "type": "order" } },
  "except": [ { "app": "sports", "entity": { "type": "order", "id": "SO-2001" }, "action": "create" } ] }
```

The ledger is what README § The change ledger describes: the nine sites keep
one, and the verifier is its only reader. An `absent` or `unchanged` check
fails when what it reads cannot be read to the end, and a `ledger` or
`unchanged` check fails on an app that keeps no ledger: nothing seen is not
nothing done. A sign-up or a sign-in is an `auth` entry, never a write, so
`unchanged` does not count it and a `ledger` check can ask for it
(`"entity": { "type": "account", "id": "<email>" }, "action": "sign_in"`).

An impossible task (the site's rules make the request impossible) carries an
`unchanged` check AND a `ledger` check that the agent looked at the thing or
was refused with the expected reason, so an agent that did nothing does not
pass.

Add your own hidden tasks the same way (the schema is
`apps/verify/src/specs/spec.ts`; `tools/build-specs.mjs --configmap` shows the
`<taskId>.json` shape a hidden-tasks checkout produces). Restart the verifier
after adding files: `docker compose restart verify`.
