"use client";

// The table-bill drill-down reachable from the pad's APC strip — Flutter's
// `showTableBillSheet` (widgets/table_bill.dart): the strip again, "On this
// table" merged lines, the totals card and the server's own upsell hints.
// Read-only; money is gated exactly as the strip gates it.

import * as React from "react";
import { Lightbulb, RefreshCw, TrendingDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { billList, billNum, billStr, type TableBill } from "@/lib/api/order-entry";
import { TableApcStrip } from "./table-apc-strip";

export interface TableBillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableLabel: string;
  bill: TableBill | null;
  loading: boolean;
  error: unknown;
  onRefresh: () => void;
  showsMoney: boolean;
  pendingTotal: number;
  money: (raw: unknown) => string;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className={strong ? "micro-label" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "display-sm tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}

export function TableBillSheet(props: TableBillSheetProps): React.JSX.Element {
  const { open, onOpenChange, tableLabel, bill, loading, error, onRefresh, showsMoney, pendingTotal, money } = props;
  const items = billList(bill, "items");
  const status = billStr(bill, "apc_status") || "neutral";
  const suggestions = Array.isArray(bill?.apc_suggestions)
    ? (bill.apc_suggestions as unknown[]).filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : [];
  const nc = billNum(bill, "nc_total");

  return (
    <DrillSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Table ${tableLabel}`}
      action={(
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw /> Refresh
        </Button>
      )}
    >
      {loading && bill === null ? <SkeletonRows rows={5} /> : null}
      {!loading && bill === null && error ? (
        <LoadErrorState whatFailed="Couldn't load this table's bill." error={error} onRetry={onRefresh} />
      ) : null}
      {!loading && bill === null && !error ? (
        <p className="text-sm text-muted-foreground">No open bill on this table yet — nothing has been ordered.</p>
      ) : null}
      {bill !== null ? (
        <div className="space-y-4">
          <TableApcStrip bill={bill} showsMoney={showsMoney} pendingTotal={pendingTotal} money={money} />

          <div>
            <SectionHeader title="On this table" />
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No items on the bill yet.</p>
            ) : (
              <ForkCard inset className="px-3.5 py-2">
                {items.map((it, idx) => {
                  const name = typeof it.name === "string" && it.name !== "" ? it.name : "—";
                  const isNc = it.nc === true;
                  const qty = Number(it.quantity ?? 1) || 1;
                  const note = typeof it.note === "string" ? it.note.trim() : "";
                  const amount = isNc ? 0 : (Number(it.price) || 0) * qty;
                  return (
                    <div key={idx} className="flex items-start gap-2.5 border-b border-divider py-1.5 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{`${showsMoney && isNc ? `${name} (NC)` : name}  ×${String(qty)}`}</div>
                        {note !== "" ? <div className="text-[11px] italic text-muted-foreground">{note}</div> : null}
                      </div>
                      {showsMoney ? <span className="text-sm font-semibold tabular-nums">{money(amount)}</span> : null}
                    </div>
                  );
                })}
              </ForkCard>
            )}
          </div>

          {showsMoney ? (
            <ForkCard inset className="px-4 py-3">
              <Row label="Subtotal" value={money(bill.subtotal ?? bill.total_amt)} />
              {billNum(bill, "discount") > 0 ? <Row label="Discount" value={`− ${money(bill.discount)}`} /> : null}
              {billNum(bill, "service_charge") > 0 ? <Row label="Service charge" value={money(bill.service_charge)} /> : null}
              {billNum(bill, "tax_total") > 0 ? <Row label="Tax" value={money(bill.tax_total)} /> : null}
              {billNum(bill, "round_off") !== 0 ? <Row label="Round off" value={money(bill.round_off)} /> : null}
              <div className="my-1.5 border-t border-divider" />
              <Row label="TOTAL PAYABLE" value={money(billNum(bill, "grand_total") || billNum(bill, "total_amt"))} strong />
              {nc > 0 ? <Row label="NC value (not charged)" value={money(nc)} /> : null}
            </ForkCard>
          ) : null}

          {showsMoney && (status === "red" || status === "yellow") ? (
            <div
              className={
                status === "red"
                  ? "rounded-md border border-destructive/28 bg-destructive/12 p-3"
                  : "rounded-md border border-warning/28 bg-warning/12 p-3"
              }
            >
              <div className={`flex items-center gap-2 text-sm font-semibold ${status === "red" ? "text-destructive" : "text-warning"}`}>
                {status === "red" ? <TrendingDown className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
                {status === "red" ? "Below target — push to upsell" : "Close to target — suggest more"}
              </div>
              {suggestions.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">Suggest a dessert or a drink to lift the bill.</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {suggestions.map((s) => <li key={s} className="text-xs text-muted-foreground">{`• ${s}`}</li>)}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </DrillSheet>
  );
}
