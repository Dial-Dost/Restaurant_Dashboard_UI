// TIME SLOTS ("sessions") for the MIS report pack — a pure port of the app's
// lib/services/time_slot.dart. All day / one saved session / custom times; the
// query parts every report is sent; what the server applied (`meta.time_slot`);
// the clamp sentences; the four time-wise buckets; and the row→slot drill rules.
// No React, no network.

export const MAX_TIME_SLOTS = 8
export const MAX_TIME_SLOT_LABEL = 24

const CLOCK = /^(\d{1,2}):(\d{2})$/

/** `HH:mm` → minutes after midnight; `24:00` only with allow24. */
export function parseClock(text: unknown, allow24 = false): number | null {
    if (typeof text !== "string") { return null }
    const m = CLOCK.exec(text.trim())
    if (!m) { return null }
    const h = Number(m[1])
    const min = Number(m[2])
    if (h === 24 && min === 0) { return allow24 ? 1440 : null }
    if (h > 23 || min > 59) { return null }
    return h * 60 + min
}

/** An END time; `00:00` reads as midnight (1440). */
export function parseEndClock(text: unknown): number | null {
    const m = parseClock(text, true)
    return m === 0 ? 1440 : m
}

export function formatClock(minutes: number): string {
    const total = Math.min(1440, Math.max(0, minutes))
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

export const clockRange = (start: string, end: string): string => `${start}–${end}`

export function validateCustomSlot(from: string, to: string): string | null {
    const start = parseClock(from)
    if (start === null) { return "Start time must be a 24-hour time between 00:00 and 23:59." }
    const end = parseEndClock(to)
    if (end === null) { return "End time must be a 24-hour time between 00:00 and 24:00." }
    if (start === end) { return "Start and end are the same time — choose two different times." }
    return null
}

export function crossesMidnight(from: string, to: string): boolean {
    const start = parseClock(from)
    const end = parseEndClock(to)
    return start !== null && end !== null && end < start
}

export interface TimeSlotPreset {
    id: string
    label: string
    start: string
    end: string
    crossesMidnight: boolean
}

export const presetOptionLabel = (p: TimeSlotPreset): string => `${p.label} · ${clockRange(p.start, p.end)}`

export interface TimeSlotCatalogue {
    slots: TimeSlotPreset[]
    canEdit: boolean
    isDefault: boolean
}

export function catalogueFromJson(raw: unknown): TimeSlotCatalogue | null {
    if (!raw || typeof raw !== "object") { return null }
    const r = raw as Record<string, unknown>
    if (!Array.isArray(r.slots)) { return null }
    const slots: TimeSlotPreset[] = []
    for (const item of r.slots as unknown[]) {
        if (!item || typeof item !== "object") { continue }
        const it = item as Record<string, unknown>
        const id = typeof it.id === "string" ? it.id : ""
        const label = typeof it.label === "string" ? it.label : ""
        const start = typeof it.start === "string" ? it.start : ""
        const end = typeof it.end === "string" ? it.end : ""
        if (!id || parseClock(start) === null || parseClock(end, true) === null) { continue }
        slots.push({ id, label: label || id, start, end, crossesMidnight: it.crosses_midnight === true })
    }
    return { slots, canEdit: r.can_edit === true, isDefault: r.is_default === true }
}

// --- The reader's choice -------------------------------------------------------

export type TimeSlotSelection =
    | { kind: "all" }
    | { kind: "preset"; id: string }
    | { kind: "custom"; from: string; to: string }

export const ALL_DAY: TimeSlotSelection = { kind: "all" }

export function presetSelection(id: string): TimeSlotSelection {
    const t = id.trim()
    return !t || t === "all" ? ALL_DAY : { kind: "preset", id: t }
}

/** Validated and re-formatted; 00:00–24:00 IS all day. */
export function customSelection(from: string, to: string): TimeSlotSelection {
    if (validateCustomSlot(from, to) !== null) { return ALL_DAY }
    const start = parseClock(from) ?? 0
    const end = parseEndClock(to) ?? 1440
    if (start === 0 && end === 1440) { return ALL_DAY }
    return { kind: "custom", from: formatClock(start), to: formatClock(end) }
}

export function selectionKey(sel: TimeSlotSelection): string {
    if (sel.kind === "preset") { return `preset:${sel.id}` }
    if (sel.kind === "custom") { return `custom:${sel.from}-${sel.to}` }
    return "all"
}

/** Query-string pairs. All day adds nothing. */
export function selectionQuery(sel: TimeSlotSelection): Record<string, string> {
    if (sel.kind === "preset") { return { slot: sel.id } }
    if (sel.kind === "custom") { return { time_from: sel.from, time_to: sel.to } }
    return {}
}

/** What the chip says. */
export function selectionLabel(sel: TimeSlotSelection, presets: TimeSlotPreset[]): string {
    if (sel.kind === "custom") { return `Custom · ${clockRange(sel.from, sel.to)}` }
    if (sel.kind === "preset") {
        const p = presets.find((x) => x.id === sel.id)
        return p ? presetOptionLabel(p) : "All day"
    }
    return "All day"
}

/** `Lunch (12:00–17:00)` or `22:00–02:00`; null for all day. */
export function selectionPhrase(sel: TimeSlotSelection, presets: TimeSlotPreset[]): string | null {
    if (sel.kind === "custom") { return clockRange(sel.from, sel.to) }
    if (sel.kind === "preset") {
        const p = presets.find((x) => x.id === sel.id)
        return p ? `${p.label} (${clockRange(p.start, p.end)})` : null
    }
    return null
}

export function reconcileSelection(sel: TimeSlotSelection, presets: TimeSlotPreset[]): TimeSlotSelection {
    return sel.kind === "preset" && !presets.some((p) => p.id === sel.id) ? ALL_DAY : sel
}

/** What a selection MEANS right now (hours + name of a picked preset; the whole
 *  list for the "By session" cut) — the reports fetch is keyed on this. */
export function slotDefinitionKey(sel: TimeSlotSelection, presets: TimeSlotPreset[], bucket?: string): string {
    let pick = selectionKey(sel)
    if (sel.kind === "preset") {
        const p = presets.find((x) => x.id === sel.id)
        if (p) { pick = `${pick}@${p.start}-${p.end}/${p.label}` }
    }
    if (bucket !== "session") { return pick }
    return `${pick}#${JSON.stringify(presets.map((p) => [p.id, p.label, p.start, p.end]))}`
}

// --- What the server applied -------------------------------------------------------

export interface AppliedTimeSlot {
    id: string | null
    label: string
    start: string
    end: string
    crossesMidnight: boolean
    source: "preset" | "custom"
}

export function appliedFromMeta(meta: unknown): AppliedTimeSlot | null {
    const raw = meta && typeof meta === "object" ? (meta as Record<string, unknown>).time_slot : null
    if (!raw || typeof raw !== "object") { return null }
    const r = raw as Record<string, unknown>
    const start = typeof r.start === "string" ? r.start : ""
    const end = typeof r.end === "string" ? r.end : ""
    if (parseClock(start) === null || parseClock(end, true) === null) { return null }
    return {
        id: typeof r.id === "string" ? r.id : null,
        label: typeof r.label === "string" ? r.label : "",
        start,
        end,
        crossesMidnight: r.crosses_midnight === true,
        source: r.source === "preset" ? "preset" : "custom",
    }
}

export const appliedPhrase = (a: AppliedTimeSlot): string =>
    a.source === "preset" && a.label ? `${a.label} (${clockRange(a.start, a.end)})` : clockRange(a.start, a.end)

/** The export's "Time slot" line. */
export function timeSlotProvenance(a: AppliedTimeSlot | null): string {
    if (!a) { return "All day" }
    const base = `${appliedPhrase(a)} restaurant time, on each day of the range`
    return a.crossesMidnight ? `${base} — crosses midnight, so each night is counted on the day it starts` : base
}

// --- Clamps --------------------------------------------------------------------------

const SLOT_CLAMPS: Record<string, string> = {
    slot_unknown: "That session no longer exists — showing all day",
    time_unparseable: "Those times could not be read — showing all day",
    time_empty: "Start and end were the same — showing all day",
}
const DAY_CLOSE_CLAMPS: Record<string, string> = {
    day_close_unparseable: "That closing time could not be read — showing calendar days",
    day_close_with_slot: "A session is on calendar days — closing time not applied",
}

/** `meta.window.clamped` is a LIST on a current server (a boolean on an old one). */
export function clampNotices(clamped: unknown): { range: boolean; slot: string | null } {
    if (!Array.isArray(clamped)) { return { range: clamped === true, slot: null } }
    const names = clamped.filter((c): c is string => typeof c === "string")
    const range = names.some((c) => !(c in SLOT_CLAMPS) && !(c in DAY_CLOSE_CLAMPS))
    const slotName = names.find((c) => c in SLOT_CLAMPS)
    const closeName = names.find((c) => c in DAY_CLOSE_CLAMPS)
    return { range, slot: slotName ? SLOT_CLAMPS[slotName] : closeName ? DAY_CLOSE_CLAMPS[closeName] : null }
}

// --- The time-wise pill -----------------------------------------------------------------

export type MisBucket = "day" | "hour" | "hour_of_day" | "session"

export const MIS_BUCKETS: [MisBucket, string][] = [
    ["day", "Day-wise"],
    ["hour", "Hour-wise"],
    ["hour_of_day", "By hour of day"],
    ["session", "By session"],
]

export const timeWiseOptions = (slotsAvailable: boolean): [MisBucket, string][] =>
    slotsAvailable ? MIS_BUCKETS : MIS_BUCKETS.filter(([b]) => b === "day" || b === "hour")

export function hourOfDaySlot(bucket: string): TimeSlotSelection | null {
    const m = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(bucket.trim())
    if (!m) { return null }
    const sel = customSelection(m[1], m[2])
    return sel.kind === "all" ? null : sel
}

export function sessionRowPreset(bucket: string, presets: TimeSlotPreset[]): TimeSlotPreset | null {
    const m = /^(.*)\((\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\)\s*$/.exec(bucket.trim())
    if (!m) { return null }
    const label = m[1].trim()
    return presets.find((p) => p.start === m[2] && p.end === m[3] && p.label === label) ?? null
}

/** May a row covering start–end be opened AS that slot without changing its total? */
export function slotRowOpensExactly(start: string, end: string, applied: AppliedTimeSlot | null): boolean {
    const a = parseClock(start)
    const b = parseEndClock(end)
    if (a === null || b === null || a === b) { return false }
    const rowCrosses = b < a
    if (!applied) { return !rowCrosses }
    const s = parseClock(applied.start)
    const e = parseEndClock(applied.end)
    if (s === null || e === null || s === e) { return false }
    if (e > s) { return !rowCrosses && a >= s && b <= e }
    return rowCrosses ? a >= s && b <= e : a >= s
}

// --- The editor ---------------------------------------------------------------------------

export interface TimeSlotDraft {
    id?: string
    label: string
    start: string
    end: string
}

export function validateSlotDrafts(drafts: TimeSlotDraft[]): string | null {
    if (drafts.length > MAX_TIME_SLOTS) { return `A restaurant can keep at most ${MAX_TIME_SLOTS} sessions.` }
    for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i]
        const name = d.label.trim()
        const which = name || `Session ${i + 1}`
        if (!name || name.length > MAX_TIME_SLOT_LABEL) {
            return `${which}: a session needs a name of 1 to ${MAX_TIME_SLOT_LABEL} characters.`
        }
        if (parseClock(d.start) === null) { return `${which}: start time must be between 00:00 and 23:59.` }
        const end = parseEndClock(d.end)
        if (end === null) { return `${which}: end time must be between 00:00 and 24:00.` }
        if (parseClock(d.start) === end) { return `${which}: start and end cannot be the same time.` }
    }
    return null
}

export function slotDraftsBody(drafts: TimeSlotDraft[]): { slots: Record<string, string>[] } {
    return {
        slots: drafts.map((d) => {
            const s = parseClock(d.start)
            const e = parseEndClock(d.end)
            return {
                ...(d.id ? { id: d.id } : {}),
                label: d.label.trim(),
                start: s === null ? d.start.trim() : formatClock(s),
                end: e === null ? d.end.trim() : formatClock(e),
            }
        }),
    }
}

// --- Session memory (per tab session, like TimeSlotMemory) -------------------------------

const SLOT_MEMORY_KEY = "reports:time-slot"

export function loadSlotMemory(): TimeSlotSelection {
    try {
        const raw = sessionStorage.getItem(SLOT_MEMORY_KEY)
        if (!raw) { return ALL_DAY }
        const v = JSON.parse(raw) as Record<string, unknown>
        if (v.kind === "preset" && typeof v.id === "string") { return presetSelection(v.id) }
        if (v.kind === "custom" && typeof v.from === "string" && typeof v.to === "string") { return customSelection(v.from, v.to) }
    } catch { /* storage unavailable */ }
    return ALL_DAY
}

export function saveSlotMemory(sel: TimeSlotSelection): void {
    try { sessionStorage.setItem(SLOT_MEMORY_KEY, JSON.stringify(sel)) } catch { /* storage unavailable */ }
}
