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
| `apps/warehouse` | the first app: signup/verify/login, SSR UI, REST v1, a 14-tool MCP server |
| `apps/mail` | per-workspace inbox with an internal delivery endpoint |
| `apps/data` | the generated company site |
| `charts/benchme` | the Helm chart: own postgres + redis, apps, migrate job, reaper, ingress |
| `docker/app.Dockerfile` | one multi-stage Dockerfile, `--build-arg APP=<app>` |

## Develop

```bash
npm ci
docker run -d --name benchme-pg -e POSTGRES_PASSWORD=benchme -e POSTGRES_USER=benchme -e POSTGRES_DB=benchme -p 15432:5432 postgres:16
DATABASE_URL=postgres://benchme:benchme@127.0.0.1:15432/benchme npm test   # real Postgres, no mocks
npx tsc -b tsconfig.build.json
```

## Release

Tag `vX.Y.Z`: the `images` workflow pushes `ghcr.io/orabenchmarks/<app>:X.Y.Z`
and the `chart` workflow pushes `oci://ghcr.io/orabenchmarks/charts/benchme:X.Y.Z`.
Packages are public so clusters pull anonymously; the source stays private
until publication.

```bash
helm install benchme oci://ghcr.io/orabenchmarks/charts/benchme --version X.Y.Z -n benchme --create-namespace \
  --set ingress.host=benchme.example.test --set publicBaseUrl=http://benchme.example.test
```
