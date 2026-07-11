"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from '@/context/AuthContext';
import { getAuditLogs } from '@/lib/db';
import { useToast } from "@/hooks/use-toast";

export type AuditLog = {
  id: string;
  employee: string;
  action: string;
  category: string;
  details: string;
  timestamp: string;
};

// Mirrors the backend Audit_log_category enum (+ "All").
const CATEGORIES = ["All", "General", "Bill", "Orders", "Valet", "Inventory", "Tables", "Roles", "Customer", "Bookings", "Menu"];

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
  const hasShownAccessToastRef = useRef(false);

  const isAdmin = user?.role === 'admin';
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</TableCell>
                    <TableCell className="font-medium">{log.employee}</TableCell>
                    <TableCell><Badge variant="outline">{log.category}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{log.action}</Badge></TableCell>
                    <TableCell>{log.details}</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
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
    </div>
  );
}
