
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
import { PlusCircle } from "lucide-react";

const initialCustomers = [
  {
    name: "Liam Johnson",
    email: "liam@example.com",
    phone: "555-0101",
    totalBookings: 5,
    status: "In-house",
    billAmount: 250.00,
  },
  {
    name: "Olivia Smith",
    email: "olivia@example.com",
    phone: "555-0102",
    totalBookings: 2,
    status: "Departed",
    billAmount: 150.00,
  },
  {
    name: "Noah Williams",
    email: "noah@example.com",
    phone: "555-0103",
    totalBookings: 8,
    status: "In-house",
    billAmount: 350.00,
  },
  {
    name: "Emma Brown",
    email: "emma@example.com",
    phone: "555-0104",
    totalBookings: 1,
    status: "Departed",
    billAmount: 450.00,
  },
  {
    name: "James Jones",
    email: "james@example.com",
    phone: "555-0105",
    totalBookings: 12,
    status: "In-house",
    billAmount: 550.00,
  },
  {
    name: "Sophia Garcia",
    email: "sophia@example.com",
    phone: "555-0106",
    totalBookings: 3,
    status: "Departed",
    billAmount: 120.50,
  },
  {
    name: "Logan Miller",
    email: "logan@example.com",
    phone: "555-0107",
    totalBookings: 7,
    status: "In-house",
    billAmount: 280.75,
  },
];

type Customer = (typeof initialCustomers)[0];

export default function CustomersPage() {
  const [customers, setCustomers] = useState(initialCustomers);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleAddCustomer = (newCustomerData: Omit<Customer, 'totalBookings' | 'status'>) => {
    const newCustomer: Customer = {
      ...newCustomerData,
      totalBookings: 1,
      status: 'In-house',
    };
    setCustomers([...customers, newCustomer]);
    setIsDialogOpen(false);
  }

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
                <TableHead className="hidden md:table-cell text-center">Total Bookings</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-left">Bill Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.email}>
                  <TableCell className="font-medium">
                    <div>{customer.name}</div>
                    <div className="text-sm text-muted-foreground md:hidden">{customer.email}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center">{customer.totalBookings}</TableCell>
                  <TableCell>
                    <Badge variant={customer.status === "In-house" ? "default" : "secondary"}>
                      {customer.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-centre">${customer.billAmount.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}


function CustomerForm({ onSubmit }: { onSubmit: (data: Omit<Customer, 'totalBookings' | 'status'>) => void }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [billAmount, setBillAmount] = useState("");

    const handleSubmit = () => {
        if(name && email && phone && billAmount) {
            onSubmit({
                name,
                email,
                phone,
                billAmount: parseFloat(billAmount),
            });
        }
    }

    return (
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="col-span-3" placeholder="John Doe" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="col-span-3" placeholder="john.doe@example.com" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="phone" className="text-right">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="col-span-3" placeholder="555-123-4567" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="billAmount" className="text-right">Bill Amount</Label>
            <Input id="billAmount" type="number" value={billAmount} onChange={(e) => setBillAmount(e.target.value)} className="col-span-3" placeholder="e.g., 75.50" />
          </div>
          <DialogFooter>
            <Button onClick={handleSubmit}>Add Customer</Button>
          </DialogFooter>
        </div>
    )
}
