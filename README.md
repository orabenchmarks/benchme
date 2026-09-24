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
| `apps/verify` | the verifier: json / xlsx / docx / patch / **state** oracles (state reads the app's own REST API after the fact — end state is the evidence, the artifact is ignored), HMAC receipts, attempt log, isolated Kubernetes Job runner; the six intent tasks it ships with are described in [`compose/specs/intent-tasks.md`](compose/specs/intent-tasks.md) |
| `apps/mail` | per-workspace inbox with an internal delivery endpoint |
| `apps/data` | the generated company site |
| `charts/benchme` | the Helm chart: own postgres + redis, apps, migrate job, reaper, ingress |
| `docker/app.Dockerfile` | one multi-stage Dockerfile, `--build-arg APP=<app>` |

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
  at the gateway's **host root** (`/robots.txt`, disallowing the whole
  per-run `/w/` tree except a `schemamap:` line per ask-capable app pointing at
  the ONE long-lived shared workspace — so an answer engine has a stable,
  crawlable URL even though every minted workspace is disposable). The static
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

Two chart inputs cannot travel through `helm template`:

- **Secrets.** By default the chart generates its five secrets on first
  install and keeps them with a `lookup` — a rendering that has no cluster
  (ArgoCD's repo-server) would mint new values on every sync and rotate the
  Postgres password. Provide a Secret yourself (an ExternalSecret from your
  secret manager, keys `gatewaySecret`, `operatorKey`, `receiptSecret`,
  `mailInternalSecret`, `postgresPassword`) and name it in
  `secrets.existingSecret`. Two more keys, `llmApiKey` and `jevApiKey` (the
  provider credentials for the `llm`/`jev` rankers — see § Rankers), are read
  as `optional: true`: omit them from your Secret entirely while running the
  default `lexical` ranker, add them only for the deployments that select
  `llm`/`jev`.
- **Hidden task specs.** Never commit them. Build a ConfigMap from your
  hidden-tasks checkout and apply it out-of-band, then name it in
  `verify.existingSpecsConfigMap` (the chart renders no specs ConfigMap of its
  own and mounts yours at `/specs`):

  ```bash
  node tools/build-specs.mjs --hidden ../benchme-hidden \
    --configmap benchme-task-specs-hidden --namespace benchme --out specs-cm.yaml
  kubectl -n benchme apply -f specs-cm.yaml     # re-run after every hidden-tasks change
  ```
