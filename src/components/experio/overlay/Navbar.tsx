"use client";

import Link from "next/link";
import { MiniMark } from "../dash/DashboardFrame";
import { runtime } from "@/lib/experio/scroll";

export default function Navbar() {
  // Fast-forward the film to its final act, where the real CTA lives.
  const toFinale = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = document.documentElement.scrollHeight - window.innerHeight;
    if (runtime.lenis && !reduced) {
      runtime.lenis.scrollTo(target, { duration: 3, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
    } else {
      window.scrollTo({ top: target, behavior: reduced ? "auto" : "smooth" });
    }
  };

  return (
    <nav className="exp-nav pre-hide pointer-events-none fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between px-[4vw]">
      <div className="flex items-center gap-2.5 text-ink">
        <MiniMark className="h-3.5 w-auto" />
        <span className="flex flex-col leading-none">
          <span className="text-[13px] font-black tracking-[0.06em] text-ink">EXPERIO</span>
          <span className="mt-[3px] text-[6.5px] font-medium italic tracking-[0.42em] text-ink-2">
            SOLUTIONS
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <Link
          href="/login"
          data-magnetic
          className="glass glass-rim pointer-events-auto relative flex h-9 items-center rounded-full px-5 text-[13px] font-semibold text-ink"
        >
          Login
        </Link>
        <button
          data-magnetic
          onClick={toFinale}
          className="gold-sweep glass glass-rim pointer-events-auto relative h-9 rounded-full px-5 text-[13px] font-semibold text-ink"
        >
          Book a Demo
        </button>
      </div>
    </nav>
  );
}
