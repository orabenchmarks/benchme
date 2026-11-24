# syntax=docker/dockerfile:1.7
# One Dockerfile for every app: `--build-arg APP=<gateway|warehouse|helpdesk|hotels|flights|dining|pizza|cinema|sports|homes|clinic|events|vaultdocs|mail|data|verify|shops|wallet|guide>`.
# deps → build (tsc, plus the data site render) → runtime (slim, non-root,
# read-only root fs friendly: nothing writes under /app at run time).
# Only the runtime stage reads APP. The deps and build stages are the same for
# every app, so one compose build of all the images (CI's intent-integrity job,
# 19 images with bake) runs npm ci and tsc once and shares them; with APP in
# the build stage, 19 concurrent tsc runs starved the runner's memory.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.build.json ./
COPY packages/core/package.json packages/core/
COPY packages/scenarios/package.json packages/scenarios/
COPY packages/site-kit/package.json packages/site-kit/
COPY packages/storefront/package.json packages/storefront/
COPY apps/gateway/package.json apps/gateway/
COPY apps/helpdesk/package.json apps/helpdesk/
COPY apps/hotels/package.json apps/hotels/
COPY apps/flights/package.json apps/flights/
COPY apps/dining/package.json apps/dining/
COPY apps/pizza/package.json apps/pizza/
COPY apps/cinema/package.json apps/cinema/
COPY apps/sports/package.json apps/sports/
COPY apps/homes/package.json apps/homes/
COPY apps/clinic/package.json apps/clinic/
COPY apps/events/package.json apps/events/
COPY apps/vaultdocs/package.json apps/vaultdocs/
COPY apps/warehouse/package.json apps/warehouse/
COPY apps/mail/package.json apps/mail/
COPY apps/data/package.json apps/data/
COPY apps/verify/package.json apps/verify/
COPY apps/shops/package.json apps/shops/
COPY apps/wallet/package.json apps/wallet/
COPY apps/guide/package.json apps/guide/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY packages ./packages
COPY apps ./apps
# Compile from the sources alone. A checkout's own build outputs (dist/, *.tsbuildinfo:
# always some in a developer's, and CI's intent-integrity job compiles before it builds)
# would make `tsc -b` answer "up to date" and ship them as they are, files of
# since-deleted sources included. .dockerignore keeps them (and node_modules, caches,
# reports) out of the context; the rm below is the backstop should one get through.
# The data site is rendered for every image (a few files, seconds); only the data
# image's runtime stage copies it.
RUN find packages apps -mindepth 2 -maxdepth 2 \( -name dist -o -name '*.tsbuildinfo' \) -exec rm -rf {} + \
 && npx tsc -b tsconfig.build.json \
 && node apps/data/dist/build.js \
 && npm prune --omit=dev --no-audit --no-fund
# The gateway's scenario pages list each corpus's PUBLIC tasks, read from apps/gateway/tasks
# (apps/gateway/src/landing/task-lists.ts). Only the public lists, each by name: never a keyed
# corpus (*-corpus.json) or an answer key (<id>.json). A gateway test holds this line to the
# scenarios' own lists. After the compile, so a changed list does not re-run it; only the
# gateway image's runtime stage copies apps/gateway.
COPY compose/specs/intent-tasks.json compose/specs/webmcp-tasks.json compose/specs/cuj-tasks.json ./apps/gateway/tasks/

FROM ${NODE_IMAGE} AS runtime
ARG APP
ENV NODE_ENV=production APP=${APP}
WORKDIR /app
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app
COPY --from=build --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=build --chown=1001:1001 /app/package.json ./package.json
COPY --from=build --chown=1001:1001 /app/packages ./packages
# The whole app directory: dist/, migrations/ and any static files it serves (apps/shops/public).
COPY --from=build --chown=1001:1001 /app/apps/${APP} ./apps/${APP}
USER 1001
EXPOSE 3000
# The chart overrides the command for migrate/reap jobs (node apps/<app>/dist/<entry>.js).
CMD ["sh", "-c", "exec node apps/${APP}/dist/server.js"]
