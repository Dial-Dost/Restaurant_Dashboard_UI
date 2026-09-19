"use client"

// Chart plumbing for the Analytics module — web ports of the Flutter helpers
// `_barChart`, `_columnSeries`, `_chartCard`, `_kv`, `_statCard`, `_empty`
// (restaurant_owner_app modules.dart). Single-hue copper on the fork-charts
// primitives: ranked data reads as an HBarRow list, long chronological series
// as CopperColumns (or the barcode strip where columns cannot fit), and every
// mark hover-hints and tap-drills the same way.

import * as React from "react"
import { Inbox } from "lucide-react"

import { Columns, Barcode, HBarRow } from "@/components/ui/fork-charts"
import { DrillSheet } from "@/components/ui/drill-sheet"
import { EmptyState } from "@/components/ui/empty-state"
import { ForkCard } from "@/components/ui/fork-card"
import { SectionHeader } from "@/components/ui/section-header"
import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"
import type { SeriesPoint } from "@/components/analytics/format"

/* ── shared plumbing ─────────────────────────────────────────────────── */

function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = React.useRef<T | null>(null)
    const [width, setWidth] = React.useState(0)
    React.useEffect(() => {
        const el = ref.current
        if (!el) { return }
        const ro = new ResizeObserver((entries) => {
            setWidth(entries[0]?.contentRect.width ?? 0)
        })
        ro.observe(el)
        setWidth(el.clientWidth)
        return () => { ro.disconnect() }
    }, [])
    return [ref, width]
}

/** `_columnsThatFit`: how many 56px column slots a width affords. */
const columnsThatFit = (width: number): number =>
    !Number.isFinite(width) || width <= 0 ? 0 : Math.floor((width + 8) / 56)

/* ── ColumnSeries (Flutter `_columnSeries`) ──────────────────────────── */

/**
 * A chronological series drawn as columns where they fit, and as the barcode
 * strip where they do not — with the first and last labels printed under the
 * strip so the time axis is not lost.
 */
export function ColumnSeries({ data, fmt, onSelect }: {
    data: SeriesPoint[]
    fmt: (v: number) => string
    onSelect?: (i: number) => void
}): React.JSX.Element {
    const [ref, width] = useMeasuredWidth<HTMLDivElement>()
    const tooltip = (i: number): string => `${data[i].label} · ${fmt(data[i].value)}`
    const fitsAsColumns = width === 0 || data.length <= columnsThatFit(width)
    return (
        <div ref={ref} className="w-full">
            {fitsAsColumns ? (
                <Columns
                    values={data.map((d) => d.value)}
                    labels={data.map((d) => d.label)}
                    formatValue={fmt}
                    tooltip={tooltip}
                    onSelect={onSelect}
                />
            ) : (
                <div className="flex w-full flex-col gap-1.5">
                    <Barcode values={data.map((d) => d.value)} height={120} tooltip={tooltip} onSelect={onSelect} />
                    <div className="flex items-center">
                        <span className="micro-label min-w-0 flex-1 truncate">{data[0]?.label}</span>
                        <span className="micro-label min-w-0 flex-1 truncate text-center">{data.length} points</span>
                        <span className="micro-label min-w-0 flex-1 truncate text-right">{data[data.length - 1]?.label}</span>
                    </div>
                </div>
            )}
        </div>
    )
}

/* ── KV row (Flutter `_kv`) ──────────────────────────────────────────── */

export function KV({ k, v }: { k: string; v: React.ReactNode }): React.JSX.Element {
    return (
        <div className="flex items-start gap-3 py-1.5">
            <span className="micro-label w-[148px] shrink-0 pt-0.5">{k}</span>
            <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{v}</span>
        </div>
    )
}

/* ── RankedOrSeriesChart (Flutter `_barChart`) ───────────────────────── */

/**
 * Single-hue copper chart for (label, value) rows. Long chronological series
 * render as columns; short/ranked data reads best as an HBarRow list (label
 * always beside value — nothing is colour-alone). Hovering names the mark and
 * its value; clicking opens the same figures with the context a bare bar
 * cannot carry (share of total, rank).
 */
export function RankedOrSeriesChart({ data, fmt, title = "Data point" }: {
    data: SeriesPoint[]
    fmt: (v: number) => string
    title?: string
}): React.JSX.Element {
    const [openIndex, setOpenIndex] = React.useState<number | null>(null)

    if (data.length === 0) {
        return <p className="text-xs text-muted-foreground">No data yet.</p>
    }
    const total = data.reduce((a, d) => a + d.value, 0)
    const maxV = data.reduce((a, d) => (d.value > a ? d.value : a), 0)
    const hint = (i: number): string => `${data[i].label} · ${fmt(data[i].value)}`

    const selected = openIndex == null ? null : data[openIndex]
    const rankOf = (d: SeriesPoint): number => {
        const sorted = [...data].sort((a, b) => b.value - a.value)
        return sorted.findIndex((e) => e.label === d.label) + 1
    }

    return (
        <div>
            {data.length >= 10 ? (
                <ColumnSeries data={data} fmt={fmt} onSelect={(i) => { setOpenIndex(i) }} />
            ) : (
                <div>
                    {data.map((d, i) => (
                        <HBarRow
                            key={`${d.label}-${i}`}
                            label={d.label}
                            fraction={maxV > 0 ? Math.min(1, Math.max(0, d.value / maxV)) : 0}
                            value={fmt(d.value)}
                            tooltip={hint(i)}
                            onSelect={() => { setOpenIndex(i) }}
                        />
                    ))}
                </div>
            )}
            <DrillSheet
                open={selected != null}
                onOpenChange={(o) => { if (!o) { setOpenIndex(null) } }}
                eyebrow={title}
                title={selected?.label ?? ""}
            >
                {selected != null && (
                    <div>
                        <KV k="Value" v={fmt(selected.value)} />
                        <KV k="Share of total" v={total > 0 ? `${(selected.value / total * 100).toFixed(1)}%` : "—"} />
                        <KV k="Rank" v={`${rankOf(selected)} of ${data.length}`} />
                        <KV k="Total across all" v={fmt(total)} />
                    </div>
                )}
            </DrillSheet>
        </div>
    )
}

/* ── ChartCard (Flutter `_chartCard`) ────────────────────────────────── */

export function ChartCard({ title, trailing, children, className }: {
    title: string
    /** The CSV registration slot (a `<Dl/>`), or any header control. */
    trailing?: React.ReactNode
    children: React.ReactNode
    className?: string
}): React.JSX.Element {
    return (
        <ForkCard className={className}>
            <SectionHeader title={title} trailing={trailing} className="mb-3" />
            {children}
        </ForkCard>
    )
}

/* ── StatTile (Flutter `_statCard`) ──────────────────────────────────── */

/**
 * The tappable stat tile: uppercase caption, oversized figure, and — when it
 * drills down — the copper "DETAILS ›" affordance so it reads as expandable.
 */
export function StatTile({ label, value, onClick }: {
    label: string
    value: string
    onClick?: () => void
}): React.JSX.Element {
    return (
        <StatCard
            value={value}
            caption={label.toUpperCase()}
            onClick={onClick}
            className="min-w-0"
            footer={onClick == null ? undefined : (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold tracking-[0.11em] text-accent-foreground">
                    DETAILS
                    <span aria-hidden>›</span>
                </span>
            )}
        />
    )
}

/* ── Small identity marks ────────────────────────────────────────────── */

/** The initials/rank avatar the list cards lead with. */
export function InitialsBadge({ text }: { text: string }): React.JSX.Element {
    return (
        <span
            aria-hidden
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-border bg-inset text-[12.5px] font-semibold text-muted-foreground gaia:rounded-[2px]"
        >
            {text}
        </span>
    )
}

/** The 34px inset icon box (station rows, dish rows, price direction). */
export function IconBox({ children, tone, className }: {
    children: React.ReactNode
    /** A status ink to tint the box with (warning flame, price direction). */
    tone?: string
    className?: string
}): React.JSX.Element {
    const style = tone == null ? undefined : {
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${tone} 28%, transparent)`,
        color: tone,
    }
    return (
        <span
            aria-hidden
            style={style}
            className={cn(
                "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-inset text-muted-foreground gaia:rounded-[2px] [&>svg]:h-4 [&>svg]:w-4",
                className,
            )}
        >
            {children}
        </span>
    )
}

/* ── Empty (Flutter `_empty`) ────────────────────────────────────────── */

export function NothingToShow({ caption }: { caption: string }): React.JSX.Element {
    return <EmptyState icon={<Inbox />} title="Nothing to show" caption={caption} />
}
