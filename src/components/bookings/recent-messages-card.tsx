"use client";

import * as React from "react";

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
import { StatusChip, type StatusChipStatus } from "@/components/ui/status-chip";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { requestBackend } from "@/lib/db";
import { formatDateTime, formatFullDateTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";

// Delivery visibility for automated guest messaging (confirmations, reminders,
// WhatsApp replies) — WEB-EXTRA: the Flutter Bookings screen has no
// counterpart, kept per the parity audit (finding 30). Admin-only endpoint —
// the card hides itself when the backend refuses (non-admin) or there is
// nothing to show yet, which is why its load errors deliberately render
// nothing instead of an error pane.

interface OutboundMessage {
  id: string;
  channel: string;
  to_phone: string | null;
  body: string | null;
  kind: string | null;
  ref_id: string | null;
  status: string;
  error: string | null;
  provider: string | null;
  created_at: string;
}

const fetchMessages = async (restaurantId: string): Promise<OutboundMessage[]> => {
  const response = await requestBackend<OutboundMessage[]>({
    path: "/messages",
    method: "GET",
    restaurantId,
  });
  if (!response.ok) {
    throw Object.assign(new Error(response.text || "Couldn't load messages."), {
      status: response.status,
    });
  }
  return Array.isArray(response.data) ? response.data : [];
};

const STATUS_CHIP: Partial<Record<string, { status: StatusChipStatus; label: string }>> = {
  sent: { status: "success", label: "Sent" },
  failed: { status: "danger", label: "Failed" },
  skipped_no_provider: { status: "neutral", label: "No provider" },
};

const KIND_LABELS: Partial<Record<string, string>> = {
  booking_confirm: "Confirmation",
  booking_reminder: "Reminder",
  wa_reply: "WhatsApp reply",
};

export function RecentMessagesCard({ restaurantId }: { restaurantId: string }): React.JSX.Element | null {
  const { timezone } = useTimezone();
  const { data, error } = useCachedFetch<OutboundMessage[]>(
    `bookings:messages:${restaurantId}`,
    React.useCallback(() => fetchMessages(restaurantId), [restaurantId]),
    { enabled: restaurantId.length > 0 },
  );

  // Self-hiding by design: a refusal (non-admin) or an empty list draws no
  // card at all — same as before the redesign.
  if (error || !data || data.length === 0) { return null; }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent messages</CardTitle>
        <CardDescription>
          Automated guest messages (booking confirmations, reminders and WhatsApp
          replies) and whether they were delivered to the provider. Configure the
          SMS/WhatsApp provider in the owner app settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Message</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((m) => {
              const chip = STATUS_CHIP[m.status];
              return (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-sm" title={formatFullDateTime(m.created_at, timezone)}>
                    {formatDateTime(m.created_at, timezone)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{m.to_phone || "-"}</div>
                    <div className="text-xs text-muted-foreground">{m.channel}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {KIND_LABELS[m.kind ?? ""] ?? m.kind ?? "-"}
                  </TableCell>
                  <TableCell className="hidden max-w-[320px] truncate text-sm text-muted-foreground lg:table-cell" title={m.body ?? ""}>
                    {m.body || "-"}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      dense
                      status={chip?.status ?? "neutral"}
                      label={chip?.label ?? m.status}
                    />
                    {m.error ? (
                      <div className="mt-1 max-w-[220px] truncate text-xs text-destructive" title={m.error}>
                        {m.error}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
