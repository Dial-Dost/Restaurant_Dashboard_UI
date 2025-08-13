
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

export default function BookingsPage() {
  const [bookings, setBookings] = useState(initialBookings);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const handleAddBooking = (newBookingData: Omit<Booking, 'id'>) => {
    const newBooking: Booking = {
        id: (bookings.length + 1).toString(),
        ...newBookingData,
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
            <BookingForm onSubmit={handleAddBooking} />
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

function BookingForm({ onSubmit }: { onSubmit: (data: Omit<Booking, 'id'>) => void }) {
    const [customer, setCustomer] = useState("");
    const [guests, setGuests] = useState("");
    const [time, setTime] = useState("");
    const [table, setTable] = useState("");
    const [source, setSource] = useState("");

    const handleSubmit = () => {
        if(customer && guests && time && table && source) {
            onSubmit({
                customer,
                guests: parseInt(guests, 10),
                time,
                table,
                source,
                status: 'Confirmed'
            });
        }
    }

    return (
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="customer" className="text-right">Customer</Label>
            <Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} className="col-span-3" placeholder="John Doe" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="guests" className="text-right">Guests</Label>
            <Input id="guests" type="number" value={guests} onChange={(e) => setGuests(e.target.value)} className="col-span-3" placeholder="e.g., 4" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="time" className="text-right">Time</Label>
            <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="table" className="text-right">Table</Label>
            <Input id="table" value={table} onChange={(e) => setTable(e.target.value)} className="col-span-3" placeholder="e.g., T5" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="source" className="text-right">Source</Label>
            <Select onValueChange={setSource}>
                <SelectTrigger className="col-span-3">
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
          </div>
          <DialogFooter>
            <Button onClick={handleSubmit}>Save Booking</Button>
          </DialogFooter>
        </div>
    )
}
