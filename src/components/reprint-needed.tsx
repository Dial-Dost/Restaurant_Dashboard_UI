"use client";

// The shell-level "Print the updated bill?" prompt — the dialog shape of
// reprint_needed.dart's `askToReprint`, mounted once in the dashboard layout.
//
// Writes announce a notice via `announceReprintNeeded` (src/lib/reprint-needed.ts)
// when their response carries the backend's `reprint_needed` flag; this
// listener queues them (a merge can stale two papers at once) and asks one
// question per table, sending POST /print/bill exactly as the table sheet's
// own Print button does.

import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { printTableBill } from "@/lib/db";
import { REPRINT_NEEDED_EVENT, type ReprintNotice } from "@/lib/reprint-needed";

/** The control's words when the paper is stale — bill_print_state's label. */
export const PRINT_UPDATED_BILL_LABEL = "Print updated bill";

export function ReprintNeededListener(): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const rid = user?.restaurantUsername ?? "";
  const [queue, setQueue] = useState<ReprintNotice[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const handler = (event: Event): void => {
      // The detail is whatever the announcer dispatched — treat it as absent
      // until proven shaped.
      const notice = (event as CustomEvent<ReprintNotice | undefined>).detail;
      if (!notice?.table) { return; }
      setQueue((prev) => [...prev, notice]);
    };
    window.addEventListener(REPRINT_NEEDED_EVENT, handler);
    return () => { window.removeEventListener(REPRINT_NEEDED_EVENT, handler); };
  }, []);

  const current: ReprintNotice | null = queue.at(0) ?? null;
  const dismiss = useCallback(() => { setQueue((prev) => prev.slice(1)); }, []);

  const printNow = async (): Promise<void> => {
    if (!current || !rid) { dismiss(); return; }
    setPrinting(true);
    try {
      await printTableBill(rid, current.table);
      toast({ title: "Printing bill…" });
      dismiss();
    } catch (err) {
      toast({
        title: "Couldn't print the updated bill",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={current != null} onOpenChange={(open) => { if (!open) { dismiss(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Print the updated bill?</DialogTitle>
          {/* The server's sentence, verbatim. */}
          <DialogDescription>{current?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss} disabled={printing}>Not now</Button>
          <Button onClick={() => { void printNow(); }} disabled={printing}>
            {printing ? "Printing…" : PRINT_UPDATED_BILL_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
