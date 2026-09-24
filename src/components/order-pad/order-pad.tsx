"use client";

// THE STAFF ORDER PAD — the web `OrderEntryScreen` (restaurant_owner_app
// lib/screens/order_entry.dart; spec docs/parity/order-entry.md).
//
// A full-screen surface over whatever opened it (the table sheet, the Orders
// page, the Takeaway / Delivery picker). Column order is Flutter's: a sticky
// header block (printed-bill strip → running-bill/APC strip → search → order
// fields → refusal → send bar), capped at 55% of the body with its own scroll,
// above the whole priced menu grouped by category.
//
// Send contract:
//   • covers are asked ONLY when this send occupies the table (occupyOnSend —
//     a free table opened by a reader with no seating control, or a retarget to
//     the server's next-party seat); occupy first, order second;
//   • `sending` locks the button, the review and every menu control;
//   • a 423 `bill_printed` keeps the cart and shows the server's sentence with
//     its "Take it on …" / "Add to …'s printed bill" actions;
//   • an unreachable server queues the write in the outbox and SAYS SO — never
//     a fake success; any other refusal stays on the pad with the cart intact.

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Armchair, Loader2, Receipt, RotateCcw, TriangleAlert, X } from "lucide-react";

import { AppSearchField } from "@/components/ui/app-search-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useFloorInks } from "@/components/tables/floor-chips";
import { showsMoney as sessionShowsMoney } from "@/lib/session-scope";
import { mobile10Error, normalizeMobile10, sanitizePhoneInput, PHONE_INPUT_PROPS } from "@/lib/phone";
import { announceReprintNeeded, readReprintNeeded } from "@/lib/reprint-needed";
import { tableSentenceName, ADD_TO_PRINTED_BILL_KEY } from "@/lib/api/tables-floor";
import { barkOutcomeMessage } from "@/lib/api/orders";
import {
  EMPTY_DRAFT,
  OrderEntryError,
  addingToPrintedBillStrip,
  draftBlock,
  draftItemCount,
  draftLines,
  draftPayload,
  draftTotal,
  fetchPadMenu,
  fetchTableBill,
  linkOrderToTable,
  occupyForOrder,
  parseBillPrintedRefusal,
  postDineInOrder,
  postTakeawayOrder,
  type BillPrintedRefusal,
  type DraftState,
  type PadMenu,
  type PadMenuItem,
  type TableBill,
  type WriteOutcome,
} from "@/lib/api/order-entry";
import {
  clearPadDraft,
  draftCartCount,
  draftStoreKey,
  readPadDraft,
  restoredDraftNote,
  writePadDraft,
  type PadDraftSnapshot,
} from "@/lib/order-draft-store";
import { LineControls } from "./line-controls";
import { ReviewSheet } from "./review-sheet";
import { TableApcStrip } from "./table-apc-strip";
import { TableBillSheet } from "./table-bill-sheet";

/** What opened the pad. */
export type OrderPadRequest =
  | {
      kind: "dine";
      table: string;
      /** The root table when `table` is a next-party seat (sentence naming). */
      parentTable?: string | null;
      /** Finding 4 — "occupancy follows the order": the send seats the table. */
      occupyOnSend?: boolean;
      /** Finding 27 — opened from the table sheet's "Add to printed bill". */
      addToPrintedBill?: boolean;
    }
  | { kind: "takeaway" | "delivery" };

export interface OrderPadProps {
  request: OrderPadRequest;
  restaurantId: string;
  onClose: () => void;
  /** After a send (or an honest queue) — reload whatever opened the pad. */
  onSent?: () => void;
}

const STANDARD_SIZE = "__standard__";

/** A copy of `rec` without `key` (no dynamic `delete`). */
const omit = <T,>(rec: Partial<Record<string, T>>, key: string): Partial<Record<string, T>> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

export function OrderPad({ request, restaurantId, onClose, onSent }: OrderPadProps): React.JSX.Element {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { toast } = useToast();
  const moneyShows = sessionShowsMoney(user);
  const printedInk = useFloorInks().printed;
  const isDineIn = request.kind === "dine";
  const isDelivery = request.kind === "delivery";

  const money = React.useCallback((raw: unknown): string => {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && raw !== null && raw !== undefined && raw !== "" ? `${currencySymbol}${n.toFixed(2)}` : "—";
  }, [currencySymbol]);

  /* ── Menu ───────────────────────────────────────────────────────────── */

  const menu = useCachedFetch<PadMenu>(
    `order-pad-menu:${restaurantId}`,
    () => fetchPadMenu(restaurantId),
    { enabled: restaurantId !== "" },
  );
  const itemsById = React.useMemo(() => new Map((menu.data?.items ?? []).map((m) => [m.id, m])), [menu.data]);
  const variationsById = React.useMemo(() => new Map((menu.data?.variations ?? []).map((v) => [v.id, v])), [menu.data]);
  const variationsByMenu = React.useMemo(() => {
    const map = new Map<string, NonNullable<PadMenu["variations"]>>();
    for (const v of menu.data?.variations ?? []) {
      const list = map.get(v.menu_id);
      if (list) { list.push(v); } else { map.set(v.menu_id, [v]); }
    }
    return map;
  }, [menu.data]);

  /* ── Draft + fields ─────────────────────────────────────────────────── */

  /*
    THE CART IS KEPT ON THIS DEVICE WHILE IT IS BEING BUILT.

    Closing the pad — the X, Escape, a mis-aimed tap, or the party not being
    seated yet — used to throw the whole order away, which is the behaviour the
    client reported. `lib/order-draft-store.ts` holds the rules (one draft per
    table, twelve hours, silent on any storage failure); this is the wiring.

    The key is built from the target the pad was OPENED for, deliberately not
    from `retarget`: taking the same cart onto the server's next-party seat is
    one order being finished, not a second draft being started.
  */
  const storageKey = React.useMemo(
    () => draftStoreKey(restaurantId, request.kind === "dine" ? { kind: "dine", table: request.table } : { kind: request.kind }),
    [restaurantId, request],
  );
  // Read ONCE, during the first render for this mount: an effect would run after
  // the save effect below had already written the empty cart over the draft.
  const [firstDraft] = React.useState<PadDraftSnapshot | null>(() => readPadDraft(storageKey));

  const [draft, setDraft] = React.useState<DraftState>(() => firstDraft?.draft ?? EMPTY_DRAFT);
  const [query, setQuery] = React.useState("");
  const [kitchenNote, setKitchenNote] = React.useState(() => firstDraft?.kitchenNote ?? "");
  const [customer, setCustomer] = React.useState(() => firstDraft?.customer ?? "");
  const [phone, setPhone] = React.useState(() => firstDraft?.phone ?? "");
  const [address, setAddress] = React.useState(() => firstDraft?.address ?? "");
  // What the strip above the menu says it brought back, until it is dismissed.
  const [restored, setRestored] = React.useState<string | null>(
    () => (firstDraft === null ? null : restoredDraftNote(draftCartCount(firstDraft.draft), firstDraft.savedAt)),
  );
  /*
    WHICH TARGET THE FIELDS ABOVE ARE CURRENTLY HOLDING.

    State, not a ref, and that is the point: while it disagrees with
    `storageKey` the save effect stands down, so the commit in which the pad is
    re-pointed at another table cannot file the previous table's cart under the
    new table's key. The re-hydrate effect below is what makes them agree again.
  */
  const [loadedKey, setLoadedKey] = React.useState(storageKey);

  React.useEffect(() => {
    if (loadedKey === storageKey) { return; }
    const next = readPadDraft(storageKey);
    setDraft(next?.draft ?? EMPTY_DRAFT);
    setKitchenNote(next?.kitchenNote ?? "");
    setCustomer(next?.customer ?? "");
    setPhone(next?.phone ?? "");
    setAddress(next?.address ?? "");
    setRestored(next === null ? null : restoredDraftNote(draftCartCount(next.draft), next.savedAt));
    setLoadedKey(storageKey);
  }, [loadedKey, storageKey]);

  React.useEffect(() => {
    if (loadedKey !== storageKey) { return; }
    writePadDraft(storageKey, { draft, kitchenNote, customer, phone, address, savedAt: Date.now() });
  }, [loadedKey, storageKey, draft, kitchenNote, customer, phone, address]);

  /** Nothing is unsent any more — drop the draft so it cannot be offered twice. */
  const forgetDraft = React.useCallback((): void => {
    clearPadDraft(storageKey);
    setRestored(null);
  }, [storageKey]);

  const startFresh = React.useCallback((): void => {
    setDraft(EMPTY_DRAFT);
    setKitchenNote("");
    setCustomer("");
    setPhone("");
    setAddress("");
    forgetDraft();
  }, [forgetDraft]);

  const [sending, setSending] = React.useState(false);
  const sendingRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refusal, setRefusal] = React.useState<BillPrintedRefusal | null>(null);
  const refusalRef = React.useRef<HTMLDivElement | null>(null);

  // Finding 25 — the server-named next-party seat the SAME cart moved to.
  const [retarget, setRetarget] = React.useState<string | null>(null);
  // Finding 26/27 — the reader chose to add to the printed bill.
  const [confirmedPrinted, setConfirmedPrinted] = React.useState(request.kind === "dine" && request.addToPrintedBill === true);

  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [billOpen, setBillOpen] = React.useState(false);
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [noteText, setNoteText] = React.useState("");
  const [coversText, setCoversText] = React.useState("2");
  const coversResolve = React.useRef<((n: number | null) => void) | null>(null);
  const [coversOpen, setCoversOpen] = React.useState(false);

  const table = request.kind === "dine" ? (retarget ?? request.table) : null;
  const parentTable = request.kind === "dine" && retarget === null ? request.parentTable ?? null : null;
  const tableLabel = table !== null ? tableSentenceName(table, parentTable) : "";
  const addsToPrinted = confirmedPrinted && retarget === null && isDineIn;

  const title = isDineIn ? `New order · ${tableLabel}` : isDelivery ? "New delivery" : "New takeaway";
  const reviewTitle = isDineIn ? tableLabel : isDelivery ? "Delivery" : "Takeaway";

  const lines = React.useMemo(() => draftLines(draft, itemsById, variationsById), [draft, itemsById, variationsById]);
  const count = draftItemCount(lines);
  const total = draftTotal(lines);
  const phoneError = isDineIn ? null : mobile10Error(phone, false);
  const block = draftBlock(lines, phoneError);

  /* ── The table's running bill (dine-in; deliberately never cache-primed) ─ */

  const [bill, setBill] = React.useState<TableBill | null>(null);
  const [billLoading, setBillLoading] = React.useState(false);
  const [billError, setBillError] = React.useState<unknown>(null);
  const billSeq = React.useRef(0);
  const loadBill = React.useCallback((): void => {
    if (table === null || restaurantId === "") { return; }
    const seq = ++billSeq.current;
    setBillLoading(true);
    setBillError(null);
    fetchTableBill(restaurantId, table)
      .then((b) => { if (seq === billSeq.current) { setBill(b); } })
      .catch((e: unknown) => { if (seq === billSeq.current) { setBillError(e); } })
      .finally(() => { if (seq === billSeq.current) { setBillLoading(false); } });
  }, [restaurantId, table]);
  React.useEffect(() => { setBill(null); loadBill(); }, [loadBill]);

  /* ── Draft edits (every one refused while a send is in flight) ─────── */

  const step = React.useCallback((id: string, delta: number): void => {
    if (sendingRef.current) { return; }
    setDraft((d) => {
      const next = Math.max(0, (d.cart[id] ?? 0) + delta);
      const known = itemsById.get(id)?.name ?? d.knownNames[id];
      if (next === 0) {
        return {
          cart: omit(d.cart, id),
          held: omit(d.held, id),
          notes: omit(d.notes, id),
          sizes: omit(d.sizes, id),
          knownNames: omit(d.knownNames, id),
        };
      }
      return { ...d, cart: { ...d.cart, [id]: next }, knownNames: known ? { ...d.knownNames, [id]: known } : d.knownNames };
    });
    setError(null);
  }, [itemsById]);

  const removeLine = (id: string): void => { step(id, -Number.MAX_SAFE_INTEGER); };

  const toggleHold = (id: string): void => {
    if (sendingRef.current) { return; }
    setDraft((d) => ({ ...d, held: { ...d.held, [id]: !d.held[id] } }));
  };

  const setSize = (id: string, variationId: string): void => {
    if (sendingRef.current) { return; }
    setDraft((d) => ({
      ...d,
      sizes: variationId === STANDARD_SIZE ? omit(d.sizes, id) : { ...d.sizes, [id]: variationId },
    }));
  };

  const openNote = (id: string): void => {
    if (sendingRef.current) { return; }
    setNoteText(draft.notes[id] ?? "");
    setNoteFor(id);
  };
  const saveNote = (): void => {
    if (noteFor === null) { return; }
    const id = noteFor;
    const text = noteText.trim();
    setDraft((d) => ({ ...d, notes: text === "" ? omit(d.notes, id) : { ...d.notes, [id]: text } }));
    setNoteFor(null);
  };

  // Emptying the order closes the review.
  React.useEffect(() => { if (lines.length === 0) { setReviewOpen(false); } }, [lines.length]);

  // Surface the refusal sentence the moment it lands (Flutter ensureVisible).
  React.useEffect(() => {
    if (refusal !== null) { refusalRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }, [refusal]);

  /* ── Covers (only when this send seats the table) ───────────────────── */

  const askCovers = (): Promise<number | null> => new Promise((resolve) => {
    setCoversText("2");
    coversResolve.current = resolve;
    setCoversOpen(true);
  });
  const finishCovers = (n: number | null): void => {
    setCoversOpen(false);
    const r = coversResolve.current;
    coversResolve.current = null;
    r?.(n === null ? null : Math.max(1, n));
  };

  /* ── Send ───────────────────────────────────────────────────────────── */

  const send = async (override?: { retarget?: string; confirmedPrinted?: boolean }): Promise<void> => {
    if (sendingRef.current) { return; }
    const effRetarget = override?.retarget ?? retarget;
    const effConfirmed = override?.confirmedPrinted ?? confirmedPrinted;
    const effTable = request.kind === "dine" ? (effRetarget ?? request.table) : null;
    const occupyOnSend = request.kind === "dine"
      && (request.occupyOnSend === true || effRetarget !== null)
      && (effTable ?? "").trim() !== "";
    const effAddsToPrinted = effConfirmed && effRetarget === null && isDineIn;

    const blocked = draftBlock(lines, phoneError);
    if (blocked !== null) {
      setError(blocked);
      if (phoneError === null && lines.length > 0) { setReviewOpen(true); }
      return;
    }
    let covers: number | null = null;
    if (occupyOnSend) {
      covers = await askCovers();
      if (covers === null) { return; }
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    setRefusal(null);

    const base: Record<string, unknown> = {
      items: draftPayload(lines),
      subtotal: total,
      total,
      taxes: [],
      applyServiceCharge: false,
      status: "Preparing",
      ...(kitchenNote.trim() !== "" ? { note: kitchenNote.trim() } : {}),
      taken_by_employee_id: user?.employeeId ?? null,
      taken_by_employee_name: user?.emp_Fname ?? null,
      taken_by_employee_role: user?.role ?? null,
    };
    const dishes = lines.map((l) => `${String(l.quantity)}× ${l.name}`).join(", ");
    try {
      let outcome: WriteOutcome;
      let occupyQueued = false;
      if (occupyOnSend && covers !== null && effTable !== null) {
        const occ = await occupyForOrder(restaurantId, effTable, covers);
        occupyQueued = occ.kind === "queued";
      }
      if (request.kind === "dine" && effTable !== null) {
        outcome = await postDineInOrder(
          restaurantId,
          { ...base, table: effTable, ...(effAddsToPrinted ? { [ADD_TO_PRINTED_BILL_KEY]: true } : {}) },
          `Order for Table ${tableSentenceName(effTable)} (${dishes})`,
          effTable,
          occupyQueued,
        );
      } else {
        const normalized = normalizeMobile10(phone);
        outcome = await postTakeawayOrder(
          restaurantId,
          {
            ...base,
            order_type: request.kind,
            ...(customer.trim() !== "" ? { customer: customer.trim() } : {}),
            ...(normalized !== null ? { customer_phone: normalized } : {}),
            ...(isDelivery && address.trim() !== "" ? { delivery_address: address.trim() } : {}),
          },
          `${isDelivery ? "Delivery" : "Takeaway"} order (${dishes})`,
        );
      }

      if (outcome.kind === "queued") {
        toast({
          title: "Not sent yet",
          description: `Saved on this device — ${outcome.what}. The kitchen has NOT seen it yet; it sends when the connection returns.`,
          duration: 6000,
        });
      } else {
        const data = outcome.data;
        const createdId = typeof data.id === "string" || typeof data.id === "number" ? String(data.id) : null;
        // Web-extra 35 — link the order to the table; never carries covers.
        if (createdId !== null && request.kind === "dine" && effTable !== null) {
          void linkOrderToTable(restaurantId, effTable, createdId).catch(() => undefined);
        }
        toast({
          title: isDineIn ? `Order sent · ${tableSentenceName(effTable ?? "")}` : isDelivery ? "Delivery order placed" : "Takeaway order placed",
          description: barkOutcomeMessage(data) ?? undefined,
        });
        announceReprintNeeded(readReprintNeeded(data));
      }
      // Sent, or honestly queued in the outbox: either way this cart is going
      // to the kitchen, so the draft must not be offered again.
      forgetDraft();
      sendingRef.current = false;
      onSent?.();
      onClose();
    } catch (e: unknown) {
      const refused = e instanceof OrderEntryError ? parseBillPrintedRefusal(e.body) : null;
      setRefusal(refused);
      setError(refused === null ? (e instanceof Error ? e.message : String(e)) : null);
      sendingRef.current = false;
      setSending(false);
    }
  };

  const takeItOnNextParty = (seat: string): void => {
    setRetarget(seat);
    setRefusal(null);
    setBill(null);
    void send({ retarget: seat });
  };

  const addToPrintedAfterRefusal = (): void => {
    setConfirmedPrinted(true);
    setRefusal(null);
    void send({ confirmedPrinted: true });
  };

  /* ── Menu list ──────────────────────────────────────────────────────── */

  const q = query.trim().toLowerCase();
  const allItems = React.useMemo(() => menu.data?.items ?? [], [menu.data]);
  const filtered = q === "" ? allItems : allItems.filter((m) => m.name.toLowerCase().includes(q));
  const byCategory = React.useMemo(() => {
    const map = new Map<string, PadMenuItem[]>();
    for (const m of allItems) {
      const list = map.get(m.category);
      if (list) { list.push(m); } else { map.set(m.category, [m]); }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allItems]);

  const menuRow = (m: PadMenuItem): React.JSX.Element => {
    const qty = draft.cart[m.id] ?? 0;
    const held = draft.held[m.id] === true;
    const note = draft.notes[m.id] ?? "";
    const sizes = variationsByMenu.get(m.id) ?? [];
    return (
      <ForkCard key={m.id} selected={qty > 0} className="px-3.5 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{m.name}</div>
            <div className="text-xs tabular-nums text-muted-foreground">{money(m.price)}</div>
          </div>
          {qty > 0 ? (
            <LineControls
              name={m.name}
              quantity={qty}
              held={held}
              hasNote={note !== ""}
              disabled={sending}
              onToggleHold={() => { toggleHold(m.id); }}
              onEditNote={() => { openNote(m.id); }}
              onStep={(d) => { step(m.id, d); }}
            />
          ) : (
            <Button variant="outline" size="sm" disabled={sending} onClick={() => { step(m.id, 1); }}>Add</Button>
          )}
        </div>
        {qty > 0 && (held || note !== "" || sizes.length > 0) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {held ? <StatusChip status="warning" label="HOLD" dense /> : null}
            {note !== "" ? <span className="min-w-0 text-xs italic text-muted-foreground">{note}</span> : null}
            {sizes.length > 0 ? (
              <Select value={draft.sizes[m.id] ?? STANDARD_SIZE} onValueChange={(v) => { setSize(m.id, v); }} disabled={sending}>
                <SelectTrigger className="ml-auto h-8 w-auto min-w-[9rem] text-xs" aria-label={`Size for ${m.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDARD_SIZE}>{`Standard — ${money(m.price)}`}</SelectItem>
                  {sizes.map((v) => <SelectItem key={v.id} value={v.id}>{`${v.name} — ${money(v.price)}`}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
      </ForkCard>
    );
  };

  const totalText = moneyShows ? `${currencySymbol}${total.toFixed(2)}` : null;
  const sendLabel = sending
    ? "Sending…"
    : count === 0
      ? "Send order"
      : `Send order · ${String(count)} item${count > 1 ? "s" : ""}${totalText !== null ? ` · ${totalText}` : ""}`;

  const facts: { label: string; value: string }[] = [
    ...(kitchenNote.trim() !== "" ? [{ label: "Kitchen note", value: kitchenNote.trim() }] : []),
    ...(!isDineIn && customer.trim() !== "" ? [{ label: "Customer", value: customer.trim() }] : []),
    ...(!isDineIn && phone.trim() !== "" ? [{ label: "Phone", value: phone.trim() }] : []),
    ...(isDelivery && address.trim() !== "" ? [{ label: "Address", value: address.trim() }] : []),
  ];

  const noteDish = noteFor !== null ? (itemsById.get(noteFor)?.name ?? draft.knownNames[noteFor] ?? "") : "";

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o && !sendingRef.current) { onClose(); } }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none min-[760px]:inset-y-4 min-[760px]:left-1/2 min-[760px]:w-[min(760px,calc(100vw-32px))] min-[760px]:-translate-x-1/2 min-[760px]:rounded-[14px] min-[760px]:border min-[760px]:border-border"
          onEscapeKeyDown={(e) => {
            // Escape first clears a non-empty field (the search box's own rule);
            // it never closes the pad mid-send.
            const active = document.activeElement;
            const typing = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.value !== "";
            if (sendingRef.current || typing) { e.preventDefault(); }
          }}
        >
          {/* App bar. */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close order pad" disabled={sending}><X /></Button>
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Pick dishes from the menu, review the order, then send it to the kitchen.
            </DialogPrimitive.Description>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {/* Sticky header block — capped at 55% of the body. */}
            <div className="max-h-[55%] shrink-0 space-y-3 overflow-y-auto border-b border-border px-4 pb-3 pt-3">
              {addsToPrinted && table !== null ? (
                <div className="flex items-center gap-2 rounded-md border-[1.5px] bg-card px-3 py-2" style={{ borderColor: printedInk, color: printedInk }}>
                  <Receipt aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="line-clamp-2 text-sm font-bold">{addingToPrintedBillStrip(table, parentTable)}</span>
                </div>
              ) : null}

              {isDineIn && bill !== null ? (
                <TableApcStrip bill={bill} showsMoney={moneyShows} pendingTotal={moneyShows ? total : 0} money={money} onOpen={() => { setBillOpen(true); }} />
              ) : null}

              {/* What the pad brought back with it. Says WHEN, because "3 items"
                  alone leaves a waiter wondering whose order this is; and offers
                  the one-tap way out, because a restored cart that cannot be
                  cleared is worse than no restore at all. */}
              {restored !== null && count > 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2">
                  <RotateCcw aria-hidden className="h-4 w-4 shrink-0 text-info" />
                  <span className="min-w-0 flex-1 text-sm">{restored} — still here.</span>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={sending} onClick={startFresh}>
                    Start fresh
                  </Button>
                </div>
              ) : null}

              <AppSearchField placeholder="Search menu…" onQuery={setQuery} debounceMs={150} aria-label="Search menu" />

              {!isDineIn ? (
                <div className="grid gap-2 min-[760px]:grid-cols-2">
                  <Input placeholder="Customer name (optional)" value={customer} disabled={sending} onChange={(e) => { setCustomer(e.target.value); }} />
                  <div>
                    <Input
                      {...PHONE_INPUT_PROPS}
                      placeholder="Mobile number (optional)"
                      value={phone}
                      disabled={sending}
                      aria-invalid={phoneError !== null}
                      onChange={(e) => { setPhone(sanitizePhoneInput(e.target.value)); }}
                    />
                    {phoneError !== null ? <p className="mt-1 text-xs text-destructive">{phoneError}</p> : null}
                  </div>
                  {isDelivery ? (
                    <Textarea
                      className="min-[760px]:col-span-2"
                      rows={2}
                      placeholder="Delivery address"
                      value={address}
                      disabled={sending}
                      onChange={(e) => { setAddress(e.target.value); }}
                    />
                  ) : null}
                </div>
              ) : null}

              <Textarea
                rows={1}
                className="min-h-9 resize-y"
                placeholder="Note for the kitchen (e.g. no onions)…"
                value={kitchenNote}
                disabled={sending}
                onChange={(e) => { setKitchenNote(e.target.value); }}
              />

              {refusal !== null ? (
                <div ref={refusalRef} className="space-y-2.5 rounded-md border border-warning/28 bg-warning/12 p-3">
                  <div className="flex items-start gap-2 text-sm">
                    <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span>{refusal.message}</span>
                  </div>
                  {refusal.nextPartyTable !== null || refusal.addToPrintedLabel !== null ? (
                    <div className="flex flex-wrap gap-2">
                      {refusal.nextPartyTable !== null ? (
                        <Button className="min-w-0 flex-1" disabled={sending} onClick={() => { if (refusal.nextPartyTable !== null) { takeItOnNextParty(refusal.nextPartyTable); } }}>
                          <Armchair /> <span className="truncate">{refusal.actionLabel}</span>
                        </Button>
                      ) : null}
                      {refusal.addToPrintedLabel !== null ? (
                        <Button
                          variant="outline"
                          className="min-w-0 flex-1"
                          style={{ borderColor: printedInk, color: printedInk }}
                          disabled={sending}
                          onClick={addToPrintedAfterRefusal}
                        >
                          <Receipt /> <span className="truncate">{refusal.addToPrintedLabel}</span>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Send bar. */}
              <div className="flex gap-2">
                <Button variant="outline" disabled={sending || lines.length === 0} onClick={() => { setReviewOpen(true); }}>
                  View order
                </Button>
                <Button
                  className="min-w-0 flex-1"
                  disabled={sending || lines.length === 0 || phoneError !== null}
                  onClick={() => { void send(); }}
                >
                  {sending ? <Loader2 className="animate-spin" /> : null}
                  <span className="whitespace-nowrap text-[clamp(11px,3.2vw,14px)]">{sendLabel}</span>
                </Button>
              </div>

              {error !== null ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>

            {/* The menu. */}
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {menu.loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }, (_, i) => <SkeletonBox key={i} height={52} />)}
                </div>
              ) : menu.error && menu.data === null ? (
                <LoadErrorState whatFailed="Failed to load menu." error={menu.error} onRetry={menu.retry} />
              ) : q !== "" ? (
                filtered.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No items match your search.</p>
                ) : (
                  <div className="space-y-2">{filtered.map(menuRow)}</div>
                )
              ) : allItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">The menu is empty — add dishes in Menu first.</p>
              ) : (
                <div className="space-y-4">
                  {byCategory.map(([cat, items]) => (
                    <section key={cat}>
                      <h3 className="micro-label mb-2 tracking-[0.14em]">{cat.toUpperCase()}</h3>
                      <div className="space-y-2">{items.map(menuRow)}</div>
                    </section>
                  ))}
                </div>
              )}
              <CacheStalePill offline={menu.offline} fromCache={menu.fromCache} updatedAt={menu.updatedAt} />
            </div>
          </div>

          <ReviewSheet
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            title={reviewTitle}
            lines={lines}
            showsMoney={moneyShows}
            totalText={totalText}
            money={money}
            facts={facts}
            block={block}
            sending={sending}
            onToggleHold={toggleHold}
            onEditNote={openNote}
            onStep={step}
            onRemove={removeLine}
            onSend={() => { setReviewOpen(false); void send(); }}
          />

          {isDineIn ? (
            <TableBillSheet
              open={billOpen}
              onOpenChange={setBillOpen}
              tableLabel={tableLabel}
              bill={bill}
              loading={billLoading}
              error={billError}
              onRefresh={loadBill}
              showsMoney={moneyShows}
              pendingTotal={moneyShows ? total : 0}
              money={money}
            />
          ) : null}

          {/* Per-dish note. */}
          <AlertDialog open={noteFor !== null} onOpenChange={(o) => { if (!o) { setNoteFor(null); } }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{`Note for ${noteDish}`}</AlertDialogTitle>
                <AlertDialogDescription className="sr-only">Leave it empty to clear the note.</AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea
                autoFocus
                rows={2}
                placeholder="e.g. no onions, extra spicy…"
                value={noteText}
                onChange={(e) => { setNoteText(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(); } }}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button onClick={saveNote}>Save</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Covers — only when this send seats the table. */}
          <AlertDialog open={coversOpen} onOpenChange={(o) => { if (!o) { finishCovers(null); } }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>How many guests at this table?</AlertDialogTitle>
                <AlertDialogDescription className="sr-only">The covers for this seating.</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="order-pad-covers">Number of guests</Label>
                <Input
                  id="order-pad-covers"
                  autoFocus
                  inputMode="numeric"
                  value={coversText}
                  onChange={(e) => { setCoversText(e.target.value.replace(/[^0-9]/g, "")); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finishCovers(Number.parseInt(coversText, 10) || 1); } }}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button onClick={() => { finishCovers(Number.parseInt(coversText, 10) || 1); }}>
                  Send order
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
