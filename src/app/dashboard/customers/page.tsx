
"use client";

import React, { useState, useEffect } from "react";
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
import { PlusCircle, ChevronDown, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { getCustomers, addCustomer, getCustomerInsights, type CustomerInsight, type CustomerSegment } from "@/lib/db";
import { useCurrency } from "@/hooks/use-currency";


export type Customer = {
  customerId?: string;
  name: string;
  email: string;
  phone: string;
  totalBookings: number;
  status: "In-house" | "Departed";
  billAmount: number;
  // Optional demographic tags — used only in AGGREGATED analytics (never shown per-person).
  gender?: string;
  ageGroup?: string;
  pincode?: string;
};

const customerSchema = z.object({
    name: z.string().min(1, "Name is required."),
    email: z.string().email("Invalid email address."),
    phone: z.string().min(10, "Phone number is too short."),
    billAmount: z.coerce.number().positive("Bill amount must be positive."),
    gender: z.string().optional(),
    ageGroup: z.string().optional(),
    pincode: z.string().max(10).optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;

// Segment badge styling + labels (CRM view). Order here drives the filter chips.
const SEGMENTS: Array<{ key: CustomerSegment; label: string; className: string }> = [
  { key: "new", label: "New", className: "bg-muted text-muted-foreground" },
  { key: "regular", label: "Regular", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  { key: "high-spend", label: "High spend", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  { key: "dormant", label: "Dormant", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100" },
];

function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  const s = SEGMENTS.find((x) => x.key === segment) ?? SEGMENTS[0];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.className}`}>{s.label}</span>;
}

export default function CustomersPage() {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [insights, setInsights] = useState<Map<string, CustomerInsight>>(new Map());
  const [segmentFilter, setSegmentFilter] = useState<CustomerSegment | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const refresh = async (restaurantUsername: string) => {
    const [list, crm] = await Promise.all([
      getCustomers(restaurantUsername),
      getCustomerInsights(restaurantUsername),
    ]);
    setCustomers(list);
    setInsights(new Map(crm.map((c) => [c.customer_id, c])));
  };

  useEffect(() => {
    if (user) void refresh(user.restaurantUsername);
  }, [user]);

  const handleAddCustomer = async (data: CustomerFormData) => {
    if (!user) return;
    const newCustomer: Customer = {
      ...data,
      totalBookings: 1,
      status: 'In-house',
    };
    await addCustomer(user.restaurantUsername, newCustomer);
    await refresh(user.restaurantUsername);
    setIsDialogOpen(false);
  }

  // Segment for a row: from the CRM insights; unmatched customers count as "new".
  const segmentOf = (c: Customer): CustomerSegment => insights.get(c.customerId ?? "")?.segment ?? "new";
  const visible = segmentFilter === "all" ? customers : customers.filter((c) => segmentOf(c) === segmentFilter);
  const countBySegment = (key: CustomerSegment) => customers.filter((c) => segmentOf(c) === key).length;

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
            All customers, with visit/spend history and CRM segments (matched from orders by phone or name). Click a row to expand.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant={segmentFilter === "all" ? "default" : "outline"}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setSegmentFilter("all")}
            >
              All ({customers.length})
            </Button>
            {SEGMENTS.map((s) => (
              <Button
                key={s.key}
                variant={segmentFilter === s.key ? "default" : "outline"}
                size="sm"
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setSegmentFilter(s.key)}
              >
                {s.label} ({countBySegment(s.key)})
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead className="hidden md:table-cell text-center">Visits</TableHead>
                <TableHead className="hidden md:table-cell text-right">Total Spend</TableHead>
                <TableHead className="hidden lg:table-cell text-center">Last Visit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Bill Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                    No customers in this segment.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((customer, index) => {
                const rowKey = customer.customerId ?? `${customer.email}-${customer.phone}-${index}`;
                const insight = insights.get(customer.customerId ?? "");
                const expanded = expandedId === rowKey;
                return (
                  <React.Fragment key={rowKey}>
                    <TableRow className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : rowKey)}>
                      <TableCell className="pr-0 text-muted-foreground">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div>{customer.name}</div>
                        <div className="text-sm text-muted-foreground md:hidden">{customer.email}</div>
                      </TableCell>
                      <TableCell><SegmentBadge segment={insight?.segment ?? "new"} /></TableCell>
                      <TableCell className="hidden md:table-cell text-center">
                        {(insight?.visits ?? 0) > 0 ? (
                          insight?.visits
                        ) : (
                          <span className="text-muted-foreground" title="Visits appear when orders carry this guest's phone number.">0</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right">{currencySymbol}{(insight?.total_spend ?? 0).toFixed(0)}</TableCell>
                      <TableCell className="hidden lg:table-cell text-center">{insight?.last_visit ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={customer.status === "In-house" ? "default" : "secondary"}>
                          {customer.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{currencySymbol}{customer.billAmount.toFixed(2)}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={8} className="py-3">
                          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                            <div className="space-y-1 text-sm">
                              <div className="flex items-center gap-2 pb-1"><SegmentBadge segment={insight?.segment ?? "new"} /></div>
                              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Visits (distinct days)</span><span className="font-medium">{insight?.visits ?? 0}</span></div>
                              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Total spend</span><span className="font-medium">{currencySymbol}{(insight?.total_spend ?? 0).toFixed(0)}</span></div>
                              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Last visit</span><span className="font-medium">{insight?.last_visit ?? "—"}</span></div>
                              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Avg feedback</span><span className="font-medium">{insight?.avg_rating != null ? `${insight.avg_rating}/5 (${insight.feedbacks})` : "—"}</span></div>
                              {customer.phone ? <div className="flex justify-between gap-4"><span className="text-muted-foreground">Phone</span><span className="font-medium">{customer.phone}</span></div> : null}
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Recent visits</p>
                              {(insight?.history ?? []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No visits yet — visits appear when orders carry this guest&apos;s phone number (or the name captured at order time). QR and POS orders that include a phone are registered here automatically.
                                </p>
                              ) : (
                                <table className="w-full max-w-md text-sm">
                                  <thead className="text-left text-muted-foreground">
                                    <tr className="border-b"><th className="py-1 pr-2">Day</th><th className="py-1 pr-2 text-right">Orders</th><th className="py-1 text-right">Spend</th></tr>
                                  </thead>
                                  <tbody>
                                    {(insight?.history ?? []).map((h) => (
                                      <tr key={h.day} className="border-b last:border-0">
                                        <td className="py-1 pr-2 font-medium">{h.day}</td>
                                        <td className="py-1 pr-2 text-right">{h.orders}</td>
                                        <td className="py-1 text-right">{currencySymbol}{h.spend.toFixed(0)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
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
          <p className="text-xs text-muted-foreground">Optional — used only for aggregated analytics (demographics), never shown per guest.</p>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="gender" className="text-right">Gender</Label>
            <div className="col-span-3">
              <select id="gender" {...register("gender")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring">
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ageGroup" className="text-right">Age group</Label>
            <div className="col-span-3">
              <select id="ageGroup" {...register("ageGroup")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring">
                <option value="">Skip</option>
                <option value="<18">&lt;18</option>
                <option value="18-25">18–25</option>
                <option value="26-35">26–35</option>
                <option value="36-50">36–50</option>
                <option value="51+">51+</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="pincode" className="text-right">Pincode</Label>
            <div className="col-span-3">
              <Input id="pincode" {...register("pincode")} placeholder="e.g., 560003" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Add Customer</Button>
          </DialogFooter>
        </form>
    )
}
