/**
 * Shared scroll state. The master ScrollTrigger writes here once per frame;
 * the 3D scene reads it inside useFrame. Module-level so the R3F tree and the
 * DOM timeline stay in sync without React re-renders.
 */
export const scrollState = {
  /** 0..1 across the whole 800vh journey */
  progress: 0,
  /** Lenis velocity, for subtle inertia effects */
  velocity: 0,
  reducedMotion: false,
};

/** Shared runtime handles (the Lenis instance, for Replay-the-film). */
export const runtime: {
  lenis: { scrollTo: (target: number, opts?: Record<string, unknown>) => void } | null;
} = { lenis: null };

/** The five acts as ranges of total scroll progress. */
export const ACTS = {
  hero: { a: 0.0, b: 0.12 },
  build: { a: 0.12, b: 0.34 },
  views: { a: 0.34, b: 0.58 },
  network: { a: 0.58, b: 0.8 },
  finale: { a: 0.8, b: 1.0 },
} as const;

export const VIEW_COUNT = 6;

/** Detent easing for act 3: the dial resists, then gives. */
export const detent = (f: number) => {
  const x = clamp01(f);
  return x < 0.7 ? x * 0.06 : 0.06 + 0.94 * smoothstepRaw((x - 0.7) / 0.3);
};

const smoothstepRaw = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Progress within a sub-range, clamped to 0..1. */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Frame-rate independent exponential approach (Freya Holmér's damp). */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
