#!/bin/bash
# Convierte una Raspberry Pi con pantalla en el panel de casa de Odín.
#
# Se ejecuta EN LA PI DE LA PANTALLA (no en la de Home Assistant), con
# Raspberry Pi OS de escritorio ya instalado:
#
#   bash kiosco-pi.sh http://homeassistant.local:8123/panel-casa/casa http://mac-de-angela.local:5173
#
#   1.º  la dirección del panel de Home Assistant
#   2.º  (opcional) la dirección de Odín en el Mac, para que pueda usar el micrófono
#
# Hace tres cosas: arrancar el escritorio sin pedir contraseña, que la pantalla
# no se apague, y abrir Chromium a pantalla completa en el panel al encender.
# Para deshacerlo: borra la línea «odin-kiosco» de ~/.config/labwc/autostart.

set -euo pipefail

PANEL_URL="${1:-}"
ODIN_URL="${2:-}"
if [[ -z "$PANEL_URL" ]]; then
  echo "Uso: bash kiosco-pi.sh <dirección del panel> [dirección de Odín]"
  echo "Ej.: bash kiosco-pi.sh http://homeassistant.local:8123/panel-casa/casa http://mac-de-angela.local:5173"
  exit 1
fi

CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
if [[ -z "$CHROMIUM" ]]; then
  echo "Instalando Chromium…"
  sudo apt-get update && sudo apt-get install -y chromium
  CHROMIUM="$(command -v chromium)"
fi

echo "Escritorio con inicio de sesión automático…"
sudo raspi-config nonint do_boot_behaviour B4

echo "Pantalla siempre encendida…"
sudo raspi-config nonint do_blanking 1

# Odín se sirve por http en casa; sin esta excepción Chromium no le daría el
# micrófono. Solo para esa dirección, nada más.
FLAGS=(--kiosk --noerrdialogs --disable-infobars --no-first-run
  --disable-session-crashed-bubble --password-store=basic
  --disable-features=Translate)
if [[ -n "$ODIN_URL" ]]; then
  ODIN_ORIGIN="$(echo "$ODIN_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"
  FLAGS+=(--unsafely-treat-insecure-origin-as-secure="$ODIN_ORIGIN")
fi

LINE="$CHROMIUM ${FLAGS[*]} '$PANEL_URL' &  # odin-kiosco"

if command -v labwc >/dev/null; then
  # Raspberry Pi OS actual (Wayland con labwc).
  AUTOSTART="$HOME/.config/labwc/autostart"
  mkdir -p "$(dirname "$AUTOSTART")"
  touch "$AUTOSTART"
  sed -i '/# odin-kiosco$/d' "$AUTOSTART"
  echo "$LINE" >> "$AUTOSTART"
elif [[ -f "$HOME/.config/wayfire.ini" ]]; then
  # Raspberry Pi OS Bookworm antiguo (Wayfire).
  AUTOSTART="$HOME/.config/wayfire.ini"
  sed -i '/^odin_kiosco = /d' "$AUTOSTART"
  grep -q '^\[autostart\]' "$AUTOSTART" || printf '\n[autostart]\n' >> "$AUTOSTART"
  sed -i "/^\[autostart\]/a odin_kiosco = $CHROMIUM ${FLAGS[*]} '$PANEL_URL'" "$AUTOSTART"
else
  echo "No encuentro labwc ni Wayfire. ¿Es Raspberry Pi OS con escritorio?"
  exit 1
fi

echo
echo "Listo. Reinicia con: sudo reboot"
echo "La primera vez inicia sesión en Home Assistant en la pantalla (marca «Mantener la sesión»)."
echo "Si usas Odín, la primera vez acepta el permiso del micrófono."
