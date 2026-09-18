"use client";

/*
  THE SELECTED TABLE'S PREVIEW — 1.8, 1.3 AND 6.7 IN ONE PLACE.

  The Tables page opens a table by sending it here (`?table=T4`), so this card is
  the web's table preview: the owner app's table sheet, drawn at the top of the
  orders screen whenever a table is selected.

  6.7 — "While adding items to an order, reposition the Add Order and Print Bill
  buttons to be higher up on the page and increase their size." They are the
  FIRST thing in the card, full size, side by side — above the tickets, never
  under a list that grows with every round.

  1.8 — "When multiple KOTs are present for the same table … displayed as
  separated, distinct KOTs categorized by their respective KOT numbers." Each
  ticket is its own block headed "KOT 5 · 14:57", oldest first, and lines whose
  order has no KOT number share one trailing "No KOT number" block. The grouping
  is `groupItemsByKot` (src/lib/kot-groups.ts), which says why the unit is the
  order. It is built from the same orders feed the grid below draws, so every
  line of every live order on the table is in exactly one block — there is no
  second source for it to disagree with, and nothing to fall back from.

  1.3 — Cancel KOT sits on each NUMBERED block header, which is "the KOT
  section". It takes one of the two existing cancel routes (`cancelKotRoute`),
  so the reason prompt (1.2) and the CANCELLED slip (1.1) come with it. After a
  cancel the page re-reads the orders feed; the cancelled ticket leaves the
  preview on that read, and a table whose last KOT went reads "No live orders".

  C4 STILL HOLDS. Line amounts go through `visibleLineAmount`, so a waiter-only
  session sees dish and quantity and no figure — not a dash, not ₹0.00.

  R2 ITEM 1 — "…in live tables where on top of a clicked table these details can
  be updated." The very top of the card names who the bill is for and the
  corporate party's GSTIN, off the server's open bill, with the one shared
  name/GSTIN dialog beside them. Drawn only when the table has orders (there is
  no bill to name before that). EVERYONE READS IT — neither field is money, so C4
  does not touch it, and the owner app shows a waiter the same line read-only.
  Only a session the page lets use the 6.5 Bill menu gets the Edit button: the
  same people, the same route.
*/

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Clock, Pencil, PlusCircle, ReceiptText, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BillCustomerDialog, type BillCustomerInitial } from "@/components/bill-customer-dialog";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { isPlaceholderCustomer } from "@/lib/bill-customer";
import { getBillForTable } from "@/lib/db";
import { groupItemsByKot, type KotGroupOrder } from "@/lib/kot-groups";
import { visibleLineAmount, visibleMoneyText } from "@/lib/order-prices";
import { formatFullDateTime, formatTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import { CancelKotButton } from "./capture-actions";

/** The fields of an order line the preview draws. */
export interface PreviewLine {
  id: string;
  name: string;
  quantity: number;
  price: number;
  note?: string | null;
  course_hold?: boolean;
  fired_at?: string | null;
  nc?: boolean;
  nc_id?: string | null;
  nc_kind?: string | null;
}

/** The slice of an order the preview reads. */
export interface PreviewOrder extends KotGroupOrder<PreviewLine> {
  id: string;
  table: string;
  status: string;
  items: PreviewLine[];
}

export function TableKotPreview({
  restaurantId,
  tableName,
  orders,
  onAddOrder,
  printControl,
  onChanged,
  onClose,
  cancelLocked = false,
  canEditCustomer = false,
}: {
  restaurantId: string;
  tableName: string;
  /** Every order this session can see; the preview keeps the selected table's live ones. */
  orders: readonly PreviewOrder[];
  onAddOrder: () => void;
  /** The Print Bill control, built by the page that owns the print claim (C3). */
  printControl: ReactNode;
  onChanged: () => void;
  onClose: () => void;
  /**
   * C3 — this session's print of the bill has already happened, so the paper in
   * the guest's hand is final for it. The tickets stay readable; cancelling one
   * would make that paper wrong, so it is a senior's call and no button shows.
   */
  cancelLocked?: boolean;
  /**
   * R2 item 1 — may this session EDIT the name/GSTIN on the table's bill? The
   * page passes the SAME answer that draws the 6.5 Bill menu in the grid, so the
   * preview never offers a route the grid withholds. Reading the line needs no
   * permission: it is shown to every session, as the owner app does.
   */
  canEditCustomer?: boolean;
}): ReactElement {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { timezone } = useTimezone();
  const blocks = groupItemsByKot(orders, tableName);
  const numberedCount = blocks.filter((block) => block.numbered).length;
  const showCustomer = blocks.length > 0;
  // Re-read when the table's tickets change, so a name set on another device
  // shows up with the round that follows it rather than never.
  const liveKey = blocks.map((block) => block.key).join("|");
  const [billCustomer, setBillCustomer] = useState<BillCustomerInitial | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);

  // A different table is a different bill: never show the last one's name under it.
  useEffect(() => { setBillCustomer(null); }, [tableName]);
  useEffect(() => {
    if (!showCustomer || !restaurantId) { setBillCustomer(null); return; }
    let active = true;
    setCustomerLoading(true);
    getBillForTable(restaurantId, tableName)
      .then((bill: unknown) => {
        if (!active) { return; }
        const row = bill && typeof bill === "object" ? (bill as Record<string, unknown>) : null;
        setBillCustomer(row
          ? {
            customer: typeof row.customer === "string" ? row.customer : null,
            // Only when the server SENT the key: an older backend's silence is not
            // "no GSTIN", and the dialog treats the two differently.
            ...("customer_gstin" in row ? { customer_gstin: typeof row.customer_gstin === "string" ? row.customer_gstin : null } : {}),
          }
          : null);
      })
      .catch(() => { if (active) { setBillCustomer(null); } })
      .finally(() => { if (active) { setCustomerLoading(false); } });
    return () => { active = false; };
  }, [showCustomer, restaurantId, tableName, liveKey]);

  const customerName = billCustomer && !isPlaceholderCustomer(billCustomer.customer) ? String(billCustomer.customer).trim() : "";
  const gstinSupported = billCustomer !== null && "customer_gstin" in billCustomer;
  const customerGstin = (billCustomer?.customer_gstin ?? "").trim();

  return (
    <Card id="table-preview" className="border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Table {tableName}</CardTitle>
          <CardDescription>
            {blocks.length === 0
              ? "No live orders on this table yet."
              : `${String(numberedCount)} KOT${numberedCount === 1 ? "" : "s"} on this table, oldest first.`}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} title="Close the table preview and show every order">
          <X className="h-4 w-4" /> Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* R2 item 1 — who the bill is for, on top of the clicked table. One
            compact line, so 6.7's two big controls stay directly under it. */}
        {showCustomer ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
            data-testid="table-bill-customer"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <span className="text-muted-foreground">Guest: </span>
                {customerLoading && !billCustomer
                  ? <span className="text-muted-foreground">Loading…</span>
                  : customerName
                    ? <span className="font-semibold">{customerName}</span>
                    : <span className="text-muted-foreground">No name</span>}
              </span>
              {gstinSupported ? (
                <span>
                  <span className="text-muted-foreground">GSTIN: </span>
                  {customerGstin
                    ? <span className="font-mono font-semibold">{customerGstin}</span>
                    : <span className="text-muted-foreground">None</span>}
                </span>
              ) : null}
            </div>
            {/* Read-only for a scoped waiter, exactly like the owner app: the
                line, and no button. */}
            {canEditCustomer ? (
            <>
            <Button variant="outline" size="sm" onClick={() => { setCustomerOpen(true); }}>
              <Pencil className="h-3.5 w-3.5" /> Edit name / GSTIN
            </Button>
            <BillCustomerDialog
              open={customerOpen}
              onOpenChange={setCustomerOpen}
              restaurantId={restaurantId}
              target={{ kind: "table", tableName }}
              // The payload this strip already read; null makes the dialog read
              // the bill itself, which is what 6.5's dialog always did.
              initial={billCustomer}
              onSaved={(saved) => {
                setBillCustomer((prev) => ({
                  customer: saved.customer,
                  // Keep "not supported here" if the server still sends no key.
                  ...(prev && "customer_gstin" in prev ? { customer_gstin: saved.customer_gstin } : {}),
                  ...(saved.customer_gstin ? { customer_gstin: saved.customer_gstin } : {}),
                }));
                onChanged();
              }}
            />
            </>
            ) : null}
          </div>
        ) : null}

        {/* 6.7 — the two controls, first and full size. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" className="h-14 w-full text-base [&_svg]:size-5" onClick={onAddOrder}>
            <PlusCircle /> Add Order
          </Button>
          {printControl}
        </div>

        {blocks.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Orders</h3>
              <Badge variant="outline" className="tabular-nums">{blocks.length}</Badge>
            </div>
            {blocks.map((block) => {
              const { order } = block;
              const placed = block.placedAt ? formatTime(block.placedAt, timezone) : "";
              // "KOT 5 · 14:57" / "KOTs 7, 9 · 15:02", or "No KOT number" for the
              // trailing block — the owner app's exact headings.
              const heading = [block.label, placed].filter(Boolean).join(" · ");
              return (
                <div key={block.key} className="overflow-hidden rounded-lg border" data-testid="kot-block">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                    <div
                      className={cn("flex min-w-0 items-center gap-2 text-sm font-semibold", !block.numbered && "text-muted-foreground")}
                      title={block.placedAt ? formatFullDateTime(block.placedAt, timezone) : undefined}
                    >
                      {block.numbered ? <ReceiptText className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0" />}
                      <span className="tabular-nums">{heading}</span>
                      {order ? <Badge variant="outline" className="text-[10px] font-normal">{order.status}</Badge> : null}
                    </div>
                    {/* 1.3 — numbered tickets only. The trailing block is several
                        orders and not a placed ticket, so it never offers one. */}
                    {order && block.numbered && !cancelLocked ? (
                    <CancelKotButton
                      restaurantId={restaurantId}
                      kotLabel={block.label}
                      onChanged={onChanged}
                      order={{
                        id: order.id,
                        table: order.table,
                        status: order.status,
                        items: block.items.map((item) => ({
                          id: item.id,
                          name: item.name,
                          quantity: item.quantity,
                          price: item.price,
                          nc: item.nc === true,
                          nc_id: item.nc_id ?? null,
                          nc_kind: item.nc_kind ?? null,
                        })),
                      }}
                    />
                    ) : null}
                  </div>
                  <ul className="divide-y">
                    {block.items.map((item, index) => {
                      const amount = visibleMoneyText(currencySymbol, visibleLineAmount(user, item.price, item.quantity));
                      const held = item.course_hold === true && !item.fired_at;
                      return (
                        <li key={`${item.id}-${String(index)}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 font-medium">
                              <span className="tabular-nums">{item.quantity} ×</span> {item.name}
                              {held ? (
                                <Badge variant="outline" className="border-amber-400 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-800">HOLD</Badge>
                              ) : null}
                            </div>
                            {item.note ? <div className="text-xs italic text-muted-foreground">{item.note}</div> : null}
                          </div>
                          {/* C4 — the element goes for a waiter; it is never "₹0.00". */}
                          {amount === null ? null : <div className="shrink-0 tabular-nums">{amount}</div>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
