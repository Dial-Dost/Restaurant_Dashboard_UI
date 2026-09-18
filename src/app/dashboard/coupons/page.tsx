"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Trash2, Ticket, Pencil, Gift } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate, utcToWallClockInZone, wallClockToUtcInZone } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import type { Coupon, CouponInput} from "@/lib/db";
import { getCoupons, saveCoupon, deleteCoupon, createGiftVoucher } from "@/lib/db";

const blank: CouponInput = {
  code: "",
  description: "",
  type: "percent",
  value: 10,
  min_order: 0,
  max_discount: null,
  usage_limit: null,
  per_customer_limit: null,
  valid_from: null,
  valid_to: null,
  active: true,
};

export default function CouponsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  // ISO <-> input[type=datetime-local]. The bare wall clock in the input means
  // RESTAURANT time: "valid until 31 Dec 23:59" has to be the restaurant's
  // midnight, not the browser's, or a coupon dies hours early for an owner
  // travelling east.
  const toLocalInput = useCallback(
    (iso: string | null | undefined) => (iso ? utcToWallClockInZone(iso, timezone) : ""),
    [timezone],
  );
  const fromLocalInput = useCallback(
    (v: string) => (v ? (wallClockToUtcInZone(v, timezone)?.toISOString() ?? null) : null),
    [timezone],
  );
  const restaurantId = user?.restaurantUsername ?? "";
  const isAdmin = !!user && (user.role === "admin" || (Array.isArray(user.role_all) && user.role_all.includes("admin")));

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CouponInput>(blank);
  const [saving, setSaving] = useState(false);
  // Gift vouchers (kind='gift' coupons with a spendable balance).
  const [voucherAmount, setVoucherAmount] = useState("");
  const [voucherCode, setVoucherCode] = useState("");
  const [issuing, setIssuing] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) {return;}
    try {
      setCoupons(await getCoupons(restaurantId));
    } catch {
      setCoupons([]);
    }
  }, [restaurantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setForm(blank);
    setOpen(true);
  };
  const openEdit = (c: Coupon) => {
    setForm({
      id: c.id,
      code: c.code,
      description: c.description ?? "",
      type: c.type,
      value: c.value,
      min_order: c.min_order,
      max_discount: c.max_discount,
      usage_limit: c.usage_limit,
      per_customer_limit: c.per_customer_limit,
      valid_from: c.valid_from,
      valid_to: c.valid_to,
      active: c.active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!restaurantId) {return;}
    setSaving(true);
    try {
      await saveCoupon(restaurantId, form);
      setOpen(false);
      await load();
      toast({ title: "Coupon saved" });
    } catch (e: any) {
      toast({ title: "Couldn't save coupon", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Coupon) => {
    if (!restaurantId) {return;}
    try {
      await deleteCoupon(restaurantId, c.id);
      await load();
    } catch (e: any) {
      toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" });
    }
  };

  const issueVoucher = async () => {
    if (!restaurantId) {return;}
    const amount = Number(voucherAmount) || 0;
    if (amount <= 0) {return;}
    setIssuing(true);
    try {
      const v = await createGiftVoucher(restaurantId, { amount, ...(voucherCode.trim() ? { code: voucherCode.trim() } : {}) });
      toast({ title: `Voucher ${v.code} issued`, description: `Balance ₹${v.balance ?? amount} — redeem at billing like any coupon code.` });
      setVoucherAmount("");
      setVoucherCode("");
      await load();
    } catch (e: any) {
      toast({ title: "Couldn't issue voucher", description: e?.message, variant: "destructive" });
    } finally {
      setIssuing(false);
    }
  };

  if (!isAdmin) {
    return <div className="p-4"><p>You do not have permission to view this page. Required role: admin.</p></div>;
  }

  const set = (patch: Partial<CouponInput>) => { setForm((f) => ({ ...f, ...patch })); };
  const numOrNull = (v: string) => (v === "" ? null : Math.max(0, Number(v) || 0));
  const promos = coupons.filter((c) => c.kind !== "gift");
  const vouchers = coupons.filter((c) => c.kind === "gift");

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between max-lg:flex-wrap max-lg:gap-2">
        <h1 className="text-lg font-semibold md:text-2xl">Coupons</h1>
        <Button onClick={openNew}>
          <PlusCircle className="mr-2 h-4 w-4" /> New coupon
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Ticket className="h-4 w-4" /> Promo codes</CardTitle>
          <CardDescription>Customizable discount codes — percentage or flat, with limits, caps and validity windows.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead className="hidden md:table-cell">Rules</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promos.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No coupons yet.</TableCell></TableRow>
              ) : (
                promos.map((c) => {
                  const rules = [
                    c.min_order > 0 ? `min ₹${c.min_order}` : null,
                    c.max_discount ? `cap ₹${c.max_discount}` : null,
                    c.usage_limit != null ? `${c.usage_limit} total` : null,
                    c.per_customer_limit != null ? `${c.per_customer_limit}/customer` : null,
                    c.valid_to ? `until ${formatDate(c.valid_to, timezone)}` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell>{c.type === "percent" ? `${c.value}% off` : `₹${c.value} off`}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{rules || "—"}</TableCell>
                      <TableCell className="text-right">{c.used_count}{c.usage_limit != null ? `/${c.usage_limit}` : ""}</TableCell>
                      <TableCell>{c.active ? <Badge>Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { openEdit(c); }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void remove(c)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4" /> Gift vouchers</CardTitle>
          <CardDescription>Prepaid codes with a spendable balance — staff redeem them at billing like any coupon; the balance decrements each time and the code deactivates at ₹0.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label>Amount (₹)</Label>
              <Input type="number" min="0" className="w-32" value={voucherAmount} onChange={(e) => { setVoucherAmount(e.target.value); }} placeholder="500" />
            </div>
            <div className="grid gap-1">
              <Label>Code (optional)</Label>
              <Input className="w-44 font-mono" value={voucherCode} onChange={(e) => { setVoucherCode(e.target.value.toUpperCase()); }} placeholder="auto-generated" />
            </div>
            <Button onClick={() => void issueVoucher()} disabled={issuing || (Number(voucherAmount) || 0) <= 0}>
              {issuing ? "Issuing…" : "Issue voucher"}
            </Button>
          </div>
          {vouchers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gift vouchers yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Face value</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-medium">{v.code}</TableCell>
                    <TableCell className="text-right">₹{v.value}</TableCell>
                    <TableCell className="text-right font-semibold">₹{v.balance ?? 0}</TableCell>
                    <TableCell>{v.active && (v.balance ?? 0) > 0 ? <Badge>Active</Badge> : <Badge variant="secondary">{(v.balance ?? 0) <= 0 ? "Used up" : "Off"}</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void remove(v)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit coupon" : "New coupon"}</DialogTitle>
            <DialogDescription>Configure exactly how this code behaves.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Code</Label>
                <Input value={form.code} onChange={(e) => { set({ code: e.target.value.toUpperCase() }); }} placeholder="SAVE10" className="font-mono" />
              </div>
              <div className="grid gap-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => { set({ type: v as "percent" | "flat" }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage (%)</SelectItem>
                    <SelectItem value="flat">Flat amount (₹)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Description (optional)</Label>
              <Input value={form.description ?? ""} onChange={(e) => { set({ description: e.target.value }); }} placeholder="e.g., Weekday lunch offer" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>{form.type === "percent" ? "Percent off" : "Amount off (₹)"}</Label>
                <Input type="number" min="0" value={form.value} onChange={(e) => { set({ value: Number(e.target.value) || 0 }); }} />
              </div>
              {form.type === "percent" && (
                <div className="grid gap-1">
                  <Label>Max discount cap (₹)</Label>
                  <Input type="number" min="0" value={form.max_discount ?? ""} onChange={(e) => { set({ max_discount: numOrNull(e.target.value) }); }} placeholder="no cap" />
                </div>
              )}
              <div className="grid gap-1">
                <Label>Min order (₹)</Label>
                <Input type="number" min="0" value={form.min_order ?? ""} onChange={(e) => { set({ min_order: numOrNull(e.target.value) }); }} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Total usage limit</Label>
                <Input type="number" min="0" value={form.usage_limit ?? ""} onChange={(e) => { set({ usage_limit: numOrNull(e.target.value) }); }} placeholder="unlimited" />
              </div>
              <div className="grid gap-1">
                <Label>Per-customer limit</Label>
                <Input type="number" min="0" value={form.per_customer_limit ?? ""} onChange={(e) => { set({ per_customer_limit: numOrNull(e.target.value) }); }} placeholder="unlimited" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Valid from</Label>
                <Input type="datetime-local" value={toLocalInput(form.valid_from)} onChange={(e) => { set({ valid_from: fromLocalInput(e.target.value) }); }} />
              </div>
              <div className="grid gap-1">
                <Label>Valid until</Label>
                <Input type="datetime-local" value={toLocalInput(form.valid_to)} onChange={(e) => { set({ valid_to: fromLocalInput(e.target.value) }); }} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Customers can redeem this code.</p>
              </div>
              <Switch checked={form.active !== false} onCheckedChange={(v) => { set({ active: v }); }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); }}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || !form.code.trim()}>{saving ? "Saving…" : "Save coupon"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
