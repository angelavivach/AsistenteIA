# Home Assistant en una Raspberry Pi, conectado a Odín

Guía para montar el servidor de casa en una **Raspberry Pi 5** y conectarlo a
Odín. Odín sigue funcionando en el Mac (o el PC); la Raspberry solo hace de
cerebro de la casa, encendida siempre junto al router.

```
Odín (Mac) ──voz──▶ MCP de Home Assistant ─┐
Odín home pad ─────▶ API de Home Assistant ─┼─▶ Raspberry Pi ─▶ luces, enchufes…
iPhone (app Casa) ◀─ HomeKit Bridge ────────┘
```

Tiempo aproximado: 1 hora la primera vez.

---

## 1. Qué necesitas

- Raspberry Pi 5 (4 u 8 GB) con su **fuente oficial de 27 W**
- Caja con ventilador
- SSD NVMe con HAT M.2 (recomendado) o una microSD buena de 32–64 GB
- Cable de red al router
- Opcional: antena Zigbee/Thread (Home Assistant Connect ZBT-1 o Sonoff
  ZBDongle-E), con un alargador USB para alejarla de la Pi

## 2. Instalar Home Assistant

1. En el Mac, instala **Raspberry Pi Imager** (raspberrypi.com/software).
2. Elige *Raspberry Pi 5* → *Other specific-purpose OS* → *Home automation* →
   **Home Assistant** → tu SSD o microSD → **Escribir**.
3. Ponlo en la Pi, conéctala al router por cable y enciéndela.
4. Espera unos 10 minutos y abre `http://homeassistant.local:8123`.
5. Crea tu usuario y pon la ubicación de casa.

**Consejo:** en el router, reserva una IP fija para la Raspberry (por ejemplo
`192.168.1.50`). Si algún día `homeassistant.local` falla, usarás esa IP.

## 3. Añadir tus aparatos

1. **Habitaciones:** Ajustes → Áreas. Crea salón, cocina, dormitorio… El home
   pad de Odín agrupa los aparatos por área.
2. **Aparatos de Apple Home:**
   - Con logo **Matter**: en la app Casa, entra en el aparato → *Activar modo de
     enlace* → añádelo en Home Assistant con ese código. Queda en los dos.
   - Solo **HomeKit**: elimínalo de la app Casa y Home Assistant lo encontrará
     solo (integración *HomeKit Device*).
3. **Volver a verlo todo en el iPhone:** añade la integración **HomeKit Bridge**
   y escanea el código con la app Casa.
4. **Nombres claros:** «Luz salón», «Enchufe cafetera». Odín los usa tal cual.

## 4. Conectar Odín

1. **Servidor MCP** (para la voz): Ajustes → Dispositivos y servicios →
   *Añadir integración* → **Model Context Protocol Server** → API *Assist*.
2. **Qué puede controlar Odín:** Ajustes → **Asistentes de voz** → pestaña
   *Exponer*. Lo que no expongas, Odín no lo verá por voz.
3. **Token:** tu usuario (abajo a la izquierda) → **Seguridad** → *Tokens de
   acceso de larga duración* → **Crear token** con el nombre «Odín». Cópialo,
   porque solo se muestra una vez.
4. En el `.env` de Odín:
   ```
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=el_token_que_acabas_de_copiar
   ```
5. **Comprueba la conexión:**
   ```bash
   npm run check:home
   ```
   Te dice si Home Assistant responde, si el token vale, si el servidor MCP está
   activo y qué aparatos verá el home pad. Si algo falla, te indica cómo
   arreglarlo.
6. Reinicia Odín y prueba:
   - Por voz: «Oye Odín, enciende la luz del salón».
   - Con el home pad: botón **CASA** o tecla **C**.

### Qué hace sin preguntar y qué no

- **Directo:** luces, enchufes, escenas, multimedia.
- **Pide confirmación:** cerraduras, alarmas, puertas de garaje, calderas y
  «apágalo todo».

---

## Problemas frecuentes

| Problema | Solución |
|---|---|
| `homeassistant.local` no carga | Usa la IP de la Pi (la ves en el router) en `HA_URL` |
| «Home Assistant rechaza el token» | Crea un token nuevo y pégalo entero, sin espacios |
| «El servidor MCP no está activado» | Paso 4.1 |
| Odín dice que un aparato no está disponible | Exponlo en Asistentes de voz → Exponer |
| La Pi se reinicia o se cuelga | Casi siempre es la fuente: usa la oficial de 27 W |

---

## Siguiente: la pantalla de pared

Panel táctil con los colores de Odín: mira [pantalla/README.md](../pantalla/README.md).
