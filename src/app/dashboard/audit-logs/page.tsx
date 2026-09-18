"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from '@/context/AuthContext';
import { getAuditLogPage, undoAuditLog } from '@/lib/db';
import { useToast } from "@/hooks/use-toast";
import { formatDateTime, formatFullDateTime, timezoneCaption } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";

export interface AuditLog {
  id: string;
  employee: string;
  action: string;
  category: string;
  details: string;
  timestamp: string;
  // Additive undo metadata from GET /audit-logs.
  undoable?: boolean;
  undo_block_reason?: string | null;
  undone?: boolean;
  undo_log_id?: string | null;
  undo_of?: string | null;
}

// Mirrors the backend Audit_log_category enum (+ "All").
const CATEGORIES = ["All", "General", "Bill", "Orders", "Valet", "Inventory", "Tables", "Roles", "Customer", "Bookings", "Menu"];

// "Undo Audited Action". The server independently re-checks this *and* the
// original action's own permission — this is only a UI convenience filter.
const UNDO_PERMISSION_ID = '6f2a4c81-9d35-4b7e-a0c2-5e8b1d3f7a94';

// Rows per fetch. The log runs to thousands of entries, so the page pulls one
// batch at a time and appends as the sentinel below the table scrolls into view.
const PAGE_SIZE = 50;

export default function AuditLogsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  // An audit trail whose times drift with the reader's browser is not a trail.
  const { timezone } = useTimezone();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmLog, setConfirmLog] = useState<AuditLog | null>(null);
  const [undoing, setUndoing] = useState(false);
  const hasShownAccessToastRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Mirrors `logs` so loadMore can read the current offset without being
  // re-created (and re-triggering the observer) on every append.
  const logsRef = useRef<AuditLog[]>([]);
  const loadingMoreRef = useRef(false);
  useEffect(() => { logsRef.current = logs; }, [logs]);

  const isAdmin = user?.role === 'admin' || (Array.isArray(user?.role_all) && user.role_all.includes('admin'));
  // Admins always qualify; otherwise the employee must hold the undo action.
  const canUndo = Boolean(
    isAdmin ||
    (Array.isArray(user?.actions_set) && (user.actions_set.includes('*') || user.actions_set.includes(UNDO_PERMISSION_ID)))
  );
  const hasFilters = category !== 'All' || Boolean(search) || Boolean(from) || Boolean(to);

  const filters = useMemo(() => ({
    category,
    search: search.trim() || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  }), [category, search, from, to]);

  const rid = user?.restaurantUsername;

  // First page. Debounced, and re-run from offset 0 whenever a filter changes —
  // which also discards everything already scrolled in, so a filtered view can
  // never show rows that no longer match.
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    if (!rid || !isAdmin) {return;}
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      void getAuditLogPage(rid, { ...filters, limit: PAGE_SIZE, offset: 0 })
        .then((page) => {
          if (!active) {return;}
          if (!page) {
            setLoadError("Couldn't load audit logs. Check your connection and try again.");
            setLogs([]); setTotal(0); setHasMore(false);
            return;
          }
          setLoadError(null);
          setLogs(page.logs);
          setTotal(page.total);
          setHasMore(page.has_more);
        })
        .finally(() => { if (active) {setLoading(false);} });
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [rid, isAdmin, filters, reloadToken]);

  // Next page. Offset = rows already held, and the server orders by
  // (created_at desc, id desc) — a total order — so pages cannot overlap or skip.
  // The id de-dupe is belt-and-braces for an entry written mid-scroll.
  const loadMore = useCallback(async () => {
    if (!rid || loadingMoreRef.current) {return;}
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getAuditLogPage(rid, { ...filters, limit: PAGE_SIZE, offset: logsRef.current.length });
      if (!page) {
        setLoadError("Couldn't load more entries.");
        setHasMore(false);
        return;
      }
      const seen = new Set(logsRef.current.map((l) => l.id));
      const fresh = page.logs.filter((l) => !seen.has(l.id));
      setTotal(page.total);
      // No new rows means the offset can never advance — stop rather than spin.
      if (fresh.length === 0) { setHasMore(false); return; }
      setLogs((prev) => [...prev, ...fresh]);
      setHasMore(page.has_more);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [rid, filters]);

  // Infinite scroll. Re-created after every append so that, if the sentinel is
  // still on screen (short list / tall window), the next batch fires immediately.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) {return;}
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { void loadMore(); } },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, [loadMore, hasMore, loading, logs.length]);

  useEffect(() => {
    if (!user || isAdmin || hasShownAccessToastRef.current) {return;}
    toast({
      title: 'Access denied',
      description: 'You do not have the required role for this page. Required role: admin.',
      variant: 'destructive',
    });
    hasShownAccessToastRef.current = true;
  }, [user, isAdmin, toast]);

  if (!isAdmin) {
    return (
      <div className="p-4">
        <p>You do not have permission to view this page. Required role: admin.</p>
      </div>
    );
  }

  const resetFilters = () => { setCategory('All'); setSearch(''); setFrom(''); setTo(''); };

  // After an undo, re-read exactly the window the user has scrolled in (one
  // request) so the "Undone" badge and the new undo entry appear without
  // throwing them back to the top. Falls back to a full reload past the
  // server's 500-row page cap.
  const refreshLoaded = async () => {
    const held = logsRef.current.length;
    if (!rid || held === 0 || held > 500) { setReloadToken((t) => t + 1); return; }
    const page = await getAuditLogPage(rid, { ...filters, limit: held, offset: 0 });
    if (!page) { setReloadToken((t) => t + 1); return; }
    setLogs(page.logs);
    setTotal(page.total);
    setHasMore(page.has_more);
  };

  const performUndo = async () => {
    if (!user || !confirmLog) {return;}
    setUndoing(true);
    try {
      const result = await undoAuditLog(user.restaurantUsername, confirmLog.id);
      if (result.ok) {
        toast({ title: 'Action undone', description: `Reversed: ${confirmLog.action}.` });
        setConfirmLog(null);
        await refreshLoaded();
      } else {
        // The backend's message is already human-readable — show it verbatim.
        toast({ title: "Couldn't undo", description: result.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: "Couldn't undo", description: String(e?.message ?? e), variant: 'destructive' });
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Audit Logs</h1>
          <p className="text-xs text-muted-foreground">
            All times in restaurant time · {timezoneCaption(timezone)}
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
          <CardDescription>
            A log of all actions performed by employees. Filter by category, date, or search across employee, action, and details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
              <Input value={search} onChange={(e) => { setSearch(e.target.value); }} placeholder="Employee, action, or details…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); }} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); }} />
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {hasFilters ? <Button variant="ghost" size="sm" onClick={resetFilters}>Clear filters</Button> : null}
            <span className="text-xs text-muted-foreground">
              {loading
                ? (hasFilters ? "Searching…" : "Loading…")
                : `Showing ${logs.length} of ${total} entr${total === 1 ? "y" : "ies"}`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Undo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap tabular-nums" title={formatFullDateTime(log.timestamp, timezone)}>{formatDateTime(log.timestamp, timezone)}</TableCell>
                    <TableCell className="font-medium">{log.employee}</TableCell>
                    <TableCell><Badge variant="outline">{log.category}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{log.action}</Badge>
                        {log.undone ? <Badge variant="outline" className="text-muted-foreground">Undone</Badge> : null}
                        {log.undo_of ? <Badge variant="outline" className="text-muted-foreground">Undo</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>{log.details}</TableCell>
                    <TableCell className="text-right">
                      {log.undone || log.undo_of ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : log.undoable && canUndo ? (
                        <Button variant="outline" size="sm" onClick={() => { setConfirmLog(log); }}>Undo</Button>
                      ) : !log.undoable && log.undo_block_reason ? (
                        <span className="text-xs text-muted-foreground" title={log.undo_block_reason}>
                          {log.undo_block_reason}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {loading ? "Loading…" : loadError ?? "No matching activity."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          {/* Infinite-scroll foot: the sentinel the observer watches, the loading
              row while a batch is in flight, and the end-of-list marker. */}
          {logs.length > 0 && !loading ? (
            hasMore ? (
              <div ref={sentinelRef} className="mt-4 flex flex-col items-center gap-2 py-4">
                <span className="text-sm text-muted-foreground">
                  {loadingMore ? "Loading more…" : `Loading the next ${PAGE_SIZE}…`}
                </span>
                {/* Fallback for anything the observer misses (or a user who'd rather click). */}
                <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => { void loadMore(); }}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : (
              <p className="mt-4 py-4 text-center text-sm text-muted-foreground">
                {loadError ?? `End of list — all ${logs.length} matching entr${logs.length === 1 ? "y" : "ies"} loaded.`}
              </p>
            )
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={confirmLog !== null} onOpenChange={(open) => { if (!open && !undoing) {setConfirmLog(null);} }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this action?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This reverses the action below. The original entry is kept, and a new audit entry recording the undo is added.</p>
                {confirmLog ? (
                  <div className="rounded-md border p-3 text-sm">
                    <div><span className="text-muted-foreground">Action: </span><span className="font-medium">{confirmLog.action}</span></div>
                    <div><span className="text-muted-foreground">By: </span><span className="font-medium">{confirmLog.employee}</span></div>
                    <div><span className="text-muted-foreground">When: </span><span className="font-medium">{formatFullDateTime(confirmLog.timestamp, timezone)}</span></div>
                    {confirmLog.details ? <div className="mt-1 text-muted-foreground">{confirmLog.details}</div> : null}
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoing}
              onClick={(e) => { e.preventDefault(); void performUndo(); }}
            >
              {undoing ? 'Undoing…' : 'Undo action'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
