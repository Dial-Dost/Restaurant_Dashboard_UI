// Client-safe constants for the outlet switcher. Kept OUT of db.ts because that
// file is a "use server" module (Server Actions) and may only export async
// functions — a plain string const there is a build error in Next 16+.

/** localStorage key holding the admin-selected active outlet id (web switcher). */
export const SELECTED_OUTLET_KEY = 'selectedOutletId';

/** The selected outlet id from localStorage, or null on the server / when unset. */
export const getSelectedOutletId = (): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(SELECTED_OUTLET_KEY);
  } catch {
    return null;
  }
};
