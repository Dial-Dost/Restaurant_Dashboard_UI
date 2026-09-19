// Client-safe constants for the outlet switcher. Kept OUT of db.ts because that
// file is a "use server" module (Server Actions) and may only export async
// functions — a plain string const there is a build error in Next 16+.

/** localStorage key holding the admin-selected active outlet id (web switcher). */
export const SELECTED_OUTLET_KEY = 'selectedOutletId';

/**
 * Sentinel selection meaning "combine every outlet". Admins/managers get
 * aggregated READ-ONLY data across all branches; the backend rejects writes
 * while it is active. Same token the backend's ALL_OUTLETS_SENTINELS accepts.
 */
export const ALL_OUTLETS = 'all';

/** The selected outlet id from localStorage, or null on the server / when unset. */
export const getSelectedOutletId = (): string | null => {
  try {
    if (typeof window === 'undefined') {return null;}
    return window.localStorage.getItem(SELECTED_OUTLET_KEY);
  } catch {
    return null;
  }
};

/** Fired on window after an IN-PLACE outlet switch, detail = the new id. */
export const OUTLET_CHANGED_EVENT = 'outlet:changed';

/**
 * The in-place half of setSelectedOutlet: persist the choice (localStorage AND
 * the server cookie the "use server" data layer reads) and announce it —
 * WITHOUT a reload. The shell listens for OUTLET_CHANGED_EVENT and refreshes
 * the current module in place (router.refresh + a remount key), which is the
 * Flutter `_selectOutlet` behaviour: the user stays exactly where they were.
 *
 * The cookie write is awaited so the very first request after the announce
 * already carries the new scope.
 */
export const applySelectedOutlet = async (id: string | null): Promise<void> => {
  try {
    if (id) {
      window.localStorage.setItem(SELECTED_OUTLET_KEY, id);
    } else {
      window.localStorage.removeItem(SELECTED_OUTLET_KEY);
    }
  } catch { /* private mode — the cookie below still carries the choice */ }

  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedOutletId: id }),
      cache: 'no-store',
    });
  } catch { /* offline: the next request just keeps the previous scope */ }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(OUTLET_CHANGED_EVENT, { detail: id }));
    } catch { /* non-browser */ }
  }
};

/**
 * Persist the switcher's choice BOTH client-side and server-side, then reload.
 *
 * The server-side half matters: every data accessor lives in db.ts, which is a
 * "use server" module, so its `X-Outlet-Id` header is assembled on the server
 * where `localStorage` does not exist. Without mirroring the choice into a
 * cookie the selection was silently ignored and every request kept using the
 * outlet baked into the login session — which is exactly how staff ended up
 * staring at an orders grid they could not explain.
 *
 * Pass null to clear the override and fall back to the session's home outlet.
 * Awaits the cookie write before reloading so the very first request after the
 * reload already carries the new scope.
 */
export const setSelectedOutlet = async (id: string | null): Promise<void> => {
  await applySelectedOutlet(id);
  if (typeof window !== 'undefined') {window.location.reload();}
};
