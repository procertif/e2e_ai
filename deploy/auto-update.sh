#!/bin/sh
# Auto-update de l'app sur la machine de déploiement (option A).
# Lancé par systemd (e2e-update.timer) toutes les 5 minutes :
#   nouveau commit sur main ? -> pull --ff-only + docker compose up -d --build
#
# Authentification : le repo étant public, aucun token n'est nécessaire.
# Si un jour il redevient privé, poser dans le .env de l'app un PAT GitHub
# *fine-grained, lecture seule* (Contents: Read-only, scopé au seul repo) :
#   DEPLOY_REPO_PAT=github_pat_xxx
# L'URL est alors passée explicitement au fetch — le token n'est jamais
# écrit dans .git/config ni ailleurs sur disque que le .env (600, root).
#
# Intervalle entre deux vérifications, configurable dans le même .env :
#   DEPLOY_UPDATE_INTERVAL_SECONDS=300   (défaut : 300)
# Le timer systemd tick toutes les minutes ; ce script s'auto-limite via un
# fichier d'horodatage — changer l'intervalle ne demande donc AUCUN
# daemon-reload, la nouvelle valeur s'applique au tick suivant.
set -eu

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL_BASE="github.com/procertif/e2e_ai.git"
cd "$APP_DIR"

INTERVAL="$(grep -E '^DEPLOY_UPDATE_INTERVAL_SECONDS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
case "${INTERVAL:-}" in ''|*[!0-9]*) INTERVAL=300 ;; esac
STAMP="/var/tmp/e2e-auto-update.stamp"
NOW="$(date +%s)"
LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
if [ $((NOW - LAST)) -lt "$INTERVAL" ]; then
	exit 0 # intervalle pas écoulé
fi
echo "$NOW" > "$STAMP"

PAT="$(grep -E '^DEPLOY_REPO_PAT=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [ -n "${PAT:-}" ]; then
	REMOTE_URL="https://x-access-token:${PAT}@${REPO_URL_BASE}"
else
	REMOTE_URL="https://${REPO_URL_BASE}" # repo public — fetch anonyme
fi

git fetch --quiet "$REMOTE_URL" main

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse FETCH_HEAD)"
if [ "$LOCAL" = "$REMOTE" ]; then
	exit 0 # à jour — cas nominal, silencieux
fi

echo "[auto-update] $(date -Is) — mise à jour $LOCAL -> $REMOTE"
# --ff-only : refuse d'écraser des modifications locales de la machine —
# dans ce cas on log et on laisse un humain trancher.
if ! git merge --ff-only FETCH_HEAD; then
	echo "[auto-update] fast-forward impossible (commits locaux ?) — intervention manuelle requise." >&2
	exit 1
fi

# Rebuild + recréation. Si le build échoue, compose laisse l'ancien
# conteneur en place — le prochain tick retentera.
docker compose up -d --build

echo "[auto-update] déployé : $(git rev-parse --short HEAD)"
