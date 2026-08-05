# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-alpine AS build

WORKDIR /app

# Couche dependances separee : reconstruite seulement si package*.json change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `npm run build` = tsc --noEmit && vite build : le type-check echoue le build.
RUN npm run build

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
