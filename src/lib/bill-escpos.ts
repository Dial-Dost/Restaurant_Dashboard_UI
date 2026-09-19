// THE CUSTOMER BILL AS THE THERMAL PRINTER RECEIVES IT — the web's twin of
// Restaurant_Backend/escpos.ts (`buildReceiptBase64`, kind "bill").
//
// ============================================================================
// WHY THIS FILE EXISTS
// ============================================================================
// The dashboard's print page has a "Print ESC/POS" button that encodes the bill
// in the browser and posts the bytes to /publish/bill, where the same thermal
// agent that prints the till's bills picks them up. So the SAME bill reaches the
// SAME printer through two encoders, and a guest can hold one slip from each.
// They must be one document.
//
// The page used to drive `@point-of-sale/receipt-printer-encoder`, a line
// composer that centres by padding with spaces, sizes with GS !, ends lines with
// CR LF and wraps text at its own column count. None of that can express the
// layout the client's own bill carries (their photographed "Gaia - Global
// Vegetarian" slip), which escpos.ts now reproduces:
//
//   * MARGINS set on the printer (GS L / GS W) — a padded composer puts spaces
//     in front of a GS L and the printer then ignores it, because GS L is only
//     honoured at the start of a line;
//   * SOLID RULES as GS v 0 rasters sitting at the start of a line, where a
//     composer would have put its alignment spaces in front of them too;
//   * the grand total in ESC ! double height, the Dine In run in ESC E bold.
//
// So the bytes are built here, command by command, in escpos.ts's order and
// with escpos.ts's helpers ported verbatim. Given the same inputs the two
// produce the same stream. Anything that changes the bill's layout on one side
// changes it on the other in the same commit, or the paper drifts.
//
// PURE — no React, no canvas, no `window`, no fetch — so
// `__tests__/bill-escpos.test.ts` can read the bytes. The page does the two
// browser-only jobs (turning the logo PNG into pixels, building the feedback
// URL) and hands the results in.

import { REPRINT_MARKER } from './bill-print-state';

const ESC = 0x1b;
const GS = 0x1d;

// `ESC ! n` print-mode bits. One command sets ALL of them, so a size change that
// leaves MODE_BOLD out also switches emphasis off — see `big` in escpos.ts.
const MODE_BOLD = 0x08; // emphasized
const MODE_TALL = 0x10; // double height
const MODE_WIDE = 0x20; // double width

/** Printer dots per Font A column — 576 dots / 48 columns on the 80mm roll. */
export const DOTS_PER_COL = 12;

/**
 * Text columns of white kept either side of a CUSTOMER BILL, per roll.
 *
 * The client's printed bill sits inside visible margins — the rules and the
 * right-hand money column stop well short of the paper edge. The 58mm roll gets
 * none: at 32 columns every one is already spoken for by the item table.
 * Mirrors billMarginCols in escpos.ts.
 */
export function billMarginCols(width: number): number {
    return width >= 48 ? 2 : 0;
}

/** Columns a bill's lines are laid out against: the roll less both margins. */
export function billTextColumns(width: number): number {
    return width - 2 * billMarginCols(width);
}

/**
 * The bill's item-table columns for a text area of `textWidth` — Item, Qty.,
 * Price, Amount — summing exactly to it. 80mm (44 inside its margins): Item 20,
 * Qty. 5, Price 9, Amount 10. 58mm (32, no margins): Item 11, Qty. 4, Price 8,
 * Amount 9. The totals ladder right-aligns on the same Amount column, and the
 * on-screen bill sizes its table columns from these same numbers.
 */
export function billColumns(textWidth: number): { COL_ITEM: number; COL_QTY: number; COL_PRICE: number; COL_TOTAL: number } {
    const wide = textWidth >= 40;
    const COL_QTY = wide ? 5 : 4;
    const COL_PRICE = wide ? 9 : 8;
    const COL_TOTAL = wide ? 10 : 9;
    const COL_ITEM = Math.max(8, textWidth - COL_QTY - COL_PRICE - COL_TOTAL);
    return { COL_ITEM, COL_QTY, COL_PRICE, COL_TOTAL };
}

/**
 * A SOLID RULE, as a raster — the lines on the client's bill are continuous
 * strokes, not a row of hyphens. Byte for byte billRule in escpos.ts.
 *
 * Why a raster and not a box-drawing character: 0xC4 is a line only in code
 * page 437, and a printer left on WPC1252 prints a row of "Ä" instead. A GS v 0
 * image prints wherever the logo already prints. `dots` is the width of the
 * text area it underlines; the stroke sits in 4 rows of white above and below —
 * 2 rows of ink for a thin rule, 4 for the thick ones around the item table.
 *
 * NOTE FOR ANYONE DECODING THE STREAM: the header's yL byte is 10 for a thin
 * rule, the same byte as "\n". Splitting printed text on newlines without first
 * stepping over GS v 0 blocks by their header length cuts a rule in half.
 */
export function billRule(dots: number, thick = false): Uint8Array {
    const widthBytes = Math.ceil(dots / 8);
    const PAD = 4;
    const INK = thick ? 4 : 2;
    const height = PAD + INK + PAD;
    const out = new Uint8Array(8 + widthBytes * height);
    out.set([
        0x1d, 0x76, 0x30, 0x00,
        widthBytes & 0xff, (widthBytes >> 8) & 0xff,
        height & 0xff, (height >> 8) & 0xff,
    ], 0);
    const tail = dots % 8;
    for (let y = PAD; y < PAD + INK; y++) {
        out.fill(0xff, 8 + y * widthBytes, 8 + (y + 1) * widthBytes);
        // Never ink past the requested width: a partial last byte keeps only its
        // leading bits.
        if (tail) { out[8 + (y + 1) * widthBytes - 1] = (0xff << (8 - tail)) & 0xff; }
    }
    return out;
}

// ---------------------------------------------------------------------------
// THE LOGO — fitted the way bill_logo.ts fits it
// ---------------------------------------------------------------------------

/** Printer dots across the printable width of the 80mm roll. */
export const BILL_ROLL_DOTS = 576;
/** The tallest a logo prints (bill_logo.ts BILL_LOGO_MAX_HEIGHT). */
export const BILL_LOGO_MAX_HEIGHT = 240;
/**
 * The widest a logo prints, as a share of the roll (bill_logo.ts
 * BILL_LOGO_WIDTH_SHARE). The client's own bill carries its wordmark at a little
 * over half the paper with white either side; a logo fitted edge to edge reads
 * as a banner and pushes the restaurant name a long way down the slip.
 */
export const BILL_LOGO_WIDTH_SHARE = 2 / 3;

/**
 * The size a logo of `width` x `height` pixels prints at: inside two thirds of
 * the roll and BILL_LOGO_MAX_HEIGHT, aspect kept, NEVER ENLARGED — sharp's
 * `fit: "inside", withoutEnlargement: true` in bill_logo.ts. null for an image
 * with no size (a failed decode).
 *
 * The on-screen bill sizes its logo from this too, so a small logo shows small
 * on the preview for the same reason it prints small: the printer has no more
 * dots to give it.
 */
export function billLogoFit(width: number, height: number, rollDots: number = BILL_ROLL_DOTS): { width: number; height: number } | null {
    if (!(width > 0) || !(height > 0)) { return null; }
    const maxWidth = Math.round(rollDots * BILL_LOGO_WIDTH_SHARE);
    const scale = Math.min(1, maxWidth / width, BILL_LOGO_MAX_HEIGHT / height);
    return {
        width: Math.max(1, Math.min(maxWidth, Math.round(width * scale))),
        height: Math.max(1, Math.min(BILL_LOGO_MAX_HEIGHT, Math.round(height * scale))),
    };
}

/**
 * One-bit GS v 0 raster from RGBA pixels already flattened onto white (a canvas
 * filled white before the logo was drawn). A pixel darker than mid-grey is ink —
 * bill_logo.ts's `threshold(128)`. The logo /restaurant/logo/bill serves is
 * ALREADY that raster as a PNG, so for it this reproduces the server's bits
 * exactly; for a branding-PNG fallback it is the same rule applied here.
 */
export function billLogoRaster(rgba: ArrayLike<number>, width: number, height: number): Uint8Array | null {
    if (!(width > 0) || !(height > 0) || rgba.length < width * height * 4) { return null; }
    const widthBytes = Math.ceil(width / 8);
    const out = new Uint8Array(8 + widthBytes * height);
    out.set([
        0x1d, 0x76, 0x30, 0x00,
        widthBytes & 0xff, (widthBytes >> 8) & 0xff,
        height & 0xff, (height >> 8) & 0xff,
    ], 0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const grey = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
            if (grey < 128) {
                out[8 + y * widthBytes + (x >> 3)] |= 1 << (7 - (x & 7));
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// TEXT HELPERS — ported from escpos.ts, behaviour for behaviour
// ---------------------------------------------------------------------------

/**
 * ESC/POS text is emitted as single bytes. Anything outside ASCII would be
 * truncated to a wrong or control byte and print as garbage or corrupt the
 * command stream, so typographic characters fold to ASCII, diacritics are
 * stripped and anything left becomes '?'. Mirrors asciiSafe in escpos.ts.
 */
export function asciiSafe(s: string): string {
    return s
        .replace(/[‘’‚‛]/g, "'")
        .replace(/[“”„‟]/g, '"')
        .replace(/[–—―]/g, '-')
        .replace(/…/g, '...')
        .replace(/₹/g, 'Rs')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        // Tab, LF and CR are exactly the control bytes this stream may carry.
        // eslint-disable-next-line no-control-regex
        .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

/** ₹ is not in the default code page: "Rs". Mirrors currencyToken in escpos.ts. */
export function currencyToken(sym: string | null | undefined): string {
    const s = (sym ?? '').trim();
    if (s === '₹' || s.toLowerCase() === 'inr') { return 'Rs'; }
    if (s === '€') { return 'EUR'; }
    if (s === '£') { return 'GBP'; }
    return /^[\x20-\x7e]{1,4}$/.test(s) ? s : '';
}

/** Left text + right text on one line, right-aligned within `width` columns. */
export function twoCol(left: string, right: string, width: number): string {
    if (left.length + right.length >= width) {
        const maxLeft = Math.max(0, width - right.length - 1);
        return left.slice(0, maxLeft) + ' ' + right;
    }
    return left + ' '.repeat(width - left.length - right.length) + right;
}

/** Word-wrap to lines of at most `maxLen`; a word longer than that is hard-split. */
export function wrapText(text: string, maxLen: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
        if ((cur + (cur ? ' ' : '') + w).length > maxLen) {
            if (cur) { lines.push(cur); }
            if (w.length > maxLen) {
                let rest = w;
                while (rest.length > maxLen) {
                    lines.push(rest.slice(0, maxLen));
                    rest = rest.slice(maxLen);
                }
                cur = rest;
            } else {
                cur = w;
            }
        } else {
            cur = cur ? `${cur} ${w}` : w;
        }
    }
    if (cur) { lines.push(cur); }
    return lines.length ? lines : [''];
}

/** A header field, with a JSON-round-tripped "null"/"undefined" read as unset. */
const present = (v: unknown): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^(null|undefined)$/i.test(s) ? '' : s;
};

/** Native ESC/POS QR (GS ( k), model 2, error correction M. escposQr in escpos.ts. */
function escposQr(data: string, size = 6): Uint8Array {
    const bytes = Array.from(data, (ch) => ch.charCodeAt(0) & 0xff); // feedback URLs are ASCII
    const store = bytes.length + 3;
    return Uint8Array.from([
        GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // model 2
        GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size,       // module size
        GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,       // error correction M
        GS, 0x28, 0x6b, store & 0xff, (store >> 8) & 0xff, 0x31, 0x50, 0x30, // store data
        ...bytes,
        GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,       // print
    ]);
}

// ---------------------------------------------------------------------------
// THE TOTALS LADDER — one set of labels for the paper AND the screen
// ---------------------------------------------------------------------------

/** The document's money, as either renderer reads it. */
export interface BillTotalsSource {
    items: readonly { quantity: unknown }[];
    subtotal: number;
    discount: { label: string; amount: number } | null;
    /** Printed only when `amount` is above zero — a removed charge prints no line. */
    serviceCharge: { percent: number; amount: number } | null;
    taxes: readonly { id?: string; name: string; percentage: number; amount: number }[];
    roundOff: number | null;
}

/** One rung under "Total Qty / Sub Total": a right-aligned label and its figure. */
export interface BillLadderRung { key: string; label: string; value: string }

/**
 * The rungs between the item table and the grand total, worded as the client's
 * bill words them: "Sub Total", "Service Charge 10%", "SGST 2.5%" (no
 * parentheses), a discount as "-500.00" (no space after the minus). The ESC/POS
 * bytes below and the on-screen bill both print exactly these strings, so the
 * wording cannot differ between the two slips.
 *
 * Mirrors escpos.ts's gates: a discount only when positive, the service charge
 * only when it is charged (a removed charge prints nothing — no "Opted-out"), and
 * a tax line only when it carries money. The round-off is DISCLOSED, never
 * created — only a supplied, non-zero one, which since backend migration 048 is
 * every bill that was not already whole rupees.
 */
export function billTotals(doc: BillTotalsSource): { totalQty: number; subtotal: string; rungs: BillLadderRung[]; roundOff: string | null } {
    const totalQty = doc.items.reduce((s, it) => s + Math.max(1, Math.round(Number(it.quantity) || 1)), 0);
    const rungs: BillLadderRung[] = [];
    const discount = doc.discount && doc.discount.amount > 0 ? doc.discount : null;
    if (discount) {
        rungs.push({ key: 'discount', label: discount.label || 'Discount', value: `-${discount.amount.toFixed(2)}` });
    }
    const sc = doc.serviceCharge && doc.serviceCharge.amount > 0 ? doc.serviceCharge : null;
    if (sc) {
        rungs.push({ key: 'service-charge', label: `Service Charge ${String(sc.percent)}%`, value: sc.amount.toFixed(2) });
    }
    doc.taxes.forEach((t, i) => {
        if (t.amount > 0) {
            rungs.push({ key: `tax-${t.id ?? String(i)}`, label: `${t.name} ${String(t.percentage)}%`, value: t.amount.toFixed(2) });
        }
    });
    const disclosed = doc.roundOff;
    const roundOff = disclosed !== null && Number.isFinite(disclosed) && Math.round(disclosed * 100) !== 0
        ? (disclosed > 0 ? '+' : '') + disclosed.toFixed(2)
        : null;
    return { totalQty, subtotal: doc.subtotal.toFixed(2), rungs, roundOff };
}

// ---------------------------------------------------------------------------
// ONE ITEM LINE — the same figures, and the same "does it fit" answer, on both slips
// ---------------------------------------------------------------------------

/** The figures one item line prints, and whether they fit the item table's columns. */
export interface BillItemRow { qtyText: string; priceText: string; amountText: string; fits: boolean }

/**
 * One line's quantity, price and amount as the paper prints them, and whether
 * each is STRICTLY shorter than its column in a text area of `textWidth`.
 *
 * Strictly, because `padL` neither separates nor trims: a figure exactly as wide
 * as its column butts against the one before it, and qty 1 at 150000.00 printed
 * "1150000.00". When `fits` is false the thermal bill gives the name the whole
 * width and puts "qty x price  amount" on its own right-aligned line, and the
 * on-screen slip does the same — escpos.ts's rule.
 */
export function billItemRow(quantity: unknown, price: unknown, textWidth: number): BillItemRow {
    const { COL_QTY, COL_PRICE, COL_TOTAL } = billColumns(textWidth);
    const qty = Math.max(1, Math.round(Number(quantity) || 1));
    const unit = Number(price) || 0;
    const qtyText = String(qty);
    const priceText = unit.toFixed(2);
    const amountText = (unit * qty).toFixed(2);
    const fits = qtyText.length < COL_QTY && priceText.length < COL_PRICE && amountText.length < COL_TOTAL;
    return { qtyText, priceText, amountText, fits };
}

// ---------------------------------------------------------------------------
// THE OWNER'S QR SWITCH (bill_show_qr)
// ---------------------------------------------------------------------------

/**
 * Does the bill carry the valet/feedback QR? Only an explicit `showQr: false`
 * turns it off. No settings (the fetch failed) or no key (a backend from before
 * the switch) is the behaviour every bill already had: the QR prints. A switch
 * that turned itself off whenever the settings read failed would silently strip
 * the QR from bills whose owner never touched it.
 */
export function billShowsQr(settings: { showQr?: boolean | null } | null | undefined): boolean {
    return settings?.showQr !== false;
}

/**
 * The feedback-form URL the bill's QR encodes, or null when there is none to
 * print — the owner switched the QR off, there is no form base URL, or the
 * signed-in user is missing an id the form needs. escpos.ts prints the QR block
 * (sentence AND code) only when handed a URL, so a null here is exactly the
 * backend's "QR off": no sentence, no code, and no rule above them.
 */
export function billFeedbackUrl(
    baseUrl: string | null | undefined,
    ids: { res_id?: unknown; employeeId?: unknown; outlet_id?: unknown } | null | undefined,
    settings: { showQr?: boolean | null } | null | undefined,
): string | null {
    if (!billShowsQr(settings)) { return null; }
    const base = String(baseUrl ?? '').replace(/\/$/, '');
    if (!base || !ids?.res_id || !ids.employeeId || !ids.outlet_id) { return null; }
    const params = new URLSearchParams({ restaurantId: String(ids.res_id), employeeId: String(ids.employeeId), outletId: String(ids.outlet_id) });
    return `${base}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// THE BILL
// ---------------------------------------------------------------------------

/**
 * The service-charge disclaimer, word for word the sentence routes/bills.ts
 * hands escpos.ts. Printed only on a bill that charges for service — the caller
 * decides that (billChargesForService on the print page).
 */
export const BILL_SERVICE_CHARGE_NOTE = 'A Voluntary Service Charge is included to support our staff. If you prefer not to contribute, please inform your server before payment and it will be removed.';

export interface BillEscPosInput extends BillTotalsSource {
    /** Columns across the roll: 48 for 80mm (the default), 32 for 58mm. */
    width?: number;
    reprint?: boolean;
    /** A GS v 0 logo raster (billLogoRaster), printed centred at the top. */
    logo?: Uint8Array | null;
    restaurantName: string;
    /** Legal name, address lines, "Ph : …", "GSTN : …" — only the ones set. */
    headerLines: readonly string[];
    /** "Name: …" and, when set, "Customer GSTIN: …" (billCustomerLines). */
    customerLines: readonly string[];
    /** Already formatted in the restaurant's zone. */
    printedAt: string;
    table: string;
    cashier: string;
    billNo: string;
    currency: string;
    items: readonly { name: string; quantity: number; price: number }[];
    /** The server's grand total, printed verbatim — never recomputed here. */
    grandTotal: number;
    serviceChargeNote: string | null;
    /** null prints no QR sentence and no QR — the owner's switch off (billFeedbackUrl). */
    feedbackUrl: string | null;
    /** The sentence above the QR; '' prints none. */
    qrNote: string;
    /**
     * What the comped (NC) lines were worth. Those lines print at 0.00, so this
     * discloses the value given away under the Grand Total, ruled off, exactly
     * as the on-screen receipt and escpos.ts do. null / 0 prints nothing.
     */
    ncValue?: number | null;
}

/**
 * The customer bill, as ESC/POS bytes, in the client's layout. See escpos.ts's
 * bill branch for the reasons behind each block; this is the same stream.
 */
export function buildBillEscPos(bill: BillEscPosInput): Uint8Array {
    const width = bill.width === 32 ? 32 : 48;
    const cur = currencyToken(bill.currency);
    const money = (n: number): string => `${cur}${cur ? ' ' : ''}${(n || 0).toFixed(2)}`;
    const chunks: Uint8Array[] = [];
    const raw = (...n: number[]): void => { chunks.push(Uint8Array.from(n)); };
    const text = (s: string): void => { chunks.push(Uint8Array.from(asciiSafe(s), (ch) => ch.charCodeAt(0))); };
    const line = (s = ''): void => { text(s + '\n'); };

    // THE TEXT AREA: the roll less its margins. Every line is laid out against W;
    // the margins themselves are the printer's (GS L / GS W), so the text stream
    // carries no padding.
    const marginCols = billMarginCols(width);
    const W = width - 2 * marginCols;
    const rule = (thick = false): void => { chunks.push(billRule(W * DOTS_PER_COL, thick)); };
    /** Bold without touching size — `ESC E` alone, so a run keeps its columns. */
    const bold = (s: string): void => { raw(ESC, 0x45, 0x01); text(s); raw(ESC, 0x45, 0x00); };
    /** Bold double width and height when it fits; bold at normal size when it would wrap. */
    const big = (s: string, cols: number): void => {
        const t = asciiSafe(s);
        const fits = t.length * 2 <= cols;
        raw(ESC, 0x45, 0x01);
        if (fits) { raw(ESC, 0x21, MODE_WIDE | MODE_TALL | MODE_BOLD); }
        line(t);
        if (fits) { raw(ESC, 0x21, 0x00); }
        raw(ESC, 0x45, 0x00);
    };

    raw(ESC, 0x40); // initialize
    if (marginCols > 0) {
        // GS L (left margin) then GS W (print area), in dots, straight after
        // ESC @ at the start of a line where both are honoured. The next job's
        // ESC @ clears both.
        const left = marginCols * DOTS_PER_COL;
        const area = W * DOTS_PER_COL;
        raw(GS, 0x4c, left & 0xff, (left >> 8) & 0xff);
        raw(GS, 0x57, area & 0xff, (area >> 8) & 0xff);
    }

    // --- Header (centred): REPRINT, logo, name, legal name / address / Ph / GSTN
    raw(ESC, 0x61, 0x01);
    // The first thing on a reprinted roll is that it is a reprint — above the
    // logo, in the backend's own spelling.
    if (bill.reprint) { big(REPRINT_MARKER, W); }
    if (bill.logo && bill.logo.length > 0) {
        chunks.push(bill.logo);
        line();
    }
    // BOLD, AT THE SIZE OF THE ADDRESS UNDER IT, as on the client's bill.
    //
    // EVERY WRAPPED STRING IS FOLDED TO ASCII BEFORE IT IS MEASURED. `line`
    // folds anyway, and the fold can LENGTHEN text ("…" is three characters,
    // "½" is "1?2"), so a wrap measured on the original can print past the text
    // area. escpos.ts folds in the same places.
    for (const l of wrapText(asciiSafe(bill.restaurantName || 'Receipt'), W)) {
        raw(ESC, 0x45, 0x01);
        line(l);
        raw(ESC, 0x45, 0x00);
    }
    // Legal name, address lines, "Ph : …", "GSTN : …" — each wrapped whole, so a
    // GSTIN field carrying two registrations wraps instead of running off.
    for (const h of bill.headerLines) {
        for (const l of wrapText(asciiSafe(h), W)) { line(l); }
    }
    rule();

    // --- Meta block (left) --------------------------------------------------
    raw(ESC, 0x61, 0x00);
    // The "Name:" slot and, when set, "Customer GSTIN:", between the header's
    // rule and the next one.
    for (const c of bill.customerLines) {
        for (const l of wrapText(asciiSafe(c), W)) { line(l); }
    }
    rule();
    // Date on the left, the table on the right and BOLD — what a server matches
    // the slip to. Bold changes no widths, so the row is laid out as plain text
    // and only the right-hand run is emphasised.
    //
    // NEVER CUT A VALUE TO MAKE A ROW FIT. Side by side only when both print
    // whole with at least one space between them; otherwise the date on its own
    // line(s) and the Dine In under it, each wrapped whole — a long virtual-table
    // name used to slice the minutes off the date on a GST invoice.
    {
        const dateText = asciiSafe(`Date: ${present(bill.printedAt) || new Date().toLocaleString()}`);
        const dineIn = asciiSafe(`Dine In: ${bill.table || 'N/A'}`);
        if (dateText.length + 1 + dineIn.length <= W) {
            text(dateText + ' '.repeat(W - dateText.length - dineIn.length));
            bold(dineIn);
            line();
        } else {
            for (const l of wrapText(dateText, W)) { line(l); }
            for (const l of wrapText(dineIn, W)) { bold(l); line(); }
        }
    }
    // Cashier on the left, bill number on the right — the client's order. Each
    // label only when its value is known. Same rule as the date: side by side
    // when both fit whole, otherwise one under the other, each wrapped.
    const billNo = present(bill.billNo);
    const cashier = present(bill.cashier);
    const cashierText = cashier ? asciiSafe(`Cashier: ${cashier}`) : '';
    const billNoText = billNo ? asciiSafe(`Bill No.: ${billNo}`) : '';
    if (cashierText && billNoText && cashierText.length + 1 + billNoText.length <= W) {
        line(cashierText + ' '.repeat(W - cashierText.length - billNoText.length) + billNoText);
    } else {
        for (const l of cashierText ? wrapText(cashierText, W) : []) { line(l); }
        for (const l of billNoText ? wrapText(billNoText, W) : []) { line(l); }
    }
    rule(true);

    // --- Items: Item | Qty. | Price | Amount, between thick rules -------------
    const { COL_ITEM, COL_QTY, COL_PRICE, COL_TOTAL } = billColumns(W);
    const pad = (s: string, n: number): string => s.length >= n ? s : s + ' '.repeat(n - s.length);
    const padL = (s: string, n: number): string => s.length >= n ? s : ' '.repeat(n - s.length) + s;
    line(pad('Item', COL_ITEM) + padL('Qty.', COL_QTY) + padL('Price', COL_PRICE) + padL('Amount', COL_TOTAL));
    rule(true);
    for (const it of bill.items) {
        // EVERY FIGURE KEEPS A SPACE IN FRONT OF IT. When any figure fills its
        // column, the name takes the full width and the figures move to their
        // own right-aligned line under it. See billItemRow.
        const { qtyText, priceText, amountText, fits } = billItemRow(it.quantity, it.price, W);
        const label = asciiSafe(it.name);
        if (fits) {
            const nameLines = wrapText(label, COL_ITEM - 1);
            line(
                pad(nameLines[0] ?? '', COL_ITEM) +
                padL(qtyText, COL_QTY) +
                padL(priceText, COL_PRICE) +
                padL(amountText, COL_TOTAL),
            );
            for (let i = 1; i < nameLines.length; i++) { line(nameLines[i] ?? ''); }
        } else {
            for (const l of wrapText(label, W)) { line(l); }
            const figures = `${qtyText} x ${priceText}  ${amountText}`;
            if (figures.length <= W) {
                line(padL(figures, W));
            } else {
                line(padL(`${qtyText} x ${priceText}`, W));
                line(padL(amountText, W));
            }
        }
    }
    rule(true);

    // --- Totals: the right-hand ladder ----------------------------------------
    // Every label right-aligned against ONE shared edge, every figure in the
    // amount column under the line amounts it sums.
    //
    // Every figure is known before the first rung prints, so the amount column
    // is sized once — to the widest figure plus a space, never narrower than the
    // item table's Amount column — and every label ends on the same column.
    // Sizing each row on its own value put "Grand Total" a column left of the
    // rungs above it on every bill of Rs 1000 or more.
    const totals = billTotals(bill);
    const grandText = money(bill.grandTotal);
    const ncText = bill.ncValue != null && Math.round(bill.ncValue * 100) > 0 ? bill.ncValue.toFixed(2) : null;
    const amtW = Math.max(COL_TOTAL, ...[totals.subtotal, ...totals.rungs.map((r) => r.value), totals.roundOff ?? '', grandText, ncText ?? '']
        .filter((v) => v.length > 0)
        .map((v) => v.length + 1));
    const labelW = Math.max(1, W - amtW);
    /**
     * One rung. A label too long for its side WRAPS, right-aligned, with the
     * figure on its last line — cutting it would drop the rate off a tax line on
     * a tax document. Only a label that does not fit goes through wrapText, which
     * rejoins words with single spaces: "Total Qty: 19   Sub Total" keeps its gap.
     */
    const ladder = (label: string, value: string): void => {
        const folded = asciiSafe(label);
        const parts = folded.length <= labelW ? [folded] : wrapText(folded, labelW);
        parts.forEach((part, i) => {
            const lead = ' '.repeat(Math.max(0, labelW - part.length)) + part;
            line(i === parts.length - 1 && value ? lead + ' '.repeat(amtW - value.length) + value : lead);
        });
    };
    const qtyAndSub = `Total Qty: ${String(totals.totalQty)}   Sub Total`;
    if (qtyAndSub.length <= labelW) {
        ladder(qtyAndSub, totals.subtotal);
    } else {
        // The 58mm roll: two rows rather than a row the printer wraps mid-word.
        ladder(`Total Qty: ${String(totals.totalQty)}`, '');
        ladder('Sub Total', totals.subtotal);
    }
    for (const r of totals.rungs) { ladder(r.label, r.value); }
    rule();
    if (totals.roundOff !== null) { ladder('Round off', totals.roundOff); }
    // The grand total: bold and DOUBLE HEIGHT — the one figure bigger than the
    // rest. Double height costs no columns, so it is laid out as a ladder row.
    raw(ESC, 0x45, 0x01);
    raw(ESC, 0x21, MODE_TALL | MODE_BOLD);
    ladder('Grand Total', grandText);
    raw(ESC, 0x21, 0x00);
    raw(ESC, 0x45, 0x00);
    rule();
    // Beside the ladder, never in it: what the comped lines were worth.
    if (ncText !== null) {
        ladder('NC value (not charged)', ncText);
        rule();
    }

    // --- Footer (centred): the disclaimer, bold, then the valet/feedback QR ---
    raw(ESC, 0x61, 0x01);
    const note = present(bill.serviceChargeNote);
    if (note) {
        raw(ESC, 0x45, 0x01);
        for (const l of wrapText(asciiSafe(note), W)) { line(l); }
        raw(ESC, 0x45, 0x00);
    }
    // No feedback URL — including an owner who switched the bill's QR off
    // (bill_show_qr) — prints no sentence and no QR, exactly as escpos.ts.
    if (bill.feedbackUrl) {
        if (note) { rule(); }
        const qrNote = present(bill.qrNote);
        if (qrNote) {
            for (const l of wrapText(asciiSafe(qrNote), W)) { line(l); }
        }
        text('\n');
        chunks.push(escposQr(bill.feedbackUrl, 6));
        text('\n');
    }
    text('\n\n\n');
    raw(GS, 0x56, 0x00); // full cut

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
}

// ---------------------------------------------------------------------------
// READING IT BACK — the "ESC/POS Preview" panel on the print page
// ---------------------------------------------------------------------------

/**
 * The bytes as readable text: commands dropped, alignment applied, each raster
 * shown as what it is. A plain TextDecoder over this stream shows hundreds of
 * replacement characters for every rule, and — because a thin rule's header
 * carries a 0x0A — breaks a line in the middle of one. So GS v 0 blocks are
 * stepped over by their header length, never by searching for a newline.
 *
 * `width` is the roll's columns; a GS W in the stream (the 80mm bill's print
 * area) narrows it to the text area, which is what centred lines centre in.
 */
export function billEscPosPreviewText(bytes: Uint8Array, width = 48): string {
    const out: string[] = [];
    let cols = width;
    let align = 0;
    let cur = '';
    const flush = (): void => {
        const pad = !cur.trim() ? 0
            : align === 1 ? Math.max(0, Math.floor((cols - cur.length) / 2))
            : align === 2 ? Math.max(0, cols - cur.length) : 0;
        out.push(' '.repeat(pad) + cur);
        cur = '';
    };
    const marker = (s: string): void => {
        if (cur) { flush(); }
        out.push(s);
    };
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i] ?? 0;
        const n1 = bytes[i + 1] ?? 0;
        if (b === ESC) {
            if (n1 === 0x40) { i += 2; continue; }
            if (n1 === 0x61) { align = bytes[i + 2] ?? 0; i += 3; continue; }
            i += 3; // ESC E n, ESC ! n, and every other one-argument command here
            continue;
        }
        if (b === GS) {
            if (n1 === 0x4c) { i += 4; continue; }
            if (n1 === 0x57) { cols = Math.max(1, Math.round(((bytes[i + 2] ?? 0) | ((bytes[i + 3] ?? 0) << 8)) / DOTS_PER_COL)); i += 4; continue; }
            if (n1 === 0x76 && bytes[i + 2] === 0x30) {
                const widthBytes = (bytes[i + 4] ?? 0) | ((bytes[i + 5] ?? 0) << 8);
                const height = (bytes[i + 6] ?? 0) | ((bytes[i + 7] ?? 0) << 8);
                const body = bytes.subarray(i + 8, i + 8 + widthBytes * height);
                let ink = 0;
                let solid = true;
                for (let y = 0; y < height && solid; y++) {
                    const first = body[y * widthBytes] ?? 0;
                    if (first === 0) {
                        for (let x = 0; x < widthBytes; x++) { if (body[y * widthBytes + x]) { solid = false; break; } }
                    } else if (first === 0xff) {
                        ink++;
                    } else {
                        solid = false;
                    }
                }
                const ruleCols = Math.max(1, Math.round((widthBytes * 8) / DOTS_PER_COL));
                marker(solid && ink > 0 ? (ink >= 4 ? '━' : '─').repeat(ruleCols) : `[logo ${String(widthBytes * 8)}x${String(height)} dots]`);
                i += 8 + widthBytes * height;
                continue;
            }
            if (n1 === 0x28 && bytes[i + 2] === 0x6b) {
                const len = (bytes[i + 3] ?? 0) | ((bytes[i + 4] ?? 0) << 8);
                // cn fn m: 0x31 0x50 0x30 stores the data that follows.
                if (bytes[i + 5] === 0x31 && bytes[i + 6] === 0x50) {
                    marker(`[QR ${String.fromCharCode(...bytes.subarray(i + 8, i + 5 + len))}]`);
                }
                i += 5 + len;
                continue;
            }
            i += 3; // GS V n
            continue;
        }
        if (b === 0x0a) { flush(); i++; continue; }
        cur += String.fromCharCode(b);
        i++;
    }
    if (cur) { flush(); }
    return out.join('\n');
}
