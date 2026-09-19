"use client";

import { useEffect, useState } from "react";

/** The app's narrow edge: below 760px is a phone layout. */
export const NARROW_EDGE = 760;

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < NARROW_EDGE,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${NARROW_EDGE - 1}px)`);
    const onChange = (): void => { setNarrow(mql.matches); };
    onChange();
    mql.addEventListener("change", onChange);
    return () => { mql.removeEventListener("change", onChange); };
  }, []);
  return narrow;
}
