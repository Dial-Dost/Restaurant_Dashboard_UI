"use server"

// The one BINARY read of the Email reports area: a delivery's file (xlsx or
// csv). `requestBackend` reads bodies as text, which corrupts a workbook, so
// this Server Action fetches the bytes itself and hands them back as base64.
// Identity is the session bearer token from the `authUser` cookie — the same
// source db.ts's request helpers read.

import { cookies } from "next/headers"

import { serverBackendBase } from "@/lib/backend-url"

export interface DeliveryFileResult {
    ok: boolean
    status: number
    base64: string
    contentType: string
    message: string
}

export async function downloadDeliveryFile(deliveryId: string, fileId: string): Promise<DeliveryFileResult> {
    let token: string | null = null
    try {
        const jar = await cookies()
        const raw = jar.get("authUser")?.value
        if (raw) {
            const parsed = JSON.parse(decodeURIComponent(raw)) as { token?: unknown }
            token = typeof parsed.token === "string" ? parsed.token : null
        }
    } catch { /* no cookie */ }
    const path = `/reports/deliveries/${encodeURIComponent(deliveryId)}/files/${encodeURIComponent(fileId)}`
    try {
        const res = await fetch(`${serverBackendBase()}${path}`, {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) {
            let message = ""
            try {
                const body = (await res.json()) as Record<string, unknown>
                message = typeof body.details === "string" ? body.details : typeof body.error === "string" ? body.error : ""
            } catch { /* not JSON */ }
            return { ok: false, status: res.status, base64: "", contentType: "", message: message || "Couldn't download this file." }
        }
        const buf = Buffer.from(await res.arrayBuffer())
        return { ok: true, status: res.status, base64: buf.toString("base64"), contentType: res.headers.get("content-type") ?? "application/octet-stream", message: "" }
    } catch {
        return { ok: false, status: 0, base64: "", contentType: "", message: "This device can't reach the restaurant server." }
    }
}
