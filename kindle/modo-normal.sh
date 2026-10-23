#!/bin/sh
# Vuelve al Kindle normal (para leer).
lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
/etc/init.d/framework start
