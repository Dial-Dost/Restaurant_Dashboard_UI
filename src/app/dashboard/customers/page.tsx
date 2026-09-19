"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { ChevronDown, Inbox, Loader2 } from "lucide-react";

import { AppSearchField } from "@/components/ui/app-search-field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TickTag } from "@/components/ui/tick-tag";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useAuth } from "@/context/AuthContext";
import { useTimezone } from "@/lib/use-timezone";
import {
  fetchGuestLeaders,
  fetchGuestPage,
  GUEST_PAGE_SIZE,
  type GuestLeaders,
  type GuestRow,
  type GuestSegmentsPage,
  type GuestSortKey,
} from "@/lib/api/customers";
import { moneyOf } from "@/components/overview/overview-utils";
import { SegmentChip } from "@/components/customers/guest-bits";
import { GuestCard } from "@/components/customers/guest-card";
import { LeaderCard } from "@/components/customers/leader-card";
import { GuestSheet } from "@/components/customers/guest-sheet";
import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_SORTS,
  customerSegmentLabel,
  customerSortLabel,
  type CustomerSegmentKey,
} from "@/components/customers/guest-format";

/**
 * The guest book (modules.dart `_CustomersView`): an Overview band ranking
 * the whole filtered set three ways, and the full list underneath sorted and
 * segmented by the same controls.
 *
 * EVERY ranking and every page comes from GET /customers/segments, which
 * sorts and pages in SQL — sort, segment and search all share one rule: the
 * request restarts at offset 0, the loaded rows are dropped, and the
 * leaderboards are re-ranked under the new filters (a list that kept its old
 * rows under a new sort would be ordered by neither).
 */

/**
 * [web-extra, kept for db.ts] The legacy /get-customers row shape. The guest
 * book itself no longer reads it — every figure on this page comes from
 * /customers/segments — but src/lib/db.ts (off-limits to this module) still
 * imports the type from here for its own getCustomers/addCustomer helpers,
 * which other modules (e.g. Bookings' phone join) call.
 */
export interface Customer {
  customerId?: string;
  name: string;
  email: string;
  phone: string;
  totalBookings: number;
  status: "In-house" | "Departed";
  billAmount: number;
  // Optional demographic tags — used only in AGGREGATED analytics.
  gender?: string;
  ageGroup?: string;
  pincode?: string;
}

/** One landed load: page 0 AND the three leaderboards, cached together —
 *  painting the band as loading skeletons next to an instant list would read
 *  as half a screen. */
interface GuestBookPayload {
  page: GuestSegmentsPage;
  leaders: GuestLeaders;
  /** The search this payload was fetched under — the segment-count guard. */
  query: string;
}

/** Pages 2+ appended onto one specific payload; extras from another payload
 *  are dead (the app's cache-generation guard). */
interface AppendState {
  base: GuestBookPayload | null;
  rows: GuestRow[];
  total: number | null;
  hasMore: boolean | null;
  error: string | null;
  loading: boolean;
}

const EMPTY_APPEND: AppendState = {
  base: null,
  rows: [],
  total: null,
  hasMore: null,
  error: null,
  loading: false,
};

export default function CustomersPage(): JSX.Element {
  const { user } = useAuth();
  const rid = user?.restaurantUsername ?? "";
  const { currencySymbol } = useCurrency();
  const { timezone } = useTimezone();
  const money = useMemo(() => moneyOf(currencySymbol), [currencySymbol]);

  const [sort, setSort] = useState<GuestSortKey>("recent");
  const [segment, setSegment] = useState<CustomerSegmentKey>("all");
  const [search, setSearch] = useState("");
  const [openGuest, setOpenGuest] = useState<GuestRow | null>(null);

  const guests = useCachedFetch<GuestBookPayload>(
    `customers:guest-book:${rid}:${sort}:${segment}:${search}`,
    useCallback(async () => {
      const [page, leaders] = await Promise.all([
        fetchGuestPage(rid, { sort, segment, search }, 0),
        fetchGuestLeaders(rid, { segment, search }),
      ]);
      return { page, leaders, query: search };
    }, [rid, sort, segment, search]),
    { enabled: rid.length > 0 },
  );
  const payload = guests.data;
  const baseRows = useMemo(() => payload?.page.customers ?? [], [payload]);

  /* ── Pages 2+ (offset paging, deduplicated by customer_id) ──────────── */

  const [append, setAppend] = useState<AppendState>(EMPTY_APPEND);
  const extras = payload != null && append.base === payload ? append : EMPTY_APPEND;

  const shownRows = useMemo(
    () => (extras.rows.length === 0 ? baseRows : [...baseRows, ...extras.rows]),
    [baseRows, extras.rows],
  );
  const total = extras.total ?? payload?.page.total ?? 0;
  const hasMore = extras.hasMore ?? payload?.page.has_more ?? false;
  const loaded = shownRows.length;

  /* ── Honest segment counts (`_segmentCount`) ────────────────────────────
     The server computes `segment_counts` over the set AFTER its own segment
     filter, so a response for segment=regular reports 0 dormant guests — true
     of that response, and a flat lie on a tab that is meant to say how many
     dormant guests exist. Only an UNSEGMENTED response updates these, and
     they are only shown while the search they were taken under is in force. */

  const [counts, setCounts] = useState<{ map: Record<string, number>; query: string } | null>(null);
  useEffect(() => {
    if (payload?.page.segment !== "all") { return; }
    setCounts({ map: payload.page.segment_counts, query: payload.query });
  }, [payload]);

  /** The number on a segment tab, or null when there is no honest one to
   *  show. The active tab reports the server's `total` for exactly what is
   *  listed below it; anything else would be a number describing a different
   *  question. */
  const segmentCount = (seg: CustomerSegmentKey): number | null => {
    if (seg === segment) { return total; }
    if (counts?.query !== search) { return null; }
    const map: Record<string, number | undefined> = counts.map;
    const values = Object.values(counts.map);
    if (values.length === 0) { return null; }
    if (seg === "all") { return values.reduce((a, b) => a + b, 0); }
    return map[seg] ?? null;
  };

  const stateRef = useRef({ payload, shownRows, hasMore, loadingMore: extras.loading, rid, sort, segment, search });
  stateRef.current = { payload, shownRows, hasMore, loadingMore: extras.loading, rid, sort, segment, search };

  const loadMore = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    if (s.payload == null || s.loadingMore || !s.hasMore) { return; }
    const base = s.payload;
    setAppend((prev) => ({
      ...(prev.base === base ? prev : EMPTY_APPEND),
      base,
      loading: true,
    }));
    try {
      const res = await fetchGuestPage(
        s.rid,
        { sort: s.sort, segment: s.segment, search: s.search },
        s.shownRows.length,
      );
      // De-duplicate by customer_id, exactly like the app's `_ids` set — a
      // row without an id is always kept.
      const ids = new Set(s.shownRows.map((r) => r.customer_id).filter((id) => id !== ""));
      const fresh: GuestRow[] = [];
      for (const row of res.customers) {
        if (row.customer_id !== "") {
          if (ids.has(row.customer_id)) { continue; }
          ids.add(row.customer_id);
        }
        fresh.push(row);
      }
      if (res.segment === "all" && stateRef.current.payload === base) {
        setCounts({ map: res.segment_counts, query: s.search });
      }
      setAppend((prev) =>
        prev.base === base
          ? {
              base,
              rows: [...prev.rows, ...fresh],
              total: res.total,
              // An append that added nothing new stops the paging (the app's
              // `_hasMore = has_more && added > 0`).
              hasMore: res.has_more && fresh.length > 0,
              error: null,
              loading: false,
            }
          : prev,
      );
    } catch (e) {
      // An append failure prints its reason in the paging foot and stops
      // further auto-loads — the rows already on screen stay up.
      setAppend((prev) =>
        prev.base === base
          ? {
              ...prev,
              loading: false,
              error: e instanceof Error ? e.message : String(e),
              hasMore: false,
            }
          : prev,
      );
    }
  }, []);

  // Auto-append within 400px of the bottom (the app's `_onScroll`). Re-armed
  // after every landed page (`loaded`) so an append that still leaves the
  // foot nearby chains straight into the next one, exactly like the scroll
  // listener.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (el == null || loaded === 0) { return; }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { void loadMore(); }
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    io.observe(el);
    return () => { io.disconnect(); };
  }, [payload, guests.loading, guests.error, loaded, loadMore]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  const spendBasis = payload?.page.spend_basis ?? "";

  return (
    <div className="relative">
      <SectionHeader
        title="Guest book"
        // The server's count for the current filters, not how many rows have
        // been paged in.
        count={guests.loading ? undefined : total}
        trailing={loaded === 0 || loaded >= total ? undefined : <TickTag label={`${loaded} loaded`} />}
        className="mb-3"
      />

      <AppSearchField
        placeholder="Find a guest by name, phone or email…"
        aria-label="Find a guest by name, phone or email"
        debounceMs={300}
        onQuery={setSearch}
        className="mb-2.5"
      />

      <div className="mb-3 flex flex-col items-start gap-2.5">
        {/* One sort control. It orders the leaderboard band AND the list below
            it, so the two can never disagree about what "most spent" means. */}
        <Tabs value={sort} onValueChange={(value) => { setSort(value as GuestSortKey); }}>
          <TabsList>
            {CUSTOMER_SORTS.map((s) => (
              <TabsTrigger key={s.key} value={s.key}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          {CUSTOMER_SEGMENTS.map((s) => (
            <SegmentChip
              key={s.key}
              label={s.label}
              count={segmentCount(s.key)}
              selected={segment === s.key}
              onClick={() => {
                if (segment !== s.key) { setSegment(s.key); }
              }}
            />
          ))}
        </div>
      </div>

      {guests.loading ? (
        <div aria-busy="true" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonBox key={i} height={78} className="rounded-lg" />
          ))}
        </div>
      ) : guests.error != null ? (
        <LoadErrorState
          whatFailed="Couldn't load the guest book"
          error={guests.error}
          onRetry={guests.retry}
        />
      ) : shownRows.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Nothing to show"
          caption={
            search === "" && segment === "all"
              ? "No guests on record yet."
              : "No guests match these filters."
          }
        />
      ) : (
        <div>
          <SectionHeader
            title="Overview"
            trailing={
              <TickTag
                label={
                  segment === "all" && search === ""
                    ? `across all ${total} guests`
                    : `across the ${total} matching`
                }
              />
            }
          />
          <div className="grid grid-cols-1 gap-3.5 min-[760px]:grid-cols-2 min-[1120px]:grid-cols-3">
            {CUSTOMER_SORTS.map((s) => (
              <LeaderCard
                key={s.key}
                title={s.label}
                sortKey={s.key}
                activeSort={sort}
                rows={payload?.leaders.out[s.key] ?? []}
                error={payload?.leaders.failed[s.key] ?? null}
                loading={guests.loading}
                money={money}
                timezone={timezone}
                onOpenGuest={setOpenGuest}
              />
            ))}
          </div>

          <SectionHeader
            className="mt-5"
            title={`${customerSegmentLabel(segment)} · ${customerSortLabel(sort).toLowerCase()}`}
            count={total}
          />
          <div className="grid grid-cols-1 gap-3.5 min-[720px]:grid-cols-2 min-[1120px]:grid-cols-3 min-[1500px]:grid-cols-4">
            {shownRows.map((guest, i) => (
              <GuestCard
                key={guest.customer_id === "" ? `guest-${i}` : guest.customer_id}
                guest={guest}
                money={money}
                timezone={timezone}
                onOpen={setOpenGuest}
              />
            ))}
          </div>

          <div ref={sentinelRef} aria-hidden className="h-px" />
          <div className="mt-3">
            {extras.loading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 aria-hidden className="h-[13px] w-[13px] animate-spin text-accent-foreground" />
                Loading the next {GUEST_PAGE_SIZE}…
              </div>
            ) : hasMore ? (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={() => { void loadMore(); }}>
                  <ChevronDown /> Load more ({loaded} of {total})
                </Button>
              </div>
            ) : (
              <p
                className={
                  extras.error == null
                    ? "text-center text-xs text-muted-foreground"
                    : "text-center text-xs text-destructive"
                }
              >
                {extras.error ?? `All ${total} shown`}
              </p>
            )}
          </div>
        </div>
      )}

      <GuestSheet
        guest={openGuest}
        spendBasis={spendBasis}
        onOpenChange={(open) => {
          if (!open) { setOpenGuest(null); }
        }}
      />

      <CacheStalePill
        offline={guests.offline}
        fromCache={guests.fromCache}
        updatedAt={guests.updatedAt}
      />
    </div>
  );
}
