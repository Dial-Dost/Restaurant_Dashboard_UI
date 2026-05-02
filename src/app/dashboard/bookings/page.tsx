
"use client";

import { useState, useEffect } from "react";
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
import { MoreHorizontal, PlusCircle } from "lucide-react";
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
import { addAuditLogEntry, getBookings as getBookingsData, getTables as getTablesData, requestBackend } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { type Booking } from "./data";
import { type Table as TableType } from "../tables/data";

const bookingSchema = z.object({
  customer: z.string().min(1, "Customer name is required."),
  contact: z.string().min(5, "Contact number is required."),
  guests: z.coerce.number().min(1, "At least one guest is required."),
  time: z.string().min(1, "Time is required."),
  table: z.string().optional(),
  source: z.string().min(1, "Source is required."),
  notes: z.string().optional(),
});

type BookingFormData = z.infer<typeof bookingSchema>;

const createBookingId = (value: unknown) => {
  if (value !== null && value !== undefined) {
    return value.toString();
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export default function BookingsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [tables, setTables] = useState<TableType[]>([]);

  const recordAuditEntry = async (action: string, details: string) => {
    if (!user?.restaurantUsername) return;

      try {
        await addAuditLogEntry(user.restaurantUsername, {
        employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
        employeeId: user?.employeeId,
        action,
        details,
      });
    } catch (auditError) {
      console.warn("Failed to record audit entry", auditError);
    }
  };

  const loadBookings = async () => {
    if (!user?.restaurantUsername) {
      return;
    }

    try {
      const data = await getBookingsData(user.restaurantUsername);
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
        const data = await getBookingsData(user.restaurantUsername);
        if (!isActive) return;
        const mapped: Booking[] = (Array.isArray(data) ? data : []).map((item: Booking) => ({
          ...item,
          id: createBookingId(item.id),
        }));
        setBookings(mapped);
      } catch (error) {
        console.error("Failed to load bookings", error);
        if (isActive) setBookings([]);
      }

      try {
        const t = await getTablesData(user.restaurantUsername);
        if (!isActive) return;
        setTables(Array.isArray(t) ? t : []);
      } catch (error) {
        console.error("Failed to load tables", error);
        if (isActive) setTables([]);
      }
    })();

    return () => { isActive = false; };
  }, [user?.restaurantUsername]);

  const handleAddBooking = async (data: BookingFormData) => {
    if (!user || !user.restaurantUsername) return;

    const sanitizedContact = data.contact.replace(/[^0-9+]/g, "").trim() || data.contact;
    const reservationDate = new Date();
    const [hour, minute] = data.time.split(":");
    reservationDate.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);

    const requestedTable = data.table?.trim() || undefined;

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

      await recordAuditEntry(
        "Booking Create",
        requestedTable
          ? `Created booking for ${data.customer} at table ${requestedTable}`
          : `Created booking for ${data.customer} (table unassigned)`,
      );

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to create booking", error);
      throw error;
    }
  }

  const handleCancelBooking = async (booking: Booking) => {
    if (!user || !user.restaurantUsername) return;

    try {
      const response = await requestBackend({
        path: `/booking/${encodeURIComponent(booking.id)}`,
        method: "DELETE",
        restaurantId: user.restaurantUsername,
      });

      if (!response.ok) {
        throw new Error(response.text || "Failed to cancel booking");
      }

      await recordAuditEntry(
        "Booking Cancel",
        `Cancelled booking for ${booking.customer} at table ${booking.table || "Unassigned"}`,
      );

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to cancel booking", error);
    }
  }

  const handleStatusChange = async (booking: Booking, status: Booking['status']) => {
    if (!user || !user.restaurantUsername) return;

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

      await recordAuditEntry(
        "Booking Status",
        `Updated booking ${booking.id} status to ${status}`,
      );

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to update booking status", error);
    }
  }

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
              afterSubmit={() => setIsDialogOpen(false)}
              tables={tables}
            />
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Current Bookings</CardTitle>
          <CardDescription>
            A list of all active and upcoming bookings for today.
          </CardDescription>
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
                <TableRow key={booking.id}>
                  <TableCell className="font-medium">
                    <div>{booking.customer}</div>
                    <div className="text-sm text-muted-foreground md:hidden">{booking.time} - {booking.guests} guests</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{booking.time}</TableCell>
                  <TableCell className="hidden md:table-cell text-center">{booking.guests}</TableCell>
                  <TableCell className="hidden lg:table-cell">{booking.table}</TableCell>
                  <TableCell className="hidden lg:table-cell">{booking.source}</TableCell>
                  <TableCell className="hidden xl:table-cell whitespace-pre-wrap">{booking.notes || "-"}</TableCell>
                  <TableCell>
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
        </CardContent>
      </Card>
    </div>
  );
}

function BookingForm({ onSubmit, afterSubmit, tables }: { onSubmit: (data: BookingFormData) => Promise<void>; afterSubmit: () => void; tables: TableType[]; }) {
  const {
    register,
    handleSubmit,
    control,
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

  const handleFormSubmit = async (data: BookingFormData) => {
    await onSubmit(data);
    afterSubmit();
  };

  const availableTables = tables.filter((t) => t.status === "Available");

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
          <Input id="contact" {...register("contact")} placeholder="e.g., 9876543210" />
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
                      {t.name} (Capacity: {t.capacity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
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
