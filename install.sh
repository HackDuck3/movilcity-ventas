#!/usr/bin/env bash
# Instalador para Raspberry Pi (Raspberry Pi OS 64-bit) o cualquier Debian/Ubuntu.
# Uso:  cd movilcity-ventas && bash install.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"
SERVICE=movilcity
RUN_USER="${SUDO_USER:-$USER}"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

echo
green "== Movil City · Control de ventas: instalación =="
echo "Carpeta: $APP_DIR"

ARCH="$(uname -m)"
if [[ "$ARCH" == "armv7l" || "$ARCH" == "armv6l" ]]; then
  red "Tu sistema es de 32 bits ($ARCH)."
  echo "Instala Raspberry Pi OS (64-bit) con Raspberry Pi Imager: la Pi 4 lo soporta y Node.js 22 lo necesita."
  exit 1
fi

# --- Node.js >= 22.13 (trae SQLite incorporado, no hace falta instalar nada más)
need_node=1
if command -v node >/dev/null 2>&1; then
  V="$(node -p 'process.versions.node')"
  MAJOR="${V%%.*}"; REST="${V#*.}"; MINOR="${REST%%.*}"
  if (( MAJOR > 22 || (MAJOR == 22 && MINOR >= 13) )); then need_node=0; fi
  echo "Node.js encontrado: v$V"
fi
if (( need_node )); then
  yellow "Instalando Node.js 22 LTS (NodeSource)..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "Node.js instalado: $(node -v)"
fi
NODE_BIN="$(command -v node)"

mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/data" 2>/dev/null || true

# --- Servicio systemd: arranca solo al encender la Pi y se reinicia si falla
yellow "Creando servicio del sistema '$SERVICE'..."
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=Movil City - Control de ventas
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server.js
Environment=PORT=$PORT
Environment=TZ=Europe/Madrid
Environment=NODE_ENV=production
Restart=always
RestartSec=3
# Límite de memoria (la app usa ~50 MB; la Pi de 2 GB va sobrada)
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sleep 2

if systemctl is-active --quiet $SERVICE; then
  echo
  green "¡Listo! La aplicación está funcionando."
  echo
  echo "  Ábrela desde cualquier móvil, tablet u ordenador de la misma red WiFi:"
  for ip in $(hostname -I); do [[ "$ip" == *.* ]] && echo "    http://$ip:$PORT"; done
  echo "    http://$(hostname).local:$PORT"
  echo
  echo "  La primera vez te pedirá crear la cuenta del administrador (dueño)."
  echo
  echo "  Comandos útiles:"
  echo "    sudo systemctl status $SERVICE     # ver estado"
  echo "    sudo systemctl restart $SERVICE    # reiniciar tras cambiar código"
  echo "    journalctl -u $SERVICE -f          # ver registros en vivo"
  echo
else
  red "El servicio no ha arrancado. Revisa:  journalctl -u $SERVICE -n 50"
  exit 1
fi
