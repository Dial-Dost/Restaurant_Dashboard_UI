"use client"

// INSIGHTS → REPORTS — the control / MIS report set.
//
// Fifteen documents an owner or an auditor reads, and ONE shell around all of them:
// date range, outlet, search, column configuration, time-wise toggle, totals,
// export and drill-down are built here once and mounted for every report. Nine
// bespoke screens would drift — one would round differently, one would forget to
// say which outlet it was showing, one would export a column set nobody asked
// for — and a set of control documents that disagree with each other is worth
// less than none at all.
//
// WHAT IS SHARED, AND WHY IT IS SHARED FROM WHERE
//  * THE DATE RANGE is the SHIPPED control (`DateRangePicker` + `useDateRange`),
//    not a second one built here. That module exists precisely because four
//    reporting screens had each grown their own idea of "the last 30 days".
//  * THE OUTLET SELECTOR is local to this screen and does NOT reload the page,
//    unlike the global switcher in the header — comparing two branches is a
//    normal thing to do inside a report, and a full reload between each look
//    would make it unusable. It defaults to whatever scope the rest of the
//    dashboard is in, so Reports opens showing what the user already thinks
//    they are looking at.
//  * COLUMNS persist per user per report; SORT and PAGING are per visit.
//  * THE SESSION (Lunch, Dinner, custom times) sits beside the date range and is
//    kept exactly like it — for the session, and on the URL — because it is half
//    of the same question: which hours of which days. See `time-slot-picker.tsx`.
//  * EMAIL (client item 9) lives here too: an Email button beside Export sends
//    the report on screen for the days on screen (`email-dialog.tsx`), and the
//    "Email reports" view (`?view=email`, `email-reports.tsx`) holds the address
//    book, the schedules and the delivery history. Same permission as every
//    report on this page, so a waiter never reaches either.
//
// EVERY NUMBER ON THIS SCREEN IS THE SERVER'S. The money ladder — Item total →
// Discount → Net → Service Charge → Tax → Round Off → Gross — is pinned
// once in the backend's `mis_report_math.ts` and all fifteen reports derive from
// it there. Nothing here re-derives, re-rounds or cross-foots a figure. The only
// arithmetic in this file counts rows.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
    AlertCircle,
    CalendarClock,
    Download,
    FileSpreadsheet,
    FileText,
    Info,
    Layers,
    Loader2,
    Mail,
    Printer,
    Search,
    Store,
    X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangePicker } from "@/components/date-range-picker"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useDateRange } from "@/hooks/use-date-range"
import { useToast } from "@/hooks/use-toast"
import { getMisCatalogue, getMisReport, getOutlets, getReportTimeSlots, saveReportTimeSlots, type MisQuery, type OutletRow } from "@/lib/db"
import {
    CLOCK_LABELS,
    MIS_REPORTS,
    buildExportMatrix,
    clockFromBasis,
    defaultHidden,
    drillTarget,
    formatMatrix,
    loadColumnPrefs,
    pageCaption,
    rowsOf,
    saveColumnPrefs,
    sortRows,
    totalsLabelFor,
    visibleColumns,
    type MisColumn,
    type MisReportDef,
    type MisReportKey,
    type MisReportPayload,
    type MisRow,
    type SortState,
} from "@/lib/mis-reports"
import { ALL_OUTLETS, getSelectedOutletId } from "@/lib/outlet"
import {
    ALL_DAY,
    clampNotices,
    loadSlotSelection,
    reconcileSlotSelection,
    saveSlotSelection,
    slotQuery,
    slotDefinitionKey,
    slotSelectionFromParams,
    timeSlotPhrase,
    timeWiseOptions,
    withSlotParams,
    type MisBucket,
    type ReportTimeSlots,
    type TimeSlotSelection,
} from "@/lib/report-time-slots"
import { formatFullDateTime, timezoneCaption } from "@/lib/tz"
import { cn } from "@/lib/utils"

import { ColumnPicker } from "./column-picker"
import { ContextPanel } from "./context-panels"
import { DrillDownDialog, type DrillRequest } from "./drill-down"
import { ReportTable } from "./report-table"
import { runExport, exportSummary, type ExportContext, type ExportFormat } from "./export"
import { TimeSlotPicker } from "./time-slot-picker"
import { EmailReportDialog } from "./email-dialog"
import { EmailReportsPanel } from "./email-reports"
import { EMAIL_AREA_TITLE, EMAIL_BUTTON_LABEL, EMAIL_BUTTON_TOOLTIP } from "@/lib/report-email"

/** Server's own ceiling (MIS_MAX_PAGE). Asking for more just gets clamped. */
const MAX_PAGE_SIZE = 500
const PAGE_SIZES = [50, 100, 250, 500]
/** Hard stop on the export's page loop, so a runaway total cannot spin forever. */
const MAX_EXPORT_PAGES = 40

function ReportsInner() {
    const { user } = useAuth()
    const { currencySymbol } = useCurrency()
    const { toast } = useToast()
    const params = useSearchParams()
    const rid = user?.restaurantUsername ?? ""
    const userKey = user?.employeeId ?? user?.restaurantUsername ?? "anon"

    const { range, setRange, query, timezone } = useDateRange("reports", { params })

    // --- Which view: the reports, or Email reports ----------------------------
    // On the URL like the session, so a link (and the bell's "Open Reports →
    // Email reports") reopens the right one.
    const [view, setView] = useState<"report" | "email">(() => (params?.get("view") === "email" ? "email" : "report"))
    const [emailOpen, setEmailOpen] = useState(false)
    const chooseView = useCallback((next: "report" | "email") => {
        setView(next)
        if (typeof window !== "undefined") {
            const qs = new URLSearchParams(window.location.search)
            if (next === "email") {qs.set("view", "email")} else {qs.delete("view")}
            const search = qs.toString()
            window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`)
        }
    }, [])

    // --- Which part of the day ------------------------------------------------
    // Seeded like the range: the URL first (a link to "Dinner, 1–15 Aug" opens on
    // Dinner), then this session's choice, then all day. It is only SENT once the
    // presets route has answered: a remembered "Lunch" against a server that
    // cannot slice would be a filter the toolbar claims and the numbers ignore,
    // so until then the picker is absent and the report is the whole day.
    const [slotSel, setSlotSel] = useState<TimeSlotSelection>(() => slotSelectionFromParams(params) ?? loadSlotSelection("reports"))
    const [slotCatalogue, setSlotCatalogue] = useState<ReportTimeSlots | null>(null)
    const [slotsSettled, setSlotsSettled] = useState(false)

    // --- Which report ---------------------------------------------------------
    // Seeded from `?report=` so a link to "the Void KOT report" opens on it.
    const [defs, setDefs] = useState<MisReportDef[]>([...MIS_REPORTS])
    const [activeKey, setActiveKey] = useState<MisReportKey>(() => {
        const wanted = params?.get("report")
        return (MIS_REPORTS.find((r) => r.key === wanted)?.key ?? "sales_summary")
    })
    const def = useMemo(() => defs.find((d) => d.key === activeKey) ?? defs[0], [defs, activeKey])

    // --- Scope ----------------------------------------------------------------
    const roles = [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
    const canSwitchOutlet = roles.includes("admin") || roles.includes("manager")
    const [outlets, setOutlets] = useState<OutletRow[]>([])
    // undefined = "the scope the rest of the dashboard is in". Seeded from the
    // global switcher so this screen opens on what the user expects, then owned
    // locally so changing it here costs no page reload.
    const [outletId, setOutletId] = useState<string | undefined>(undefined)

    const [searchInput, setSearchInput] = useState("")
    const [search, setSearch] = useState("")
    const [bucket, setBucket] = useState<MisBucket>("day")
    const [limit, setLimit] = useState(100)
    const [offset, setOffset] = useState(0)
    const [sort, setSort] = useState<SortState | null>(null)
    const [hidden, setHidden] = useState<string[]>([])

    const [payload, setPayload] = useState<MisReportPayload | null>(null)
    const [loading, setLoading] = useState(true)
    // Distinct from "loaded, and empty". A restaurant shut all week is a 200 with
    // zeros; an unreachable backend is not, and rendering both as a blank grid
    // would report an outage as "no trade".
    const [failed, setFailed] = useState(false)
    const [exporting, setExporting] = useState<ExportFormat | null>(null)
    const [drill, setDrill] = useState<DrillRequest | null>(null)
    const [showNotes, setShowNotes] = useState(false)

    // --- The catalogue --------------------------------------------------------
    // The backend owns the list; this merges its path/rows/paged onto the local
    // definitions (which carry the blurb and the drill-down wiring) and drops any
    // report the server does not serve. A failure leaves the fallback in place,
    // so a catalogue outage costs nothing.
    useEffect(() => {
        if (!rid) {return}
        let active = true
        void getMisCatalogue(rid, outletId).then((cat) => {
            if (!active || !cat?.reports?.length) {return}
            const merged = cat.reports
                .map((entry) => {
                    const local = MIS_REPORTS.find((r) => r.key === entry.key)
                    if (!local) {return null}
                    return {
                        ...local,
                        title: entry.title, path: entry.path, rowsKey: entry.rows, paged: entry.paged,
                        // The clock the SERVER says this report buckets on. Null when
                        // its basis map does not name the report — in which case the
                        // local value stands rather than being replaced with a guess.
                        clock: clockFromBasis(cat.shell?.basis, entry.key) ?? local.clock,
                    }
                })
                .filter((d): d is MisReportDef => d !== null)
            if (merged.length > 0) {setDefs(merged)}
        })
        return () => { active = false }
    }, [rid, outletId])

    useEffect(() => {
        if (!rid || !canSwitchOutlet) {return}
        let active = true
        void getOutlets(rid).then((res) => {
            if (!active) {return}
            setOutlets(res?.outlets ?? [])
            // Match the header switcher's current choice on first paint.
            const stored = getSelectedOutletId()
            if (stored && (stored === ALL_OUTLETS || (res?.outlets ?? []).some((o) => o.id === stored))) {
                setOutletId(stored)
            }
        })
        return () => { active = false }
    }, [rid, canSwitchOutlet])

    useEffect(() => {
        if (!rid) {return}
        let active = true
        void getReportTimeSlots(rid)
            .then((cat) => {
                if (!active) {return}
                setSlotCatalogue(cat)
                // A remembered session the restaurant has since deleted is not a
                // filter any more — say "All day" rather than send a dead id.
                if (cat) {setSlotSel((sel) => reconcileSlotSelection(sel, cat.slots))}
            })
            .catch(() => { if (active) {setSlotCatalogue(null)} })
            .finally(() => { if (active) {setSlotsSettled(true)} })
        return () => { active = false }
    }, [rid])

    const chooseSlot = useCallback((next: TimeSlotSelection) => {
        setSlotSel(next)
        saveSlotSelection("reports", next)
        // On the address bar too, so the link an owner copies reopens Dinner.
        // replaceState, not a navigation: nothing on this page re-reads the URL
        // after its first paint, and a history entry per click would make Back useless.
        if (typeof window !== "undefined") {
            const nextSearch = withSlotParams(window.location.search, next)
            window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextSearch}${window.location.hash}`)
        }
    }, [])

    const onSlotsSaved = useCallback((next: ReportTimeSlots) => {
        setSlotCatalogue(next)
        chooseSlot(reconcileSlotSelection(slotSel, next.slots))
    }, [chooseSlot, slotSel])

    // Debounced search: a control report is an expensive query, and firing one
    // per keystroke on "Bill No. 10423" is nine wasted round trips.
    useEffect(() => {
        const t = setTimeout(() => { setSearch(searchInput.trim()) }, 350)
        return () => { clearTimeout(t) }
    }, [searchInput])

    // Any change to WHAT is being asked returns to the first page. Staying on
    // page 7 of a new question shows an empty grid that looks like no data.
    const effectiveSlot = slotCatalogue ? slotSel : ALL_DAY
    // The two newer segments exist only where the presets route does; a bucket
    // the server cannot answer is sent as the day-wise table it would return.
    const bucketOptions = timeWiseOptions(slotCatalogue !== null)
    const effectiveBucket: MisBucket = bucketOptions.some((b) => b.value === bucket) ? bucket : "day"
    // The cut actually SENT — only the time-wise report takes one. Named once, so
    // the request and the key below can never be built from two different cuts.
    const sentBucket = def?.timeWise ? effectiveBucket : undefined
    // The pick AND what stands behind it: editing Lunch's hours or name is a new
    // question under the same `slot=lunch`, and on "By session" saving ANY preset
    // is one — All day picked included, since those rows are the presets. Either
    // must refetch (and return to page one) although the URL has not changed.
    const slotDefKey = slotDefinitionKey(effectiveSlot, slotCatalogue?.slots ?? [], sentBucket)
    useEffect(() => { setOffset(0) }, [activeKey, search, outletId, bucket, limit, range.from, range.to, slotDefKey])
    // Switching tabs drops the previous report's payload rather than leaving it
    // on screen under the new report's heading. The two do not share a column
    // set, so the old rows would render as a grid of blanks beneath the new
    // title — which on a control document reads as "this report has no data"
    // rather than as "still loading".
    useEffect(() => { setSort(null); setPayload(null); setFailed(false) }, [activeKey])

    // --- Column preferences ---------------------------------------------------
    // Loaded per user per report. Until the payload arrives we do not know the
    // column list, so the stored set is applied on arrival and the backend's own
    // `default_on` layout is the fallback.
    const columns = useMemo<MisColumn[]>(
        () => (Array.isArray(payload?.columns) ? payload.columns : []),
        [payload],
    )
    const prefsAppliedFor = useRef<string>("")
    useEffect(() => {
        if (!def || columns.length === 0) {return}
        // ONLY trust columns that came from THIS report's payload. Without this
        // guard the effect fires the instant the tab changes — while `payload`
        // is still the PREVIOUS report's — and derives the default layout from
        // the wrong report's `default_on` flags, then latches it: the stamp is
        // already set when the right columns arrive, so the backend's own
        // default layout for the new report never gets applied at all.
        if (payload?.meta.report !== def.key) {return}
        const stamp = `${userKey}:${def.key}`
        if (prefsAppliedFor.current === stamp) {return}
        prefsAppliedFor.current = stamp
        setHidden(loadColumnPrefs(userKey, def.key)?.hidden ?? defaultHidden(columns))
    }, [def, columns, userKey, payload])

    const setHiddenPersisted = useCallback((next: string[]) => {
        setHidden(next)
        if (def) {saveColumnPrefs(userKey, def.key, { hidden: next })}
    }, [def, userKey])

    const toggleColumn = useCallback((key: string) => {
        setHiddenPersisted(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key])
    }, [hidden, setHiddenPersisted])

    const resetColumns = useCallback(() => { setHiddenPersisted(defaultHidden(columns)) }, [columns, setHiddenPersisted])

    // --- The query and the fetch ---------------------------------------------
    // `sentBucket` is settled above, beside the slot key it feeds.
    const slotParams = slotQuery(effectiveSlot)
    const baseQuery = useMemo<MisQuery>(() => ({
        from: query.from,
        to: query.to,
        days: query.days,
        outletId,
        search: search || undefined,
        bucket: sentBucket,
        slot: slotParams.slot,
        timeFrom: slotParams.timeFrom,
        timeTo: slotParams.timeTo,
    }), [query.from, query.to, query.days, outletId, search, sentBucket, slotParams.slot, slotParams.timeFrom, slotParams.timeTo])

    // A remembered slot waits for the presets to answer, so the first request is
    // the question the reader asked rather than an all-day one thrown away.
    const waitForSlots = !slotsSettled && slotSel.kind !== "all"
    useEffect(() => {
        if (!rid || !def || waitForSlots) {return}
        let active = true
        setLoading(true)
        void getMisReport(rid, def.path, { ...baseQuery, ...(def.paged ? { limit, offset } : {}) })
            .then((p) => {
                if (!active) {return}
                setPayload(p)
                setFailed(p === null)
            })
            .catch(() => { if (active) { setPayload(null); setFailed(true) } })
            .finally(() => { if (active) {setLoading(false)} })
        return () => { active = false }
    }, [rid, def, baseQuery, limit, offset, waitForSlots, slotDefKey])

    // --- What the grid is showing --------------------------------------------
    const rawRows = useMemo(() => (payload && def ? rowsOf(payload, def) : []), [payload, def])
    const shownColumns = useMemo(() => visibleColumns(columns, hidden), [columns, hidden])
    const rows = useMemo(() => sortRows(rawRows, sort, columns), [rawRows, sort, columns])
    const meta = (payload?.meta ?? null)
    const page = payload?.page
    const totals = (payload?.totals ?? null) as Record<string, unknown> | null
    const totalsLabel = totalsLabelFor(page, rows.length)
    const sortLabel = sort
        ? `${columns.find((c) => c.key === sort.key)?.label ?? sort.key} (${sort.dir === "asc" ? "ascending" : "descending"})`
        : ""

    const formatOpts = useMemo(() => ({ timezone, currencySymbol }), [timezone, currencySymbol])

    // --- Export ---------------------------------------------------------------
    // The export carries the CURRENT window, outlet, search, columns and sort.
    // On a paged report it pulls every row in range first, because a control
    // document that silently stops at row 100 is worse than no document — and
    // the button says so, so the difference from the screen is never a surprise.
    const wholeRange = Boolean(def?.paged && page && page.total > rows.length)

    const collectRows = useCallback(async (): Promise<MisRow[]> => {
        if (!rid || !def || !wholeRange || !page) {return rows}
        const gathered: MisRow[] = []
        for (let i = 0; i < MAX_EXPORT_PAGES && gathered.length < page.total; i += 1) {
            const p = await getMisReport(rid, def.path, { ...baseQuery, limit: MAX_PAGE_SIZE, offset: i * MAX_PAGE_SIZE })
            if (!p) {break}
            const batch = rowsOf(p, def)
            if (batch.length === 0) {break}
            gathered.push(...batch)
        }
        // A partial gather is still the honest thing to export — but never a
        // SMALLER set than the page already on screen.
        return gathered.length >= rows.length ? sortRows(gathered, sort, columns) : rows
    }, [rid, def, wholeRange, page, rows, baseQuery, sort, columns])

    const doExport = useCallback(async (format: ExportFormat) => {
        if (!def || rows.length === 0) {return}
        setExporting(format)
        try {
            const exportRows = await collectRows()
            const matrix = buildExportMatrix(shownColumns, exportRows, totals, totalsLabelFor(page, exportRows.length), formatOpts.timezone)
            const ctx: ExportContext = {
                matrix, meta, def, format: formatOpts, search,
                sortLabel, wholeRange: !def.paged || exportRows.length >= (page?.total ?? exportRows.length),
            }
            const message = await runExport(format, ctx, formatMatrix(matrix, formatOpts))
            toast({ title: message, description: exportSummary(ctx) })
        } catch (e) {
            toast({
                title: "Export failed",
                description: String((e as Error)?.message ?? e),
                variant: "destructive",
            })
        } finally {
            setExporting(null)
        }
    }, [def, rows.length, collectRows, shownColumns, totals, page, meta, formatOpts, search, sortLabel, toast])

    // --- Render ---------------------------------------------------------------
    if (!def) {return null}

    const outletLabel = meta?.outlet_scope === "all"
        ? "All outlets (combined)"
        : (meta?.outlet_name ?? "This outlet")
    // What the SERVER cut on — never the picker's value — so a slot it declined
    // is not claimed in the chip or the caption.
    const slotPhrase = meta?.time_slot ? timeSlotPhrase(meta.time_slot) : null
    const clamp = clampNotices(meta?.window.clamped)

    return (
        <div className="flex flex-col gap-4">
            {/* Heading + scope. The window and the outlet are stated permanently,
                because a filtered money figure sitting under a control that has
                scrolled away is how a fortnight gets read as a month. */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold md:text-2xl">Reports</h1>
                    <p className="text-xs text-muted-foreground">
                        Control &amp; MIS documents · all dates on the restaurant&apos;s calendar · {timezoneCaption(timezone)}
                    </p>
                    <div className="mt-2 flex w-max items-center gap-1 rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Reports or email">
                        {([["report", "Reports"], ["email", EMAIL_AREA_TITLE]] as const).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={view === value}
                                onClick={() => { chooseView(value) }}
                                className={cn(
                                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm transition-colors",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    view === value ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {value === "email" && <Mail className="h-3.5 w-3.5" />}
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                {view === "report" && (
                <div className="flex flex-wrap items-center gap-2">
                    {canSwitchOutlet && outlets.length > 1 ? (
                        <Select
                            value={outletId ?? outlets[0]?.id ?? ""}
                            onValueChange={(v) => { setOutletId(v) }}
                        >
                            <SelectTrigger className={cn("h-9 w-[200px]", outletId === ALL_OUTLETS && "border-primary text-primary")}>
                                {outletId === ALL_OUTLETS
                                    ? <Layers className="mr-1 h-4 w-4 shrink-0" />
                                    : <Store className="mr-1 h-4 w-4 shrink-0" />}
                                <SelectValue placeholder="Outlet" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_OUTLETS}>All outlets (combined)</SelectItem>
                                {outlets.map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                        {o.outlet_name}{o.is_active ? "" : " (inactive)"}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Badge variant="secondary" className="h-9 gap-1.5 px-3 font-normal">
                            <Store className="h-3.5 w-3.5" /> {outletLabel}
                        </Badge>
                    )}
                    <DateRangePicker value={range} onChange={setRange} timezone={timezone} disabled={!rid} />
                    {slotCatalogue && (
                        <TimeSlotPicker
                            value={slotSel}
                            slots={slotCatalogue.slots}
                            canEdit={slotCatalogue.can_edit}
                            onChange={chooseSlot}
                            onSave={(drafts) => saveReportTimeSlots(rid, drafts)}
                            onSaved={onSlotsSaved}
                            disabled={!rid}
                        />
                    )}
                </div>
                )}
            </div>

            {view === "email" ? (
                rid
                    ? <EmailReportsPanel rid={rid} timezone={timezone} />
                    : <p className="text-sm text-muted-foreground">No restaurant on this session.</p>
            ) : (<>

            {/* The tab strip. Fifteen reports, scrollable rather than wrapped, so
                the strip stays one line and the grid below never shifts down as
                the window narrows. Only the ones that EXIST are here — an empty
                tab for a report this system cannot source is a promise the
                numbers cannot keep, which is exactly why the last six were absent
                until migrations 034-039 gave them something to report. */}
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <div className="flex w-max items-center gap-1 rounded-lg border bg-muted/40 p-1">
                    {defs.map((r) => (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => { setActiveKey(r.key) }}
                            aria-current={r.key === activeKey ? "page" : undefined}
                            className={cn(
                                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                r.key === activeKey
                                    ? "bg-background font-semibold text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {r.title}
                        </button>
                    ))}
                </div>
            </div>

            {/* The blurb says what the document is FOR; the chip beside it says what
                its DATE RANGE MEANS. Three of the fifteen are dated by when the
                order was placed and four by when an act was recorded — over the
                same fortnight those do not reconcile with the settlement-clock
                reports, and a toolbar that showed "1–15 Aug" over all fifteen
                without saying which is how a manager concludes the reports
                disagree with each other. */}
            <div className="-mt-1 flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">{def.blurb}</p>
                <Badge
                    variant="outline"
                    className={cn(
                        "font-normal",
                        def.clock !== "settlement" && "border-amber-500/50 text-amber-700 dark:text-amber-400",
                    )}
                    title={CLOCK_LABELS[def.clock].long}
                >
                    <CalendarClock className="mr-1 h-3 w-3" />
                    Dated {CLOCK_LABELS[def.clock].short}{slotPhrase ? ` · ${slotPhrase}` : ""}
                </Badge>
            </div>

            {/* Toolbar: search, time-wise, columns, export. */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchInput}
                        onChange={(e) => { setSearchInput(e.target.value) }}
                        placeholder="Bill No., KOT, table, mode…"
                        className="h-9 w-[230px] pl-8 pr-8"
                        aria-label="Search this report by bill number, KOT, table or payment mode"
                    />
                    {searchInput && (
                        <button
                            type="button"
                            onClick={() => { setSearchInput("") }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label="Clear search"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {/* Time-wise. Rendered ONLY on the report it changes: a toggle that
                    is present but inert on fourteen of fifteen tabs teaches the user that
                    the controls here do not do anything. */}
                {def.timeWise && (
                    <div className="flex min-h-9 max-w-full flex-wrap items-center gap-0.5 rounded-md border bg-muted/40 p-0.5">
                        <CalendarClock className="mx-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        {bucketOptions.map((b) => (
                            <button
                                key={b.value}
                                type="button"
                                onClick={() => { setBucket(b.value) }}
                                className={cn(
                                    "whitespace-nowrap rounded px-2.5 py-1 text-xs transition-colors",
                                    effectiveBucket === b.value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {b.label}
                            </button>
                        ))}
                    </div>
                )}

                <ColumnPicker
                    columns={columns}
                    hidden={hidden}
                    onToggle={toggleColumn}
                    onReset={resetColumns}
                    disabled={columns.length === 0}
                />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9" disabled={rows.length === 0 || exporting !== null}>
                            {exporting
                                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                : <Download className="mr-1.5 h-4 w-4" />}
                            Export
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuLabel className="text-xs font-normal leading-snug text-muted-foreground">
                            {/* Says exactly what will come out, so a file that differs from
                                the screen is never a surprise. */}
                            {wholeRange
                                ? `All ${page?.total.toLocaleString("en-IN") ?? ""} rows in this range, in your current columns and sort.`
                                : "Exactly what is on screen — current filters, columns and sort."}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => { void doExport("excel") }}>
                            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel (.xlsx)
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { void doExport("csv") }}>
                            <FileText className="mr-2 h-4 w-4" /> CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { void doExport("pdf") }}>
                            <Printer className="mr-2 h-4 w-4" /> PDF (print)
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Email: the server builds and sends the files, for whole days —
                    so it waits for a restaurant, not for rows on screen. */}
                <Button
                    variant="outline" size="sm" className="h-9"
                    disabled={!rid}
                    title={EMAIL_BUTTON_TOOLTIP}
                    aria-label={EMAIL_BUTTON_TOOLTIP}
                    onClick={() => { setEmailOpen(true) }}
                >
                    <Mail className="mr-1.5 h-4 w-4" /> {EMAIL_BUTTON_LABEL}
                </Button>

                <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    {meta && clamp.range && (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                            Range shortened to {meta.window.from} – {meta.window.to}
                        </Badge>
                    )}
                    {clamp.slot && (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                            {clamp.slot}
                        </Badge>
                    )}
                    {def.paged && page ? <span>{pageCaption(page, rows.length)}</span> : <span>{rows.length} row{rows.length === 1 ? "" : "s"}</span>}
                </div>
            </div>

            {/* Headline figures and the caveats that belong with them. */}
            {payload && !failed && (
                <ContextPanel reportKey={def.key} payload={payload} currencySymbol={currencySymbol} />
            )}

            <ReportBody
                hasRestaurant={Boolean(rid)}
                failed={failed}
                loading={loading}
                payload={payload}
                columns={shownColumns}
                rows={rows}
                totals={totals}
                totalsLabel={totalsLabel}
                sort={sort}
                setSort={setSort}
                def={def}
                setDrill={setDrill}
                formatOpts={formatOpts}
                search={search}
            />

            {/* Paging + the honesty note about what the server said. */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                    {meta && (
                        <span title={`Built at ${formatFullDateTime(meta.generated_at, meta.timezone)}`}>
                            {meta.window.from} → {meta.window.to}{slotPhrase ? ` · ${slotPhrase}` : ""} · {outletLabel}
                        </span>
                    )}
                    {meta?.notes.length ? (
                        <button
                            type="button"
                            onClick={() => { setShowNotes((v) => !v) }}
                            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                        >
                            <Info className="h-3.5 w-3.5" />
                            {showNotes ? "Hide" : "How these numbers are counted"}
                        </button>
                    ) : null}
                </div>

                {def.paged && page && page.total > 0 && (
                    <div className="flex items-center gap-2">
                        <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)) }}>
                            <SelectTrigger className="h-8 w-[104px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline" size="sm" className="h-8"
                            disabled={offset === 0 || loading}
                            onClick={() => { setOffset(Math.max(0, offset - limit)) }}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline" size="sm" className="h-8"
                            disabled={!page.has_more || loading}
                            onClick={() => { setOffset(offset + limit) }}
                        >
                            Next
                        </Button>
                    </div>
                )}
            </div>

            {/* The backend's own caveats, in its own words. These say which clock a
                report is bucketed on, what covers mean, and where a figure is
                reconstructed rather than stored — the difference between a number
                an auditor can use and one they cannot. */}
            {showNotes && meta?.notes.length ? (
                <ul className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs leading-snug text-muted-foreground">
                    {meta.notes.map((note) => (
                        <li key={note} className="flex gap-2">
                            <span aria-hidden className="text-muted-foreground/50">•</span>
                            <span>{note}</span>
                        </li>
                    ))}
                </ul>
            ) : null}

            <DrillDownDialog
                request={drill}
                onClose={() => { setDrill(null) }}
                restaurantId={rid}
                outletId={outletId}
                timezone={timezone}
                currencySymbol={currencySymbol}
            />

            <EmailReportDialog
                open={emailOpen}
                onOpenChange={setEmailOpen}
                rid={rid}
                reportKey={def.key}
                from={query.from}
                to={query.to}
                slotPhrase={slotPhrase}
                outletId={outletId}
                fallbackOutletId={outlets.find((o) => o.is_active)?.id ?? outlets[0]?.id}
                outletLabel={outletLabel}
                onOpenArea={() => { chooseView("email") }}
            />
            </>)}
        </div>
    )
}

/** The grid, plus the three things that can be there instead of one. */
function ReportBody({
    hasRestaurant, failed, loading, payload, columns, rows, totals, totalsLabel, sort, setSort, def, setDrill, formatOpts, search,
}: {
    hasRestaurant: boolean
    failed: boolean
    loading: boolean
    payload: MisReportPayload | null
    columns: MisColumn[]
    rows: MisRow[]
    totals: Record<string, unknown> | null
    totalsLabel: string
    sort: SortState | null
    setSort: (s: SortState) => void
    def: MisReportDef
    setDrill: (r: DrillRequest) => void
    formatOpts: { timezone: string; currencySymbol: string }
    search: string
}) {
    // No restaurant on the session yet. WITHOUT this branch the fetch effect
    // returns early and `loading` never clears, so the screen sits on "Building
    // the report…" for ever — a spinner that is not waiting for anything, which
    // reads as a hung report rather than as a signed-out session.
    if (!hasRestaurant) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-6 py-16 text-center">
                <p className="font-medium">No restaurant on this session.</p>
                <p className="max-w-md text-sm text-muted-foreground">
                    Reports are scoped to a signed-in restaurant. Sign in again and this page will build itself.
                </p>
            </div>
        )
    }

    if (failed) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/[0.03] px-6 py-14 text-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <p className="font-medium">This report could not be loaded.</p>
                <p className="max-w-md text-sm text-muted-foreground">
                    This is not the same as &ldquo;no trade in this range&rdquo; — the request did not come back.
                    Check your connection, or that your plan and role include the accounting reports, and try again.
                </p>
            </div>
        )
    }

    if (loading && !payload) {
        return (
            <div className="flex items-center justify-center gap-2 rounded-lg border bg-card px-6 py-20 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Building the report…
            </div>
        )
    }

    if (columns.length === 0) {return null}

    const drillable = def.drill !== "none"

    return (
        <ReportTable
            columns={columns}
            rows={rows}
            totals={totals}
            totalsLabel={totalsLabel}
            sort={sort}
            onSort={setSort}
            drillable={drillable}
            onDrill={drillable ? (row) => { const t = drillTarget(row, def); if (t) {setDrill(t)} } : null}
            format={formatOpts}
            loading={loading}
            empty={
                <div className="space-y-1">
                    <p className="font-medium">
                        {search ? `Nothing matches “${search}” in this range.` : "No records in this range."}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {search
                            ? "Try a different bill number, table or payment mode — or clear the search."
                            : "The report ran and came back empty: there is nothing to show for this window and outlet."}
                    </p>
                </div>
            }
        />
    )
}

export default function ReportsPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
            </div>
        }>
            <ReportsInner />
        </Suspense>
    )
}
