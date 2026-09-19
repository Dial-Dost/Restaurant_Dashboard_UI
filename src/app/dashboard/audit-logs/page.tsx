"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Filter, Inbox, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoChip } from "@/components/ui/status-chip";
import { TickTag } from "@/components/ui/tick-tag";
import { SectionHeader } from "@/components/ui/section-header";
import { AppSearchField } from "@/components/ui/app-search-field";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { AuditEntryCard } from "@/components/audit/audit-entry-card";
import { AuditRangePicker, UndoConfirmDialog } from "@/components/audit/audit-dialogs";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/lib/use-timezone";
import { todayInZone } from "@/lib/tz";
import { undoAuditLog } from "@/lib/db";
import {
  AUDIT_MAX_WINDOW, AUDIT_PAGE_SIZE, dayKeyBack, dayKeyMonthsBack, fetchAuditPage, rangeLabel,
  type AuditFilters, type AuditLog, type AuditPage,
} from "@/lib/api/audit-logs";

// db.ts imports the row type from here; it now lives with the fetchers.
export type { AuditLog } from "@/lib/api/audit-logs";

// Mirrors the backend Audit_log_category enum (+ "All").
const CATEGORIES = ["All", "General", "Bill", "Orders", "Valet", "Inventory", "Tables", "Roles", "Customer", "Bookings", "Menu"];

const PRESETS = ["All time", "Today", "Last 7 days", "Last 30 days", "Last 3 months", "A day…", "A range…"];
const DAY_PRESET = 5;
const RANGE_PRESET = 6;

// "Undo Audited Action". The server independently re-checks this *and* the
// original action's own permission — this is only a UI convenience filter.
const UNDO_PERMISSION_ID = "6f2a4c81-9d35-4b7e-a0c2-5e8b1d3f7a94";

interface FirstPage extends AuditPage { key: string }
/** Rows scrolled in on top of the first page it was built from. */
interface TrailWindow {
  base: FirstPage;
  rows: AuditLog[];
  total: number;
  hasMore: boolean;
  appendError: string;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function AuditLogsPage(): React.JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  // An audit trail whose times drift with the reader's browser is not a trail.
  const { timezone } = useTimezone();
  const rid = user?.restaurantUsername ?? "";

  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState(0);
  const [picker, setPicker] = useState<"day" | "range" | null>(null);
  const [confirmLog, setConfirmLog] = useState<AuditLog | null>(null);

  // Only Undo is gated (Flutter `_mayUndo`); reading the trail follows the nav.
  const isAdmin = user?.role === "admin" || (Array.isArray(user?.role_all) && user.role_all.includes("admin"));
  const mayUndo = (
    isAdmin ||
    (Array.isArray(user?.actions_set) && (user.actions_set.includes("*") || user.actions_set.includes(UNDO_PERMISSION_ID)))
  );
  const hasFilters = category !== "All" || search !== "" || from !== "" || to !== "";

  const filters: AuditFilters = useMemo(() => ({ category, search, from, to }), [category, search, from, to]);
  const key = `audit:${rid}:${timezone}:${category}:${search}:${from}:${to}`;

  const first = useCachedFetch<FirstPage>(
    key,
    useCallback(
      async () => ({ ...(await fetchAuditPage(rid, filters, timezone, 0)), key }),
      [rid, filters, timezone, key],
    ),
    { enabled: rid.length > 0 },
  );
  // A payload built for other filters never stands under these ones.
  const payload = first.data?.key === key ? first.data : null;

  const [win, setWin] = useState<TrailWindow | null>(null);
  const view: TrailWindow | null = payload
    ? win?.base === payload
      ? win
      : { base: payload, rows: payload.logs, total: payload.total, hasMore: payload.hasMore, appendError: "" }
    : null;
  const viewRef = useRef(view);
  viewRef.current = view;

  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [reloading, setReloading] = useState(false);

  // Next page: offset = rows already held; id de-dupe against mid-scroll inserts.
  const loadMore = useCallback(async () => {
    const cur = viewRef.current;
    if (!rid || !cur || !cur.hasMore || loadingMoreRef.current) { return; }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchAuditPage(rid, filters, timezone, cur.rows.length);
      const seen = new Set(cur.rows.map((l) => l.id));
      const fresh = page.logs.filter((l) => !seen.has(l.id));
      setWin({
        base: cur.base,
        rows: fresh.length ? [...cur.rows, ...fresh] : cur.rows,
        total: page.total,
        // No new rows means the offset can never advance — stop rather than spin.
        hasMore: fresh.length > 0 && page.hasMore,
        appendError: "",
      });
    } catch (e) {
      setWin({ ...cur, hasMore: false, appendError: errText(e) });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [rid, filters, timezone]);

  // Infinite scroll.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const rowCount = view?.rows.length ?? 0;
  const canAppend = view?.hasMore === true;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !canAppend) { return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { void loadMore(); } },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, [loadMore, canAppend, rowCount]);

  /* ── Filters: instant for chips/presets; the search box debounces itself ── */

  const applyPreset = (i: number): void => {
    if (i === DAY_PRESET) { setPicker("day"); return; }
    if (i === RANGE_PRESET) { setPicker("range"); return; }
    const today = todayInZone(timezone);
    setPreset(i);
    if (i === 0) { setFrom(""); setTo(""); }
    if (i === 1) { setFrom(today); setTo(today); }
    if (i === 2) { setFrom(dayKeyBack(6, timezone)); setTo(today); }
    if (i === 3) { setFrom(dayKeyBack(29, timezone)); setTo(today); }
    if (i === 4) { setFrom(dayKeyMonthsBack(3, timezone)); setTo(today); }
  };

  const clearFilters = (): void => {
    setCategory("All"); setSearch(""); setFrom(""); setTo(""); setPreset(0);
    setSearchKey((k) => k + 1);
  };

  // After an undo, re-read exactly the window scrolled in (one request) so the
  // "Undone" chip and the new "Undid:" entry appear in place.
  const refreshLoaded = async (): Promise<void> => {
    const cur = viewRef.current;
    const held = cur?.rows.length ?? 0;
    if (!cur || held === 0 || held > AUDIT_MAX_WINDOW) { first.refresh(); return; }
    setReloading(true);
    try {
      const page = await fetchAuditPage(rid, filters, timezone, 0, held);
      setWin({ base: cur.base, rows: page.logs, total: page.total, hasMore: page.hasMore, appendError: "" });
    } catch {
      first.refresh();
    } finally {
      setReloading(false);
    }
  };

  // Flutter closes the dialog on confirm, then reports by snackbar.
  const performUndo = async (log: AuditLog): Promise<void> => {
    setConfirmLog(null);
    try {
      const result = await undoAuditLog(rid, log.id);
      if (result.ok) {
        toast({ title: `Undone: ${log.action}.` });
        await refreshLoaded();
      } else {
        toast({ title: result.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: errText(e), variant: "destructive" });
    }
  };

  const today = todayInZone(timezone);
  const total = view?.total ?? 0;
  const loaded = view?.rows.length ?? 0;
  const busyAgain = reloading || (first.fromCache && !first.offline && view != null);

  /* ── Body ─────────────────────────────────────────────────────────────── */

  let body: React.ReactNode;
  if (first.loading && !view) {
    body = (
      <div aria-busy="true" className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => <SkeletonBox key={i} height={54} className="rounded-lg" />)}
      </div>
    );
  } else if (!view) {
    body = (
      <LoadErrorState
        whatFailed="Couldn't load the audit trail"
        error={first.error ?? new Error("Couldn't load the audit trail.")}
        onRetry={first.retry}
      />
    );
  } else if (view.rows.length === 0) {
    body = (
      <EmptyState
        icon={<Inbox />}
        title="Nothing to show"
        caption={hasFilters
          ? "No entries match these filters — try a wider date range or another category."
          : "No audit entries yet."}
      />
    );
  } else {
    body = (
      <>
        <div className="space-y-2">
          {view.rows.map((log) => (
            <AuditEntryCard key={log.id} log={log} timeZone={timezone} mayUndo={mayUndo} onUndo={setConfirmLog} />
          ))}
        </div>
        <div ref={view.hasMore ? sentinelRef : undefined} className="flex justify-center py-4 text-xs">
          {loadingMore ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-[13px] w-[13px] animate-spin" /> Loading the next {AUDIT_PAGE_SIZE}…
            </span>
          ) : view.appendError ? (
            <span className="text-destructive">{view.appendError}</span>
          ) : view.hasMore ? (
            <Button variant="outline" size="sm" onClick={() => { void loadMore(); }}>
              <ChevronDown /> Load more ({loaded} of {total})
            </Button>
          ) : (
            <span className="text-muted-foreground">All {total} shown</span>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="relative space-y-3 p-1">
      <SectionHeader
        title="Audit trail"
        count={view ? total : undefined}
        trailing={loaded > 0 && loaded < total ? <TickTag label={`${loaded} loaded`} /> : undefined}
        className="mb-2"
      />

      <AppSearchField
        key={searchKey}
        placeholder="Filter by action, employee, or detail…"
        debounceMs={300}
        onQuery={setSearch}
      />

      <div className="space-y-2">
        <div className="-mx-1 overflow-x-auto px-1">
          <Tabs value={String(preset)} onValueChange={(v) => { applyPreset(Number(v)); }}>
            <TabsList>
              {PRESETS.map((label, i) => (
                <TabsTrigger
                  key={label}
                  value={String(i)}
                  // The pickers open on every press — a selected "A day…" can
                  // be re-picked — and a cancel leaves the old pill selected.
                  onMouseDown={i >= DAY_PRESET ? (e) => { e.preventDefault(); applyPreset(i); } : undefined}
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InfoChip icon={<CalendarDays />} label={rangeLabel(from, to)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Filter by category" className="rounded-[7px] outline-none focus-visible:ring-1 focus-visible:ring-accent-hi">
                <InfoChip icon={<Filter />} label={category === "All" ? "All categories" : category} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {CATEGORIES.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c}
                  checked={category === c}
                  onCheckedChange={() => { setCategory(c); }}
                >
                  {c === "All" ? "All categories" : c}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X /> Clear filters
            </Button>
          )}
          {busyAgain && <span className="text-xs text-muted-foreground">Reloading…</span>}
        </div>
      </div>

      <div className="pt-1">{body}</div>

      <AuditRangePicker
        mode={picker}
        first={dayKeyMonthsBack(36, timezone)}
        last={today}
        seedFrom={from || (picker === "range" ? dayKeyBack(6, timezone) : today)}
        seedTo={to || today}
        onCancel={() => { setPicker(null); }}
        onPick={(f, t) => {
          setPreset(picker === "range" ? RANGE_PRESET : DAY_PRESET);
          setFrom(f); setTo(t); setPicker(null);
        }}
      />

      <UndoConfirmDialog
        log={confirmLog}
        timeZone={timezone}
        onCancel={() => { setConfirmLog(null); }}
        onConfirm={(log) => { void performUndo(log); }}
      />

      <CacheStalePill offline={first.offline} fromCache={first.fromCache} updatedAt={first.updatedAt} />
    </div>
  );
}
