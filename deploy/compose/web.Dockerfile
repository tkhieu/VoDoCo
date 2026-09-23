# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

FROM ${NODE_IMAGE} AS build
WORKDIR /opt/vodoco/apps/web
RUN npm install --global npm@11.19.0
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/tsconfig.server.json ./
COPY apps/web/src ./src
COPY apps/web/server ./server
COPY apps/web/public ./public
COPY contracts/generated /opt/vodoco/contracts/generated
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /opt/vodoco/apps/web
COPY --from=build --chown=1000:1000 /opt/vodoco/apps/web/package.json ./
COPY --from=build --chown=1000:1000 /opt/vodoco/apps/web/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /opt/vodoco/apps/web/dist ./dist
COPY --from=build --chown=1000:1000 /opt/vodoco/apps/web/dist-server ./dist-server
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist-server/index.js"]
