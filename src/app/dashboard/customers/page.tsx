
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
import { PlusCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { getCustomers, addCustomer } from "@/lib/db";
import { useCurrency } from "@/hooks/use-currency";


export type Customer = {
  customerId?: string;
  name: string;
  email: string;
  phone: string;
  totalBookings: number;
  status: "In-house" | "Departed";
  billAmount: number;
};

const customerSchema = z.object({
    name: z.string().min(1, "Name is required."),
    email: z.string().email("Invalid email address."),
    phone: z.string().min(10, "Phone number is too short."),
    billAmount: z.coerce.number().positive("Bill amount must be positive."),
});

type CustomerFormData = z.infer<typeof customerSchema>;

export default function CustomersPage() {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (user) {
        const fetchCustomers = async () => {
          setCustomers(await getCustomers(user.restaurantId));
        }
        fetchCustomers();
    }
  }, [user]);

  const handleAddCustomer = async (data: CustomerFormData) => {
    if (!user) return;
    const newCustomer: Customer = {
      ...data,
      totalBookings: 1,
      status: 'In-house',
    };
    await addCustomer(user.restaurantId, newCustomer);
    setCustomers(await getCustomers(user.restaurantId));
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
            <CustomerForm onSubmit={handleAddCustomer} afterSubmit={() => setIsDialogOpen(false)} />
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
                <TableHead className="text-right">Bill Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer, index) => (
                <TableRow key={customer.customerId ?? `${customer.email}-${customer.phone}-${index}`}>
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
                  <TableCell className="text-right">{currencySymbol}{customer.billAmount.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}


function CustomerForm({ onSubmit, afterSubmit }: { onSubmit: (data: CustomerFormData) => void; afterSubmit: () => void; }) {
    const { register, handleSubmit, formState: { errors } } = useForm<CustomerFormData>({
        resolver: zodResolver(customerSchema)
    });

    const handleFormSubmit = (data: CustomerFormData) => {
        onSubmit(data);
        afterSubmit();
    }

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Name</Label>
            <div className="col-span-3">
              <Input id="name" {...register("name")} placeholder="John Doe" />
              {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">Email</Label>
            <div className="col-span-3">
              <Input id="email" type="email" {...register("email")} placeholder="john.doe@example.com" />
              {errors.email && <p className="text-sm text-destructive mt-1">{errors.email.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="phone" className="text-right">Phone</Label>
            <div className="col-span-3">
              <Input id="phone" {...register("phone")} placeholder="555-123-4567" />
              {errors.phone && <p className="text-sm text-destructive mt-1">{errors.phone.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="billAmount" className="text-right">Bill Amount</Label>
            <div className="col-span-3">
              <Input id="billAmount" type="number" step="0.01" {...register("billAmount")} placeholder="e.g., 75.50" />
              {errors.billAmount && <p className="text-sm text-destructive mt-1">{errors.billAmount.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Add Customer</Button>
          </DialogFooter>
        </form>
    )
}
