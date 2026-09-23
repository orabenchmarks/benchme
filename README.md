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
| `apps/verify` | the verifier: json / xlsx / docx / patch oracles, HMAC receipts, attempt log, isolated Kubernetes Job runner |
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
  single JSON response instead. There is no `stream` parameter. An SSE
  response frames, in order, a `license` message, a `data_retention` message,
  the `results` (plus a `ranker` message if the ranker degraded), and always
  terminates with a `complete` frame — even on failure, so a client never
  hangs waiting for an end that isn't coming.
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
| `RANKER_CONCURRENCY` | `8` | in-flight upstream requests per `/ask`; one request per candidate |
| `ASK_RANKER_OVERRIDE` | `0` | enables an `X-Ask-Ranker` per-request override on `/ask` — evaluations only, see below |

## Evaluate the rankers

```bash
node tools/ask-eval.mjs --base <gateway> --rankers lexical,llm,jev --out ask-eval
```

Drives `/ask` on a workspace behind `<gateway>` with every ranker named in
`--rankers` (via the `X-Ask-Ranker` override — set `ASK_RANKER_OVERRIDE=1` on
the deployment first) and writes the comparison to `--out`, so the three arms
of the grid are scored against one running deployment instead of three
separately-configured ones.

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
