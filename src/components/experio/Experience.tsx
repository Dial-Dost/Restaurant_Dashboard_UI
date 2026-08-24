"use client";

import "./experio.css";
import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { runtime, scrollState } from "@/lib/experio/scroll";
import { MODULES, dashRect, objectState } from "@/lib/experio/stage";
import Cursor from "./Cursor";
import DashboardFrame from "./dash/DashboardFrame";
import Hero from "./overlay/Hero";
import ViewIndex from "./overlay/ViewIndex";
import Network from "./overlay/Network";
import Finale from "./overlay/Finale";
import Navbar from "./overlay/Navbar";
import Rail from "./overlay/Rail";

const Scene = dynamic(() => import("./three/Scene"), { ssr: false });

const DONUT_C = 2 * Math.PI * 38;

/* ------------------------- one-shot chart animations ------------------------- */

function formatCount(el: HTMLElement, v: number) {
  const dec = parseInt(el.dataset.countDecimals || "0", 10);
  const prefix = el.dataset.countPrefix || "";
  const suffix = el.dataset.countSuffix || "";
  if (el.dataset.countFormat === "minsec") {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    el.textContent = `${m}m ${String(s).padStart(2, "0")}s`;
  } else {
    el.textContent =
      prefix +
      v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) +
      suffix;
  }
}

function popCounts(scope: string) {
  document.querySelectorAll<HTMLElement>(`${scope} .exp-count`).forEach((el) => {
    const to = parseFloat(el.dataset.countTo || "0");
    if (scrollState.reducedMotion) {
      formatCount(el, to);
      return;
    }
    const proxy = { v: 0 };
    gsap.to(proxy, {
      v: to,
      duration: 1.1,
      ease: "power2.out",
      onUpdate: () => formatCount(el, proxy.v),
    });
  });
}

function resetCounts(scope: string) {
  document
    .querySelectorAll<HTMLElement>(`${scope} .exp-count`)
    .forEach((el) => formatCount(el, 0));
}

/** querySelectorAll → array, so empty selections skip cleanly. */
const q$ = (scope: string, sel: string) =>
  Array.from(document.querySelectorAll(`${scope} ${sel}`));

function popCharts(scope: string) {
  popCounts(scope);
  if (scrollState.reducedMotion) {
    // Final states immediately — no autonomous draw animations.
    const set = (sel: string, vars: gsap.TweenVars) => {
      const els = q$(scope, sel);
      if (els.length) gsap.set(els, vars);
    };
    set(".exp-chart-line", { strokeDashoffset: 0 });
    set(".exp-chart-area", { opacity: 1 });
    set(".exp-chart-bar", { scaleY: 1 });
    set(".exp-row-bar", { scaleX: 1 });
    q$(scope, ".exp-donut").forEach((el) =>
      gsap.set(el, {
        strokeDashoffset: parseFloat((el as SVGElement & HTMLElement).dataset.donutTo || "0"),
      })
    );
    return;
  }
  const lines = q$(scope, ".exp-chart-line");
  if (lines.length)
    gsap.fromTo(
      lines,
      { strokeDasharray: 1, strokeDashoffset: 1 },
      { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }
    );
  const areas = q$(scope, ".exp-chart-area");
  if (areas.length) gsap.fromTo(areas, { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 0.35 });
  const bars = q$(scope, ".exp-chart-bar");
  if (bars.length)
    gsap.fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: 0.7, stagger: 0.05, ease: "power2.out" });
  const rows = q$(scope, ".exp-row-bar");
  if (rows.length)
    gsap.fromTo(
      rows,
      { scaleX: 0 },
      { scaleX: 1, duration: 0.7, stagger: 0.06, ease: "power2.out", transformOrigin: "0% 50%" }
    );
  q$(scope, ".exp-donut").forEach((el) =>
    gsap.fromTo(
      el,
      { strokeDashoffset: DONUT_C },
      {
        strokeDashoffset: parseFloat((el as SVGElement & HTMLElement).dataset.donutTo || "0"),
        duration: 0.9,
        ease: "power2.inOut",
      }
    )
  );
}

function resetCharts(scope: string) {
  resetCounts(scope);
  const set = (sel: string, vars: gsap.TweenVars) => {
    const els = q$(scope, sel);
    if (els.length) gsap.set(els, vars);
  };
  set(".exp-chart-line", { strokeDasharray: 1, strokeDashoffset: 1 });
  set(".exp-chart-area", { opacity: 0 });
  set(".exp-chart-bar", { scaleY: 0 });
  set(".exp-row-bar", { scaleX: 0, transformOrigin: "0% 50%" });
  q$(scope, ".exp-donut").forEach((el) => gsap.set(el, { strokeDashoffset: DONUT_C }));
}

/* --------------------------------- component -------------------------------- */

export default function Experience() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollState.reducedMotion = reduced;
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    let lenis: Lenis | null = null;
    let lenisTick: ((t: number) => void) | null = null;
    if (!reduced) {
      lenis = new Lenis({ lerp: 0.09 });
      runtime.lenis = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      lenisTick = (t: number) => lenis!.raf(t * 1000);
      gsap.ticker.add(lenisTick);
      gsap.ticker.lagSmoothing(0);
    }

    /* Measure the dashboard so particles and modules agree with the DOM. */
    const measure = () => {
      const el = document.querySelector(".exp-dash");
      if (!el) return;
      const r = el.getBoundingClientRect();
      dashRect.x0 = (r.left / window.innerWidth) * 2 - 1;
      dashRect.x1 = (r.right / window.innerWidth) * 2 - 1;
      dashRect.y1 = -((r.top / window.innerHeight) * 2 - 1);
      dashRect.y0 = -((r.bottom / window.innerHeight) * 2 - 1);
    };
    measure();
    ScrollTrigger.addEventListener("refresh", measure);

    const modulePx = (i: number) => ({
      x: ((MODULES[i].nx + 1) / 2) * window.innerWidth,
      y: ((1 - MODULES[i].ny) / 2) * window.innerHeight,
    });
    const dashCenterPx = () => ({
      x: (((dashRect.x0 + dashRect.x1) / 2 + 1) / 2) * window.innerWidth,
      y: ((1 - (dashRect.y0 + dashRect.y1) / 2) / 2) * window.innerHeight,
    });
    const screenCenterPx = () => ({
      x: 0.5 * window.innerWidth,
      y: 0.48 * window.innerHeight,
    });

    let intro: gsap.core.Timeline | null = null;

    const ctx = gsap.context(() => {
      /* ------------------------------ master timeline ------------------------------ */
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: rootRef.current,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate(self) {
            scrollState.progress = self.progress;
            scrollState.velocity = self.getVelocity() / 1000;
            if (self.progress > 0.02 && intro?.isActive()) intro.progress(1);
          },
        },
      });
      tl.to({}, { duration: 100 }, 0); // spine: 1 unit = 1% of the journey

      /* ---- ACT 1 · the still point (0–12) ---- */
      tl.to(".exp-scroll-cue", { autoAlpha: 0, duration: 2 }, 1);
      tl.to(".exp-hero-line", { yPercent: -115, duration: 4, stagger: 0.6, ease: "power2.in" }, 7);
      tl.to(".exp-hero-kicker", { autoAlpha: 0, y: -18, duration: 3 }, 7.5);
      tl.to(".exp-hero-sub", { autoAlpha: 0, y: -22, duration: 3 }, 8);

      /* ---- ACT 2 · clarity, constructed (12–34) ---- */
      tl.fromTo(".exp-build-caption", { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 2, ease: "power2.out" }, 15);
      tl.to(".exp-build-caption", { autoAlpha: 0, y: -16, duration: 2 }, 31);
      tl.to(".exp-obj-shadow", { opacity: 0.45, duration: 6 }, 12);

      tl.set(".exp-dash-wrap", { autoAlpha: 1 }, 13);
      tl.fromTo(
        ".exp-dash-outline-path",
        { strokeDasharray: 1, strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 4.5, ease: "power1.inOut" },
        13.5
      );
      tl.fromTo(
        ".exp-dash",
        { autoAlpha: 0, clipPath: "inset(0% 0% 100% 0% round 26px)" },
        { autoAlpha: 1, clipPath: "inset(0% 0% 0% 0% round 26px)", duration: 4, ease: "power1.inOut" },
        16
      );
      tl.to(".exp-dash-outline-path", { opacity: 0, duration: 2 }, 20);
      tl.fromTo(
        ".exp-widget",
        { autoAlpha: 0, scaleY: 0.001 },
        { autoAlpha: 1, scaleY: 1, duration: 2.4, stagger: 1.2, ease: "power2.out", transformOrigin: "50% 0%" },
        18.5
      );

      /* Act 2 draws Manager's charts under scrub — only what actually exists. */
      const v0 = '.exp-cell-layer[data-vi="0"]';
      const v0Lines = q$(v0, ".exp-chart-line");
      if (v0Lines.length)
        tl.fromTo(
          v0Lines,
          { strokeDasharray: 1, strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: 5, ease: "power1.inOut" },
          24
        );
      const v0Areas = q$(v0, ".exp-chart-area");
      if (v0Areas.length) tl.fromTo(v0Areas, { opacity: 0 }, { opacity: 1, duration: 3 }, 27);
      const v0Bars = q$(v0, ".exp-chart-bar");
      if (v0Bars.length)
        tl.fromTo(v0Bars, { scaleY: 0 }, { scaleY: 1, duration: 3, stagger: 0.2, ease: "power2.out" }, 25);
      const v0Rows = q$(v0, ".exp-row-bar");
      if (v0Rows.length)
        tl.fromTo(
          v0Rows,
          { scaleX: 0, transformOrigin: "0% 50%" },
          { scaleX: 1, duration: 2.5, stagger: 0.25, ease: "power2.out" },
          26
        );
      const v0Donuts = q$(v0, ".exp-donut");
      if (v0Donuts.length)
        tl.to(
          v0Donuts,
          {
            strokeDashoffset: (i, el) => parseFloat((el as HTMLElement).dataset.donutTo || "0"),
            duration: 3.5,
            ease: "power1.inOut",
          },
          26
        );

      /* ---- ACT 3 · one frame, every view (34–58) ---- */
      tl.fromTo(".exp-view-index", { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 2, ease: "power2.out" }, 34);
      tl.to(".exp-example-tag", { opacity: 1, duration: 1.5 }, 35);

      for (let k = 1; k < 6; k++) {
        const pos = 34 + k * 4;
        const out = `.exp-cell-layer[data-vi="${k - 1}"]`;
        const inn = `.exp-cell-layer[data-vi="${k}"]`;
        tl.to(out, { autoAlpha: 0, y: -12, duration: 0.9, stagger: 0.05, ease: "power1.in" }, pos - 0.9);
        tl.fromTo(
          inn,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.07, ease: "power2.out" },
          pos
        );
        tl.to(".exp-side-ind", { y: k * 40, duration: 0.8, ease: "power2.inOut" }, pos - 0.4);
        tl.to(`[data-si="${k - 1}"]`, { color: "#74746D", duration: 0.6 }, pos - 0.4);
        tl.to(`[data-si="${k}"]`, { color: "#111111", duration: 0.6 }, pos - 0.2);
        tl.to(`[data-vt="${k - 1}"]`, { autoAlpha: 0, y: -8, duration: 0.6 }, pos - 0.5);
        tl.fromTo(`[data-vt="${k}"]`, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.8 }, pos);
        tl.to(".exp-ghost-roll", { y: -280 * k, duration: 1.6, ease: "power2.inOut" }, pos - 0.8);
        tl.to(`.exp-vidx[data-vx="${k - 1}"]`, { color: "#84847D", duration: 0.6 }, pos - 0.4);
        tl.to(`.exp-vidx[data-vx="${k}"]`, { color: "#111111", duration: 0.6 }, pos - 0.2);
        tl.to(`.exp-vidx[data-vx="${k - 1}"] .exp-vidx-tick`, { backgroundColor: "rgba(0,0,0,0.15)", duration: 0.6 }, pos - 0.4);
        tl.to(`.exp-vidx[data-vx="${k}"] .exp-vidx-tick`, { backgroundColor: "#D4AF37", duration: 0.6 }, pos - 0.2);
      }

      /* ---- ACT 4 · nothing runs alone (58–80) ---- */
      tl.to(".exp-view-index", { autoAlpha: 0, x: -24, duration: 2 }, 58);
      tl.to(".exp-example-tag", { opacity: 0, duration: 1 }, 58);
      tl.to(".exp-obj-shadow", { opacity: 0, duration: 3 }, 59);
      tl.to(".exp-dash .exp-widget", { autoAlpha: 0, y: -26, scale: 0.92, stagger: 0.35, duration: 2.6, ease: "power2.in" }, 58);
      tl.to(".exp-ghost-wrap", { autoAlpha: 0, duration: 1.5 }, 58.5);
      tl.to(".exp-dash", { autoAlpha: 0, scale: 0.9, y: 20, duration: 3, ease: "power2.inOut" }, 60.5);

      tl.set(".exp-net", { autoAlpha: 1 }, 61);
      tl.fromTo(
        ".exp-module",
        {
          autoAlpha: 0,
          scale: 0.6,
          x: (i: number) => dashCenterPx().x - modulePx(i).x,
          y: (i: number) => dashCenterPx().y - modulePx(i).y,
        },
        { autoAlpha: 1, scale: 1, x: 0, y: 0, duration: 3.2, stagger: 0.4, ease: "power2.inOut" },
        61.5
      );
      tl.fromTo(
        [".exp-ribbon-glow", ".exp-ribbon"],
        { strokeDasharray: 1.001, strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 8, stagger: 0.4, ease: "power1.inOut" },
        66
      );
      tl.fromTo(
        ".exp-ribbon2",
        { strokeDasharray: 1.001, strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 4, stagger: 0.3, ease: "power1.inOut" },
        73
      );
      tl.fromTo(".exp-net-h", { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 3, ease: "power2.out" }, 74);

      /* ---- ACT 5 · the loop closes (80–100) ---- */
      tl.to(".exp-net-h", { autoAlpha: 0, y: -20, duration: 2 }, 80);
      tl.to([".exp-ribbon", ".exp-ribbon-glow", ".exp-ribbon2"], { strokeDashoffset: 1, duration: 4, ease: "power1.in" }, 80.5);
      tl.to(
        ".exp-module",
        {
          autoAlpha: 0,
          scale: 0.45,
          x: (i: number) => screenCenterPx().x - modulePx(i).x,
          y: (i: number) => screenCenterPx().y - modulePx(i).y,
          duration: 3.5,
          stagger: 0.3,
          ease: "power2.in",
        },
        81
      );
      tl.set(".exp-net", { autoAlpha: 0 }, 86);

      tl.set(".exp-finale", { autoAlpha: 1 }, 87);
      tl.fromTo(".exp-logomark", { autoAlpha: 0 }, { autoAlpha: 1, duration: 2.5 }, 92.5);
      // The checker tiles lay themselves like bricks, out of the settling dust.
      tl.fromTo(
        ".exp-mark-tile",
        { autoAlpha: 0, x: -16, y: 7 },
        { autoAlpha: 1, x: 0, y: 0, duration: 1.6, stagger: 0.45, ease: "power3.out" },
        92.5
      );
      tl.fromTo(
        ".exp-wm-letter",
        { autoAlpha: 0, x: (i: number) => (3 - i) * 26 },
        { autoAlpha: 1, x: 0, duration: 3, stagger: 0.2, ease: "power3.out" },
        94
      );
      tl.fromTo(
        ".exp-solutions",
        { autoAlpha: 0, letterSpacing: "0.9em" },
        { autoAlpha: 1, letterSpacing: "0.45em", duration: 2.2, ease: "power2.out" },
        95.2
      );
      tl.fromTo(".exp-final-sub", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 2, ease: "power2.out" }, 96);
      tl.fromTo(
        ".exp-cta-outline",
        { strokeDasharray: 1.001, strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 2.2, ease: "power1.inOut" },
        96.3
      );
      tl.fromTo(".exp-cta", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.6 }, 97.2);
      tl.fromTo(".exp-replay", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.4 }, 98.2);
      tl.fromTo(".exp-footnote", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2 }, 98.6);

      /* ---- persistent furniture ---- */
      // The navbar (with its Login affordance) is revealed by the intro at load,
      // so it stays visible through acts 1-4 and only bows out for the finale.
      tl.to(".exp-nav", { autoAlpha: 0, y: -16, duration: 2 }, 84);

      /* Views > 0 start with undrawn charts, ready for their one-shot pop. */
      for (let k = 1; k < 6; k++) resetCharts(`.exp-cell-layer[data-vi="${k}"]`);

      /* One-shot counter/chart pops at each view's arrival. */
      const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;
      ScrollTrigger.create({
        start: () => 0.245 * maxScroll(),
        end: () => 0.245 * maxScroll() + 1,
        onEnter: () => popCounts(v0),
        onLeaveBack: () => resetCounts(v0),
      });
      for (let k = 1; k < 6; k++) {
        const at = (34 + k * 4) / 100;
        const scope = `.exp-cell-layer[data-vi="${k}"]`;
        ScrollTrigger.create({
          start: () => at * maxScroll(),
          end: () => at * maxScroll() + 1,
          onEnter: () => popCharts(scope),
          onLeaveBack: () => resetCharts(scope),
        });
      }

      /* ---- intro (plays once on load; not scroll-driven) ---- */
      if (!reduced) {
        intro = gsap
          .timeline({ delay: 0.25, defaults: { ease: "power3.out" } })
          .fromTo(".exp-canvas", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.8, ease: "power2.out" }, 0)
          .fromTo(".exp-obj-shadow", { opacity: 0 }, { opacity: 0.85, duration: 1.8, ease: "power2.out" }, 0.1)
          .fromTo(".exp-hero-kicker", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.35)
          .set(".exp-hero-h1", { autoAlpha: 1 }, 0.45)
          .fromTo(
            ".exp-hero-line",
            { yPercent: 115, y: 0 },
            { yPercent: 0, y: 0, duration: 1.2, stagger: 0.13 },
            0.45
          )
          .fromTo(".exp-hero-sub", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 1 }, 1.0)
          .fromTo(".exp-scroll-cue", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: "power2.out" }, 1.5)
          .fromTo(".exp-nav", { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "power2.out" }, 1.4)
          .fromTo(".exp-rail", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: "power2.out" }, 1.6);
      } else {
        gsap.set(
          [".exp-canvas", ".exp-hero-kicker", ".exp-hero-h1", ".exp-hero-sub", ".exp-scroll-cue", ".exp-rail", ".exp-nav"],
          { autoAlpha: 1 }
        );
        gsap.set(".exp-hero-line", { yPercent: 0, y: 0 });
        gsap.set(".exp-obj-shadow", { opacity: 0.85 });
      }
    }, rootRef);

    /* Bridge: 3D object state → CSS vars for shadow, ribbons origin, logomark. */
    const varTick = () => {
      const st = stageRef.current;
      if (!st) return;
      st.style.setProperty("--obj-x", `${objectState.sx}px`);
      st.style.setProperty("--obj-y", `${objectState.sy}px`);
      st.style.setProperty("--obj-r", `${objectState.sr}px`);
      const node = document.querySelector<HTMLElement>(".exp-rail-node");
      if (node) node.style.top = `${scrollState.progress * 100}%`;
    };
    gsap.ticker.add(varTick);

    return () => {
      gsap.ticker.remove(varTick);
      if (lenisTick) gsap.ticker.remove(lenisTick);
      lenis?.destroy();
      runtime.lenis = null;
      ScrollTrigger.removeEventListener("refresh", measure);
      ctx.revert();
    };
  }, []);

  return (
    <div ref={rootRef} className="exp-root relative h-[800vh] bg-white text-ink">
      <link rel="preconnect" href="https://api.fontshare.com" />
      <link
        rel="stylesheet"
        precedence="default"
        href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap"
      />
      <div ref={stageRef} className="fixed inset-0 overflow-hidden">
        {/* Cursor-reactive background warmth — barely there. */}
        <div
          aria-hidden
          className="absolute inset-0 z-[1]"
          style={{
            background:
              "radial-gradient(900px circle at var(--cx, 50%) var(--cy, 40%), rgba(212,175,55,0.035), rgba(212,175,55,0.01) 45%, transparent 72%)",
          }}
        />

        {/* The persistent 3D layer. */}
        <div className="exp-canvas absolute inset-0 z-[2] opacity-0">
          <Scene />
        </div>

        {/* Contact shadow under the instrument, glued via CSS vars. */}
        <div
          aria-hidden
          className="exp-obj-shadow pointer-events-none absolute z-[2] opacity-0"
          style={{
            left: "var(--obj-x, 62%)",
            top: "calc(var(--obj-y, 52%) + var(--obj-r, 120px) * 1.18)",
            width: "calc(var(--obj-r, 120px) * 2.3)",
            height: "calc(var(--obj-r, 120px) * 0.5)",
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(ellipse, rgba(17,17,17,0.16), transparent 68%)",
            filter: "blur(6px)",
          }}
        />

        {/* DOM story layers. */}
        <div className="pointer-events-none absolute inset-0 z-[3]">
          <Hero />
          <DashboardFrame />
          <ViewIndex />
          <Network />
          <Finale />
        </div>
      </div>

      <Navbar />
      <Rail />
      <Cursor />

      {/* The story, for readers and robots. */}
      <article className="sr-only">
        <h2>Experio Solutions</h2>
        <p>
          Experio is one intelligent platform for operational excellence. It centralizes
          operations, workflow, inventory, analytics and administration into a single living
          dashboard — every role works from one place, every module speaks to every other.
          Book a demo to see your operation in one frame.
        </p>
      </article>
    </div>
  );
}
