"use client";

import { ChevronDown, Search } from "lucide-react";
import { VIEWS } from "./viewData";

/** Grid placement for the five persistent cells (A..E). */
/* From `sm` up this is the original 2-row layout (A B / C D E). On a phone the
 * frame is ~345px wide, so a 3- or 4-column stat cell came out 67–94px and its
 * headline number ("₹86,412") was cut off mid-digit. Below `sm` the same five
 * cells are re-flowed into three rows — the two stats side by side, the hero
 * chart full width, then the two detail cells — using `order`, so the DOM (and
 * the assembly animation that staggers over it) is unchanged. */
const CELL_POS = [
  "order-1 col-span-6 row-span-1 sm:order-none sm:col-span-4", // A — primary stat
  "order-3 col-span-12 row-span-1 sm:order-none sm:col-span-8", // B — hero chart
  "order-2 col-span-6 row-span-1 sm:order-none sm:col-span-3", // C — secondary stat
  "order-4 col-span-5 row-span-1 sm:order-none sm:col-span-4", // D — mid widget
  "order-5 col-span-7 row-span-1 sm:order-none sm:col-span-5", // E — list / detail
];

/**
 * The dashboard that Act 2 constructs and Act 3 morphs. One frame, six lives:
 * the chrome never changes, only the stacked `.exp-cell-layer`s inside each
 * glass cell crossfade as the selector dial clicks through views.
 */
export default function DashboardFrame() {
  return (
    <div className="exp-dash-wrap pre-hide absolute left-[4vw] right-[4vw] top-1/2 -translate-y-1/2 lg:left-[29vw] lg:right-[5.5vw]">
      {/* Ghost folio numeral in the left whitespace, rolling as the dial clicks. */}
      <div
        aria-hidden
        className="exp-ghost-wrap pointer-events-none absolute -left-[300px] top-1/2 hidden h-[280px] -translate-y-1/2 overflow-hidden select-none lg:block"
      >
        <div className="exp-ghost-roll flex flex-col">
          {VIEWS.map((v, i) => (
            <span
              key={v.name}
              className="h-[280px] text-[250px] font-bold leading-[280px] tracking-tighter tabular-nums"
              style={{ color: "rgba(17,17,17,0.08)" }}
            >
              0{i + 1}
            </span>
          ))}
        </div>
      </div>

      {/* Perimeter line the particles appear to draw in Act 2. */}
      <svg
        aria-hidden
        className="exp-dash-outline pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        preserveAspectRatio="none"
        viewBox="0 0 1000 620"
      >
        <rect
          className="exp-dash-outline-path"
          x="1"
          y="1"
          width="998"
          height="618"
          rx="42"
          fill="none"
          stroke="rgba(17,17,17,0.5)"
          strokeWidth="1.5"
          pathLength={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* The frame inside the film is the PRODUCT: CuisineFlow's dark-copper
          Rustic Fork skin (palette in experio.css), not the light Experio
          canvas around it. */}
      <div className="exp-dash glass pointer-events-auto flex h-[min(74vh,640px)] overflow-hidden rounded-[26px] will-change-transform">
        {/* Left rail */}
        <aside className="relative hidden w-44 shrink-0 flex-col border-r border-white/[0.07] py-5 md:flex">
          <div className="mb-6 flex items-center gap-2 px-5 text-ink">
            <MiniMark className="h-3 w-auto" />
            <span className="text-[11px] font-black tracking-[0.08em] text-ink">CUISINEFLOW</span>
          </div>
          <div className="relative">
            {/* Sliding copper indicator */}
            <span className="exp-side-ind absolute left-0 top-2 h-6 w-[2px] rounded-full bg-[#E3B89B]" />
            {VIEWS.map((v, i) => (
              <div
                key={v.name}
                data-si={i}
                className={`exp-side-item flex h-10 items-center gap-2.5 px-5 text-[12.5px] font-medium ${
                  i === 0 ? "text-ink" : "text-ink-3"
                }`}
              >
                <span className="opacity-80">{v.icon}</span>
                {v.name}
              </div>
            ))}
          </div>
          <div className="mt-auto px-5 text-[10px] leading-relaxed text-ink-3">
            v1.7.0 · all systems
            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-[#8FB27C] align-middle" />
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.07] px-5">
            <div className="relative h-5 w-32 overflow-hidden">
              {VIEWS.map((v, i) => (
                <span
                  key={v.name}
                  data-vt={i}
                  className="exp-vt absolute inset-0 text-[14px] font-semibold leading-5 text-ink"
                  style={i === 0 ? {} : { opacity: 0, visibility: "hidden" }}
                >
                  {v.name}
                </span>
              ))}
            </div>
            <div className="ml-auto hidden items-center gap-2 lg:flex">
              <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-ink-2">
                All outlets · 3
                <ChevronDown size={12} />
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-ink-2">
                Fri, Jul 18
              </span>
              <span className="flex h-[26px] w-40 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] text-ink-3">
                <Search size={11} />
                Search
              </span>
            </div>
            <span
              className="exp-sync-dot size-1.5 rounded-full bg-[#E3B89B]"
              title="Live sync"
            />
            <span className="size-6 rounded-full bg-gradient-to-br from-[#E3B89B] to-[#7D5B47]" />
          </header>

          {/* Cells */}
          <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-3 gap-2.5 p-3 sm:grid-rows-2 sm:gap-3.5 sm:p-4">
            {CELL_POS.map((pos, cellIdx) => (
              <div
                key={cellIdx}
                data-tilt
                className={`exp-widget glass-shine relative min-h-0 rounded-2xl border border-white/[0.07] bg-gradient-to-b from-[#201B1A] to-[#181412] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_-18px_rgba(0,0,0,0.6)] will-change-transform ${pos}`}
              >
                {VIEWS.map((v, vi) => (
                  <div
                    key={v.name}
                    data-vi={vi}
                    className="exp-cell-layer absolute inset-0 flex flex-col gap-2.5 p-3.5"
                    style={vi === 0 ? {} : { opacity: 0, visibility: "hidden" }}
                  >
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                      {v.cells[cellIdx].title}
                    </span>
                    <div className="min-h-0 flex-1">{v.cells[cellIdx].content}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Honest data provenance, per the neutrality rule. */}
          <div className="flex h-7 shrink-0 items-center justify-end px-5">
            <span className="exp-example-tag text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3 opacity-0">
              Example: full-service restaurant
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Experio Solutions mark: checkerboard fragment — one slanted tile
 * top-center over two flanking tiles below. Uses currentColor. */
export function MiniMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 130 37" className={className} aria-hidden fill="currentColor">
      <path d="M50 0 h38 l-8 17 h-38 Z" />
      <path d="M8 20 h38 l-8 17 h-38 Z" />
      <path d="M92 20 h38 l-8 17 h-38 Z" />
    </svg>
  );
}
