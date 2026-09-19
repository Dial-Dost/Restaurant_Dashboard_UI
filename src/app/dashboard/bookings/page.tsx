"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { CalendarCheck, CalendarDays, History, Inbox, Plus, QrCode, Search } from "lucide-react";

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
import { AppSearchField } from "@/components/ui/app-search-field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FocusBanner, useFocusRequest } from "@/components/focus-banner";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  assignBookingTables,
  getCustomers as getCustomersData,
  getSeatingSuggestion,
  type SeatingSuggestion,
  type SeatingSuggestionTable,
} from "@/lib/db";
import {
  createBooking,
  deleteBookingById,
  fetchBookings,
  fetchRoomTables,
  setBookingStatus,
  type BookingRow,
  type BookingWindow,
  type RoomTable,
} from "@/lib/api/bookings";
import { useTimezone } from "@/lib/use-timezone";
import { BookingCard } from "@/components/bookings/booking-card";
import { BookingDetailSheet } from "@/components/bookings/booking-detail-sheet";
import { fmtDmy, statusOf, tableLabelOf } from "@/components/bookings/booking-format";
import { NewBookingDialog, type NewBookingForm } from "@/components/bookings/new-booking-dialog";
import { RecentMessagesCard } from "@/components/bookings/recent-messages-card";
import { ReservationQrDialog } from "@/components/bookings/reservation-qr-dialog";
import {
  PlainTablePickDialog,
  SeatingSuggestionDialog,
  SingleTableDialog,
} from "@/components/bookings/seating-dialogs";

// The backend's default booking window; creation always asks the seating
// suggester about this window (Flutter `durationMins = 120`).
const BOOKING_DURATION_MINS = 120;

/* ── Web-extra free-text search (audit findings 21/28 — kept) ─────────── */

const digitsOnly = (value: string): string => value.replace(/[^0-9]/g, "");

const bookingHaystack = (booking: BookingRow, phone: string, whenLabel: string): string =>
  [
    booking.customer_name,
    phone,
    tableLabelOf(booking),
    statusOf(booking),
    booking.source,
    booking.notes,
    whenLabel,
    booking.booking_date_time ? booking.booking_date_time.slice(0, 10) : "",
    `${booking.number_of_people ?? ""} guests`,
    booking.deposit ? `deposit ${booking.deposit.status}` : "",
  ]
    .join(" ")
    .toLowerCase();

/**
 * A query made only of digits and phone punctuation is a PHONE lookup,
 * matched against the number's digits; anything else is a plain term-AND
 * text search.
 */
const matchesQuery = (haystack: string, phone: string, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) { return true; }

  const queryDigits = digitsOnly(trimmed);
  if (queryDigits.length >= 3 && /^[+\d\s().-]+$/.test(trimmed)) {
    const phoneDigits = digitsOnly(phone);
    // Tolerate a typed country code / trunk zero the stored number omits.
    const bare = queryDigits.replace(/^(91|0)/, "");
    return (
      (phoneDigits !== "" && (phoneDigits.includes(queryDigits) || phoneDigits.includes(bare))) ||
      haystack.includes(trimmed)
    );
  }

  return trimmed.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
};

/* ── Table-choice flow state ──────────────────────────────────────────── */

// What the picked tables are FOR: creating a new booking (the form already
// validated) or re-seating an existing one.
type PickIntent =
  | { type: "create"; form: NewBookingForm }
  | { type: "assign"; bookingId: string };

type TablePickState =
  | { kind: "single"; party: number; singles: SeatingSuggestionTable[]; intent: PickIntent }
  | { kind: "suggest"; party: number; suggestion: SeatingSuggestion; intent: PickIntent }
  | { kind: "plain"; tables: RoomTable[]; intent: PickIntent };

function BookingsPageInner(): JSX.Element {
  const { timezone } = useTimezone();
  const { currencySymbol } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const rid = user?.restaurantUsername ?? "";

  // Which slice of bookings to show — GET /get-bookings?window=. The selector
  // lives outside the loading view so it stays visible while a slice loads.
  const [bookingWindow, setBookingWindow] = useState<BookingWindow>("upcoming");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<BookingRow | null>(null);
  const [deleting, setDeleting] = useState<BookingRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [tablePick, setTablePick] = useState<TablePickState | null>(null);

  const bookings = useCachedFetch<BookingRow[]>(
    `bookings:${rid}:${bookingWindow}`,
    useCallback(() => fetchBookings(rid, bookingWindow), [rid, bookingWindow]),
    { enabled: rid.length > 0 },
  );
  const rows = useMemo(() => bookings.data ?? [], [bookings.data]);

  // customer_id -> phone. /get-bookings can omit customer_phone on older
  // backends, so the contact (and phone search) joins /get-customers.
  // Best-effort enrichment: the booking row's own phone always wins, and a
  // role without the customers permission simply gets no join.
  const phones = useCachedFetch<Record<string, string>>(
    `bookings:phones:${rid}`,
    useCallback(async () => {
      const customers = await getCustomersData(rid);
      const byId: Record<string, string> = {};
      for (const customer of Array.isArray(customers) ? customers : []) {
        if (customer.customerId && customer.phone) { byId[customer.customerId] = customer.phone; }
      }
      return byId;
    }, [rid]),
    { enabled: rid.length > 0 },
  );

  const phoneFor = useCallback(
    (booking: BookingRow): string =>
      booking.customer_phone ||
      ((booking.customer_id ? phones.data?.[booking.customer_id] : "") ?? ""),
    [phones.data],
  );

  /* ── Notification deep-link focus ───────────────────────────────────── */

  const focus = useFocusRequest();
  const focusId = focus?.idOf(["booking_id"]) ?? null;
  const focusFound = focusId != null && rows.some((b) => b.booking_id === focusId);

  const refresh = bookings.refresh;
  // A new focus request clears any active search (the record must not stay
  // hidden behind it) and refetches — the booking may have just arrived.
  useEffect(() => {
    if (!focus) { return; }
    setQuery("");
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.serial]);

  // The focused booking first so it is on screen without scrolling; with
  // nothing focused the server's earliest-first order already stands.
  const ordered = useMemo(() => {
    if (focusId == null) { return rows; }
    return [...rows].sort(
      (a, b) => (a.booking_id === focusId ? 0 : 1) - (b.booking_id === focusId ? 0 : 1),
    );
  }, [rows, focusId]);

  const visible = useMemo(
    () =>
      ordered.filter((booking) => {
        const phone = phoneFor(booking);
        return matchesQuery(
          bookingHaystack(booking, phone, fmtDmy(booking.booking_date_time, timezone)),
          phone,
          query,
        );
      }),
    [ordered, phoneFor, query, timezone],
  );

  /* ── Actions (every failure surfaces the server's words — no silence) ─ */

  const failToast = (error: unknown): void => {
    toast({
      title: String(error instanceof Error ? error.message : error),
      variant: "destructive",
    });
  };

  const setStatus = async (bookingId: string, status: string): Promise<void> => {
    try {
      await setBookingStatus(rid, bookingId, status);
      refresh();
    } catch (error) {
      failToast(error);
    }
  };

  // "Delete" stays behind the styled confirm dialog below; this runs after
  // the Confirm press.
  const reallyDelete = async (booking: BookingRow): Promise<void> => {
    try {
      await deleteBookingById(rid, booking.booking_id);
      refresh();
    } catch (error) {
      failToast(error);
    }
  };

  /**
   * Assign / combine tables for an existing booking (Flutter `assignTable`):
   * ask the suggester about the booking's own slot; a single free table still
   * fitting means the plain picker (least friction), no single fit means the
   * suggestion dialog, and an unusable suggester degrades to the plain picker.
   */
  const startAssign = async (booking: BookingRow): Promise<void> => {
    const party = booking.number_of_people ?? 0;
    let suggestion: SeatingSuggestion | null = null;
    if (party > 0) {
      suggestion = await getSeatingSuggestion(rid, {
        party,
        at: booking.booking_date_time,
        durationMins: booking.duration_mins ?? undefined,
      });
    }
    const fitsAlone = suggestion != null && suggestion.single.length > 0;
    const intent: PickIntent = { type: "assign", bookingId: booking.booking_id };
    if (suggestion != null && !fitsAlone) {
      setTablePick({ kind: "suggest", party, suggestion, intent });
      return;
    }
    try {
      const tables = await fetchRoomTables(rid);
      if (tables.length === 0) {
        toast({ title: "No tables to assign." });
        return;
      }
      setTablePick({ kind: "plain", tables, intent });
    } catch (error) {
      failToast(error);
    }
  };

  /**
   * "Choose table" pressed on the New-booking form (Flutter `_newBooking`):
   * the suggester decides what can hold the party at that time — singles get
   * the plain "Table for N" choice, otherwise the clubbing dialog. No table,
   * no booking.
   */
  const startCreate = async (form: NewBookingForm): Promise<void> => {
    setNewOpen(false);
    const suggestion = await getSeatingSuggestion(rid, {
      party: form.party,
      at: form.atIso,
      durationMins: BOOKING_DURATION_MINS,
    });
    const intent: PickIntent = { type: "create", form };
    if (suggestion != null && suggestion.single.length > 0) {
      setTablePick({ kind: "single", party: form.party, singles: suggestion.single, intent });
    } else if (suggestion != null) {
      setTablePick({ kind: "suggest", party: form.party, suggestion, intent });
    } else {
      // The suggester is unusable (offline, or no permission) — a table is
      // mandatory, so nothing was created.
      toast({
        title: "Couldn't check which tables are free — the booking wasn't created.",
        variant: "destructive",
      });
    }
  };

  const onTablesPicked = async (names: string[]): Promise<void> => {
    const pick = tablePick;
    setTablePick(null);
    if (!pick || names.length === 0) { return; }
    if (pick.intent.type === "assign") {
      try {
        // Always explicit: a single pick un-clubs a previously joined set.
        await assignBookingTables(rid, pick.intent.bookingId, names[0], names.slice(1));
        refresh();
      } catch (error) {
        failToast(error);
      }
      return;
    }
    const form = pick.intent.form;
    try {
      await createBooking(rid, {
        name: form.name,
        phone: form.phone,
        party: form.party,
        atIso: form.atIso,
        source: form.source,
        tableNames: names,
      });
      toast({ title: `Booked ${names.join(" + ")} for ${form.party} — ${form.name}` });
      refresh();
    } catch (error) {
      failToast(error);
    }
  };

  /* ── Reservation link ───────────────────────────────────────────────── */

  const [reservationUrl, setReservationUrl] = useState("");
  useEffect(() => {
    if (!rid || typeof window === "undefined") { return; }
    setReservationUrl(`${window.location.origin}/reserve/${encodeURIComponent(rid)}`);
  }, [rid]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  const emptyCaption =
    bookingWindow === "past"
      ? "No past bookings."
      : bookingWindow === "all"
        ? "No bookings yet."
        : "No upcoming bookings. New reservations will appear here.";

  const banner = focus != null && (
    <FocusBanner
      found={focusFound}
      message={
        focusFound
          ? "Showing the booking from your notification."
          : bookingWindow !== "upcoming"
            ? "That booking isn't here — it may have been deleted, or belong to another outlet."
            : "That booking isn't in the upcoming list — its time slot has already passed."
      }
      actions={
        !focusFound && bookingWindow === "upcoming" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setBookingWindow("all"); }}
          >
            <History /> Show all bookings
          </Button>
        ) : undefined
      }
      onDismiss={focus.dismiss}
      showAllLabel="Dismiss"
    />
  );

  return (
    <div className="grid gap-4">
      {/* The window selector + New booking live ABOVE the async view so they
          stay visible (and switching feels instant) while a slice loads.
          Below the app-wide 760px narrow edge the selector takes its own
          full-width line and the button drops right-aligned under it. */}
      <div className="flex flex-col gap-2.5 min-[760px]:flex-row min-[760px]:items-center">
        <div className="min-w-0 min-[760px]:flex-1">
          <Tabs
            value={bookingWindow}
            onValueChange={(value) => { setBookingWindow(value as BookingWindow); }}
          >
            <TabsList>
              <TabsTrigger value="upcoming">
                <CalendarCheck aria-hidden className="mr-1.5 h-[15px] w-[15px]" /> Upcoming
              </TabsTrigger>
              <TabsTrigger value="past">
                <History aria-hidden className="mr-1.5 h-[15px] w-[15px]" /> Past
              </TabsTrigger>
              <TabsTrigger value="all">
                <CalendarDays aria-hidden className="mr-1.5 h-[15px] w-[15px]" /> All
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { setNewOpen(true); }}>
            <Plus /> New booking
          </Button>
        </div>
      </div>

      {bookings.loading ? (
        <SkeletonRows rows={6} />
      ) : bookings.error ? (
        <LoadErrorState
          whatFailed="Couldn't load bookings."
          error={bookings.error}
          onRetry={bookings.retry}
        />
      ) : (
        <div className="relative">
          <SectionHeader
            title="Bookings"
            count={rows.length}
            trailing={
              <Button variant="ghost" size="sm" onClick={() => { setQrOpen(true); }}>
                <QrCode /> Share reservation link
              </Button>
            }
          />

          {/* Web-extra free-text search over the loaded slice (audit 21/28). */}
          {rows.length > 0 && (
            <div className="mb-3.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <AppSearchField
                key={focus?.serial ?? "bookings-search"}
                onQuery={setQuery}
                debounceMs={200}
                compact
                placeholder="Search name, phone, table, status, source, date…"
                aria-label="Search bookings"
                className="w-full sm:max-w-sm"
              />
              {query ? (
                <p className="shrink-0 text-xs text-muted-foreground">
                  {visible.length} of {rows.length} booking{rows.length === 1 ? "" : "s"} match
                </p>
              ) : null}
            </div>
          )}

          {banner}

          {rows.length === 0 ? (
            <EmptyState icon={<Inbox />} title="Nothing to show" caption={emptyCaption} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="Nothing to show"
              caption={`No booking matches “${query}”.`}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3.5 min-[720px]:grid-cols-2 min-[1120px]:grid-cols-3 min-[1500px]:grid-cols-4">
              {visible.map((booking) => (
                <BookingCard
                  key={booking.booking_id}
                  booking={booking}
                  whenLabel={fmtDmy(booking.booking_date_time, timezone)}
                  focused={focusId != null && booking.booking_id === focusId}
                  currencySymbol={currencySymbol}
                  onOpen={() => { setDetail(booking); }}
                  onConfirm={() => { void setStatus(booking.booking_id, "Confirmed"); }}
                  onDecline={() => { void setStatus(booking.booking_id, "Cancelled"); }}
                />
              ))}
            </div>
          )}

          <CacheStalePill
            offline={bookings.offline}
            fromCache={bookings.fromCache}
            updatedAt={bookings.updatedAt}
          />
        </div>
      )}

      <RecentMessagesCard restaurantId={rid} />

      {/* Everything a card cannot hold, plus every stage change. */}
      <BookingDetailSheet
        booking={detail}
        onOpenChange={(open) => { if (!open) { setDetail(null); } }}
        phone={detail ? phoneFor(detail) : ""}
        onAssign={(b) => { void startAssign(b); }}
        onMarkConfirmed={(b) => { void setStatus(b.booking_id, "Confirmed"); }}
        onMarkSeated={(b) => { void setStatus(b.booking_id, "Seated"); }}
        onCancelBooking={(b) => { void setStatus(b.booking_id, "Cancelled"); }}
        onDelete={(b) => { setDeleting(b); }}
      />

      {/* Delete is the one destructive, unrecoverable action — always behind
          this confirmation (Flutter `_confirm('Delete booking', …)`). */}
      <AlertDialog open={deleting != null} onOpenChange={(open) => { if (!open) { setDeleting(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete booking</AlertDialogTitle>
            <AlertDialogDescription>Remove this booking?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (target) { void reallyDelete(target); }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewBookingDialog open={newOpen} onOpenChange={setNewOpen} onSubmit={(form) => { void startCreate(form); }} />

      <SingleTableDialog
        open={tablePick?.kind === "single"}
        party={tablePick?.kind === "single" ? tablePick.party : 0}
        singles={tablePick?.kind === "single" ? tablePick.singles : []}
        onPick={(names) => { void onTablesPicked(names); }}
        onOpenChange={(open) => { if (!open) { setTablePick(null); } }}
      />

      {tablePick?.kind === "suggest" && (
        <SeatingSuggestionDialog
          open
          party={tablePick.party}
          suggestion={tablePick.suggestion}
          onPick={(names) => { void onTablesPicked(names); }}
          onOpenChange={(open) => { if (!open) { setTablePick(null); } }}
        />
      )}

      <PlainTablePickDialog
        open={tablePick?.kind === "plain"}
        tables={tablePick?.kind === "plain" ? tablePick.tables : []}
        onPick={(name) => { void onTablesPicked([name]); }}
        onOpenChange={(open) => { if (!open) { setTablePick(null); } }}
      />

      <ReservationQrDialog open={qrOpen} onOpenChange={setQrOpen} url={reservationUrl} />
    </div>
  );
}

// useSearchParams (via useFocusRequest) requires a Suspense boundary
// (same pattern as the accounting and queue pages).
export default function BookingsPage(): JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <BookingsPageInner />
    </Suspense>
  );
}
