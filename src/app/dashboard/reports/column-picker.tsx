"use client"

// WHICH COLUMNS THIS READER WANTS.
//
// Persisted PER USER PER REPORT in localStorage (see `mis-reports.ts`), not per
// session: a date range is a question you ask this afternoon, but a column
// layout is how you like to read, and handing someone back the default eighteen
// columns every morning is a chore. Scoped by user because a shared terminal is
// normal in a restaurant — the manager's layout must not follow the cashier who
// signs in after them.
//
// The list is the SERVER's column order, never re-sorted here, so the picker and
// the grid always agree about what sits where.

import { Columns3, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { MisColumn } from "@/lib/mis-reports"

interface Props {
    columns: MisColumn[]
    hidden: string[]
    onToggle: (key: string) => void
    onReset: () => void
    disabled?: boolean
}

export function ColumnPicker({ columns, hidden, onToggle, onReset, disabled }: Props) {
    const off = new Set(hidden)
    const shownCount = columns.length - columns.filter((c) => off.has(c.key)).length
    const isDefault = hidden.length === 0
        ? columns.every((c) => c.default_on !== false)
        : hidden.length === columns.filter((c) => c.default_on === false).length
            && columns.filter((c) => c.default_on === false).every((c) => off.has(c.key))

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={disabled} className="h-9">
                    <Columns3 className="mr-1.5 h-4 w-4" />
                    Columns
                    <span className="ml-1.5 text-xs text-muted-foreground">{shownCount}/{columns.length}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[70vh] w-60 overflow-y-auto">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Shown on screen and in every export
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((col) => {
                    const visible = !off.has(col.key)
                    return (
                        <DropdownMenuCheckboxItem
                            key={col.key}
                            checked={visible}
                            // The last visible column cannot be turned off — a grid
                            // with no columns is a blank rectangle the user then has
                            // to work out how to escape.
                            disabled={visible && shownCount === 1}
                            onSelect={(e) => { e.preventDefault() }}
                            onCheckedChange={() => { onToggle(col.key) }}
                        >
                            <span className="truncate">{col.label}</span>
                        </DropdownMenuCheckboxItem>
                    )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isDefault} onSelect={() => { onReset() }}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Reset to default columns
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
