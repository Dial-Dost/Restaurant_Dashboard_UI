"use client";

/*
  SWIPE THE BOTTOM SHEET AWAY.

  Client: "Not able to close this tab by closing it only by clicking x even
  though that slider remove thing is there on top." The 40x4 grab handle the
  bottom sheet wears is the universal "drag me down" affordance on a phone, and
  ours was decoration: `aria-hidden`, no listeners, so the only way out of a
  sheet was the X in the corner — the one control a thumb on a 6" screen cannot
  reach without shifting grip.

  WHAT THIS IS
  ------------
  A pointer-event drag, bound to the handle (and the header beside it), that
  follows the finger down, rubber-bands upward movement, and either dismisses
  past a threshold or springs back. It is deliberately NOT a gesture library:
  one pointer, one axis, ~70 lines, no dependency, and it degrades to "nothing
  happens" wherever `setPointerCapture` is missing.

  THE RULES IT FOLLOWS
  --------------------
  • BOTTOM SHEET ONLY. Above 760px the surface is a centred dialog and dragging
    a dialog downwards means nothing; `enabled` carries that query, re-read on
    resize, so a rotated tablet gets the right behaviour without a remount.
  • DOWN ONLY. Upward travel is damped to a quarter, so the sheet acknowledges
    the finger without ever growing a gap above itself.
  • DISMISS ON DISTANCE *OR* SPEED. 88px of travel, or a flick faster than
    0.5px/ms — the flick is what makes a short, fast swipe feel right instead of
    "not far enough".
  • THE TRANSFORM IS WRITTEN TO THE NODE, NOT TO STATE. A React render per
    pointermove is how a drag ends up at 20fps behind the finger.
  • A CANCELLED DRAG ALWAYS RESTORES THE NODE. Every exit path runs the same
    reset, so a sheet can never be left translated off-screen and unclickable.
*/

import * as React from "react";

/** Below this the surface is a bottom sheet; at or above it, a centred dialog. */
const SHEET_MAX_WIDTH = 759;
/** How far the finger has to travel before letting go dismisses. */
const DISMISS_PX = 88;
/** …or how fast, in px per ms, for a flick to dismiss from anywhere. */
const DISMISS_VELOCITY = 0.5;
/** Upward travel is damped rather than blocked — the sheet must feel alive. */
const UPWARD_DAMPING = 0.25;

export interface SheetDrag {
    /** Spread onto the surface being dragged (the sheet's own element). */
    contentRef: React.RefObject<HTMLDivElement | null>;
    /** Spread onto the grab handle / header — where the drag may start. */
    handleProps: {
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
        style: React.CSSProperties;
    };
    /** True while a finger is on the handle — the caller drops its transition. */
    dragging: boolean;
}

/** True when the viewport is narrow enough that the surface is a bottom sheet. */
const isSheetWidth = (): boolean =>
    typeof window !== "undefined" && window.matchMedia(`(max-width: ${String(SHEET_MAX_WIDTH)}px)`).matches;

export function useSheetDrag(onDismiss: () => void): SheetDrag {
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = React.useState(false);
    // Re-read on resize/rotate rather than at mount only.
    const [enabled, setEnabled] = React.useState(false);
    React.useEffect(() => {
        const read = (): void => { setEnabled(isSheetWidth()); };
        read();
        window.addEventListener("resize", read);
        window.addEventListener("orientationchange", read);
        return () => {
            window.removeEventListener("resize", read);
            window.removeEventListener("orientationchange", read);
        };
    }, []);

    const start = React.useRef<{ y: number; at: number } | null>(null);
    const offset = React.useRef(0);

    const reset = React.useCallback((): void => {
        const node = contentRef.current;
        if (node !== null) {
            node.style.transform = "";
            node.style.transition = "";
        }
        start.current = null;
        offset.current = 0;
        setDragging(false);
    }, []);

    // Nothing may be left translated if the sheet unmounts mid-drag.
    React.useEffect(() => reset, [reset]);

    const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>): void => {
        if (!enabled || event.button !== 0) { return; }
        const node = contentRef.current;
        if (node === null) { return; }
        start.current = { y: event.clientY, at: event.timeStamp };
        offset.current = 0;
        setDragging(true);
        node.style.transition = "none";
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* no capture, no drag */ }

        const move = (e: PointerEvent): void => {
            const from = start.current;
            const surface = contentRef.current;
            if (from === null || surface === null) { return; }
            const raw = e.clientY - from.y;
            offset.current = raw >= 0 ? raw : raw * UPWARD_DAMPING;
            surface.style.transform = `translate3d(0, ${String(offset.current)}px, 0)`;
        };

        const end = (e: PointerEvent): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            const from = start.current;
            const travelled = offset.current;
            const elapsed = from === null ? 0 : Math.max(1, e.timeStamp - from.at);
            const velocity = travelled / elapsed;
            const surface = contentRef.current;
            if (travelled > DISMISS_PX || (travelled > 16 && velocity > DISMISS_VELOCITY)) {
                // Let Radix run its own close animation from where the finger left it.
                reset();
                onDismiss();
                return;
            }
            if (surface !== null) {
                surface.style.transition = "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)";
                surface.style.transform = "translate3d(0, 0, 0)";
            }
            start.current = null;
            offset.current = 0;
            setDragging(false);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }, [enabled, onDismiss, reset]);

    return {
        contentRef,
        handleProps: {
            onPointerDown,
            // The browser must not claim the vertical gesture for scrolling.
            style: enabled ? { touchAction: "none" } : {},
        },
        dragging,
    };
}
