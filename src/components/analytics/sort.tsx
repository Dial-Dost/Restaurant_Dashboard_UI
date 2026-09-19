"use client"

// Per-section list sorting — the web `_sortControl` / `_sortHeader` /
// `_applySort` (restaurant_owner_app modules.dart ~19965): every list in the
// analytics module gets a compact sort control (field picker + asc/desc
// toggle). Selections are MODULE-level so they survive view switches and
// reloads within a session, mirroring the Flutter statics. Charts and
// time-series stay chronological and are never wired to this.

import * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SectionHeader } from "@/components/ui/section-header"

export interface SortOption<T> {
    label: string
    key: (row: T) => number | string
}

// Selected field index / descending flag per section id — in-session module
// state, exactly Flutter's `_sortField` / `_sortDesc` top-level maps.
const sortFieldChoice: Record<string, number> = {}
const sortDescChoice: Record<string, boolean> = {}

export interface SectionSort {
    fieldIndex: number
    desc: boolean
    pickField: (i: number) => void
    toggleDesc: () => void
}

/** Binds one section's sort choice to React state (seeded from the module maps). */
export function useSectionSort(section: string, defaultDesc: boolean): SectionSort {
    const [, bump] = React.useReducer((n: number) => n + 1, 0)
    const fieldIndex = sortFieldChoice[section] ?? 0
    const desc = sortDescChoice[section] ?? defaultDesc
    const pickField = React.useCallback((i: number) => {
        sortFieldChoice[section] = i
        bump()
    }, [section])
    const toggleDesc = React.useCallback(() => {
        sortDescChoice[section] = !(sortDescChoice[section] ?? defaultDesc)
        bump()
    }, [section, defaultDesc])
    return { fieldIndex, desc, pickField, toggleDesc }
}

/**
 * Sort an already-fetched list client-side by the section's current field +
 * direction. Returns a new array; the source is left untouched. Missing
 * numerics read as 0 (so a null late-% sorts below anyone actually late),
 * matching the Flutter `_numk` behaviour.
 */
export function applySort<T>(rows: T[], opts: SortOption<T>[], sort: SectionSort): T[] {
    if (opts.length === 0) { return [...rows] }
    const fi = Math.min(Math.max(sort.fieldIndex, 0), opts.length - 1)
    const key = opts[fi].key
    const dir = sort.desc ? -1 : 1
    return [...rows].sort((a, b) => {
        const av = key(a)
        const bv = key(b)
        const c = typeof av === "string" || typeof bv === "string"
            ? String(av).localeCompare(String(bv))
            : av - bv
        return c * dir
    })
}

/**
 * The compact toolbar: field picker (hidden when there is a single field) +
 * an asc/desc toggle, styled as quiet pills with a copper active state.
 */
export function SortControl<T>({ opts, sort }: { opts: SortOption<T>[]; sort: SectionSort }): React.JSX.Element {
    const fi = Math.min(Math.max(sort.fieldIndex, 0), Math.max(opts.length - 1, 0))
    return (
        <div className="flex shrink-0 items-center gap-1.5">
            {opts.length > 1 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            title="Sort by"
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-inset px-2.5 py-1.5 text-[11.5px] font-semibold tracking-[0.2px] text-accent-foreground transition-colors duration-fast hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring gaia:rounded-[2px]"
                        >
                            <ArrowUpDown aria-hidden className="h-3 w-3 text-accent-foreground/80" />
                            {opts[fi]?.label}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {opts.map((o, i) => (
                            <DropdownMenuItem key={o.label} onSelect={() => { sort.pickField(i) }}>
                                <span className={i === fi ? "font-semibold text-accent-foreground" : undefined}>{o.label}</span>
                                {i === fi && <Check className="ml-auto h-3.5 w-3.5 text-accent-foreground" />}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={sort.desc ? "Descending" : "Ascending"}
                aria-label={sort.desc ? "Descending" : "Ascending"}
                onClick={() => { sort.toggleDesc() }}
            >
                {sort.desc ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </Button>
        </div>
    )
}

/**
 * A section title row with the sort control pinned to the right — the
 * template section-header idiom (copper tick + title) carrying the sort
 * toolbar, plus an optional extra trailing slot (the campaigns "Add" button).
 */
export function SortHeader<T>({ title, opts, sort, extra, className, id }: {
    title: React.ReactNode
    opts: SortOption<T>[]
    sort: SectionSort
    /** Rendered after the sort control (e.g. an Add button). */
    extra?: React.ReactNode
    className?: string
    id?: string
}): React.JSX.Element {
    return (
        <SectionHeader
            id={id}
            className={className}
            title={title}
            trailing={
                <div className="flex items-center gap-1.5">
                    <SortControl opts={opts} sort={sort} />
                    {extra}
                </div>
            }
        />
    )
}
