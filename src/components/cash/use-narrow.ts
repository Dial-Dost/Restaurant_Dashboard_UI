"use client";

import * as React from "react";

/**
 * The app-wide narrow edge: Flutter reads `MediaQuery.sizeOf(context).width <
 * 760` before densifying chips (modules.dart `_CashView.build`); the web
 * design system draws the same line (DrillSheet's `min-[760px]`). This hook
 * is the prop-driven version for components whose density is an API, not a
 * class.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < 760,
  );

  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 759px)");
    const onChange = (): void => { setNarrow(mql.matches); };
    onChange();
    mql.addEventListener("change", onChange);
    return () => { mql.removeEventListener("change", onChange); };
  }, []);

  return narrow;
}
