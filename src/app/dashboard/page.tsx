
"use client"

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight, Activity, CircleUser, CreditCard, DollarSign } from 'lucide-react';


enum Status {
    Confirmed,
    Pending,
    Cancelled,
}

interface Customer {
    table_name: string;
    name: string;
    email: string;
    date: Date;
    status: Status;
}

let now: Date = new Date();

let bookings:Customer[] = [
    {
        name: "Liam Johnson",
        email: "liam.jhonson@gmail.com",
        date: now,
        status: Status.Confirmed,
        table_name: "T1",
    },
    {
        name: "Dodo reddy",
        email: "dodo.reddy@gmail.com",
        date: now,
        status: Status.Pending,
        table_name: "T3",
    },
];
    
function get_status(status: Status) {
    switch (status) {
        case Status.Cancelled:
            return "Cancelled";
            break;
        case Status.Pending:
            return "Pending";
            break;
        case Status.Confirmed:
            return "Confirmed";
            break;
    }
}

const Active_tables: {capacity: number, utilisation: number} = {
    capacity: 20,
    utilisation: 12,
}
const New_Customers: {amount: number, increase: number} = {
    amount: 573,
    increase: 19,
}
const Bookings: {amount: number, increase: number} = {
    amount: 2350,
    increase: 180.1,
}
const Total_revenue: {amount: number, increase: number} = {
    amount: 45231,
    increase: 20.1,
}

function display_number(number: number): string {
    return (number >= 0? "+": "-")+number.toLocaleString();
}

export default function Dashboard() {
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Dashboard</h1>
        <Button asChild>
          <Link href="/dashboard/bookings">Create Booking</Link>
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Total_revenue.amount.toLocaleString()}$</div>
            <p className="text-xs text-muted-foreground">
                {display_number(Total_revenue.increase)}% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Bookings
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{display_number(Bookings.amount)}</div>
            <p className="text-xs text-muted-foreground">
                {display_number(Bookings.increase)}% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Customers</CardTitle>
            <CircleUser className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{display_number(New_Customers.amount)}</div>
            <p className="text-xs text-muted-foreground">
                {display_number(New_Customers.increase)}% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tables</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Active_tables.utilisation} / {Active_tables.capacity}</div>
            <p className="text-xs text-muted-foreground">
                {(Active_tables.utilisation*100/Active_tables.capacity).toPrecision(2)}% capacity
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:gap-8">
        <Card>
          <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
              <CardTitle>Recent Bookings</CardTitle>
              <CardDescription>
                Recent bookings from your customers.
              </CardDescription>
            </div>
            <Button asChild size="sm" className="ml-auto gap-1">
              <Link href="/dashboard/customers">
                View All
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Time
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    Status
                  </TableHead>
                  <TableHead className="text-right">
                    Table Name
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {bookings.map((customer, index) => (
                  <TableRow key={index}>
                      <TableCell>
                          <div className="font-medium">{customer.name}</div>
                          <div className="text-sm text-muted-foreground md:hidden">
                              {customer.email}
                          </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{customer.date.toDateString()}</TableCell>
                      <TableCell className="hidden md:table-cell">
                          <Badge className="text-xs" variant="outline">
                            {get_status(customer.status)}
                          </Badge>
                      </TableCell>
                      <TableCell className="text-right">{customer.table_name}</TableCell>
                  </TableRow>
              ))} 
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
