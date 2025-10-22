
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
import { addAuditLogEntry } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { type Booking } from "./data";
import { type Table as TableType } from "../tables/data";

const bookingSchema = z.object({
  customer: z.string().min(1, "Customer name is required."),
  contact: z.string().min(5, "Contact number is required."),
  guests: z.coerce.number().min(1, "At least one guest is required."),
  time: z.string().min(1, "Time is required."),
  table: z.string().min(1, "Table is required."),
  source: z.string().min(1, "Source is required."),
});

type BookingFormData = z.infer<typeof bookingSchema>;

const API_BASE_URL = process.env.NEXT_PUBLIC_RECEPTION_API_URL ?? "http://localhost:3000";

const formatBookingTime = (isoString: string) => {
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) {
    return isoString;
  }
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

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

  const loadBookings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/get-bookings`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to fetch bookings");
      }
      const data = await response.json();
      const mapped: Booking[] = data.map((item: any) => ({
        id: createBookingId(item.booking_id),
        customer: item.customer_name ?? "Guest",
        time: formatBookingTime(item.booking_date_time),
        guests: item.number_of_people ?? 0,
        table: item.table_name ?? "",
        source: item.source ?? "Unknown",
        status: item.status ?? (item.active ? "Arrived" : "Confirmed"),
      }));
      setBookings(mapped);
    } catch (error) {
      console.error("Failed to load bookings", error);
    }
  };

  const loadTables = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/get-tables`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to fetch tables");
      }
      const data = await response.json();
      const mapped: TableType[] = data.map((table: any, index: number) => ({
        id: index + 1,
        name: table.table_name ?? `Table-${index + 1}`,
        capacity: table.capacity ?? 0,
        status: table.booked ? "Booked" : "Available",
      }));
      setTables(mapped);
    } catch (error) {
      console.error("Failed to load tables", error);
    }
  };
  
  useEffect(() => {
    if (!user) {
      return;
    }

    loadBookings();
    loadTables();
  }, [user]);

  const handleAddBooking = async (data: BookingFormData) => {
    if (!user || !user.restaurantId) return;

    const sanitizedContact = data.contact.replace(/[^0-9+]/g, "").trim() || data.contact;
    const reservationDate = new Date();
    const [hour, minute] = data.time.split(":");
    reservationDate.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);

    try {
      await fetch(`${API_BASE_URL}/add-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: data.customer,
            number: sanitizedContact,
          },
          booking: {
            table_name: data.table,
            date: reservationDate.toISOString(),
            duration: 120,
            number_of_people: data.guests,
            source: data.source,
            status: "Confirmed",
            from: "dashboard",
          },
        }),
      });

      try {
        await addAuditLogEntry(user.restaurantId, {
          employee: user?.name || 'System',
          action: 'Booking Create',
          details: `Created booking for ${data.customer} at table ${data.table}`,
        });
      } catch (auditError) {
        console.warn("Failed to record audit entry", auditError);
      }

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to create booking", error);
      throw error;
    }
  }

  const handleCancelBooking = async (booking: Booking) => {
    if (!user || !user.restaurantId) return;

    try {
      await fetch(`${API_BASE_URL}/booking/${booking.id}`, {
        method: "DELETE",
      });

      try {
        await addAuditLogEntry(user.restaurantId, {
          employee: user?.name || 'System',
          action: 'Booking Cancel',
          details: `Cancelled booking for ${booking.customer} at table ${booking.table}`,
        });
      } catch (auditError) {
        console.warn("Failed to record audit entry", auditError);
      }

      await loadBookings();
      await loadTables();
    } catch (error) {
      console.error("Failed to cancel booking", error);
    }
  }

  const handleStatusChange = async (booking: Booking, status: Booking['status']) => {
    if (!user || !user.restaurantId) return;

    try {
      await fetch(`${API_BASE_URL}/booking/${booking.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

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
      <DialogFooter>
        <Button type="submit">Save Booking</Button>
      </DialogFooter>
    </form>
  );
}
