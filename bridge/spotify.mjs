import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * The `spotify_*` tools — Spotify through its Web API, so ODIN can play a song,
 * an album or a playlist on whichever device the user has Spotify open on:
 * this Mac, the Windows PC, the phone or a Spotify Connect speaker.
 *
 * Setup, once:
 *   1. developer.spotify.com → Dashboard → Create app. Redirect URI:
 *        http://127.0.0.1:8787/spotify/callback
 *      API: Web API. Copy the Client ID into .env as SPOTIFY_CLIENT_ID.
 *   2. Open http://127.0.0.1:8787/spotify/login and accept.
 *
 * Authorisation Code with PKCE, so there is no client secret to keep. The
 * refresh token lives in ~/.odin/spotify.json, outside the repository. Playback
 * control needs Spotify Premium; that is a Spotify rule, not ours.
 */

const API = 'https://api.spotify.com/v1'
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ')

const TOKEN_FILE = join(homedir(), '.odin', 'spotify.json')
const port = () => Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
const redirectUri = () => process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${port()}/spotify/callback`
export const spotifyConfigured = () => Boolean(process.env.SPOTIFY_CLIENT_ID)

// Tokens ---------------------------------------------------------------------

let tokens = null // { access_token, refresh_token, expires_at }
let pkce = null // { verifier, state } while a login is in flight

async function loadTokens() {
  if (tokens) return tokens
  try {
    tokens = JSON.parse(await readFile(TOKEN_FILE, 'utf8'))
  } catch {
    tokens = null
  }
  return tokens
}

async function saveTokens(t) {
  tokens = t
  await mkdir(join(homedir(), '.odin'), { recursive: true })
  await writeFile(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 })
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID, ...params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? `token ${res.status}`)
  return data
}

async function accessToken() {
  const t = await loadTokens()
  if (!t) throw new NotConnected()
  if (Date.now() < t.expires_at - 60_000) return t.access_token
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
  await saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? t.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  })
  return tokens.access_token
}

class NotConnected extends Error {
  constructor() {
    super(`Spotify is not connected. The user must open http://127.0.0.1:${port()}/spotify/login once.`)
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 204) return null
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const reason = data?.error?.reason ?? data?.error?.message ?? `error ${res.status}`
    if (reason === 'PREMIUM_REQUIRED') throw new Error('Spotify Premium is required to control playback.')
    if (reason === 'NO_ACTIVE_DEVICE' || res.status === 404) {
      throw new Error('No active Spotify device. Open Spotify on a device (or use spotify_open_app) and try again.')
    }
    throw new Error(`Spotify: ${reason}`)
  }
  return data
}

// Ducking ---------------------------------------------------------------------
//
// While ODIN is awake the music drops to a murmur, so the microphone hears the
// user rather than the lyrics, and comes back when the conversation is over.

let ducked = null // { device, volume } while lowered

async function duck(on) {
  if (!(await loadTokens())) return
  if (on) {
    if (ducked) return
    const s = await api('/me/player').catch(() => null)
    const dev = s?.device
    if (!s?.is_playing || !dev?.id || dev.volume_percent == null || dev.volume_percent <= 12) return
    ducked = { device: dev.id, volume: dev.volume_percent }
    const low = Math.max(5, Math.round(dev.volume_percent * 0.2))
    await api(`/me/player/volume?volume_percent=${low}&device_id=${dev.id}`, { method: 'PUT' }).catch(() => {
      ducked = null
    })
  } else {
    if (!ducked) return
    const { device, volume } = ducked
    ducked = null
    await api(`/me/player/volume?volume_percent=${volume}&device_id=${device}`, { method: 'PUT' }).catch(() => {})
  }
}

// Login endpoints (served by the bridge) --------------------------------------

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#07050c;color:#f1e8ff;font:300 18px system-ui">
<div style="text-align:center;max-width:520px;padding:24px"><div style="letter-spacing:.5em;color:#c9a6ff;font-size:12px;margin-bottom:18px">ODÍN · SPOTIFY</div>${body}</div></body>`

/** Returns true if it handled the request. */
export async function handleSpotify(req, res) {
  if (!req.url.startsWith('/spotify/')) return false
  const html = (status, title, body) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page(title, body))
  }

  if (req.method === 'POST' && req.url === '/spotify/duck') {
    // Only from the ODIN page itself.
    if (!req.headers.origin) {
      res.writeHead(403)
      res.end()
      return true
    }
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 256) break
    }
    let on = false
    try {
      on = JSON.parse(body || '{}').on === true
    } catch {
      /* treat as off */
    }
    if (spotifyConfigured()) await duck(on).catch(() => {})
    res.writeHead(204, { 'access-control-allow-origin': req.headers.origin, vary: 'origin' })
    res.end()
    return true
  }

  if (!spotifyConfigured()) {
    html(503, 'Spotify', 'Falta <b>SPOTIFY_CLIENT_ID</b> en el archivo .env.')
    return true
  }

  if (req.method === 'GET' && req.url === '/spotify/login') {
    const verifier = b64url(randomBytes(48))
    const state = b64url(randomBytes(16))
    pkce = { verifier, state }
    const url = new URL('https://accounts.spotify.com/authorize')
    url.search = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    }).toString()
    res.writeHead(302, { location: url.toString() })
    res.end()
    return true
  }

  if (req.method === 'GET' && req.url.startsWith('/spotify/callback')) {
    const q = new URL(req.url, 'http://x').searchParams
    if (q.get('error')) {
      html(400, 'Spotify', `Spotify no dio permiso (${q.get('error')}).`)
      return true
    }
    if (!pkce || q.get('state') !== pkce.state) {
      html(400, 'Spotify', 'La sesión de inicio caducó. Vuelve a abrir /spotify/login.')
      return true
    }
    try {
      const data = await tokenRequest({
        grant_type: 'authorization_code',
        code: q.get('code') ?? '',
        redirect_uri: redirectUri(),
        code_verifier: pkce.verifier,
      })
      await saveTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
      })
      pkce = null
      html(200, 'Spotify conectado', 'Spotify conectado. Ya puedes cerrar esta pestaña y decir <b>«Oye Odín, pon música»</b>.')
    } catch (e) {
      html(500, 'Spotify', `No se pudo conectar: ${e.message}`)
    }
    return true
  }

  return false
}

// Devices ---------------------------------------------------------------------

async function devices() {
  const data = await api('/me/player/devices')
  return (data?.devices ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    active: d.is_active,
    volume: d.volume_percent,
  }))
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Find a device by a loose name: "mac", "windows", "nitro", "iphone", or part of its real name. */
function matchDevice(list, want) {
  if (!want) return null
  const w = norm(want)
  const exact = list.find((d) => norm(d.name) === w)
  if (exact) return exact
  const part = list.find((d) => norm(d.name).includes(w) || w.includes(norm(d.name)))
  if (part) return part
  const computers = list.filter((d) => d.type === 'Computer')
  if (/\bmac|macbook|imac\b/.test(w)) return computers.find((d) => /mac/i.test(d.name)) ?? null
  if (/windows|pc|nitro|acer|desktop|portatil/.test(w)) {
    return computers.find((d) => /desktop|nitro|acer|pc|windows/i.test(d.name)) ?? computers.find((d) => !/mac/i.test(d.name)) ?? null
  }
  if (/iphone|movil|telefono/.test(w)) return list.find((d) => d.type === 'Smartphone') ?? null
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Open the Spotify app on the computer ODIN runs on, and wait for it to appear as a device. */
async function openHere() {
  const before = new Set((await devices().catch(() => [])).map((d) => d.id))
  await new Promise((resolve) => {
    if (process.platform === 'darwin') execFile('open', ['-g', '-a', 'Spotify'], () => resolve())
    else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', 'spotify:'], () => resolve())
    else execFile('xdg-open', ['spotify:'], () => resolve())
  })
  for (let i = 0; i < 12; i++) {
    await sleep(1000)
    const list = await devices().catch(() => [])
    const here = list.find((d) => d.type === 'Computer' && !before.has(d.id)) ?? matchDevice(list, thisComputer())
    if (here) return here
  }
  return null
}

/** How this machine is called, for matching it against Spotify's device list. */
const thisComputer = () => (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : hostname())

/** The device to play on: the named one, else the active one, else this computer. */
async function pickDevice(want) {
  const list = await devices()
  if (want) {
    const hit = matchDevice(list, want)
    if (hit) return hit
    // Asked for this very computer and Spotify is closed here: open it.
    if (matchDevice([{ name: thisComputer(), type: 'Computer' }], want) || norm(want) === 'aqui') {
      const opened = await openHere()
      if (opened) return opened
    }
    throw new Error(
      `No Spotify device called "${want}" is available. Devices: ${list.map((d) => d.name).join(', ') || 'none'}. Spotify has to be open on that device.`,
    )
  }
  const active = list.find((d) => d.active)
  if (active) return active
  if (list.length) return list[0]
  const opened = await openHere()
  if (opened) return opened
  throw new Error('Spotify is not open on any device.')
}

// Search ------------------------------------------------------------------------

async function myPlaylists() {
  const out = []
  for (let offset = 0; offset < 200; offset += 50) {
    const page = await api(`/me/playlists?limit=50&offset=${offset}`)
    out.push(...(page?.items ?? []).filter(Boolean))
    if (!page?.next) break
  }
  return out
}

async function find(query, kind) {
  if (kind === 'liked') return { uri: null, liked: true, name: 'Canciones que te gustan' }
  if (kind === 'playlist') {
    // The user's own playlists first: "mi lista Verano" means theirs, not a stranger's.
    const q = norm(query)
    const lists = await myPlaylists()
    const mine = lists.find((p) => norm(p.name) === q) ?? lists.find((p) => norm(p.name).includes(q))
    if (mine) return { uri: mine.uri, name: mine.name, owner: 'tuya' }
  }
  const type = kind === 'playlist' ? 'playlist' : kind
  const data = await api(`/search?${new URLSearchParams({ q: query, type, limit: '5', market: 'from_token' })}`)
  const item = (data?.[`${type}s`]?.items ?? []).filter(Boolean)[0]
  if (!item) return null
  const by = item.artists?.map((a) => a.name).join(', ') ?? item.owner?.display_name ?? ''
  return { uri: item.uri, name: item.name, by }
}

// Tools ---------------------------------------------------------------------------

const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] })
const fail = (e) => ({ content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true })

const PLAY_DESCRIPTION = `Play music on Spotify: a song, an album, an artist, one of the user's
playlists (or any public one), or their liked songs.
- kind: "track" for a song, "album", "artist", "playlist", or "liked" for "mis me gusta".
- device: leave empty to play wherever Spotify is active. Set it when the user
  names a place: "mac", "windows", "nitro", "iphone", or a speaker's name. If
  Spotify is closed on the computer ODIN runs on, it is opened automatically.
Say what is now playing in one short sentence ("Suena Bohemian Rhapsody, de Queen.").`

export function spotifyServer() {
  return createSdkMcpServer({
    name: 'jarvis_spotify',
    version: '1.0.0',
    tools: [
      tool(
        'spotify_play',
        PLAY_DESCRIPTION,
        {
          query: z.string().optional().describe('What to search for: song, album, artist or playlist name. Not needed for kind "liked".'),
          kind: z.enum(['track', 'album', 'artist', 'playlist', 'liked']).default('track'),
          device: z.string().optional(),
          shuffle: z.boolean().optional(),
        },
        async ({ query, kind, device, shuffle }) => {
          try {
            const hit = await find(query ?? '', kind)
            if (!hit) return fail(`Nothing found on Spotify for "${query}".`)
            const dev = await pickDevice(device)
            const qs = `?device_id=${encodeURIComponent(dev.id)}`
            if (shuffle !== undefined) await api(`/me/player/shuffle?state=${shuffle}&device_id=${dev.id}`, { method: 'PUT' })
            let body
            if (hit.liked) {
              const saved = await api('/me/tracks?limit=50')
              body = { uris: (saved?.items ?? []).map((i) => i.track.uri) }
            } else if (kind === 'track') {
              body = { uris: [hit.uri] }
            } else {
              body = { context_uri: hit.uri }
            }
            await api(`/me/player/play${qs}`, { method: 'PUT', body: JSON.stringify(body) })
            return ok({ playing: hit.name, by: hit.by ?? hit.owner ?? '', kind, device: dev.name })
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'spotify_control',
        'Pause, resume, skip, go back, set the volume (0-100), or turn shuffle/repeat on or off. Acts on the active device unless one is named.',
        {
          action: z.enum(['pause', 'resume', 'next', 'previous', 'volume', 'shuffle_on', 'shuffle_off', 'repeat_on', 'repeat_off']),
          volume: z.number().min(0).max(100).optional(),
          device: z.string().optional(),
        },
        async ({ action, volume, device }) => {
          try {
            const dev = device ? await pickDevice(device) : null
            const d = dev ? `device_id=${encodeURIComponent(dev.id)}` : ''
            const amp = (q) => (q && d ? `${q}&${d}` : q || d)
            const calls = {
              pause: ['PUT', '/me/player/pause'],
              resume: ['PUT', '/me/player/play'],
              next: ['POST', '/me/player/next'],
              previous: ['POST', '/me/player/previous'],
              volume: ['PUT', `/me/player/volume`, `volume_percent=${Math.round(volume ?? 50)}`],
              shuffle_on: ['PUT', '/me/player/shuffle', 'state=true'],
              shuffle_off: ['PUT', '/me/player/shuffle', 'state=false'],
              repeat_on: ['PUT', '/me/player/repeat', 'state=context'],
              repeat_off: ['PUT', '/me/player/repeat', 'state=off'],
            }
            if (action === 'volume' && ducked && !device) {
              ducked.volume = Math.round(volume ?? 50)
              return ok('Done. The new volume applies as soon as ODIN stops listening.')
            }
            const [method, path, q] = calls[action]
            const query = amp(q ?? '')
            await api(`${path}${query ? `?${query}` : ''}`, { method })
            return ok('Done.')
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'spotify_now_playing',
        'What is playing right now, on which device, and whether it is paused.',
        {},
        async () => {
          try {
            const s = await api('/me/player')
            if (!s?.item) return ok('Nothing is playing.')
            return ok({
              title: s.item.name,
              by: s.item.artists?.map((a) => a.name).join(', ') ?? s.item.show?.name ?? '',
              album: s.item.album?.name ?? '',
              device: s.device?.name,
              playing: s.is_playing,
              volume: s.device?.volume_percent,
            })
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'spotify_devices',
        `Spotify devices available right now (Spotify must be open on them). ODIN itself runs on "${hostname()}" (${process.platform === 'darwin' ? 'the Mac' : process.platform === 'win32' ? 'the Windows PC' : process.platform}).`,
        {},
        async () => {
          try {
            return ok(await devices())
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'spotify_transfer',
        'Move what is playing to another device ("pásalo al Mac", "ponlo en el altavoz"), keeping the song and position.',
        { device: z.string() },
        async ({ device }) => {
          try {
            const dev = await pickDevice(device)
            await api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [dev.id], play: true }) })
            return ok({ device: dev.name })
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'spotify_my_playlists',
        "The user's own playlists by name, for when they ask what lists they have.",
        {},
        async () => {
          try {
            return ok((await myPlaylists()).map((p) => ({ name: p.name, tracks: p.tracks?.total })))
          } catch (e) {
            return fail(e)
          }
        },
      ),
    ],
  })
}
