
"use client";

import { useState } from "react";
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
} from "@/components/ui/dropdown-menu";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const initialBookings = [
  {
    id: "1",
    customer: "Liam Johnson",
    time: "7:00 PM",
    guests: 2,
    table: "T2",
    source: "Dineout",
    status: "Confirmed",
  },
  {
    id: "2",
    customer: "Olivia Smith",
    time: "7:15 PM",
    guests: 4,
    table: "T6",
    source: "Call",
    status: "Arrived",
  },
  {
    id: "3",
    customer: "Noah Williams",
    time: "8:00 PM",
    guests: 2,
    table: "T8",
    source: "Easydiner",
    status: "Confirmed",
  },
  {
    id: "4",
    customer: "Emma Brown",
    time: "8:30 PM",
    guests: 3,
    table: "T4",
    source: "Walk-in",
    status: "Seated",
  },
  {
    id: "5",
    customer: "James Jones",
    time: "9:00 PM",
    guests: 5,
    table: "T9",
    source: "Call",
    status: "Pending",
  },
];

type Booking = (typeof initialBookings)[0];

const bookingSchema = z.object({
    customer: z.string().min(1, "Customer name is required."),
    guests: z.coerce.number().min(1, "At least one guest is required."),
    time: z.string().min(1, "Time is required."),
    table: z.string().min(1, "Table is required."),
    source: z.string().min(1, "Source is required."),
});

type BookingFormData = z.infer<typeof bookingSchema>;


export default function BookingsPage() {
  const [bookings, setBookings] = useState(initialBookings);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const handleAddBooking = (data: BookingFormData) => {
    const newBooking: Booking = {
        id: (bookings.length + 1).toString(),
        ...data,
        status: 'Confirmed'
    };
    setBookings([...bookings, newBooking]);
    setIsDialogOpen(false);
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
            <BookingForm onSubmit={handleAddBooking} afterSubmit={() => setIsDialogOpen(false)} />
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
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem>Cancel</DropdownMenuItem>
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

function BookingForm({ onSubmit, afterSubmit }: { onSubmit: (data: BookingFormData) => void; afterSubmit: () => void; }) {
    const { register, handleSubmit, control, formState: { errors } } = useForm<BookingFormData>({
        resolver: zodResolver(bookingSchema),
        defaultValues: {
            customer: "",
            guests: undefined,
            time: "",
            table: "",
            source: "",
        }
    });

    const handleFormSubmit = (data: BookingFormData) => {
        onSubmit(data);
        afterSubmit();
    }

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="customer" className="text-right">Customer</Label>
            <div className="col-span-3">
              <Input id="customer" {...register("customer")} placeholder="John Doe" />
              {errors.customer && <p className="text-sm text-destructive mt-1">{errors.customer.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="guests" className="text-right">Guests</Label>
            <div className="col-span-3">
              <Input id="guests" type="number" {...register("guests")} placeholder="e.g., 4" />
              {errors.guests && <p className="text-sm text-destructive mt-1">{errors.guests.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="time" className="text-right">Time</Label>
            <div className="col-span-3">
              <Input id="time" type="time" {...register("time")} />
              {errors.time && <p className="text-sm text-destructive mt-1">{errors.time.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="table" className="text-right">Table</Label>
            <div className="col-span-3">
              <Input id="table" {...register("table")} placeholder="e.g., T5" />
              {errors.table && <p className="text-sm text-destructive mt-1">{errors.table.message}</p>}
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
              {errors.source && <p className="text-sm text-destructive mt-1">{errors.source.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Save Booking</Button>
          </DialogFooter>
        </form>
    )
}
