# Task specs for `docker compose`

Every `<taskId>.json` here is mounted read-only at `/specs` in the verifier
(`SPECS_DIR`). The two smoke specs prove the json oracle and the Docker code
runner work out of the box:

- `calc-smoke-01` — POST `{"answer": 500500}` → `OK`.
- `code-smoke-01` — POST any non-empty unified diff → a busybox runner
  container reports one passing test → `OK`.

Add your own hidden tasks the same way (the schema is
`apps/verify/src/specs/spec.ts`; `tools/build-specs.mjs --configmap` shows the
`<taskId>.json` shape a hidden-tasks checkout produces). Restart the verifier
after adding files: `docker compose restart verify`.
