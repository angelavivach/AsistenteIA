#!/bin/sh
# Odín · tinta — descarga el panel y lo pinta en la pantalla del Kindle.
# Lo ejecuta cron cada 5 minutos (ver INSTALAR.txt).
DIR=/mnt/us/odin
. "$DIR/config.sh"

# Que el Kindle no se duerma ni ponga su propio salvapantallas encima.
lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null

if wget -q -T 20 -O "$DIR/panel.tmp" "$ODIN_URL"; then
  mv "$DIR/panel.tmp" "$DIR/panel.png"
  eips -c
  eips -c
  eips -g "$DIR/panel.png"
else
  rm -f "$DIR/panel.tmp"
fi
