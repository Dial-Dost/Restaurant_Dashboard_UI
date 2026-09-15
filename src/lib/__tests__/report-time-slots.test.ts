// SESSION-WISE REPORTS — what the Reports screen sends and says about a slot.
//
// The server slices; nothing here can prove its arithmetic, and nothing here
// pretends to. What is pinned is every way THIS client could tell an owner
// something false about which hours a figure covers:
//
//   * a slot the reader picked that never reaches the request (or a custom pair
//     that loses to a preset the server would have let it beat);
//   * an all-day request whose URL changed, so the read cache and every old
//     filename quietly stop matching;
//   * "Range shortened" on every report, because `[]` is truthy — the bug that
//     shipped — and a slot clamp read as a date clamp;
//   * an export filename or provenance that names a slot the server did not
//     apply, or omits one it did;
//   * an editor that accepts "25:00" or refuses a legal 24:00 end;
//   * helpers that exist while the page never calls them.
//
// The words are pinned too, because the owner app prints the same ones
// (test/time_slot_test.dart pins its copy of each).

import * as fs from 'node:fs';
import * as path from 'node:path';

import { exportBaseName, reportDef, type MisReportMeta } from '../mis-reports';
import {
    ALL_DAY,
    MAX_TIME_SLOTS,
    clampNotices,
    crossesMidnight,
    formatClock,
    misSlotParams,
    normaliseSlotSelection,
    parseClock,
    parseEndClock,
    presetOptionLabel,
    readTimeSlots,
    reconcileSlotSelection,
    slotDraftsBody,
    slotQuery,
    slotDefinitionKey,
    slotSelectionFromParams,
    slotSelectionKey,
    slotSelectionLabel,
    timeSlotFileSuffix,
    timeSlotPhrase,
    timeSlotProvenance,
    timeWiseOptions,
    validateCustomSlot,
    validateSlotDrafts,
    withSlotParams,
    type MisTimeSlot,
    type ReportTimeSlotPreset,
} from '../report-time-slots';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DEFAULTS: ReportTimeSlotPreset[] = [
    { id: 'lunch', label: 'Lunch', start: '12:00', end: '17:00', crosses_midnight: false },
    { id: 'dinner', label: 'Dinner', start: '18:00', end: '24:00', crosses_midnight: false },
];

const LUNCH: MisTimeSlot = { id: 'lunch', label: 'Lunch', start: '12:00', end: '17:00', crosses_midnight: false, source: 'preset' };
const LATE: MisTimeSlot = { id: null, label: 'Custom', start: '22:00', end: '02:00', crosses_midnight: true, source: 'custom' };

const META: MisReportMeta = {
    report: 'sales_summary',
    title: 'Sales Summary',
    window: { from: '2026-08-01', to: '2026-08-15', days: 15, clamped: [] },
    timezone: 'Asia/Kolkata',
    outlet_scope: 'outlet',
    outlet_id: 'o-1',
    outlet_name: 'Gaia Test',
    generated_at: '2026-08-16T10:00:00.000Z',
    notes: [],
};

describe('clock text', () => {
    it('reads HH:mm, and 24:00 only as an END', () => {
        expect(parseClock('12:00')).toBe(720);
        expect(parseClock('9:30')).toBe(570);
        expect(parseClock('00:00')).toBe(0);
        expect(parseClock('23:59')).toBe(1439);
        expect(parseClock('24:00')).toBeNull();
        expect(parseClock('24:00', { allow24: true })).toBe(1440);
        for (const junk of ['25:00', '12:60', '1200', '', 'noon', '24:01', ' 12:3 ']) {
            expect(parseClock(junk, { allow24: true })).toBeNull();
        }
        // An END of 00:00 is midnight, as the server reads it.
        expect(parseEndClock('00:00')).toBe(1440);
        expect(parseEndClock('02:00')).toBe(120);
        expect(formatClock(570)).toBe('09:30');
        expect(formatClock(1440)).toBe('24:00');
    });

    it('validates a custom pair in the words the form shows', () => {
        expect(validateCustomSlot('12:00', '17:00')).toBeNull();
        expect(validateCustomSlot('22:00', '02:00')).toBeNull();
        expect(validateCustomSlot('18:00', '24:00')).toBeNull();
        expect(validateCustomSlot('24:00', '02:00')).toBe('Start time must be a 24-hour time between 00:00 and 23:59.');
        expect(validateCustomSlot('12:00', '25:00')).toBe('End time must be a 24-hour time between 00:00 and 24:00.');
        expect(validateCustomSlot('13:00', '13:00')).toBe('Start and end are the same time — choose two different times.');
        expect(crossesMidnight('22:00', '02:00')).toBe(true);
        expect(crossesMidnight('18:00', '24:00')).toBe(false);
        expect(crossesMidnight('18:00', '00:00')).toBe(false);
    });

    it('treats 00:00–24:00 as exactly all day, and junk as all day rather than a clamp', () => {
        expect(normaliseSlotSelection({ kind: 'custom', from: '00:00', to: '24:00' })).toBe(ALL_DAY);
        expect(normaliseSlotSelection({ kind: 'custom', from: '9:00', to: '13:30' })).toEqual({ kind: 'custom', from: '09:00', to: '13:30' });
        expect(normaliseSlotSelection({ kind: 'custom', from: 'x', to: '13:30' })).toBe(ALL_DAY);
        // "12:00 to 00:00" is until midnight, sent as 24:00; 00:00 to 00:00 is the whole day.
        expect(normaliseSlotSelection({ kind: 'custom', from: '12:00', to: '00:00' })).toEqual({ kind: 'custom', from: '12:00', to: '24:00' });
        expect(normaliseSlotSelection({ kind: 'custom', from: '00:00', to: '00:00' })).toBe(ALL_DAY);
        expect(normaliseSlotSelection({ kind: 'preset', id: 'all' })).toBe(ALL_DAY);
        // The server lower-cases `?slot=`; a hand-typed `Dinner` is Dinner, not a dead id.
        expect(normaliseSlotSelection({ kind: 'preset', id: ' Dinner ' })).toEqual({ kind: 'preset', id: 'dinner' });
        expect(normaliseSlotSelection({ kind: 'preset', id: 'ALL' })).toBe(ALL_DAY);
        expect(normaliseSlotSelection(null)).toBe(ALL_DAY);
    });
});

describe('what goes on the wire', () => {
    it('sends nothing at all for all day, so the URL is the one it always was', () => {
        expect(misSlotParams(slotQuery(ALL_DAY))).toEqual([]);
        expect(misSlotParams({ slot: 'all' })).toEqual([]);
        expect(misSlotParams({ slot: '  ' })).toEqual([]);
    });

    it('sends a preset as slot=, and custom times as time_from/time_to', () => {
        expect(misSlotParams(slotQuery({ kind: 'preset', id: 'dinner' }))).toEqual([['slot', 'dinner']]);
        expect(misSlotParams(slotQuery({ kind: 'custom', from: '22:00', to: '02:00' })))
            .toEqual([['time_from', '22:00'], ['time_to', '02:00']]);
    });

    it('lets custom times WIN over a preset, as the server does', () => {
        expect(misSlotParams({ slot: 'lunch', timeFrom: '13:00', timeTo: '14:00' }))
            .toEqual([['time_from', '13:00'], ['time_to', '14:00']]);
        // Half a pair is not a custom slot; the preset stands.
        expect(misSlotParams({ slot: 'lunch', timeFrom: '13:00' })).toEqual([['slot', 'lunch']]);
    });

    it('keys selections stably, so an effect does not refetch for an equal choice', () => {
        expect(slotSelectionKey(ALL_DAY)).toBe('all');
        expect(slotSelectionKey({ kind: 'preset', id: 'lunch' })).toBe('preset:lunch');
        expect(slotSelectionKey({ kind: 'custom', from: '22:00', to: '02:00' })).toBe('custom:22:00-02:00');
    });

    it('re-keys a preset when its hours are edited, though `slot=lunch` stays the same URL', () => {
        const lunch = { kind: 'preset', id: 'lunch' } as const;
        const moved = DEFAULTS.map((p) => (p.id === 'lunch' ? { ...p, start: '11:00', end: '15:00' } : p));
        expect(misSlotParams(slotQuery(lunch))).toEqual([['slot', 'lunch']]);
        expect(slotDefinitionKey(lunch, DEFAULTS)).toBe('preset:lunch@12:00-17:00');
        expect(slotDefinitionKey(lunch, moved)).toBe('preset:lunch@11:00-15:00');
        // Renaming alone asks nothing new: the hours, and so the numbers, are the same.
        expect(slotDefinitionKey(lunch, DEFAULTS.map((p) => ({ ...p, label: `${p.label}!` })))).toBe('preset:lunch@12:00-17:00');
        expect(slotDefinitionKey(ALL_DAY, DEFAULTS)).toBe('all');
        expect(slotDefinitionKey({ kind: 'custom', from: '22:00', to: '02:00' }, DEFAULTS)).toBe('custom:22:00-02:00');
    });
});

describe('the words — identical in the owner app', () => {
    it('labels presets and the trigger', () => {
        expect(presetOptionLabel(DEFAULTS[0])).toBe('Lunch · 12:00–17:00');
        expect(slotSelectionLabel(ALL_DAY, DEFAULTS)).toBe('All day');
        expect(slotSelectionLabel({ kind: 'preset', id: 'dinner' }, DEFAULTS)).toBe('Dinner · 18:00–24:00');
        expect(slotSelectionLabel({ kind: 'custom', from: '22:00', to: '02:00' }, DEFAULTS)).toBe('Custom · 22:00–02:00');
        // A deleted preset never keeps its old name on the trigger.
        expect(slotSelectionLabel({ kind: 'preset', id: 'brunch' }, DEFAULTS)).toBe('All day');
    });

    it('phrases what the server applied, and says where a crossing night is counted', () => {
        expect(timeSlotPhrase(LUNCH)).toBe('Lunch (12:00–17:00)');
        expect(timeSlotPhrase(LATE)).toBe('22:00–02:00');
        expect(timeSlotProvenance(null)).toBe('All day');
        expect(timeSlotProvenance(LUNCH)).toBe('Lunch (12:00–17:00) restaurant time, on each day of the range');
        expect(timeSlotProvenance(LATE)).toBe(
            '22:00–02:00 restaurant time, on each day of the range — crosses midnight, so each night is counted on the day it starts',
        );
    });

    it('offers the two new segments only where the presets route answered', () => {
        expect(timeWiseOptions(true).map((b) => b.label)).toEqual(['Day-wise', 'Hour-wise', 'By hour of day', 'By session']);
        expect(timeWiseOptions(true).map((b) => b.value)).toEqual(['day', 'hour', 'hour_of_day', 'session']);
        expect(timeWiseOptions(false).map((b) => b.value)).toEqual(['day', 'hour']);
    });
});

describe('the export filename', () => {
    it('adds the slot ONLY when the server applied one — the old pin still holds', () => {
        const d = reportDef('sales_summary');
        if (!d) {throw new Error('missing');}
        expect(exportBaseName(META, d)).toBe('sales-summary_Gaia-Test_2026-08-01_to_2026-08-15');
        expect(exportBaseName({ ...META, time_slot: null }, d)).toBe('sales-summary_Gaia-Test_2026-08-01_to_2026-08-15');
        expect(exportBaseName({ ...META, time_slot: LUNCH }, d)).toBe('sales-summary_Gaia-Test_2026-08-01_to_2026-08-15_lunch-1200-1700');
    });

    it('slugs the label and writes the times as HHMM, 24:00 included', () => {
        expect(timeSlotFileSuffix(null)).toBe('');
        expect(timeSlotFileSuffix({ ...LUNCH, id: 'dinner', label: 'Dinner', start: '18:00', end: '24:00' })).toBe('_dinner-1800-2400');
        expect(timeSlotFileSuffix(LATE)).toBe('_custom-2200-0200');
        expect(timeSlotFileSuffix({ ...LUNCH, label: 'Late / Night "Bar"' })).toBe('_late-night-bar-1200-1700');
        // The server's slug rules: NFKD, and `slot` when nothing survives.
        expect(timeSlotFileSuffix({ ...LUNCH, label: 'Café' })).toBe('_cafe-1200-1700');
        expect(timeSlotFileSuffix({ ...LUNCH, label: 'दोपहर' })).toBe('_slot-1200-1700');
    });
});

describe('clamps: a list, not a truthiness', () => {
    it('an empty list shortens nothing — the bug that put the badge on every report', () => {
        expect(clampNotices([])).toEqual({ range: false, slot: null });
        expect(clampNotices(undefined)).toEqual({ range: false, slot: null });
    });

    it('a date clamp shortens the range; a slot clamp says the slot was dropped instead', () => {
        expect(clampNotices(['span_capped'])).toEqual({ range: true, slot: null });
        expect(clampNotices(['slot_unknown'])).toEqual({ range: false, slot: 'That session no longer exists — showing all day' });
        expect(clampNotices(['time_unparseable']).slot).toBe('Those times could not be read — showing all day');
        expect(clampNotices(['future_to', 'time_empty'])).toEqual({ range: true, slot: 'Start and end were the same — showing all day' });
        // The legacy boolean shape still reads as a date clamp.
        expect(clampNotices(true)).toEqual({ range: true, slot: null });
    });
});

describe('the presets and the editor', () => {
    it('reads the route defensively, dropping a slot it cannot draw', () => {
        const got = readTimeSlots({
            slots: [...DEFAULTS, { id: 'x', label: 'Broken', start: 'noon', end: '17:00' }, null],
            can_edit: true,
            is_default: true,
        });
        expect(got?.slots.map((s) => s.id)).toEqual(['lunch', 'dinner']);
        expect(got?.can_edit).toBe(true);
        expect(readTimeSlots({ error: 'Forbidden' })).toBeNull();
        expect(readTimeSlots(null)).toBeNull();
    });

    it('falls back to all day when a remembered preset has been deleted', () => {
        expect(reconcileSlotSelection({ kind: 'preset', id: 'brunch' }, DEFAULTS)).toBe(ALL_DAY);
        expect(reconcileSlotSelection({ kind: 'preset', id: 'lunch' }, DEFAULTS)).toEqual({ kind: 'preset', id: 'lunch' });
        expect(reconcileSlotSelection({ kind: 'custom', from: '22:00', to: '02:00' }, [])).toEqual({ kind: 'custom', from: '22:00', to: '02:00' });
    });

    it('catches format mistakes before a round trip, and allows what the server allows', () => {
        expect(validateSlotDrafts([{ label: 'Lunch', start: '12:00', end: '17:00' }, { label: 'Late', start: '22:00', end: '02:00' }])).toBeNull();
        expect(validateSlotDrafts([{ label: 'Dinner', start: '18:00', end: '24:00' }])).toBeNull();
        expect(validateSlotDrafts([{ label: 'Whole day', start: '00:00', end: '24:00' }])).toBeNull();
        expect(validateSlotDrafts([{ label: 'Evening', start: '18:00', end: '00:00' }])).toBeNull();
        expect(validateSlotDrafts([{ label: '  ', start: '12:00', end: '17:00' }]))
            .toBe('Session 1: a session needs a name of 1 to 24 characters.');
        expect(validateSlotDrafts([{ label: 'Lunch', start: '25:00', end: '17:00' }]))
            .toBe('Lunch: start time must be between 00:00 and 23:59.');
        expect(validateSlotDrafts([{ label: 'Lunch', start: '12:00', end: '24:30' }]))
            .toBe('Lunch: end time must be between 00:00 and 24:00.');
        expect(validateSlotDrafts([{ label: 'Lunch', start: '12:00', end: '12:00' }]))
            .toBe('Lunch: start and end cannot be the same time.');
        const nine = Array.from({ length: MAX_TIME_SLOTS + 1 }, (_, i) => ({ label: `S${String(i)}`, start: `${String(i).padStart(2, '0')}:00`, end: `${String(i).padStart(2, '0')}:30` }));
        expect(validateSlotDrafts(nine)).toBe('A restaurant can keep at most 8 sessions.');
    });

    it('sends the whole list, keeping ids of renamed rows and normalising times', () => {
        expect(slotDraftsBody([
            { id: 'lunch', label: ' Brunch ', start: '11:00', end: '15:00' },
            { label: 'Late', start: '9:05', end: '00:00' },
        ])).toEqual({
            slots: [
                { id: 'lunch', label: 'Brunch', start: '11:00', end: '15:00' },
                { label: 'Late', start: '09:05', end: '24:00' },
            ],
        });
        // The reset: an empty list, which the server reads as "back to the defaults".
        expect(slotDraftsBody([])).toEqual({ slots: [] });
    });
});

describe('the URL', () => {
    const params = (qs: string): URLSearchParams => new URLSearchParams(qs);

    it('opens on the slot a link names; custom beats preset; nothing named falls through', () => {
        expect(slotSelectionFromParams(params('slot=dinner'))).toEqual({ kind: 'preset', id: 'dinner' });
        expect(slotSelectionFromParams(params('slot=lunch&time_from=22:00&time_to=02:00'))).toEqual({ kind: 'custom', from: '22:00', to: '02:00' });
        expect(slotSelectionFromParams(params('slot=all'))).toBe(ALL_DAY);
        expect(slotSelectionFromParams(params('slot=Dinner'))).toEqual({ kind: 'preset', id: 'dinner' });
        expect(slotSelectionFromParams(params('report=discount'))).toBeNull();
        expect(slotSelectionFromParams(null)).toBeNull();
    });

    it('writes the slot in and takes it out, leaving every other parameter alone', () => {
        expect(withSlotParams('?report=sales_summary&from=2026-08-01', { kind: 'preset', id: 'dinner' }))
            .toBe('?report=sales_summary&from=2026-08-01&slot=dinner');
        expect(withSlotParams('?report=sales_summary&slot=dinner', { kind: 'custom', from: '22:00', to: '02:00' }))
            .toBe('?report=sales_summary&time_from=22%3A00&time_to=02%3A00');
        expect(withSlotParams('?report=sales_summary&time_from=22:00&time_to=02:00', ALL_DAY)).toBe('?report=sales_summary');
        expect(withSlotParams('?slot=lunch', ALL_DAY)).toBe('');
    });
});

// --- Wiring: built AND called ------------------------------------------------
//
// This project's most repeated defect is correct code that nothing calls. Each
// pin below is one link of the chain from the picker to the request and back to
// the words on screen and in the file.

describe('wiring', () => {
    const db = code(readSource('src/lib/db.ts'));
    const page = code(readSource('src/app/dashboard/reports/page.tsx'));
    const picker = code(readSource('src/app/dashboard/reports/time-slot-picker.tsx'));
    const exporter = code(readSource('src/app/dashboard/reports/export.ts'));

    it('every MIS request carries the slot parameters', () => {
        const fn = db.slice(db.indexOf('const misSearchParams'), db.indexOf('const misFetch'));
        expect(fn).toMatch(/misSlotParams\(q\)/);
        expect(db).toMatch(/slot\?: string;/);
        expect(db).toMatch(/timeFrom\?: string;/);
        expect(db).toMatch(/bucket\?: MisBucket;/);
    });

    it('reads and replaces the presets on the contract route', () => {
        const get = db.slice(db.indexOf('export const getReportTimeSlots'), db.indexOf('export const saveReportTimeSlots'));
        expect(get).toContain('/reports/mis/time-slots');
        const save = db.slice(db.indexOf('export const saveReportTimeSlots'), db.indexOf('export const getMisBillDetail'));
        expect(save).toContain('/reports/mis/time-slots');
        expect(save).toContain("method: 'PUT'");
        expect(save).toContain('slotDraftsBody(drafts)');
        // Returned, never thrown: production strips a thrown message.
        expect(save).not.toMatch(/throw new Error/);
    });

    it('the page puts the picker beside the range and the slot into the query', () => {
        expect(page).toMatch(/<TimeSlotPicker[\s\S]*?onSave=\{\(drafts\) => saveReportTimeSlots\(rid, drafts\)\}/);
        expect(page).toContain('getReportTimeSlots(rid)');
        const base = page.slice(page.indexOf('const baseQuery'), page.indexOf('const waitForSlots'));
        expect(base).toMatch(/slot: slotParams\.slot/);
        expect(base).toMatch(/timeFrom: slotParams\.timeFrom/);
        expect(base).toMatch(/timeTo: slotParams\.timeTo/);
        // A new slot — or new hours behind the same slot — is a new question:
        // back to page one, and fetched again even though the URL is unchanged.
        expect(page).toContain('slotDefinitionKey(effectiveSlot, slotCatalogue?.slots ?? [])');
        expect(page).toMatch(/setOffset\(0\) \}, \[[^\]]*slotDefKey\]/);
        expect(page).toMatch(/getMisReport\(rid, def\.path[\s\S]*?\}, \[[^\]]*slotDefKey\]\)/);
        // …remembered like the range, and on the URL.
        expect(page).toContain('saveSlotSelection("reports", next)');
        expect(page).toContain('withSlotParams(window.location.search, next)');
    });

    it('the segment is driven by the four buckets, and the words name the server\'s slot', () => {
        expect(page).toMatch(/bucketOptions\.map\(/);
        expect(page).not.toMatch(/\["day", "hour"\] as const/);
        expect(page).toMatch(/Dated \{CLOCK_LABELS\[def\.clock\]\.short\}\{slotPhrase/);
        expect(page).toMatch(/meta\?\.time_slot \? timeSlotPhrase\(meta\.time_slot\)/);
    });

    it('no truthiness test of clamped survives, on screen or in the file', () => {
        expect(page).not.toMatch(/window\.clamped &&/);
        expect(page).toContain('clampNotices(meta?.window.clamped)');
        expect(exporter).not.toMatch(/if \(m\?\.window\.clamped\)/);
        expect(exporter).toContain('clampNotices(m?.window.clamped)');
        expect(exporter).toContain("['Time slot', m ? timeSlotProvenance(m.time_slot) : '—']");
        expect(exporter).toContain('title: titleOf(ctx)');
    });

    it('offers "Manage sessions" only to a caller the server says may edit', () => {
        expect(page).toContain('canEdit={slotCatalogue.can_edit}');
        expect(picker).toMatch(/\{canEdit && \([\s\S]*?Manage sessions…/);
        expect(picker).toMatch(/\{canEdit && \([\s\S]*?<ManageSessionsDialog/);
    });
});
