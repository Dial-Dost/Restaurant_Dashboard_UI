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
import { PlusCircle } from "lucide-react";

type Customer = {
  name: string;
  email: string;
  phone: string;
  booking_count: number;
  status: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  async function fetch_customers(): Promise<boolean> {
    let response = await fetch(config.server_url + "/get-customers");

    if (response.ok) {
      let data = await response.json();

      setCustomers(
        data.map((x: any) => {
          return {
            name: x.name,
            email: x.email,
            phone: x.phone_number,
            booking_count: x.booking_count,
            status: x.has_booking ? "In-house" : "Departed",
          };
        }),
      );
      return true;
    }
    return false;
  }

  useEffect(() => {
    fetch_customers();
  }, []);

  const handleAddCustomer = async (
    newCustomerData: Omit<Customer, "booking_count" | "status">,
  ) => {
    const newCustomer = {
      customer: {
        name: newCustomerData.name,
        number: newCustomerData.phone,
        email: newCustomerData.email,
      },
    };

    let response = await fetch(config.server_url + "/add-customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newCustomerData),
    });

    if (response.ok) {
      fetch_customers();
      setIsDialogOpen(false);
    }
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Customers</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
              <DialogDescription>
                Fill in the details for the new customer.
              </DialogDescription>
            </DialogHeader>
            <CustomerForm onSubmit={handleAddCustomer} />
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Customer List</CardTitle>
          <CardDescription>
            A list of all customers who have made bookings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone Number</TableHead>
                <TableHead>Email id</TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  Total Bookings
                </TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">
                    <div>{customer.name}</div>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>{customer.phone}</div>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>{customer.email ? customer.email : "N.A."}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center">
                    {customer.booking_count}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        customer.status === "In-house" ? "default" : "secondary"
                      }
                    >
                      {customer.status}
                    </Badge>
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

function CustomerForm({
  onSubmit,
}: {
  onSubmit: (data: Omit<Customer, "booking_count" | "status">) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const handleSubmit = () => {
    if (name && phone) {
      onSubmit({
        name,
        email,
        phone,
      });
    }
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="name" className="text-right">
          Name
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="col-span-3"
          placeholder="John Doe"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="email" className="text-right">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="col-span-3"
          placeholder="john.doe@example.com"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="phone" className="text-right">
          Phone
        </Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="col-span-3"
          placeholder="555-123-4567"
        />
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit}>Add Customer</Button>
      </DialogFooter>
    </div>
  );
}
