
"use client";

import { Fragment, Suspense, useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Link2, MoreHorizontal, PlusCircle, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  getBookings as getBookingsData,
  getCustomers as getCustomersData,
  getTables as getTablesData,
  getSeatingSuggestion,
  assignBookingTables,
  requestBackend,
  type SeatingSuggestion,
} from "@/lib/db"; //addAuditLogEntry,
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { isMobile10, MOBILE_10_ERROR, normalizeMobile10, PHONE_INPUT_PROPS, sanitizePhoneInput } from "@/lib/phone";
import { formatDate, formatDateTime, formatFullDateTime, formatLongDate, formatTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import { type Booking } from "./data";
import { type Table as TableType } from "../tables/data";

const bookingSchema = z.object({
  customer: z.string().min(1, "Customer name is required."),
  // Exactly 10 digits — the same rule POST /add-booking enforces server-side, so
  // the form can never submit something the API is going to 400.
  contact: z.string().refine(isMobile10, MOBILE_10_ERROR),
  guests: z.coerce.number().min(1, "At least one guest is required."),
  time: z.string().min(1, "Time is required."),
  table: z.string().optional(),
  source: z.string().min(1, "Source is required."),
  notes: z.string().optional(),
});

type BookingFormData = z.infer<typeof bookingSchema>;

// On-spot bookings are for TODAY at the entered time and run for the backend's
// default 120-minute window — the seating suggester is asked about that window.
const BOOKING_DURATION_MINS = 120;

const bookingStartIso = (time: string): string | null => {
  if (!time) {return null;}
  const [hour, minute] = time.split(":");
  const start = new Date();
  start.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
  return Number.isNaN(start.getTime()) ? null : start.toISOString();
};

// Every table a booking holds, primary first. Clubbed bookings read "T1 + T2".
const bookingTableLabel = (booking: Booking): string => {
  const names = Array.isArray(booking.table_names) && booking.table_names.length > 0
    ? booking.table_names
    : (booking.table ? [booking.table] : []);
  return names.length > 0 ? names.join(" + ") : "Unassigned";
};

const isCombinedBooking = (booking: Booking): boolean =>
  Array.isArray(booking.table_names) && booking.table_names.length > 1;

const createBookingId = (value: unknown) => {
  if (value !== null && value !== undefined) {
    return value.toString();
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

type BookingWindow = 'upcoming' | 'past' | 'all';

const BOOKING_WINDOWS: { value: BookingWindow; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

/*
  `booking.time` from the API already reads "Jul 28, 07:30 PM". The dense row
  splits that: the clock alone in the Time column, with the day beside it only
  when the list can span more than today (Past / All).
*/
const clockTime = (booking: Booking, timeZone: string): string => {
  if (!booking.date_time) {return booking.time;}
  return formatTime(booking.date_time, timeZone, booking.time);
};

/** Short "28 Jul" for the dense row; the expanded panel spells the date out. */
const shortDate = (iso: string | null | undefined, timeZone: string): string => {
  if (!iso) {return "";}
  const long = formatLongDate(iso, timeZone, "");
  // "28 Jul 2026" -> "28 Jul"; the year is noise in a dense row.
  return long ? long.split(" ").slice(0, 2).join(" ") : "";
};

/** Full reserved window: "Mon, 28 Jul 2026, 19:30 — 21:00 (90 min)". */
const bookingWindowLabel = (booking: Booking, timeZone: string): string => {
  if (!booking.date_time) {return booking.time;}
  const start = new Date(booking.date_time);
  if (Number.isNaN(start.getTime())) {return booking.time;}
  const mins = booking.duration_mins && booking.duration_mins > 0 ? booking.duration_mins : BOOKING_DURATION_MINS;
  const end = new Date(start.getTime() + mins * 60_000);
  // The reservation was TAKEN in the restaurant's zone (the backend parses the
  // booking wall clock with the same setting), so it must be READ back in it.
  const day = formatLongDate(start, timeZone);
  return `${day}, ${formatTime(start, timeZone)} — ${formatTime(end, timeZone)} (${mins} min)`;
};

/*
  Everything one booking can be found by, flattened once per render pass.
  /get-bookings carries no phone number, so the contact is joined in from
  /get-customers on customer_id and indexed here both raw and digits-only —
  "98765" has to match "+91 98765 43210".
*/
const bookingHaystack = (booking: Booking, phone: string, timeZone: string): string =>
  [
    booking.customer,
    phone,
    bookingTableLabel(booking),
    booking.status,
    booking.source,
    booking.booked_from ?? "",
    booking.notes ?? "",
    booking.time,
    shortDate(booking.date_time, timeZone),
    booking.date_time ? formatDate(booking.date_time, timeZone, "") : "",
    booking.date_time ? booking.date_time.slice(0, 10) : "",
    `${booking.guests} guests`,
    booking.deposit ? `deposit ${booking.deposit.status}` : "",
  ]
    .join(" ")
    .toLowerCase();

/**
 * A query made only of digits and phone punctuation is a PHONE lookup, matched
 * against the number's digits so "+91 98765" finds "9876543210". Anything else
 * is a plain term-AND text search ("liam 19:" narrows down), which is what
 * keeps a short term like "T2" matching the table and not every row that
 * happens to contain a 2.
 */
const matchesQuery = (haystack: string, phone: string, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {return true;}

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

const statusBadgeVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
  if (status === "Confirmed") {return "default";}
  if (status === "Arrived" || status === "Seated") {return "secondary";}
  if (status === "Cancelled" || status === "No-show") {return "destructive";}
  return "outline";
};

function BookingsPageInner() {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  // Upcoming / Past / All view. Default "upcoming" keeps today's operational
  // list, but past-dated bookings stay reachable so one never just disappears
  // the moment its slot ends (GET /get-bookings?window=).
  const [bookingWindow, setBookingWindow] = useState<BookingWindow>('upcoming');
  // Free-text filter across name / phone / table / status / source / notes / date.
  const [query, setQuery] = useState("");
  // One expanded booking at a time — a hundred half-open rows is not scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // customer_id -> phone, joined in from /get-customers (bookings carry no number).
  const [phoneByCustomer, setPhoneByCustomer] = useState<Record<string, string>>({});
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [tables, setTables] = useState<TableType[]>([]);
  // Re-seating an existing booking (assign a table, or club several together).
  const [assigning, setAssigning] = useState<Booking | null>(null);
  const [assignSelection, setAssignSelection] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // A reservation notification links here as ?highlightBooking=<booking id>;
  // ring and scroll to that row rather than dropping the user on the list.
  const highlight = useHighlightRow("highlightBooking", bookings.length);

  const phoneFor = (booking: Booking) =>
    (booking.customer_id ? phoneByCustomer[booking.customer_id] : "") ?? "";

  const visibleBookings = useMemo(
    () => bookings.filter((booking) => {
      const phone = phoneFor(booking);
      return matchesQuery(bookingHaystack(booking, phone, timezone), phone, query);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings, phoneByCustomer, query],
  );

  // A deep-linked booking must not stay hidden behind an active search.
  useEffect(() => {
    if (highlight.id) {setQuery("");}
  }, [highlight.id]);

  // const recordAuditEntry = async (action: string, details: string) => {
  //   if (!user?.restaurantUsername) return;

  //     try {
  //       await addAuditLogEntry(user.restaurantUsername, {
  //       employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
  //       employeeId: user?.employeeId,
  //       action,
  //       details,
  //     });
  //   } catch (auditError) {
  //     console.warn("Failed to record audit entry", auditError);
  //   }
  // };

  const loadBookings = async () => {
    if (!user?.restaurantUsername) {
      return;
    }

    try {
      const data = await getBookingsData(user.restaurantUsername, bookingWindow);
      const mapped: Booking[] = (Array.isArray(data) ? data : []).map((item: Booking) => ({
        ...item,
        id: createBookingId(item.id),
      }));
      setBookings(mapped);
    } catch (error) {
      console.error("Failed to load bookings", error);
    }
  };

  const loadTables = async () => {
    if (!user?.restaurantUsername) {
      return;
    }

    try {
      const data = await getTablesData(user.restaurantUsername);
      setTables(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load tables", error);
    }
  };
  
  useEffect(() => {
    if (!user?.restaurantUsername) {
      return;
    }

    let isActive = true;

    (async () => {
      try {
        const data = await getBookingsData(user.restaurantUsername, bookingWindow);
        if (!isActive) {return;}
        const mapped: Booking[] = (Array.isArray(data) ? data : []).map((item: Booking) => ({
          ...item,
          id: createBookingId(item.id),
        }));
        setBookings(mapped);
      } catch (error) {
        console.error("Failed to load bookings", error);
        if (isActive) {setBookings([]);}
      }

      try {
        const t = await getTablesData(user.restaurantUsername);
        if (!isActive) {return;}
        setTables(Array.isArray(t) ? t : []);
      } catch (error) {
        console.error("Failed to load tables", error);
        if (isActive) {setTables([]);}
      }

      // Contact numbers for search + the detail panel. Best-effort: a role
      // without the customers permission just gets no phone column.
      try {
        const customers = await getCustomersData(user.restaurantUsername);
        if (!isActive) {return;}
        const byId: Record<string, string> = {};
        for (const customer of Array.isArray(customers) ? customers : []) {
          if (customer.customerId && customer.phone) {byId[customer.customerId] = customer.phone;}
        }
        setPhoneByCustomer(byId);
      } catch (error) {
        console.warn("Failed to load customer contacts", error);
      }
    })();

    return () => { isActive = false; };
  }, [user?.restaurantUsername, bookingWindow]);

  const handleAddBooking = async (data: BookingFormData, combinedTables: string[] = []) => {
    if (!user?.restaurantUsername) {return;}

    // Validated as 10 digits by the schema; normalize so "+91 98765 43210" and
    // "9876543210" store identically (the backend normalizes the same way).
    const sanitizedContact = normalizeMobile10(data.contact) ?? data.contact.replace(/[^0-9]/g, "");
    const reservationDate = new Date();
    const [hour, minute] = data.time.split(":");
    reservationDate.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);

    const requestedTable = data.table?.trim() || undefined;
    // Extra clubbed tables, only ever the ones a staff member confirmed.
    const extraTables = combinedTables.map((name) => name.trim()).filter(Boolean);

    try {
      const response = await requestBackend({
        path: "/add-booking",
        method: "POST",
        restaurantId: user.restaurantUsername,
        body: {
          restaurantId: user.restaurantUsername,
          customer: {
            name: data.customer,
            number: sanitizedContact,
          },
          booking: {
            table_name: requestedTable,
            ...(extraTables.length > 0 ? { combined_table_names: extraTables } : {}),
            date: reservationDate.toISOString(),
            duration: 120,
            number_of_people: data.guests,
            source: data.source,
            status: "Confirmed",
            from: "dashboard",
            notes: data.notes?.trim() || undefined,
          },
        },
      });

      if (!response.ok) {
        throw new Error(response.text || "Failed to create booking");
      }

      // await recordAuditEntry(
      //   "Booking Create",
      //   requestedTable
      //     ? `Created booking for ${data.customer} at table ${requestedTable}`
      //     : `Created booking for ${data.customer} (table unassigned)`,
      // );

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to create booking", error);
      throw error;
    }
  }

  const handleCancelBooking = async (booking: Booking) => {
    if (!user?.restaurantUsername) {return;}

    try {
      const response = await requestBackend({
        path: `/booking/${encodeURIComponent(booking.id)}`,
        method: "DELETE",
        restaurantId: user.restaurantUsername,
      });

      if (!response.ok) {
        throw new Error(response.text || "Failed to cancel booking");
      }

      // await recordAuditEntry(
      //   "Booking Cancel",
      //   `Cancelled booking for ${booking.customer} at table ${booking.table || "Unassigned"}`,
      // );

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to cancel booking", error);
    }
  }

  const handleStatusChange = async (booking: Booking, status: Booking['status']) => {
    if (!user?.restaurantUsername) {return;}

    try {
      const response = await requestBackend({
        path: `/booking/${encodeURIComponent(booking.id)}/status`,
        method: "PATCH",
        restaurantId: user.restaurantUsername,
        body: { status },
      });

      if (!response.ok) {
        throw new Error(response.text || "Failed to update booking status");
      }

      // await recordAuditEntry(
      //   "Booking Status",
      //   `Updated booking ${booking.id} status to ${status}`,
      // );

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to update booking status", error);
    }
  }

  const openAssignTables = (booking: Booking) => {
    setAssigning(booking);
    setAssignSelection(
      Array.isArray(booking.table_names) && booking.table_names.length > 0
        ? booking.table_names
        : (booking.table ? [booking.table] : []),
    );
    setAssignError(null);
  };

  // Staff pressed "Save seating" — this is the only place an existing booking's
  // table set changes, and only to exactly what they selected.
  const handleAssignTables = async () => {
    if (!assigning || !user?.restaurantUsername) {return;}
    if (assignSelection.length === 0) {
      setAssignError("Pick at least one table.");
      return;
    }

    setAssignBusy(true);
    setAssignError(null);
    try {
      await assignBookingTables(
        user.restaurantUsername,
        assigning.id,
        assignSelection[0],
        assignSelection.slice(1),
      );
      setAssigning(null);
      await loadBookings();
      await loadTables();
    } catch (error: any) {
      setAssignError(String(error?.message ?? "Failed to save the table assignment."));
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Bookings</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Booking
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create On-Spot Booking</DialogTitle>
              <DialogDescription>
                Fill in the details to create a new booking instantly.
              </DialogDescription>
            </DialogHeader>
            <BookingForm
              onSubmit={handleAddBooking}
              afterSubmit={() => { setIsDialogOpen(false); }}
              tables={tables}
            />
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>
                {bookingWindow === "past" ? "Past Bookings" : bookingWindow === "all" ? "All Bookings" : "Current Bookings"}
              </CardTitle>
              <CardDescription>
                {bookingWindow === "past"
                  ? "Bookings whose time slot has already ended."
                  : bookingWindow === "all"
                  ? "Every booking — upcoming first, then past."
                  : "Active and upcoming bookings for today."}
                {" "}Click a row for the full detail.
              </CardDescription>
            </div>
            <div className="flex w-fit gap-1 rounded-md border p-1">
              {BOOKING_WINDOWS.map((w) => (
                <Button
                  key={w.value}
                  type="button"
                  size="sm"
                  variant={bookingWindow === w.value ? "default" : "ghost"}
                  onClick={() => { setBookingWindow(w.value); }}
                >
                  {w.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); }}
                placeholder="Search name, phone, table, status, source, date…"
                aria-label="Search bookings"
                className="pl-8 pr-8"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => { setQuery(""); }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {query
                ? `${visibleBookings.length} of ${bookings.length} booking${bookings.length === 1 ? "" : "s"} match`
                : `${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {/*
            Dense list: a service can hold ~100 bookings, so every row is one
            line of ~34px and the wide fields (notes, source, contact) live in
            the expansion instead of stretching the grid.
          */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 px-1" />
                <TableHead className="h-9 w-[86px] px-2">Time</TableHead>
                <TableHead className="h-9 px-2">Customer</TableHead>
                <TableHead className="h-9 w-[52px] px-2 text-center">Pax</TableHead>
                <TableHead className="hidden h-9 w-[120px] px-2 sm:table-cell">Table</TableHead>
                <TableHead className="hidden h-9 w-[110px] px-2 lg:table-cell">Source</TableHead>
                <TableHead className="h-9 w-[130px] px-2">Status</TableHead>
                <TableHead className="h-9 w-[44px] px-1">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBookings.map((booking) => {
                const rowProps = highlight.rowProps(booking.id);
                const isExpanded = expandedId === booking.id;
                const phone = phoneFor(booking);
                const toggle = () => { setExpandedId(isExpanded ? null : booking.id); };
                return (
                  <Fragment key={booking.id}>
                    <TableRow
                      {...rowProps}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={toggle}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggle();
                        }
                      }}
                      className={cn(rowProps.className, "cursor-pointer", isExpanded && "bg-muted/50")}
                    >
                      <TableCell className="px-1 py-1.5 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 text-sm tabular-nums">
                        {clockTime(booking, timezone)}
                        {bookingWindow !== "upcoming" && shortDate(booking.date_time, timezone) ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">{shortDate(booking.date_time, timezone)}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate px-2 py-1.5 text-sm font-medium" title={booking.customer}>
                        {booking.customer}
                        <span className="ml-2 text-xs font-normal text-muted-foreground sm:hidden">
                          {bookingTableLabel(booking)}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-center text-sm tabular-nums">{booking.guests}</TableCell>
                      <TableCell className="hidden px-2 py-1.5 text-sm sm:table-cell">
                        <span className="flex items-center gap-1">
                          {isCombinedBooking(booking) ? <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}
                          <span className="truncate">{bookingTableLabel(booking)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden truncate px-2 py-1.5 text-sm lg:table-cell">{booking.source}</TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={statusBadgeVariant(booking.status)} className="text-[10px]">
                            {booking.status}
                          </Badge>
                          <DepositBadge deposit={booking.deposit} compact />
                        </div>
                      </TableCell>
                      <TableCell
                        className="px-1 py-1.5"
                        onClick={(event) => { event.stopPropagation(); }}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Toggle menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>Change Status</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem onClick={() => handleStatusChange(booking, 'Confirmed')}>Confirmed</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange(booking, 'Arrived')}>Arrived</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange(booking, 'Seated')}>Seated</DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuItem onSelect={() => { openAssignTables(booking); }}>
                              Assign / combine tables
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleCancelBooking(booking)} className="text-destructive">
                              Cancel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="bg-muted/30 px-4 py-3">
                          <BookingDetail booking={booking} phone={phone} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          {visibleBookings.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {query
                ? `No booking matches “${query}”.`
                : bookingWindow === "upcoming"
                ? "No upcoming bookings — switch to Past or All to see earlier reservations."
                : bookingWindow === "past"
                ? "No past bookings yet."
                : "No bookings found."}
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={assigning !== null} onOpenChange={(open) => { if (!open) {setAssigning(null);} }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Seating for {assigning?.customer}</DialogTitle>
            <DialogDescription>
              {assigning ? `Party of ${assigning.guests} · ${assigning.time}` : ""} — accept a suggestion or pick the
              tables yourself. Nothing is assigned until you save.
            </DialogDescription>
          </DialogHeader>
          {assigning && user?.restaurantUsername ? (
            <SeatingSuggestionPanel
              restaurantId={user.restaurantUsername}
              party={Math.max(1, assigning.guests)}
              at={assigning.date_time ?? null}
              selected={assignSelection}
              onSelect={setAssignSelection}
              alwaysShowManual
            />
          ) : null}
          {assignError ? <p className="text-sm text-destructive">{assignError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssigning(null); }}>Cancel</Button>
            <Button onClick={handleAssignTables} disabled={assignBusy || assignSelection.length === 0}>
              {assignBusy ? "Saving…" : "Save seating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecentMessagesCard />
    </div>
  );
}

// Delivery visibility for automated guest messaging (confirmations, reminders,
// WhatsApp replies). Admin-only endpoint — the card hides itself when the
// backend refuses (non-admin) or there is nothing to show yet.
interface OutboundMessage {
  id: string;
  channel: string;
  to_phone: string | null;
  body: string | null;
  kind: string | null;
  ref_id: string | null;
  status: string;
  error: string | null;
  provider: string | null;
  created_at: string;
}

function RecentMessagesCard() {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const [messages, setMessages] = useState<OutboundMessage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.restaurantUsername) {return;}
      const response = await requestBackend<OutboundMessage[]>({
        path: "/messages",
        method: "GET",
        restaurantId: user.restaurantUsername,
      });
      if (!cancelled && response.ok && Array.isArray(response.data)) {
        setMessages(response.data);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.restaurantUsername]);

  if (!messages || messages.length === 0) {return null;}

  const statusStyles: Record<string, string> = {
    sent: "border-green-300 bg-green-50 text-green-800",
    failed: "border-red-300 bg-red-50 text-red-800",
    skipped_no_provider: "border-neutral-300 bg-neutral-100 text-neutral-600",
  };
  const statusLabels: Record<string, string> = {
    sent: "Sent",
    failed: "Failed",
    skipped_no_provider: "No provider",
  };
  const kindLabels: Record<string, string> = {
    booking_confirm: "Confirmation",
    booking_reminder: "Reminder",
    wa_reply: "WhatsApp reply",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent messages</CardTitle>
        <CardDescription>
          Automated guest messages (booking confirmations, reminders and WhatsApp
          replies) and whether they were delivered to the provider. Configure the
          SMS/WhatsApp provider in the owner app settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Message</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-sm" title={formatFullDateTime(m.created_at, timezone)}>
                  {formatDateTime(m.created_at, timezone)}
                </TableCell>
                <TableCell className="text-sm">
                  <div>{m.to_phone || "-"}</div>
                  <div className="text-xs text-muted-foreground">{m.channel}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">
                  {kindLabels[m.kind ?? ""] ?? m.kind ?? "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell max-w-[320px] truncate text-sm text-muted-foreground" title={m.body ?? ""}>
                  {m.body || "-"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusStyles[m.status] ?? ""}>
                    {statusLabels[m.status] ?? m.status}
                  </Badge>
                  {m.error ? (
                    <div className="mt-1 max-w-[220px] truncate text-xs text-red-600" title={m.error}>
                      {m.error}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Reservation-deposit state badge: pending (unpaid Razorpay order), paid,
// refund_due (early cancel — refund manually from Razorpay) or forfeited.
// `compact` is the dense-row form: the amount only, full wording on hover.
function DepositBadge({ deposit, compact = false }: { deposit?: Booking["deposit"]; compact?: boolean }) {
  if (!deposit) {return null;}
  const styles: Record<string, string> = {
    pending: "border-amber-300 bg-amber-50 text-amber-800",
    paid: "border-green-300 bg-green-50 text-green-800",
    refund_due: "border-red-300 bg-red-50 text-red-800",
    forfeited: "border-neutral-300 bg-neutral-100 text-neutral-600",
  };
  const labels: Record<string, string> = {
    pending: `Deposit ₹${deposit.amount} pending`,
    paid: `Deposit ₹${deposit.amount} paid`,
    refund_due: `Refund due ₹${deposit.amount}`,
    forfeited: `Deposit ₹${deposit.amount} forfeited`,
  };
  const compactLabels: Record<string, string> = {
    pending: `₹${deposit.amount} due`,
    paid: `₹${deposit.amount} paid`,
    refund_due: `₹${deposit.amount} refund`,
    forfeited: `₹${deposit.amount} kept`,
  };
  const full = labels[deposit.status] ?? `Deposit ₹${deposit.amount}`;
  return (
    <Badge
      variant="outline"
      title={compact ? full : undefined}
      className={cn(styles[deposit.status] ?? "", compact && "text-[10px]")}
    >
      {compact ? (compactLabels[deposit.status] ?? `₹${deposit.amount}`) : full}
    </Badge>
  );
}

/*
  The expansion behind a booking row. Everything the dense grid cannot afford to
  show inline: the reserved window, the party, the contact, every table it holds
  (clubbed sets read "T1 + T2"), where it came from, notes, deposit and minimum
  spend. Read-only — the row's own menu is still the single place things change.
*/
function BookingDetail({ booking, phone }: { booking: Booking; phone: string }) {
  const { timezone } = useTimezone();
  const tableNames = Array.isArray(booking.table_names) && booking.table_names.length > 0
    ? booking.table_names
    : (booking.table ? [booking.table] : []);

  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("When", bookingWindowLabel(booking, timezone))}
        {field("Party", `${booking.guests} guest${booking.guests === 1 ? "" : "s"}`)}
        {field(
          "Contact",
          phone ? (
            <a href={`tel:${digitsOnly(phone)}`} className="underline underline-offset-2">
              {phone}
            </a>
          ) : (
            <span className="text-muted-foreground">Not on file</span>
          ),
        )}
        {field(
          "Table(s)",
          tableNames.length > 0 ? (
            <span className="flex items-center gap-1">
              {isCombinedBooking(booking) ? <Link2 className="h-3.5 w-3.5 text-amber-500" /> : null}
              {tableNames.join(" + ")}
              {isCombinedBooking(booking) ? (
                <span className="text-xs text-muted-foreground">(clubbed, {tableNames[0]} primary)</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          ),
        )}
        {field("Source", booking.source || "Unknown")}
        {field("Taken on", booking.booked_from ? booking.booked_from : <span className="text-muted-foreground">—</span>)}
        {field(
          "Status",
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant={statusBadgeVariant(booking.status)}>{booking.status}</Badge>
            <DepositBadge deposit={booking.deposit} />
          </span>,
        )}
        {field(
          "Min spend",
          booking.min_spend ? `₹${booking.min_spend}` : <span className="text-muted-foreground">None</span>,
        )}
      </dl>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">
          {booking.notes || <span className="text-muted-foreground">No notes.</span>}
        </p>
      </div>
      <p className="font-mono text-[10px] text-muted-foreground">Booking {booking.id}</p>
    </div>
  );
}

/*
  Seating suggester — SUGGESTS, staff confirm. Shown when the party is bigger
  than any single free table can take (a table's "max with extra chairs"). It
  proposes clubbing consecutively-numbered adjacent tables and lets staff accept
  one, or pick a completely different set by hand. Nothing is ever auto-assigned:
  the parent only sends what is selected here.
*/
function SeatingSuggestionPanel({
  restaurantId,
  party,
  at,
  selected,
  onSelect,
  alwaysShowManual = false,
}: {
  restaurantId: string;
  party: number;
  at: string | null;
  selected: string[];
  onSelect: (tableNames: string[]) => void;
  alwaysShowManual?: boolean;
}) {
  const [suggestion, setSuggestion] = useState<SeatingSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [showManual, setShowManual] = useState(alwaysShowManual);

  useEffect(() => {
    if (!restaurantId || party < 1) {return;}

    let cancelled = false;
    setLoading(true);
    setUnavailable(false);

    // Debounced — `party` changes on every keystroke in the Guests field.
    const timer = setTimeout(() => {
      getSeatingSuggestion(restaurantId, { party, at, durationMins: BOOKING_DURATION_MINS })
        .then((data) => {
          if (cancelled) {return;}
          setSuggestion(data);
          setUnavailable(data === null);
        })
        .catch(() => {
          if (cancelled) {return;}
          setSuggestion(null);
          setUnavailable(true);
        })
        .finally(() => {
          if (!cancelled) {setLoading(false);}
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [restaurantId, party, at]);

  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((name) => b.includes(name));

  const toggleManual = (name: string) => {
    onSelect(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  };

  const manualTotal = (suggestion?.free_tables ?? [])
    .filter((t) => selected.includes(t.table_name))
    .reduce((sum, t) => sum + t.max_capacity, 0);

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p className="font-medium">
        {suggestion && suggestion.single.length === 0 && suggestion.combinations.length > 0
          ? `Party of ${party} needs ${suggestion.combinations[0].table_names.length} tables — combine ${suggestion.combinations[0].table_names.join(" + ")}?`
          : `Seating for a party of ${party}`}
      </p>

      {loading && <p className="mt-1 text-muted-foreground">Checking which tables are free…</p>}

      {!loading && unavailable && (
        <p className="mt-1 text-muted-foreground">
          Couldn&apos;t load seating suggestions right now — you may not have permission to assign tables.
          Choose a table in the dropdown below, or leave it blank and assign it later.
        </p>
      )}

      {!loading && suggestion && (
        <>
          {suggestion.combinations.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {suggestion.combinations.map((combo) => {
                const chosen = sameSet(selected, combo.table_names);
                return (
                  <div
                    key={combo.table_names.join("|")}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5"
                  >
                    <span className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 text-amber-500" />
                      <span className="font-medium">{combo.table_names.join(" + ")}</span>
                      <span className="text-muted-foreground">seats up to {combo.total_capacity}</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={chosen ? "default" : "outline"}
                      onClick={() => { onSelect(chosen ? [] : combo.table_names); }}
                    >
                      {chosen ? "Selected" : "Combine"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {suggestion.single.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs text-muted-foreground">These single tables can still take the party:</p>
              {suggestion.single.map((table) => {
                const chosen = sameSet(selected, [table.table_name]);
                return (
                  <div
                    key={table.table_id}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5"
                  >
                    <span>
                      <span className="font-medium">{table.table_name}</span>{" "}
                      <span className="text-muted-foreground">seats up to {table.max_capacity}</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={chosen ? "default" : "outline"}
                      onClick={() => { onSelect(chosen ? [] : [table.table_name]); }}
                    >
                      {chosen ? "Selected" : "Use"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {suggestion.none_reason && (
            <p className="mt-2 rounded-md bg-destructive/10 p-2 text-destructive">{suggestion.none_reason}</p>
          )}

          {suggestion.free_tables.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs underline text-muted-foreground"
                onClick={() => { setShowManual((v) => !v); }}
              >
                {showManual ? "Hide manual picker" : "Pick different tables"}
              </button>
              {showManual && (
                <div className="mt-2 space-y-1">
                  {suggestion.free_tables.map((table) => (
                    <label key={table.table_id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selected.includes(table.table_name)}
                        onCheckedChange={() => { toggleManual(table.table_name); }}
                      />
                      <span>
                        {table.table_name}{" "}
                        <span className="text-muted-foreground">
                          (seats {table.capacity}
                          {table.max_capacity > table.capacity ? `, max ${table.max_capacity}` : ""})
                        </span>
                      </span>
                    </label>
                  ))}
                  <p className="pt-1 text-xs text-muted-foreground">
                    Selected: {selected.length > 0 ? selected.join(" + ") : "none"} — seats up to {manualTotal} of {party}.
                    The first table picked becomes the primary.
                  </p>
                </div>
              )}
            </div>
          )}

          {suggestion.unnumbered_free_tables.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {suggestion.unnumbered_free_tables.join(", ")} {suggestion.unnumbered_free_tables.length === 1 ? "has" : "have"}{" "}
              no number in the name, so {suggestion.unnumbered_free_tables.length === 1 ? "it is" : "they are"} never clubbed
              automatically — pick {suggestion.unnumbered_free_tables.length === 1 ? "it" : "them"} manually if it works.
            </p>
          )}
        </>
      )}

      {selected.length > 0 && (
        <p className="mt-2 text-sm font-medium">
          Will book: {selected.join(" + ")}
          {selected.length > 1 ? " (combined)" : ""}
        </p>
      )}
    </div>
  );
}

function BookingForm({ onSubmit, afterSubmit, tables }: { onSubmit: (data: BookingFormData, combinedTables: string[]) => Promise<void>; afterSubmit: () => void; tables: TableType[]; }) {
  const { user } = useAuth();
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      customer: "",
      contact: "",
      guests: undefined,
      time: "",
      table: "",
      source: "",
      notes: "",
    },
  });

  // Tables the staff member accepted from the suggester (primary first). Empty
  // until they pick — the form never fills this in on its own.
  const [seatingSelection, setSeatingSelection] = useState<string[]>([]);

  const availableTables = tables.filter((t) => t.status === "Available");
  const guests = Number(watch("guests")) || 0;
  const time = watch("time") ?? "";
  const startIso = bookingStartIso(time);

  // A party only needs clubbing when NO single free table can take it, even with
  // its extra chairs. Below that the normal single-table dropdown is enough.
  const largestSingleMax = availableTables.reduce(
    (max, table) => Math.max(max, table.max_capacity || table.capacity || 0),
    0,
  );
  const needsCombination = guests > 0 && availableTables.length > 0 && guests > largestSingleMax;

  useEffect(() => {
    if (!needsCombination && seatingSelection.length > 0) {
      setSeatingSelection([]);
    }
  }, [needsCombination, seatingSelection.length]);

  const handleFormSubmit = async (data: BookingFormData) => {
    // A confirmed suggestion wins over the single-table dropdown: its first
    // table becomes the primary and the rest ride along as the clubbed set.
    const useSelection = needsCombination && seatingSelection.length > 0;
    await onSubmit(
      useSelection ? { ...data, table: seatingSelection[0] } : data,
      useSelection ? seatingSelection.slice(1) : [],
    );
    afterSubmit();
  };

  // Keeps the contact field at 10 bare digits as it is typed or pasted.
  const contactField = register("contact");

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="customer" className="text-right">Customer</Label>
        <div className="col-span-3">
          <Input id="customer" {...register("customer")} placeholder="John Doe" />
          {errors.customer && (
            <p className="mt-1 text-sm text-destructive">{errors.customer.message}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="contact" className="text-right">Contact</Label>
        <div className="col-span-3">
          <Input
            id="contact"
            type="tel"
            {...PHONE_INPUT_PROPS}
            {...contactField}
            onChange={(e) => { e.target.value = sanitizePhoneInput(e.target.value); void contactField.onChange(e); }}
            placeholder="10-digit mobile"
          />
          {errors.contact && (
            <p className="mt-1 text-sm text-destructive">{errors.contact.message}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="guests" className="text-right">Guests</Label>
        <div className="col-span-3">
          <Input id="guests" type="number" {...register("guests")} placeholder="e.g., 4" />
          {errors.guests && (
            <p className="mt-1 text-sm text-destructive">{errors.guests.message}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="time" className="text-right">Time</Label>
        <div className="col-span-3">
          <Input id="time" type="time" {...register("time")} />
          {errors.time && (
            <p className="mt-1 text-sm text-destructive">{errors.time.message}</p>
          )}
        </div>
      </div>
      {needsCombination && user?.restaurantUsername ? (
        <SeatingSuggestionPanel
          restaurantId={user.restaurantUsername}
          party={guests}
          at={startIso}
          selected={seatingSelection}
          onSelect={setSeatingSelection}
        />
      ) : null}
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="table" className="text-right">Table</Label>
        <div className="col-span-3">
          <Controller
            name="table"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an available table" />
                </SelectTrigger>
                <SelectContent>
                  {availableTables.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name} (Seats: {t.capacity}
                      {t.max_capacity > t.capacity ? `, max ${t.max_capacity}` : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {seatingSelection.length > 0 && (
            <p className="mt-1 text-xs text-amber-500">
              Using the combined selection above ({seatingSelection.join(" + ")}) instead of this dropdown.
            </p>
          )}
          {errors.table && (
            <p className="mt-1 text-sm text-destructive">{errors.table.message}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="source" className="text-right">Source</Label>
        <div className="col-span-3">
          <Controller
            name="source"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Call">Call</SelectItem>
                  <SelectItem value="Dineout">Dineout</SelectItem>
                  <SelectItem value="Easydiner">Easydiner</SelectItem>
                  <SelectItem value="Walk-in">Walk-in</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          {errors.source && (
            <p className="mt-1 text-sm text-destructive">{errors.source.message}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="notes" className="text-right">Notes</Label>
        <div className="col-span-3">
          <Input id="notes" {...register("notes")} placeholder="e.g., Vegan, peanut allergy, anniversary" />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit">Save Booking</Button>
      </DialogFooter>
    </form>
  );
}

// useSearchParams (via useHighlightRow) requires a Suspense boundary
// (same pattern as the accounting and queue pages).
export default function BookingsPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading…</div>}>
      <BookingsPageInner />
    </Suspense>
  );
}
