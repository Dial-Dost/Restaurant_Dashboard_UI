// The unsent order: where it is filed, what is kept, and when it is dropped.

import {
  DRAFT_MAX_AGE_MS,
  clearPadDraft,
  draftCartCount,
  draftIsFresh,
  draftStoreKey,
  draftWorthKeeping,
  parseDraftSnapshot,
  readPadDraft,
  restoredDraftNote,
  writePadDraft,
  type PadDraftSnapshot,
} from "@/lib/order-draft-store";
import { EMPTY_DRAFT } from "@/lib/api/order-entry";

/** A Storage the tests can hold in hand — jest runs in node, with no browser. */
const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length(): number { return map.size; },
    clear: (): void => { map.clear(); },
    getItem: (k: string): string | null => map.get(k) ?? null,
    key: (i: number): string | null => [...map.keys()][i] ?? null,
    removeItem: (k: string): void => { map.delete(k); },
    setItem: (k: string, v: string): void => { map.set(k, v); },
  };
};

const snapshot = (over: Partial<PadDraftSnapshot> = {}): PadDraftSnapshot => ({
  draft: { ...EMPTY_DRAFT, cart: { dosa: 2 }, knownNames: { dosa: "Masala Dosa" } },
  kitchenNote: "",
  customer: "",
  phone: "",
  address: "",
  savedAt: 1_700_000_000_000,
  ...over,
});

describe("where a draft is filed", () => {
  it("keys one draft per restaurant and target", () => {
    expect(draftStoreKey("Parity", { kind: "dine", table: "T4" })).toBe("order-pad-draft:parity:dine:t4");
    expect(draftStoreKey("parity", { kind: "dine", table: " t4 " })).toBe("order-pad-draft:parity:dine:t4");
    expect(draftStoreKey("parity", { kind: "takeaway" })).toBe("order-pad-draft:parity:takeaway");
    expect(draftStoreKey("parity", { kind: "delivery" })).toBe("order-pad-draft:parity:delivery");
  });

  it("never lets one table's cart answer for another's", () => {
    expect(draftStoreKey("parity", { kind: "dine", table: "4" }))
      .not.toBe(draftStoreKey("parity", { kind: "dine", table: "4 #2" }));
  });
});

describe("what is worth keeping", () => {
  it("counts the items in the cart", () => {
    expect(draftCartCount({ ...EMPTY_DRAFT, cart: { a: 2, b: 3 } })).toBe(5);
    expect(draftCartCount({ ...EMPTY_DRAFT, cart: { a: 0, b: -1 } })).toBe(0);
    expect(draftCartCount(null)).toBe(0);
  });

  it("keeps a typed-in customer even before a dish is chosen", () => {
    const empty = snapshot({ draft: EMPTY_DRAFT });
    expect(draftWorthKeeping(empty)).toBe(false);
    expect(draftWorthKeeping({ ...empty, phone: "9876543210" })).toBe(true);
    expect(draftWorthKeeping({ ...empty, kitchenNote: "  " })).toBe(false);
  });
});

describe("how old is too old", () => {
  const now = 1_700_000_000_000;
  it("keeps a draft inside the window and drops one outside it", () => {
    expect(draftIsFresh(now - 1000, now)).toBe(true);
    expect(draftIsFresh(now - DRAFT_MAX_AGE_MS + 1000, now)).toBe(true);
    expect(draftIsFresh(now - DRAFT_MAX_AGE_MS - 1000, now)).toBe(false);
  });

  it("tolerates a device clock a minute fast, not an hour", () => {
    expect(draftIsFresh(now + 30_000, now)).toBe(true);
    expect(draftIsFresh(now + 3_600_000, now)).toBe(false);
    expect(draftIsFresh("yesterday", now)).toBe(false);
  });
});

describe("reading back what was written", () => {
  it("refuses anything this module did not write", () => {
    expect(parseDraftSnapshot(null)).toBeNull();
    expect(parseDraftSnapshot("not json")).toBeNull();
    expect(parseDraftSnapshot("[]")).toBeNull();
    expect(parseDraftSnapshot('{"savedAt":1}')).toBeNull();
  });

  it("drops values of the wrong type instead of restoring them", () => {
    const raw = JSON.stringify({
      draft: { cart: { dosa: 2, idli: "3" }, notes: { dosa: "no onion", idli: 5 } },
      savedAt: Date.now(),
      kitchenNote: 7,
    });
    const back = parseDraftSnapshot(raw);
    expect(back?.draft.cart).toEqual({ dosa: 2 });
    expect(back?.draft.notes).toEqual({ dosa: "no onion" });
    expect(back?.kitchenNote).toBe("");
  });

  it("round-trips a real cart through storage", () => {
    const store = memoryStorage();
    const key = draftStoreKey("parity", { kind: "dine", table: "7" });
    writePadDraft(key, snapshot({ savedAt: Date.now(), kitchenNote: "no chilli" }), store);
    const back = readPadDraft(key, Date.now(), store);
    expect(back?.draft.cart).toEqual({ dosa: 2 });
    expect(back?.kitchenNote).toBe("no chilli");
  });

  it("deletes a draft rather than storing an empty one", () => {
    const store = memoryStorage();
    const key = draftStoreKey("parity", { kind: "takeaway" });
    writePadDraft(key, snapshot({ savedAt: Date.now() }), store);
    writePadDraft(key, snapshot({ draft: EMPTY_DRAFT, savedAt: Date.now() }), store);
    expect(store.getItem(key)).toBeNull();
  });

  it("clears a stale record on the read that refuses it", () => {
    const store = memoryStorage();
    const key = draftStoreKey("parity", { kind: "dine", table: "9" });
    const long = Date.now() - DRAFT_MAX_AGE_MS - 1;
    writePadDraft(key, snapshot({ savedAt: long }), store);
    expect(readPadDraft(key, Date.now(), store)).toBeNull();
    expect(store.getItem(key)).toBeNull();
  });

  it("is silent when there is no storage at all", () => {
    const key = draftStoreKey("parity", { kind: "delivery" });
    expect(readPadDraft(key, Date.now(), null)).toBeNull();
    expect(() => { writePadDraft(key, snapshot(), null); }).not.toThrow();
    expect(() => { clearPadDraft(key, null); }).not.toThrow();
  });
});

describe("what the strip says", () => {
  it("names the count and the time it was last touched", () => {
    const at = new Date("2026-09-17T15:35:00Z").getTime();
    expect(restoredDraftNote(1, at, "en-GB")).toMatch(/^Unsent 1 item from \d{2}:\d{2}$/);
    expect(restoredDraftNote(3, at, "en-GB")).toMatch(/^Unsent 3 items from \d{2}:\d{2}$/);
    expect(restoredDraftNote(2, Number.NaN)).toBe("Unsent 2 items from earlier");
  });
});
