# Versions pinned (update on purpose: here, .nvmrc and .github/workflows/ci.yml).
# dev  : Vite dev server (compose.yaml, with Traefik)
# prod : one small image: the built game + the multiplayer server, both on port 3000 (compose.prod.yml)
FROM node:22.23.2-alpine AS dev
WORKDIR /app
# Manifests first: `npm ci` stays cached while dependencies don't change.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]

FROM dev AS build
RUN npm run build

FROM node:22.23.2-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
# The server runs its TypeScript directly (Node strips the types); it needs the shared net code.
COPY server server
COPY src/net src/net
COPY --from=build /app/dist dist
USER node
EXPOSE 3000
CMD ["node", "server/index.ts"]
