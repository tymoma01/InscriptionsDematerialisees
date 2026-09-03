# syntax=docker/dockerfile:1

# Image du back-end (API Express) — moteur générique d'inscription dématérialisée.
# Sert aussi le build statique du front (React/Vite) depuis le même conteneur (décision : éviter
# un coût Azure supplémentaire, et garder la résolution d'entité par sous-domaine sans
# complication de proxy/CORS/cookies cross-origin — voir backend/src/app.js).
# Contexte de build : la RACINE DU REPO, pas backend/ (nécessaire pour pouvoir COPY frontend/
# dans le stage frontend-build ci-dessous) :
#   docker build -f backend/Dockerfile -t <tag> .
# Cible : Azure Container Apps (plan Consumption), image poussée sur ghcr.io.

# Node 22 requis (pas 20) : le lockfile résout des versions d'@azure/identity et de ses
# dépendances (@azure/core-tracing, @azure/logger, @typespec/ts-http-runtime) qui exigent
# engines.node >=22 ; par ailleurs le binding natif argon2@0.45.1 (prebuild linux-arm64-musl)
# segfault au chargement sous Node 20 sur cette architecture — reproduit dans une image
# node:20-alpine officielle et non liée à cette machine. Confirmé fonctionnel sous node:22-alpine.

# ---- Stage 1 : dépendances de production du back-end ----
FROM node:22-alpine AS deps

WORKDIR /app

# COPY séparé du package.json/lockfile : cette couche ne change (et n'invalide le cache) que
# lorsque les dépendances changent, pas à chaque modification du code source.
COPY backend/package.json backend/package-lock.json ./

# npm ci --omit=dev : lockfile respecté à l'identique (contrairement à npm install), pas les
# devDependencies (eslint...) qui n'ont rien à faire dans l'image finale.
RUN npm ci --omit=dev

# ---- Stage 2 : build du front (React/Vite) ----
FROM node:22-alpine AS frontend-build

WORKDIR /frontend

# Même logique de cache que le stage deps ci-dessus : lockfile avant le reste du code.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- Stage 3 : image finale minimale ----
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
COPY backend/package.json ./
COPY backend/knexfile.js ./
COPY backend/src ./src
COPY backend/scripts ./scripts
# Build statique du front, servi par express.static (voir backend/src/app.js,
# REPERTOIRE_PUBLIC = path.join(__dirname, '../public') = /app/public depuis /app/src).
COPY --from=frontend-build /frontend/dist ./public

# Le NIR, la connection string Neon, etc. viennent d'Azure Key Vault via Managed Identity
# (DefaultAzureCredential) à l'exécution — aucun .env ni secret n'est copié dans l'image (voir
# .dockerignore).

USER app

EXPOSE $PORT

# Pas de HEALTHCHECK : le back-end n'expose actuellement aucune route de santé (ex. /health).
# À ajouter ici dès qu'une telle route existera côté application.

CMD ["node", "src/server.js"]
