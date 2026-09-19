"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { ACTS, clamp01, lerp, scrollState, seg, smoothstep } from "@/lib/experio/scroll";
import { RIBBONS, cubicAtInto, dashRect, objectState } from "@/lib/experio/stage";
import { pointer } from "@/lib/experio/pointer";

/** Shared scratch — never allocate inside the 1600-particle frame loop. */
const ORIGIN = new THREE.Vector3(0, 0, 0);
const ribbonPt = { x: 0, y: 0 };

const N = 1600;
const ORBITERS = 140; // act-1 visible shell
const DATA_N = 220; // act-3 in-chart particles

/** The three orbital planes match the gimbal bands. */
const PLANES = [
  { tilt: 0.14, roll: 0 },
  { tilt: 1.08, roll: 0 },
  { tilt: Math.PI / 2, roll: 0.35 },
];

const fract = (v: number) => v - Math.floor(v);

/** Sample "EXPERIO" pixels from an offscreen canvas → normalized points. */
function sampleWordmark(): Float32Array {
  const cv = document.createElement("canvas");
  cv.width = 560;
  cv.height = 110;
  const ctx = cv.getContext("2d");
  const pts: number[] = [];
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.font = "900 92px Satoshi, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EXPERIO", 280, 58);
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    for (let y = 0; y < cv.height; y += 3) {
      for (let x = 0; x < cv.width; x += 3) {
        if (img[(y * cv.width + x) * 4 + 3] > 128) {
          pts.push(x / cv.width - 0.5, 0.5 - y / cv.height);
        }
      }
    }
  }
  if (pts.length < 8) {pts.push(-0.4, 0, -0.2, 0, 0, 0, 0.2, 0);}
  return new Float32Array(pts);
}

export default function ParticleField() {
  const points = useRef<THREE.Points>(null!);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const viewportHelper = useThree((s) => s.viewport);

  const sim = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const alpha = new Float32Array(N);
    const alphaTarget = new Float32Array(N);
    const seed = new Float32Array(N);
    const sizes = new Float32Array(N);
    const colors = new Float32Array(N * 3);

    const cGold = new THREE.Color("#D4AF37");
    const cLight = new THREE.Color("#E8C75D");
    const cDeep = new THREE.Color("#A8862A");
    const tmp = new THREE.Color();

    for (let i = 0; i < N; i++) {
      seed[i] = Math.abs(Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1;
      sizes[i] = 2 + seed[i] * 3;
      const r = fract(seed[i] * 7.31);
      tmp.copy(r < 0.48 ? cGold : r < 0.92 ? cLight : cDeep);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
      alpha[i] = 0;
    }
    return { pos, vel, alpha, alphaTarget, seed, sizes, colors, letters: null as Float32Array | null };
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sim.pos, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(sim.alpha, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(sim.sizes, 1));
    g.setAttribute("color", new THREE.BufferAttribute(sim.colors, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    return g;
  }, [sim]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending, // additive vanishes on white
        uniforms: { uDpr: { value: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) } },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          attribute float aSize;
          varying float vAlpha;
          varying vec3 vColor;
          uniform float uDpr;
          void main() {
            vColor = color;
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uDpr * (6.5 / max(0.5, -mv.z));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.14, d) * vAlpha;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vColor, a);
          }
        `,
        vertexColors: true,
      }),
    []
  );

  const target = new THREE.Vector3();
  const basis = useMemo(
    () =>
      PLANES.map((pl) => {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pl.tilt, 0, pl.roll));
        return {
          u: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
          v: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
        };
      }),
    []
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 30);
    const p = scrollState.progress;
    const t = state.clock.elapsedTime;
    const reduced = scrollState.reducedMotion;

    const vp = viewportHelper.getCurrentViewport(camera, ORIGIN);
    const hw = vp.width / 2;
    const hh = vp.height / 2;

    const ox = objectState.x;
    const oy = objectState.y;
    const os = objectState.scale;

    // Pointer in world coords at z = 0.
    const pwx = pointer.nx * hw;
    const pwy = pointer.ny * hh;
    const repelR = hh * 0.24;

    // Lazily sample the wordmark once fonts are likely ready.
    if (p > 0.7 && !sim.letters) {sim.letters = sampleWordmark();}

    /* -------- global act weights (windows with soft crossfades) -------- */
    const wBuild = smoothstep(seg(p, 0.11, 0.15)) * (1 - smoothstep(seg(p, 0.33, 0.36)));
    const wViews = smoothstep(seg(p, 0.33, 0.36)) * (1 - smoothstep(seg(p, 0.57, 0.6)));
    const wNet = smoothstep(seg(p, 0.6, 0.65)) * (1 - smoothstep(seg(p, 0.79, 0.82)));
    const wCollapse = smoothstep(seg(p, 0.8, 0.84)) * (1 - smoothstep(seg(p, 0.915, 0.935)));
    // Dust etches the name, then lifts BEFORE the DOM wordmark settles —
    // a handoff, never a double exposure.
    const wLetters = smoothstep(seg(p, 0.925, 0.945)) * (1 - smoothstep(seg(p, 0.955, 0.975)));
    const wEnd = smoothstep(seg(p, 0.975, 0.99));
    const wOrbit = 1 - Math.min(1, wBuild + wViews + wNet + wCollapse + wLetters + wEnd);

    // Dashboard rect in world units.
    const dx0 = dashRect.x0 * hw;
    const dx1 = dashRect.x1 * hw;
    const dy0 = dashRect.y0 * hh;
    const dy1 = dashRect.y1 * hh;

    const buildF = smoothstep(seg(p, 0.13, 0.32));
    const viewSlot = Math.min(5, Math.floor(seg(p, ACTS.views.a, ACTS.views.b) * 6));
    const drawF = seg(p, 0.66, 0.78);
    const collapseF = smoothstep(seg(p, 0.82, 0.93));
    const lettersN = sim.letters ? sim.letters.length / 2 : 0;

    const stiff = reduced ? 30 : 16;

    for (let i = 0; i < N; i++) {
      const s = sim.seed[i];
      const i3 = i * 3;
      let ta = 0;

      target.set(ox, oy, 0);

      if (wOrbit > 0.01) {
        // Orbit the three band planes; non-orbiters hide in the core reservoir.
        if (i < ORBITERS || p > 0.98) {
          const pl = basis[i % 3];
          const ang = s * Math.PI * 2 + t * (0.1 + s * 0.12) * (reduced ? 0.04 : 1);
          const rad = os * (1.35 + fract(s * 5.7) * 0.9);
          target.set(
            ox + (pl.u.x * Math.cos(ang) + pl.v.x * Math.sin(ang)) * rad,
            oy + (pl.u.y * Math.cos(ang) + pl.v.y * Math.sin(ang)) * rad * 0.98,
            (pl.u.z * Math.cos(ang) + pl.v.z * Math.sin(ang)) * rad
          );
          ta = 0.55 * wOrbit;
        } else {
          target.set(ox, oy, 0);
          ta = 0;
        }
      }

      if (wBuild > 0.01) {
        // Stream from the object to a seeded point in the dashboard rect,
        // staggered so the comet tail persists — the construction crew.
        const u = fract(s * 9.17);
        const v = fract(s * 3.71);
        const gx = lerp(dx0, dx1, u);
        const gy = lerp(dy0, dy1, v);
        const startAt = fract(s * 13.7) * 0.55;
        const f = clamp01((buildF - startAt) / Math.max(0.001, 1 - startAt));
        const mx = lerp(ox, gx, 0.5);
        const my = Math.max(oy, gy) + hh * 0.25 * (1 - Math.abs(u - 0.5));
        const iu = 1 - f;
        const bx = iu * iu * ox + 2 * iu * f * mx + f * f * gx;
        const by = iu * iu * oy + 2 * iu * f * my + f * f * gy;
        target.set(
          lerp(target.x, bx, wBuild),
          lerp(target.y, by, wBuild),
          lerp(target.z, Math.sin(s * 40) * 0.3 * (1 - f), wBuild)
        );
        // Bright while flying, deposited (dim) after arrival.
        const flying = f > 0.01 && f < 0.96;
        ta = Math.max(ta, wBuild * (flying ? 0.85 : f >= 0.96 ? 0.1 : 0.5));
      }

      if (wViews > 0.01) {
        if (i < DATA_N) {
          // The data itself: rows of gold dust inside the dashboard, reflowing
          // to new seeded coordinates each time the dial clicks.
          const su = fract(s * 17.9 + viewSlot * 0.618);
          const sv = fract(s * 7.3 + viewSlot * 0.377);
          target.set(
            lerp(target.x, lerp(dx0 + (dx1 - dx0) * 0.08, dx1 - (dx1 - dx0) * 0.06, su), wViews),
            lerp(target.y, lerp(dy0 + (dy1 - dy0) * 0.12, dy1 - (dy1 - dy0) * 0.15, sv), wViews),
            lerp(target.z, 0.2, wViews)
          );
          ta = Math.max(ta, 0.4 * wViews);
        } else if (i < DATA_N + 160) {
          // A quiet halo around the docked instrument.
          const pl = basis[i % 3];
          const ang = s * Math.PI * 2 + (reduced ? 0 : t * 0.08);
          const rad = os * (1.5 + fract(s * 4.1) * 0.7);
          target.set(
            lerp(target.x, ox + (pl.u.x * Math.cos(ang) + pl.v.x * Math.sin(ang)) * rad, wViews),
            lerp(target.y, oy + (pl.u.y * Math.cos(ang) + pl.v.y * Math.sin(ang)) * rad, wViews),
            lerp(target.z, (pl.u.z * Math.cos(ang) + pl.v.z * Math.sin(ang)) * rad, wViews)
          );
          ta = Math.max(ta, 0.35 * wViews);
        }
      }

      if (wNet > 0.01) {
        // Ride the ribbons as visible pulses, both directions.
        const r = RIBBONS[i % RIBBONS.length];
        const dir = i % 2 === 0 ? 1 : -1;
        const speed = reduced ? 0 : 0.05 + fract(s * 3.3) * 0.05;
        let rt = fract(s + dir * t * speed);
        // Packets: bunch particles into pulses.
        rt = fract(rt + 0.12 * Math.sin(t * 0.7 + s * 20));
        const visible = rt < drawF ? 1 : 0;
        cubicAtInto(r, rt, ribbonPt);
        target.set(
          lerp(target.x, ribbonPt.x * hw + Math.sin(s * 60 + t) * 0.05, wNet),
          lerp(target.y, ribbonPt.y * hh + Math.cos(s * 50 + t) * 0.05, wNet),
          lerp(target.z, 0.1, wNet)
        );
        ta = Math.max(ta, wNet * visible * (0.25 + 0.55 * Math.pow(Math.sin((rt * 6 + s) * Math.PI), 2)));
      }

      if (wCollapse > 0.01) {
        // Spiral home into the studs.
        const th = s * Math.PI * 2 + collapseF * (4 + s * 3);
        const rad = (1 - collapseF) * (0.6 + fract(s * 11.3) * 1.6) * hh + os * 1.2 * (1 - collapseF * 0.7);
        target.set(
          lerp(target.x, ox + Math.cos(th) * rad * 0.8, wCollapse),
          lerp(target.y, oy + Math.sin(th) * rad * 0.55, wCollapse),
          lerp(target.z, Math.sin(s * 30) * 0.2 * (1 - collapseF), wCollapse)
        );
        ta = Math.max(ta * (1 - wCollapse), wCollapse * (0.7 - collapseF * 0.55));
      }

      if (wLetters > 0.01 && sim.letters) {
        // The name, etched in dust below the mark.
        const li = i % lettersN;
        const lx = sim.letters[li * 2];
        const ly = sim.letters[li * 2 + 1];
        const w = hw * 0.62;
        target.set(lx * w, oy - hh * 0.24 + ly * w * 0.2, 0.2);
        ta = Math.max(ta, (i < lettersN * 2 ? 0.75 : 0) * wLetters);
      }

      if (wEnd > 0.01) {
        // 90 remain orbiting the final mark; the rest park inside.
        if (i < 90) {
          const ang = s * Math.PI * 2 + (reduced ? 0 : t * 0.15);
          const rad = os * (1.5 + fract(s * 4.7) * 0.4);
          target.set(ox + Math.cos(ang) * rad, oy + Math.sin(ang) * rad * 0.4, 0.2);
          ta = Math.max(ta, 0.5 * wEnd);
        } else {
          target.set(ox, oy, 0);
          ta = ta * (1 - wEnd);
        }
      }

      // Cursor repulsion — always on, smooth falloff, spring return.
      if (!reduced && pointer.inside) {
        const dxp = sim.pos[i3] - pwx;
        const dyp = sim.pos[i3 + 1] - pwy;
        const d2 = dxp * dxp + dyp * dyp;
        if (d2 < repelR * repelR && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (1 - d / repelR) * 2.2;
          sim.vel[i3] += (dxp / d) * push * dt;
          sim.vel[i3 + 1] += (dyp / d) * push * dt;
        }
      }

      // Critically damped spring toward the target — weight, never bounce.
      const k = stiff * (0.8 + fract(s * 2.9) * 0.4);
      const c = 2 * Math.sqrt(k);
      for (let a2 = 0; a2 < 3; a2++) {
        const idx = i3 + a2;
        const x = sim.pos[idx];
        const v =
          sim.vel[idx] +
          ((a2 === 0 ? target.x : a2 === 1 ? target.y : target.z) - x) * k * dt -
          sim.vel[idx] * c * dt;
        sim.vel[idx] = v;
        sim.pos[idx] = x + v * dt;
      }

      sim.alpha[i] = lerp(sim.alpha[i], ta, Math.min(1, dt * 5));
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}
