// The waitlist board's one combined read — the web copy of Flutter
// `_WaitlistViewState._fetch` (modules.dart): GET /waitlist is the board and
// MUST succeed; /get-tables and /waitlist/pending-preorders are best-effort
// side payloads (an older backend without the pending route must not blank
// the queue).
//
// Parity note (audit 39): a transient failure of a SIDE fetch keeps the last
// good copy instead of blanking free tables / the pending list mid-poll; a
// failure of the waitlist GET itself throws, and useCachedFetch keeps the
// whole board on screen behind the offline pill.

import {
  getPendingPreorders,
  getTables,
  getWaitlist,
  type PendingPreorderEntry,
  type WaitlistEntry,
} from "@/lib/db";
import type { Table } from "@/app/dashboard/tables/data";

export interface WaitlistBoard {
  entries: WaitlistEntry[];
  /** Seated parties whose held pre-order still needs a yes/no. */
  pending: PendingPreorderEntry[];
  /** Names of tables free to seat at right now. */
  freeTables: string[];
}

/** Free = not occupied, booked or reserved (Flutter `_apply`; the web tables
 *  mapper folds those flags into `status`). */
export const freeTableNames = (tables: Table[]): string[] =>
  tables
    .filter((t) => t.status === "Available")
    .map((t) => t.name)
    .filter((n) => n.length > 0 && n !== "—");

// Last good side payloads per restaurant, so one dropped side request during
// a poll cannot blank what was on screen.
const lastGoodSides = new Map<string, { pending: PendingPreorderEntry[]; freeTables: string[] }>();

export async function fetchWaitlistBoard(restaurantId: string): Promise<WaitlistBoard> {
  const entriesPromise = getWaitlist(restaurantId);
  const freeTablesPromise: Promise<string[] | null> = getTables(restaurantId).then(
    (tables) => freeTableNames(tables),
    () => null,
  );
  const pendingPromise: Promise<PendingPreorderEntry[] | null> = getPendingPreorders(restaurantId).then(
    (pending) => pending,
    () => null,
  );

  // Throws on failure — the caller's cache keeps the previous board.
  const entries = await entriesPromise;
  const prior = lastGoodSides.get(restaurantId);
  const freeTables = (await freeTablesPromise) ?? prior?.freeTables ?? [];
  const pending = (await pendingPromise) ?? prior?.pending ?? [];
  lastGoodSides.set(restaurantId, { pending, freeTables });
  return { entries, pending, freeTables };
}
