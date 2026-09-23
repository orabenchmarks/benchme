# Task specs for `docker compose`

Every `<taskId>.json` here is mounted read-only at `/specs` in the verifier
(`SPECS_DIR`). The two smoke specs prove the json oracle and the Docker code
runner work out of the box:

- `calc-smoke-01` — POST `{"answer": 500500}` → `OK`.
- `code-smoke-01` — POST any non-empty unified diff → a busybox runner
  container reports one passing test → `OK`.

## The intent corpus (`intent-*.json`)

Six natural-language intent tasks — the kind a page visitor would type — over
a fresh `acme-v1` workspace at seed 4242: `intent-order-01`,
`intent-transfer-01`, `intent-stock-01`, `intent-lowstock-01`,
`intent-ticket-01` (warehouse/helpdesk state or json oracles) and
`intent-doc-01` (vaultdocs). Two land at the `json` oracle (the agent submits
an answer document); four at the `state` oracle (the verifier reads the app's
own REST API afterwards and checks the live row — the submitted artifact is
ignored).

- **`intent-*.json` are ANSWER KEYS. Never serve them.** Like every spec here
  they are hidden verifier input: they carry the exact ids, quantities and
  totals a correct agent has to arrive at on its own. They are mounted
  read-only into the verifier and nothing else — no app, page, feed or MCP
  tool may read from `/specs`.
- **`intent-tasks.json`** is the PUBLIC half: the corpus a consumer copies
  into its own benchmark — `[{id, app, intent, oracle, summary}]`, the intent
  text and a one-line description of what is checked, with no answer in it.
- **`intent-tasks.md`** records each task's prerequisites and exactly how its
  ground truth was derived. Read it before changing a task.
- **`tools/intent-corpus.mjs` regenerates all three** — every derived value
  comes from `@benchme/scenarios`' generator or its `answers.ts` helpers,
  never typed by hand, so a different seed regenerates matching specs and
  manifest together:

  ```bash
  node tools/intent-corpus.mjs --seed 4242 --out compose/specs
  ```

  Hand-editing an `intent-*.json` is how an answer key drifts from the data it
  claims to describe; change the tool and re-run it instead.

Add your own hidden tasks the same way (the schema is
`apps/verify/src/specs/spec.ts`; `tools/build-specs.mjs --configmap` shows the
`<taskId>.json` shape a hidden-tasks checkout produces). Restart the verifier
after adding files: `docker compose restart verify`.
