// The pure decision logic behind the operator console's two new tenant-lifecycle
// controls — "Add restaurant" and "Archive" (src/app/platform/page.tsx).
//
// It lives here rather than beside the component for the same reason
// report-schedule-actions.ts does: this project's jest config is
// `testEnvironment: 'node'` with `roots: ['<rootDir>/src/lib']` and no DOM
// renderer installed, so a React component cannot be mounted and the logic that
// has to be right has to be reachable without one. Two things have to be right:
//
//   * the slug this page sends must be byte-identical to the one the backend
//     would have derived itself. POST /platform/restaurants answers 400 when a
//     supplied res_username changes under the backend's own normalizer, so a
//     client normalizer that drifts from it turns ordinary names into a rejection
//     the operator cannot act on.
//   * the archive confirmation gate. Archiving is reversible, but it signs out
//     every staff session and cancels the subscription, so a mis-click on the
//     wrong row takes a live restaurant offline mid-service — with an open bill
//     stranded on an occupied table and nobody able to log in and settle it. This
//     gate is the only thing standing between a stray click and that.

import type { CreateRestaurantInput } from "./platform";

/**
 * Mirror of the backend's normalizeRestaurantSlug (Restaurant_Backend/provisioning.ts):
 * lowercase, then strip everything that is not a lowercase letter or digit.
 *
 * Keep these two identical. The result is written to "Restaurant".res_username,
 * which carries a UNIQUE constraint and is baked into every printed QR URL and
 * feedback link — it is effectively permanent, and nothing in the platform renames
 * it. "The Rustic Fork" and "Rustic-Fork!" both collapse to "therusticfork", which
 * is exactly why the operator gets to edit the slug instead of the backend
 * silently deriving a colliding one.
 */
export function normalizeRestaurantSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The "Add restaurant" modal's fields, all raw and untrimmed as typed. */
export interface CreateRestaurantForm {
  resName: string;
  /** Already normalized — the input normalizes on every keystroke. */
  resUsername: string;
  ownerName: string;
  ownerUsername: string;
  /** "" means no plan sold yet; the backend then starts a trial. */
  planId: string;
  address: string;
  phone: string;
  email: string;
}

export const EMPTY_CREATE_RESTAURANT_FORM: CreateRestaurantForm = {
  resName: "",
  resUsername: "",
  ownerName: "",
  ownerUsername: "",
  planId: "",
  address: "",
  phone: "",
  email: "",
};

/** The backend's own limit on res_name / owner_name / owner_username. */
const MAX_FIELD_LENGTH = 120;

/**
 * The slug that will actually be sent: whatever the operator typed, or one
 * derived from the display name while they have not touched that field.
 */
function buildSlug(form: CreateRestaurantForm): string {
  const typed = normalizeRestaurantSlug(form.resUsername);
  return typed || normalizeRestaurantSlug(form.resName);
}

/**
 * The same three checks POST /platform/restaurants makes, run before the
 * round-trip so the operator sees them next to the field rather than as a banner.
 * Returns the message to show, or null when the form is sendable.
 *
 * This is a convenience, NOT the guard — the backend re-checks all of it, and
 * only the backend can know whether the slug is taken.
 */
export function validateCreateRestaurant(form: CreateRestaurantForm): string | null {
  const resName = form.resName.trim();
  const ownerName = form.ownerName.trim();
  const ownerUsername = form.ownerUsername.trim();

  if (!resName || !ownerName || !ownerUsername) {
    return "Restaurant name, owner name and owner username are all required.";
  }
  if (
    resName.length > MAX_FIELD_LENGTH ||
    ownerName.length > MAX_FIELD_LENGTH ||
    ownerUsername.length > MAX_FIELD_LENGTH
  ) {
    return `Restaurant name, owner name and owner username must be ${String(MAX_FIELD_LENGTH)} characters or fewer.`;
  }
  // The slug field is normalized as it is typed, so this only fires when the name
  // itself has no letters or digits to derive one from (e.g. "!!!").
  if (!buildSlug(form)) {
    return "The restaurant ID must contain at least one letter or number.";
  }
  return null;
}

/**
 * Trim, normalize the slug once more, and drop every optional field left blank —
 * the backend treats "" as absent anyway, and sending empty strings would write
 * blank contact details over nothing useful.
 */
export function buildCreateRestaurantBody(form: CreateRestaurantForm): CreateRestaurantInput {
  const address = form.address.trim();
  const phone = form.phone.trim();
  const email = form.email.trim();
  const planId = form.planId.trim();

  return {
    res_name: form.resName.trim(),
    res_username: buildSlug(form),
    owner_name: form.ownerName.trim(),
    owner_username: form.ownerUsername.trim(),
    ...(planId ? { plan_id: planId } : {}),
    ...(address ? { address } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  };
}

/** Trim, collapse runs of whitespace, lowercase. */
function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Has the operator typed this restaurant's name into the archive confirmation
 * box? Nothing else may enable the Archive button.
 *
 * Whitespace is collapsed and case is ignored: the operator is being asked to
 * prove they read the row they clicked, not to reproduce the capitalisation of
 * "THE Rustic Fork". Everything else must match, so the name of a *different*
 * row never unlocks this one.
 *
 * A restaurant with a blank name can never be confirmed — otherwise an untouched,
 * empty box would satisfy the gate, which is precisely the mis-click this exists
 * to stop.
 */
export function archiveConfirmationMatches(typed: string, restaurantName: string): boolean {
  const expected = collapse(restaurantName);
  return expected.length > 0 && collapse(typed) === expected;
}

/**
 * The backend's own sentence, not a generic one.
 *
 * platformFetch throws `new Error(payload.error)`, so the message already carries
 * answers the operator has to act on — "The slug "joespizza" is already taken.
 * Choose a different res_username." is a different instruction from "Failed to
 * create restaurant", and only one of them tells them what to do next.
 */
export function describePlatformError(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return fallback;
}
