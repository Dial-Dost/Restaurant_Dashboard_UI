
"use client";

import { Suspense, useState, useEffect } from "react";
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
import { Link2, MoreHorizontal, PlusCircle } from "lucide-react";
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
  getTables as getTablesData,
  getSeatingSuggestion,
  assignBookingTables,
  requestBackend,
  type SeatingSuggestion,
} from "@/lib/db"; //addAuditLogEntry,
import { useAuth } from "@/context/AuthContext";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { isMobile10, MOBILE_10_ERROR, normalizeMobile10, PHONE_INPUT_PROPS, sanitizePhoneInput } from "@/lib/phone";
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

function BookingsPageInner() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  // Upcoming / Past / All view. Default "upcoming" keeps today's operational
  // list, but past-dated bookings stay reachable so one never just disappears
  // the moment its slot ends (GET /get-bookings?window=).
  const [bookingWindow, setBookingWindow] = useState<BookingWindow>('upcoming');
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
        <CardHeader>
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
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="hidden md:table-cell">Time</TableHead>
                <TableHead className="hidden md:table-cell text-center">Guests</TableHead>
                <TableHead className="hidden lg:table-cell">Table</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead className="hidden xl:table-cell">Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => (
                <TableRow key={booking.id} {...highlight.rowProps(booking.id)}>
                  <TableCell className="font-medium">
                    <div>{booking.customer}</div>
                    <div className="text-sm text-muted-foreground md:hidden">{booking.time} - {booking.guests} guests</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{booking.time}</TableCell>
                  <TableCell className="hidden md:table-cell text-center">{booking.guests}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="flex items-center gap-1">
                      {isCombinedBooking(booking) ? <Link2 className="h-3.5 w-3.5 text-amber-500" /> : null}
                      {bookingTableLabel(booking)}
                    </span>
                    {isCombinedBooking(booking) ? (
                      <span className="text-xs text-muted-foreground">Combined tables</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{booking.source}</TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-pre-wrap">
                    {booking.notes || "-"}
                    {booking.min_spend ? (
                      <div className="mt-1 text-xs text-muted-foreground">Min spend ₹{booking.min_spend}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={
                          booking.status === "Confirmed"
                            ? "default"
                            : booking.status === "Arrived" || booking.status === "Seated"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {booking.status}
                      </Badge>
                      <DepositBadge deposit={booking.deposit} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
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
              ))}
            </TableBody>
          </Table>
          {bookings.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {bookingWindow === "upcoming"
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
                <TableCell className="whitespace-nowrap text-sm">
                  {new Date(m.created_at).toLocaleString()}
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
function DepositBadge({ deposit }: { deposit?: Booking["deposit"] }) {
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
  return (
    <Badge variant="outline" className={styles[deposit.status] ?? ""}>
      {labels[deposit.status] ?? `Deposit ₹${deposit.amount}`}
    </Badge>
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
