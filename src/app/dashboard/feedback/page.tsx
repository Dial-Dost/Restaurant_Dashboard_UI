"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import QRCode from "qrcode";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/context/RealtimeContext";
import { useToast } from "@/hooks/use-toast";
import { requestBackend } from "@/lib/db";

type FeedbackCategoryRating = {
  key: string;
  label: string;
  rating: number;
  question?: string | null;
  follow_up?: string | null;
};

type FeedbackEntry = {
  id: string;
  restaurant_id: string;
  employee_id: string;
  customer_name?: string | null;
  visit_date?: string | null;
  comments?: string | null;
  overall_rating?: number | null;
  category_ratings: FeedbackCategoryRating[];
  image_theme?: { background: string; surface: string; text: string; accent: string } | null;
  source?: string | null;
  submitted_at: string;
};

type FeedbackSummary = {
  totalResponses: number;
  averageRating: number | null;
  categoryAverages: Record<string, { label: string; average: number | null }>;
  last30DaysResponses: number;
};

function formatDate(input?: string | null): string {
  if (!input) {
    return "Unknown";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [employeesMap, setEmployeesMap] = useState<Record<string, { name: string; role?: string }>>({});
  // Raw employee list (kept alongside employeesMap) so we can build a per-employee feedback QR.
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeQrMap, setEmployeeQrMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const { lastEvent } = useRealtime();
  const [stats, setStats] = useState<{ daily?: any; weekly?: any; overall?: Array<any>; monthly?: any; yearly?: any } | null>(null);
  const [dailyDate, setDailyDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [weeklyStart, setWeeklyStart] = useState<string>(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = (day + 6) % 7; // days since Monday
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  });
  const [monthlyStart, setMonthlyStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [yearlyYear, setYearlyYear] = useState<number>(() => new Date().getFullYear());

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!user?.restaurantUsername) {
        setLoading(false);
        return;
      }

      const base =
        process.env.NEXT_PUBLIC_BACKEND_URL ?? (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : '');
      try {
        const [itemsRes, summaryRes] = await Promise.all([
          requestBackend<{ items?: FeedbackEntry[] }>({
            baseUrl: base,
            path: `/feedback?limit=100`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          }),
          requestBackend<FeedbackSummary>({
            baseUrl: base,
            path: `/feedback/summary`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          }),
        ]);

        console.log("Fetched feedback data", { itemsRes, summaryRes });

        const feedbackRows = itemsRes.ok ? itemsRes.data?.items ?? [] : [];
        const feedbackSummary = summaryRes.ok ? summaryRes.data : null;
        const usersRes = await requestBackend<{ users?: any[] }>({
          baseUrl: base,
          path: `/restaurant/users`,
          restaurantId: user.restaurantUsername,
          employeeId: user.employeeId,
          outletId: user.outlet_id,
        });
        const usersPayload = usersRes.ok ? usersRes.data : { users: [] };
        const usersList = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
        const map: Record<string, { name: string; role?: string }> = {};
        for (const u of usersList) {
          const fname = String(u?.emp_Fname ?? u?.first_name ?? u?.employeeId ?? u?.id ?? "Unknown");
          const lname = String(u?.emp_Lname ?? u?.last_name ?? "");
          const name = `${fname}${lname ? ` ${lname}` : ""}`;
          const role = String(u?.role ?? "");
          const keys = [u?.employeeId, u?.id, u?.employee_id].filter(Boolean as any);
          for (const k of keys) {
            map[String(k)] = { name, role };
          }
        }
        setEmployeesMap(map);
        setEmployees(usersList);
        // debug: log users payload and built map to help diagnose missing names
        try {
          console.debug("feedback: usersList", usersList);
          console.debug("feedback: employeesMap keys", Object.keys(map));
        } catch (e) {
          // ignore in environments without console
        }

        if (!active) return;

        setEntries(feedbackRows as FeedbackEntry[]);
        setSummary(feedbackSummary as FeedbackSummary | null);
        const statsDailyRes = await requestBackend<any>({
          baseUrl: base,
          path: `/feedback/stats?mode=daily&date=${dailyDate}`,
          restaurantId: user.restaurantUsername,
          employeeId: user.employeeId,
          outletId: user.outlet_id,
        });
        const statsWeeklyRes = await requestBackend<any>({
          baseUrl: base,
          path: `/feedback/stats?mode=weekly&weekStart=${weeklyStart}`,
          restaurantId: user.restaurantUsername,
          employeeId: user.employeeId,
          outletId: user.outlet_id,
        });
        const statsMonthlyRes = await requestBackend<any>({
          baseUrl: base,
          path: `/feedback/stats?mode=monthly&start=${monthlyStart}`,
          restaurantId: user.restaurantUsername,
          employeeId: user.employeeId,
          outletId: user.outlet_id,
        });
        const statsYearlyRes = await requestBackend<any>({
          baseUrl: base,
          path: `/feedback/stats?mode=yearly&year=${yearlyYear}`,
          restaurantId: user.restaurantUsername,
          employeeId: user.employeeId,
          outletId: user.outlet_id,
        });
        const statsDaily = statsDailyRes.ok ? statsDailyRes.data : null;
        const statsWeekly = statsWeeklyRes.ok ? statsWeeklyRes.data : null;
        const statsMonthly = statsMonthlyRes.ok ? statsMonthlyRes.data : null;
        const statsYearly = statsYearlyRes.ok ? statsYearlyRes.data : null;
        setStats({ daily: statsDaily, weekly: statsWeekly, monthly: statsMonthly, yearly: statsYearly });
      } finally {
        if (active) setLoading(false);
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [user?.restaurantUsername, user?.employeeId, user?.outlet_id, dailyDate, weeklyStart, monthlyStart, yearlyYear]);

  useEffect(() => {
    if (!user?.restaurantUsername) return;
    if (!lastEvent) return;
    if (lastEvent.event && lastEvent.event.startsWith('feedback')) {
      // Re-fetch when feedback changes
      (async () => {
        setLoading(true);
        const base =
          process.env.NEXT_PUBLIC_BACKEND_URL ?? (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : '');
        try {
          const itemsRes = await requestBackend<{ items?: FeedbackEntry[] }>({
            baseUrl: base,
            path: `/feedback?limit=100`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          });
          const summaryRes = await requestBackend<FeedbackSummary>({
            baseUrl: base,
            path: `/feedback/summary`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          });
          const feedbackRows = itemsRes.ok ? itemsRes.data?.items ?? [] : [];
          const feedbackSummary = summaryRes.ok ? summaryRes.data : null;
          // re-fetch stats windows
          const statsDailyRes = await requestBackend<any>({
            baseUrl: base,
            path: `/feedback/stats?mode=daily&date=${dailyDate}`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          });
          const statsWeeklyRes = await requestBackend<any>({
            baseUrl: base,
            path: `/feedback/stats?mode=weekly&weekStart=${weeklyStart}`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          });
          const statsMonthlyRes = await requestBackend<any>({
            baseUrl: base,
            path: `/feedback/stats?mode=monthly&start=${monthlyStart}`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          });
          const statsYearlyRes = await requestBackend<any>({
            baseUrl: base,
            path: `/feedback/stats?mode=yearly&year=${yearlyYear}`,
            restaurantId: user.restaurantUsername,
            employeeId: user.employeeId,
            outletId: user.outlet_id,
          });
          const statsDaily = statsDailyRes.ok ? statsDailyRes.data : null;
          const statsWeekly = statsWeeklyRes.ok ? statsWeeklyRes.data : null;
          const statsMonthly = statsMonthlyRes.ok ? statsMonthlyRes.data : null;
          const statsYearly = statsYearlyRes.ok ? statsYearlyRes.data : null;
          setEntries(feedbackRows as FeedbackEntry[]);
          setSummary(feedbackSummary as FeedbackSummary | null);
          setStats({ daily: statsDaily, weekly: statsWeekly, monthly: statsMonthly, yearly: statsYearly });
          // refresh employee list
          try {
            const usersRes = await requestBackend<{ users?: any[] }>({
              baseUrl: base,
              path: `/restaurant/users`,
              restaurantId: user.restaurantUsername,
              employeeId: user.employeeId,
              outletId: user.outlet_id,
            });
            const usersPayload = usersRes.ok ? usersRes.data : { users: [] };
            const usersList = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
            const map: Record<string, { name: string; role?: string }> = {};
            for (const u of usersList) {
              const fname = String(u?.emp_Fname ?? u?.first_name ?? u?.employeeId ?? u?.id ?? "Unknown");
              const lname = String(u?.emp_Lname ?? u?.last_name ?? "");
              const name = `${fname}${lname ? ` ${lname}` : ""}`;
              const role = String(u?.role ?? "");
              const keys = [u?.employeeId, u?.id, u?.employee_id].filter(Boolean as any);
              for (const k of keys) {
                map[String(k)] = { name, role };
              }
            }
            setEmployeesMap(map);
            setEmployees(usersList);
            try {
              console.debug("feedback: usersList (refetch)", usersList);
              console.debug("feedback: employeesMap keys (refetch)", Object.keys(map));
            } catch (e) {}
          } catch (err) {
            // ignore
          }
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [lastEvent, user?.restaurantUsername, user?.employeeId, user?.outlet_id, dailyDate, weeklyStart, monthlyStart, yearlyYear]);

  function shiftDate(iso: string, days: number) {
    // operate in UTC to avoid local timezone shifts
    const parts = iso.split("-").map((s) => parseInt(s, 10));
    if (parts.length !== 3 || parts.some(isNaN)) {
      // fallback to safe Date arithmetic
      const d = new Date(iso + "T00:00:00");
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }
    const [y, m, day] = parts;
    const utc = Date.UTC(y, m - 1, day + days);
    const d2 = new Date(utc);
    return d2.toISOString().slice(0, 10);
  }

  function shiftWeek(iso: string, weeks: number) {
    return shiftDate(iso, weeks * 7);
  }

  function shiftWeeks(iso: string, weeks: number) {
    return shiftDate(iso, weeks * 7);
  }

  function shiftMonth(iso: string, delta: number) {
    const parts = iso.split('-').map((s) => parseInt(s, 10));
    if (parts.length !== 3 || parts.some(isNaN)) {
      const d = new Date(iso + 'T00:00:00');
      d.setMonth(d.getMonth() + delta);
      d.setDate(1);
      return d.toISOString().slice(0, 10);
    }
    let [y, m] = parts;
    m = m - 1 + delta;
    const newDate = new Date(Date.UTC(y, m, 1));
    return newDate.toISOString().slice(0, 10);
  }

  function shiftYear(year: number, delta: number) {
    return year + delta;
  }

  function formatISODate(iso: string) {
    try {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString();
    } catch (_) {
      return iso;
    }
  }

  function formatMonthWeek(iso: string) {
    try {
      const d = new Date(iso + "T00:00:00");
      const month = d.toLocaleString(undefined, { month: "long" });
      const weekNo = Math.ceil(d.getDate() / 7);
      return `${month} W${weekNo}`;
    } catch (_) {
      return iso;
    }
  }

  function formatMonthlyLabel(iso: string) {
    try {
      const d = new Date(iso + "T00:00:00");
      const month = d.toLocaleString(undefined, { month: "long" });
      const year = d.getFullYear();
      return `${month} ${year}`;
    } catch (_) {
      return iso;
    }
  }

  const resolveEmployeeName = useCallback((employeeId: any) => {
    if (employeeId === undefined || employeeId === null) return null;
    const idStr = String(employeeId);
    if (employeesMap[idStr]?.name) return employeesMap[idStr].name;
    if (employeesMap[employeeId as any]?.name) return employeesMap[employeeId as any].name;
    const numeric = Number(employeeId);
    if (!Number.isNaN(numeric) && employeesMap[String(numeric)]?.name) return employeesMap[String(numeric)].name;
    return null;
  }, [employeesMap]);

  // Feedback form base URL — same resolution as settings-form: same-origin /feedback
  // by default, NEXT_PUBLIC_FEEDBACK_FORM_URL overrides, and a localhost placeholder is
  // auto-rewritten to the current host on deployed/forwarded hosts.
  const feedbackBase = useMemo(() => {
    const fallbackBase = typeof window !== "undefined" ? `${window.location.origin}/feedback` : "";
    const configuredBase = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "").trim();
    let baseUrl = configuredBase || fallbackBase;
    if (typeof window !== "undefined" && baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        const configuredHost = parsed.hostname.toLowerCase();
        const currentHost = window.location.hostname.toLowerCase();
        const isConfiguredLocal = configuredHost === "localhost" || configuredHost === "127.0.0.1";
        const isCurrentLocal = currentHost === "localhost" || currentHost === "127.0.0.1";
        if (isConfiguredLocal && !isCurrentLocal) {
          parsed.protocol = window.location.protocol;
          parsed.hostname = window.location.hostname;
          baseUrl = parsed.toString();
        }
      } catch {
        // ignore invalid env URL, keep fallback
      }
    }
    return baseUrl.replace(/\/$/, "");
  }, []);

  // Per-employee feedback link: {base}?rid=<restaurantUsername>&oid=<outlet_id>&eid=<Employees.id UUID>
  const empQrId = (emp: any) => String(emp?.id ?? emp?.employee_id ?? emp?.employeeId ?? "");
  const buildEmployeeFeedbackUrl = useCallback((eid: string) => {
    if (!feedbackBase || !user?.restaurantUsername || !eid) return "";
    const params = new URLSearchParams({
      rid: String(user.restaurantUsername),
      oid: String(user.outlet_id ?? ""),
      eid: String(eid),
    });
    return `${feedbackBase}?${params.toString()}`;
  }, [feedbackBase, user?.restaurantUsername, user?.outlet_id]);

  // Generate a QR data URL per employee (admin only — this card is admin-gated).
  useEffect(() => {
    let active = true;
    if (user?.role !== "admin" || employees.length === 0) {
      setEmployeeQrMap({});
      return;
    }
    (async () => {
      const map: Record<string, string> = {};
      for (const emp of employees) {
        const eid = empQrId(emp);
        const url = buildEmployeeFeedbackUrl(eid);
        if (!eid || !url) continue;
        try {
          map[eid] = await QRCode.toDataURL(url, { width: 220, margin: 2 });
        } catch {
          // skip this employee's QR on failure
        }
      }
      if (active) setEmployeeQrMap(map);
    })();
    return () => { active = false; };
  }, [employees, buildEmployeeFeedbackUrl, user?.role]);

  const monthlyChartData = (() => {
    const monthly = stats?.monthly;
    const overall = stats?.overall;
    if (monthly && Array.isArray(monthly.weeks)) {
      return monthly.weeks.map((d: any) => ({ name: d.label ?? `${d.start?.slice(5)} - ${d.end?.slice(5)}`, count: d.count }));
    }
    if (Array.isArray(overall)) return overall.map((d: any) => ({ name: d.month, count: d.count }));
    return [];
  })();

  const categoryRows = useMemo(() => {
    if (!summary) {
      return [];
    }
    return Object.entries(summary.categoryAverages).sort((a, b) => {
      const av = a[1].average ?? 0;
      const bv = b[1].average ?? 0;
      return bv - av;
    });
  }, [summary]);

  const employeeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      const id = (e as any).employee_id ?? "unknown";
      map[id] = (map[id] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([employeeId, count]) => ({
        employeeId,
        name: resolveEmployeeName(employeeId) ?? employeesMap[employeeId]?.name ?? String(employeeId ?? "Unknown"),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [entries, employeesMap, resolveEmployeeName]);

  const employeePerformance = useMemo(() => {
    const map: Record<string, { name: string; responses: number; total: number; ratedResponses: number }> = {};

    for (const entry of entries) {
      const employeeId = entry.employee_id ?? "unknown";
      if (!map[employeeId]) {
        map[employeeId] = {
          name: resolveEmployeeName(employeeId) ?? employeesMap[employeeId]?.name ?? String(employeeId ?? "Unknown"),
          responses: 0,
          total: 0,
          ratedResponses: 0,
        };
      }

      map[employeeId].responses += 1;

      if (typeof entry.overall_rating === "number" && Number.isFinite(entry.overall_rating)) {
        map[employeeId].total += entry.overall_rating;
        map[employeeId].ratedResponses += 1;
      }
    }

    return Object.entries(map)
      .map(([employeeId, value]) => ({
        employeeId,
        name: value.name,
        responses: value.responses,
        averageRating:
          value.ratedResponses > 0
            ? Number((value.total / value.ratedResponses).toFixed(2))
            : null,
      }))
      .sort((a, b) => {
        const aAvg = a.averageRating ?? -1;
        const bAvg = b.averageRating ?? -1;
        if (bAvg !== aAvg) return bAvg - aAvg;
        return b.responses - a.responses;
      });
  }, [entries, employeesMap, resolveEmployeeName]);

  const myPerformance = useMemo(() => {
    if (!user?.employeeId) return null;
    return employeePerformance.find((row) => row.employeeId === user.employeeId) ?? null;
  }, [employeePerformance, user]);

  return (
    <div className="grid gap-4 md:gap-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Daily (hours)</CardTitle>
                <div className="text-xs text-muted-foreground">{formatISODate(dailyDate)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setDailyDate(shiftDate(dailyDate, -1))}>Prev</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setDailyDate(new Date().toISOString().slice(0,10))}>Now</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setDailyDate(shiftDate(dailyDate, 1))}>Next</button>
              </div>
            </CardHeader>
          <CardContent style={{ height: 160 }}>
            {stats?.daily ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={
                  Array.isArray(stats.daily?.hours)
                    ? stats.daily.hours.map((h: any) => ({ name: String(h.hour).padStart(2,'0'), count: h.count }))
                    : Array.isArray(stats.daily)
                    ? stats.daily.map((d: any) => ({ name: d.date?.slice(5) ?? d.label ?? d.hour, count: d.count }))
                    : []
                }>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#8884d8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Weekly (Mon–Sun)</CardTitle>
                <div className="text-xs text-muted-foreground">{formatMonthWeek(weeklyStart)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setWeeklyStart(shiftWeek(weeklyStart, -1))}>Prev</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setWeeklyStart(() => {
                  const d = new Date(); const day = d.getDay(); const diff = (day + 6) % 7; d.setDate(d.getDate() - diff); return d.toISOString().slice(0,10);
                })}>Now</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setWeeklyStart(shiftWeek(weeklyStart, 1))}>Next</button>
              </div>
            </CardHeader>
          <CardContent style={{ height: 160 }}>
            {stats?.weekly ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={
                  Array.isArray(stats.weekly?.days)
                    ? stats.weekly.days.map((d: any) => ({ name: d.label ?? d.date?.slice(5), count: d.count }))
                    : Array.isArray(stats.weekly)
                    ? stats.weekly.map((d: any) => ({ name: d.weekStart?.slice(5) ?? d.label, count: d.count }))
                    : []
                }>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#82ca9d" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Monthly (4-week)</CardTitle>
                <div className="text-xs text-muted-foreground">{formatMonthlyLabel(monthlyStart)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setMonthlyStart(shiftMonth(monthlyStart, -1))}>Prev</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setMonthlyStart(() => { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); })}>Now</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setMonthlyStart(shiftMonth(monthlyStart, 1))}>Next</button>
              </div>
            </CardHeader>
          <CardContent style={{ height: 160 }}>
            {stats?.monthly ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#ffc658" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>

        <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Yearly (Jan–Dec)</CardTitle>
                <div className="text-xs text-muted-foreground">{yearlyYear}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setYearlyYear(shiftYear(yearlyYear, -1))}>Prev</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setYearlyYear(new Date().getFullYear())}>Now</button>
                <button className="border border-gray-200 rounded px-2 py-1 text-xs" onClick={() => setYearlyYear(shiftYear(yearlyYear, 1))}>Next</button>
              </div>
            </CardHeader>
          <CardContent style={{ height: 160 }}>
            {stats?.yearly ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={
                  Array.isArray(stats.yearly?.months)
                    ? stats.yearly.months.map((m: any) => ({ name: m.label ?? m.month, count: m.count }))
                    : []
                }>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#a29bfe" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
          </CardContent>
        </Card>
      </div>
      
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Feedback</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Responses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.totalResponses ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary?.averageRating !== null && summary?.averageRating !== undefined
                ? `${summary.averageRating}/5`
                : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last 30 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.last30DaysResponses ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Category Averages</CardTitle>
          <CardDescription>Average scores for each service category</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {categoryRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category ratings yet.</p>
          ) : (
            categoryRows.map(([key, value]) => (
              <div className="rounded-md border p-3" key={key}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{value.label}</p>
                  <Badge variant="secondary">{value.average !== null ? `${value.average}/5` : "N/A"}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employees</CardTitle>
          <CardDescription>Feedback count per Captains</CardDescription>
        </CardHeader>
        <CardContent className="max-h-64 overflow-y-auto">
          {employeeCounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback associated with employees yet.</p>
          ) : (
            <div className="grid gap-2">
              {employeeCounts.map((row) => (
                <div key={row.employeeId} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <p className="font-medium">{row.name}</p>
                  </div>
                  <Badge variant="secondary">{row.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{user?.role === "admin" ? "Employee Ratings" : "Your Rating"}</CardTitle>
          <CardDescription>
            {user?.role === "admin"
              ? "Average feedback rating by employee"
              : "Average rating from feedback forms linked to your QR code"}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-72 overflow-y-auto">
          {user?.role === "admin" ? (
            employeePerformance.length === 0 ? (
              <p className="text-sm text-muted-foreground">No employee feedback ratings yet.</p>
            ) : (
              <div className="grid gap-2">
                {employeePerformance.map((row) => (
                  <div key={row.employeeId} className="flex items-center justify-between rounded-md border p-2">
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">Responses: {row.responses}</p>
                    </div>
                    <Badge variant="secondary">
                      {row.averageRating !== null ? `${row.averageRating}/5` : "N/A"}
                    </Badge>
                  </div>
                ))}
              </div>
            )
          ) : myPerformance ? (
            <div className="rounded-md border p-3">
              <p className="text-sm text-muted-foreground">Responses received</p>
              <p className="text-xl font-semibold">{myPerformance.responses}</p>
              <p className="mt-2 text-sm text-muted-foreground">Average rating</p>
              <p className="text-xl font-semibold">
                {myPerformance.averageRating !== null ? `${myPerformance.averageRating}/5` : "N/A"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No feedback linked to your profile yet.</p>
          )}
        </CardContent>
      </Card>

      {user?.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle>Employee feedback QR codes</CardTitle>
            <CardDescription>
              Each staff member&apos;s personal feedback link. Print or share it so customer reviews are attributed to them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No employees found.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {employees.map((emp) => {
                  const eid = empQrId(emp);
                  const url = buildEmployeeFeedbackUrl(eid);
                  const name = resolveEmployeeName(eid) ?? String(emp?.emp_Fname ?? "Unknown");
                  const role = employeesMap[eid]?.role || String(emp?.role ?? "");
                  const qr = employeeQrMap[eid];
                  return (
                    <div key={eid || name} className="flex flex-col items-center gap-3 rounded-md border p-4 text-center">
                      <div className="w-full">
                        <p className="truncate font-medium">{name}</p>
                        {role ? <p className="text-xs capitalize text-muted-foreground">{role}</p> : null}
                      </div>
                      {qr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qr} alt={`Feedback QR for ${name}`} className="h-40 w-40 rounded-md border bg-white p-2" />
                      ) : (
                        <div className="flex h-40 w-40 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                          {url ? "Generating…" : "Unavailable"}
                        </div>
                      )}
                      <p className="w-full break-all text-[11px] text-muted-foreground">{url || "—"}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!url}
                        onClick={async () => {
                          if (!url) return;
                          try {
                            await navigator.clipboard.writeText(url);
                            toast({ title: "Link copied", description: `Feedback link for ${name} copied.` });
                          } catch {
                            toast({ title: "Copy failed", description: "Could not copy the feedback link.", variant: "destructive" });
                          }
                        }}
                      >
                        Copy link
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Latest Feedback</CardTitle>
          <CardDescription>Most recent customer submissions</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading feedback...</p> : null}
          {!loading && entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback submissions yet.</p>
          ) : null}
          {entries.map((entry) => (
            <article className="rounded-md border p-3" key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{entry.customer_name || "Anonymous"}</p>
                <div className="flex items-center gap-2">
                  <Badge>{entry.overall_rating ? `${entry.overall_rating}/5` : "No score"}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(entry.submitted_at)}</span>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {entry.comments?.trim() ? entry.comments : "No additional comments."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.category_ratings.slice(0, 6).map((category) => (
                  <Badge key={`${entry.id}-${category.key}`} variant="outline">
                    {category.label}: {category.rating}/5
                  </Badge>
                ))}
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
      
    </div>
  );
}
