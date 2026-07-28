"use client";

// The dashboard's notification bell + full notification list.
//
// Why this exists: the web dashboard had no notification surface at all, so
// nothing on the web acted on the notifications the backend was already
// writing. More importantly, the reported bug — "notifications open nothing, or
// open the Orders tab without the order" — is a ROUTING bug, and the fix has to
// live wherever notifications are tapped. So this component never guesses a
// destination from the notification's type: on click it asks the backend
// resolver (GET /notifications/:id/target) which module and which record, and
// whether that record is reachable from the outlet currently being viewed.
//
// Three outcomes, all honest:
//   1. visible_here            -> navigate to the module AND focus the record
//   2. reachable elsewhere     -> say so; offer "Switch outlet" when the resolver
//                                 hands back a switch_outlet_id
//   3. gone / nothing to open  -> show the resolver's sentence, navigate nowhere
//
// The list inside the popover is the full list the backend returns (50 newest),
// so there is no second "notifications page" that could drift out of step.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2, RefreshCw, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  getNotifications,
  getNotificationTarget,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/db";
import { notificationBlockedMessage, notificationHref } from "@/lib/notification-routing";
import { setSelectedOutlet } from "@/lib/outlet";

const POLL_MS = 20000;

const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {return "";}
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) {return "just now";}
  if (mins < 60) {return `${mins}m ago`;}
  const hours = Math.round(mins / 60);
  if (hours < 24) {return `${hours}h ago`;}
  return `${Math.round(hours / 24)}d ago`;
};

// Tone per notification type — purely decorative, keeps the list scannable.
const TYPE_DOT: Record<string, string> = {
  order: "bg-blue-500",
  payment: "bg-green-500",
  reservation: "bg-purple-500",
  waitlist: "bg-amber-500",
  valet: "bg-cyan-500",
  stock: "bg-orange-500",
  warning: "bg-red-500",
};

export function NotificationsBell() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const rid = user?.restaurantUsername ?? "";

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  // Which notification is currently being resolved (so the row can show a spinner
  // instead of the user clicking three times while the round-trip is in flight).
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!rid) {return;}
    setLoading(true);
    try {
      const data = await getNotifications(rid);
      setRows(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(Number(data.unread) || 0);
    } catch {
      // A failed poll must never break the header — keep the last known list.
    } finally {
      setLoading(false);
    }
  }, [rid]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!rid) {return;}
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => { clearInterval(id); };
  }, [rid, load]);

  // Refresh as soon as something happens live, so the badge doesn't lag a poll.
  useEffect(() => {
    const handler = () => { void load(); };
    window.addEventListener("realtime:event", handler as EventListener);
    return () => { window.removeEventListener("realtime:event", handler as EventListener); };
  }, [load]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {void load();}
  };

  const markAll = async () => {
    if (!rid) {return;}
    try {
      await markAllNotificationsRead(rid);
      setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: new Date().toISOString() })));
      setUnread(0);
    } catch {
      toast({ title: "Couldn't mark them read", variant: "destructive" });
    }
  };

  const openNotification = async (row: NotificationRow) => {
    if (!rid || resolvingId) {return;}
    setResolvingId(row.id);
    try {
      // Read receipt first: the user has clearly seen it, whatever the outcome.
      if (!row.read_at) {
        void markNotificationRead(rid, row.id).then(() => {
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)));
          setUnread((n) => Math.max(0, n - 1));
        }).catch(() => { /* read receipts are not worth an error toast */ });
      }

      const target = await getNotificationTarget(rid, row.id);
      if (!target) {
        toast({
          title: "Nothing to open",
          description: "This notification is no longer available.",
          variant: "destructive",
        });
        return;
      }

      const href = notificationHref(target);

      if (target.visible_here && href) {
        setOpen(false);
        router.push(href);
        return;
      }

      // Not reachable from here. Say exactly why, and offer the one action that
      // would fix it — never open a page the record isn't on.
      const message = notificationBlockedMessage(target);
      const canSwitch = Boolean(target.switch_outlet_id);
      toast({
        title: canSwitch ? "That record is on another outlet" : "Can't open this one",
        description: message,
        ...(canSwitch
          ? {
              action: (
                <ToastAction
                  altText="Switch to the outlet holding this record"
                  onClick={() => { void setSelectedOutlet(target.switch_outlet_id); }}
                >
                  <Store className="mr-1 h-3.5 w-3.5" /> Switch outlet
                </ToastAction>
              ),
            }
          : {}),
      });

      // A module with nothing to focus (KPI alerts -> Analytics) is still a
      // legitimate destination; only navigate when the resolver named one.
      if (target.reason_gone === "no_target" && href) {
        setOpen(false);
        router.push(href);
      }
    } catch {
      toast({ title: "Couldn't open this notification", variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const badge = useMemo(() => (unread > 9 ? "9+" : String(unread)), [unread]);

  if (!rid) {return null;}

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
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
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { void markAll(); }}>
                <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
              </Button>
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
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => { void openNotification(row); }}
                      disabled={busy}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted ${isUnread ? "bg-primary/5" : ""}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[row.type] ?? "bg-muted-foreground"}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${isUnread ? "font-semibold" : "font-medium"}`}>{row.title}</span>
                        {row.body ? <span className="block text-xs text-muted-foreground">{row.body}</span> : null}
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                          {relativeTime(row.created_at)}
                        </span>
                      </span>
                      {busy ? <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
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
  );
}
