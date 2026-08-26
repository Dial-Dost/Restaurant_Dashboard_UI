"use client";

/** Act 1: the instrument, the headline, and enormous whitespace. */
export default function Hero() {
  return (
    <>
      <div className="absolute left-[8vw] top-[58%] z-10 -translate-y-1/2 lg:top-1/2">
        <div className="exp-hero-kicker mb-6 flex items-center gap-2.5 text-[12px] font-medium uppercase tracking-[0.18em] text-ink-2 opacity-0">
          <span className="h-px w-6 bg-gold" />
          CuisineFlow · by Experio Solutions
        </div>
        <h1 className="exp-hero-h1 max-w-[12ch] text-[clamp(46px,6.2vw,84px)] font-bold leading-[1.04] tracking-[-0.02em] text-ink">
          <span className="block overflow-hidden pb-1">
            <span className="exp-hero-line block">Every table.</span>
          </span>
          <span className="block overflow-hidden pb-1">
            <span className="exp-hero-line block">One system.</span>
          </span>
        </h1>
        <p className="exp-hero-sub mt-7 max-w-[34ch] text-[20px] font-medium leading-relaxed text-ink-2 opacity-0">
          POS, kitchen, floor and books — built for Indian restaurants.
        </p>
      </div>

      <div className="exp-scroll-cue absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2.5 opacity-0">
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ink-3">
          Scroll
        </span>
        <span className="relative block h-10 w-px overflow-hidden bg-black/10">
          <span className="exp-cue-drop absolute left-0 top-0 h-3.5 w-px bg-gold" />
        </span>
      </div>

      {/* Act 2 caption, near the working instrument. */}
      <p className="exp-build-caption pre-hide absolute bottom-[10vh] left-[7vw] z-10 text-[22px] font-medium tracking-tight text-ink">
        Your restaurant, assembled.
      </p>
    </>
  );
}
