"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { getAuditLogs, undoAuditLog } from '@/lib/db';
import { useToast } from "@/hooks/use-toast";

export type AuditLog = {
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
};

// Mirrors the backend Audit_log_category enum (+ "All").
const CATEGORIES = ["All", "General", "Bill", "Orders", "Valet", "Inventory", "Tables", "Roles", "Customer", "Bookings", "Menu"];

// "Undo Audited Action". The server independently re-checks this *and* the
// original action's own permission — this is only a UI convenience filter.
const UNDO_PERMISSION_ID = '6f2a4c81-9d35-4b7e-a0c2-5e8b1d3f7a94';

export default function AuditLogsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [confirmLog, setConfirmLog] = useState<AuditLog | null>(null);
  const [undoing, setUndoing] = useState(false);
  const hasShownAccessToastRef = useRef(false);

  const isAdmin = user?.role === 'admin' || (Array.isArray(user?.role_all) && user.role_all.includes('admin'));
  // Admins always qualify; otherwise the employee must hold the undo action.
  const canUndo = Boolean(
    isAdmin ||
    (Array.isArray(user?.actions_set) && (user.actions_set.includes('*') || user.actions_set.includes(UNDO_PERMISSION_ID)))
  );
  const hasFilters = category !== 'All' || Boolean(search) || Boolean(from) || Boolean(to);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await getAuditLogs(user.restaurantUsername, {
        limit,
        category,
        search: search.trim() || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      });
      setLogs(rows);
    } catch (e: any) {
      toast({ title: "Couldn't load audit logs", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, limit, category, search, from, to, toast]);

  // Debounced fetch — reruns whenever any filter (or the load-more limit) changes.
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
  }, [load, isAdmin]);

  useEffect(() => {
    if (!user || isAdmin || hasShownAccessToastRef.current) return;
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

  const resetFilters = () => { setCategory('All'); setSearch(''); setFrom(''); setTo(''); setLimit(100); };

  const performUndo = async () => {
    if (!user || !confirmLog) return;
    setUndoing(true);
    try {
      const result = await undoAuditLog(user.restaurantUsername, confirmLog.id);
      if (result.ok) {
        toast({ title: 'Action undone', description: `Reversed: ${confirmLog.action}.` });
        setConfirmLog(null);
        await load();
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
        <h1 className="text-lg font-semibold md:text-2xl">Audit Logs</h1>
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
                onChange={(e) => { setCategory(e.target.value); setLimit(100); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(100); }} placeholder="Employee, action, or details…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setLimit(100); }} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setLimit(100); }} />
            </div>
          </div>
          {hasFilters ? (
            <div className="mb-3 flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={resetFilters}>Clear filters</Button>
              {loading ? <span className="text-xs text-muted-foreground">Searching…</span> : <span className="text-xs text-muted-foreground">{logs.length} result{logs.length === 1 ? "" : "s"}</span>}
            </div>
          ) : null}

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
                    <TableCell className="whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</TableCell>
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
                        <Button variant="outline" size="sm" onClick={() => setConfirmLog(log)}>Undo</Button>
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
                      {loading ? "Loading…" : "No matching activity."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          {logs.length >= limit ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" disabled={loading} onClick={() => setLimit((l) => l + 100)}>
                {loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={confirmLog !== null} onOpenChange={(open) => { if (!open && !undoing) setConfirmLog(null); }}>
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
                    <div><span className="text-muted-foreground">When: </span><span className="font-medium">{new Date(confirmLog.timestamp).toLocaleString()}</span></div>
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
