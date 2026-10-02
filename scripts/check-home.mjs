#!/usr/bin/env node
// Comprobación de Home Assistant — `npm run check:home`.
//
// No cambia nada: lee HA_URL y HA_TOKEN de .env y comprueba, paso a paso, lo
// mismo que necesita Odín: que Home Assistant responde, que el token vale, que
// el servidor MCP (la voz) está activado y qué aparatos verá el home pad.

try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  // Sin .env: se avisa abajo, al ver que faltan las variables.
}

const ok = (msg) => console.log(`  ✔  ${msg}`)
const bad = (msg, fix) => {
  console.log(`  ✘  ${msg}`)
  if (fix) console.log(`     → ${fix}`)
  process.exitCode = 1
}

console.log('\nComprobando la conexión de Odín con Home Assistant\n')

const url = process.env.HA_URL?.replace(/\/+$/, '')
const token = process.env.HA_TOKEN
if (!url || !token) {
  bad(
    `Falta ${!url ? 'HA_URL' : 'HA_TOKEN'} en .env`,
    'Copia odin.env.example como .env y rellena la sección Home Assistant.',
  )
  process.exit()
}

const auth = { Authorization: `Bearer ${token}` }
const call = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  })

// 1. ¿Responde y acepta el token?
try {
  const res = await call('/api/config')
  if (res.status === 401) {
    bad('Home Assistant rechaza el token', 'Crea uno nuevo en tu perfil → Seguridad → Tokens de acceso de larga duración.')
    process.exit()
  }
  if (!res.ok) throw new Error(`respondió ${res.status}`)
  const cfg = await res.json()
  ok(`Home Assistant ${cfg.version} en ${url} («${cfg.location_name}»)`)
  ok('Token válido')
} catch (err) {
  bad(
    `No se puede contactar con ${url} (${err.cause?.code ?? err.message})`,
    '¿Está encendida la Raspberry? Prueba a abrir la dirección en el navegador. Si homeassistant.local no funciona, usa su IP (p. ej. http://192.168.1.50:8123).',
  )
  process.exit()
}

// 2. El servidor MCP, que es por donde Odín controla la casa con la voz.
try {
  const rpc = (id, method, params, session) =>
    call('/api/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
  // Las respuestas pueden llegar como JSON o como un evento SSE.
  const parse = async (res) => {
    const text = await res.text()
    const data = text.trim().startsWith('{') ? text : text.match(/^data: (.*)$/m)?.[1]
    return data ? JSON.parse(data) : null
  }

  const init = await rpc(1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'odin-check', version: '1' },
  })
  if (init.status === 404) {
    bad(
      'El servidor MCP no está activado: Odín no podrá controlar la casa con la voz',
      'Ajustes → Dispositivos y servicios → Añadir integración → «Model Context Protocol Server» (API Assist).',
    )
  } else if (!init.ok) {
    throw new Error(`respondió ${init.status}`)
  } else {
    await parse(init)
    const session = init.headers.get('mcp-session-id') ?? undefined
    const list = await parse(await rpc(2, 'tools/list', {}, session))
    const tools = list?.result?.tools?.map((t) => t.name) ?? []
    ok(`Servidor MCP activo${tools.length ? ` con ${tools.length} herramientas (${tools.slice(0, 4).join(', ')}…)` : ''}`)
  }
} catch (err) {
  bad(`El servidor MCP no responde bien (${err.message})`)
}

// 3. Lo que verá el home pad (la misma lista que bridge/home.mjs).
try {
  const DOMAINS = ['light', 'switch', 'fan', 'cover', 'scene', 'climate', 'media_player']
  const states = await (await call('/api/states')).json()
  const devices = states.filter(
    (s) => DOMAINS.includes(s.entity_id.split('.')[0]) && s.state !== 'unavailable',
  )
  if (devices.length === 0) {
    bad('Home Assistant no tiene todavía luces, enchufes ni escenas', 'Añade tus aparatos en Ajustes → Dispositivos y servicios.')
  } else {
    ok(`${devices.length} aparatos para el home pad:`)
    for (const d of devices.slice(0, 15)) {
      console.log(`       · ${d.attributes.friendly_name ?? d.entity_id}  (${d.entity_id}, ${d.state})`)
    }
    if (devices.length > 15) console.log(`       · …y ${devices.length - 15} más`)
  }
} catch (err) {
  bad(`No se pudo leer la lista de aparatos (${err.message})`)
}

console.log(
  process.exitCode
    ? '\nHay cosas por arreglar (mira las flechas →).\n'
    : '\nTodo listo. Reinicia Odín y prueba: «Oye Odín, enciende la luz del salón».\n',
)
console.log('Recuerda: por voz, Odín solo ve los aparatos marcados en Asistentes de voz → Exponer.\n')
