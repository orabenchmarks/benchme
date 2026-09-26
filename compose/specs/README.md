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
  from the LIVE apps and refuses a wrong one. CI runs it on every change.

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

Add your own hidden tasks the same way (the schema is
`apps/verify/src/specs/spec.ts`; `tools/build-specs.mjs --configmap` shows the
`<taskId>.json` shape a hidden-tasks checkout produces). Restart the verifier
after adding files: `docker compose restart verify`.
