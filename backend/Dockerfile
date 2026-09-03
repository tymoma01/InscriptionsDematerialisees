# syntax=docker/dockerfile:1

# Image du back-end (API Express) — moteur générique d'inscription dématérialisée.
# Contexte de build attendu : backend/ (docker build -f backend/Dockerfile backend/).
# Cible : Azure Container Apps (plan Consumption), image poussée sur ghcr.io.
# Pas de front-end ici : la web-app React/Vite est buildée et hébergée séparément.

# Node 22 requis (pas 20) : le lockfile résout des versions d'@azure/identity et de ses
# dépendances (@azure/core-tracing, @azure/logger, @typespec/ts-http-runtime) qui exigent
# engines.node >=22 ; par ailleurs le binding natif argon2@0.45.1 (prebuild linux-arm64-musl)
# segfault au chargement sous Node 20 sur cette architecture — reproduit dans une image
# node:20-alpine officielle et non liée à cette machine. Confirmé fonctionnel sous node:22-alpine.

# ---- Stage 1 : installation des dépendances de production ----
FROM node:22-alpine AS deps

WORKDIR /app

# COPY séparé du package.json/lockfile : cette couche ne change (et n'invalide le cache) que
# lorsque les dépendances changent, pas à chaque modification du code source.
COPY package.json package-lock.json ./

# npm ci --omit=dev : lockfile respecté à l'identique (contrairement à npm install), pas les
# devDependencies (eslint...) qui n'ont rien à faire dans l'image finale.
RUN npm ci --omit=dev

# ---- Stage 2 : image finale minimale ----
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
# Container Apps route le trafic vers ce port ; valeur par défaut alignée sur
# backend/src/config/env.js (PORT ?? 3000), surchargeable via variable d'environnement.
ENV PORT=3000

WORKDIR /app

# Utilisateur non-root dédié (plutôt que l'utilisateur "node" de l'image de base, pour un uid/gid
# explicite et prévisible dans Container Apps).
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY knexfile.js ./
COPY src ./src
COPY scripts ./scripts

# Le NIR, la connection string Neon, etc. viennent d'Azure Key Vault via Managed Identity
# (DefaultAzureCredential) à l'exécution — aucun .env ni secret n'est copié dans l'image (voir
# .dockerignore).

USER app

EXPOSE $PORT

# Pas de HEALTHCHECK : le back-end n'expose actuellement aucune route de santé (ex. /health).
# À ajouter ici dès qu'une telle route existera côté application.

CMD ["node", "src/server.js"]
