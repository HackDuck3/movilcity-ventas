#!/usr/bin/env bash
# Pone tu usuario de GitHub en los ficheros de Umbrel y Docker.
# Uso:  bash scripts/configurar-github.sh tu-usuario
set -euo pipefail
U="${1:-}"
[[ -z "$U" ]] && { echo "Uso: bash scripts/configurar-github.sh TU_USUARIO_DE_GITHUB"; exit 1; }
U_LOWER="$(echo "$U" | tr '[:upper:]' '[:lower:]')"
cd "$(dirname "$0")/.."
for f in atik-movilcity/umbrel-app.yml atik-movilcity/docker-compose.yml docker-compose.yml; do
  # la imagen de Docker tiene que ir en minúsculas; las URLs de GitHub dan igual
  sed -i.bak -e "s#ghcr.io/TU_USUARIO_GITHUB#ghcr.io/$U_LOWER#g" -e "s#TU_USUARIO_GITHUB#$U#g" "$f" && rm -f "$f.bak"
done
echo "Listo. Ficheros actualizados con el usuario: $U"
grep -n "image:" atik-movilcity/docker-compose.yml docker-compose.yml
