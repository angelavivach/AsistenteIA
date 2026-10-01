# Montar Odín y Home Assistant en el Acer Nitro (Windows 11)

Guía paso a paso para convertir el Nitro en el servidor de casa: Odín (voz,
calendario de iCloud, cerebro Claude) y Home Assistant (bombillas, enchufes,
escenas), con el home pad para controlarlo todo.

Tiempo aproximado: 1-2 horas la primera vez.

---

## 0. Preparar el Nitro como servidor

1. **Que no se duerma:** Configuración → Sistema → Energía → *Pantalla y
   suspensión* → con el cargador conectado, **Suspender: Nunca**. La pantalla sí
   se puede apagar.
2. **Proteger la batería:** abre **Acer Care Center** (o NitroSense) y activa el
   **límite de carga al 80 %**. Va a estar siempre enchufado.
3. **Que las actualizaciones no lo reinicien cuando quieran:** Configuración →
   Windows Update → Opciones avanzadas → *Horas activas* → ajústalas a tu horario.

---

## 1. Instalar las herramientas

Abre **PowerShell** y ejecuta:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Cierra PowerShell, vuelve a abrirlo e instala Claude Code. En Windows necesita
Git, que acabas de instalar.

```powershell
npm install -g @anthropic-ai/claude-code
claude
```

Inicia sesión con tu cuenta de Claude y sal con `/exit`.

---

## 2. Descargar Odín

```powershell
cd $HOME\Documents
git clone https://github.com/angelavivach/AsistenteIA.git
cd AsistenteIA
npm install
copy odin.env.example .env
notepad .env
```

En el Bloc de notas rellena:

- `ELEVENLABS_API_KEY`: tu clave `sk_...` de ElevenLabs.
- `ICLOUD_USER`: tu correo de Apple ID.
- `ICLOUD_APP_PASSWORD`: una **contraseña de app** (no la de tu Apple ID). Se
  crea en **appleid.apple.com** → Inicio de sesión y seguridad → **Contraseñas
  de app** → `+`, con un nombre como "Odín". Tiene el formato
  `abcd-efgh-ijkl-mnop`.
- `ICLOUD_DEFAULT_CALENDAR`: el calendario donde quieres que cree los eventos
  (por ejemplo `Casa`).
- `HA_URL` y `HA_TOKEN`: déjalos para el paso 4.

Guarda y cierra.

**Prueba:** haz doble clic en **`Odin.bat`**. Se abrirá Chrome en
`http://localhost:5173`. Pulsa INICIAR y pregunta «Oye Odín, ¿qué tengo
mañana?». Debería leer tu calendario de iCloud.

---

## 3. Instalar Home Assistant (máquina virtual)

Home Assistant funciona como un pequeño ordenador virtual dentro del Nitro. Se
recomienda **VirtualBox**, porque permite conectar más adelante un receptor
Zigbee por USB.

1. Instala VirtualBox: `winget install Oracle.VirtualBox`
2. Descarga la imagen **Home Assistant OS para VirtualBox (.vdi)** desde
   home-assistant.io → Installation → Windows. Descomprímela, por ejemplo en
   `Documentos\HomeAssistant`.
3. En VirtualBox, **Nueva**:
   - Nombre: `Home Assistant`; Tipo: Linux; Versión: Other Linux (64-bit)
   - Marca **Habilitar EFI**
   - Memoria: **2048 MB**, procesadores: **2**
   - Disco: *Usar un disco existente* → el `.vdi` descargado
4. **Configuración → Red → Adaptador 1:** *Adaptador puente* (para que esté en tu
   Wi-Fi como un aparato más).
5. **Iniciar.** Tras unos minutos, abre en el navegador
   `http://homeassistant.local:8123` y crea tu usuario.
6. Para que arranque solo con Windows: en VirtualBox, clic derecho en la máquina
   → *Arranque sin interfaz*. Para que se inicie al encender el Nitro, crea un
   acceso directo a
   `"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" startvm "Home Assistant" --type headless`
   y ponlo en la carpeta de inicio (`Win+R` → `shell:startup`).

### Añadir tus aparatos

Configuración → **Dispositivos y servicios** → *Añadir integración*, y busca la
marca: Philips Hue, TP-Link Tapo, Tuya/Smart Life, Xiaomi, Shelly, Matter… Cada
una te guía.

- Organiza cada aparato en su **habitación (área)**. El home pad los agrupa así.
- Crea **escenas** si quieres botones como "Modo cine" o "Buenas noches"
  (Configuración → Automatizaciones y escenas → Escenas).

---

## 4. Conectar Odín con Home Assistant

1. **Activar el servidor MCP de Home Assistant:** Configuración → Dispositivos y
   servicios → *Añadir integración* → **Model Context Protocol Server**. Elige
   la API *Assist*.
2. **Elegir qué puede controlar Odín:** Configuración → **Asistentes de voz** →
   pestaña *Exponer* → marca las luces, enchufes y escenas que quieras. Lo que no
   expongas, Odín no lo verá.
3. **Crear un token:** pulsa tu usuario (abajo a la izquierda) → **Seguridad** →
   *Tokens de acceso de larga duración* → **Crear token**, con el nombre "Odín".
   Cópialo (solo se muestra una vez).
4. Abre `.env` y rellena:
   ```
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=el_token_que_acabas_de_copiar
   ```
5. Cierra la ventana de Odín y vuelve a abrir `Odin.bat`.

**Prueba:**
- Por voz: «Oye Odín, enciende la luz del salón».
- Con el home pad: pulsa **CASA** (abajo a la derecha) o la tecla **C**.

### Qué hace sin preguntar y qué no

- **Directo:** luces, enchufes, escenas, multimedia.
- **Te pide confirmación:** cerraduras, alarmas, puertas de garaje, calderas y
  "apágalo todo".

---

## 5. Pendiente: usarlo desde el iPhone

Para abrir Odín desde el iPhone (o una tablet como home pad) hace falta HTTPS,
porque Safari no da micrófono sin él, y que la página llegue al puente del
Nitro. Lo prepararemos con **Tailscale**: una red privada entre tus aparatos,
sin abrir nada a internet. Será la siguiente fase.

---

## Problemas habituales

| Síntoma | Solución |
|---|---|
| «iCloud rejected the login» | Revisa `ICLOUD_USER` y que sea una **contraseña de app**, no la normal |
| El home pad dice «Home Assistant no está conectado» | Falta `HA_URL` / `HA_TOKEN` en `.env`, o no has reiniciado `Odin.bat` |
| «No se puede contactar con Home Assistant» | ¿Está encendida la máquina virtual? Prueba `http://homeassistant.local:8123` en Chrome. Si no carga, usa su IP (VirtualBox → la consola de HA la muestra) |
| Odín dice que un aparato no está disponible | Exponlo en Asistentes de voz → Exponer |
| No me oye | Chrome en una ventana normal y permiso de micrófono concedido |
