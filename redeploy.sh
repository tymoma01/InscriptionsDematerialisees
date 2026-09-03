#!/usr/bin/env bash
# Rebuild + push l'image back-end (qui sert aussi le front, voir backend/Dockerfile) vers ghcr.io,
# et met à jour la Container App si les variables Azure sont renseignées.
#
# Usage :
#   ./redeploy.sh                # build + push
#   ./redeploy.sh --no-push      # build seulement (test local)
#   ./redeploy.sh --deploy       # build + push + met à jour la Container App (voir variables ci-dessous)
#
# Variables d'environnement optionnelles (pour --deploy) :
#   AZ_CONTAINERAPP_NAME   nom de la Container App
#   AZ_RESOURCE_GROUP      resource group Azure correspondant
#
# Exemple (remplacer <...> par les vraies valeurs — volontairement pas de vrais noms ici, repo public) :
#   AZ_CONTAINERAPP_NAME=<nom-container-app> AZ_RESOURCE_GROUP=<resource-group> ./redeploy.sh --deploy

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# Sur certaines installations Docker Desktop (macOS), le binaire docker n'est pas dans le PATH
# de tous les shells tant que le terminal n'a pas été redémarré après l'installation.
export PATH="$HOME/.docker/bin:$PATH"

IMAGE="ghcr.io/tymoma01/inscriptionsdematerialisees-backend"
SHA_COURT="$(git rev-parse --short HEAD)"

MODE_PUSH=1
MODE_DEPLOY=0
for arg in "$@"; do
  case "$arg" in
    --no-push) MODE_PUSH=0 ;;
    --deploy) MODE_DEPLOY=1 ;;
    *) echo "Argument inconnu : $arg (usage: --no-push | --deploy)" >&2; exit 1 ;;
  esac
done

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Modifications non commitées détectées — l'image sera construite avec l'état actuel du" \
       "répertoire de travail, pas avec un commit versionné (le tag ${SHA_COURT} ne sera pas fiable)."
fi

if [ "$MODE_PUSH" -eq 0 ]; then
  # Azure Container Apps tourne en linux/amd64 uniquement (voir plus bas), mais une image
  # multi-plateforme ne peut pas être chargée dans le docker local (--load) pour un test rapide —
  # seule une image mono-plateforme le peut. Ce mode ne construit donc QUE pour l'architecture de
  # cette machine, pour un test local ; ce n'est pas ce qui part en prod (voir mode par défaut).
  echo "→ Build local (arch native, --load) pour test — PAS l'image qui part en prod..."
  docker build -f backend/Dockerfile -t "${IMAGE}:latest" .
  echo "✓ Build terminé (--no-push : pas de push, pas de déploiement)."
  exit 0
fi

# --platform linux/amd64,linux/arm64 : Azure Container Apps (la cible de prod) ne tourne qu'en
# linux/amd64, alors que cette machine est arm64 (Apple Silicon) — un simple "docker build" sans
# --platform produirait une image arm64 incompatible avec ACA. linux/arm64 est ajouté en plus
# (image multi-plateforme unique) pour pouvoir aussi "docker run" nativement sur ce Mac sans
# émulation QEMU si besoin de tester après coup. buildx (docker-container driver, QEMU intégré à
# Docker Desktop) gère la cross-compilation ; --push est obligatoire ici : une image
# multi-plateforme ne peut pas être chargée dans le docker local, seulement poussée au registre.
echo "→ Build multi-plateforme (linux/amd64,linux/arm64) + push vers ghcr.io..."
docker buildx build --platform linux/amd64,linux/arm64 \
  -f backend/Dockerfile \
  -t "${IMAGE}:latest" \
  -t "${IMAGE}:${SHA_COURT}" \
  --push \
  .

echo "✓ Image poussée : ${IMAGE}:latest et ${IMAGE}:${SHA_COURT}"

if [ "$MODE_DEPLOY" -eq 0 ]; then
  echo "  (--deploy non demandé : la Container App n'a pas été mise à jour.)"
  exit 0
fi

if [ -z "${AZ_CONTAINERAPP_NAME:-}" ] || [ -z "${AZ_RESOURCE_GROUP:-}" ]; then
  echo "✗ --deploy demandé mais AZ_CONTAINERAPP_NAME et/ou AZ_RESOURCE_GROUP ne sont pas renseignés." >&2
  echo "  Exemple : AZ_CONTAINERAPP_NAME=inscriptions-backend AZ_RESOURCE_GROUP=rg-accecit ./redeploy.sh --deploy" >&2
  exit 1
fi

echo "→ Mise à jour de la Container App '${AZ_CONTAINERAPP_NAME}' (resource group '${AZ_RESOURCE_GROUP}')..."
az containerapp update \
  --name "$AZ_CONTAINERAPP_NAME" \
  --resource-group "$AZ_RESOURCE_GROUP" \
  --image "${IMAGE}:${SHA_COURT}"

echo "✓ Déployé : ${IMAGE}:${SHA_COURT}"
