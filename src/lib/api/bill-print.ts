/**
 * Bill-print flow — the reads and writes behind the in-place bill preview
 * (Flutter `_BillPreviewDialog`), the live-table name/GSTIN/address dialog and
 * the per-line KOT actions (note / remove / move). docs/parity/bill-preview.md.
 */

import { requestBackend } from '@/lib/db';
import { billCustomerSaveOutcome, type BillCustomerSaveOutcome } from '@/lib/bill-customer';
import { refusalSentence } from '@/lib/error-message';

type Row = Record<string, unknown>;

const failMessage = (res: { data: unknown; text: string }, fallback: string): string => {
    const said = refusalSentence(res.data) ?? refusalSentence((() => {
        try { return JSON.parse(res.text) as unknown; } catch { return null; }
    })());
    return said ?? fallback;
};

/* ── The paper's width (finding 5) ─────────────────────────────────────── */

/** `bill_paper_width` off /restaurant/settings: true for the 58mm roll. False on any failure. */
export const fetchBillPaperNarrow = async (restaurantId: string): Promise<boolean> => {
    try {
        const res = await requestBackend<Row>({ path: '/restaurant/settings', method: 'GET', restaurantId });
        if (!res.ok || res.data === null) { return false; }
        const raw = res.data.bill_paper_width;
        return typeof raw === 'string' && raw.trim().toLowerCase().startsWith('58');
    } catch {
        return false;
    }
};

/* ── The live-table customer write, address included (finding 13) ─────── */

export type TableBillCustomerOutcome = BillCustomerSaveOutcome & {
    /** `undefined` when the response carried no `customer_address` key (an older server). */
    customer_address?: string | null;
};

/**
 * POST /bills/customer-name — name, GSTIN and address on a running table.
 * An omitted `gstin` / `address` leaves that field unchanged; `null`/'' clears it.
 */
export const saveTableBillCustomer = async (
    restaurantId: string,
    tableName: string,
    input: { customer: string; gstin?: string | null; address?: string | null },
): Promise<TableBillCustomerOutcome> => {
    const body: Row = { table_name: tableName, customer: input.customer };
    if (input.gstin !== undefined) {
        body.customer_gstin = input.gstin === null || input.gstin.trim() === '' ? null : input.gstin.trim();
    }
    if (input.address !== undefined) {
        body.customer_address = input.address === null || input.address.trim() === '' ? null : input.address;
    }
    const res = await requestBackend({ restaurantId, path: '/bills/customer-name', method: 'POST', body });
    const outcome = await billCustomerSaveOutcome(res.status, res.text, input.gstin !== undefined);
    if (!outcome.ok) { return outcome; }
    let address: string | null | undefined;
    try {
        const parsed: unknown = JSON.parse(res.text);
        if (parsed !== null && typeof parsed === 'object' && 'customer_address' in parsed) {
            const raw = (parsed as { customer_address?: unknown }).customer_address;
            address = typeof raw === 'string' ? raw : null;
        }
    } catch {
        /* no JSON body — the address stays unknown */
    }
    return { ...outcome, customer_address: address };
};

/* ── Per-line KOT actions (findings 19–20) ─────────────────────────────── */

/** POST /bills/item-note — any staff; '' clears the note. */
export const saveBillItemNote = async (
    restaurantId: string,
    tableName: string,
    item: { name: string; price: number },
    note: string,
): Promise<void> => {
    const res = await requestBackend({
        restaurantId,
        path: '/bills/item-note',
        method: 'POST',
        body: { table_name: tableName, item_name: item.name, price: item.price, note },
    });
    if (!res.ok) { throw new Error(failMessage(res, 'Could not save the note.')); }
};

/** POST /bills/remove-item — admin. */
export const removeBillItem = async (
    restaurantId: string,
    tableName: string,
    item: { name: string; price: number },
): Promise<void> => {
    const res = await requestBackend({
        restaurantId,
        path: '/bills/remove-item',
        method: 'POST',
        body: { table_name: tableName, item_name: item.name, price: item.price },
    });
    if (!res.ok) { throw new Error(failMessage(res, 'Could not remove the item.')); }
};

/** POST /bills/move-item — admin. Returns the raw answer (reprint notices ride on it). */
export const moveBillItem = async (
    restaurantId: string,
    fromTable: string,
    toTable: string,
    item: { name: string; price: number },
): Promise<unknown> => {
    const res = await requestBackend({
        restaurantId,
        path: '/bills/move-item',
        method: 'POST',
        body: { from_table: fromTable, to_table: toTable, item_name: item.name, price: item.price },
    });
    if (!res.ok) { throw new Error(failMessage(res, 'Could not move the item.')); }
    return res.data;
};
