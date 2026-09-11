// WHEN THE WEB IS A RELEASE AHEAD OF THE API.
//
// ============================================================================
// THIS IS NOT HYPOTHETICAL — IT HAPPENED ON THE RELEASE THIS SHIPPED IN
// ============================================================================
// The dashboard and the backend deploy on separate pipelines. The backend's
// gate refuses to ship ANY commit while a migration is pending, which is right
// (code must never land ahead of its migration) — and the box's `rd-entry` has
// no `migrate` verb, so that gate can hold for as long as it takes a human with
// root to apply the SQL by hand.
//
// The dashboard's pipeline has no such gate. So the web shipped the "86 a dish"
// sidebar and the rename-bill dialog while the API that serves
// `PATCH /menu/:id/availability` and `POST /bills/customer-name` was still the
// previous build. A live restaurant would have had two buttons that 404 during
// service.
//
// ============================================================================
// THE RULE, AND WHY IT IS `answered` AND NOT `can`
// ============================================================================
// `can()` is the right question for AUTHORISATION: it asks the server's flag and
// falls back to the action set, so a session stored by an older release still
// works. It is the WRONG question for AVAILABILITY, because the fallback asks a
// list an admin satisfies with "*" — so the button appears against a backend
// that has never heard of the route.
//
// `answered()` returns the flag or `undefined`. A capability flag only exists in
// `scope` when the backend that serves the route is running, so requiring it
// explicitly makes a control appear at exactly the moment its route does, and
// vanish again on a rollback. No version number to maintain anywhere.

import { canEditDishAvailability, can, answered, type ScopedSession } from "../session-scope";

const EDIT_MENU = "ed800655-b937-44ba-a7ca-7458295886c9";


/** A session from the CURRENT backend: the flag is present. */
const current = (edit_menu: boolean): ScopedSession => ({
  scope: { waiter_only: false, edit_menu },
  actions_set: ["*"],
});

/** A session from a backend that predates the capability: no flag at all. */
const older: ScopedSession = {
  scope: { waiter_only: false },
  actions_set: ["*"],
};

describe("a control whose route may not exist yet", () => {
  it("is OFFERED when the server says yes", () => {
    expect(canEditDishAvailability(current(true))).toBe(true);
  });

  it("is WITHHELD when the server says no", () => {
    expect(canEditDishAvailability(current(false))).toBe(false);
  });

  it("THE RULE: it is withheld when the server said NOTHING, even for an admin", () => {
    // This is the case that matters. The action set holds "*", so the
    // authorisation question answers yes — and the route still 404s.
    expect(can(older, "edit_menu")).toBe(true);
    expect(canEditDishAvailability(older)).toBe(false);
  });

  it("is withheld when there is no scope block at all", () => {
    expect(canEditDishAvailability({ actions_set: ["*"] })).toBe(false);
    expect(canEditDishAvailability({})).toBe(false);
    expect(canEditDishAvailability(null)).toBe(false);
    expect(canEditDishAvailability(undefined)).toBe(false);
  });

  it("comes BACK on its own once the backend catches up", () => {
    // Self-healing in both directions: no build flag, no version compare.
    expect(canEditDishAvailability(older)).toBe(false);
    expect(canEditDishAvailability(current(true))).toBe(true);
  });
});

describe("answered() and can() ask different questions", () => {
  it("answered is undefined when the server sent no flag", () => {
    expect(answered(older, "edit_menu")).toBeUndefined();
  });

  it("answered is the server's boolean when it did", () => {
    expect(answered(current(true), "edit_menu")).toBe(true);
    expect(answered(current(false), "edit_menu")).toBe(false);
  });

  it("can still falls back for AUTHORISATION, which is its job", () => {
    // A session stored by an older release must keep working. That is exactly
    // why `can` has a fallback and why availability must not use it.
    expect(can({ actions_set: [EDIT_MENU] }, "edit_menu")).toBe(true);
    expect(can({ actions_set: [] }, "edit_menu")).toBe(false);
  });

  it("and the server's NO always beats the action set", () => {
    // The direction that matters for a revoked capability: an admin's "*" must
    // not override an explicit refusal.
    expect(can({ scope: { waiter_only: false, edit_menu: false }, actions_set: ["*"] }, "edit_menu")).toBe(false);
  });
});
