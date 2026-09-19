"use client"

// CSV export for the Analytics module — the web `_downloadCsv` / `_dlButton` /
// `_csvOf` (restaurant_owner_app modules.dart ~20305): every section that can
// be exported registers its rows while it is on screen, and the ONE
// "Download <view>" button in the toolbar writes one file with each section as
// a labelled block. Values are written exactly as the section renders them
// (₹ amounts, "3m 20s" durations, the current sort order and row cap), so a
// file always matches what the owner was looking at.

import * as React from "react"

export type CsvCell = string | number | null | undefined

/** RFC-4180 quoting: quote + double embedded quotes for , " and newlines. */
const csvCell = (v: CsvCell): string => {
    const s = v == null ? "" : String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const csvOf = (headers: CsvCell[], rows: CsvCell[][]): string => {
    let out = ""
    if (headers.length > 0) { out += `${headers.map(csvCell).join(",")}\r\n` }
    for (const r of rows) { out += `${r.map(csvCell).join(",")}\r\n` }
    return out
}

/** Filename-safe slug: "Kitchen · by dish" → "kitchen-by-dish". */
export const fileSlug = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "")

interface CsvSectionEntry {
    /** The section slug written as the block's label row ("performance"). */
    label: string
    /** Render order, so the file reads top-to-bottom like the screen. */
    order: number
    build: () => { headers: CsvCell[]; rows: CsvCell[][] }
}

export interface CsvRegistry {
    register: (id: string, entry: CsvSectionEntry) => void
    unregister: (id: string) => void
    list: () => CsvSectionEntry[]
}

export const CsvRegistryContext = React.createContext<CsvRegistry | null>(null)

/** Holds the registry map for the page; hand `registry` to the provider. */
export function useCsvRegistry(): CsvRegistry {
    const sections = React.useRef(new Map<string, CsvSectionEntry>())
    return React.useMemo<CsvRegistry>(() => ({
        register: (id, entry) => { sections.current.set(id, entry) },
        unregister: (id) => { sections.current.delete(id) },
        list: () => [...sections.current.values()].sort((a, b) => a.order - b.order),
    }), [])
}

/**
 * The web `_dlButton(register)`: renders nothing, contributes this card's rows
 * to the single "Download <view>" file while the card is mounted. Rows are
 * read at CLICK time through a ref, so the file always carries the current
 * sort — exactly Flutter's build-time registration.
 */
export function Dl({ id, order, headers, rows }: {
    id: string
    order: number
    headers: CsvCell[]
    rows: CsvCell[][]
}): null {
    const registry = React.useContext(CsvRegistryContext)
    const latest = React.useRef({ headers, rows })
    latest.current = { headers, rows }
    React.useEffect(() => {
        if (!registry) { return }
        registry.register(id, { label: id, order, build: () => latest.current })
        return () => { registry.unregister(id) }
    }, [registry, id, order])
    return null
}

/**
 * One file for the whole view: each registered section as a labelled block, a
 * blank line between blocks — the same layout the Flutter export writes.
 * UTF-8, no BOM, CRLF. Filename `<restaurant>-analytics-<view>-<day>.csv`,
 * dated on the RESTAURANT's business day.
 */
export function downloadRegisteredCsv(registry: CsvRegistry, restaurantSlug: string, viewSlug: string, businessDay: string): void {
    const sections = registry.list()
    if (sections.length === 0) { return }
    let body = ""
    for (const s of sections) {
        const { headers, rows } = s.build()
        if (body.length > 0) { body += "\r\n" }
        body += `${csvCell(s.label)}\r\n`
        body += csvOf(headers, rows)
    }
    const name = `${fileSlug(restaurantSlug)}-${fileSlug(viewSlug)}-${businessDay}.csv`
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}
