"use client";

import Link from "next/link";
import { runtime } from "@/lib/experio/scroll";

/** Act 5: the instrument becomes the mark; the name is etched; the ask is made. */
export default function Finale() {
  const replay = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (runtime.lenis && !reduced) {
      runtime.lenis.scrollTo(0, { duration: 2.6, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
    } else {
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
  };

  return (
    <div className="exp-finale pre-hide absolute inset-0 z-10 flex flex-col items-center">
      {/* The logomark — four checker tiles, pixel-glued to the 3D object via CSS vars. */}
      <svg
        className="exp-logomark absolute opacity-0"
        style={{
          left: "var(--obj-x, 50%)",
          top: "var(--obj-y, 44%)",
          width: "calc(var(--obj-r, 70px) * 1.45)",
          height: "calc(var(--obj-r, 70px) * 0.42)",
          transform: "translate(-50%, -50%)",
        }}
        viewBox="0 0 130 37"
        fill="#111111"
        aria-hidden
      >
        <path className="exp-mark-tile" d="M50 0 h38 l-8 17 h-38 Z" />
        <path className="exp-mark-tile" d="M8 20 h38 l-8 17 h-38 Z" />
        <path className="exp-mark-tile" d="M92 20 h38 l-8 17 h-38 Z" />
      </svg>

      {/* IN FLOW, not absolutely anchored. This column used to hang from
          top-[57%] while the footnote below was pinned to bottom-6 — two fixed
          anchors that collided on short viewports: the replay/login row grew
          straight down into the copyright line. The spacers reproduce the 57/43
          optical balance on tall screens, and on short ones the layout
          compresses instead of overlapping — the footnote is after this column
          in normal flow, so the two can never occupy the same pixels. */}
      {/* The floor is derived from the SAME variable the logomark is glued to,
          not a hardcoded percentage: the mark parks at --obj-y (≈44% of the
          viewport, but the 3D scene owns the value), so the wordmark column
          must start below it WHEREVER it lands. Without this floor the flex
          spacer alone let the column start around 31% on common window heights
          and SOLUTIONS rendered straight through the checker tiles. +9% clears
          the mark and the gold dust ring with roughly the composition gap the
          old top-[57%] layout had, while the flex share still pushes content
          lower on tall screens. On very short windows the footnote clips below
          the fold — text over text never happens. */}
      <div
        aria-hidden
        className="flex-[57_57_0%]"
        style={{ minHeight: "calc(var(--obj-y, 44%) + 9%)" }}
      />
      <div className="z-10 flex flex-col items-center">
        <div className="flex text-[clamp(34px,4.6vw,56px)] font-black tracking-[0.02em] text-ink">
          {"EXPERIO".split("").map((ch, i) => (
            <span key={i} className="exp-wm-letter inline-block">
              {ch}
            </span>
          ))}
        </div>
        <div data-wordmark className="exp-solutions mt-2 -mr-[0.45em] text-[clamp(11px,1.3vw,17px)] font-medium italic tracking-[0.45em] text-ink">
          SOLUTIONS
        </div>
        <p className="exp-final-sub mt-4 text-[18px] font-medium text-ink-2 max-sm:px-6 max-sm:text-center">
          CuisineFlow — the whole restaurant, one login.
        </p>

        <div className="relative mt-8">
          <svg
            className="pointer-events-none absolute -inset-px"
            width="100%"
            height="100%"
            viewBox="0 0 240 56"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden
          >
            <rect
              className="exp-cta-outline"
              x="1"
              y="1"
              width="238"
              height="54"
              rx="27"
              stroke="#D4AF37"
              strokeWidth="1.5"
              pathLength={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <a
            data-magnetic
            href="mailto:hello@experio.solutions?subject=Demo%20request%20—%20CuisineFlow"
            className="exp-cta gold-sweep pointer-events-auto flex h-14 items-center rounded-full bg-white/70 px-10 text-[16px] font-semibold text-ink backdrop-blur-md"
          >
            Book a Demo
          </a>
        </div>

        <div className="exp-replay pointer-events-auto mt-6 flex items-center gap-4 text-[13px] font-medium text-ink-2">
          <button onClick={replay} className="underline-offset-4 hover:underline">
            Replay the film
          </button>
          <span aria-hidden className="h-3 w-px bg-black/15" />
          <Link href="/login" className="underline-offset-4 hover:underline">
            Log in
          </Link>
        </div>

        {/* The film showed six modules; the product ships more. A compact,
            truthful capability roll — every chip is a live module or shipped
            feature, nothing aspirational. IN FLOW below the replay row, so the
            finale's no-overlap layout contract holds on short viewports. */}
        <div className="exp-cap-grid mt-8 flex max-w-[620px] flex-wrap justify-center gap-1.5 px-6">
          {[
            "Guest QR ordering",
            "Reservations",
            "Customers & coupons",
            "Purchase orders",
            "Attendance",
            "Roles & permissions",
            "Valet",
            "Multi-outlet",
            "Thermal KOT printing",
            "What-if simulation",
            "Audit log",
            "Auto-updates",
          ].map((cap) => (
            <span
              key={cap}
              className="rounded-full border border-black/[0.08] bg-white/60 px-2.5 py-1 text-[11px] font-medium text-ink-2"
            >
              {cap}
            </span>
          ))}
        </div>
      </div>

      <div aria-hidden className="min-h-5 flex-[43_43_0%]" />
      <p className="exp-footnote z-10 mb-6 text-[12px] text-ink-3">
        Made for Indian restaurants. · © 2026 Experio Solutions
      </p>
    </div>
  );
}
