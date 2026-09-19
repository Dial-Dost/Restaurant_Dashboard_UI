// What the app's `_misReports` carries per report that the web's shared
// catalogue (src/lib/mis-reports.ts) does not: whether the endpoint honours
// `search` (and what its ilike reads), and the noun its "Dated on …" chip names.
// Plus the per-row "what does tapping this open" classifier and the drill note
// (`_rowOpens` / `_drillNote` in screens/reports.dart).

import { isDayKey } from "@/lib/date-range"
import type { MisReportKey, MisRow } from "@/lib/mis-reports"

import {
    hourOfDaySlot,
    sessionRowPreset,
    slotRowOpensExactly,
    appliedPhrase,
    type AppliedTimeSlot,
    type MisBucket,
    type TimeSlotPreset,
    type TimeSlotSelection,
} from "./time-slot"

const SETTLED = "settlement"
const ORDERED = "order placement"

interface Extra { searchable: boolean; basis: string; hint?: string }

const EXTRA: Record<MisReportKey, Extra> = {
    item_wise: { searchable: true, basis: ORDERED, hint: "Dish name" },
    discount: { searchable: true, basis: SETTLED },
    void_kot: { searchable: true, basis: ORDERED },
    bill_edit: { searchable: true, basis: "the edit" },
    sales_summary: { searchable: false, basis: SETTLED },
    order_summary: { searchable: true, basis: SETTLED },
    executive_summary: { searchable: false, basis: SETTLED },
    cover_size_summary: { searchable: false, basis: SETTLED },
    settlement_summary: { searchable: false, basis: SETTLED },
    nc_summary: { searchable: true, basis: "the comp", hint: "Dish / reason / table / who" },
    service_charge_deny: { searchable: true, basis: "the waiver", hint: "Bill / table / reason / who" },
    group_summary: { searchable: false, basis: ORDERED },
    variation_summary: { searchable: false, basis: ORDERED },
    tip_summary: { searchable: true, basis: "the tender", hint: "Bill / table / tender / credited to" },
    counter_summary: { searchable: false, basis: SETTLED },
}

export const isSearchable = (key: MisReportKey): boolean => EXTRA[key].searchable

export const searchHint = (key: MisReportKey): string => EXTRA[key].hint ?? "Bill No. / KOT / table"

/** "Dated on settlement", "Dated on the edit", + " · Lunch (12:00–17:00)". */
export function basisLabel(key: MisReportKey, slotPhrase: string | null): string {
    const basis = EXTRA[key].basis
    return `Dated on ${basis}${slotPhrase ? ` · ${slotPhrase}` : ""}`
}

// --- What a row opens ------------------------------------------------------------

export type RowOpen =
    | { kind: "bill"; id: string }
    | { kind: "kot"; id: string }
    | { kind: "day"; day: string }
    | { kind: "hour"; slot: TimeSlotSelection }
    | { kind: "session"; slot: TimeSlotSelection }
    | { kind: "outlet"; id: string }

export interface RowOpenCtx {
    reportKey: MisReportKey
    bucket: MisBucket
    presets: TimeSlotPreset[]
    applied: AppliedTimeSlot | null
    canSwitchOutlet: boolean
}

const cell = (row: MisRow, key: string): string => {
    const v = row[key]
    if (v === null || v === undefined) { return "" }
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""
    return s === "null" ? "" : s
}

export function rowOpens(row: MisRow, ctx: RowOpenCtx): RowOpen | null {
    const bill = cell(row, "bill_id")
    if (bill) { return { kind: "bill", id: bill } }
    const order = cell(row, "order_id")
    if (order) { return { kind: "kot", id: order } }
    if (ctx.reportKey === "sales_summary") {
        const bucket = cell(row, "bucket")
        if (ctx.bucket === "day" && isDayKey(bucket)) { return { kind: "day", day: bucket } }
        if (ctx.bucket === "hour_of_day") {
            const hour = hourOfDaySlot(bucket)
            if (hour?.kind === "custom" && slotRowOpensExactly(hour.from, hour.to, ctx.applied)) {
                return { kind: "hour", slot: hour }
            }
        }
        if (ctx.bucket === "session") {
            const p = sessionRowPreset(bucket, ctx.presets)
            if (p && slotRowOpensExactly(p.start, p.end, ctx.applied)) {
                return { kind: "session", slot: { kind: "preset", id: p.id } }
            }
        }
    }
    if (ctx.reportKey === "executive_summary" && ctx.canSwitchOutlet) {
        const outlet = cell(row, "outlet_id")
        if (outlet) { return { kind: "outlet", id: outlet } }
    }
    return null
}

/** The InfoChip beside Columns/Export that says whether rows open anything. */
export function drillNote(rows: MisRow[], ctx: RowOpenCtx): { label: string; opens: boolean } | null {
    if (rows.length === 0) { return null }
    const kinds = new Set<RowOpen["kind"]>()
    let open = 0
    for (const r of rows) {
        const o = rowOpens(r, ctx)
        if (!o) { continue }
        open += 1
        kinds.add(o.kind)
    }
    if (open === 0) {
        const cut = ctx.bucket === "hour_of_day" ? "an hour" : ctx.bucket === "session" ? "a session" : null
        if (ctx.reportKey === "sales_summary" && cut && ctx.applied) {
            return { label: `Rows here are cut to ${appliedPhrase(ctx.applied)} — choose All day to open ${cut}`, opens: false }
        }
        return { label: "Each row totals many bills — no single one to open", opens: false }
    }
    const WHAT: Record<RowOpen["kind"], string> = {
        bill: "its full bill",
        kot: "its kitchen ticket",
        day: "that day on its own",
        hour: "that hour, day by day",
        session: "that session, day by day",
        outlet: "that branch",
    }
    const what = kinds.size > 1 ? "the bill or ticket it names" : WHAT[[...kinds][0]]
    const dead = rows.length - open
    return {
        label: dead === 0 ? `Tap a row to open ${what}` : `Some rows open ${what} · ${dead} of ${rows.length} rows name none`,
        opens: true,
    }
}

// --- Open-tab memory (app-session, like `_misOpenTab`) -------------------------------

const TAB_KEY = "reports:open-tab"
const BUCKET_KEY = "reports:bucket"
const VIEW_KEY = "reports:view"

const read = (k: string): string | null => { try { return sessionStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string): void => { try { sessionStorage.setItem(k, v) } catch { /* storage unavailable */ } }

export const loadOpenTab = (): string | null => read(TAB_KEY)
export const saveOpenTab = (key: string): void => { write(TAB_KEY, key) }
export const loadBucket = (): MisBucket => {
    const v = read(BUCKET_KEY)
    return v === "hour" || v === "hour_of_day" || v === "session" ? v : "day"
}
export const saveBucket = (b: MisBucket): void => { write(BUCKET_KEY, b) }
export const loadView = (): "reports" | "email" => (read(VIEW_KEY) === "email" ? "email" : "reports")
export const saveView = (v: "reports" | "email"): void => { write(VIEW_KEY, v) }
