#!/bin/sh
# Pone el Kindle en "modo panel": apaga la interfaz normal y muestra Odín.
DIR=/mnt/us/odin
/etc/init.d/framework stop
lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null
sh "$DIR/refresh.sh"
