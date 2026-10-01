// jarvis-calendar — a tiny EventKit command line for bridge/calendar.mjs.
//
// AppleScript can drive Calendar.app too, but a `whose` query across a few
// calendars with recurring events takes minutes. EventKit answers in
// milliseconds and expands recurring events into their real occurrences.
//
// Usage: jarvis-calendar '<json request>'   →  prints one JSON reply.
// Dates are local wall-clock strings, "YYYY-MM-DDTHH:MM".

import EventKit
import Foundation

let store = EKEventStore()

func reply(_ obj: Any) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

func fail(_ msg: String) -> Never { reply(["error": msg]) }

let fmt: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd'T'HH:mm"
    return f
}()

func parseDate(_ v: Any?) -> Date? {
    guard var s = v as? String, !s.isEmpty else { return nil }
    if s.count == 10 { s += "T00:00" }
    return fmt.date(from: String(s.prefix(16)))
}

// An occurrence of a recurring event shares its eventIdentifier with every
// other occurrence, so the id carries the occurrence's start as well.
func eventId(_ e: EKEvent) -> String { "\(e.eventIdentifier ?? "")@\(fmt.string(from: e.startDate))" }

func findEvent(_ id: String) -> EKEvent {
    let bits = id.split(separator: "@", maxSplits: 1).map(String.init)
    guard let base = bits.first, !base.isEmpty else { fail("Bad event id.") }
    if bits.count == 2, let start = fmt.date(from: bits[1]) {
        let pred = store.predicateForEvents(
            withStart: start.addingTimeInterval(-60), end: start.addingTimeInterval(60), calendars: nil)
        if let hit = store.events(matching: pred).first(where: { $0.eventIdentifier == base }) { return hit }
    }
    if let e = store.event(withIdentifier: base) { return e }
    fail("No event with that id.")
}

func describe(_ e: EKEvent) -> [String: Any] {
    [
        "id": eventId(e),
        "calendar": e.calendar.title,
        "title": e.title ?? "",
        "start": fmt.string(from: e.startDate),
        "end": fmt.string(from: e.endDate),
        "allDay": e.isAllDay,
        "location": e.location ?? "",
        "recurring": e.hasRecurrenceRules,
    ]
}

// Access ---------------------------------------------------------------------

let gate = DispatchSemaphore(value: 0)
var granted = false
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, _ in granted = ok; gate.signal() }
} else {
    store.requestAccess(to: .event) { ok, _ in granted = ok; gate.signal() }
}
gate.wait()
if !granted {
    fail("Calendar access denied. Allow it in System Settings → Privacy & Security → Calendars.")
}

// Request --------------------------------------------------------------------

guard CommandLine.arguments.count > 1,
      let raw = CommandLine.arguments[1].data(using: .utf8),
      let req = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
      let op = req["op"] as? String
else { fail("Expected one JSON argument with an op.") }

switch op {
case "calendars":
    let cals = store.calendars(for: .event).map { c -> [String: Any] in
        ["name": c.title, "writable": c.allowsContentModifications,
         "default": c.calendarIdentifier == store.defaultCalendarForNewEvents?.calendarIdentifier]
    }
    reply(["calendars": cals])

case "list":
    guard let from = parseDate(req["from"]), let to = parseDate(req["to"]) else { fail("Bad from/to.") }
    let pred = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }
    reply(["events": events.map(describe)])

case "create":
    guard let title = req["title"] as? String, let start = parseDate(req["start"]) else {
        fail("Need title and start.")
    }
    let allDay = req["allDay"] as? Bool ?? false
    let cal: EKCalendar
    if let name = req["calendar"] as? String, !name.isEmpty {
        guard let c = store.calendars(for: .event).first(where: {
            $0.title.caseInsensitiveCompare(name) == .orderedSame && $0.allowsContentModifications
        }) else { fail("No writable calendar named \(name).") }
        cal = c
    } else {
        guard let c = store.defaultCalendarForNewEvents else { fail("No default calendar.") }
        cal = c
    }
    let e = EKEvent(eventStore: store)
    e.calendar = cal
    e.title = title
    e.isAllDay = allDay
    e.startDate = start
    e.endDate = parseDate(req["end"]) ?? (allDay ? start : start.addingTimeInterval(3600))
    if let l = req["location"] as? String, !l.isEmpty { e.location = l }
    if let n = req["notes"] as? String, !n.isEmpty { e.notes = n }
    do { try store.save(e, span: .thisEvent, commit: true) } catch { fail(error.localizedDescription) }
    reply(["event": describe(e)])

case "update":
    guard let id = req["id"] as? String else { fail("Need id.") }
    let e = findEvent(id)
    if let t = req["title"] as? String, !t.isEmpty { e.title = t }
    if let l = req["location"] as? String, !l.isEmpty { e.location = l }
    if let n = req["notes"] as? String, !n.isEmpty { e.notes = n }
    let newStart = parseDate(req["start"])
    let newEnd = parseDate(req["end"])
    if let s = newStart {
        let dur = e.endDate.timeIntervalSince(e.startDate)
        e.startDate = s
        e.endDate = newEnd ?? s.addingTimeInterval(dur)
    } else if let en = newEnd {
        e.endDate = en
    }
    do { try store.save(e, span: .thisEvent, commit: true) } catch { fail(error.localizedDescription) }
    reply(["event": describe(e)])

case "delete":
    guard let id = req["id"] as? String else { fail("Need id.") }
    let e = findEvent(id)
    let gone = describe(e)
    do { try store.remove(e, span: .thisEvent, commit: true) } catch { fail(error.localizedDescription) }
    reply(["deleted": gone])

default:
    fail("Unknown op \(op).")
}
