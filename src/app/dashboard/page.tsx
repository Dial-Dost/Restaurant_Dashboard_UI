
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
import { useAuth } from '@/context/AuthContext';
import { getBookings, getCustomers, getTables, getMonthlyApcInsight } from '@/lib/db';
import { useEffect, useState } from 'react';
import type { Booking } from './bookings/data';
import type { Customer } from './customers/page';
import type { Table as TableType } from './tables/data';
import { useCurrency } from '@/hooks/use-currency';

type ApcRange = 'day' | 'week' | 'month';

export default function Dashboard() {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tables, setTables] = useState<TableType[]>([]);
  const [apcRange, setApcRange] = useState<ApcRange>('week');
  const [employeeApc, setEmployeeApc] = useState<number | null>(null);
  const [employeeApcOrdersCount, setEmployeeApcOrdersCount] = useState<number>(0);
  const [employeeApcLoading, setEmployeeApcLoading] = useState<boolean>(false);

  useEffect(() => {
    if (user && user.restaurantId) {
      const fetchData = async () => {
        setEmployeeApcLoading(true);
        try {
          const [bookingData, customerData, tableData, apcInsight] = await Promise.all([
            getBookings(user.restaurantId),
            getCustomers(user.restaurantId),
            getTables(user.restaurantId),
            getMonthlyApcInsight(user.restaurantId, {
              period: apcRange,
              employeeId: user.employeeId,
            }),
          ]);

          setBookings(bookingData);
          setCustomers(customerData);
          setTables(tableData);
          setEmployeeApc(apcInsight && apcInsight.total_covers > 0 ? apcInsight.monthly_apc : null);
          setEmployeeApcOrdersCount(apcInsight?.orders?.length ?? 0);
        } catch {
          setEmployeeApc(null);
          setEmployeeApcOrdersCount(0);
        } finally {
          setEmployeeApcLoading(false);
        }
      }
      fetchData();
    } else {
      setEmployeeApc(null);
      setEmployeeApcOrdersCount(0);
    }
  }, [user, apcRange]);

  // Current month data
  const totalRevenue = customers.reduce((acc, customer) => acc + customer.billAmount, 0);
  const totalBookings = bookings.length;
  const newCustomers = customers.filter(c => c.totalBookings === 1).length;
  const activeTables = tables.filter(t => t.status !== "Available").length;
  const totalTables = tables.length;

  // Mock previous month data for comparison
  const prevMonthRevenue = totalRevenue * 0.8; // Assume 20% growth
  const prevMonthBookings = Math.floor(totalBookings * 0.9); // Assume 10% growth
  const prevMonthNewCustomers = Math.floor(newCustomers * 0.85); // Assume 15% growth

  const calculatePercentageChange = (current: number, previous: number) => {
    if (previous === 0) {
        return current > 0 ? '100% from last month' : '0% from last month';
    }
    const change = ((current - previous) / previous) * 100;
    if (change > 0) {
        return `+${change.toFixed(1)}% from last month`;
    }
    return `${change.toFixed(1)}% from last month`;
  };
  
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Dashboard</h1>
        <Button asChild>
          <Link href="/dashboard/bookings">Create Booking</Link>
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currencySymbol}{totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
                {calculatePercentageChange(totalRevenue, prevMonthRevenue)}
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
            <div className="text-2xl font-bold">+{totalBookings}</div>
             <p className="text-xs text-muted-foreground">
                {calculatePercentageChange(totalBookings, prevMonthBookings)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Customers</CardTitle>
            <CircleUser className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+{newCustomers}</div>
             <p className="text-xs text-muted-foreground">
                {calculatePercentageChange(newCustomers, prevMonthNewCustomers)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tables</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeTables} / {totalTables}</div>
            <p className="text-xs text-muted-foreground">
              {totalTables > 0 ? ((activeTables / totalTables) * 100).toFixed(0) : 0}% capacity
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Avg APC</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-center gap-1">
              {(['day', 'week', 'month'] as ApcRange[]).map((range) => (
                <Button
                  key={range}
                  type="button"
                  size="sm"
                  variant={apcRange === range ? 'default' : 'outline'}
                  className="h-7 px-2 text-xs capitalize"
                  onClick={() => setApcRange(range)}
                >
                  {range}
                </Button>
              ))}
            </div>
            <div className="text-2xl font-bold">
              {employeeApcLoading ? '...' : employeeApc !== null ? `${currencySymbol}${employeeApc.toFixed(2)}` : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              {employeeApcOrdersCount} order{employeeApcOrdersCount === 1 ? '' : 's'} in selected {apcRange}
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
              <Link href="/dashboard/bookings">
                View All
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
             {bookings.length > 0 ? (
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">
                        Time
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                        Guests
                    </TableHead>
                    <TableHead>
                        Status
                    </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {bookings.slice(0, 5).map(booking => (
                    <TableRow key={booking.id}>
                        <TableCell>
                        <div className="font-medium">{booking.customer}</div>
                        <div className="text-sm text-muted-foreground md:hidden">
                            {booking.time}
                        </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{booking.time}</TableCell>
                        <TableCell className="hidden md:table-cell">{booking.guests}</TableCell>
                        <TableCell>
                        <Badge className="text-xs" variant={booking.status === "Confirmed" ? "default" : "outline"}>
                            {booking.status}
                        </Badge>
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                </Table>
             ) : (
                <div className="text-center text-muted-foreground py-8">
                    <p>No recent bookings. Get started by adding a new one!</p>
                </div>
             )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
