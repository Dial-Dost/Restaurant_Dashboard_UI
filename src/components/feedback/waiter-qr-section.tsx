"use client";

// Per-waiter feedback QR — the web copy of Flutter's
// `_employeeFeedbackQrSection` (modules.dart ~18341): ONE ForkCard holding a
// collapsed-by-default expansion tile; expanded, one inset row per waiter
// with a 96px QR on a white quiet zone, the tagged link, "Copy link" and
// "Their feedback".
//
// The section renders whenever /restaurant/users answered with rows (the
// server enforces the permission; a failed fetch simply leaves it absent),
// and renders NOTHING at all when the employee list is empty. The card body
// stays untappable on purpose: it holds a selectable URL, and a gesture over
// the whole card would fight selecting it.

import * as React from "react";
import QRCode from "qrcode";
import { ChevronDown, ChevronUp, Copy, MessageSquareText, QrCode as QrCodeIcon } from "lucide-react";

// The qrcode package ships no types (src/types/qrcode.d.ts declares it as
// any); pin the one call this section makes.
const qrToDataUrl = (QRCode as {
  toDataURL: (text: string, opts?: { width?: number; margin?: number }) => Promise<string>;
}).toDataURL;

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { useToast } from "@/hooks/use-toast";
import { WaiterFeedbackSheet } from "@/components/feedback/feedback-sheets";
import { sOf } from "@/components/feedback/feedback-format";
import type { FeedbackEmployee, FeedbackEntry } from "@/lib/api/feedback";

/** Employees.id first, employee_id as the fallback — the eid the QR carries. */
const eidOf = (e: FeedbackEmployee): string => sOf(e.id, "") || sOf(e.employee_id, "");

/** "emp_Fname emp_Lname", falling back to the username when both are blank. */
const labelOf = (e: FeedbackEmployee): string => {
  const name = `${sOf(e.emp_Fname, "")} ${sOf(e.emp_Lname, "")}`.trim();
  return name === "" ? sOf(e.employee_Username) : name;
};

/**
 * Feedback form base URL — same-origin /feedback by default,
 * NEXT_PUBLIC_FEEDBACK_FORM_URL overrides, and a localhost placeholder is
 * auto-rewritten to the current host on deployed/forwarded hosts (the web's
 * AppConfig.orderBaseUrl).
 */
const useFeedbackBase = (): string =>
  React.useMemo(() => {
    const fallbackBase = typeof window !== "undefined" ? `${window.location.origin}/feedback` : "";
    const configuredBase = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "").trim();
    let baseUrl = configuredBase || fallbackBase;
    if (typeof window !== "undefined" && baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        const configuredHost = parsed.hostname.toLowerCase();
        const currentHost = window.location.hostname.toLowerCase();
        const isConfiguredLocal = configuredHost === "localhost" || configuredHost === "127.0.0.1";
        const isCurrentLocal = currentHost === "localhost" || currentHost === "127.0.0.1";
        if (isConfiguredLocal && !isCurrentLocal) {
          parsed.protocol = window.location.protocol;
          parsed.hostname = window.location.hostname;
          baseUrl = parsed.toString();
        }
      } catch {
        /* invalid env URL — keep the fallback */
      }
    }
    return baseUrl.replace(/\/$/, "");
  }, []);

export function WaiterQrSection({
  employees,
  items,
  timezone,
  restaurantUsername,
  outletId,
}: {
  employees: FeedbackEmployee[];
  /** The loaded response list — answers "is this QR actually being scanned?". */
  items: FeedbackEntry[];
  timezone: string;
  restaurantUsername: string;
  outletId: string;
}): React.JSX.Element | null {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [qrMap, setQrMap] = React.useState<Record<string, string>>({});
  const [waiterSheet, setWaiterSheet] = React.useState<{ name: string; eid: string } | null>(null);

  const rows = React.useMemo(() => employees.filter((e) => eidOf(e) !== ""), [employees]);

  const feedbackBase = useFeedbackBase();
  const urlFor = React.useCallback(
    (eid: string): string => {
      if (!feedbackBase || !restaurantUsername || !eid) { return ""; }
      const params = new URLSearchParams({ rid: restaurantUsername, oid: outletId, eid });
      return `${feedbackBase}?${params.toString()}`;
    },
    [feedbackBase, restaurantUsername, outletId],
  );

  // Draw the QRs once the tile is opened — the collapsed card costs nothing.
  React.useEffect(() => {
    if (!open || rows.length === 0) { return; }
    let cancelled = false;
    void Promise.all(
      rows.map(async (e) => {
        const eid = eidOf(e);
        const url = urlFor(eid);
        if (!eid || !url) { return null; }
        try {
          return [eid, await qrToDataUrl(url, { width: 192, margin: 1 })] as const;
        } catch {
          return null; // skip this waiter's QR on failure
        }
      }),
    ).then((pairs) => {
      if (cancelled) { return; }
      const map: Record<string, string> = {};
      for (const pair of pairs) {
        if (pair != null) { map[pair[0]] = pair[1]; }
      }
      setQrMap(map);
    });
    return () => { cancelled = true; };
  }, [open, rows, urlFor]);

  if (rows.length === 0) { return null; }

  return (
    <ForkCard className="p-0">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-inset text-accent-foreground gaia:rounded-[2px]"
        >
          <QrCodeIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Per-waiter feedback QR</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            A QR/link per waiter — feedback scanned here is tagged to them
          </span>
        </span>
        {open ? (
          <ChevronUp aria-hidden className="h-4 w-4 shrink-0 text-accent-foreground" />
        ) : (
          <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-tertiary" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {rows.map((e) => {
            const eid = eidOf(e);
            const label = labelOf(e);
            const url = urlFor(eid);
            const qr = qrMap[eid];
            return (
              <ForkCard key={eid} inset className="mb-2 p-3">
                <div className="flex items-start gap-3">
                  {/* Paper exception: the QR keeps a white quiet zone so it
                      stays scannable — printed-output styling, black on white. */}
                  <span className="shrink-0 rounded-[6px] bg-white p-1.5">
                    {qr ? (
                      <img src={qr} alt={`Feedback QR for ${label}`} className="h-24 w-24" />
                    ) : (
                      <span className="flex h-24 w-24 items-center justify-center text-[10px] text-neutral-500">
                        {url ? "Generating…" : "Unavailable"}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">@{sOf(e.employee_Username)}</p>
                    <p className="mt-1.5 select-all break-all text-[11px] text-muted-foreground">{url}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!url}
                        onClick={() => {
                          void (async () => {
                            try {
                              await navigator.clipboard.writeText(url);
                              toast({ title: "Feedback link copied" });
                            } catch {
                              toast({ title: "Could not copy the feedback link.", variant: "destructive" });
                            }
                          })();
                        }}
                      >
                        <Copy /> Copy link
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setWaiterSheet({ name: label, eid }); }}
                      >
                        <MessageSquareText /> Their feedback
                      </Button>
                    </div>
                  </div>
                </div>
              </ForkCard>
            );
          })}
        </div>
      )}

      {waiterSheet != null && (
        <WaiterFeedbackSheet
          name={waiterSheet.name}
          eid={waiterSheet.eid}
          items={items}
          timezone={timezone}
          onClose={() => { setWaiterSheet(null); }}
        />
      )}
    </ForkCard>
  );
}
