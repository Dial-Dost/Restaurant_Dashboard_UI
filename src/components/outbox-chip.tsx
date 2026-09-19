"use client";

// THE HONESTY AFFORDANCE for writes — the web port of the Flutter app's
// `widgets/outbox_chip.dart`, and the twin of the read cache's "Offline —
// showing saved data" pill.
//
// A queued order is NOT an order the kitchen has seen, so the count of unsent
// actions lives permanently in the top bar — FIRST among the actions, never
// folded into an overflow — and opens a sheet that names every single one.
//
// It renders NOTHING while the queue is empty. That is the constraint the whole
// feature is held to: a restaurant with a good connection can never tell this
// shipped.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { AlertCircle, CloudUpload, RefreshCw, Trash2, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { StatusChip, InfoChip } from "@/components/ui/status-chip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  discardOutboxEntry,
  drainOutbox,
  getOutboxEntries,
  isOutboxDraining,
  outboxPendingCount,
  retryOutboxEntry,
  subscribeOutbox,
  type OutboxDrainResult,
  type OutboxEntry,
} from "@/lib/outbox";

const savedAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) { return ""; }
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) { return "just now"; }
  const mins = Math.round(secs / 60);
  if (mins < 60) { return `${mins}m ago`; }
  const hours = Math.round(mins / 60);
  if (hours < 24) { return `${hours}h ago`; }
  return `${Math.round(hours / 24)}d ago`;
};

const noticeFor = (result: OutboxDrainResult): string => {
  switch (result.outcome) {
    case "drained":
      return result.sent === 0 ? "Nothing was waiting." : `Sent ${result.sent}. Everything is through.`;
    case "offline":
      return "Still no connection. Nothing was lost — it stays saved.";
    case "blocked":
      return "One action was rejected by the server. It is listed below with the reason, and the rest are held behind it.";
    case "retryLater":
      return "The server could not take it just now. It will try again.";
    case "signedOut":
      return "Sign in again to send these.";
    case "idle":
      return "Nothing was waiting.";
  }
};

/** The replay heartbeat — a tick with an empty queue does nothing and touches no network. */
const HEARTBEAT_MS = 8_000;

export function OutboxChip(): JSX.Element | null {
  const entries = useSyncExternalStore(subscribeOutbox, getOutboxEntries, getOutboxEntries);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<OutboxEntry | null>(null);
  const [draining, setDraining] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (outboxPendingCount() === 0) { return; }
      void drainOutbox();
    }, HEARTBEAT_MS);
    return () => { clearInterval(id); };
  }, []);

  const pending = entries.filter((e) => !e.failed).length;
  const failed = entries.length - pending;
  if (pending === 0 && failed === 0) { return null; }

  const blocked = failed > 0;
  const label = blocked ? `${failed} didn't send` : `${pending} waiting to send`;

  const sendNow = async (): Promise<void> => {
    setNotice(null);
    setDraining(true);
    try {
      const result = await drainOutbox();
      setNotice(noticeFor(result));
    } finally {
      setDraining(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setNotice(null); setOpen(true); }}
        title={blocked
          ? "Some actions could not be sent. Open to see what."
          : "Saved on this device — not sent to the server yet."}
        className="mx-1 inline-flex shrink-0 items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StatusChip status={blocked ? "danger" : "warning"} label={label} dense />
        {blocked && pending > 0 && <InfoChip label={`${pending} held`} />}
      </button>

      <DrillSheet
        open={open}
        onOpenChange={setOpen}
        title="Waiting to send"
        description={failed > 0
          ? `${pending} saved on this device, ${failed} couldn't be sent. Nothing here has reached the kitchen or the books.`
          : "Saved on this device. Nothing here has reached the kitchen or the books yet."}
        action={
          <div className="flex w-full items-center justify-between gap-2">
            <Button size="sm" onClick={() => { void sendNow(); }} disabled={draining || isOutboxDraining()}>
              <CloudUpload className="mr-1.5 h-3.5 w-3.5" />
              {draining ? "Sending…" : "Send now"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); }}>Close</Button>
          </div>
        }
      >
        {notice != null && (
          <div className="mb-3 rounded-md border border-border bg-inset p-3 text-xs text-muted-foreground">
            {notice}
          </div>
        )}
        {entries.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Everything has been sent.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={`rounded-md border bg-inset p-3 ${entry.failed ? "border-destructive/40" : "border-border"}`}
              >
                <div className="flex items-start gap-2">
                  {entry.failed
                    ? <AlertCircle className="mt-0.5 h-[15px] w-[15px] shrink-0 text-destructive" />
                    : <Clock3 className="mt-0.5 h-[15px] w-[15px] shrink-0 text-tertiary" />}
                  <p className="min-w-0 flex-1 text-sm leading-snug">{entry.what}</p>
                  <StatusChip status={entry.failed ? "danger" : "warning"} label={entry.failed ? "Failed" : "Waiting"} dense />
                </div>
                <p className="mt-1 text-xs text-tertiary">
                  {entry.method} {entry.path} · saved {savedAgo(entry.queuedAt)}
                </p>
                {entry.failed && (
                  <>
                    {/* The server's own words, verbatim. */}
                    <p className="mt-2 text-xs text-destructive">
                      {entry.failureStatus == null
                        ? (entry.failureMessage ?? "The server rejected this.")
                        : `Server said (${entry.failureStatus}): ${entry.failureMessage ?? "rejected"}`}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => { retryOutboxEntry(entry.id); }}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setDiscarding(entry); }}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Discard
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </DrillSheet>

      {/* Discarding is the one way work leaves this queue unsent — always a
          deliberate human act with the thing named back to them. */}
      <AlertDialog open={discarding != null} onOpenChange={(o) => { if (!o) { setDiscarding(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this action?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{discarding?.what}&rdquo; will be thrown away and never sent. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (discarding) { discardOutboxEntry(discarding.id); }
                setDiscarding(null);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * A per-subject pending marker — "this TABLE has work the kitchen has not
 * seen", not just "the app has work somewhere". Invisible when that subject has
 * nothing waiting, so an online floor plan is byte-identical to today's.
 * Module pages adopt it as they wire their writes into the outbox.
 */
export function OutboxTagBadge({ tag, className }: { tag: string; className?: string }): JSX.Element | null {
  const entries = useSyncExternalStore(subscribeOutbox, getOutboxEntries, getOutboxEntries);
  let pending = 0; let failed = 0;
  for (const e of entries) {
    if (e.tag !== tag) { continue; }
    if (e.failed) { failed += 1; } else { pending += 1; }
  }
  if (pending === 0 && failed === 0) { return null; }
  return (
    <span className={className}>
      {failed > 0
        ? <StatusChip status="danger" label={failed === 1 ? "1 didn't send" : `${failed} didn't send`} dense />
        : <StatusChip status="warning" label={pending === 1 ? "Not sent yet" : `${pending} not sent yet`} dense />}
    </span>
  );
}
