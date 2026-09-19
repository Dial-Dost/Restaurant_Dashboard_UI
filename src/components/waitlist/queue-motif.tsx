// Ornament for the waitlist hero and closing banner — the web copy of
// Flutter's `_QueueMotif` / `_QueueMotifPainter` (modules.dart): a line of
// people tapering away along an arc, drawn on the accent tokens rather than
// shipped as an asset. Fixed-size and hit-test transparent; callers drop it
// whole at narrow widths (decoration never bids for the copy's width).

import type { JSX } from "react";

// Head + body per figure, fading back along the queue.
const ALPHAS = [0.32, 0.24, 0.16, 0.1] as const;

export function QueueMotif({ width = 132, height = 88 }: { width?: number; height?: number }): JSX.Element {
  const w = width;
  const h = height;

  // The floor arc: ellipse centred mid-rect, start 3.34 rad sweep 2.60 rad
  // (angles clockwise from +x with +y down, exactly the canvas call).
  const rx = w * 0.48;
  const ry = h * 0.525;
  const cx = w * 0.5;
  const cy = h * 0.725;
  const a0 = 3.34;
  const a1 = 3.34 + 2.6;
  const sx = cx + rx * Math.cos(a0);
  const sy = cy + ry * Math.sin(a0);
  const ex = cx + rx * Math.cos(a1);
  const ey = cy + ry * Math.sin(a1);

  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      className="pointer-events-none shrink-0"
    >
      <path
        d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`}
        fill="none"
        stroke="hsl(var(--accent-base))"
        strokeOpacity={0.2}
        strokeWidth={1.2}
      />
      {ALPHAS.map((alpha, i) => {
        const t = i / (ALPHAS.length - 1);
        const fx = w * (0.17 + t * 0.66);
        const fy = h * (0.6 + Math.abs(t - 0.5) * 0.2);
        const r = h * (0.16 - t * 0.028);
        const bodyW = r * 1.5;
        const bodyH = r * 1.7;
        return (
          <g key={i}>
            <circle
              cx={fx.toFixed(2)}
              cy={(fy - r * 1.45).toFixed(2)}
              r={(r * 0.52).toFixed(2)}
              fill="hsl(var(--accent-hi))"
              fillOpacity={alpha}
            />
            <rect
              x={(fx - bodyW / 2).toFixed(2)}
              y={(fy + r * 0.45 - bodyH / 2).toFixed(2)}
              width={bodyW.toFixed(2)}
              height={bodyH.toFixed(2)}
              rx={(r * 0.6).toFixed(2)}
              fill="hsl(var(--accent-base))"
              fillOpacity={alpha * 0.85}
            />
          </g>
        );
      })}
    </svg>
  );
}
