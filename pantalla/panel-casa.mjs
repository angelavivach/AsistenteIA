#!/usr/bin/env node
// Genera el panel de la pantalla — `npm run panel:casa`.
//
// Lee de Home Assistant tus habitaciones y aparatos (los mismos tipos que el
// home pad) y escribe pantalla/panel-casa.yaml: un panel con el tema Odín, una
// sección por habitación y, si .env tiene ODIN_PANTALLA_HOST, un botón para
// abrir Odín. No cambia nada en Home Assistant: el YAML se pega a mano en
// Panel → Editar → Editor de configuración en bruto.

import { writeFileSync } from 'node:fs'

try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  // Sin .env: se avisa abajo.
}

const url = process.env.HA_URL?.replace(/\/+$/, '')
const token = process.env.HA_TOKEN
if (!url || !token) {
  console.log('\nFalta HA_URL o HA_TOKEN en .env. Primero: npm run check:home\n')
  process.exit(1)
}

// La dirección del panel en Home Assistant: al crearlo, ponle «panel-casa».
const PANEL_PATH = 'panel-casa/casa'
const DOMAINS = ['light', 'switch', 'fan', 'cover', 'scene', 'climate', 'media_player']

const TEMPLATE = `{% set ns = namespace(o=[]) %}
{% for s in states if s.domain in ${JSON.stringify(DOMAINS)} %}
{% set ns.o = ns.o + [{'id': s.entity_id, 'name': s.name, 'domain': s.domain,
  'state': s.state, 'area': area_name(s.entity_id) or ''}] %}
{% endfor %}{{ ns.o | tojson }}`

const res = await fetch(`${url}/api/template`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ template: TEMPLATE }),
  signal: AbortSignal.timeout(8000),
}).catch((err) => ({ ok: false, status: err.message }))
if (!res.ok) {
  console.log(`\nHome Assistant no responde (${res.status}). Prueba: npm run check:home\n`)
  process.exit(1)
}
const devices = JSON.parse(await res.text()).filter((d) => d.state !== 'unavailable')

// Controles extra debajo de cada tarjeta, según el tipo de aparato.
const FEATURES = {
  light: [{ type: 'light-brightness' }],
  cover: [{ type: 'cover-open-close' }],
  climate: [{ type: 'target-temperature' }],
}
const tile = (d) => ({
  type: 'tile',
  entity: d.id,
  name: d.name,
  ...(FEATURES[d.domain] ? { features: FEATURES[d.domain] } : {}),
})

// Arriba: Odín y las escenas.
const top = [{ type: 'heading', heading: 'ODÍN · CASA', heading_style: 'title' }]
const host = process.env.ODIN_PANTALLA_HOST?.trim()
if (host) {
  const volver = `${url}/${PANEL_PATH}`
  top.push({
    type: 'button',
    name: 'Hablar con Odín',
    icon: 'mdi:creation',
    show_state: false,
    tap_action: { action: 'url', url_path: `http://${host}:5173/?volver=${encodeURIComponent(volver)}` },
  })
}
const scenes = devices.filter((d) => d.domain === 'scene')
top.push(...scenes.map((d) => ({ ...tile(d), icon: 'mdi:palette' })))

// Una sección por habitación; lo que no tiene habitación, al final.
const rooms = new Map()
for (const d of devices) {
  if (d.domain === 'scene') continue
  const room = d.area || 'Otros'
  if (!rooms.has(room)) rooms.set(room, [])
  rooms.get(room).push(d)
}
const order = [...rooms.keys()].sort((a, b) => (a === 'Otros' ? 1 : b === 'Otros' ? -1 : a.localeCompare(b, 'es')))

const panel = {
  title: 'Casa',
  views: [
    {
      title: 'Casa',
      path: 'casa',
      type: 'sections',
      theme: 'Odín',
      max_columns: 4,
      sections: [
        { type: 'grid', cards: top },
        ...order.map((room) => ({
          type: 'grid',
          cards: [{ type: 'heading', heading: room }, ...rooms.get(room).map(tile)],
        })),
      ],
    },
  ],
}

// YAML a mano: solo hacen falta objetos, listas, textos, números y booleanos.
function yaml(value, indent = '') {
  const scalar = (v) =>
    typeof v === 'string' ? (/^[\wÀ-ÿ][\wÀ-ÿ .·-]*$/.test(v) && !/^(true|false|null|yes|no|on|off)$/i.test(v) ? v : JSON.stringify(v)) : String(v)
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const [first, ...rest] = yaml(item, `${indent}  `).split('\n')
          return [`${indent}- ${first.trimStart()}`, ...rest].join('\n')
        }
        return `${indent}- ${scalar(item)}`
      })
      .join('\n')
  }
  return Object.entries(value)
    .map(([k, v]) =>
      v && typeof v === 'object'
        ? `${indent}${k}:\n${yaml(v, Array.isArray(v) ? indent : `${indent}  `)}`
        : `${indent}${k}: ${scalar(v)}`,
    )
    .join('\n')
}

const out = new URL('panel-casa.yaml', import.meta.url)
writeFileSync(
  out,
  `# Panel de la pantalla, generado por «npm run panel:casa».\n` +
    `# Pégalo en Home Assistant → panel «panel-casa» → Editar → ⋮ → Editor de configuración en bruto.\n\n` +
    yaml(panel) +
    '\n',
)

console.log(`\nPanel generado: pantalla/panel-casa.yaml`)
console.log(`  ${order.length} habitaciones, ${devices.length - scenes.length} aparatos, ${scenes.length} escenas`)
console.log(host ? `  Botón de Odín → http://${host}:5173` : '  Sin botón de Odín (pon ODIN_PANTALLA_HOST en .env si lo quieres)')
console.log(`  En la pantalla, abre: ${url}/${PANEL_PATH}\n`)
