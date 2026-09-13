// 6.4 — WHAT THE LIVE-GROSS BOX IS ALLOWED TO SAY, decided once, off the server's page.
//
// THE BUG THIS EXISTS FOR. The box read `total` / `outstanding_total`, which the
// server counts over "Bills" rows. A table with sent KOTs and no bill generated
// yet has no row, so a floor of eating guests read "₹0 · No tables are running".
// The server now sends `running_tables` / `running_total`, which count those
// tables too (priced by its own billing math), and this is where the box picks
// them up.
//
// THREE STATES, and "zero" is never a stand-in for either of the other two:
//   * unavailable — the backend could not be asked. Never ₹0.00.
//   * hidden      — the server withheld the money (a waiter-only session). The
//                   count still shows; an amount does not, and certainly not 0.
//   * a figure    — tables and their tax-inclusive total.
//
// A backend older than 6.4's fields falls back to the open-bill figures it has
// always sent, so a staggered deploy degrades to the old box, not to a blank.
//
// PURE — no React, no fetch — so `__tests__/live-gross.test.ts` can pin it.

import type { OpenBillPage } from './db';

export type LiveGrossView =
    | { kind: 'unavailable' }
    /** `total === null` = the server withheld the amount; show the count only. */
    | { kind: 'floor'; tables: number; total: number | null };

type LiveGrossSource = Pick<OpenBillPage, 'total' | 'outstanding_total' | 'running_tables' | 'running_total'>;

export const readLiveGross = (page: LiveGrossSource | null | undefined): LiveGrossView => {
    if (!page) { return { kind: 'unavailable' }; }
    if (typeof page.running_tables === 'number') {
        return { kind: 'floor', tables: page.running_tables, total: page.running_total ?? null };
    }
    // Pre-6.4 backend: the open bills are the best answer it can give.
    return { kind: 'floor', tables: page.total, total: page.outstanding_total };
};
