import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Timers and alarms, kept by the bridge so they ring even when nobody is
 * talking to ODIN — and still ring after a restart, because they are saved to
 * ~/.odin/timers.json.
 *
 * When one goes off, every open ODIN page gets an `alarm` message (chime + the
 * line spoken aloud), and the computer shows a system notification as well, so
 * an alarm with no page open is not silent.
 */

const FILE = join(homedir(), '.odin', 'timers.json')
const MAX_DELAY = 2 ** 31 - 1 // setTimeout's ceiling (~24.8 days)

/** @type {Map<string, {id:string, kind:'timer'|'alarm', label:string, at:number, handle?:NodeJS.Timeout}>} */
const timers = new Map()
let notify = () => {}

async function persist() {
  await mkdir(join(homedir(), '.odin'), { recursive: true })
  const list = [...timers.values()].map(({ handle, ...t }) => t)
  await writeFile(FILE, JSON.stringify(list), { mode: 0o600 })
}

const pad = (n) => String(n).padStart(2, '0')
const clock = (ms) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function systemNotify(title, text) {
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', '-e', 'end run', title, text], () => {})
  } else if (process.platform === 'win32') {
    // `msg` pops a dialog on the console session; no shell, so the text is never interpreted.
    execFile('msg', ['*', '/TIME:120', `${title}: ${text}`], () => {})
  }
}

function fire(id) {
  const t = timers.get(id)
  if (!t) return
  timers.delete(id)
  void persist()
  const label = t.label?.trim()
  const text =
    t.kind === 'alarm'
      ? `Angela, son las ${clock(t.at)}.${label ? ` ${label}.` : ''}`
      : `Angela, el temporizador${label ? ` de ${label}` : ''} ha terminado.`
  notify({ type: 'alarm', kind: t.kind, label: label ?? '', text })
  systemNotify('Odín', text)
}

function arm(t) {
  const wait = t.at - Date.now()
  if (wait <= 0) return fire(t.id)
  // Far-off alarms re-arm in steps, since setTimeout overflows past ~24 days.
  t.handle = setTimeout(() => (t.at - Date.now() > 1000 ? arm(t) : fire(t.id)), Math.min(wait, MAX_DELAY))
}

async function add(kind, at, label) {
  const t = { id: randomUUID().slice(0, 8), kind, label: label ?? '', at }
  timers.set(t.id, t)
  arm(t)
  await persist()
  return t
}

/** Load saved timers and route alarms to the open pages. Call once at startup. */
export async function startTimers(broadcast) {
  notify = broadcast
  try {
    const list = JSON.parse(await readFile(FILE, 'utf8'))
    for (const t of list) {
      // Anything that came due while ODIN was off rings now, once — unless it
      // is more than an hour stale, which would only be confusing.
      if (t.at < Date.now() - 3600_000) continue
      timers.set(t.id, t)
      arm(t)
    }
    await persist()
  } catch {
    /* no saved timers */
  }
}

const describe = (t) => ({
  id: t.id,
  kind: t.kind,
  label: t.label,
  rings_at: clock(t.at),
  date: new Date(t.at).toLocaleDateString('es-ES'),
  minutes_left: Math.max(0, Math.round((t.at - Date.now()) / 60000)),
})

const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] })
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true })

export function timersServer() {
  return createSdkMcpServer({
    name: 'jarvis_timers',
    version: '1.0.0',
    tools: [
      tool(
        'timer_set',
        'Start a countdown timer ("pon un temporizador de diez minutos para la pasta"). Give the duration in seconds. Confirm with when it will ring.',
        { seconds: z.number().positive(), label: z.string().optional() },
        async ({ seconds, label }) => {
          const t = await add('timer', Date.now() + seconds * 1000, label)
          return ok(describe(t))
        },
      ),

      tool(
        'alarm_set',
        'Set an alarm for a clock time ("despiértame a las siete", "avísame a las 17:30 de llamar a mamá"). time is local HH:MM; date YYYY-MM-DD is optional — without it, the next time that clock time comes round (today or tomorrow). Confirm the day and time.',
        {
          time: z.string().regex(/^\d{1,2}:\d{2}$/),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          label: z.string().optional(),
        },
        async ({ time, date, label }) => {
          const [h, m] = time.split(':').map(Number)
          if (h > 23 || m > 59) return fail('Bad time.')
          let at
          if (date) {
            const [y, mo, d] = date.split('-').map(Number)
            at = new Date(y, mo - 1, d, h, m).getTime()
          } else {
            const now = new Date()
            at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime()
            if (at <= Date.now()) at += 86_400_000
          }
          if (at <= Date.now()) return fail('That time has already passed.')
          const t = await add('alarm', at, label)
          return ok(describe(t))
        },
      ),

      tool(
        'timers_list',
        'Timers and alarms still pending, with how long is left.',
        {},
        async () => {
          const list = [...timers.values()].sort((a, b) => a.at - b.at).map(describe)
          return ok(list.length ? list : 'No timers or alarms pending.')
        },
      ),

      tool(
        'timer_cancel',
        'Cancel a timer or alarm by id (from timers_list), or all of them with all: true.',
        { id: z.string().optional(), all: z.boolean().optional() },
        async ({ id, all }) => {
          const ids = all ? [...timers.keys()] : id ? [id] : []
          let n = 0
          for (const k of ids) {
            const t = timers.get(k)
            if (!t) continue
            clearTimeout(t.handle)
            timers.delete(k)
            n++
          }
          await persist()
          return n ? ok(`Cancelled ${n}.`) : fail('Nothing to cancel with that id.')
        },
      ),
    ],
  })
}
