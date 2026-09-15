/*
  THE "ADD NEW ORDER" DRAFT — the lines a waiter has picked but not yet sent.

  Client item 5: "There should be a view order button next to the send order
  button so that the order can be viewed and repeated to the guest and only then
  can the order be sent to the kitchen." The dialog already kept these lines, but
  under the form at the foot of a scrolling dialog, with no way to change a
  quantity. "View order" now opens a review of them, and every rule about what a
  line IS lives here, pure, so the review, the pending list and the send cannot
  each grow their own idea of it.

  Mirrors the owner app's lib/models/order_draft.dart, down to the read-out's
  words ("4 items · 3 dishes"), so a waiter moving between the phone and the
  dashboard is told the same thing about the same order.
*/

export interface DraftLine {
  id?: string;
  name: string;
  price: number;
  quantity: number;
  note?: string | null;
  course_hold?: boolean;
  variation_id?: string;
  variation_label?: string;
}

/**
 * What makes two picks THE SAME LINE: the dish (case-insensitively), its note,
 * whether the course is held, and its size.
 *
 * Every one of those is load-bearing. Half and Full are different prices; a held
 * course and a fired one are different tickets; "no onions" and no note are
 * different plates. Encoded as a JSON tuple rather than a joined string so a
 * note containing the separator cannot make two different lines collide.
 */
export const draftLineKey = (line: Pick<DraftLine, "name" | "note" | "course_hold" | "variation_id">): string =>
  JSON.stringify([
    line.name.toLowerCase(),
    line.note ?? "",
    Boolean(line.course_hold),
    line.variation_id ?? "",
  ]);

/** Adds a pick: the same line gains the quantity, anything else is a new line at the end. */
export const mergeDraftLine = (lines: readonly DraftLine[], incoming: DraftLine): DraftLine[] => {
  const key = draftLineKey(incoming);
  if (lines.some((l) => draftLineKey(l) === key)) {
    return lines.map((l) => (draftLineKey(l) === key ? { ...l, quantity: l.quantity + incoming.quantity } : l));
  }
  return [...lines, incoming];
};

/**
 * Takes out exactly ONE line.
 *
 * The form's old remove matched name, note and size but not the hold, so the X
 * on a held "Paneer Tikka" also took the un-held "Paneer Tikka" beside it — two
 * lines gone for one click, and the second one silently. Matching on the same
 * key the merge uses is what makes add and remove agree about what a line is.
 */
export const removeDraftLine = (lines: readonly DraftLine[], key: string): DraftLine[] =>
  lines.filter((l) => draftLineKey(l) !== key);

/**
 * Sets one line's quantity. Zero or less takes the line out — a "0 × Paneer
 * Tikka" left on a ticket is a dish somebody will cook. A quantity that is not a
 * number changes nothing.
 */
export const setDraftQuantity = (lines: readonly DraftLine[], key: string, quantity: number): DraftLine[] => {
  if (!Number.isFinite(quantity)) { return [...lines]; }
  const qty = Math.floor(quantity);
  if (qty <= 0) { return removeDraftLine(lines, key); }
  return lines.map((l) => (draftLineKey(l) === key ? { ...l, quantity: qty } : l));
};

/** Plates, not lines: 2 × Naan and 1 × Dal is 3. */
export const draftItemCount = (lines: readonly Pick<DraftLine, "quantity">[]): number =>
  lines.reduce((sum, l) => sum + l.quantity, 0);

/** "4 items · 3 dishes" — the review's one-line read-out, worded as the owner app words it. */
export const draftSummary = (lines: readonly Pick<DraftLine, "quantity">[]): string => {
  const items = draftItemCount(lines);
  const dishes = lines.length;
  return `${String(items)} item${items === 1 ? "" : "s"} · ${String(dishes)} dish${dishes === 1 ? "" : "es"}`;
};

/**
 * The lines as the order POSTs them.
 *
 * `variation_label` is a label for THIS form and nothing else — the server stamps
 * its own from the live variation. Sending it would put a client-authored string
 * on a stored order line, which is exactly the kind of key that later gets read
 * as authoritative by something.
 */
export const toOrderItems = (lines: readonly DraftLine[]): Omit<DraftLine, "variation_label">[] =>
  lines.map(({ variation_label: _label, ...rest }) => rest);

/*
  ONE IDEMPOTENCY KEY PER LOGICAL SEND — the web half of the owner app's rule.

  POST /orders honours an Idempotency-Key (Restaurant_Backend/idempotency.ts): a
  repeat of a key it has already applied is answered with the stored response, or
  refused, and never applied twice. The logical write here is "send THIS draft to
  THIS table", so the key is minted for a draft and kept for as long as the draft
  is unchanged. Sending the identical draft again — the waiter saw no confirmation
  and tapped again — reuses it, and the server cannot make it a second order.
  Change a dish, a quantity, the table or the covers and it is a different order,
  with a fresh key.
*/

export interface DraftSendKey { signature: string; key: string }

/** What "the same draft" means: the table, the covers and the lines as sent. */
export const draftSignature = (tableId: number, covers: number | undefined, lines: readonly DraftLine[]): string =>
  JSON.stringify([tableId, covers ?? null, toOrderItems(lines)]);

/** The previous key when the draft is unchanged; otherwise a freshly minted one. */
export const keyForDraftSend = (
  previous: DraftSendKey | null,
  signature: string,
  mint: () => string,
): DraftSendKey => (previous?.signature === signature ? previous : { signature, key: mint() });

interface RandomSource { getRandomValues?: (array: Uint8Array) => Uint8Array }

/**
 * A new Idempotency-Key: 32 hex characters, inside the server's 8-200 printable
 * ASCII rule.
 *
 * NOT `crypto.randomUUID()`: that exists only in a secure context, and a till
 * that opens the dashboard over plain http on the shop's LAN address has none —
 * the send would throw before it left the tab. `getRandomValues` is available in
 * both. The Math.random fallback is only for a runtime with no Web Crypto at
 * all; it is weaker, but a collision still needs two sends from the same
 * restaurant, inside the server's 48-hour window, to draw the same 32 characters.
 */
export const newIdempotencyKey = (
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- a browser API here; jest's Node has it too.
  source: RandomSource | undefined = typeof crypto === "undefined" ? undefined : crypto,
): string => {
  const bytes = new Uint8Array(16);
  const fill = source?.getRandomValues;
  if (typeof fill === "function") {
    fill.call(source, bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) { bytes[i] = Math.floor(Math.random() * 256); }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
