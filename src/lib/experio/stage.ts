/**
 * Shared stage geometry, in normalized screen coords (x right, y up, -1..1).
 * The DOM ribbons SVG and the 3D particle field both read these, so gold
 * streams in the canvas line up with glass modules in the DOM.
 */

/** Live state of the brand object, written by BrandObject each frame. */
export const objectState = {
  /** world position */
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  /** 0..1 — how far the finale flatten has progressed */
  flatten: 0,
  /** 3D opacity, used to hand off to the DOM logomark */
  opacity: 1,
  /** projected screen position (px) and screen radius (px) — for the DOM
   * contact shadow, ribbon origins and the logo handoff */
  sx: 0,
  sy: 0,
  sr: 120,
};

/** Where the dashboard frame currently sits, in normalized coords. */
export const dashRect = { x0: -0.05, y0: -0.62, x1: 0.93, y1: 0.62 };

export interface Module { label: string; nx: number; ny: number }

/** Six real CuisineFlow modules on a ring around the centered object (act 4).
 * Labels are content; the nx/ny ring geometry is mechanics — leave it. */
export const MODULES: Module[] = [
  { label: "Orders", nx: 0.62, ny: 0.02 },
  { label: "Kitchen", nx: 0.33, ny: 0.44 },
  { label: "Inventory", nx: -0.33, ny: 0.44 },
  { label: "Menu", nx: -0.62, ny: 0.02 },
  { label: "Accounting", nx: -0.33, ny: -0.46 },
  { label: "Feedback", nx: 0.33, ny: -0.46 },
];

const CENTER = { nx: 0, ny: 0.04 };

export interface Ribbon {
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  p3: [number, number];
}

/** Cubic bezier per module, sagging like silk between hub and satellite. */
export const RIBBONS: Ribbon[] = MODULES.map((m) => {
  const dx = m.nx - CENTER.nx;
  const dy = m.ny - CENTER.ny;
  return {
    p0: [CENTER.nx, CENTER.ny],
    p1: [CENTER.nx + dx * 0.38, CENTER.ny + dy * 0.38 - 0.1],
    p2: [m.nx - dx * 0.3, m.ny - dy * 0.3 - 0.08],
    p3: [m.nx, m.ny],
  };
});

export function cubicAt(r: Ribbon, t: number): [number, number] {
  const u = 1 - t;
  const x =
    u * u * u * r.p0[0] + 3 * u * u * t * r.p1[0] + 3 * u * t * t * r.p2[0] + t * t * t * r.p3[0];
  const y =
    u * u * u * r.p0[1] + 3 * u * u * t * r.p1[1] + 3 * u * t * t * r.p2[1] + t * t * t * r.p3[1];
  return [x, y];
}

/** Allocation-free variant for per-particle hot loops. */
export function cubicAtInto(r: Ribbon, t: number, out: { x: number; y: number }) {
  const u = 1 - t;
  out.x =
    u * u * u * r.p0[0] + 3 * u * u * t * r.p1[0] + 3 * u * t * t * r.p2[0] + t * t * t * r.p3[0];
  out.y =
    u * u * u * r.p0[1] + 3 * u * u * t * r.p1[1] + 3 * u * t * t * r.p2[1] + t * t * t * r.p3[1];
}

/** Map normalized coords into the ribbons SVG viewBox (1000×600, y down). */
export const svgX = (nx: number) => 500 + nx * 500;
export const svgY = (ny: number) => 300 - ny * 300;
