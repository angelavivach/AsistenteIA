# ODÍN

Asistente de voz personal en español, con interfaz en el navegador y el cerebro
de Claude. Dices **«Oye Odín»**, te escucha, te contesta en voz alta y puede
consultar y cambiar tu calendario.

Basado en [J.A.R.V.I.S.](https://github.com/adewaskar/jarvis) de adewaskar
(licencia MIT), adaptado al español y rediseñado.

---

## Qué hace

- **Habla y entiende español.** Responde siempre en español de España, de usted,
  y te llama **Angela**. Frases breves, pensadas para oírse.
- **Se activa por voz.** «Oye Odín», «Hola Odín» o solo «Odín». También con la
  tecla **Espacio**.
- **Voz de ElevenLabs.** Usa la voz *George* (multilingüe) y la transcripción
  *Scribe* en español. Sin clave de ElevenLabs, usa la voz y el reconocimiento
  del navegador.
- **Gestiona tu calendario.** En Mac usa el Calendario de macOS (iCloud, Google
  o Exchange); en Windows se conecta directamente a **iCloud**. **Antes de
  crear, mover, renombrar o borrar un evento te lo lee y espera tu «sí».**
- **Pone música en Spotify** (Premium): canciones, álbumes, artistas, tus
  listas o tus «me gusta», donde tengas Spotify activo o en el equipo que digas
  («ponla en el Mac», «en el Windows», «en el móvil»). Si Spotify está cerrado en
  el ordenador de Odín, lo abre. También pausa, siguiente, volumen y «¿qué suena?».
- **Controla tu casa** con **Home Assistant**: luces, enchufes, escenas… por voz
  («enciende la luz del salón») o desde el **home pad** (botón **CASA** o tecla
  **C**), con los aparatos agrupados por habitación. Cerraduras, alarmas y
  similares siempre piden confirmación.
- **Responde hablando, no escribiendo.** Solo abre paneles en pantalla cuando le
  pides ver algo (una imagen, un vídeo, una página).
- **Sabe la fecha y la hora**, así que entiende «mañana», «el jueves» o «dentro
  de una hora».
- **Interfaz propia:**
  - **Pantalla de inicio:** ondas de puntos violeta, rosa y naranja, el título
    «ODÍN» cromado e iridiscente con estelas de humo, e «INICIAR».
  - **Arranque minimalista** inspirado en *Blade Runner 2049*: neblina, línea de
    horizonte, el nombre apareciendo letra a letra y un sol que sube.
  - **Interfaz principal:** una esfera de puntos que se pliega como una tela
    (rosa arriba, violeta, azul abajo). Reacciona a la voz, y su color cambia
    según esté escuchando, pensando o hablando.
  - **Sonido de arranque propio**, generado con ElevenLabs.

---

## Requisitos

> **¿Windows?** Sigue la guía [docs/INSTALAR-WINDOWS.md](docs/INSTALAR-WINDOWS.md)
> (Odín + calendario de iCloud + Home Assistant en un PC con Windows 11).
>
> **¿Home Assistant en una Raspberry Pi?** Sigue [docs/RASPBERRY-PI.md](docs/RASPBERRY-PI.md)
> y comprueba la conexión con `npm run check:home`.

- **macOS**. En Mac el calendario usa EventKit; en Windows se usa iCloud.
- **Node.js 20 o superior** (`brew install node`).
- **Claude Code** instalado y con la sesión iniciada. Es el cerebro y usa tu
  suscripción de Claude, sin API key.
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude   # inicia sesión una vez y sal con /exit
  ```
- **Google Chrome**, en una ventana normal. Los paneles de vista previa de los
  editores bloquean el micrófono.
- **Xcode Command Line Tools**, para compilar el ayudante de calendario
  (`xcode-select --install`).
- **Opcional, pero recomendado:** una clave de API de **ElevenLabs**
  (elevenlabs.io → Developers → API Keys). El plan gratuito sirve.

---

## Instalación

```bash
git clone https://github.com/angelavivach/AsistenteIA.git
cd AsistenteIA
npm install
npm run build:calendar
```

Guarda la clave de ElevenLabs en tu configuración de terminal. Es la clave que
empieza por `sk_`, no el ID de una voz:

```bash
echo 'export ELEVENLABS_API_KEY=sk_tu_clave' >> ~/.zshrc
```

---

## Arrancar

En Windows: doble clic en **`Odin.bat`**.

En Mac: haz **doble clic en `Odin.command`**. Se abre Terminal, se comprueba el acceso
al calendario y arranca Odín.

La primera vez, macOS pedirá permiso para que **Terminal** acceda a tus
calendarios: pulsa **Permitir**. Si no aparece, actívalo en Ajustes del Sistema
→ Privacidad y seguridad → **Calendarios** → Terminal.

Después abre **http://localhost:5173** en Chrome, pulsa **INICIAR**, permite el
micrófono y di **«Oye Odín»**.

> Arráncalo siempre desde `Odin.command` (o desde Terminal con `npm start`): el
> permiso del calendario lo tiene Terminal, no el navegador.

---

## Qué puedes decirle

- «Oye Odín, ¿qué tengo mañana?»
- «Crea una cita con el dentista el lunes a las cinco.»
- «Mueve el teletrabajo del viernes a las nueve.»
- «¿Cuál es mi próxima reunión?»
- «¿Qué tiempo va a hacer?»

## Controles

| Tecla / frase | Hace |
|---|---|
| **«Oye Odín»** | Lo despierta |
| **Espacio** | Hablar sin decir su nombre |
| Hablar mientras habla | Lo interrumpe |
| **Escape** | Lo manda a esperar |
| **D** | Panel de diagnóstico (qué oye, qué descarta) |
| **T** | Prueba de audio |
| **V** | Cambia la voz del navegador (solo sin ElevenLabs) |
| **C** | Abre o cierra el home pad (Casa) |

---

## Cómo funciona

Son dos procesos que se hablan por WebSocket en `localhost:8787`:

```
┌─ Navegador (la cara) ──────────────┐        ┌─ Puente (el cerebro) ────────────────┐
│  «Oye Odín» + detector de voz      │        │  Node · bridge/server.mjs            │
│  voz a texto (ElevenLabs Scribe)   │   ws   │  Claude Agent SDK = Claude Code      │
│  esfera de puntos (Three.js)       │◄─────► │  herramientas: calendario, interfaz  │
│  texto a voz (ElevenLabs)          │  8787  │  permisos: solo lectura salvo        │
│  pantalla de inicio y arranque     │        │  el calendario (con confirmación)    │
└────────────────────────────────────┘        └──────────────────────────────────────┘
                                                         │
                                       bridge/calendar-helper (Swift + EventKit)
                                                         │
                                                 Calendario de macOS
```

- **El cerebro** es Claude Code ejecutado sin ventana (modelo `claude-opus-5`,
  esfuerzo `high`), con una personalidad propia en español definida en
  `bridge/server.mjs`.
- **El calendario** lo maneja un pequeño programa en Swift
  (`bridge/calendar-helper/`) que usa EventKit. Es mucho más rápido que
  AppleScript y entiende los eventos que se repiten. Si cambias un evento
  repetido, solo cambia ese día.
- **Permisos:** todo es de solo lectura (correo, archivos, navegador…) salvo el
  calendario. Las herramientas de calendario se niegan a actuar si no has
  confirmado el cambio por voz.

---

## Configuración

Las claves van en un archivo **`.env`** junto a `package.json`. Copia
`odin.env.example` como `.env` y rellénalo. Ese archivo no se sube a GitHub. En
Mac también sirven las variables de `~/.zshrc`.

Variables (todas opcionales):

| Variable | Por defecto | Para qué |
|---|---|---|
| `ELEVENLABS_API_KEY` | — | Activa la voz y la transcripción de ElevenLabs |
| `JARVIS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` (George) | Voz de ElevenLabs |
| `JARVIS_MODEL` | `claude-opus-5` | Modelo de Claude |
| `JARVIS_EFFORT` | `high` | Nivel de razonamiento |
| `JARVIS_ALLOW_WRITES` | desactivado | `1` permite acciones con efecto fuera del calendario |
| `JARVIS_BRIDGE_PORT` | `8787` | Puerto del puente |
| `ICLOUD_USER` / `ICLOUD_APP_PASSWORD` | — | Calendario de iCloud (contraseña de app) |
| `ICLOUD_DEFAULT_CALENDAR` | el primero | Calendario para eventos nuevos |
| `CALENDAR_BACKEND` | auto | `icloud` para usar iCloud también en Mac |
| `HA_URL` / `HA_TOKEN` | — | Home Assistant (dirección y token de larga duración) |
| `SPOTIFY_CLIENT_ID` | — | Spotify (ver abajo) |

Las variables conservan el prefijo `JARVIS_` del proyecto original.

> **Voces de la biblioteca de ElevenLabs** (por ejemplo, narradores en español
> como *Mariano Gómez*): con el plan gratuito no se pueden usar por API. Hace
> falta el plan Starter o superior. Las voces incluidas (George, Daniel…) sí
> funcionan gratis.

### Conectar Spotify (una sola vez)

1. Entra en **developer.spotify.com** → *Dashboard* → **Create app**.
   - *Redirect URI:* `http://127.0.0.1:8787/spotify/callback`
   - *Which API/SDKs are you planning to use?* **Web API**
2. Copia el **Client ID** en `.env` como `SPOTIFY_CLIENT_ID=...` y reinicia Odín.
3. Abre **http://127.0.0.1:8787/spotify/login** y acepta. La sesión queda
   guardada en `~/.odin/spotify.json`, fuera del proyecto.

Para que suene en un equipo, Spotify tiene que estar abierto en él; en el
ordenador donde corre Odín lo abre él solo.

---

## Solución de problemas

- **No me oye o no le oigo:** usa Chrome en una ventana normal, permite el
  micrófono y pulsa **D** para ver el diagnóstico.
- **«Oye Odín» no lo despierta, pero con Espacio sí:** Terminal muestra cada
  transcripción como `[odin] oído: "..."`. Si ElevenLabs escribe su nombre de otra
  forma, añádela a `WAKE` en `src/lib/voice.ts` y a `NAME` en `src/App.tsx`.
- **«Calendar access denied»:** dale permiso a Terminal en Privacidad y seguridad
  → Calendarios, y arranca con `Odin.command`.
- **No habla con la voz de ElevenLabs:** comprueba que `ELEVENLABS_API_KEY` es la
  clave `sk_...` y no un ID de voz.
- **El puente no responde:** comprueba que no hay otro programa usando el puerto
  `8787`.

---

## Próximos pasos (en estudio)

- Usarlo desde el **iPhone** o una tablet como home pad, por **Tailscale**.
- Convertirlo en **aplicación de Mac** con icono propio.
- **Cerebro local** con Ollama, gratis y privado, como alternativa a Claude.

---

## Créditos y licencia

- Proyecto original: [J.A.R.V.I.S.](https://github.com/adewaskar/jarvis) de
  adewaskar, licencia MIT (ver `LICENSE`).
- Música de fondo y de trabajo: Kevin MacLeod (CC BY 4.0). Sonido de arranque
  generado con ElevenLabs. Detalles en `public/audio/CREDITS.md`.
