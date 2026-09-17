// "WHEN WAIVING A SERVICE CHARGE, THE REASON SHOULD NOT BE MANDATORY" — the
// dashboard's half (app 2.0.1).
//
// The server stores a missing reason as NULL (migration 051) and refuses as it
// always did where that migration has not reached. What the dashboard can get
// quietly wrong:
//
//   * THE BUTTON STAYS DEAD. "Remove service charge & print" used to need a
//     reason; it now needs the kind (chosen already) and the authoriser only.
//   * EVERY OTHER REASON GOES OPTIONAL TOO. ReasonField is shared with the comp,
//     the void and the cancel; only the waiver may pass `optional`. "Put the
//     charge back" and the tender void keep their must-say-why prompts.
//   * "NO REASON" SENT AS "". An older server refused "" in its schema with a
//     generic sentence; absent gets its clean refusal. A blank is left out.
//   * A NULL RENDERED AS A GAP. The live panel's line read `{reason} · authorised
//     by …`, which becomes ` · authorised by …` for a reasonless waiver.
//   * THE TWO CLIENTS DISAGREE. The till's label is "Reason (optional)" too.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    OPTIONAL_REASON_LABEL,
    SERVICE_CHARGE_WAIVER_KINDS,
    VOID_KINDS,
    serviceChargeWaiverAttribution,
    serviceChargeWaiverFormReady,
    type ServiceChargeWaiverRecord,
} from '../mis-capture';

describe('serviceChargeWaiverFormReady — the kind and the second name, not the reason', () => {
    it('THE ITEM: a blank reason no longer holds the button', () => {
        expect(serviceChargeWaiverFormReady({ kind: 'guest_request', authorisedBy: 'manager01' })).toBe(true);
    });

    it('the authoriser is still required, and whitespace is not a name', () => {
        expect(serviceChargeWaiverFormReady({ kind: 'guest_request', authorisedBy: '' })).toBe(false);
        expect(serviceChargeWaiverFormReady({ kind: 'guest_request', authorisedBy: '   ' })).toBe(false);
    });

    it('the kind is still required', () => {
        expect(serviceChargeWaiverFormReady({ kind: '', authorisedBy: 'manager01' })).toBe(false);
        expect(serviceChargeWaiverFormReady({ kind: '  ', authorisedBy: 'manager01' })).toBe(false);
    });
});

describe('serviceChargeWaiverAttribution — the live panel\'s line', () => {
    it('a waiver with a reason reads as it always did', () => {
        expect(serviceChargeWaiverAttribution({ reason: 'Long wait for the mains', authorised_by_username: 'manager01' }))
            .toBe('Long wait for the mains · authorised by manager01');
    });

    it.each([
        ['null', null],
        ['absent', undefined],
        ['empty', ''],
        ['whitespace', '   '],
    ])('a reason that is %s leaves no gap, dot or dash in front of the authoriser', (_label, reason) => {
        const line = serviceChargeWaiverAttribution({ reason, authorised_by_username: 'manager01' });
        expect(line).toBe('authorised by manager01');
        expect(line).not.toMatch(/·|“|"|null|undefined/);
    });

    it('takes the record as the server sends it, reason null included', () => {
        const live: Pick<ServiceChargeWaiverRecord, 'reason' | 'authorised_by_username'> = {
            reason: null, authorised_by_username: 'manager01',
        };
        expect(serviceChargeWaiverAttribution(live)).toBe('authorised by manager01');
    });
});

describe('the words', () => {
    it('the label says optional, in the words the till uses', () => {
        // restaurant_owner_app/lib/screens/mis_capture.dart: `'Reason (optional)'`.
        expect(OPTIONAL_REASON_LABEL).toBe('Reason (optional)');
    });

    it('the waiver\'s "Other" no longer tells anyone a reason is required; the void\'s still does', () => {
        const scOther = SERVICE_CHARGE_WAIVER_KINDS.find((o) => o.value === 'other');
        expect(scOther?.hint).toBe('None of the above — a line in the reason helps whoever reads the report.');
        expect(VOID_KINDS.find((o) => o.value === 'other')?.hint)
            .toBe('None of the above — say what happened in the reason.');
    });
});

// ---------------------------------------------------------------------------
// WIRING — the dialog uses all of it, and nothing else went optional
// ---------------------------------------------------------------------------

describe('wiring', () => {
    const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
    const ui = (): string => src('app/dashboard/orders/capture-actions.tsx');
    const waiverDialog = (): string => {
        const s = ui();
        return s.slice(s.indexOf('function WaiverDialog('), s.indexOf('// 037 — TENDERS AND TIPS'));
    };

    it('only the waiver passes `optional` to the shared ReasonField; the comp, the void and the cancel do not', () => {
        const fields = ui().match(/<ReasonField [^>]*\/>/g) ?? [];
        expect(fields).toHaveLength(4);
        expect(fields.filter((f) => /\boptional\b/.test(f))).toHaveLength(1);
        expect(waiverDialog()).toMatch(/<ReasonField [^>]*\boptional\b[^>]*\/>/);
    });

    it('ReasonField labels itself from the shared words', () => {
        expect(ui()).toContain('<Label htmlFor="capture-reason">{optional ? OPTIONAL_REASON_LABEL : "Reason"}</Label>');
        expect(ui()).toMatch(/function ReasonField\(\{ value, onChange, placeholder, optional = false \}/);
    });

    it('the button is gated on the kind and the authoriser only', () => {
        const dialog = waiverDialog();
        expect(dialog).toContain('disabled={busy || !serviceChargeWaiverFormReady({ kind, authorisedBy })}');
        expect(dialog).not.toContain('reason.trim().length === 0');
    });

    it('the live panel renders the attribution helper, not the raw reason', () => {
        const dialog = waiverDialog();
        expect(dialog).toContain('{serviceChargeWaiverAttribution(live)}');
        expect(dialog).not.toContain('{live.reason}');
    });

    it('"Put the charge back" still refuses a blank reason', () => {
        const dialog = waiverDialog();
        const reverse = dialog.slice(dialog.indexOf('const reverse = async'), dialog.indexOf('return (', dialog.indexOf('const reverse = async')));
        expect(reverse).toContain('if (why === null || why.trim().length === 0) {return}');
    });

    it('db.ts leaves a blank reason OUT of both waiver bodies', () => {
        const db = src('lib/db.ts');
        const remove = db.slice(db.indexOf('export const removeServiceChargeAndPrint'), db.indexOf('// --- 037: TENDERS AND TIPS'));
        expect(remove).toContain('if (body.reason?.trim()) {payload.reason = body.reason.trim();}');
        expect(remove).not.toMatch(/payload\.reason = body\.reason(?!\?\.trim\(\)|\.trim\(\))/);
        const waive = db.slice(db.indexOf('export const waiveServiceCharge'), db.indexOf('export const reverseServiceChargeWaiver'));
        expect(waive).toContain('reason?: string | null;');
        expect(waive).toContain('...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),');
        expect(waive).not.toContain('reason: body.reason,');
    });
});
