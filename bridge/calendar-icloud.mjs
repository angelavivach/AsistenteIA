import { DAVClient } from 'tsdav'
import ICAL from 'ical.js'
import { randomUUID } from 'node:crypto'

/**
 * iCloud Calendar over CalDAV — the calendar backend for Windows and Linux,
 * where EventKit does not exist.
 *
 * Speaks the same small protocol as calendar-helper (the Swift/EventKit one):
 * every op returns the same JSON shapes, so calendar.mjs does not care which
 * backend answered.
 *
 * Needs an app-specific password (appleid.apple.com → Sign-In and Security →
 * App-Specific Passwords), never the Apple ID password itself:
 *   ICLOUD_USER=you@icloud.com
 *   ICLOUD_APP_PASSWORD=abcd-efgh-ijkl-mnop
 *   ICLOUD_DEFAULT_CALENDAR=Casa        (optional)
 *
 * Times cross this boundary as local wall-clock "YYYY-MM-DDTHH:MM" in the
 * timezone of the machine running the bridge.
 *
 * Recurring events: an occurrence can be moved or deleted on its own. Deleting
 * adds an EXDATE to the series; moving adds the EXDATE and creates a standalone
 * copy at the new time, which is how Calendar.app shows it too.
 */

export const icloudConfigured = () =>
  Boolean(process.env.ICLOUD_USER && process.env.ICLOUD_APP_PASSWORD)

let clientPromise = null
function client() {
  if (!clientPromise) {
    const c = new DAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: {
        username: process.env.ICLOUD_USER,
        password: process.env.ICLOUD_APP_PASSWORD,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })
    clientPromise = c.login().then(() => c)
    // A failed login must not poison every later call.
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

// Dates ----------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')
const fmtLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

function parseLocal(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v ?? '').trim())
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))
}

const utcTime = (d) => ICAL.Time.fromJSDate(d, true)
function dateOnly(d) {
  const t = ICAL.Time.fromData({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() })
  t.isDate = true
  return t
}

/** Register any VTIMEZONEs in a calendar object so TZID times convert correctly. */
function registerZones(vcal) {
  for (const z of vcal.getAllSubcomponents('vtimezone')) {
    const tz = new ICAL.Timezone(z)
    if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz.tzid, tz)
  }
}

function parseObject(data) {
  const vcal = new ICAL.Component(ICAL.parse(data))
  registerZones(vcal)
  const vevents = vcal.getAllSubcomponents('vevent')
  const master = vevents.find((v) => !v.hasProperty('recurrence-id')) ?? vevents[0]
  return { vcal, vevents, master }
}

// Calendars ------------------------------------------------------------------

async function eventCalendars() {
  const c = await client()
  const cals = await c.fetchCalendars()
  return cals.filter((cal) => !cal.components || cal.components.includes('VEVENT'))
}

const calName = (cal) => (typeof cal.displayName === 'string' ? cal.displayName : String(cal.displayName ?? 'Calendario'))

async function defaultCalendar(cals) {
  const want = (process.env.ICLOUD_DEFAULT_CALENDAR ?? '').toLowerCase()
  return (want && cals.find((c) => calName(c).toLowerCase() === want)) || cals[0]
}

// Occurrences ----------------------------------------------------------------

/** Every occurrence of the events in one calendar object that overlaps [from, to). */
function occurrences(obj, from, to) {
  const { vevents, master } = parseObject(obj.data)
  if (!master) return []
  const out = []
  const ev = new ICAL.Event(master, { exceptions: vevents.filter((v) => v !== master) })

  const push = (start, end, details, recurring) => {
    const s = start.toJSDate()
    const e = end.toJSDate()
    if (e <= from || s >= to) return
    const item = details?.item ?? ev
    out.push({
      id: `${obj.url}@${fmtLocal(s)}`,
      title: item.summary ?? '',
      start: fmtLocal(s),
      end: fmtLocal(e),
      allDay: start.isDate,
      location: item.location ?? '',
      recurring,
    })
  }

  if (!ev.isRecurring()) {
    push(ev.startDate, ev.endDate, null, false)
    return out
  }
  const it = ev.iterator()
  for (let next = it.next(), guard = 0; next && guard < 2000; next = it.next(), guard++) {
    const d = ev.getOccurrenceDetails(next)
    if (d.startDate.toJSDate() >= to) break
    push(d.startDate, d.endDate, d, true)
  }
  return out
}

async function objectsIn(cal, from, to) {
  const c = await client()
  return c.fetchCalendarObjects({
    calendar: cal,
    timeRange: { start: from.toISOString(), end: to.toISOString() },
  })
}

/** Resolve an id back to its calendar object (fresh, with etag) and occurrence start. */
async function locate(id) {
  const at = id.lastIndexOf('@')
  if (at < 0) throw new Error('Bad event id.')
  const url = id.slice(0, at)
  const start = parseLocal(id.slice(at + 1))
  const c = await client()
  for (const cal of await eventCalendars()) {
    if (!url.startsWith(cal.url)) continue
    const [obj] = await c.fetchCalendarObjects({ calendar: cal, objectUrls: [url] })
    if (obj?.data) return { cal, obj, start }
  }
  throw new Error('No event with that id.')
}

/** The occurrence's start as the series stores it, for EXDATE. */
function occurrenceTime(master, start) {
  const ev = new ICAL.Event(master)
  const it = ev.iterator()
  for (let next = it.next(), guard = 0; next && guard < 5000; next = it.next(), guard++) {
    const t = next.toJSDate().getTime()
    if (Math.abs(t - start.getTime()) < 60_000) return next
    if (t > start.getTime() + 60_000) break
  }
  return null
}

// Writing --------------------------------------------------------------------

/** EXDATE has to carry the series' TZID, or iCloud reads it as floating time and the occurrence survives. */
function addExdate(master, t) {
  const prop = new ICAL.Property('exdate')
  prop.setValue(t)
  const tzid = t.zone?.tzid
  if (tzid && tzid !== 'UTC' && tzid !== 'floating') prop.setParameter('tzid', tzid)
  master.addProperty(prop)
}

function buildEvent({ title, start, end, allDay, location, notes }) {
  const vcal = new ICAL.Component(['vcalendar', [], []])
  vcal.updatePropertyWithValue('prodid', '-//Odin//ES')
  vcal.updatePropertyWithValue('version', '2.0')
  const v = new ICAL.Component('vevent')
  const uid = randomUUID().toUpperCase()
  v.updatePropertyWithValue('uid', uid)
  v.updatePropertyWithValue('dtstamp', utcTime(new Date()))
  v.updatePropertyWithValue('summary', title)
  if (allDay) {
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
    v.updatePropertyWithValue('dtstart', dateOnly(start))
    v.updatePropertyWithValue('dtend', dateOnly(endDay))
  } else {
    v.updatePropertyWithValue('dtstart', utcTime(start))
    v.updatePropertyWithValue('dtend', utcTime(end))
  }
  if (location) v.updatePropertyWithValue('location', location)
  if (notes) v.updatePropertyWithValue('description', notes)
  vcal.addSubcomponent(v)
  return { uid, ics: vcal.toString() }
}

async function create(req) {
  const cals = await eventCalendars()
  let cal
  if (req.calendar) {
    cal = cals.find((c) => calName(c).toLowerCase() === String(req.calendar).toLowerCase())
    if (!cal) return { error: `No calendar named ${req.calendar}.` }
  } else {
    cal = await defaultCalendar(cals)
  }
  const start = parseLocal(req.start)
  if (!req.title || !start) return { error: 'Need title and start.' }
  const allDay = Boolean(req.allDay)
  const end = parseLocal(req.end) ?? (allDay ? start : new Date(start.getTime() + 3600_000))

  const { uid, ics } = buildEvent({ title: req.title, start, end, allDay, location: req.location, notes: req.notes })
  const c = await client()
  const res = await c.createCalendarObject({ calendar: cal, filename: `${uid}.ics`, iCalString: ics })
  if (!res.ok) return { error: `iCloud refused the event (${res.status}).` }
  const url = new URL(`${uid}.ics`, cal.url).href
  return {
    event: {
      id: `${url}@${fmtLocal(start)}`,
      calendar: calName(cal),
      title: req.title,
      start: fmtLocal(start),
      end: fmtLocal(end),
      allDay,
      location: req.location ?? '',
      recurring: false,
    },
  }
}

async function save(obj, vcal) {
  const c = await client()
  const res = await c.updateCalendarObject({
    calendarObject: { url: obj.url, etag: obj.etag, data: vcal.toString() },
  })
  if (!res.ok) throw new Error(`iCloud refused the change (${res.status}).`)
}

async function update(req) {
  const { cal, obj, start } = await locate(req.id)
  const { vcal, master } = parseObject(obj.data)
  const ev = new ICAL.Event(master)

  if (ev.isRecurring()) {
    // Detach this one occurrence: hide it in the series, recreate it changed.
    const occ = occurrenceTime(master, start)
    if (!occ) return { error: 'That occurrence no longer exists.' }
    const d = ev.getOccurrenceDetails(occ)
    const oldStart = d.startDate.toJSDate()
    const oldEnd = d.endDate.toJSDate()
    const newStart = parseLocal(req.start) ?? oldStart
    const newEnd = parseLocal(req.end) ?? new Date(newStart.getTime() + (oldEnd - oldStart))
    addExdate(master, occ)
    await save(obj, vcal)
    return create({
      calendar: calName(cal),
      title: req.title || ev.summary,
      start: fmtLocal(newStart),
      end: fmtLocal(newEnd),
      allDay: d.startDate.isDate,
      location: req.location || ev.location,
      notes: req.notes || ev.description,
    })
  }

  if (req.title) master.updatePropertyWithValue('summary', req.title)
  if (req.location) master.updatePropertyWithValue('location', req.location)
  if (req.notes) master.updatePropertyWithValue('description', req.notes)
  const s0 = ev.startDate.toJSDate()
  const e0 = ev.endDate.toJSDate()
  const s = parseLocal(req.start)
  const e = parseLocal(req.end)
  if (s || e) {
    const ns = s ?? s0
    const ne = e ?? new Date(ns.getTime() + (e0 - s0))
    if (ev.startDate.isDate) {
      master.updatePropertyWithValue('dtstart', dateOnly(ns))
      master.updatePropertyWithValue('dtend', dateOnly(new Date(ne.getFullYear(), ne.getMonth(), ne.getDate() + (e ? 1 : 0))))
    } else {
      master.updatePropertyWithValue('dtstart', utcTime(ns))
      master.updatePropertyWithValue('dtend', utcTime(ne))
    }
    master.removeAllProperties('duration')
  }
  await save(obj, vcal)
  const [after] = occurrences({ url: obj.url, data: vcal.toString() }, new Date(0), new Date(8.64e15))
  return { event: { ...after, calendar: calName(cal) } }
}

async function remove(req) {
  const { cal, obj, start } = await locate(req.id)
  const { vcal, master } = parseObject(obj.data)
  const ev = new ICAL.Event(master)
  const gone = {
    id: req.id,
    calendar: calName(cal),
    title: ev.summary ?? '',
    start: fmtLocal(start),
    recurring: ev.isRecurring(),
  }
  if (ev.isRecurring()) {
    const occ = occurrenceTime(master, start)
    if (!occ) return { error: 'That occurrence no longer exists.' }
    addExdate(master, occ)
    await save(obj, vcal)
  } else {
    const c = await client()
    const res = await c.deleteCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag } })
    if (!res.ok) return { error: `iCloud refused the deletion (${res.status}).` }
  }
  return { deleted: gone }
}

// Entry point ----------------------------------------------------------------

export async function icloudCalendar(req) {
  try {
    switch (req.op) {
      case 'calendars': {
        const cals = await eventCalendars()
        const def = await defaultCalendar(cals)
        return {
          calendars: cals.map((c) => ({ name: calName(c), writable: true, default: c === def })),
        }
      }
      case 'list': {
        const from = parseLocal(req.from)
        const to = parseLocal(req.to)
        if (!from || !to) return { error: 'Bad from/to.' }
        const events = []
        for (const cal of await eventCalendars()) {
          for (const obj of await objectsIn(cal, from, to)) {
            if (!obj.data) continue
            for (const o of occurrences(obj, from, to)) events.push({ ...o, calendar: calName(cal) })
          }
        }
        events.sort((a, b) => a.start.localeCompare(b.start))
        return { events }
      }
      case 'create':
        return await create(req)
      case 'update':
        return await update(req)
      case 'delete':
        return await remove(req)
      default:
        return { error: `Unknown op ${req.op}.` }
    }
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (/401|unauthori[sz]ed|Invalid credentials/i.test(msg)) {
      return { error: 'iCloud rejected the login. Check ICLOUD_USER and the app-specific password.' }
    }
    return { error: `iCloud calendar error: ${msg}` }
  }
}

// Exposed for offline checks of recurrence handling.
export { occurrences as _occurrences, parseObject as _parseObject, occurrenceTime as _occurrenceTime, addExdate as _addExdate }
