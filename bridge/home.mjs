/**
 * The home pad's line to Home Assistant.
 *
 * The browser never sees the Home Assistant token: it asks the bridge, and the
 * bridge calls Home Assistant's REST API with HA_URL / HA_TOKEN. Only a handful
 * of device kinds are offered — the ones a wall pad is for — and only two
 * actions: toggle (or activate, for scenes) and set brightness.
 *
 *   GET  /home/devices                → { devices: [{ id, name, domain, state, area, brightness }] }
 *   POST /home/toggle     { id }      → { ok: true }
 *   POST /home/brightness { id, pct } → { ok: true }
 */

const DOMAINS = ['light', 'switch', 'fan', 'cover', 'scene', 'climate', 'media_player']

export const homeConfigured = () => Boolean(process.env.HA_URL && process.env.HA_TOKEN)

async function ha(path, init = {}) {
  const base = process.env.HA_URL.replace(/\/+$/, '')
  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.HA_TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`)
  return res
}

// One template call returns every device with its room, which the plain
// /api/states endpoint does not know about.
const DEVICES_TEMPLATE = `{% set ns = namespace(o=[]) %}
{% for s in states if s.domain in ${JSON.stringify(DOMAINS)} %}
{% set ns.o = ns.o + [{
  'id': s.entity_id, 'name': s.name, 'domain': s.domain, 'state': s.state,
  'area': area_name(s.entity_id) or '',
  'brightness': s.attributes.brightness | default(none)
}] %}
{% endfor %}{{ ns.o | tojson }}`

async function devices() {
  const res = await ha('/template', {
    method: 'POST',
    body: JSON.stringify({ template: DEVICES_TEMPLATE }),
  })
  const list = JSON.parse(await res.text())
  return list
    .filter((d) => d.state !== 'unavailable')
    .map((d) => ({
      ...d,
      brightness: d.brightness == null ? null : Math.round((d.brightness / 255) * 100),
    }))
}

const ID_RE = /^[a-z_]+\.[a-z0-9_]+$/

function serviceFor(domain) {
  switch (domain) {
    case 'scene':
      return ['scene', 'turn_on']
    case 'cover':
      return ['cover', 'toggle']
    case 'light':
    case 'switch':
    case 'fan':
    case 'media_player':
    case 'climate':
      return [domain, 'toggle']
    default:
      return null
  }
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4096) throw new Error('body too large')
  }
  return JSON.parse(body || '{}')
}

/** Returns true if it handled the request. */
export async function handleHome(req, res, cors) {
  if (!req.url.startsWith('/home/')) return false
  const json = (status, obj) => {
    res.writeHead(status, { ...cors, 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  if (!homeConfigured()) {
    json(503, { error: 'Home Assistant is not configured (HA_URL / HA_TOKEN).' })
    return true
  }
  // Actions only from the page itself, never from a request with no origin.
  if (req.method === 'POST' && !req.headers.origin) {
    json(403, { error: 'forbidden' })
    return true
  }

  try {
    if (req.method === 'GET' && req.url === '/home/devices') {
      json(200, { devices: await devices() })
      return true
    }
    if (req.method === 'POST' && req.url === '/home/toggle') {
      const { id } = await readJson(req)
      const domain = String(id ?? '').split('.')[0]
      const svc = ID_RE.test(id ?? '') && DOMAINS.includes(domain) ? serviceFor(domain) : null
      if (!svc) return json(400, { error: 'bad device' }), true
      await ha(`/services/${svc[0]}/${svc[1]}`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: id }),
      })
      json(200, { ok: true })
      return true
    }
    if (req.method === 'POST' && req.url === '/home/brightness') {
      const { id, pct } = await readJson(req)
      if (!ID_RE.test(id ?? '') || !id.startsWith('light.')) return json(400, { error: 'bad device' }), true
      const p = Math.max(0, Math.min(100, Math.round(Number(pct))))
      await ha('/services/light/turn_on', {
        method: 'POST',
        body: JSON.stringify({ entity_id: id, brightness_pct: p }),
      })
      json(200, { ok: true })
      return true
    }
    json(404, { error: 'not found' })
  } catch (err) {
    json(502, { error: String(err.message ?? err) })
  }
  return true
}
