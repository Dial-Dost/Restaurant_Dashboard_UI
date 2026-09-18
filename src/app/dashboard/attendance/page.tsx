"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { daysAgoInZone, formatDateTime, formatTime, todayInZone } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import type {
  MyAttendance,
  AttendanceSummaryRow,
  PendingClockIn} from "@/lib/db";
import {
  reviewClockIn,
  getMyAttendance,
  clockIn,
  clockOut,
  getAttendanceSummary,
} from "@/lib/db";

const fmtMinutes = (m: number) => {
  const mins = Math.max(0, Math.round(m));
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

export default function AttendancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  // A shift that starts at 22:00 and ends at 02:00 belongs to the restaurant's
  // day, not UTC's — the old `toISOString().slice(0, 10)` split those in two.
  const todayIso = useCallback(() => todayInZone(timezone), [timezone]);
  const daysAgoIso = useCallback((n: number) => daysAgoInZone(n, timezone), [timezone]);
  const restaurantId = user?.restaurantUsername ?? "";

  const isManager = useMemo(() => {
    if (!user) {return false;}
    const roles = [user.role, ...(Array.isArray(user.role_all) ? user.role_all : [])];
    return roles.includes("admin") || roles.includes("manager");
  }, [user]);

  const [me, setMe] = useState<MyAttendance | null>(null);
  const [busy, setBusy] = useState(false);

  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<AttendanceSummaryRow[]>([]);
  const [pending, setPending] = useState<PendingClockIn[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const loadMe = useCallback(async () => {
    if (!restaurantId) {return;}
    try {
      setMe(await getMyAttendance(restaurantId));
    } catch {
      setMe(null);
    }
  }, [restaurantId]);

  const loadSummary = useCallback(async () => {
    if (!restaurantId || !isManager) {return;}
    setSummaryLoading(true);
    try {
      const res = await getAttendanceSummary(restaurantId, from, to);
      setRows(res.rows);
      setPending(res.pending ?? []);
    } catch {
      setRows([]);
      setPending([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [restaurantId, isManager, from, to]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const toggleClock = async () => {
    if (!restaurantId || !me) {return;}
    setBusy(true);
    try {
      const ok = me.clocked_in ? await clockOut(restaurantId) : await clockIn(restaurantId);
      if (!ok) {
        toast({ title: "Couldn't update attendance", variant: "destructive" });
      } else {
        toast({ title: me.clocked_in ? "Clocked out" : "Clocked in" });
      }
      await loadMe();
      await loadSummary();
    } finally {
      setBusy(false);
    }
  };

  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);

  return (
    <div className="grid gap-4 md:gap-8">
      <h1 className="text-lg font-semibold md:text-2xl">Attendance</h1>

      {/* My attendance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> My shift
          </CardTitle>
          <CardDescription>Clock in when you start and out when you finish.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            {me?.clocked_in ? (
              <p className="text-sm">
                <span className="font-medium text-green-600">Clocked in</span>
                {me.since ? ` since ${formatTime(me.since, timezone)}` : ""}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not clocked in</p>
            )}
            <p className="text-2xl font-semibold">{fmtMinutes(me?.today_minutes ?? 0)} <span className="text-sm font-normal text-muted-foreground">today</span></p>
            {me?.pending_approval ? (
              <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">⏳ Awaiting admin approval — your clock-in time is already recorded.</p>
            ) : null}
          </div>
          <Button onClick={() => void toggleClock()} disabled={busy || !me} variant={me?.clocked_in ? "destructive" : "default"}>
            {me?.clocked_in ? <LogOut className="mr-2 h-4 w-4" /> : <LogIn className="mr-2 h-4 w-4" />}
            {me?.clocked_in ? "Clock out" : "Clock in"}
          </Button>
        </CardContent>
      </Card>

      {/* Pending clock-in approvals (admin/manager) */}
      {isManager && pending.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="text-base">Pending clock-in approvals ({pending.length})</CardTitle>
            <CardDescription>Approving keeps the employee&apos;s original clock-in time — approval never changes when they clocked in.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-amber-50/50 p-2 text-sm dark:bg-amber-950/20">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Clocked in {formatDateTime(p.clock_in, timezone)}
                    {p.clock_out ? ` → out ${formatTime(p.clock_out, timezone)}` : " · still on shift"}
                  </p>
                </div>
                <Button size="sm" onClick={async () => { try { await reviewClockIn(restaurantId, p.id, true); toast({ title: "Clock-in approved" }); await loadSummary(); } catch (e: any) { toast({ title: "Couldn't approve", description: String(e?.message ?? e), variant: "destructive" }); } }}>Approve</Button>
                <Button size="sm" variant="outline" onClick={async () => { try { await reviewClockIn(restaurantId, p.id, false); toast({ title: "Clock-in rejected" }); await loadSummary(); } catch (e: any) { toast({ title: "Couldn't reject", description: String(e?.message ?? e), variant: "destructive" }); } }}>Reject</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Team hours (admin/manager) */}
      {isManager && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="text-base">Team hours</CardTitle>
              <CardDescription>Worked hours per employee over the selected range.</CardDescription>
            </div>
            <div className="flex items-end gap-2 max-sm:w-full max-sm:flex-wrap max-sm:justify-end">
              <div className="grid min-w-0 flex-[1_1_9rem] gap-1 sm:flex-none">
                <label className="text-xs text-muted-foreground">From</label>
                <Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); }} className="h-9 w-full sm:w-[150px]" />
              </div>
              <div className="grid min-w-0 flex-[1_1_9rem] gap-1 sm:flex-none">
                <label className="text-xs text-muted-foreground">To</label>
                <Input type="date" value={to} min={from} max={todayIso()} onChange={(e) => { setTo(e.target.value); }} className="h-9 w-full sm:w-[150px]" />
              </div>
              <Button variant="outline" size="icon" onClick={() => void loadSummary()} disabled={summaryLoading} aria-label="Refresh">
                <RefreshCw className={`h-4 w-4 ${summaryLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Shifts</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      {summaryLoading ? "Loading…" : "No attendance recorded for this range."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.emp_id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{r.shifts}</TableCell>
                      <TableCell className="text-right">{fmtMinutes(r.minutes)}</TableCell>
                      <TableCell className="text-right">
                        {r.open ? <Badge variant="secondary">on shift</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {rows.length > 0 && (
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">{rows.reduce((s, r) => s + r.shifts, 0)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMinutes(totalMinutes)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
