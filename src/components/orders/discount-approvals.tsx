"use client";

// DISCOUNT APPROVALS — a web-extra the audit says to KEEP (finding 35: the web
// is ahead of the source of truth here), restyled to the card/section idiom.
// Admin-only queue of staff discounts above the approval threshold, with the
// deep-link highlight a notification lands on.

import * as React from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";
import type { DiscountRequest } from "@/lib/db";
import type { HighlightRow } from "@/hooks/use-highlight-row";

export interface DiscountApprovalsProps {
  requests: DiscountRequest[];
  highlight: HighlightRow;
  currencySymbol: string;
  /** "Jun 26, 14:05" in the restaurant's zone. */
  formatWhen: (iso: string | null | undefined) => string;
  onDecide: (request: DiscountRequest, approve: boolean) => void;
  busy?: boolean;
}

export function DiscountApprovals({ requests, highlight, currencySymbol, formatWhen, onDecide, busy = false }: DiscountApprovalsProps): React.JSX.Element | null {
  if (requests.length === 0) { return null; }
  return (
    <div>
      <SectionHeader title="Discount approvals" count={requests.length} />
      <div className="mt-3 space-y-2.5">
        {requests.map((request) => {
          const rowProps = highlight.rowProps(request.id);
          return (
            <ForkCard
              key={request.id}
              id={rowProps.id}
              chevron={false}
              className={cn("flex flex-wrap items-center justify-between gap-2 p-[14px] py-3", rowProps.className)}
            >
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  Table {request.table_name ?? "?"} · {request.discount_value}{request.discount_type === "percent" ? "%" : ""} off
                  {" "}(≈{currencySymbol}{request.amount.toFixed(2)})
                </div>
                <div className="text-xs text-muted-foreground">
                  Requested by {request.requested_by ?? "unknown"} · {formatWhen(request.created_at)}
                  {request.reason ? ` · “${request.reason}”` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { onDecide(request, false); }}>
                  <X /> Reject
                </Button>
                <Button size="sm" disabled={busy} onClick={() => { onDecide(request, true); }}>
                  <Check /> Approve
                </Button>
              </div>
            </ForkCard>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Staff discounts above your approval threshold wait here until a manager decides.
      </p>
    </div>
  );
}
