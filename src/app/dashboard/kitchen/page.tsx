"use client";

/**
 * KITCHEN (KDS) — the web `kdsModule` / `_KdsHome` (restaurant_owner_app
 * lib/screens/modules.dart): live tickets (station-filterable, with course
 * holds) plus an expo/pass view consolidating each table's ready-vs-pending
 * items, hosted full-page as a first-class module.
 *
 * The KDS is a wall-mounted board nobody touches, so it must refresh itself:
 * a SILENT ten-second poll (useCachedFetch keeps the board painted — no
 * skeleton flash mid-shift) plus the realtime socket nudges the Orders page
 * already rides on. Timers tick every second; a seconds display that only
 * moves every ten reads broken next to the printed docket.
 *
 * The board is deliberately COARSER than the rest of the app's grids: a
 * ticket's whole point is its item list, readable at arm's length, so a column
 * never drops below ~500px — 1 column under 1100px, 2 to 1619px, 3 beyond.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Inbox, Lock, LockOpen, RefreshCw } from "lucide-react";

import { getKitchenExpo, getKitchenOrders, isKitchenOrderCancelled } from "@/lib/api/kitchen";
import type { KitchenOrder } from "@/lib/api/kitchen";
import { getKitchenSections, getOrdersScope } from "@/lib/db";
import type { OrdersScope } from "@/lib/db";
import { getSelectedOutletId } from "@/lib/outlet";
import { canBarkFromBoard } from "@/lib/orders-grid";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useAuth } from "@/context/AuthContext";
import { useTimezone } from "@/lib/use-timezone";
import { KdsCard } from "@/components/kds/kds-card";
import { ExpoBoard } from "@/components/kds/expo-board";
import { KdsScopeEmpty } from "@/components/kds/kds-scope-empty";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// useSearchParams requires a Suspense boundary (same pattern as the bookings,
// accounting and queue pages).
export default function KitchenPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<SkeletonRows rows={4} title={false} />}>
      <KitchenPageInner />
    </React.Suspense>
  );
}

function KitchenPageInner(): React.JSX.Element {
  const { user } = useAuth();
  const { timezone } = useTimezone();
  const searchParams = useSearchParams();
  const restaurantId = user?.restaurantUsername ?? "";
  // "Bark to kitchen" is offered only where the server would say yes — the
  // same gate the Orders board asks (src/lib/orders-grid.ts).
  const mayBark = canBarkFromBoard(user);
  const hasRole = (role: string): boolean =>
    user != null && (user.role === role || (Array.isArray(user.role_all) && user.role_all.includes(role)));
  // Same gate as the header's OutletSwitcher: only these roles may target
  // another outlet, so only they get the switch-outlet actions.
  const canSwitchOutlet = hasRole("admin") || hasRole("manager");

  const [mode, setMode] = React.useState<"tickets" | "expo">("tickets");
  // ?station= deep link preselects the filter (a wall screen bookmark).
  const [station, setStation] = React.useState<string>(
    () => searchParams.get("station")?.trim() || "All",
  );
  // Locked mode: dedicate this screen to a single section. The Tickets/Expo
  // switch and the other chips hide until staff explicitly unlock.
  const [locked, setLocked] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  /* ── Data ─────────────────────────────────────────────────────────── */

  // Reads are outlet-scoped server-side, so the cache must be too: without the
  // outlet in the key, switching branches would prime the board with the OTHER
  // branch's tickets for a beat before the silent refresh corrected it. The
  // shell remounts this page on a switch, so reading once at mount is enough.
  const [outletKey] = React.useState(() => getSelectedOutletId() ?? "");
  const scopeKey = `${restaurantId}:${outletKey}`;

  const expoShown = mode === "expo" && !locked;

  const orders = useCachedFetch<KitchenOrder[]>(
    `kds:orders:${scopeKey}`,
    React.useCallback(() => getKitchenOrders(restaurantId), [restaurantId]),
    // The silent poll: the only honest refresh for a screen nobody touches.
    // Paused while the pass is up — the app disposes the tickets view then —
    // and the cache repaints the board the instant staff switch back.
    { pollMs: 10_000, enabled: restaurantId !== "" && !expoShown },
  );

  const expo = useCachedFetch(
    `kds:expo:${scopeKey}`,
    React.useCallback(() => getKitchenExpo(restaurantId), [restaurantId]),
    { pollMs: 10_000, enabled: restaurantId !== "" && expoShown },
  );

  // Managed kitchen sections drive the filter chips even before any ticket
  // carries the station. Best-effort: on failure the chips fall back to
  // ticket-derived stations only (getKitchenSections resolves [] then).
  const sections = useCachedFetch<string[]>(
    `kds:sections:${scopeKey}`,
    React.useCallback(() => getKitchenSections(restaurantId), [restaurantId]),
    { enabled: restaurantId !== "" },
  );
  const managed = React.useMemo(
    () => (sections.data ?? []).map((s) => s.trim()).filter((s) => s !== ""),
    [sections.data],
  );

  // Which outlet these tickets come from + the live count per outlet, so an
  // empty board can say "they're in the other branch" instead of just "none".
  // Best-effort: getOrdersScope resolves null on an older backend.
  const scope = useCachedFetch<OrdersScope | null>(
    `kds:scope:${scopeKey}`,
    React.useCallback(() => getOrdersScope(restaurantId), [restaurantId]),
    { enabled: restaurantId !== "" },
  );

  /* ── Derived board state ──────────────────────────────────────────── */

  // Pending orders are NOT yet approved → they must not reach the kitchen.
  // Everything else still in service stays — an order walking through Bill
  // Verification keeps its ticket (and its "Back to Preparing" undo).
  const active = React.useMemo(() => {
    const rows = orders.data ?? [];
    return rows.filter((o) => {
      const s = o.status.trim().toLowerCase();
      return s !== "closed" && s !== "paid" && s !== "cancelled" && s !== "pending" && !isKitchenOrderCancelled(o);
    });
  }, [orders.data]);

  // Chips = union of the MANAGED section list (settings order first) and the
  // stations present on active tickets (legacy labels), sorted extras last.
  const chips = React.useMemo(() => {
    const seen = new Set(managed.map((m) => m.toLowerCase()));
    const extras = new Set<string>();
    for (const o of active) {
      for (const it of o.items) {
        const st = (it.station ?? "").trim();
        if (st !== "" && !seen.has(st.toLowerCase())) { extras.add(st); }
      }
    }
    return ["All", ...managed, ...Array.from(extras).sort()];
  }, [active, managed]);

  // While locked, keep the locked section selected even if its chip has
  // temporarily no active tickets (so the lock doesn't snap back to All).
  const selected =
    locked && station !== "All" ? station : chips.includes(station) ? station : "All";

  const visible = React.useMemo(
    () =>
      active.filter((o) =>
        o.items.some(
          (it) => selected === "All" || (it.station ?? "").toLowerCase() === selected.toLowerCase(),
        ),
      ),
    [active, selected],
  );

  /* ── Live behaviour ───────────────────────────────────────────────── */

  // Every "3m 42s" chip and per-item timer visibly ticks each second while
  // tickets are on screen (the format shows seconds; a display that moves in
  // ten-second jumps reads broken).
  const ticketsShown = !expoShown;
  const hasTickets = visible.length > 0;
  React.useEffect(() => {
    if (!ticketsShown || !hasTickets) { return; }
    setNow(Date.now());
    const t = window.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { window.clearInterval(t); };
  }, [ticketsShown, hasTickets]);

  // Realtime nudges: the shell's socket bridges order/bill events onto a DOM
  // event (RealtimeContext) — refresh silently, exactly as the Orders page.
  const refreshOrders = orders.refresh;
  const refreshExpo = expo.refresh;
  React.useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ event?: string } | undefined>).detail;
      if (detail?.event === "order:updated" || detail?.event === "bill:updated") {
        // Only the view on screen: the hidden one refetches (cache-primed)
        // the moment staff switch back to it.
        if (expoShown) { refreshExpo(); } else { refreshOrders(); }
      }
    };
    window.addEventListener("realtime:event", handler);
    return () => { window.removeEventListener("realtime:event", handler); };
  }, [refreshOrders, refreshExpo, expoShown]);

  /* ── Render ───────────────────────────────────────────────────────── */

  if (user == null) {
    return (
      <div className="flex flex-1 flex-col">
        <SkeletonRows rows={4} title={false} />
      </div>
    );
  }

  const board = (): React.JSX.Element => {
    if (orders.loading) { return <SkeletonRows rows={4} title={false} />; }
    if (orders.error != null) {
      return (
        <LoadErrorState
          whatFailed="Couldn't load kitchen tickets."
          error={orders.error}
          onRetry={orders.retry}
        />
      );
    }
    if (visible.length === 0) {
      return selected === "All" ? (
        <KdsScopeEmpty scope={scope.data ?? null} canSwitchOutlet={canSwitchOutlet} />
      ) : (
        <EmptyState
          icon={<Inbox />}
          title="Nothing to show"
          caption={`No active tickets for ${selected}.`}
        />
      );
    }
    return (
      // The app's 14px card gutter; rows stretch so side-by-side tickets match.
      <div className="grid grid-cols-1 items-stretch gap-3.5 min-[1100px]:grid-cols-2 min-[1620px]:grid-cols-3">
        {visible.map((o) => (
          <KdsCard
            key={o.id}
            order={o}
            station={selected}
            now={now}
            restaurantId={restaurantId}
            timezone={timezone}
            mayBark={mayBark}
            onChanged={refreshOrders}
          />
        ))}
      </div>
    );
  };

  const pass = (): React.JSX.Element => {
    if (expo.loading) { return <SkeletonRows rows={4} title={false} />; }
    if (expo.error != null) {
      return <LoadErrorState whatFailed="Couldn't load the pass." error={expo.error} onRetry={expo.retry} />;
    }
    return <ExpoBoard tables={expo.data ?? []} />;
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* The Tickets/Expo switch hides while locked so the screen stays pinned
          to its zone's tickets. */}
      {!locked && (
        <div className="flex items-center gap-2">
          <Tabs
            value={mode}
            onValueChange={(v) => { setMode(v === "expo" ? "expo" : "tickets"); }}
            className="min-w-0"
          >
            <TabsList>
              <TabsTrigger value="tickets">Tickets</TabsTrigger>
              <TabsTrigger value="expo">Expo / Pass</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Refresh"
            onClick={() => { if (expoShown) { refreshExpo(); } else { refreshOrders(); } }}
          >
            <RefreshCw />
          </Button>
        </div>
      )}

      {expoShown ? (
        <div className="relative flex flex-1 flex-col">
          {pass()}
          <CacheStalePill offline={expo.offline} fromCache={expo.fromCache} updatedAt={expo.updatedAt} />
        </div>
      ) : (
        <>
          {locked && selected !== "All" ? (
            // Locked banner: only this section shows; other chips are hidden.
            <div
              className="flex w-full items-center gap-2 rounded-md border px-3.5 py-2"
              style={{
                background: "color-mix(in srgb, hsl(var(--primary)) 12%, transparent)",
                borderColor: "color-mix(in srgb, hsl(var(--primary)) 28%, transparent)",
              }}
            >
              <Lock className="h-4 w-4 shrink-0 text-accent-foreground" />
              <span className="micro-label min-w-0 flex-1 truncate !text-accent-foreground">
                Locked to {selected}
              </span>
              <Button size="sm" variant="outline" onClick={() => { setLocked(false); }}>
                <LockOpen /> Unlock
              </Button>
            </div>
          ) : chips.length > 1 ? (
            <div className="flex items-center gap-2">
              <Tabs
                value={selected}
                onValueChange={(v) => { setStation(v); }}
                className="min-w-0 flex-1"
              >
                <TabsList className="max-w-full">
                  {chips.map((c) => (
                    <TabsTrigger key={c} value={c}>
                      {c}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {/* Lock the current section for a dedicated single-zone screen. */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={selected === "All"}
                title={selected === "All" ? "Pick a section to lock" : `Lock to ${selected}`}
                onClick={() => { setLocked(true); }}
              >
                <Lock />
              </Button>
            </div>
          ) : null}
          <div className="relative flex flex-1 flex-col">
            {board()}
            <CacheStalePill
              offline={orders.offline}
              fromCache={orders.fromCache}
              updatedAt={orders.updatedAt}
            />
          </div>
        </>
      )}
    </div>
  );
}
