"use client";

import config from "@/context/server";
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
} from "@/components/ui/dropdown-menu";

type Booking = {
  booking_id: number;
  customer_id: string;
  customer_name: string;
  booking_date_time: string;
  duration_mins: number;
  number_of_people: number;
  table_name: string;
  source: string;
  active: boolean;
};

type AddBooking = {
  customer: {
    name: string;
    number: string;
    email: string | undefined;
  };
  booking: {
    table_name: string;
    date: Date;
    duration: number;
    number_of_people: number;
    source: string | undefined;
  };
};

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  function duration_mins_string(duration: number): string {
    if (duration == 60) {
      return "1 hour";
    } else if (duration < 60) {
      return duration + "mins";
    } else {
      let hours = Math.floor(duration / 60);
      let mins = duration % 60;
      let min_string = mins === 0 ? "" : ` ${mins} mins`;

      return `${hours} hours${min_string}`;
    }
  }

  const DateToString: (DateTime: Date) => string = (DateTime) => {
    const hours = DateTime.getHours();
    const minutes = DateTime.getMinutes();
    const day = DateTime.getDate();
    const month = DateTime.getMonth() + 1;
    const year = DateTime.getFullYear();

    // Convert to 12-hour format
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const ampm = hours >= 12 ? "PM" : "AM";
    const minutesFormatted = minutes.toString().padStart(2, "0");

    return `${hour12}:${minutesFormatted} ${ampm}, ${day}/${month}/${year}`;
  };

  const fetchBookings = async () => {
    const response = await fetch(config.server_url + "/get-bookings");
    if (!response.ok) {
      console.log("Oops something went wrong with the server");
    }
    const data = await response.json();
    setBookings(data);
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const handleAddBooking = async (
    newBookingData: AddBooking,
  ): Promise<boolean> => {
    const response = await fetch(config.server_url + "/add-booking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newBookingData),
    });
    console.log(newBookingData);

    await fetchBookings();

    setIsDialogOpen(false);
    return response.ok;
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
          <DialogContent className="sm:max-w-[500px]">
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
                <TableHead className="hidden md:table-cell">Duration</TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  Guests
                </TableHead>
                <TableHead className="hidden lg:table-cell">Table</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => {
                console.log(booking);
                return (
                  <TableRow key={booking.booking_id.toString()}>
                    <TableCell className="font-medium">
                      <div>{booking.customer_name}</div>
                      <div className="text-sm text-muted-foreground md:hidden">
                        {booking.booking_date_time} - {booking.number_of_people}{" "}
                        guests
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {DateToString(new Date(booking.booking_date_time))}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {duration_mins_string(booking.duration_mins)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-center">
                      {booking.number_of_people}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {booking.table_name}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {booking.source ? booking.source : "Other"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          booking.active === true ? "default" : "outline"
                        }
                      >
                        {booking.active ? "Arrived" : "Not yet arrived"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-haspopup="true"
                            size="icon"
                            variant="ghost"
                          >
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
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function BookingForm({
  onSubmit,
}: {
  onSubmit: (data: AddBooking) => Promise<boolean>;
}) {
  const [customer, setCustomer] = useState("");
  const [phone_number, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [guests, setGuests] = useState("");
  const [time, setTime] = useState("");
  const [table, setTable] = useState("");
  const [source, setSource] = useState("");
  const [duration, setDuration] = useState(60);

  function make_date_from_time(time: string): Date | undefined {
    let hours = time.split(":")[0];
    let mins = time.split(":")[1];
    let now: Date = new Date();

    let date_time = now.setHours(parseInt(hours));
    date_time = now.setMinutes(parseInt(mins));
    date_time = now.setMilliseconds(0);

    return isNaN(date_time) ? undefined : new Date(date_time);
  }

  const handleSubmit = () => {
    let booking_time = make_date_from_time(time);
    if (customer && phone_number && guests && booking_time && table && source) {
      onSubmit({
        customer: {
          name: customer,
          number: phone_number,
          email: email,
        },
        booking: {
          table_name: table,
          date: booking_time,
          duration: duration,
          number_of_people: parseInt(guests),
          source: source,
        },
      });
    }
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="customer" className="text-right">
          Customer
        </Label>
        <Input
          id="customer"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          className="col-span-3"
          placeholder="John Doe"
        />
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="phone_number" className="text-right">
          Phone Number
        </Label>
        <Input
          id="phone_number"
          value={phone_number}
          onChange={(e) => setPhoneNumber(e.target.value)}
          className="col-span-3"
          placeholder="987654321"
        />
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="email" className="text-right">
          Email ID
        </Label>
        <Input
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="col-span-3"
          placeholder="example@gmail.com (Optional)"
        />
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="guests" className="text-right">
          Guests
        </Label>
        <Input
          id="guests"
          type="number"
          value={guests}
          onChange={(e) => setGuests(e.target.value)}
          className="col-span-3"
          placeholder="e.g., 4"
        />
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="time" className="text-right">
          Time
        </Label>
        <Input
          id="time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="col-span-3"
        />
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="table" className="text-right">
          Table
        </Label>
        <Input
          id="table"
          value={table}
          onChange={(e) => setTable(e.target.value)}
          className="col-span-3"
          placeholder="e.g., T5"
        />
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="source" className="text-right">
          Source
        </Label>
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
  );
}
