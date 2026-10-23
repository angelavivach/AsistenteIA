import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { calendarRequest } from './calendar.mjs'
import { pendingTimers } from './timers.mjs'
import { nowPlaying } from './spotify.mjs'
import { noteLines } from './apps.mjs'

/**
 * "Odín · tinta": a glanceable e-ink page for an old Kindle on the shelf —
 * today's agenda, the weather, the next alarm, what is playing, and the
 * shopping list.
 *
 * Written for the Kindle 4's 2011 WebKit: server-rendered HTML, tables instead
 * of flexbox, no JavaScript, plain black on white, a <meta refresh> once a
 * minute. 600×800 portrait.
 *
 * It is reachable from the home network, so it needs a key in the URL; the key
 * lives in ~/.odin/kindle.json and the full address is printed at startup.
 *
 *   GET /kindle?k=<key>
 *
 * Settings (optional, in .env):
 *   ODIN_CITY=Madrid           weather location (otherwise guessed from the IP)
 *   KINDLE_NOTE=Lista de la compra
 */

const KEY_FILE = join(homedir(), '.odin', 'kindle.json')
let key = null

async function kindleKey() {
  if (key) return key
  try {
    key = JSON.parse(await readFile(KEY_FILE, 'utf8')).key
  } catch {
    key = randomBytes(6).toString('hex')
    await mkdir(join(homedir(), '.odin'), { recursive: true })
    await writeFile(KEY_FILE, JSON.stringify({ key }), { mode: 0o600 })
  }
  return key
}

/** The LAN address(es) a Kindle on the same Wi-Fi can use. */
export async function kindleUrls(port) {
  const k = await kindleKey()
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  return ips.flatMap((ip) => [`http://${ip}:${port}/kindle?k=${k}`, `http://${ip}:${port}/kindle.png?k=${k}`])
}

// Weather ---------------------------------------------------------------------

let place = null // { name, lat, lon }
let weather = null // { at, temp, text, max, min }

const PLACE_FILE = join(homedir(), '.odin', 'place.json')

/**
 * Where the weather is for: ODIN_CITY if set (best — IP geolocation is often
 * off by a town or two), else a guess from the public IP. Remembered on disk so
 * a rate-limited lookup service cannot blank the weather after a restart.
 */
async function locate() {
  if (place) return place
  const city = process.env.ODIN_CITY
  if (!city) {
    try {
      place = JSON.parse(await readFile(PLACE_FILE, 'utf8'))
      return place
    } catch {
      /* not saved yet */
    }
  }
  const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(6000) })).json()
  try {
    if (city) {
      const g = (await get(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(city)}`)).results?.[0]
      if (g) place = { name: g.name, lat: g.latitude, lon: g.longitude }
    } else {
      const a = await get('https://ipapi.co/json/').catch(() => null)
      if (a?.latitude) place = { name: a.city, lat: a.latitude, lon: a.longitude }
      else {
        const b = await get('http://ip-api.com/json/?fields=status,city,lat,lon').catch(() => null)
        if (b?.status === 'success') place = { name: b.city, lat: b.lat, lon: b.lon }
      }
      if (place) {
        await mkdir(join(homedir(), '.odin'), { recursive: true })
        await writeFile(PLACE_FILE, JSON.stringify(place))
      }
    }
  } catch {
    /* no weather this time */
  }
  return place
}

const SKY = [
  [0, 'Despejado'], [1, 'Casi despejado'], [2, 'Algo nuboso'], [3, 'Nublado'],
  [45, 'Niebla'], [48, 'Niebla'], [51, 'Llovizna'], [53, 'Llovizna'], [55, 'Llovizna'],
  [61, 'Lluvia débil'], [63, 'Lluvia'], [65, 'Lluvia fuerte'], [71, 'Nieve'], [73, 'Nieve'],
  [75, 'Nieve fuerte'], [80, 'Chubascos'], [81, 'Chubascos'], [82, 'Chubascos fuertes'],
  [95, 'Tormenta'], [96, 'Tormenta'], [99, 'Tormenta'],
]
const sky = (code) => SKY.find(([c]) => c === code)?.[1] ?? ''

async function getWeather() {
  if (weather && Date.now() - weather.at < 15 * 60_000) return weather
  const p = await locate()
  if (!p) return null
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`
    const d = await (await fetch(url, { signal: AbortSignal.timeout(6000) })).json()
    weather = {
      at: Date.now(),
      place: p.name,
      temp: Math.round(d.current.temperature_2m),
      text: sky(d.current.weather_code),
      max: Math.round(d.daily.temperature_2m_max[0]),
      min: Math.round(d.daily.temperature_2m_min[0]),
      rain: d.daily.precipitation_probability_max?.[0] ?? null,
    }
  } catch {
    /* keep the last reading */
  }
  return weather
}

// Data ------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')
const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

async function agenda() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(start.getTime() + 86_400_000)
  const after = new Date(start.getTime() + 2 * 86_400_000)
  const get = async (a, b) => {
    const r = await calendarRequest({ op: 'list', from: localStamp(a), to: localStamp(b) }).catch(() => null)
    return r?.events ?? []
  }
  const [today, next] = await Promise.all([get(start, tomorrow), get(tomorrow, after)])
  // Today: hide what has already finished, except all-day events.
  const nowStamp = localStamp(now)
  return {
    today: today.filter((e) => e.allDay || e.end > nowStamp),
    tomorrow: next.slice(0, 3),
  }
}

// Page -------------------------------------------------------------------------

// The Kindle 4's fonts have no emoji; they would print as empty boxes.
const plain = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim()
const esc = (s) => plain(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hhmm = (stamp) => stamp.slice(11, 16)

function eventRows(list) {
  return list
    .map(
      (e) => `<tr><td class="t">${e.allDay ? 'Todo el día' : hhmm(e.start)}</td><td class="e">${esc(e.title)}</td></tr>`,
    )
    .join('')
}

async function render(asImage = false) {
  const now = new Date()
  const noteTitle = process.env.KINDLE_NOTE ?? 'Lista de la compra'
  const [w, cal, music, list] = await Promise.all([
    getWeather(),
    agenda(),
    nowPlaying(),
    noteLines(noteTitle),
  ])
  const alarms = pendingTimers().slice(0, 2)
  const date = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

  const weatherBlock = w
    ? `<td class="w"><div class="temp">${w.temp}&deg;</div><div class="small">${esc(w.text)}<br>${w.max}&deg; / ${w.min}&deg;${w.rain != null ? ` &middot; lluvia ${w.rain}%` : ''}<br>${esc(w.place ?? '')}</div></td>`
    : '<td class="w"></td>'

  const todayBlock = cal.today.length
    ? `<table class="ev">${eventRows(cal.today)}</table>`
    : '<p class="none">Nada más en el calendario hoy.</p>'

  const tomorrowBlock = cal.tomorrow.length
    ? `<h2>Mañana</h2><table class="ev small">${eventRows(cal.tomorrow)}</table>`
    : ''

  const alarmBlock = alarms.length
    ? `<h2>Alarmas</h2>${alarms
        .map((a) => `<p class="line">${a.kind === 'alarm' ? 'Alarma' : 'Temporizador'} ${esc(a.rings_at)}${a.label ? ` &middot; ${esc(a.label)}` : ''}</p>`)
        .join('')}`
    : ''

  const musicBlock = music
    ? `<h2>Sonando</h2><p class="line">${esc(music.title)}${music.by ? ` &mdash; ${esc(music.by)}` : ''}</p>`
    : ''

  const listBlock = list.length
    ? `<h2>${esc(noteTitle)}</h2><p class="line">${list.slice(0, 12).map(esc).join(' &middot; ')}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
${asImage ? '' : '<meta http-equiv="refresh" content="60">'}
<meta name="viewport" content="width=600">
<title>Odín</title>
<style>
  body { margin: 0; padding: 26px 34px; background: #fff; color: #000; font-family: Georgia, serif; }
  table { border-collapse: collapse; width: 100%; }
  .brand { font-family: Helvetica, Arial, sans-serif; font-size: 18px; letter-spacing: 10px; }
  .date { font-size: 20px; text-align: right; }
  .clock { font-family: Helvetica, Arial, sans-serif; font-size: 96px; font-weight: bold; line-height: 1; }
  .w { text-align: right; vertical-align: top; }
  .temp { font-family: Helvetica, Arial, sans-serif; font-size: 56px; font-weight: bold; }
  .small { font-size: 18px; }
  hr { border: 0; border-top: 3px solid #000; margin: 14px 0 6px; }
  h2 { font-family: Helvetica, Arial, sans-serif; font-size: 16px; letter-spacing: 6px; text-transform: uppercase; margin: 20px 0 6px; }
  .ev td { padding: 5px 0; vertical-align: top; border-bottom: 1px solid #999; }
  .ev .t { width: 150px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; font-size: 22px; }
  .ev .e { font-size: 24px; }
  .ev.small .t, .ev.small .e { font-size: 19px; }
  .line { font-size: 22px; margin: 4px 0; }
  .none { font-size: 22px; font-style: italic; }
  .foot { font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #555; margin-top: 18px; }
</style></head>
<body>
<table><tr>
  <td class="brand">ODÍN</td>
  <td class="date">${esc(date.charAt(0).toUpperCase() + date.slice(1))}</td>
</tr></table>
<table><tr>
  <td class="clock">${pad(now.getHours())}:${pad(now.getMinutes())}</td>
  ${weatherBlock}
</tr></table>
<hr>
<h2>Hoy</h2>
${todayBlock}
${tomorrowBlock}
${alarmBlock}
${musicBlock}
${listBlock}
<p class="foot">${asImage ? `Actualizado a las ${pad(now.getHours())}:${pad(now.getMinutes())}` : 'Se actualiza cada minuto'}</p>
</body></html>`
}

// Image -----------------------------------------------------------------------
//
// For a jailbroken Kindle running an "online screensaver": the same panel as an
// 8-bit greyscale PNG, 600×800, rendered by a headless Chrome/Edge/Brave that is
// already installed. Kept for a minute so several fetches cost one render.

const BROWSERS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
}
const headless = () => (BROWSERS[process.platform] ?? []).find((p) => existsSync(p))

let shot = null // { at, png }
let shooting = null

async function renderPng(port) {
  if (shot && Date.now() - shot.at < 60_000) return shot.png
  if (shooting) return shooting
  shooting = (async () => {
    const bin = headless()
    if (!bin) throw new Error('No Chrome, Edge or Brave found to draw the image.')
    const dir = join(tmpdir(), 'odin-kindle')
    await mkdir(dir, { recursive: true })
    const out = join(dir, 'panel.png')
    const url = `http://127.0.0.1:${port}/kindle?k=${await kindleKey()}&img=1`
    await new Promise((resolve, reject) =>
      execFile(
        bin,
        [
          '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
          '--window-size=600,800', `--user-data-dir=${join(dir, 'profile')}`, `--screenshot=${out}`, url,
        ],
        { timeout: 30_000 },
        (err) => (err ? reject(err) : resolve()),
      ),
    )
    const png = await sharp(out)
      .resize(600, 800, { fit: 'cover', position: 'top' })
      .greyscale()
      .removeAlpha()
      .toColourspace('b-w')
      .png({ compressionLevel: 9 })
      .toBuffer()
    shot = { at: Date.now(), png }
    return png
  })()
  try {
    return await shooting
  } finally {
    shooting = null
  }
}

/** Returns true if it handled the request. */
export async function handleKindle(req, res) {
  if (!req.url.startsWith('/kindle')) return false
  const q = new URL(req.url, 'http://x').searchParams
  if (q.get('k') !== (await kindleKey())) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Falta la clave. Usa la dirección que muestra Odín al arrancar.')
    return true
  }
  if (req.url.startsWith('/kindle.png')) {
    try {
      const png = await renderPng(Number(process.env.JARVIS_BRIDGE_PORT ?? 8787))
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      res.end(png)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`Error: ${err.message}`)
    }
    return true
  }
  try {
    const html = await render(q.get('img') === '1')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html)
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Error: ${err.message}`)
  }
  return true
}
