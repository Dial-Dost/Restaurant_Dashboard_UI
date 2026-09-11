
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowUpRight, Activity, CircleUser, CreditCard, DollarSign, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isWaiterOnly as sessionIsWaiterOnly } from '@/lib/session-scope';
import { getBookings, getCustomers, getTables, getMonthlyApcInsight } from '@/lib/db';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { Booking } from './bookings/data';
import type { Customer } from './customers/page';
import type { Table as TableType } from './tables/data';
import { useCurrency } from '@/hooks/use-currency';

type ApcRange = 'day' | 'week' | 'month';

// Which metric card's breakdown dialog is open (null = none).
type DetailKey = 'revenue' | 'bookings' | 'customers' | 'tables' | 'apc';

const normalizeActionName = (value: string) => value.trim().toLowerCase();

const hasKeywordAction = (actionNames: Set<string>, keywords: string[]) => {
  if (keywords.length === 0) {return true;}
  for (const actionName of actionNames) {
    if (keywords.some((keyword) => actionName.includes(keyword.toLowerCase()))) {
      return true;
    }
  }
  return false;
};

// A card that opens its breakdown dialog — hover/focus affordance matches the
// rest of the dashboard (border + subtle elevation shift).
function ClickableCard({
  onClick,
  label,
  className,
  children,
}: {
  onClick: () => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'cursor-pointer transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const { currencySymbol } = useCurrency();
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tables, setTables] = useState<TableType[]>([]);
  const [dashboardRevenue, setDashboardRevenue] = useState<number | null>(null);
  const [apcRange, setApcRange] = useState<ApcRange>('week');
  const [employeeApc, setEmployeeApc] = useState<number | null>(null);
  const [employeeApcOrdersCount, setEmployeeApcOrdersCount] = useState<number>(0);
  const [employeeApcLoading, setEmployeeApcLoading] = useState<boolean>(false);

  useEffect(() => {
    if (user && user.restaurantUsername) {
      const fetchData = async () => {
        setEmployeeApcLoading(true);
        try {
          const [bookingData, customerData, tableData, apcInsight, dashboardApcInsight] = await Promise.all([
            getBookings(user.restaurantUsername),
            getCustomers(user.restaurantUsername),
            getTables(user.restaurantUsername),
            getMonthlyApcInsight(user.restaurantUsername, {
              period: apcRange,
              employeeId: user.employeeId,
            }),
            getMonthlyApcInsight(user.restaurantUsername, { period: 'month' }),
          ]);

          setBookings(bookingData);
          setCustomers(customerData);
          setTables(tableData);
          setDashboardRevenue(dashboardApcInsight?.total_revenue ?? 0);
          setEmployeeApc(apcInsight ? apcInsight.monthly_apc : null);
          setEmployeeApcOrdersCount(apcInsight?.orders?.length ?? 0);
        } catch {
          setDashboardRevenue(null);
          setEmployeeApc(null);
          setEmployeeApcOrdersCount(0);
        } finally {
          setEmployeeApcLoading(false);
        }
      }
      fetchData();
    } else {
      Promise.resolve().then(() => {
        setDashboardRevenue(null);
        setEmployeeApc(null);
        setEmployeeApcOrdersCount(0);
      });
    }
  }, [user, apcRange]);

  // Current month data
  const customerRevenueFallback = customers.reduce((acc, customer) => acc + customer.billAmount, 0);
  const totalRevenue = dashboardRevenue ?? customerRevenueFallback;
  const totalBookings = bookings.length;
  const newCustomers = customers.filter(c => c.totalBookings === 1).length;
  const activeTables = tables.filter(t => t.status !== "Available").length;
  const totalTables = tables.length;

  // Section access mirrors the dashboard layout's nav gating, so we never offer
  // a link into a section the signed-in user would be redirected out of.
  const actionNames = useMemo(
    () => new Set((user?.action_names ?? []).map(normalizeActionName).filter((name) => name.length > 0)),
    [user?.action_names],
  );
  const hasAllActions = Array.isArray(user?.actions_set) && user.actions_set.includes('*');
  const hasRole = (role: string) => {
    if (!user) {return false;}
    if (user.role === role) {return true;}
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false;
  };
  const canAccessByAction = (keywords: string[]) => {
    if (hasAllActions) {return true;}
    if (actionNames.size === 0) {return true;}
    return hasKeywordAction(actionNames, keywords);
  };
  const isValet = hasRole('valet') && !hasRole('admin');
  /*
    THE SERVER'S ANSWER, NOT A SECOND GUESS AT IT.

    This read `hasRole('waiter') && !hasRole('admin')` — a test on the SPELLING
    of a role rather than on authority. A waiter granted any custom role carries
    that role's UUID in `role_all`, the test flipped, and every tile on this
    overview opened up, money included. `scope.waiter_only` is the backend's one
    answer (role_scope.ts); see src/lib/session-scope.ts.
  */
  const isWaiterOnly = sessionIsWaiterOnly(user);
  const canOpenSection = (href: string, keywords: string[]) => {
    if (!user) {return false;}
    if (isValet) {return false;}
    // The two screens a scoped waiter works from — kept in step with the
    // dashboard layout's own allow-list, so a tile here never links somewhere
    // the shell would immediately bounce them out of.
    if (isWaiterOnly) {return href === '/dashboard/orders' || href === '/dashboard/tables';}
    return canAccessByAction(keywords);
  };
  const canOpenAnalytics = canOpenSection('/dashboard/analytics', ['analytics', 'apc', 'report']);
  const canOpenTables = canOpenSection('/dashboard/tables', ['table']);
  const canOpenBookings = canOpenSection('/dashboard/bookings', ['booking']);
  const canOpenCustomers = canOpenSection('/dashboard/customers', ['customer']);
  const canOpenOrders = canOpenSection('/dashboard/orders', ['order', 'bill', 'payment']);

  const occupiedTables = tables.filter(t => t.status !== 'Available');
  const bookingsByStatus = bookings.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});
  const topSpenders = [...customers].sort((a, b) => b.billAmount - a.billAmount).slice(0, 5);
  const firstTimeGuests = customers.filter(c => c.totalBookings === 1);
  const pendingBookings = bookings.filter(b => b.status === 'Confirmed').length;

  // Every dialog below is built from data already loaded above — no extra fetches.
  const detailViews: Record<DetailKey, {
    title: string;
    description: string;
    body: React.ReactNode;
    link?: { href: string; label: string };
  }> = {
    revenue: {
      title: 'Total revenue',
      description: 'This month, and the guests contributing most to it.',
      body: (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Revenue this month</span>
            <span className="font-semibold">{currencySymbol}{totalRevenue.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Billed guests on record</span>
            <span className="font-semibold">{customers.length}</span>
          </div>
          {topSpenders.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Top guests by bill</p>
              {topSpenders.map((c) => (
                <div key={c.customerId ?? c.name} className="flex items-center justify-between border-b py-1 last:border-b-0">
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">{currencySymbol}{c.billAmount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No billed guests yet.</p>
          )}
        </div>
      ),
      link: canOpenAnalytics ? { href: '/dashboard/analytics', label: 'View in Analytics' } : undefined,
    },
    bookings: {
      title: 'Bookings',
      description: 'How the current booking list breaks down by status.',
      body: (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total bookings</span>
            <span className="font-semibold">{totalBookings}</span>
          </div>
          {Object.keys(bookingsByStatus).length > 0 ? (
            Object.entries(bookingsByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between border-b py-1 last:border-b-0">
                <Badge variant="outline">{status}</Badge>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No bookings yet.</p>
          )}
        </div>
      ),
      link: canOpenBookings ? { href: '/dashboard/bookings', label: 'View in Bookings' } : undefined,
    },
    customers: {
      title: 'New customers',
      description: 'Guests whose first visit is on record.',
      body: (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">First-time guests</span>
            <span className="font-semibold">{newCustomers}</span>
          </div>
          {firstTimeGuests.length > 0 ? (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {firstTimeGuests.slice(0, 20).map((c) => (
                <div key={c.customerId ?? c.name} className="flex items-center justify-between border-b py-1 last:border-b-0">
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">{currencySymbol}{c.billAmount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No first-time guests yet.</p>
          )}
        </div>
      ),
      link: canOpenCustomers ? { href: '/dashboard/customers', label: 'View in Customers' } : undefined,
    },
    tables: {
      title: 'Active tables',
      description: 'Which tables are currently not available.',
      body: (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Occupancy</span>
            <span className="font-semibold">
              {activeTables} / {totalTables} ({totalTables > 0 ? ((activeTables / totalTables) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          {occupiedTables.length > 0 ? (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {occupiedTables.map((t) => (
                <div key={t.id} className="flex items-center justify-between border-b py-1 last:border-b-0">
                  <span>{t.name} · {t.capacity} seats</span>
                  <Badge variant="outline">{t.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">Every table is available right now.</p>
          )}
        </div>
      ),
      link: canOpenTables ? { href: '/dashboard/tables', label: 'View in Tables' } : undefined,
    },
    apc: {
      title: 'My average per cover',
      description: `How your APC is calculated for the selected ${apcRange}.`,
      body: (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Period</span>
            <span className="font-semibold capitalize">{apcRange}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Orders in period</span>
            <span className="font-semibold">{employeeApcOrdersCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Average per cover</span>
            <span className="font-semibold">
              {employeeApc !== null ? `${currencySymbol}${employeeApc.toFixed(2)}` : 'N/A'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            APC = total covered spend ÷ covers served, over the orders you handled in the selected {apcRange}.
          </p>
        </div>
      ),
      link: canOpenAnalytics ? { href: '/dashboard/analytics', label: 'View in Analytics' } : undefined,
    },
  };

  const activeDetail = detail ? detailViews[detail] : null;

  const attentionTiles = [
    canOpenOrders && {
      key: 'orders',
      label: 'Orders in progress',
      value: `${occupiedTables.length}`,
      hint: 'Open the orders board',
      href: '/dashboard/orders',
    },
    canOpenTables && {
      key: 'tables',
      label: 'Tables to turn',
      value: `${activeTables} / ${totalTables}`,
      hint: 'Manage the floor',
      href: '/dashboard/tables',
    },
    canOpenBookings && {
      key: 'bookings',
      label: 'Confirmed bookings',
      value: `${pendingBookings}`,
      hint: 'Review the booking list',
      href: '/dashboard/bookings',
    },
  ].filter(Boolean) as { key: string; label: string; value: string; hint: string; href: string }[];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Dashboard</h1>
        <Button asChild>
          <Link href="/dashboard/bookings">Create Booking</Link>
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-5">
        <ClickableCard label="Total revenue breakdown" onClick={() => { setDetail('revenue'); }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currencySymbol}{totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
                Total revenue
            </p>
          </CardContent>
        </ClickableCard>
        <ClickableCard label="Bookings breakdown" onClick={() => { setDetail('bookings'); }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Bookings
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalBookings}</div>
             <p className="text-xs text-muted-foreground">
                Total bookings
            </p>
          </CardContent>
        </ClickableCard>
        <ClickableCard label="New customers breakdown" onClick={() => { setDetail('customers'); }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Customers</CardTitle>
            <CircleUser className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{newCustomers}</div>
             <p className="text-xs text-muted-foreground">
                First-time guests
            </p>
          </CardContent>
        </ClickableCard>
        <ClickableCard label="Active tables breakdown" onClick={() => { setDetail('tables'); }}>
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
        </ClickableCard>
        <ClickableCard label="My average per cover breakdown" onClick={() => { setDetail('apc'); }}>
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
                  onClick={(event) => {
                    // Range switch stays a range switch — don't open the dialog.
                    event.stopPropagation();
                    setApcRange(range);
                  }}
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
        </ClickableCard>
      </div>
      {attentionTiles.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attentionTiles.map((tile) => (
            <Card
              key={tile.key}
              role="button"
              tabIndex={0}
              aria-label={`${tile.label} — ${tile.hint}`}
              onClick={() => { router.push(tile.href); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  router.push(tile.href);
                }
              }}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium">{tile.label}</p>
                  <p className="text-xs text-muted-foreground">{tile.hint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">{tile.value}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) {setDetail(null);} }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{activeDetail?.title}</DialogTitle>
            <DialogDescription>{activeDetail?.description}</DialogDescription>
          </DialogHeader>
          {activeDetail?.body}
          {activeDetail?.link && (
            <DialogFooter>
              <Button asChild size="sm" className="gap-1" onClick={() => { setDetail(null); }}>
                <Link href={activeDetail.link.href}>
                  {activeDetail.link.label}
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
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
