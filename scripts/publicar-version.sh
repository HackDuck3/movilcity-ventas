#!/usr/bin/env bash
# Publica una versión nueva: cambia el número en todos los ficheros, crea la etiqueta y la sube a GitHub.
# GitHub construye la imagen (unos 3-5 min) y después Umbrel te ofrecerá "Actualizar" la app.
# Uso:  bash scripts/publicar-version.sh 1.2.0
set -euo pipefail
V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Uso: bash scripts/publicar-version.sh 1.2.0"; exit 1; }
cd "$(dirname "$0")/.."
sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"$V\"/" package.json
sed -i.bak -E "s/^version: \".*\"/version: \"$V\"/" atik-movilcity/umbrel-app.yml
sed -i.bak -E "s#(image: ghcr.io/[^:]+/movilcity-ventas:)[0-9.]+#\1$V#" atik-movilcity/docker-compose.yml
rm -f package.json.bak atik-movilcity/*.bak
git add -A
git commit -m "Versión $V"
git tag "v$V"
git push
git push origin "v$V"
echo
echo "Subida la versión $V. Mira la pestaña Actions de GitHub: cuando esté en verde, ve a Umbrel → App Store → Atik y pulsa Actualizar."
