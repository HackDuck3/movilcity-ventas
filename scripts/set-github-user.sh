#!/usr/bin/env bash
# Writes your GitHub username into the Umbrel and Docker files.
# Usage:  bash scripts/set-github-user.sh your-username
set -euo pipefail
U="${1:-}"
[[ -z "$U" ]] && { echo "Uso: bash scripts/set-github-user.sh TU_USUARIO_DE_GITHUB"; exit 1; }
U_LOWER="$(echo "$U" | tr '[:upper:]' '[:lower:]')"
cd "$(dirname "$0")/.."
for f in atik-movilcity/umbrel-app.yml atik-movilcity/docker-compose.yml docker-compose.yml; do
  # Docker image names must be lowercase; GitHub URLs are case-insensitive
  sed -i.bak -e "s#ghcr.io/TU_USUARIO_GITHUB#ghcr.io/$U_LOWER#g" -e "s#TU_USUARIO_GITHUB#$U#g" "$f" && rm -f "$f.bak"
done
echo "Listo. Ficheros actualizados con el usuario: $U"
grep -n "image:" atik-movilcity/docker-compose.yml docker-compose.yml
