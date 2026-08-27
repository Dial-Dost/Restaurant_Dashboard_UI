import type { TableAssignmentOutcome } from "@/lib/db";

/**
 * True when a seating left the table with nobody serving it. Shared so the
 * tables page and the queue page cannot drift on what counts as "unattended".
 *
 * It lives HERE rather than in lib/db.ts because that file is a Next
 * `"use server"` module: such a module may export nothing but async functions,
 * and a plain `export const` in one is a COMPILE error that takes the entire
 * dashboard down — not a type error, so `tsc --noEmit` and jest both pass while
 * every page 500s. (The type import above is erased at compile time, so it does
 * not drag the server module into a client bundle.)
 */
export const seatingLeftTableUnattended = (a: TableAssignmentOutcome | null | undefined): boolean =>
    !!a && !a.assigned && !a.employee_id;
