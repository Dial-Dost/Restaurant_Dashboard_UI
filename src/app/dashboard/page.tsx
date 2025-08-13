
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
            <div className="text-2xl font-bold">$45,231.89</div>
            <p className="text-xs text-muted-foreground">
              +20.1% from last month
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
            <div className="text-2xl font-bold">+2350</div>
            <p className="text-xs text-muted-foreground">
              +180.1% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Customers</CardTitle>
            <CircleUser className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+573</div>
            <p className="text-xs text-muted-foreground">
              +19% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tables</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12 / 20</div>
            <p className="text-xs text-muted-foreground">
              60% capacity
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
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">Liam Johnson</div>
                    <div className="text-sm text-muted-foreground md:hidden">
                      liam@example.com
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">2023-06-23 6:30 PM</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge className="text-xs" variant="outline">
                      Confirmed
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">$250.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">Olivia Smith</div>
                    <div className="text-sm text-muted-foreground md:hidden">
                      olivia@example.com
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">2023-06-24 7:00 PM</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge className="text-xs" variant="outline">
                      Pending
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">$150.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">Noah Williams</div>
                    <div className="text-sm text-muted-foreground md:hidden">
                      noah@example.com
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">2023-06-25 8:00 PM</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge className="text-xs" variant="outline">
                      Confirmed
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">$350.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">Emma Brown</div>
                    <div className="text-sm text-muted-foreground md:hidden">
                      emma@example.com
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">2023-06-26 9:00 PM</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge className="text-xs" variant="outline">
                      Cancelled
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">$450.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">Liam Johnson</div>
                    <div className="text-sm text-muted-foreground md:hidden">
                      liam@example.com
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">2023-06-27 5:30 PM</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge className="text-xs" variant="outline">
                      Confirmed
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">$550.00</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
