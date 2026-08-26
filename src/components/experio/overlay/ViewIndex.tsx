"use client";

import { VIEWS } from "../dash/viewData";

/** Act 3: the editorial index rail beside the docked instrument. */
export default function ViewIndex() {
  return (
    <div className="exp-view-index pre-hide absolute left-[7vw] top-[54%] z-10 hidden lg:block">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-3">
        One login. Every module.
      </p>
      <ul className="flex flex-col gap-3">
        {VIEWS.map((v, i) => (
          <li
            key={v.name}
            data-vx={i}
            className="exp-vidx flex items-center gap-3 text-[15px] font-medium"
            style={{ color: i === 0 ? "#111111" : "#84847D" }}
          >
            <span
              className="exp-vidx-tick h-px w-4"
              style={{ background: i === 0 ? "var(--gold)" : "rgba(0,0,0,0.15)" }}
            />
            {v.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
