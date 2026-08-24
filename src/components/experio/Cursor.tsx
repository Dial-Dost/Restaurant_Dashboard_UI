"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { pointer, bindPointer } from "@/lib/experio/pointer";

/**
 * The soft gold cursor, the faint background aura that follows it, and the
 * global magnetic / tilt behaviors for [data-magnetic] and [data-tilt].
 */
export default function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const unbindAlways = bindPointer();
    if (!fine) return unbindAlways;

    document.documentElement.classList.add("exp-cursor");

    const dot = dotRef.current!;
    const halo = haloRef.current!;
    const rootStyle = document.documentElement.style;

    const pos = { dx: innerWidth / 2, dy: innerHeight / 2, hx: innerWidth / 2, hy: innerHeight / 2 };
    let hoverInteractive = false;
    let magneticEl: HTMLElement | null = null;
    let tiltEl: HTMLElement | null = null;
    let raf = 0;

    const loop = () => {
      // The dot is tight, the halo drifts, the aura barely follows.
      const kDot = reduced ? 1 : 0.35;
      const kHalo = reduced ? 1 : 0.12;
      pos.dx += (pointer.x - pos.dx) * kDot;
      pos.dy += (pointer.y - pos.dy) * kDot;
      pos.hx += (pointer.x - pos.hx) * kHalo;
      pos.hy += (pointer.y - pos.hy) * kHalo;

      const dotScale = pointer.down ? 0.7 : hoverInteractive ? 2.6 : 1;
      dot.style.transform = `translate3d(${pos.dx}px, ${pos.dy}px, 0) translate(-50%,-50%) scale(${dotScale})`;
      halo.style.transform = `translate3d(${pos.hx}px, ${pos.hy}px, 0) translate(-50%,-50%)`;
      rootStyle.setProperty("--cx", `${pos.hx}px`);
      rootStyle.setProperty("--cy", `${pos.hy}px`);

      if (magneticEl && !reduced) {
        const r = magneticEl.getBoundingClientRect();
        const mx = (pointer.x - (r.left + r.width / 2)) * 0.22;
        const my = (pointer.y - (r.top + r.height / 2)) * 0.22;
        gsap.set(magneticEl, { x: gsap.utils.clamp(-8, 8, mx), y: gsap.utils.clamp(-6, 6, my) });
      }

      if (tiltEl && !reduced) {
        const r = tiltEl.getBoundingClientRect();
        const px = (pointer.x - r.left) / r.width;
        const py = (pointer.y - r.top) / r.height;
        gsap.to(tiltEl, {
          rotateY: (px - 0.5) * 6,
          rotateX: -(py - 0.5) * 6,
          transformPerspective: 900,
          duration: 0.5,
          ease: "power2.out",
          overwrite: "auto",
        });
        tiltEl.style.setProperty("--mx", `${px * 100}%`);
        tiltEl.style.setProperty("--my", `${py * 100}%`);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const isInteractive = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest("a, button, [role='button'], [data-magnetic]");

    const onOver = (e: PointerEvent) => {
      hoverInteractive = isInteractive(e.target);

      const m = e.target instanceof Element ? (e.target.closest("[data-magnetic]") as HTMLElement | null) : null;
      if (m !== magneticEl) {
        if (magneticEl) gsap.to(magneticEl, { x: 0, y: 0, duration: 0.7, ease: "power3.out" });
        magneticEl = m;
      }

      const t = e.target instanceof Element ? (e.target.closest("[data-tilt]") as HTMLElement | null) : null;
      if (t !== tiltEl) {
        if (tiltEl)
          gsap.to(tiltEl, { rotateX: 0, rotateY: 0, duration: 0.9, ease: "power3.out", overwrite: "auto" });
        tiltEl = t;
      }
    };

    window.addEventListener("pointerover", onOver, { passive: true });
    window.addEventListener("pointermove", onOver, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointermove", onOver);
      document.documentElement.classList.remove("exp-cursor");
      unbindAlways();
    };
  }, []);

  return (
    <>
      {/* Halo — warms the page under the pointer (multiply, never additive). */}
      <div
        ref={haloRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] hidden size-[240px] rounded-full mix-blend-multiply [@media(pointer:fine)]:block"
        style={{
          background:
            "radial-gradient(circle, rgba(232,199,93,0.22), rgba(232,199,93,0.08) 45%, transparent 70%)",
        }}
      />
      {/* Core dot. */}
      <div
        ref={dotRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[61] hidden size-[10px] rounded-full [@media(pointer:fine)]:block"
        style={{
          background: "radial-gradient(circle, #E8C75D 0%, #D4AF37 55%, rgba(212,175,55,0) 75%)",
          boxShadow: "0 0 14px rgba(212,175,55,0.5)",
          transition: "width .2s, height .2s",
        }}
      />
    </>
  );
}
