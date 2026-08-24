"use client";

import { useEffect, useRef } from "react";
import { MODULES, RIBBONS, type Ribbon, cubicAt, svgX, svgY } from "@/lib/experio/stage";
import { scrollState, seg } from "@/lib/experio/scroll";
import { pointer } from "@/lib/experio/pointer";

const MODULE_METRICS = ["12m 40s", "94.1%", "412 on shift", "9.4 days", "20% margin", "99.98%"];

const fract = (v: number) => v - Math.floor(v);

const dStr = (r: Ribbon, bx: number, by: number) =>
  `M ${svgX(r.p0[0])} ${svgY(r.p0[1])} C ${svgX(r.p1[0] + bx)} ${svgY(r.p1[1] + by)}, ${svgX(
    r.p2[0] + bx
  )} ${svgY(r.p2[1] + by)}, ${svgX(r.p3[0])} ${svgY(r.p3[1])}`;

/** Act 4: golden ribbons connect every module; the network can be strummed. */
export default function Network() {
  const mains = useRef<(SVGPathElement | null)[]>([]);
  const glows = useRef<(SVGPathElement | null)[]>([]);
  const pulses = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const bows = RIBBONS.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = scrollState.progress;

      if (p > 0.56 && p < 0.88) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const drawF = seg(p, 0.66, 0.78) * (1 - seg(p, 0.805, 0.84));

        RIBBONS.forEach((r, i) => {
          const bow = bows[i];
          let tx = 0;
          let ty = 0;

          if (fine && pointer.inside && !scrollState.reducedMotion) {
            const mid = cubicAt(r, 0.5);
            const mx = ((mid[0] + 1) / 2) * vw;
            const my = ((1 - mid[1]) / 2) * vh;
            const d = Math.hypot(pointer.x - mx, pointer.y - my);
            if (d < 180) {
              const g = 1 - d / 180;
              tx = ((pointer.x - mx) / vw) * 2 * g * 0.07;
              ty = (-(pointer.y - my) / vh) * 2 * g * 0.07;
            }
          }

          // Critically damped — the ribbon has tension, never wobble.
          const k = 70;
          const c = 2 * Math.sqrt(k);
          bow.vx += (tx - bow.x) * k * dt - bow.vx * c * dt;
          bow.x += bow.vx * dt;
          bow.vy += (ty - bow.y) * k * dt - bow.vy * c * dt;
          bow.y += bow.vy * dt;

          const d2 = dStr(r, bow.x, bow.y);
          mains.current[i]?.setAttribute("d", d2);
          glows.current[i]?.setAttribute("d", d2);

          // Packets riding the ribbon, both directions.
          const bowed: Ribbon = {
            p0: r.p0,
            p1: [r.p1[0] + bow.x, r.p1[1] + bow.y],
            p2: [r.p2[0] + bow.x, r.p2[1] + bow.y],
            p3: r.p3,
          };
          for (let j = 0; j < 2; j++) {
            const el = pulses.current[i * 2 + j];
            if (!el) continue;
            if (scrollState.reducedMotion) {
              el.setAttribute("opacity", "0");
              continue;
            }
            const dir = j === 0 ? 1 : -1;
            const tt = fract(dir * (now / 1000) * (0.07 + 0.025 * j) + i * 0.17 + j * 0.5);
            const [nx, ny] = cubicAt(bowed, tt);
            el.setAttribute("cx", String(svgX(nx)));
            el.setAttribute("cy", String(svgY(ny)));
            el.setAttribute("opacity", String(tt < drawF ? 0.9 : 0));
          }
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="exp-net pre-hide absolute inset-0 z-10">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="expGold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#D4AF37" />
            <stop offset="55%" stopColor="#E8C75D" />
            <stop offset="100%" stopColor="#D4AF37" />
          </linearGradient>
          <filter id="expBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Soft underglow beneath each ribbon */}
        {RIBBONS.map((r, i) => (
          <path
            key={`g${i}`}
            ref={(el) => void (glows.current[i] = el)}
            className="exp-ribbon-glow"
            d={dStr(r, 0, 0)}
            fill="none"
            stroke="#E8C75D"
            strokeWidth="6"
            strokeOpacity="0.28"
            filter="url(#expBlur)"
            pathLength={1}
          />
        ))}
        {/* Main gold ribbons */}
        {RIBBONS.map((r, i) => (
          <path
            key={`m${i}`}
            ref={(el) => void (mains.current[i] = el)}
            className="exp-ribbon"
            d={dStr(r, 0, 0)}
            fill="none"
            stroke="url(#expGold)"
            strokeWidth="1.7"
            strokeLinecap="round"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Secondary hairlines interlinking neighboring modules */}
        {MODULES.map((m, i) => {
          const n = MODULES[(i + 1) % MODULES.length];
          const mx = (m.nx + n.nx) / 2;
          const my = (m.ny + n.ny) / 2 - 0.06;
          return (
            <path
              key={`h${i}`}
              className="exp-ribbon2"
              d={`M ${svgX(m.nx)} ${svgY(m.ny)} Q ${svgX(mx)} ${svgY(my)}, ${svgX(n.nx)} ${svgY(n.ny)}`}
              fill="none"
              stroke="rgba(212,175,55,0.28)"
              strokeWidth="1"
              pathLength={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* Traveling data packets */}
        <g className="exp-pulse-group">
          {RIBBONS.flatMap((_, i) =>
            [0, 1].map((j) => (
              <circle
                key={`p${i}-${j}`}
                ref={(el) => void (pulses.current[i * 2 + j] = el)}
                r="2.4"
                fill="#D4AF37"
                opacity="0"
              />
            ))
          )}
        </g>
      </svg>

      {/* Module tiles — outer wrapper owns centering (GSAP never touches it),
          inner tile owns the animated transforms. */}
      {MODULES.map((m, i) => (
        <div
          key={m.label}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${((m.nx + 1) / 2) * 100}%`,
            top: `${((1 - m.ny) / 2) * 100}%`,
          }}
        >
          <div
            data-tilt
            className="exp-module glass glass-rim glass-shine pointer-events-auto relative w-[136px] rounded-2xl px-4 py-3 will-change-transform"
          >
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald" />
              <span className="text-[12px] font-semibold text-ink">{m.label}</span>
            </div>
            <div className="mt-1 text-[15px] font-bold tracking-tight text-ink tabular-nums">
              {MODULE_METRICS[i]}
            </div>
          </div>
        </div>
      ))}

      {/* Act 4 headline */}
      <div className="exp-net-h absolute left-1/2 top-[9vh] z-10 -translate-x-1/2 text-center">
        <h2 className="text-[clamp(38px,5vw,72px)] font-bold tracking-[-0.02em] text-ink">
          Nothing runs alone.
        </h2>
        <p className="mt-3 text-[18px] font-medium text-ink-2">Six modules. One source of truth.</p>
      </div>
    </div>
  );
}
