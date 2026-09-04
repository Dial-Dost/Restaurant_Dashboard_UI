"use client"

// THE GRID every one of the fifteen renders into.
//
// Built once, not fifteen times, and driven entirely by the SERVER's column
// descriptors — so a column added to a report on the backend appears here with
// the right alignment, the right formatting and the right totals behaviour
// without a client release, and two reports can never render the same money
// column two different ways.
//
// THE TOTALS ROW IS PINNED. A totals row that scrolls away is useless on a
// 500-row report: the number an owner opened the document for would be the one
// thing they cannot see while reading it. It is a sticky `tfoot` inside the
// scroll box, so it sits over the rows at the bottom edge the whole way down.
// The header is pinned for the same reason at the other end — a money column
// you have scrolled the heading off is a column you are guessing at.
//
// Both sticky rows carry an OPAQUE background and a border. A translucent
// sticky row over scrolling digits is unreadable, and on a money document
// unreadable is indistinguishable from wrong.

import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import {
    formatCell,
    nextSort,
    type FormatOptions,
    type MisColumn,
    type MisRow,
    type SortState,
} from "@/lib/mis-reports"

const isNumeric = (type: MisColumn["type"]) => type === "money" || type === "int" || type === "percent"

interface Props {
    columns: MisColumn[]
    rows: MisRow[]
    /** The backend's totals object. Null when this report totals nothing. */
    totals: Record<string, unknown> | null
    /** Says what the totals row is a total OF — see `totalsLabelFor`. */
    totalsLabel: string
    sort: SortState | null
    onSort: (next: SortState) => void
    /** Given a row, the record it opens — or null when nothing lies behind it. */
    onDrill?: ((row: MisRow) => void) | null
    /** True when a row of THIS report can be opened, so the cursor tells the truth. */
    drillable?: boolean
    format: FormatOptions
    loading: boolean
    /** Shown in place of rows. Distinguishes "no trade" from "couldn't load". */
    empty: React.ReactNode
}

export function ReportTable({
    columns, rows, totals, totalsLabel, sort, onSort, onDrill, drillable, format, loading, empty,
}: Props) {
    const anyTotal = totals !== null && columns.some((c) => c.total && totals[c.key] !== undefined)

    return (
        <div className="relative rounded-lg border bg-card">
            {/* The scroll box. Both axes: a configurable-column report can be
                wider than any screen, and the horizontal scroll has to stay
                INSIDE this box or the whole page slides sideways. */}
            <div className="max-h-[62vh] overflow-auto rounded-lg">
                <table className="w-full border-collapse text-sm">
                    {/* `sticky` sits on the CELLS, not on `thead`/`tfoot`. Sticky
                        table SECTIONS are a much later and patchier addition —
                        Safari in particular ignored them for years — and a totals
                        row that silently stops pinning on one browser is exactly
                        the failure this design exists to prevent. */}
                    <thead>
                        <tr>
                            {columns.map((col) => {
                                const active = sort?.key === col.key
                                return (
                                    <th
                                        key={col.key}
                                        scope="col"
                                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                                        className={cn(
                                            "sticky top-0 z-20",
                                            "border-b bg-muted px-3 py-2.5 text-xs font-semibold uppercase tracking-wide",
                                            "whitespace-nowrap text-muted-foreground",
                                            isNumeric(col.type) ? "text-right" : "text-left",
                                            active && "text-foreground",
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => { onSort(nextSort(sort, col.key, col.type)) }}
                                            className={cn(
                                                "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
                                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                                isNumeric(col.type) && "flex-row-reverse",
                                            )}
                                            title={`Sort by ${col.label}`}
                                        >
                                            {col.label}
                                            {active
                                                ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                                                : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
                                        </button>
                                    </th>
                                )
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={Math.max(columns.length, 1)} className="px-4 py-14 text-center">
                                    {empty}
                                </td>
                            </tr>
                        )}
                        {rows.map((row, i) => {
                            const canOpen = Boolean(drillable && onDrill)
                            return (
                                <tr
                                    key={String(row.bill_id ?? row.order_id ?? row.audit_id ?? row.bucket ?? row.outlet_id ?? row.name ?? row.method ?? i)}
                                    onClick={canOpen ? () => { onDrill?.(row) } : undefined}
                                    // Keyboard parity: a row you can click is a row you must be
                                    // able to reach and open with the keyboard.
                                    tabIndex={canOpen ? 0 : undefined}
                                    role={canOpen ? "button" : undefined}
                                    onKeyDown={canOpen
                                        ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill?.(row) } }
                                        : undefined}
                                    className={cn(
                                        "border-b border-border/50 transition-colors last:border-b-0",
                                        canOpen
                                            ? "cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                            : "hover:bg-muted/40",
                                    )}
                                >
                                    {columns.map((col) => {
                                        const raw = row[col.key]
                                        const text = formatCell(raw, col.type, format)
                                        return (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    "px-3 py-2 align-middle",
                                                    isNumeric(col.type) ? "text-right font-mono text-[13px] tabular-nums" : "text-left",
                                                    // A blank is a real answer here — "this system does not
                                                    // capture it" — so it is muted rather than absent, and
                                                    // never rendered as a zero.
                                                    text === "—" && "text-muted-foreground/50",
                                                    col.type === "text" && "max-w-[22rem] truncate",
                                                )}
                                                title={col.type === "text" && text !== "—" ? text : undefined}
                                            >
                                                {text}
                                            </td>
                                        )
                                    })}
                                </tr>
                            )
                        })}
                    </tbody>

                    {anyTotal && (
                        <tfoot>
                            <tr>
                                {columns.map((col, i) => {
                                    const value = totals?.[col.key]
                                    const totalled = col.total && value !== undefined
                                    return (
                                        <td
                                            key={col.key}
                                            className={cn(
                                                "sticky bottom-0 z-20",
                                                "border-t-2 border-primary/40 bg-muted px-3 py-2.5 font-semibold",
                                                isNumeric(col.type) ? "text-right font-mono tabular-nums" : "text-left",
                                                !totalled && i !== 0 && "text-muted-foreground/40",
                                            )}
                                        >
                                            {totalled
                                                ? formatCell(value, col.type, format)
                                                : i === 0
                                                    ? <span className="text-xs uppercase tracking-wide">{totalsLabel}</span>
                                                    // NOT a zero and NOT a page-sum. The backend does not total
                                                    // this column, and inventing a subtotal from the rows that
                                                    // happen to be on screen would be a page total wearing a
                                                    // window total's clothes.
                                                    : ""}
                                        </td>
                                    )
                                })}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* Refresh keeps the previous numbers on screen and dims them rather
                than blanking the grid: a report that empties on every date tweak
                reads as "no data" for as long as the request takes. */}
            {loading && rows.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-center rounded-lg bg-background/45">
                    <span className="mt-6 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
                    </span>
                </div>
            )}
        </div>
    )
}
