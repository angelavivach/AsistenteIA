#!/bin/zsh
# Doble clic para arrancar Jarvis desde Terminal (así macOS le da acceso al calendario).
cd "$(dirname "$0")"
source ~/.zshrc 2>/dev/null
pkill -f "scripts/start.mjs"; pkill -f "bridge/server.mjs"; pkill -f "vite/bin/vite.js"
sleep 1
echo "Comprobando acceso al calendario…"
./bridge/calendar-helper/jarvis-calendar '{"op":"calendars"}'
echo
npm start
