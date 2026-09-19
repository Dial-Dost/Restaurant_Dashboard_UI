// THE APP'S LOCAL KOT COPY — what the "Print KOT (local PDF copy)" button on a
// kitchen ticket prints, laid out the way the reference docket is.
//
// A TS port of restaurant_owner_app/lib/models/kot_copy.dart (see that file for
// the full rationale and the transcribed reference docket). What it shares with
// the thermal docket is everything a chef actually reads: THE ORDER OF THE
// LINES, WHICH OF THEM ARE BOLD, WHICH ONE IS SMALLER AND SLANTED, THE WORDS ON
// THEM — and the docket's type sizes. What it leaves out — "KOT - n" above all —
// it leaves out on purpose: the number is allocated server-side, inside the
// transaction that makes it unique per outlet-day, and a number invented here
// would collide with the real series. The context line says so on the paper.
//
// The rows are PURE (no DOM, no fetch); `printKotCopy` at the bottom is the one
// piece of plumbing — the same hidden-iframe print pipeline the reports export
// uses, where "Save as PDF" already lives on every desktop platform.

import { escapeHtml } from "@/lib/mis-print";
import { timezoneOffsetMinutes } from "@/lib/tz";

/** THE DOCKET'S TYPE SIZES, IN POINTS (27 and 23 dots per em at 203 dpi). */
export const KOT_PRINTER_DPI = 203;
export const KOT_DOCKET_BODY_DOTS = 27;
export const KOT_DOCKET_NOTE_DOTS = 23;
export const KOT_COPY_BODY_PT = (KOT_DOCKET_BODY_DOTS * 72) / KOT_PRINTER_DPI;
export const KOT_COPY_NOTE_PT = (KOT_DOCKET_NOTE_DOTS * 72) / KOT_PRINTER_DPI;

/**
 * The line under a HELD dish — on the docket, on this copy and on the kitchen
 * board — word for word escpos.ts `KOT_HOLD_LINE`. The marker alone, per the
 * client: never "do not cook until fired".
 */
export const kotHoldLine = "[Hold]";

/** The note line under a dish, tagged the way the thermal docket prints it. */
export const kotNoteLine = (note: string): string => `[Note] ${note}`;

/** What the context slot of a local copy says: what the paper is. */
export const kotCopyContextLine = "Local copy - no ticket number";

/** The line shape the held-course predicate reads. */
export interface KotLineLike {
  course_hold?: boolean | null;
  fired_at?: string | null;
}

/**
 * Whether one order line is a HELD course that has not been fired yet — the
 * one predicate the board dims by and this copy totals by.
 */
export const kotLineHeld = (line: KotLineLike): boolean =>
  line.course_hold === true && (line.fired_at == null || line.fired_at === "");

/** One order line as this copy consumes it. */
export interface KotCopyItem extends KotLineLike {
  name: string;
  quantity: number;
  note?: string | null;
  /** The price point's label — the docket prints "Paneer Tikka (Half)". */
  variation?: string | null;
}

/** The order fields the copy reads — one entry of GET /orders, in essence. */
export interface KotCopySource {
  table: string;
  order_type?: string | null;
  note?: string | null;
  items: KotCopyItem[];
}

/** One dish on a KOT: number, name, qty, and the lines hung under it. */
export interface KotDocketRow {
  no: string;
  name: string;
  qty: number;
  held: boolean;
  under: string[];
}

export interface KotDocket {
  rows: KotDocketRow[];
  totalQty: number;
  holdQty: number;
  showTotal: boolean;
  showHold: boolean;
}

/**
 * THE ITEM BLOCK OF A KITCHEN TICKET, as the thermal docket lays it out: every
 * dish keeps its number and place; a held dish's first under-line is
 * `kotHoldLine`, a note follows it; Total Qty counts only what may be cooked
 * now, Hold Qty sits under it. A wholly held docket prints no Total Qty; one
 * with nothing held prints no Hold Qty.
 */
export const kotDocket = (items: KotCopyItem[]): KotDocket => {
  const rows: KotDocketRow[] = [];
  let totalQty = 0;
  let holdQty = 0;
  let heldLines = 0;
  for (const m of items) {
    const held = kotLineHeld(m);
    const qty = Number.isFinite(m.quantity) && Math.round(m.quantity) >= 1 ? Math.round(m.quantity) : 1;
    if (held) {
      holdQty += qty;
      heldLines += 1;
    } else {
      totalQty += qty;
    }
    const name = m.name.trim();
    const variation = (m.variation ?? "").trim();
    const note = (m.note ?? "").trim();
    rows.push({
      no: String(rows.length + 1),
      name: variation === "" || variation === "null" ? name : `${name} (${variation})`,
      qty,
      held,
      under: [...(held ? [kotHoldLine] : []), ...(note !== "" ? [kotNoteLine(note)] : [])],
    });
  }
  return {
    rows,
    totalQty,
    holdQty,
    showTotal: heldLines < rows.length || heldLines === 0,
    showHold: heldLines > 0,
  };
};

/** The docket's words for how an order is served (kot_numbers.ts). */
export const kotServiceModeLabel = (orderType: string | null | undefined): string => {
  const t = (orderType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (t === "" || t === "null" || t === "dine_in" || t === "dinein") { return "Dine In"; }
  if (t === "takeaway" || t === "take_away" || t === "pickup" || t === "parcel") { return "Takeaway"; }
  if (t === "delivery") { return "Delivery"; }
  if (t === "swiggy") { return "Delivery (Swiggy)"; }
  if (t === "zomato") { return "Delivery (Zomato)"; }
  return t
    .split("_")
    .filter((w) => w.length > 0)
    .map((w) => `${w[0].toUpperCase()}${w.slice(1)}`)
    .join(" ");
};

/** The shapes a line of the copy comes in — the docket's own four. */
export type KotCopyKind = "line" | "rule" | "columns" | "under";

/** One line of the copy. Only the fields its `kind` uses are meaningful. */
export interface KotCopyRow {
  kind: KotCopyKind;
  text: string;
  bold: boolean;
  centred: boolean;
  /** Set on the one under-line that is a dish's note: smaller and slanted. */
  note: boolean;
  no: string;
  qty: string;
}

const line = (text: string, opts: { bold?: boolean; centred?: boolean } = {}): KotCopyRow => ({
  kind: "line",
  text,
  bold: opts.bold ?? false,
  centred: opts.centred ?? true,
  note: false,
  no: "",
  qty: "",
});

const rule: KotCopyRow = { kind: "rule", text: "", bold: false, centred: false, note: false, no: "", qty: "" };

const cols = (no: string, name: string, qty: string, opts: { bold?: boolean } = {}): KotCopyRow => ({
  kind: "columns",
  text: name,
  bold: opts.bold ?? false,
  centred: false,
  note: false,
  no,
  qty,
});

const under = (text: string, note: boolean): KotCopyRow => ({
  kind: "under",
  text,
  bold: false,
  centred: false,
  note,
  no: "",
  qty: "",
});

/**
 * THE LOCAL COPY OF ONE ORDER, line by line, in the reference docket's order.
 * `stamp` is the printed time, passed in so this stays a pure function.
 */
export const kotCopyRows = (order: KotCopySource, stamp: string): KotCopyRow[] => {
  const field = (v: string | null | undefined): string => {
    const s = (v ?? "").trim();
    return s === "null" ? "" : s;
  };

  const docket = kotDocket(order.items);
  const rows: KotCopyRow[] = [
    line(kotCopyContextLine),
    line("KOT", { bold: true }),
    ...(stamp.trim() !== "" ? [line(stamp.trim())] : []),
    line(kotServiceModeLabel(order.order_type), { bold: true }),
    line(`Table No: ${field(order.table) === "" ? "N/A" : field(order.table)}`, { bold: true }),
    rule,
  ];
  // The order-level instruction, above the items it qualifies — the docket's
  // "** NOTE **" block, word for word.
  const note = field(order.note);
  if (note !== "") {
    rows.push(line("** NOTE **", { bold: true }), line(note, { centred: false }), rule);
  }
  rows.push(cols("No.Item", "", "Qty"));
  for (const r of docket.rows) {
    rows.push(cols(r.no, r.name, String(r.qty), { bold: true }));
    for (const l of r.under) {
      rows.push(under(l, l !== kotHoldLine));
    }
  }
  rows.push(rule);
  if (docket.showTotal) { rows.push(cols("Total Qty", "", String(docket.totalQty))); }
  if (docket.showHold) { rows.push(cols("Hold Qty", "", String(docket.holdQty))); }
  rows.push(rule);
  return rows;
};

/* ── The printable document ─────────────────────────────────────────── */

/**
 * The copy as a printable HTML document: a 72mm column at the top left, the
 * docket's sizes (9.6pt body, 8.2pt slanted note), dashed rules, and the
 * number/qty columns sized to what they hold, as on the docket.
 */
export const kotCopyHtml = (rows: KotCopyRow[]): string => {
  const size = KOT_COPY_BODY_PT;
  // Number column to the widest dish number, qty column to the widest quantity
  // or "Qty" — a digit is 0.56em, the gutter after the number 0.4em.
  let numChars = 1;
  let qtyChars = 3;
  for (const r of rows) {
    if (r.kind !== "columns") { continue; }
    if (r.text !== "") { numChars = Math.max(numChars, r.no.length); }
    qtyChars = Math.max(qtyChars, r.qty.length);
  }
  const numW = numChars * 0.56 * size + 0.4 * size;
  const qtyW = qtyChars * 0.6 * size;

  const draw = (r: KotCopyRow): string => {
    switch (r.kind) {
      case "rule":
        // 0.8pt is two and a half dots on a 203 dpi roll: thinner drops out.
        return '<div class="rule"></div>';
      case "line":
        return `<div class="ln${r.centred ? " c" : ""}${r.bold ? " b" : ""}">${escapeHtml(r.text)}</div>`;
      case "under":
        return `<div class="u${r.note ? " n" : ""}">${escapeHtml(r.text)}</div>`;
      case "columns": {
        const qty = `<span class="qty">${escapeHtml(r.qty)}</span>`;
        // The heading and the totals: the left cell runs into the name column
        // ("No.Item", "Total Qty"), as it does on the docket.
        if (r.text === "") {
          return `<div class="cols"><span class="span">${escapeHtml(r.no)}</span>${qty}</div>`;
        }
        return `<div class="cols"><span class="no">${escapeHtml(r.no)}</span><span class="nm${r.bold ? " b" : ""}">${escapeHtml(r.text)}</span>${qty}</div>`;
      }
    }
  };

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>KOT</title><style>
  @page { margin: 8mm; }
  body { margin: 0; color: #000; background: #fff;
         font-family: Helvetica, Arial, sans-serif; font-size: ${size.toFixed(2)}pt; }
  .col { width: 72mm; max-width: 100%; }
  .rule { border-top: 0.8pt dashed #000; margin: 4pt 0; }
  .ln { padding: 1pt 0; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .u { padding: 0 0 1pt ${numW.toFixed(2)}pt; }
  .n { font-size: ${KOT_COPY_NOTE_PT.toFixed(2)}pt; font-style: italic; }
  .cols { display: flex; align-items: flex-start; padding: 1pt 0; }
  .no { flex: none; width: ${numW.toFixed(2)}pt; }
  .nm { flex: 1 1 auto; min-width: 0; }
  .span { flex: 1 1 auto; min-width: 0; }
  .qty { flex: none; width: ${qtyW.toFixed(2)}pt; text-align: right; }
</style></head>
<body><div class="col">${rows.map(draw).join("")}</div></body></html>`;
};

/**
 * "19 Sep 2026, 14:13:05 UTC+05:30" — the printed instant, in the RESTAURANT's
 * zone, exactly as the app's `RestaurantTime.stampNow` writes it (the copy
 * leaves the screen, so it carries its zone explicitly and unambiguously).
 */
export const kotCopyStamp = (timeZone: string, at: Date = new Date()): string => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const p: Partial<Record<string, string>> = {};
    for (const part of parts) { p[part.type] = part.value; }
    if (!p.day || !p.month || !p.year) { return ""; }
    const off = timezoneOffsetMinutes(timeZone, at);
    const two = (n: number): string => String(n).padStart(2, "0");
    const abs = Math.abs(off);
    const offset = `UTC${off < 0 ? "-" : "+"}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
    return `${p.day} ${p.month} ${p.year}, ${p.hour ?? ""}:${p.minute ?? ""}:${p.second ?? ""} ${offset}`;
  } catch {
    return "";
  }
};

/**
 * Hand the copy to the browser's own print dialog through a hidden same-origin
 * iframe (the reports-export precedent: a popup would be blocked, and a blocked
 * print looks like a button that does nothing).
 */
export const printKotCopy = (order: KotCopySource, stamp: string): void => {
  if (typeof document === "undefined") { return; }
  const html = kotCopyHtml(kotCopyRows(order, stamp));

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);

  const cleanup = (): void => {
    setTimeout(() => { frame.remove(); }, 1000);
  };
  frame.onload = () => {
    try {
      const win = frame.contentWindow;
      if (!win) { cleanup(); return; }
      win.focus();
      win.print();
    } catch { /* print refused (headless, kiosk) — the frame is removed anyway */ }
    cleanup();
  };
  frame.srcdoc = html;
};
