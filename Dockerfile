# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-alpine AS build

WORKDIR /app

# pnpm via corepack (livre avec Node) : pas d'installation globale a gerer.
RUN corepack enable pnpm

# Couche dependances separee : reconstruite seulement si le manifeste change.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# `pnpm build` = tsc --noEmit && vite build : le type-check echoue le build.
RUN pnpm build

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# 127.0.0.1 et non `localhost` : dans le conteneur, `localhost` resout d'abord en ::1
# alors que nginx n'ecoute qu'en IPv4 — le healthcheck echouait donc toujours
# (« connection refused ») et le conteneur se declarait unhealthy en servant du 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
