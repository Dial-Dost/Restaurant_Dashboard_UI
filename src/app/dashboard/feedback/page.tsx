"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/context/RealtimeContext";

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
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [employeesMap, setEmployeesMap] = useState<Record<string, { name: string; role?: string }>>({});
  const [loading, setLoading] = useState(true);
  const { lastEvent } = useRealtime();
  const [stats, setStats] = useState<{ daily?: Array<any>; weekly?: Array<any>; overall?: Array<any>; monthly?: any; yearly?: any } | null>(null);
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
      if (!user?.restaurantId) {
        setLoading(false);
        return;
      }

      const base =
        process.env.NEXT_PUBLIC_API_URL ?? (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : '');
      try {
        const [itemsRes, summaryRes] = await Promise.all([
          fetch(`${base}/feedback?limit=100`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } }),
          fetch(`${base}/feedback/summary`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } }),
        ]);

        console.log("Fetched feedback data", { itemsRes, summaryRes });

        const feedbackRows = itemsRes.ok ? (await itemsRes.json()).items ?? [] : [];
        const feedbackSummary = summaryRes.ok ? (await summaryRes.json()) : null;
        const usersRes = await fetch(`${base}/restaurant/users`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } });
        const usersPayload = usersRes.ok ? (await usersRes.json()) : { users: [] };
        const usersList = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
        const map: Record<string, { name: string; role?: string }> = {};
        for (const u of usersList) {
          if (u && u.employeeId) map[String(u.employeeId)] = { name: String(u.name ?? u.employeeId), role: String(u.role ?? "") };
        }
        setEmployeesMap(map);

        if (!active) return;

        setEntries(feedbackRows as FeedbackEntry[]);
        setSummary(feedbackSummary as FeedbackSummary | null);
        const statsDaily = await (await fetch(`${base}/feedback/stats?mode=daily&date=${dailyDate}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
        const statsWeekly = await (await fetch(`${base}/feedback/stats?mode=weekly&weekStart=${weeklyStart}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
        const statsMonthly = await (await fetch(`${base}/feedback/stats?mode=monthly&start=${monthlyStart}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
        const statsYearly = await (await fetch(`${base}/feedback/stats?mode=yearly&year=${yearlyYear}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
        setStats({ daily: statsDaily, weekly: statsWeekly, monthly: statsMonthly, yearly: statsYearly });
      } finally {
        if (active) setLoading(false);
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [user?.restaurantId, dailyDate, weeklyStart, monthlyStart, yearlyYear]);

  useEffect(() => {
    if (!user?.restaurantId) return;
    if (!lastEvent) return;
    if (lastEvent.event && lastEvent.event.startsWith('feedback')) {
      // Re-fetch when feedback changes
      (async () => {
        setLoading(true);
        const base =
          process.env.NEXT_PUBLIC_API_URL ?? (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : '');
        try {
          const itemsRes = await fetch(`${base}/feedback?limit=100`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } });
          const summaryRes = await fetch(`${base}/feedback/summary`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } });
          const feedbackRows = itemsRes.ok ? (await itemsRes.json()).items ?? [] : [];
          const feedbackSummary = summaryRes.ok ? (await summaryRes.json()) : null;
          // re-fetch stats windows
          const statsDaily = await (await fetch(`${base}/feedback/stats?mode=daily&date=${dailyDate}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
          const statsWeekly = await (await fetch(`${base}/feedback/stats?mode=weekly&weekStart=${weeklyStart}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
          const statsMonthly = await (await fetch(`${base}/feedback/stats?mode=monthly&start=${monthlyStart}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
          const statsYearly = await (await fetch(`${base}/feedback/stats?mode=yearly&year=${yearlyYear}`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } })).json().catch(() => null);
          setEntries(feedbackRows as FeedbackEntry[]);
          setSummary(feedbackSummary as FeedbackSummary | null);
          setStats({ daily: statsDaily, weekly: statsWeekly, monthly: statsMonthly, yearly: statsYearly });
          // refresh employee list
          try {
            const usersRes = await fetch(`${base}/restaurant/users`, { headers: { 'X-Restaurant-Id': user.restaurantId, "X-Employee-Id": user.employeeId } });
            const usersPayload = usersRes.ok ? (await usersRes.json()) : { users: [] };
            const usersList = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
            const map: Record<string, { name: string; role?: string }> = {};
            for (const u of usersList) {
              if (u && u.employeeId) map[String(u.employeeId)] = { name: String(u.name ?? u.employeeId), role: String(u.role ?? "") };
            }
            setEmployeesMap(map);
          } catch (err) {
            // ignore
          }
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [lastEvent, user?.restaurantId, dailyDate, weeklyStart, monthlyStart, yearlyYear]);

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
      .map(([employeeId, count]) => ({ employeeId, name: employeesMap[employeeId]?.name ?? employeeId, count }))
      .sort((a, b) => b.count - a.count);
  }, [entries, employeesMap]);

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
