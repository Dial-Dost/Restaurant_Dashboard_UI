// Simulator number voice (Flutter `_simMoney` / `_simNum`).

import { simFinite } from "@/lib/simulation-params";

/** Whole-rupee money with the sign OUTSIDE the symbol: "₹1234" / "-₹1234". */
export const simMoneyWith = (symbol: string) => (v: number): string => {
  const r = Math.round(simFinite(v));
  return r < 0 ? `-${symbol}${-r}` : `${symbol}${r}`;
};

/** Covers/TAT figure to 0.1, dropping a pointless ".0" ("89.9", "42"). */
export const simNum = (v: number): string => {
  const d = Math.round(simFinite(v) * 10) / 10;
  return Number.isInteger(d) ? String(d === 0 ? 0 : d) : d.toFixed(1);
};

/** 0.1 rounding for the delta judgement. */
export const tenth = (v: number): number => Math.round(simFinite(v) * 10) / 10;
