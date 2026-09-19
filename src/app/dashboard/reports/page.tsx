"use client"

// INSIGHTS → REPORTS — the web copy of the app's Reports module
// (screens/reports.dart + screens/report_email.dart).
//
// Two views under one header: the fifteen-report MIS pack and Email reports
// (address book, schedules, history). The MIS shell is built once for all
// fifteen: range · session · outlet · basis · search · time-wise above the tabs;
// tiles and flags; an action bar (Columns · Export · Email · How it is counted ·
// Refresh · drill note); the grid (frozen identity column, per-row chevrons, a
// card list under 760px); and a footer (count · Load more · clamps · applied
// session · timezone).
//
// EVERY NUMBER ON THIS SCREEN IS THE SERVER'S. The only arithmetic here counts rows.

import { Suspense, useCallback, useEffect, useMemo, useState, type JSX } from "react"
import { useSearchParams } from "next/navigation"
import {
    CalendarDays, ChevronDown, Clock, Download, FileSpreadsheet, FileText, Filter, Globe, Info, Layers,
    ListChecks, Loader2, Mail, Printer, RefreshCw, Sigma, Store, Hand,
} from "lucide-react"

import { AppSearchField } from "@/components/ui/app-search-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SectionHeader } from "@/components/ui/section-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DateRangePicker } from "@/components/date-range-picker"
import { ContextPanel, ReportFlags } from "@/components/reports/context-panels"
import { DrillDownDialog, type DrillRequest } from "@/components/reports/drill-down"
import { EmailReportsPanel } from "@/components/reports/email-reports"
import { EmailSendSheet, emailErrorSentence } from "@/components/reports/email-send"
import { EMAIL_BUTTON_LABEL, EMAIL_BUTTON_TOOLTIP } from "@/components/reports/report-email"
import { ReportGrid, TOTALS_LABEL, useCompactGrid } from "@/components/reports/report-grid"
import { TimeSlotChip } from "@/components/reports/time-slot-chip"
import {
    basisLabel, drillNote, isSearchable, loadBucket, loadOpenTab, loadView, rowOpens, saveBucket, saveOpenTab, saveView,
    searchHint, type RowOpenCtx,
} from "@/components/reports/catalogue"
import {
    ALL_DAY, appliedFromMeta, appliedPhrase, catalogueFromJson, clampNotices, loadSlotMemory, reconcileSelection,
    saveSlotMemory, selectionPhrase, selectionQuery, slotDefinitionKey, timeSlotProvenance, timeWiseOptions,
    type MisBucket, type TimeSlotCatalogue, type TimeSlotSelection,
} from "@/components/reports/time-slot"
import { useAuth } from "@/context/AuthContext"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useCurrency } from "@/hooks/use-currency"
import { useDateRange } from "@/hooks/use-date-range"
import { useToast } from "@/hooks/use-toast"
import { fetchMisReport, fetchTimeSlots } from "@/lib/api/reports"
import { getMisCatalogue, getOutlets, type OutletRow } from "@/lib/db"
import {
    MIS_REPORTS, buildExportMatrix, clockFromBasis, defaultHidden, formatMatrix, loadColumnPrefs, rowsOf, saveColumnPrefs,
    sortRows, visibleColumns, type MisColumn, type MisReportDef, type MisReportKey, type MisReportPayload, type MisRow,
    type SortState,
} from "@/lib/mis-reports"
import { ALL_OUTLETS, applySelectedOutlet, getSelectedOutletId } from "@/lib/outlet"
import { cn } from "@/lib/utils"

import { ColumnPicker } from "./column-picker"
import { exportSummary, runExport, type ExportContext, type ExportFormat } from "./export"

/** The app's fixed page (`_pageSize`); Load more appends the next one. */
const PAGE_SIZE = 100
/** Export sweep: 500 a page, hard stop at 10,000 rows (the app's cap). */
const EXPORT_PAGE = 500
const EXPORT_CAP = 10_000

type View = "reports" | "email"

function ReportsInner(): JSX.Element {
    const { user } = useAuth()
    const { currencySymbol } = useCurrency()
    const { toast } = useToast()
    const params = useSearchParams()
    const rid = user?.restaurantUsername ?? ""
    const userKey = user?.employeeId ?? user?.restaurantUsername ?? "anon"
    const { range, setRange, query, label: rangeLabel, timezone } = useDateRange("reports", { params })

    // --- View + report (session-remembered, `?view=` / `?report=` win) -------
    const [view, setViewState] = useState<View>(() => (params.get("view") === "email" ? "email" : loadView()))
    const setView = (v: View): void => { setViewState(v); saveView(v) }
    const [defs, setDefs] = useState<MisReportDef[]>([...MIS_REPORTS])
    const [activeKey, setActiveKey] = useState<MisReportKey>(() => {
        const wanted = params.get("report") ?? loadOpenTab()
        return MIS_REPORTS.find((r) => r.key === wanted)?.key ?? MIS_REPORTS[0].key
    })
    const def = useMemo(() => defs.find((d) => d.key === activeKey) ?? defs[0], [defs, activeKey])

    // --- Scope: drives the app-wide outlet switch, like the app --------------
    const roles = [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
    const canSwitchOutlet = roles.includes("admin") || roles.includes("manager")
    const [outlets, setOutlets] = useState<OutletRow[]>([])
    const [outletId] = useState<string | null>(() => (typeof window === "undefined" ? null : getSelectedOutletId()))
    const combined = outletId === ALL_OUTLETS

    // --- Filters ---------------------------------------------------------------
    const searchable = isSearchable(activeKey)
    const [search, setSearch] = useState("")
    const [bucket, setBucketState] = useState<MisBucket>(() => loadBucket())
    const setBucket = (b: MisBucket): void => { setBucketState(b); saveBucket(b) }
    const [slotCatalogue, setSlotCatalogue] = useState<TimeSlotCatalogue | null>(null)
    const [slot, setSlotState] = useState<TimeSlotSelection>(() => (typeof window === "undefined" ? ALL_DAY : loadSlotMemory()))
    const setSlot = (sel: TimeSlotSelection): void => { setSlotState(sel); saveSlotMemory(sel) }
    const presets = useMemo(() => slotCatalogue?.slots ?? [], [slotCatalogue])

    const [sort, setSort] = useState<SortState | null>(null)
    const [hidden, setHidden] = useState<string[]>([])
    const [extra, setExtra] = useState<MisRow[]>([])
    const [appending, setAppending] = useState(false)
    const [exporting, setExporting] = useState<ExportFormat | null>(null)
    const [drill, setDrill] = useState<DrillRequest | null>(null)
    const [notesOpen, setNotesOpen] = useState(false)
    const [emailOpen, setEmailOpen] = useState(false)
    const compact = useCompactGrid()

    useEffect(() => { saveOpenTab(activeKey) }, [activeKey])

    // Catalogue merge (server owns path/rows/paged); fallback stays on failure.
    useEffect(() => {
        if (!rid) { return }
        let active = true
        void getMisCatalogue(rid).then((cat) => {
            if (!active || !cat?.reports.length) { return }
            const merged = cat.reports
                .map((entry) => {
                    const local = MIS_REPORTS.find((r) => r.key === entry.key)
                    return local ? { ...local, title: entry.title, path: entry.path, rowsKey: entry.rows, paged: entry.paged, clock: clockFromBasis(cat.shell?.basis, entry.key) ?? local.clock } : null
                })
                .filter((d): d is MisReportDef => d !== null)
            if (merged.length > 0) { setDefs(merged) }
        })
        return () => { active = false }
    }, [rid])

    useEffect(() => {
        if (!rid || !canSwitchOutlet) { return }
        let active = true
        void getOutlets(rid).then((res) => { if (active) { setOutlets(res?.outlets ?? []) } })
        return () => { active = false }
    }, [rid, canSwitchOutlet])

    // Saved sessions. No answer = no picker, and only Day-/Hour-wise.
    useEffect(() => {
        if (!rid) { return }
        let active = true
        void fetchTimeSlots().then((raw) => {
            if (!active) { return }
            const cat = catalogueFromJson(raw)
            setSlotCatalogue(cat)
            if (cat) { setSlotState((cur) => reconcileSelection(cur, cat.slots)) }
        }).catch(() => { /* older server: no sessions */ })
        return () => { active = false }
    }, [rid])

    // Switching to a report whose endpoint ignores search DROPS the term.
    useEffect(() => { if (!searchable) { setSearch("") } }, [searchable])
    useEffect(() => { setSort(null) }, [activeKey])

    const slotsAvailable = slotCatalogue !== null
    const effectiveBucket: MisBucket = def.timeWise
        ? (timeWiseOptions(slotsAvailable).some(([b]) => b === bucket) ? bucket : "day")
        : "day"

    // --- The fetch ---------------------------------------------------------------
    const slotQuery = useMemo(() => selectionQuery(slot), [slot])
    const fetchKey = [
        "reports", rid, outletId ?? "home", def.key, query.from, query.to, query.days, searchable ? search : "",
        def.timeWise ? effectiveBucket : "", slotDefinitionKey(slot, presets, def.timeWise ? effectiveBucket : undefined),
    ].join("|")
    const report = useCachedFetch<MisReportPayload>(
        fetchKey,
        () => fetchMisReport(rid, def.path, {
            from: query.from, to: query.to, days: query.days,
            search: searchable ? search : undefined,
            bucket: def.timeWise ? effectiveBucket : undefined,
            slot: slotQuery,
            ...(def.paged ? { limit: PAGE_SIZE, offset: 0 } : {}),
        }),
        { enabled: Boolean(rid) },
    )
    useEffect(() => { setExtra([]) }, [fetchKey])

    // Never the previous tab's payload under this tab's heading.
    const payload = report.data?.meta.report === def.key ? report.data : null
    const columns = useMemo<MisColumn[]>(() => (Array.isArray(payload?.columns) ? payload.columns : []), [payload])

    // Column prefs: per user per report; the server's `default_on` is the fallback.
    const [prefsFor, setPrefsFor] = useState("")
    useEffect(() => {
        if (columns.length === 0 || payload?.meta.report !== def.key) { return }
        const stamp = `${userKey}:${def.key}`
        if (prefsFor === stamp) { return }
        setPrefsFor(stamp)
        setHidden(loadColumnPrefs(userKey, def.key)?.hidden ?? defaultHidden(columns))
    }, [def, columns, userKey, payload, prefsFor])
    const setHiddenPersisted = useCallback((next: string[]) => {
        setHidden(next)
        saveColumnPrefs(userKey, def.key, { hidden: next })
    }, [def, userKey])

    const baseRows = useMemo(() => (payload ? rowsOf(payload, def) : []), [payload, def])
    const rawRows = useMemo(() => [...baseRows, ...extra], [baseRows, extra])
    const rows = useMemo(() => sortRows(rawRows, sort, columns), [rawRows, sort, columns])
    const shownColumns = useMemo(() => visibleColumns(columns, hidden), [columns, hidden])
    const meta = payload?.meta ?? null
    const page = payload?.page
    const total = page?.total ?? rows.length
    const hasMore = Boolean(def.paged && page && rows.length < page.total)
    const totals = (payload?.totals ?? null)
    const applied = appliedFromMeta(meta)
    const slotPhrase = applied ? appliedPhrase(applied) : selectionPhrase(slot, presets)
    const clamp = clampNotices((meta?.window as { clamped?: unknown } | undefined)?.clamped)
    const formatOpts = useMemo(() => ({ timezone, currencySymbol }), [timezone, currencySymbol])

    const loadMore = async (): Promise<void> => {
        if (!hasMore) { return }
        setAppending(true)
        try {
            const p = await fetchMisReport(rid, def.path, {
                from: query.from, to: query.to, days: query.days, search: searchable ? search : undefined,
                bucket: def.timeWise ? effectiveBucket : undefined, slot: slotQuery, limit: PAGE_SIZE, offset: rawRows.length,
            })
            setExtra((x) => [...x, ...rowsOf(p, def)])
        } catch (e) {
            toast({ title: "Couldn't load more rows", description: emailErrorSentence(e), variant: "destructive" })
        } finally {
            setAppending(false)
        }
    }

    // --- Row actions -------------------------------------------------------------------
    const openCtx: RowOpenCtx = { reportKey: activeKey, bucket: effectiveBucket, presets, applied, canSwitchOutlet: canSwitchOutlet && outlets.length > 1 }
    const rowAction = (row: MisRow): (() => void) | null => {
        const o = rowOpens(row, openCtx)
        if (!o) { return null }
        switch (o.kind) {
            case "bill": return () => { setDrill({ kind: "bill", id: o.id }) }
            case "kot": return () => { setDrill({ kind: "kot", id: o.id }) }
            case "day": return () => { setRange({ from: o.day, to: o.day, preset: "custom" }) }
            case "hour":
            case "session": return () => { setSlot(o.slot); setBucket("day") }
            case "outlet": return () => { void applySelectedOutlet(o.id) }
        }
    }
    const note = drillNote(rows, openCtx)

    // --- Export ------------------------------------------------------------------------
    const doExport = async (format: ExportFormat): Promise<void> => {
        if (rows.length === 0) { return }
        setExporting(format)
        toast({ title: `Preparing the ${format === "excel" ? "Excel file" : format.toUpperCase()}…` })
        try {
            let exportRows = rows
            let truncatedAt: number | null = null
            if (def.paged && page && page.total > rows.length) {
                const gathered: MisRow[] = []
                for (let off = 0; gathered.length < page.total && gathered.length < EXPORT_CAP; off += EXPORT_PAGE) {
                    const p = await fetchMisReport(rid, def.path, {
                        from: query.from, to: query.to, days: query.days, search: searchable ? search : undefined,
                        bucket: def.timeWise ? effectiveBucket : undefined, slot: slotQuery, limit: EXPORT_PAGE, offset: off,
                    })
                    const batch = rowsOf(p, def)
                    if (batch.length === 0) { break }
                    gathered.push(...batch)
                }
                if (gathered.length >= rows.length) { exportRows = sortRows(gathered.slice(0, EXPORT_CAP), sort, columns) }
                if (exportRows.length < page.total) { truncatedAt = exportRows.length }
            }
            const exportMeta = meta ? {
                ...meta,
                notes: [
                    `Time slot: ${timeSlotProvenance(applied)}`,
                    ...(truncatedAt !== null ? [`Truncated at ${truncatedAt.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} rows — narrow the dates or search to export the rest.`] : []),
                    ...meta.notes,
                ],
            } : null
            const matrix = buildExportMatrix(shownColumns, exportRows, totals, TOTALS_LABEL)
            const sortLabel = sort ? `${columns.find((c) => c.key === sort.key)?.label ?? sort.key} (${sort.dir === "asc" ? "ascending" : "descending"})` : ""
            const ctx: ExportContext = {
                matrix, meta: exportMeta, def, format: formatOpts, search: searchable ? search : "", sortLabel,
                wholeRange: !def.paged || exportRows.length >= (page?.total ?? exportRows.length),
            }
            const message = await runExport(format, ctx, formatMatrix(matrix, formatOpts))
            toast({ title: message, description: exportSummary(ctx) })
        } catch (e) {
            toast({ title: "Export failed", description: emailErrorSentence(e), variant: "destructive" })
        } finally {
            setExporting(null)
        }
    }

    const outletControl = canSwitchOutlet && outlets.length > 1 ? (
        <Select value={outletId ?? outlets[0].id} onValueChange={(v) => { void applySelectedOutlet(v) }}>
            <SelectTrigger className={cn("h-8 w-[200px]", combined && "border-accent-base/60 text-accent-foreground")}>
                {combined ? <Layers className="mr-1 h-4 w-4 shrink-0" /> : <Store className="mr-1 h-4 w-4 shrink-0" />}
                <SelectValue placeholder="Outlet" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={ALL_OUTLETS}>All outlets (combined)</SelectItem>
                {outlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.outlet_name}</SelectItem>)}
            </SelectContent>
        </Select>
    ) : (
        <InfoChip
            icon={combined ? <Layers className="h-3 w-3" /> : <Store className="h-3 w-3" />}
            label={combined ? "All outlets" : "This outlet"}
        />
    )

    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title="Reports"
                className="mb-0"
                trailing={view === "reports" && !compact ? <InfoChip icon={<CalendarDays className="h-3 w-3" />} label={rangeLabel} /> : undefined}
            />

            {/* Reports | Email reports */}
            <div className="inline-flex w-fit rounded-lg border border-border bg-inset p-0.5" role="tablist">
                {(["reports", "email"] as const).map((v) => (
                    <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={view === v}
                        onClick={() => { setView(v) }}
                        className={cn("rounded-md px-3.5 py-1.5 text-sm transition-colors", view === v ? "bg-card font-semibold text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}
                    >
                        {v === "reports" ? "Reports" : "Email reports"}
                    </button>
                ))}
            </div>

            {view === "email" ? (
                <EmailReportsPanel restaurantId={rid} timezone={timezone} combined={combined} />
            ) : (
                <>
                    {/* Toolbar: the filters, above the figures. */}
                    <div className="flex flex-wrap items-center gap-2">
                        <DateRangePicker value={range} onChange={setRange} timezone={timezone} disabled={!rid} />
                        {slotsAvailable && (
                            <TimeSlotChip value={slot} onChange={setSlot} catalogue={slotCatalogue} onCatalogue={(c) => { setSlotCatalogue(c); setSlotState((cur) => reconcileSelection(cur, c.slots)) }} />
                        )}
                        {outletControl}
                        <InfoChip icon={<Clock className="h-3 w-3" />} label={basisLabel(activeKey, slotPhrase)} />
                        {searchable && (
                            <AppSearchField
                                key={activeKey}
                                compact
                                debounceMs={450}
                                placeholder={searchHint(activeKey)}
                                onQuery={setSearch}
                                className="w-[240px] max-[759px]:w-full"
                            />
                        )}
                        {def.timeWise && (
                            <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-inset p-0.5">
                                {timeWiseOptions(slotsAvailable).map(([b, text]) => (
                                    <button
                                        key={b}
                                        type="button"
                                        onClick={() => { setBucket(b) }}
                                        className={cn("rounded px-2.5 py-1 text-xs", effectiveBucket === b ? "bg-card font-semibold shadow-card" : "text-muted-foreground hover:text-foreground")}
                                    >
                                        {text}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* The tab strip + divider. */}
                    <div>
                        <div className="-mx-1 overflow-x-auto px-1">
                            <div className="flex w-max items-center gap-1 pb-1.5">
                                {defs.map((r) => (
                                    <button
                                        key={r.key}
                                        type="button"
                                        onClick={() => { setActiveKey(r.key) }}
                                        aria-current={r.key === activeKey ? "page" : undefined}
                                        className={cn(
                                            "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            r.key === activeKey ? "bg-card font-semibold text-accent-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        {r.title}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="h-px bg-divider" />
                    </div>

                    {!rid ? (
                        <EmptyState icon={<FileText />} title="No restaurant on this session" caption="Reports are scoped to a signed-in restaurant. Sign in again and this page will build itself." />
                    ) : report.loading || (!payload && !report.error) ? (
                        <div className="space-y-4">
                            <SkeletonStats tiles={5} />
                            <SkeletonRows rows={8} title />
                        </div>
                    ) : report.error || !payload ? (
                        <LoadErrorState whatFailed={`Couldn't load ${def.title}.`} error={report.error} onRetry={report.retry} />
                    ) : (
                        <div className="relative flex flex-col gap-4">
                            <div className="flex flex-col gap-3 min-[760px]:max-h-[45vh] min-[760px]:overflow-y-auto">
                                <ContextPanel reportKey={def.key} payload={payload} currencySymbol={currencySymbol} />
                                <ReportFlags reportKey={def.key} payload={payload} currencySymbol={currencySymbol} />
                            </div>

                            {/* The action bar. */}
                            <div className="flex flex-wrap items-center gap-2">
                                <ColumnPicker
                                    columns={columns}
                                    hidden={hidden}
                                    onToggle={(k) => { setHiddenPersisted(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]) }}
                                    onReset={() => { setHiddenPersisted(defaultHidden(columns)) }}
                                    disabled={columns.length === 0}
                                />
                                <DropdownMenu>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="sm" disabled={rows.length === 0 || exporting !== null}>
                                                    {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                                                    Export <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>Export this report</TooltipContent>
                                    </Tooltip>
                                    <DropdownMenuContent align="start" className="w-72">
                                        <DropdownMenuLabel className="text-xs font-normal leading-snug text-muted-foreground">
                                            {hasMore ? `All ${total.toLocaleString("en-IN")} rows in this range, in your current columns and sort.` : "Exactly what is on screen — current filters, columns and sort."}
                                        </DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onSelect={() => { void doExport("csv") }}><FileText className="mr-2 h-4 w-4" /> Export CSV</DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => { void doExport("excel") }}><FileSpreadsheet className="mr-2 h-4 w-4" /> Export Excel</DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => { void doExport("pdf") }}><Printer className="mr-2 h-4 w-4" /> Export PDF</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="sm" onClick={() => { setEmailOpen(true) }}>
                                            <Mail className="mr-1.5 h-4 w-4" /> {EMAIL_BUTTON_LABEL}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{EMAIL_BUTTON_TOOLTIP}</TooltipContent>
                                </Tooltip>
                                <Button variant="outline" size="sm" disabled={!meta?.notes.length} onClick={() => { setNotesOpen(true) }}>
                                    <Info className="mr-1.5 h-4 w-4" /> How it is counted
                                </Button>
                                <Button variant="outline" size="sm" onClick={report.refresh}>
                                    <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
                                </Button>
                                {note && (
                                    <InfoChip
                                        icon={note.opens ? <Hand className="h-3 w-3" /> : note.label.startsWith("Rows here") ? <Filter className="h-3 w-3" /> : <Sigma className="h-3 w-3" />}
                                        label={note.label}
                                        wrap
                                    />
                                )}
                            </div>

                            {rows.length === 0 ? (
                                <EmptyState
                                    icon={<ListChecks />}
                                    title="Nothing in this period"
                                    caption={searchable && search
                                        ? `No rows match "${search}" in this period.`
                                        : `${def.title} has no rows between ${meta?.window.from ?? query.from} and ${meta?.window.to ?? query.to}${slotPhrase ? ` in ${slotPhrase}` : ""}.`}
                                />
                            ) : (
                                <ReportGrid
                                    columns={shownColumns}
                                    rows={rows}
                                    totals={totals}
                                    sort={sort}
                                    onSort={setSort}
                                    rowAction={rowAction}
                                    format={formatOpts}
                                    compact={compact}
                                />
                            )}

                            {/* Footer. */}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{def.paged ? `Showing ${rows.length} of ${total} row${total === 1 ? "" : "s"}` : `${rows.length} row${rows.length === 1 ? "" : "s"}`}</span>
                                {hasMore && (
                                    <Button variant="outline" size="sm" disabled={appending} onClick={() => { void loadMore() }}>
                                        <ChevronDown className="mr-1 h-3.5 w-3.5" /> {appending ? "Loading…" : "Load more"}
                                    </Button>
                                )}
                                {clamp.range && <StatusChip dense status="warning" label={`Range shortened to ${meta?.window.from ?? "?"} – ${meta?.window.to ?? "?"}`} />}
                                {clamp.slot && <StatusChip dense status="warning" label={clamp.slot} />}
                                {applied && <InfoChip icon={<Clock className="h-3 w-3" />} label={appliedPhrase(applied)} />}
                                <InfoChip icon={<Globe className="h-3 w-3" />} label={meta?.timezone ?? timezone} />
                            </div>

                            <CacheStalePill offline={report.offline} fromCache={report.fromCache} updatedAt={report.updatedAt} className="absolute right-0 top-0" />
                        </div>
                    )}
                </>
            )}

            <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
                <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
                    <DialogHeader>
                        <div className="micro-label">HOW THESE NUMBERS ARE COUNTED</div>
                        <DialogTitle>{meta?.title ?? def.title}</DialogTitle>
                    </DialogHeader>
                    <ul className="space-y-2 text-sm">
                        {(meta?.notes ?? []).map((n) => (
                            <li key={n} className="flex gap-2.5">
                                <span aria-hidden className="mt-1.5 h-3 w-[3px] shrink-0 rounded-[2px] bg-accent-hi" />
                                <span>{n}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">Every export of this report carries these lines on its first page.</p>
                </DialogContent>
            </Dialog>

            <EmailSendSheet
                open={emailOpen}
                onClose={() => { setEmailOpen(false) }}
                reportKey={activeKey}
                from={meta?.window.from ?? query.from}
                to={meta?.window.to ?? query.to}
                slotPhrase={applied ? appliedPhrase(applied) : null}
                timezone={timezone}
                combined={combined}
                homeOutletId={user?.outlet_id}
            />

            <DrillDownDialog
                request={drill}
                onClose={() => { setDrill(null) }}
                restaurantId={rid}
                outletId={outletId ?? undefined}
                timezone={timezone}
                currencySymbol={currencySymbol}
            />
        </div>
    )
}

export default function ReportsPage(): JSX.Element {
    return (
        <Suspense fallback={<div className="space-y-4"><SkeletonStats tiles={5} /><SkeletonRows rows={8} /></div>}>
            <ReportsInner />
        </Suspense>
    )
}
