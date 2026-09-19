"use client";

// A DURATION THAT TICKS — requirements D1 and D2, the web `_LiveElapsed`
// (modules.dart 3604–3741).
//
// The number is the SERVER's `service` clock plus a MONOTONIC local delta since
// the response arrived (a till whose clock is ten minutes fast cannot invent a
// ten-minute-old order); the local ISO subtraction survives only for a backend
// that predates the clock. The text is Flutter's `_fmtDur` and the colour the
// kitchen's own 10/15-minute thresholds ("Open 18m 04s" neutral → warning →
// danger while running; a settled ticket never wears red). A row we cannot
// date gets NO chip: "0s" is a claim, "—" would be a lie with a hyphen.

import * as React from "react";
import { Clock3 } from "lucide-react";

import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { monotonicNow, readServiceClock, type ServiceClock } from "@/lib/service-clock";
import { elapsedTone, fmtDur } from "@/lib/api/orders";

export interface LiveElapsedProps {
  /** The server's own measurement — preferred over the ISO pair below. */
  clock: ServiceClock | null;
  /** Fallback only: the span's start (an order's created_at). */
  fromIso?: string | null;
  /** The instant it stopped; empty while still running (D2's settlement). */
  toIso?: string | null;
  /** Read before the duration: "Open", "Took". */
  label: string;
  /** Whether the chip takes the kitchen's warning/danger colours as it ages. */
  escalates?: boolean;
  icon?: React.ReactNode;
}

const isoMs = (iso: string | null | undefined): number | null => {
  const raw = (iso ?? "").trim();
  if (!raw) { return null; }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
};

export function LiveElapsed({ clock, fromIso, toIso, label, escalates = true, icon }: LiveElapsedProps): React.JSX.Element | null {
  const running = clock ? clock.running : (toIso ?? "").trim() === "";
  // The monotonic origin resets whenever the server re-measured (`as_of`
  // advancing) or the chip moved onto another span — never on a mere re-render.
  const originKey = clock ? `${clock.as_of}|${clock.started_at}` : `${fromIso ?? ""}|${toIso ?? ""}`;
  const originRef = React.useRef<{ key: string; at: number }>({ key: originKey, at: monotonicNow() });
  if (originRef.current.key !== originKey) {
    originRef.current = { key: originKey, at: monotonicNow() };
  }
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!running) { return; }
    const id = window.setInterval(() => { forceTick(); }, 1000);
    return () => { window.clearInterval(id); };
  }, [running, originKey]);

  let ms: number | null = null;
  if (clock) {
    ms = Math.max(0, clock.elapsed_ms) + (clock.running ? Math.max(0, monotonicNow() - originRef.current.at) : 0);
  } else {
    const from = isoMs(fromIso);
    if (from !== null) {
      const to = isoMs(toIso);
      ms = Math.max(0, (to ?? Date.now()) - from);
    }
  }
  if (ms === null) { return null; }

  const text = `${label} ${fmtDur(ms)}`;
  const tone = escalates && running ? elapsedTone(ms) : "neutral";
  if (tone === "neutral") {
    return <InfoChip icon={icon ?? <Clock3 />} label={text} />;
  }
  return <StatusChip label={text} status={tone === "danger" ? "danger" : "warning"} dense />;
}

/** Convenience: an order row's clock, or null for a cancelled/undatable row. */
export const orderServiceClock = (order: { service?: unknown }, cancelled: boolean): ServiceClock | null =>
  cancelled ? null : readServiceClock(order);
