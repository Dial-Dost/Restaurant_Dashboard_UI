/**
 * Shared pointer state — written by one listener in Experience, read by the
 * cursor, the background aura, and the particle field. Raw values only;
 * consumers do their own smoothing so each layer can lag differently.
 */
export const pointer = {
  /** pixels */
  x: 0,
  y: 0,
  /** normalized device coords, -1..1, y up */
  nx: 0,
  ny: 0,
  inside: false,
  /** true while the primary button is down */
  down: false,
};

export function bindPointer(): () => void {
  const onMove = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.inside = true;
  };
  const onLeave = () => (pointer.inside = false);
  const onDown = () => (pointer.down = true);
  const onUp = () => (pointer.down = false);

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);

  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    document.documentElement.removeEventListener("pointerleave", onLeave);
  };
}
