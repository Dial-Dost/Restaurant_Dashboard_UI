"use client";

// The dashboard's notification bell — the web copy of the Flutter app's
// widgets/notifications_bell.dart.
//
// This component never guesses a destination from the notification's type: on
// click it asks the backend resolver (GET /notifications/:id/target) which
// module and which record, and whether that record is reachable from the outlet
// currently being viewed. Only when the resolver cannot be reached at all
// (offline / older backend) does it fall back to the local type→module map and
// still navigate with the raw meta as the focus target.
//
// Outcomes, all honest (the Flutter `_explain` dialog, ported):
//   1. visible_here            -> navigate to the module AND focus the record
//                                 (?focus=<json> — see useFocusRequest)
//   2. reachable elsewhere     -> a dialog: Switch outlet (which then ALSO opens
//                                 the destination focused on the record)
//   3. settled & aged out      -> Open History
//   4. gone for good           -> Clear notification
//   5. module hidden from role -> "This is in X, which your role cannot open."
//   6. record gone, module not -> Open <module>
//
// Every row carries a trailing ✕ (Clear), and the header carries Mark all read
// and a red Clear all — plus the web-extra Refresh spinner and realtime-driven
// refresh, kept deliberately.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Bell,
  CalendarCheck,
  CheckCheck,
  Hourglass,
  Info,
  Loader2,
  ReceiptText,
  RefreshCw,
  SquareParking,
  Store,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useVisibleNav } from "@/hooks/use-nav";
import {
  clearAllNotifications,
  deleteNotification,
  getNotifications,
  getNotificationTarget,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
  type NotificationTarget,
} from "@/lib/db";
import {
  MODULE_ROUTES,
  fallbackNotificationHref,
  notificationBlockedMessage,
  notificationFocusTarget,
  notificationHref,
} from "@/lib/notification-routing";
import { withFocusParam } from "@/components/focus-banner";
import { applySelectedOutlet } from "@/lib/outlet";
import { useTimezone } from "@/lib/use-timezone";
import { formatDateTime, formatFullDateTime } from "@/lib/tz";

/** Flutter polls every 25s; realtime events refresh sooner. */
const POLL_MS = 25_000;

// "2h ago" is an elapsed time; past a day the bell states the actual instant in
// the restaurant's zone like every other screen (the exact stamp is one hover
// away — the row's title tooltip).
const rowTime = (iso: string, timezone: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) { return ""; }
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) { return "just now"; }
  if (mins < 60) { return `${mins}m ago`; }
  const hours = Math.round(mins / 60);
  if (hours < 24) { return `${hours}h ago`; }
  return formatDateTime(iso, timezone);
};

/** Type icon per row — notifications_bell.dart's `_icon`, in lucide. */
const typeIcon = (type: string): LucideIcon => {
  switch (type) {
    case "payment": return Banknote;
    case "reservation": return CalendarCheck;
    case "order": return ReceiptText;
    case "waitlist": return Hourglass;
    case "valet": return SquareParking;
    case "warning": return TriangleAlert;
    default: return Bell;
  }
};

/** What the blocked-target dialog is showing. */
interface Explain {
  resolved: NotificationTarget;
  notificationId: string;
  message: string;
}

export function NotificationsBell(): JSX.Element | null {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  const { labels: visibleLabels } = useVisibleNav();
  const rid = user?.restaurantUsername ?? "";

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [explain, setExplain] = useState<Explain | null>(null);

  const load = useCallback(async () => {
    if (!rid) { return; }
    setLoading(true);
    try {
      const data = await getNotifications(rid);
      setRows(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(data.unread || 0);
    } catch {
      // A failed poll must never break the header — keep the last known list.
    } finally {
      setLoading(false);
    }
  }, [rid]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!rid) { return; }
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => { clearInterval(id); };
  }, [rid, load]);

  // Refresh as soon as something happens live, so the badge doesn't lag a poll.
  useEffect(() => {
    const handler = (): void => { void load(); };
    window.addEventListener("realtime:event", handler);
    return () => { window.removeEventListener("realtime:event", handler); };
  }, [load]);

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) { void load(); }
  };

  const markAll = async (): Promise<void> => {
    if (!rid) { return; }
    try {
      await markAllNotificationsRead(rid);
      setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: new Date().toISOString() })));
      setUnread(0);
    } catch {
      toast({ title: "Couldn't mark them read", variant: "destructive" });
    }
  };

  const clearOne = async (id: string): Promise<void> => {
    if (!rid) { return; }
    try {
      await deleteNotification(rid, id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      void load();
    } catch {
      toast({ title: "Couldn't clear it", variant: "destructive" });
    }
  };

  const clearAll = async (): Promise<void> => {
    if (!rid) { return; }
    try {
      await clearAllNotifications(rid);
      setRows([]);
      setUnread(0);
    } catch {
      toast({ title: "Couldn't clear them", variant: "destructive" });
    }
  };

  const go = (href: string): void => {
    setOpen(false);
    setExplain(null);
    router.push(href);
  };

  // Shows the blocked-target dialog — including the role-visibility message
  // when the destination module is hidden from this user.
  const showExplain = (resolved: NotificationTarget, notificationId: string, message?: string): void => {
    setExplain({
      resolved,
      notificationId,
      message: message ?? notificationBlockedMessage(resolved),
    });
  };

  const openNotification = async (row: NotificationRow): Promise<void> => {
    if (!rid || resolvingId) { return; }
    setResolvingId(row.id);
    try {
      // Read receipt first: the user has clearly seen it, whatever the outcome.
      if (!row.read_at) {
        void markNotificationRead(rid, row.id).then(() => {
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)));
          setUnread((n) => Math.max(0, n - 1));
        }).catch(() => { /* read receipts are not worth an error toast */ });
      }

      let target: NotificationTarget | null = null;
      try {
        target = await getNotificationTarget(rid, row.id);
      } catch {
        target = null;
      }

      // Resolver unreachable (offline / older backend): fall back to the local
      // type→module map and still navigate with the raw meta as focus target.
      if (!target) {
        const href = fallbackNotificationHref(row.type, row.meta);
        if (href) { go(href); }
        else { toast({ title: "Couldn't open this notification", variant: "destructive" }); }
        return;
      }

      const moduleLabel = target.module;
      const reason = target.reason_gone ?? "";

      if (target.visible_here || (reason === "no_target" && moduleLabel)) {
        // Nothing to open at all — say that rather than swallowing the tap.
        if (!moduleLabel) {
          showExplain(target, row.id);
          return;
        }
        if (visibleLabels.length > 0 && !visibleLabels.includes(moduleLabel)) {
          showExplain(
            { ...target, module: null, switch_outlet_id: null, reason_gone: "no_permission" },
            row.id,
            `This is in ${moduleLabel}, which your role cannot open.`,
          );
          return;
        }
        // An informational alert (no_target) is still a legitimate destination —
        // just with nothing to focus.
        const href = reason === "no_target"
          ? MODULE_ROUTES[moduleLabel] ?? null
          : notificationHref(target);
        if (href) { go(href); }
        else { showExplain(target, row.id); }
        return;
      }

      showExplain(target, row.id);
    } finally {
      setResolvingId(null);
    }
  };

  // "Switch outlet" — which then ALSO opens the destination focused on the
  // record, because the switch is in place now (no reload to survive).
  const switchOutletAndOpen = async (resolved: NotificationTarget): Promise<void> => {
    const switchTo = resolved.switch_outlet_id;
    if (!switchTo) { return; }
    setExplain(null);
    setOpen(false);
    await applySelectedOutlet(switchTo);
    const moduleLabel = resolved.module;
    if (moduleLabel && (visibleLabels.length === 0 || visibleLabels.includes(moduleLabel))) {
      const base = MODULE_ROUTES[moduleLabel];
      if (base) {
        router.push(withFocusParam(base, notificationFocusTarget(resolved.meta, resolved)));
      }
    }
  };

  const badge = useMemo(() => String(unread), [unread]);

  if (!rid) { return null; }

  const explainReason = explain?.resolved.reason_gone ?? "";
  const explainModule = explain?.resolved.module ?? null;
  const explainSwitch = explain?.resolved.switch_outlet_id ?? null;
  const explainModuleVisible = explainModule != null &&
    (visibleLabels.length === 0 || visibleLabels.includes(explainModule));

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              // The exact count, in the accent — never a capped "9+" in alarm red.
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-base px-1 text-[10px] font-bold leading-none text-accent-on">
                {badge}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { void load(); }} disabled={loading} title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
              {rows.length > 0 && (
                <>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { void markAll(); }}>
                    <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => { void clearAll(); }}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear all
                  </Button>
                </>
              )}
            </div>
          </div>

          <ScrollArea className="max-h-[60vh]">
            {rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "Nothing new. New orders, bookings and alerts show up here."}
              </p>
            ) : (
              <ul className="divide-y">
                {rows.map((row) => {
                  const isUnread = !row.read_at;
                  const busy = resolvingId === row.id;
                  const Icon = typeIcon(row.type);
                  return (
                    <li key={row.id} className={`flex items-start ${isUnread ? "bg-primary/5" : ""}`}>
                      <button
                        type="button"
                        onClick={() => { void openNotification(row); }}
                        disabled={busy}
                        // The exact stamp (with the zone) is one hover away.
                        title={formatFullDateTime(row.created_at, timezone)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted"
                      >
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isUnread ? "text-accent-foreground" : "text-tertiary"}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm ${isUnread ? "font-semibold" : "font-medium text-muted-foreground"}`}>{row.title}</span>
                          {row.body ? <span className="block text-xs text-muted-foreground">{row.body}</span> : null}
                          <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                            {rowTime(row.created_at, timezone)}
                          </span>
                        </span>
                        {busy ? <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void clearOne(row.id); }}
                        title="Clear"
                        className="mr-1 mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span className="sr-only">Clear</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>

          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            Tapping one opens the exact record. If it can&apos;t be opened from this outlet, you&apos;ll be told why.
          </p>
        </PopoverContent>
      </Popover>

      {/* The blocked-target dialog — contextual ways out, never a dead toast. */}
      <Dialog open={explain != null} onOpenChange={(o) => { if (!o) { setExplain(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-4 w-4 text-accent-foreground" /> Can&apos;t open that yet
            </DialogTitle>
            <DialogDescription>{explain?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap gap-2 sm:justify-end">
            {explainSwitch != null && (
              <Button variant="outline" size="sm" onClick={() => { if (explain) { void switchOutletAndOpen(explain.resolved); } }}>
                <Store className="mr-1.5 h-3.5 w-3.5" /> Switch outlet
              </Button>
            )}
            {explainReason === "outside_live_window" && visibleLabels.includes("History") && (
              <Button variant="outline" size="sm" onClick={() => { go("/dashboard/history"); }}>
                Open History
              </Button>
            )}
            {(explainReason === "deleted" || explainReason === "unknown_entity") && explain != null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = explain.notificationId;
                  setExplain(null);
                  void clearOne(id);
                }}
              >
                Clear notification
              </Button>
            )}
            {explainSwitch == null && explainModule != null && explainModuleVisible && explainModule in MODULE_ROUTES && (
              <Button variant="outline" size="sm" onClick={() => { go(MODULE_ROUTES[explainModule]); }}>
                Open {explainModule}
              </Button>
            )}
            <Button size="sm" onClick={() => { setExplain(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
