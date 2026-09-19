"use client"

// THE GRID every one of the fifteen renders into — the web copy of the app's
// `_MisGrid` / `_MisCardList`.
//
//  * Wide: the first visible column is FROZEN (row identity — bill no., dish,
//    mode) while the rest scroll sideways under it; pinned header and pinned
//    TOTAL row; typed column widths; a chevron only on rows that open something.
//  * Narrow (< 760px) or short (< 430px tall): one ForkCard per row — first
//    column as title, last visible money column as the headline, every other
//    visible column as a label/value pair — then a TOTAL · WHOLE PERIOD card.
//    A phone reading a sideways-scrolling table misattributes figures to rows.
//
// Driven entirely by the server's column descriptors. Sorting is a web extra
// (kept); nothing here sums or derives a figure.

import * as React from "react"
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react"

import { ForkCard } from "@/components/ui/fork-card"
import { cn } from "@/lib/utils"
import { formatCell, nextSort, type FormatOptions, type MisColumn, type MisRow, type SortState } from "@/lib/mis-reports"

const isNumeric = (type: MisColumn["type"]): boolean => type === "money" || type === "int" || type === "percent"

/** The app's typed widths: money 118, percent 96, int 84, datetime 148, date 110, text 170 (first 190). */
const widthOf = (col: MisColumn, first: boolean): number => {
    switch (col.type) {
        case "money": return 118
        case "percent": return 96
        case "int": return 84
        case "datetime": return 148
        case "date": return 110
        default: return first ? 190 : 170
    }
}

export const TOTALS_LABEL = "TOTAL · whole period"

/** < 760px wide or < 430px tall → the card list. */
export function useCompactGrid(): boolean {
    const [compact, setCompact] = React.useState(false)
    React.useEffect(() => {
        const read = (): void => { setCompact(window.innerWidth < 760 || window.innerHeight < 430) }
        read()
        window.addEventListener("resize", read)
        return () => { window.removeEventListener("resize", read) }
    }, [])
    return compact
}

interface Props {
    columns: MisColumn[]
    rows: MisRow[]
    totals: Record<string, unknown> | null
    sort: SortState | null
    onSort: (next: SortState) => void
    /** What tapping THIS row does, or null when nothing lies behind it. */
    rowAction: (row: MisRow) => (() => void) | null
    format: FormatOptions
    compact: boolean
    /** Fills the remaining height on wide screens. */
    className?: string
}

const rowKey = (row: MisRow, i: number): string => {
    for (const k of ["bill_id", "order_id", "audit_id", "bucket", "outlet_id", "name", "method"]) {
        const v = row[k]
        if (typeof v === "string" || typeof v === "number") { return `${v}:${i}` }
    }
    return String(i)
}

export function ReportGrid(props: Props): React.JSX.Element {
    return props.compact ? <CardList {...props} /> : <Table {...props} />
}

function Table({ columns, rows, totals, sort, onSort, rowAction, format, className }: Props): React.JSX.Element {
    const anyTotal = totals !== null && columns.some((c) => c.total && totals[c.key] !== undefined)
    const tableWidth = columns.reduce((s, c, i) => s + widthOf(c, i === 0), 0) + 28

    return (
        <div className={cn("relative min-h-0 overflow-hidden rounded-lg border border-border bg-card", className)}>
            <div className="h-full max-h-[70vh] overflow-auto">
                <table className="border-separate border-spacing-0 text-sm" style={{ width: tableWidth, minWidth: "100%" }}>
                    <colgroup>
                        {columns.map((c, i) => <col key={c.key} style={{ width: widthOf(c, i === 0) + (i === 0 ? 28 : 0) }} />)}
                    </colgroup>
                    <thead>
                        <tr>
                            {columns.map((col, i) => {
                                const active = sort?.key === col.key
                                return (
                                    <th
                                        key={col.key}
                                        scope="col"
                                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                                        className={cn(
                                            "sticky top-0 z-20 h-[34px] border-b border-border bg-popover px-3 micro-label whitespace-nowrap",
                                            isNumeric(col.type) ? "text-right" : "text-left",
                                            i === 0 && "left-0 z-30 border-r border-input",
                                            active && "text-foreground",
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => { onSort(nextSort(sort, col.key, col.type)) }}
                                            className={cn(
                                                "inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                        {rows.map((row, ri) => {
                            const act = rowAction(row)
                            return (
                                <tr
                                    key={rowKey(row, ri)}
                                    onClick={act ?? undefined}
                                    tabIndex={act ? 0 : undefined}
                                    role={act ? "button" : undefined}
                                    onKeyDown={act ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act() } } : undefined}
                                    className={cn(
                                        "group h-[38px]",
                                        ri % 2 === 1 && "bg-foreground/[0.012]",
                                        "hover:bg-foreground/[0.04]",
                                        act && "cursor-pointer focus-visible:bg-foreground/[0.06] focus-visible:outline-none",
                                    )}
                                >
                                    {columns.map((col, i) => {
                                        const text = formatCell(row[col.key], col.type, format)
                                        return (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    "border-b border-divider px-3 align-middle",
                                                    isNumeric(col.type) ? "text-right tabular-nums" : "text-left",
                                                    text === "—" && "text-muted-foreground/60",
                                                    i === 0 && "sticky left-0 z-10 border-r border-input bg-card group-hover:bg-popover",
                                                )}
                                                title={col.type === "text" && text !== "—" ? text : undefined}
                                            >
                                                {i === 0 ? (
                                                    <span className="flex items-center gap-1">
                                                        <span className="min-w-0 flex-1 truncate">{text}</span>
                                                        {act && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-accent-foreground" />}
                                                    </span>
                                                ) : (
                                                    <span className="block truncate">{text}</span>
                                                )}
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
                                    const value = totals[col.key]
                                    const totalled = col.total && value !== undefined
                                    return (
                                        <td
                                            key={col.key}
                                            className={cn(
                                                "sticky bottom-0 z-20 h-[38px] border-t-2 border-accent-base/50 bg-popover px-3 font-semibold",
                                                isNumeric(col.type) ? "text-right tabular-nums" : "text-left",
                                                i === 0 && "left-0 z-30 border-r border-input",
                                            )}
                                        >
                                            {totalled
                                                ? formatCell(value, col.type, format)
                                                : i === 0
                                                    ? <span className="text-[11px] uppercase tracking-wide text-accent-foreground">{TOTALS_LABEL}</span>
                                                    : ""}
                                        </td>
                                    )
                                })}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
}

function CardList({ columns, rows, totals, rowAction, format }: Props): React.JSX.Element {
    const first = columns.at(0)
    const headlineCol = [...columns].reverse().find((c) => c.type === "money" && c !== first)
    const rest = columns.filter((c) => c !== first && c !== headlineCol)
    const tot = totals ?? {}
    const totalled = columns.filter((c) => c.total && tot[c.key] !== undefined)

    return (
        <div className="flex flex-col gap-2.5">
            {rows.map((row, ri) => {
                const act = rowAction(row)
                return (
                    <ForkCard key={rowKey(row, ri)} onClick={act ?? undefined} interactive={Boolean(act)} chevron={Boolean(act)} className="p-3.5">
                        <div className="flex items-start gap-3">
                            <div className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">
                                {first ? formatCell(row[first.key], first.type, format) : ""}
                            </div>
                            {headlineCol && (
                                <div className="shrink-0 text-right text-base font-semibold tabular-nums text-accent-foreground">
                                    {formatCell(row[headlineCol.key], headlineCol.type, format)}
                                </div>
                            )}
                        </div>
                        {rest.length > 0 && (
                            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {rest.map((c) => (
                                    <div key={c.key} className="min-w-0">
                                        <dt className="micro-label truncate">{c.label}</dt>
                                        <dd className={cn("truncate text-[13px]", isNumeric(c.type) && "tabular-nums")}>
                                            {formatCell(row[c.key], c.type, format)}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    </ForkCard>
                )
            })}
            {totalled.length > 0 && (
                <ForkCard inset className="p-3.5">
                    <div className="micro-label text-accent-foreground">TOTAL · WHOLE PERIOD</div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {totalled.map((c) => (
                            <div key={c.key} className="min-w-0">
                                <dt className="micro-label truncate">{c.label}</dt>
                                <dd className="truncate text-[13px] font-semibold tabular-nums">{formatCell(tot[c.key], c.type, format)}</dd>
                            </div>
                        ))}
                    </dl>
                </ForkCard>
            )}
        </div>
    )
}
