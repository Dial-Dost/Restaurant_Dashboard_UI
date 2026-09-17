// SESSION-WISE REPORTS — the part of the day a report is cut on.
//
// Client ask (item 3): "select time for hour-wise reports or session-wise
// reports; the superadmin should have an option to select what time slots he
// wants to see reports of; preset sessions lunch 12pm-5pm and dinner 6pm-12am."
//
// WHAT A SLOT IS, AND WHAT IT IS NOT
// ----------------------------------
// A slot is a TIME-OF-DAY filter laid over the date range: "Lunch, 1–15 Aug"
// means 12:00–17:00 restaurant time on each of those fifteen days. The SERVER
// applies it, on the clock each report already uses (settlement, order
// placement, or the act itself), and says what it applied in `meta.time_slot`.
// Nothing here filters, re-buckets or re-sums a row; this module only turns the
// reader's choice into query parameters and turns the server's answer back into
// words. A slot crossing midnight (22:00–02:00) belongs to the business day it
// STARTS on — the server's rule, repeated in the export's provenance so a filed
// sheet explains its own Friday-night figure.
//
// "SESSION" ON SCREEN, `time_slot` IN CODE. "Session" is what an owner calls
// Lunch and Dinner, so the copy uses it; in code the word already means table
// sessions and cash sessions, so the wire and the types say time_slot.
//
// THE PRESETS are the restaurant's own, stored server-side and served at
// GET /reports/mis/time-slots with a `can_edit` flag (the caller holds the
// settings permission — the superadmin always does). Anyone who can read a
// report can PICK a slot, because a slot reveals nothing the whole day did not;
// only `can_edit` may change the list.
//
// PARITY. The owner app mirrors every sentence and every rule below in
// lib/services/time_slot.dart. The two clients must send the same parameters,
// print the same labels and name the same files, so a change here is a change
// there in the same release.
//
// PURE — no React, no fetch, no `document`; the storage and URL helpers degrade
// to no-ops without `window`, like `date-range.ts`, because Next renders the page
// on the server first.

// --- The wire shapes ---------------------------------------------------------

/** What the server actually applied to a report (`meta.time_slot`). Null = all day. */
export interface MisTimeSlot {
    /** The preset's id, or null for custom times. */
    id: string | null;
    label: string;
    /** `HH:mm`, restaurant time. */
    start: string;
    /** `HH:mm`; may be `24:00`. */
    end: string;
    crosses_midnight: boolean;
    source: 'preset' | 'custom';
}

/** One of the restaurant's saved sessions. */
export interface ReportTimeSlotPreset {
    id: string;
    label: string;
    start: string;
    end: string;
    crosses_midnight: boolean;
}

/** GET/PUT /reports/mis/time-slots. */
export interface ReportTimeSlots {
    slots: ReportTimeSlotPreset[];
    /** The caller may change the list (holds the settings permission). */
    can_edit: boolean;
    /** True while the restaurant has never saved its own list. */
    is_default: boolean;
}

/** The server's ceiling on saved sessions. Mirrored so the editor stops at it. */
export const MAX_TIME_SLOTS = 8;
/** The server's label length limit. */
export const MAX_TIME_SLOT_LABEL = 24;

// --- Clock text --------------------------------------------------------------

/**
 * `HH:mm` → minutes after midnight, or null. `24:00` only where `allow24` —
 * an END may close at midnight, a START may not open there (that is 00:00).
 * One-digit hours are accepted ("9:30") because that is how people type; the
 * value always goes on the wire re-formatted as `09:30`.
 */
export const parseClock = (text: unknown, opts: { allow24?: boolean } = {}): number | null => {
    if (typeof text !== 'string') {return null;}
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) {return null;}
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h === 24 && min === 0) {return opts.allow24 ? 1440 : null;}
    if (h > 23 || min > 59) {return null;}
    return h * 60 + min;
};

/**
 * An END time in minutes, with `00:00` read as midnight (1440) — the server's
 * rule, so "12:00 to 00:00" is Lunch-to-midnight and never an empty or a
 * day-long crossing slot. Null when unreadable.
 */
export const parseEndClock = (text: unknown): number | null => {
    const m = parseClock(text, { allow24: true });
    return m === 0 ? 1440 : m;
};

/** Minutes → `HH:mm`. 1440 is `24:00`. */
export const formatClock = (minutes: number): string => {
    const total = Math.max(0, Math.min(1440, Math.round(minutes)));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** `12:00–17:00`. An en dash, the same glyph the date range uses. */
export const clockRange = (start: string, end: string): string => `${start}–${end}`;

/**
 * Is a custom from/to pair usable? Null when it is; otherwise the one sentence
 * the form shows. 00:00–24:00 is valid — it is simply all day, and
 * `normaliseSlotSelection` turns it into exactly that.
 */
export const validateCustomSlot = (from: string, to: string): string | null => {
    const start = parseClock(from);
    if (start === null) {return 'Start time must be a 24-hour time between 00:00 and 23:59.';}
    const end = parseEndClock(to);
    if (end === null) {return 'End time must be a 24-hour time between 00:00 and 24:00.';}
    if (start === end) {return 'Start and end are the same time — choose two different times.';}
    return null;
};

/** A slot whose end is earlier than its start runs past midnight. */
export const crossesMidnight = (from: string, to: string): boolean => {
    const start = parseClock(from);
    const end = parseEndClock(to);
    return start !== null && end !== null && end < start;
};

/**
 * Read a time-slots response defensively. A slot the server sent in a shape this
 * client cannot read is dropped rather than rendered as `undefined–undefined`;
 * a body with no usable list at all is null, and the screen offers no picker.
 */
export const readTimeSlots = (raw: unknown): ReportTimeSlots | null => {
    if (raw === null || typeof raw !== 'object') {return null;}
    const body = raw as Record<string, unknown>;
    if (!Array.isArray(body.slots)) {return null;}
    const slots: ReportTimeSlotPreset[] = [];
    for (const item of body.slots) {
        if (item === null || typeof item !== 'object') {continue;}
        const s = item as Record<string, unknown>;
        const id = typeof s.id === 'string' ? s.id : '';
        const label = typeof s.label === 'string' ? s.label : '';
        const start = typeof s.start === 'string' ? s.start : '';
        const end = typeof s.end === 'string' ? s.end : '';
        if (!id || parseClock(start) === null || parseClock(end, { allow24: true }) === null) {continue;}
        slots.push({ id, label: label || id, start, end, crosses_midnight: s.crosses_midnight === true });
    }
    return { slots, can_edit: body.can_edit === true, is_default: body.is_default === true };
};

// --- The reader's choice -----------------------------------------------------

export type TimeSlotSelection =
    | { kind: 'all' }
    | { kind: 'preset'; id: string }
    | { kind: 'custom'; from: string; to: string };

/**
 * THE all-day value. One shared object, so a screen that compares selections by
 * identity (a memo, an effect dependency) does not refetch a report because a
 * second `{kind:'all'}` was minted somewhere.
 */
export const ALL_DAY: TimeSlotSelection = Object.freeze({ kind: 'all' });

/**
 * Coerce any selection into a legal one. Custom times are validated and
 * re-formatted; 00:00–24:00 IS all day; anything unusable falls back to all day
 * rather than sending the server a question it would clamp.
 */
export const normaliseSlotSelection = (sel: TimeSlotSelection | null | undefined): TimeSlotSelection => {
    if (!sel || sel.kind === 'all') {return ALL_DAY;}
    if (sel.kind === 'preset') {
        // Ids are lower-case slugs and the server lower-cases `?slot=` before it
        // looks one up, so a hand-typed `?slot=Dinner` is Dinner here too —
        // not an unknown id quietly reconciled away to all day.
        const id = typeof sel.id === 'string' ? sel.id.trim().toLowerCase() : '';
        return id && id !== 'all' ? { kind: 'preset', id } : ALL_DAY;
    }
    if (validateCustomSlot(sel.from, sel.to) !== null) {return ALL_DAY;}
    const start = parseClock(sel.from) ?? 0;
    const end = parseEndClock(sel.to) ?? 1440;
    if (start === 0 && end === 1440) {return ALL_DAY;}
    return { kind: 'custom', from: formatClock(start), to: formatClock(end) };
};

/** A stable string for a selection — an effect dependency, a memo key. */
export const slotSelectionKey = (sel: TimeSlotSelection): string =>
    sel.kind === 'all' ? 'all' : sel.kind === 'preset' ? `preset:${sel.id}` : `custom:${sel.from}-${sel.to}`;

/**
 * What a selection MEANS right now, as a string: the key, plus everything the
 * server builds its answer from that the request itself does not carry.
 *
 * `slot=lunch` is the same URL before and after an owner moves Lunch from
 * 12:00–17:00 to 11:00–15:00, so a screen that refetched only when the request
 * changed would keep the old Lunch's numbers under the new Lunch's name. So a
 * picked preset's hours are in the key — and its NAME, because the caption, the
 * export's "Time slot" row and its filename are all spelled from the name the
 * server applied, and a rename would otherwise leave them on the old one.
 *
 * `bucket` is the cut actually SENT (undefined where the report takes none).
 * "By session" goes further than the pick: its rows ARE the presets — "Lunch
 * (12:00-17:00)", "Dinner (18:00-24:00)", then Outside sessions — whatever is
 * picked, All day included, where the pick alone keys as plain `all`. Saving any
 * preset reshapes that table under an unchanged URL, so for that cut the whole
 * list is part of the question.
 */
export const slotDefinitionKey = (
    sel: TimeSlotSelection,
    presets: readonly ReportTimeSlotPreset[],
    bucket?: MisBucket,
): string => {
    const key = slotSelectionKey(sel);
    const picked = sel.kind === 'preset' ? presets.find((x) => x.id === sel.id) : undefined;
    const pick = picked ? `${key}@${picked.start}-${picked.end}/${picked.label}` : key;
    if (bucket !== 'session') {return pick;}
    return `${pick}#${JSON.stringify(presets.map((p) => [p.id, p.label, p.start, p.end]))}`;
};

/** The `MisQuery` fields for a selection. All day adds nothing at all. */
export const slotQuery = (sel: TimeSlotSelection): { slot?: string; timeFrom?: string; timeTo?: string } => {
    if (sel.kind === 'preset') {return { slot: sel.id };}
    if (sel.kind === 'custom') {return { timeFrom: sel.from, timeTo: sel.to };}
    return {};
};

/**
 * The query-string pairs for a MIS request, per the API contract: custom times
 * WIN over a preset (the same precedence from/to has over days), and `slot=all`
 * is never sent — absent already means all day, and an absent parameter keeps
 * the URL (and the read cache keyed on it) identical to before this feature.
 */
export const misSlotParams = (q: { slot?: string; timeFrom?: string; timeTo?: string }): [string, string][] => {
    const from = q.timeFrom?.trim();
    const to = q.timeTo?.trim();
    if (from && to) {return [['time_from', from], ['time_to', to]];}
    const slot = q.slot?.trim();
    if (slot && slot !== 'all') {return [['slot', slot]];}
    return [];
};

/** `Lunch · 12:00–17:00` — how a preset reads in the picker. */
export const presetOptionLabel = (p: { label: string; start: string; end: string }): string =>
    `${p.label} · ${clockRange(p.start, p.end)}`;

/** What the picker's trigger says. */
export const slotSelectionLabel = (sel: TimeSlotSelection, presets: readonly ReportTimeSlotPreset[]): string => {
    if (sel.kind === 'custom') {return `Custom · ${clockRange(sel.from, sel.to)}`;}
    if (sel.kind === 'preset') {
        const p = presets.find((x) => x.id === sel.id);
        return p ? presetOptionLabel(p) : 'All day';
    }
    return 'All day';
};

/**
 * A remembered preset that the restaurant has since deleted is not a filter any
 * more. Falling back to all day, visibly, beats sending an id the server would
 * clamp to all day anyway while the trigger still claimed "Lunch".
 */
export const reconcileSlotSelection = (
    sel: TimeSlotSelection,
    presets: readonly ReportTimeSlotPreset[],
): TimeSlotSelection => (sel.kind === 'preset' && !presets.some((p) => p.id === sel.id) ? ALL_DAY : sel);

// --- What the server applied, in words --------------------------------------

/** `Lunch (12:00–17:00)`, or just `22:00–02:00` for custom times. */
export const timeSlotPhrase = (slot: MisTimeSlot): string =>
    slot.source === 'preset' && slot.label
        ? `${slot.label} (${clockRange(slot.start, slot.end)})`
        : clockRange(slot.start, slot.end);

/** The export's "Time slot" provenance row. */
export const timeSlotProvenance = (slot: MisTimeSlot | null | undefined): string => {
    if (!slot) {return 'All day';}
    const base = `${timeSlotPhrase(slot)} restaurant time, on each day of the range`;
    return slot.crosses_midnight
        ? `${base} — crosses midnight, so each night is counted on the day it starts`
        : base;
};

/**
 * `_lunch-1200-1700` — appended to an export's filename ONLY when a slot was
 * applied, so every all-day filename stays exactly what it was. Lower-case
 * a–z/0–9 slug, the same rule the owner app's `fileStem` uses, so the two
 * clients name one export the same way.
 */
export const timeSlotFileSuffix = (slot: MisTimeSlot | null | undefined): string => {
    if (!slot) {return '';}
    // The server's slug, exactly: NFKD so "Café" is `cafe`, 32 at most, and
    // `slot` when nothing survives (a label in another script).
    const slug = slot.label.toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '') || 'slot';
    const hhmm = (s: string): string => s.replace(/[^0-9]/g, '');
    return `_${slug}-${hhmm(slot.start)}-${hhmm(slot.end)}`;
};

// --- Clamps ------------------------------------------------------------------

/** The clamp names that are about the SLOT, not the dates. */
export const SLOT_CLAMPS: readonly string[] = ['slot_unknown', 'time_unparseable', 'time_empty'];

const SLOT_CLAMP_NOTICE: Readonly<Record<string, string>> = {
    slot_unknown: 'That session no longer exists — showing all day',
    time_unparseable: 'Those times could not be read — showing all day',
    time_empty: 'Start and end were the same — showing all day',
};

/**
 * The clamp names that are about the trading-day close (client item 9), not the
 * dates: a close that could not be read, or one sent with a session, is dropped
 * and the report is on calendar days. Neither shortens the range.
 */
export const DAY_CLOSE_CLAMPS: readonly string[] = ['day_close_unparseable', 'day_close_with_slot'];

const DAY_CLOSE_CLAMP_NOTICE: Readonly<Record<string, string>> = {
    day_close_unparseable: 'That closing time could not be read — showing calendar days',
    day_close_with_slot: 'A session is on calendar days — closing time not applied',
};

/**
 * What `meta.window.clamped` means for the toolbar.
 *
 * THE BUG THIS REPLACES. The server sends an ARRAY — `[]` when nothing was
 * adjusted — and this client typed it as a boolean and tested its truthiness.
 * `[]` is truthy, so "Range shortened" sat on every report ever opened. An
 * adjustment is a non-empty list, and a slot adjustment is not a date one: the
 * slot clamps get their own sentence, and only the rest shorten the range.
 */
export const clampNotices = (clamped: unknown): { range: boolean; slot: string | null } => {
    if (!Array.isArray(clamped)) {return { range: clamped === true, slot: null };}
    const names = clamped.filter((c): c is string => typeof c === 'string');
    const range = names.some((c) => !SLOT_CLAMPS.includes(c) && !DAY_CLOSE_CLAMPS.includes(c));
    const slotName = names.find((c) => SLOT_CLAMPS.includes(c));
    const closeName = names.find((c) => DAY_CLOSE_CLAMPS.includes(c));
    const notice = slotName ? SLOT_CLAMP_NOTICE[slotName] ?? null : closeName ? DAY_CLOSE_CLAMP_NOTICE[closeName] ?? null : null;
    return { range, slot: notice };
};

// --- The time-wise segment ---------------------------------------------------

export type MisBucket = 'day' | 'hour' | 'hour_of_day' | 'session';

/** In the order the segment shows them. The same four words as the owner app. */
export const MIS_BUCKETS: readonly { value: MisBucket; label: string }[] = [
    { value: 'day', label: 'Day-wise' },
    { value: 'hour', label: 'Hour-wise' },
    { value: 'hour_of_day', label: 'By hour of day' },
    { value: 'session', label: 'By session' },
];

/**
 * The segments this server can answer. The two new ones arrived with the
 * time-slot presets route, so they are offered only once that route has
 * answered — a "By session" button against a server that does not know the word
 * would be a control that silently returns the day-wise table.
 */
export const timeWiseOptions = (slotsAvailable: boolean): readonly { value: MisBucket; label: string }[] =>
    slotsAvailable ? MIS_BUCKETS : MIS_BUCKETS.filter((b) => b.value === 'day' || b.value === 'hour');

// --- The sessions editor -----------------------------------------------------

export interface TimeSlotDraft {
    /** Kept for a renamed session so its id (and any remembered pick) survives. */
    id?: string;
    label: string;
    start: string;
    end: string;
}

/**
 * The format checks the editor can make before a round trip. The SERVER stays
 * the authority — overlap on the 24-hour circle and id collisions are its to
 * judge, and its 400 sentence is shown verbatim — but a blank name or "25:00"
 * is caught here, in the same words, without asking.
 */
export const validateSlotDrafts = (drafts: readonly TimeSlotDraft[]): string | null => {
    if (drafts.length > MAX_TIME_SLOTS) {return `A restaurant can keep at most ${String(MAX_TIME_SLOTS)} sessions.`;}
    for (let i = 0; i < drafts.length; i += 1) {
        const d = drafts[i];
        const name = d.label.trim();
        const which = name || `Session ${String(i + 1)}`;
        if (name.length === 0 || name.length > MAX_TIME_SLOT_LABEL) {
            return `${which}: a session needs a name of 1 to ${String(MAX_TIME_SLOT_LABEL)} characters.`;
        }
        if (parseClock(d.start) === null) {return `${which}: start time must be between 00:00 and 23:59.`;}
        const end = parseEndClock(d.end);
        if (end === null) {return `${which}: end time must be between 00:00 and 24:00.`;}
        if (parseClock(d.start) === end) {return `${which}: start and end cannot be the same time.`;}
    }
    return null;
};

/** The PUT body. An empty list is the server's "reset to the defaults". */
export const slotDraftsBody = (drafts: readonly TimeSlotDraft[]): { slots: TimeSlotDraft[] } => ({
    slots: drafts.map((d) => {
        const start = parseClock(d.start);
        const end = parseEndClock(d.end);
        return {
            ...(d.id ? { id: d.id } : {}),
            label: d.label.trim(),
            start: start === null ? d.start.trim() : formatClock(start),
            end: end === null ? d.end.trim() : formatClock(end),
        };
    }),
});

// --- Per-screen memory and the URL ------------------------------------------
// Session-scoped, exactly like the date range it sits beside: "Dinner" is a
// question asked this afternoon, and tomorrow's first look should open on the
// whole day rather than a filter nobody remembers setting.

const storageKey = (screen: string): string => `rd-time-slot:${screen}`;

/**
 * `?slot=dinner`, or `?time_from=22:00&time_to=02:00`. Custom times win, as they
 * do on the server. Null when the URL names no slot, so the caller falls back to
 * the session's; `slot=all` is an explicit all day.
 */
export const slotSelectionFromParams = (
    params: { get(name: string): string | null } | null | undefined,
): TimeSlotSelection | null => {
    const from = params?.get('time_from');
    const to = params?.get('time_to');
    if (from && to) {return normaliseSlotSelection({ kind: 'custom', from, to });}
    const slot = params?.get('slot');
    if (slot) {return normaliseSlotSelection({ kind: 'preset', id: slot });}
    return null;
};

/**
 * The page's own query string with the slot written in (or taken out, for all
 * day). Every other parameter — `report`, `from`, `to` — is left exactly as it
 * was, so a link copied from the address bar reopens the same question.
 */
export const withSlotParams = (search: string, sel: TimeSlotSelection): string => {
    const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    qs.delete('slot');
    qs.delete('time_from');
    qs.delete('time_to');
    for (const [k, v] of misSlotParams(slotQuery(sel))) {qs.set(k, v);}
    const out = qs.toString();
    return out ? `?${out}` : '';
};

export const loadSlotSelection = (screen: string): TimeSlotSelection => {
    if (typeof window === 'undefined') {return ALL_DAY;}
    try {
        const raw = window.sessionStorage.getItem(storageKey(screen));
        if (!raw) {return ALL_DAY;}
        return normaliseSlotSelection(JSON.parse(raw) as TimeSlotSelection);
    } catch {
        return ALL_DAY;
    }
};

export const saveSlotSelection = (screen: string, sel: TimeSlotSelection): void => {
    if (typeof window === 'undefined') {return;}
    try {
        window.sessionStorage.setItem(storageKey(screen), JSON.stringify(sel));
    } catch {/* quota or private mode — the in-memory state still holds */}
};
