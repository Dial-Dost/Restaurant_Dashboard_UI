// Pure helpers for the waitlist module — web copies of the small readers the
// Flutter view leans on (modules.dart `_guestInitials`, `_guestCount`, the
// pending-card subtotal fold).

import type { PendingPreorderEntry, WaitlistEntry } from "@/lib/db";

export interface PreorderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  note?: string;
}

/** "AB" for "Anita Bose", "A" for "Anita", "?" for nothing. */
export function guestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) { return "?"; }
  return parts.length === 1
    ? parts[0].slice(0, 1)
    : `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
}

/** Sum of party sizes, floored at 1 per party (Flutter `_guestCount`). */
export function guestCount(entries: WaitlistEntry[]): number {
  return entries.reduce((total, e) => {
    const n = e.party_size || 1;
    return total + (n < 1 ? 1 : n);
  }, 0);
}

/** The app's money string — symbol + en-IN grouping (existing page helper). */
export function moneyOf(symbol: string, n: number): string {
  return `${symbol}${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Held-lines subtotal, quantity floored at 1 — an indication only; the
 *  server re-prices on confirm (Flutter `_pendingCard`). */
export function heldSubtotal(items: PreorderItem[]): number {
  return items.reduce((sum, it) => {
    const q = Math.round(it.quantity || 1);
    return sum + (it.price || 0) * (q <= 0 ? 1 : q);
  }, 0);
}

/** Line price for the review dialog — qty clamped 1..999 (Flutter dialog). */
export function heldLineTotal(item: PreorderItem): number {
  const q = Math.round(item.quantity || 1);
  return (item.price || 0) * Math.min(999, Math.max(1, q));
}

/** Total item COUNT of a held pre-order, each quantity floored at 1. */
export function heldItemCount(items: PreorderItem[]): number {
  return items.reduce((sum, it) => {
    const q = Math.round(it.quantity || 1);
    return sum + (q <= 0 ? 1 : q);
  }, 0);
}

export const preItemsOf = (e: WaitlistEntry | PendingPreorderEntry): PreorderItem[] =>
  Array.isArray(e.pre_order) ? e.pre_order : [];

export const membersOf = (e: WaitlistEntry): { name: string; phone: string }[] =>
  Array.isArray(e.party_members) ? e.party_members : [];
