import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { icloudCalendar, icloudConfigured } from './calendar-icloud.mjs'
import { z } from 'zod'

/**
 * The `calendar_*` tools — the macOS calendar, through EventKit.
 *
 * Going through the system calendar rather than a provider API means every
 * account already added on this Mac (iCloud, Google, Exchange) comes along for
 * free, with no OAuth and no keys. The work is done by a small Swift helper
 * (calendar-helper/, built with `npm run build:calendar`) because AppleScript
 * takes minutes to query a calendar with recurring events and EventKit takes
 * milliseconds.
 *
 * macOS grants calendar access to the app JARVIS was started from, so start it
 * from Terminal and allow the prompt once.
 *
 * Every change is confirmed by voice first: the write tools refuse unless
 * `confirmed` is true, and their descriptions say it may only be true after the
 * user said yes to a read-back of exactly that change.
 */

const HELPER = fileURLToPath(new URL('./calendar-helper/jarvis-calendar', import.meta.url))

/**
 * Which calendar to talk to. On a Mac with the helper built, the system
 * calendar (EventKit). Anywhere else — or when CALENDAR_BACKEND=icloud — iCloud
 * over CalDAV, which needs ICLOUD_USER and ICLOUD_APP_PASSWORD.
 */
export function calendarBackend() {
  const want = (process.env.CALENDAR_BACKEND ?? '').toLowerCase()
  if (want !== 'icloud' && process.platform === 'darwin' && existsSync(HELPER)) return 'macos'
  if (icloudConfigured()) return 'icloud'
  return null
}

function helper(request) {
  const backend = calendarBackend()
  if (backend === 'icloud') return icloudCalendar(request)
  if (backend === null) {
    return Promise.resolve({
      error:
        process.platform === 'darwin'
          ? 'Calendar helper not built. Run npm run build:calendar.'
          : 'No calendar configured. Set ICLOUD_USER and ICLOUD_APP_PASSWORD in .env.',
    })
  }
  return eventKit(request)
}

function eventKit(request) {
  return new Promise((resolve) => {
    execFile(HELPER, [JSON.stringify(request)], { timeout: 20_000 }, (err, stdout) => {
      if (err && !stdout) {
        return resolve({
          error:
            err.code === 'ENOENT'
              ? 'Calendar helper not built. Run npm run build:calendar.'
              : `Calendar helper failed: ${err.message}`,
        })
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve({ error: 'Calendar helper returned something unreadable.' })
      }
    })
  })
}

const reply = (res, key) =>
  res.error
    ? { content: [{ type: 'text', text: res.error }], isError: true }
    : { content: [{ type: 'text', text: JSON.stringify(key ? res[key] : res) }] }

const NOT_CONFIRMED = {
  content: [
    {
      type: 'text',
      text: 'Not done. Read the change back to the user in one sentence, ask whether to go ahead, and call again with confirmed: true only after they say yes.',
    },
  ],
  isError: true,
}

const confirmed = z
  .boolean()
  .describe(
    'true ONLY if, in their latest message, the user said yes to your spoken read-back of exactly this change. Otherwise false.',
  )

const localTime = (what) => z.string().describe(`${what}, local time, YYYY-MM-DDTHH:MM`)

const LIST_DESCRIPTION = `List events in the user's calendars between two local times.
Use it before answering anything about their schedule, and before moving or
deleting an event, to get its id. Recurring events come back as their actual
occurrences. Each event has id, calendar, title, start, end, allDay, location
and recurring.`

const CREATE_DESCRIPTION = `Create an event.
Before calling with confirmed: true, say the event back in one short sentence —
title, day and time — and ask "¿Lo creo?". Wait for their yes. If they named no
calendar, the default one is used. Default duration is one hour. For an all-day
event pass allDay: true and dates as YYYY-MM-DD.`

const UPDATE_DESCRIPTION = `Change one event: title, start, end, location or notes.
Get its id from calendar_list_events first. Before calling with confirmed: true,
say the change back in one sentence ("Muevo la reunión con Pablo al jueves a las
diez, ¿de acuerdo?") and wait for their yes. Moving the start without an end
keeps the original duration. On a recurring event only that occurrence changes.`

const DELETE_DESCRIPTION = `Delete one event. Get its id from calendar_list_events first.
Before calling with confirmed: true, name the event and its day and ask
"¿Lo elimino?". Wait for their yes. One event per confirmation. On a recurring
event only that occurrence is removed.`

export function calendarServer() {
  return createSdkMcpServer({
    name: 'jarvis_calendar',
    version: '1.0.0',
    tools: [
      tool(
        'calendar_now',
        'The current local date, weekday and time. Use it to resolve "mañana", "el jueves", "dentro de una hora".',
        {},
        async () => {
          const d = new Date()
          const pad = (n) => String(n).padStart(2, '0')
          const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
          return reply({ now: `${iso} (${d.toLocaleDateString('es-ES', { weekday: 'long' })})` }, 'now')
        },
      ),

      tool(
        'calendar_list_calendars',
        'List the calendars, whether each can be written to, and which is the default for new events.',
        {},
        async () => reply(await helper({ op: 'calendars' }), 'calendars'),
      ),

      tool(
        'calendar_list_events',
        LIST_DESCRIPTION,
        { from: localTime('Start of the range'), to: localTime('End of the range') },
        async ({ from, to }) => reply(await helper({ op: 'list', from, to }), 'events'),
      ),

      tool(
        'calendar_create_event',
        CREATE_DESCRIPTION,
        {
          title: z.string(),
          start: localTime('Start (or YYYY-MM-DD if allDay)'),
          end: localTime('End. Defaults to one hour after start').optional(),
          calendar: z.string().optional().describe('Calendar name. Defaults to the default calendar.'),
          allDay: z.boolean().optional(),
          location: z.string().optional(),
          notes: z.string().optional(),
          confirmed,
        },
        async ({ confirmed: yes, ...a }) =>
          yes === true ? reply(await helper({ op: 'create', ...a }), 'event') : NOT_CONFIRMED,
      ),

      tool(
        'calendar_update_event',
        UPDATE_DESCRIPTION,
        {
          id: z.string(),
          title: z.string().optional(),
          start: localTime('New start').optional(),
          end: localTime('New end').optional(),
          location: z.string().optional(),
          notes: z.string().optional(),
          confirmed,
        },
        async ({ confirmed: yes, ...a }) =>
          yes === true ? reply(await helper({ op: 'update', ...a }), 'event') : NOT_CONFIRMED,
      ),

      tool(
        'calendar_delete_event',
        DELETE_DESCRIPTION,
        { id: z.string(), confirmed },
        async ({ confirmed: yes, id }) =>
          yes === true ? reply(await helper({ op: 'delete', id }), 'deleted') : NOT_CONFIRMED,
      ),
    ],
  })
}
