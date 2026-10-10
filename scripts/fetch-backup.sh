#!/usr/bin/env bash
# Runs on ANOTHER computer (Mac or Linux): downloads today's encrypted full copy and keeps the latest ones.
# Settings are read from ~/.movilcity-backup.env:
#   APP_URL=http://100.x.y.z:4747      address of the app as this computer reaches it
#   BACKUP_TOKEN=...                   from Ajustes → Datos y copias
#   BACKUP_DIR="$HOME/Copias Movil City"   optional; a folder synced to the cloud keeps a copy off-site
#   KEEP=30                            optional; how many copies to keep
# See docs/COPIAS.md.
set -euo pipefail
source "$HOME/.movilcity-backup.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Copias Movil City}"
KEEP="${KEEP:-30}"

mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/movilcity-$(date +%F).mcbackup"
curl -fsS --max-time 1800 -H "Authorization: Bearer $BACKUP_TOKEN" "$APP_URL/api/backup/full" -o "$target.part"
mv "$target.part" "$target"

ls -1t "$BACKUP_DIR"/movilcity-*.mcbackup | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
echo "$(date '+%F %T') copia guardada: $target ($(du -h "$target" | cut -f1))"
