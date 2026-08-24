"use client";

const ACT_MARKS = [
  { n: "I", at: 0.05 },
  { n: "II", at: 0.23 },
  { n: "III", at: 0.46 },
  { n: "IV", at: 0.69 },
  { n: "V", at: 0.9 },
];

/** The permanent right-edge progress rail: one hairline, five numerals, one gold node. */
export default function Rail() {
  return (
    <div className="exp-rail pointer-events-none fixed right-7 top-1/2 z-30 hidden -translate-y-1/2 opacity-0 lg:block">
      <div className="relative h-[240px] w-px bg-black/[0.08]">
        <span
          className="exp-rail-node absolute -left-[2.5px] size-[6px] rounded-full bg-gold shadow-[0_0_10px_rgba(212,175,55,0.65)]"
          style={{ top: 0 }}
        />
        {ACT_MARKS.map((a) => (
          <span
            key={a.n}
            className="absolute -left-6 -translate-y-1/2 text-[9px] font-medium text-ink-3"
            style={{ top: `${a.at * 100}%` }}
          >
            {a.n}
          </span>
        ))}
      </div>
    </div>
  );
}
