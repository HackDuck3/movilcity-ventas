#!/usr/bin/env bash
# Releases a new version: runs the tests, bumps the version everywhere, commits, tags and pushes.
# GitHub Actions then builds the Docker image (3-5 min) and Umbrel offers the update.
# Usage:  bash scripts/release.sh 1.2.0
set -euo pipefail
V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Uso: bash scripts/release.sh 1.2.0"; exit 1; }
cd "$(dirname "$0")/.."
npm test
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
