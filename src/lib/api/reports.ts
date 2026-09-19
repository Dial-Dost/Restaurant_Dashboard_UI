// REPORTS MODULE API — the fetchers the rebuilt Insights → Reports page loads
// through: the MIS reports WITH the time-slot parts (db.ts's getMisReport has no
// slot), the saved sessions, and the whole Email reports area (config, address
// book, send now, schedules, deliveries).
//
// These THROW on failure (status 0 → TypeError "Failed to fetch" so
// `isUnreachableError` reads it as an outage; anything else → the server's own
// sentence, with `status` and the body's `code` attached) — the contract
// `useCachedFetch` and the email sheets need. Same idiom as api/customers.ts.

import { requestBackend } from "@/lib/db"
import { refusalSentence } from "@/lib/error-message"
import type { MisReportPayload } from "@/lib/mis-reports"

export type ApiError = Error & { status?: number; code?: string }

const fail = (status: number, text: string, fallback: string): never => {
    if (status === 0) { throw new TypeError("Failed to fetch") }
    let message = ""
    let code: string | undefined
    try {
        const body = JSON.parse(text) as unknown
        message = refusalSentence(body) ?? ""
        if (body && typeof body === "object" && typeof (body as Record<string, unknown>).code === "string") {
            code = (body as Record<string, string>).code
        }
    } catch { /* not JSON */ }
    if (!message) { message = text.trim() || fallback }
    throw Object.assign(new Error(message), { status, code })
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

async function call<T>(path: string, fallback: string, opts: { method?: Method; body?: unknown; outletId?: string } = {}): Promise<T> {
    const res = await requestBackend<T>({ path, method: opts.method ?? "GET", body: opts.body, outletId: opts.outletId })
    if (!res.ok) { return fail(res.status, res.text, fallback) }
    return (res.data ?? ({} as T))
}

// --- MIS reports ----------------------------------------------------------------

export interface MisFetchQuery {
    from?: string
    to?: string
    days?: number
    search?: string
    limit?: number
    offset?: number
    bucket?: string
    /** `slot` / `time_from`+`time_to` — the time-slot's query parts. */
    slot?: Record<string, string>
    outletId?: string
}

/** One page of a MIS report. `path` is always a literal /reports/mis/* route. */
export async function fetchMisReport(restaurantId: string, path: string, q: MisFetchQuery): Promise<MisReportPayload> {
    if (!path.startsWith("/reports/mis/")) { throw new Error("Unknown report.") }
    const qs = new URLSearchParams({ restaurantId })
    if (q.from) { qs.set("from", q.from) }
    if (q.to) { qs.set("to", q.to) }
    if (typeof q.days === "number" && Number.isFinite(q.days)) { qs.set("days", String(Math.max(1, Math.round(q.days)))) }
    if (q.search?.trim()) { qs.set("search", q.search.trim().slice(0, 120)) }
    if (typeof q.limit === "number") { qs.set("limit", String(q.limit)) }
    if (typeof q.offset === "number") { qs.set("offset", String(q.offset)) }
    if (q.bucket) { qs.set("bucket", q.bucket) }
    for (const [k, v] of Object.entries(q.slot ?? {})) { qs.set(k, v) }
    const p = await call<MisReportPayload>(`${path}?${qs.toString()}`, "Couldn't load this report.", { outletId: q.outletId })
    if (typeof p !== "object" || !("meta" in p)) { throw new Error("The server's answer could not be read.") }
    return p
}

export const fetchTimeSlots = (): Promise<unknown> =>
    call<unknown>("/reports/mis/time-slots", "Couldn't load the saved sessions.")

export const putTimeSlots = (body: unknown): Promise<unknown> =>
    call<unknown>("/reports/mis/time-slots", "Couldn't save the sessions.", { method: "PUT", body })

// --- Email reports ----------------------------------------------------------------

export interface EmailPanelData {
    /** The raw config body, or null when it could not be read. */
    config: unknown
    /** True when the config route answered 404 (a server older than email reports). */
    configMissing: boolean
    recipients: unknown
    schedules: unknown[] | null
    deliveries: unknown[] | null
}

const settle = async (path: string): Promise<{ ok: boolean; status: number; data: unknown }> => {
    const res = await requestBackend({ path, method: "GET" })
    return { ok: res.ok, status: res.status, data: res.data }
}

const listOf = (data: unknown, key: string): unknown[] | null => {
    const v = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : null
    return Array.isArray(v) ? v : null
}

/** Config + address book + schedules + deliveries (30), each allowed to fail alone. */
export async function fetchEmailPanel(): Promise<EmailPanelData> {
    const [config, recipients, schedules, deliveries] = await Promise.all([
        settle("/reports/email/config"),
        settle("/reports/email/recipients"),
        settle("/reports/schedules"),
        settle("/reports/deliveries?limit=30"),
    ])
    if (!config.ok && config.status === 0 && !recipients.ok && !schedules.ok) { throw new TypeError("Failed to fetch") }
    return {
        config: config.ok ? config.data : null,
        configMissing: config.status === 404,
        recipients: recipients.ok ? recipients.data : null,
        schedules: schedules.ok ? listOf(schedules.data, "schedules") : null,
        deliveries: deliveries.ok ? listOf(deliveries.data, "deliveries") : null,
    }
}

/** Config + address book only — what the Send-now sheet needs. */
export async function fetchSendSetup(): Promise<{ config: unknown; configMissing: boolean; recipients: unknown }> {
    const [config, recipients] = await Promise.all([settle("/reports/email/config"), settle("/reports/email/recipients")])
    return { config: config.ok ? config.data : null, configMissing: config.status === 404, recipients: recipients.ok ? recipients.data : null }
}

export async function fetchDeliveries(limit = 30): Promise<unknown[]> {
    const data = await call<unknown>(`/reports/deliveries?limit=${limit}`, "Couldn't load the history.")
    return listOf(data, "deliveries") ?? []
}

export async function fetchDelivery(id: string): Promise<Record<string, unknown> | null> {
    const data = await call<Record<string, unknown>>(`/reports/deliveries/${encodeURIComponent(id)}`, "Couldn't read the delivery.")
    const d = data.delivery
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null
}

/** POST /reports/email/send → the delivery id. `asOutlet` is the session's own
 *  outlet for a combined send (the server refuses writes made "as all"). */
export async function sendReportEmail(body: unknown, asOutlet?: string): Promise<string> {
    const data = await call<Record<string, unknown>>("/reports/email/send", "Couldn't send.", { method: "POST", body, outletId: asOutlet })
    return typeof data.delivery_id === "string" ? data.delivery_id : typeof data.delivery_id === "number" ? String(data.delivery_id) : ""
}

export const addRecipient = (email: string, label: string | null): Promise<unknown> =>
    call<unknown>("/reports/email/recipients", "Couldn't add the address.", { method: "POST", body: { email, label } })

export const removeRecipient = (id: string): Promise<unknown> =>
    call<unknown>(`/reports/email/recipients/${encodeURIComponent(id)}`, "Couldn't remove the address.", { method: "DELETE" })

export const sendTestEmail = (recipientId: string, clientRequestId: string): Promise<unknown> =>
    call<unknown>("/reports/email/test", "Couldn't send the test email.", {
        method: "POST", body: { recipient_id: recipientId, client_request_id: clientRequestId },
    })

export const createEmailSchedule = (patch: unknown): Promise<unknown> =>
    call<unknown>("/reports/schedules", "Couldn't create the schedule.", { method: "POST", body: patch })

export const patchEmailSchedule = (id: string, patch: unknown): Promise<unknown> =>
    call<unknown>(`/reports/schedules/${encodeURIComponent(id)}`, "Couldn't update the schedule.", { method: "PATCH", body: patch })

export const deleteEmailSchedule = (id: string): Promise<unknown> =>
    call<unknown>(`/reports/schedules/${encodeURIComponent(id)}`, "Couldn't delete the schedule.", { method: "DELETE" })

/** Queues one extra run. 409 = the per-minute dedup: already queued. */
export async function runEmailScheduleNow(id: string): Promise<"queued" | "already"> {
    const res = await requestBackend({ path: `/reports/schedules/${encodeURIComponent(id)}/run-now`, method: "POST" })
    if (res.status === 409) { return "already" }
    if (!res.ok) { return fail(res.status, res.text, "Couldn't queue this report.") }
    return "queued"
}

/** The legacy single-CSV artifact of an older delivery. */
export async function fetchLegacyDeliveryCsv(id: string): Promise<string> {
    const res = await requestBackend({ path: `/reports/deliveries/${encodeURIComponent(id)}/download`, method: "GET", parseJson: false })
    if (!res.ok) { return fail(res.status, res.text, "Couldn't download this report.") }
    return res.text
}
