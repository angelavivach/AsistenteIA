# Pantalla de pared

Antes necesitas Home Assistant funcionando y conectado a Odín: mira
[home-assistant/README.md](../home-assistant/README.md).

Una **segunda Raspberry** (Pi 4 o 5) con la **Raspberry Pi Touch Display 2**,
que enseña el panel de casa con los colores de Odín y tiene un botón **Hablar
con Odín** que abre la interfaz de Odín (con micrófono) y otro **← CASA** para
volver.

```
Pantalla (Pi + táctil) ──▶ panel de Home Assistant   (siempre, aunque el Mac esté apagado)
                       └─▶ Odín en el Mac            (cuando el Mac está encendido)
```

## 1. El tema Odín en Home Assistant

1. Ajustes → Complementos → Tienda → instala **File editor** y ábrelo.
2. Crea la carpeta `themes` y dentro un archivo `odin-tema.yaml` con el
   contenido de [odin-tema.yaml](odin-tema.yaml).
3. Abre `configuration.yaml` y añade al final:
   ```yaml
   frontend:
     themes: !include_dir_merge_named themes
   ```
4. Ajustes → Sistema → **Reiniciar**.

## 2. Odín accesible desde la pantalla (opcional)

Para que el botón **Hablar con Odín** funcione, Odín tiene que aceptar
conexiones desde la red de casa. En el `.env` del Mac añade el nombre del Mac en
la red (Ajustes del Sistema → General → Compartir, abajo del todo, o
`scutil --get LocalHostName` en Terminal) terminado en `.local`:

```
ODIN_PANTALLA_HOST=MacBook-Air-de-Angela.local
```

y reinicia Odín. Comprueba desde el iPhone (en la misma wifi) que abre
`http://MacBook-Air-de-Angela.local:5173`.

> Con esto, **cualquiera conectado a tu wifi** puede abrir Odín en esa
> dirección. Si tienes invitados en la wifi principal, quita la línea o usa una
> wifi de invitados para ellos.

## 3. Generar el panel

En el Mac, con Home Assistant ya funcionando:

```bash
npm run panel:casa
```

Crea `pantalla/panel-casa.yaml` con una sección por habitación, tus escenas
arriba y el botón de Odín. Después, en Home Assistant:

1. Ajustes → **Paneles** → *Añadir panel* → *Nuevo panel desde cero*. Título:
   **Panel casa** (la dirección debe quedar `panel-casa`).
2. Ábrelo → lápiz (editar) → ⋮ → **Editor de configuración en bruto**.
3. Borra lo que haya, pega el contenido de `pantalla/panel-casa.yaml` y guarda.

Si añades aparatos más adelante, vuelve a ejecutar `npm run panel:casa` y
pégalo otra vez.

## 4. Preparar la Pi de la pantalla

1. Con Raspberry Pi Imager instala **Raspberry Pi OS (64-bit)** con
   escritorio. En los ajustes del Imager pon usuario, wifi y activa SSH.
2. Conecta la pantalla, arranca y copia [kiosco-pi.sh](kiosco-pi.sh)
   a la Pi (por ejemplo con `scp` desde el Mac).
3. En la Pi:
   ```bash
   bash kiosco-pi.sh http://homeassistant.local:8123/panel-casa/casa http://MacBook-Air-de-Angela.local:5173
   sudo reboot
   ```
   La segunda dirección solo hace falta si usas Odín en la pantalla.
4. La primera vez, inicia sesión en Home Assistant en la pantalla (con un
   teclado USB es más cómodo) y marca **Mantener la sesión iniciada**. Lo mejor
   es crear antes un usuario aparte, «Pantalla», sin permisos de administrador.
5. La primera vez que abras Odín, acepta el permiso del micrófono.

Para salir del modo kiosco: conecta un teclado y pulsa `Alt+F4`.

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| [panel-casa.mjs](panel-casa.mjs) | Genera el panel con tus aparatos (`npm run panel:casa`) |
| [odin-tema.yaml](odin-tema.yaml) | Tema de colores Odín para Home Assistant |
| [kiosco-pi.sh](kiosco-pi.sh) | Prepara la Pi de la pantalla en modo kiosco |
| `panel-casa.yaml` | El panel generado (no se sube a GitHub) |
