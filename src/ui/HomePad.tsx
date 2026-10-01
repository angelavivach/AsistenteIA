import { useCallback, useEffect, useMemo, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { useStore } from '../store'

/**
 * The home pad: lights, plugs, scenes and the rest of the house as a panel over
 * the orb, grouped by room. Opened with the CASA button or the C key.
 *
 * Everything goes through the bridge (/home/*), which holds the Home Assistant
 * token; the page never sees it. While open it re-reads the house every few
 * seconds, so a light Odín just switched off by voice goes dark here too.
 */

type Device = {
  id: string
  name: string
  domain: string
  state: string
  area: string
  brightness: number | null
}

const ON_STATES = new Set(['on', 'open', 'opening', 'playing', 'heat', 'cool', 'auto', 'heat_cool'])
const KIND: Record<string, string> = {
  light: 'luz',
  switch: 'enchufe',
  fan: 'ventilador',
  cover: 'persiana',
  climate: 'clima',
  media_player: 'multimedia',
}
const POLL_MS = 4000

async function call(path: string, body?: object) {
  const res = await fetch(`${BRIDGE_HTTP_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `error ${res.status}`)
  return data
}

export function HomePad() {
  const phase = useStore((s) => s.phase)
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { devices } = await call('/home/devices')
      setDevices(devices)
      setError('')
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [open, refresh])

  // C opens and closes the pad; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.key === 'c' || e.key === 'C') && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) setOpen((o) => !o)
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggle = async (d: Device) => {
    setBusy(d.id)
    // Optimistic: flip it now, the next poll corrects it if Home Assistant disagrees.
    if (d.domain !== 'scene') {
      setDevices((list) =>
        list.map((x) => (x.id === d.id ? { ...x, state: ON_STATES.has(x.state) ? 'off' : 'on' } : x)),
      )
    }
    try {
      await call('/home/toggle', { id: d.id })
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
      setTimeout(refresh, 600)
    }
  }

  // The slider moves locally while dragging and is sent once, on release.
  const dimLocal = (d: Device, pct: number) =>
    setDevices((list) => list.map((x) => (x.id === d.id ? { ...x, brightness: pct, state: 'on' } : x)))
  const dim = async (d: Device, pct: number) => {
    try {
      await call('/home/brightness', { id: d.id, pct })
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const scenes = useMemo(() => devices.filter((d) => d.domain === 'scene'), [devices])
  const rooms = useMemo(() => {
    const map = new Map<string, Device[]>()
    for (const d of devices) {
      if (d.domain === 'scene') continue
      const room = d.area || 'Otros'
      if (!map.has(room)) map.set(room, [])
      map.get(room)!.push(d)
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Otros' ? 1 : b === 'Otros' ? -1 : a.localeCompare(b)))
  }, [devices])

  if (phase === 'offline' || phase === 'boot') return null

  return (
    <>
      <button className={`homepad-toggle ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        CASA
      </button>

      {open && (
        <div className="homepad" role="dialog" aria-label="Casa">
          <div className="homepad-head">
            <span className="homepad-title">CASA</span>
            <button className="homepad-close" onClick={() => setOpen(false)} aria-label="Cerrar">
              ×
            </button>
          </div>

          {error && (
            <div className="homepad-error">
              {/not configured/i.test(error)
                ? 'Home Assistant no está conectado. Añade HA_URL y HA_TOKEN en .env.'
                : `No se puede contactar con Home Assistant: ${error}`}
            </div>
          )}

          {scenes.length > 0 && (
            <div className="homepad-scenes">
              {scenes.map((s) => (
                <button key={s.id} className="homepad-scene" onClick={() => void toggle(s)} disabled={busy === s.id}>
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <div className="homepad-rooms">
            {rooms.map(([room, list]) => (
              <section key={room} className="homepad-room">
                <h3>{room}</h3>
                <div className="homepad-grid">
                  {list.map((d) => {
                    const on = ON_STATES.has(d.state)
                    return (
                      <div key={d.id} className={`homepad-card ${on ? 'is-on' : ''}`}>
                        <button className="homepad-card-main" onClick={() => void toggle(d)} disabled={busy === d.id}>
                          <span className="homepad-dot" />
                          <span className="homepad-name">{d.name}</span>
                          <span className="homepad-kind">
                            {KIND[d.domain] ?? d.domain} · {on ? 'encendido' : 'apagado'}
                          </span>
                        </button>
                        {d.domain === 'light' && d.brightness !== null && (
                          <input
                            className="homepad-slider"
                            type="range"
                            min={1}
                            max={100}
                            value={on ? d.brightness : 0}
                            aria-label={`Brillo de ${d.name}`}
                            onChange={(e) => dimLocal(d, Number(e.target.value))}
                            onPointerUp={(e) => void dim(d, Number(e.currentTarget.value))}
                            onKeyUp={(e) => void dim(d, Number(e.currentTarget.value))}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
            {!error && devices.length === 0 && <div className="homepad-empty">Buscando dispositivos…</div>}
          </div>
        </div>
      )}
    </>
  )
}
