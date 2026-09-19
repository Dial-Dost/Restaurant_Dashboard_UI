"use client";

// The running-bill / APC strip at the top of the dine-in pad — Flutter's
// `TableApcStrip` (widgets/table_bill.dart), including the live projection of
// the cart being typed ("With this cart: ₹1,840 · APC ₹460 of ₹500"). Tapping
// it opens the full table-bill drill-down (finding 22/23).

import * as React from "react";
import { Receipt, ShoppingCart, TrendingUp } from "lucide-react";

import { ForkCard } from "@/components/ui/fork-card";
import { MicroStat } from "@/components/ui/micro-stat";
import { TickTag } from "@/components/ui/tick-tag";
import { cn } from "@/lib/utils";
import { apcLabel, billList, billNum, billStr, type TableBill } from "@/lib/api/order-entry";

const toneColor = (status: string): string =>
  status === "green" ? "hsl(var(--success))" : status === "yellow" ? "hsl(var(--warning))" : "hsl(var(--destructive))";

export interface TableApcStripProps {
  bill: TableBill;
  showsMoney: boolean;
  /** The cart in hand, priced (0 when money is hidden). */
  pendingTotal: number;
  money: (raw: unknown) => string;
  onOpen?: () => void;
}

export function TableApcStrip({ bill, showsMoney, pendingTotal, money, onOpen }: TableApcStripProps): React.JSX.Element {
  const status = billStr(bill, "apc_status") || "neutral";
  const covers = billNum(bill, "covers");
  const target = billNum(bill, "target_apc");
  const running = bill.subtotal !== undefined ? billNum(bill, "subtotal") : billNum(bill, "total_amt");
  const orders = Array.isArray(bill.order_ids) ? bill.order_ids.length : 0;
  const items = billList(bill, "items").length;
  const projected = covers > 0 ? (running + pendingTotal) / covers : 0;
  const showProjection = showsMoney && pendingTotal > 0 && covers > 0;
  const onTarget = target !== 0 && projected >= target;

  return (
    <ForkCard inset onClick={onOpen} className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Receipt aria-hidden className="h-[15px] w-[15px] shrink-0 text-accent-hi" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {orders === 0
            ? "Nothing ordered on this table yet"
            : `${String(orders)} active order${orders === 1 ? "" : "s"} · ${String(items)} item${items === 1 ? "" : "s"}`}
        </span>
        {showsMoney && status !== "neutral" ? <TickTag label={apcLabel(status)} color={toneColor(status)} /> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-[22px] gap-y-2.5">
        {showsMoney ? (
          <>
            <MicroStat value={money(running)} label="running bill" />
            <MicroStat value={covers === 0 ? "—" : covers.toFixed(0)} label="covers" />
            <MicroStat value={money(bill.apc)} label="apc" />
            {target !== 0 ? <MicroStat value={money(target)} label="target apc" /> : null}
          </>
        ) : (
          <MicroStat value={String(items)} label={items === 1 ? "item on the table" : "items on the table"} />
        )}
      </div>
      {showProjection ? (
        <div
          className={cn(
            "mt-2.5 flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
            onTarget ? "border-success/28 bg-success/12" : "border-accent-hi/28 bg-accent-hi/12",
          )}
        >
          {onTarget
            ? <TrendingUp aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
            : <ShoppingCart aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent-hi" />}
          <span className="min-w-0 flex-1">
            {`With this cart: ${money(running + pendingTotal)} · APC ${money(projected)}${target === 0 ? "" : ` of ${money(target)}`}`}
          </span>
        </div>
      ) : null}
    </ForkCard>
  );
}
