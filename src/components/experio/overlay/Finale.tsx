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
    <div className="exp-finale pre-hide absolute inset-0 z-10">
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

      <div className="absolute left-1/2 top-[57%] z-10 flex -translate-x-1/2 flex-col items-center">
        <div className="flex text-[clamp(34px,4.6vw,56px)] font-black tracking-[0.02em] text-ink">
          {"EXPERIO".split("").map((ch, i) => (
            <span key={i} className="exp-wm-letter inline-block">
              {ch}
            </span>
          ))}
        </div>
        <div className="exp-solutions mt-2 -mr-[0.45em] text-[clamp(11px,1.3vw,17px)] font-medium italic tracking-[0.45em] text-ink">
          SOLUTIONS
        </div>
        <p className="exp-final-sub mt-4 text-[18px] font-medium text-ink-2">
          Operational excellence, in one place.
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
            href="mailto:hello@experio.solutions?subject=Demo%20request%20—%20Experio%20Platform"
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
      </div>

      <p className="exp-footnote absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-[12px] text-ink-3">
        Wherever work happens. · © 2026 Experio Solutions
      </p>
    </div>
  );
}
