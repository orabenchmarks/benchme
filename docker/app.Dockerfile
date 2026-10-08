# syntax=docker/dockerfile:1.7
# One Dockerfile for every app: `--build-arg APP=<gateway|warehouse|helpdesk|vaultdocs|mail|data|verify|shops|wallet>`.
# deps → build (tsc, plus the data site render) → runtime (slim, non-root,
# read-only root fs friendly: nothing writes under /app at run time).
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
COPY apps/vaultdocs/package.json apps/vaultdocs/
COPY apps/warehouse/package.json apps/warehouse/
COPY apps/mail/package.json apps/mail/
COPY apps/data/package.json apps/data/
COPY apps/verify/package.json apps/verify/
COPY apps/shops/package.json apps/shops/
COPY apps/wallet/package.json apps/wallet/
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG APP
COPY packages ./packages
COPY apps ./apps
# Compile from the sources alone. A checkout's own build outputs (dist/, *.tsbuildinfo:
# always some in a developer's, and CI's intent-integrity job compiles before it builds)
# would make `tsc -b` answer "up to date" and ship them as they are, files of
# since-deleted sources included. .dockerignore keeps them (and node_modules, caches,
# reports) out of the context; the rm below is the backstop should one get through.
RUN find packages apps -mindepth 2 -maxdepth 2 \( -name dist -o -name '*.tsbuildinfo' \) -exec rm -rf {} + \
 && npx tsc -b tsconfig.build.json \
 && if [ "$APP" = "data" ]; then node apps/data/dist/build.js; fi \
 && npm prune --omit=dev --no-audit --no-fund

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
