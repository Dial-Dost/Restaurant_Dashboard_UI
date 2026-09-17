// EMAIL REPORTS ON THE DASHBOARD (client item 9), PINNED.
//
//   * the pure rules the Email reports area and the Send-now dialog share
//     (lib/report-email.ts): what may be asked for on which kind of day, the
//     exact body Send now posts (never a session filter, one request id per
//     send), what each delivery state and each address outcome is called;
//   * the same catalogue, the same refusal sentence and the same "not set up"
//     sentence as the backend, read from its checkout when it is beside this one;
//   * the same words as the owner app, read the same way;
//   * the wiring: the Email button and the Email reports view are on the
//     Reports page, the dialog and the area call the new routes, the address
//     book is gated on the server's own answer, the Accounting card points at
//     the new home. Built-but-never-called is this project's most repeated
//     defect.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ADDRESS_BOOK_TITLE,
    BLANK_EMAIL_SCHEDULE,
    CALENDAR_ONLY_KEYS,
    EMAILABLE_REPORTS,
    EMAIL_AREA_TITLE,
    EMAIL_BUTTON_LABEL,
    EMAIL_BUTTON_TOOLTIP,
    FORMAT_LABELS,
    MAIL_OFF_SENTENCE,
    MIS_EMAIL_KEYS,
    RECIPIENT_OUTCOME_LABELS,
    SCHEDULER_OFF_SENTENCE,
    TEST_EMAIL_LABEL,
    WHOLE_DAYS_NOTE,
    WINDOW_MODE_LABELS,
    addressProblem,
    buildEmailSchedulePatch,
    buildSendBody,
    cadenceCaption,
    configBanners,
    coverageCaption,
    defaultWindowMode,
    deliveryKind,
    deliveryStatus,
    fileLabel,
    formFromSchedule,
    idsForAddresses,
    isRequestId,
    isFinalDelivery,
    isResting,
    newClientRequestId,
    nextRunCaption,
    orderedKeys,
    parseTime,
    periodPhrase,
    readBook,
    readReportEmailConfig,
    recipientOutcomes,
    refusalTitle,
    reportDisabledReason,
    reportListPhrase,
    requestIdFor,
    retryCaption,
    sendBodyKey,
    WATCH_MAX_MS,
    WILL_RETRY_LABEL,
    selectionProblem,
    sendNowBlocked,
    sendOutcome,
    shortDay,
    wallClock,
    type BookEntry,
    type SendNowChoice,
} from '../report-email';
import { clampNotices } from '../report-time-slots';
import { notificationHref } from '../notification-routing';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** A sibling checkout's file, or '' when that repo is not beside this one. */
function sibling(repo: string, relative: string): string {
    for (const base of [path.join(process.cwd(), '..'), path.join(__dirname, '..', '..', '..', '..')]) {
        const full = path.join(base, repo, relative);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); }
    }
    return '';
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BOOK: BookEntry[] = [
    { id: 'r1', email: 'owner@gaia.test', label: 'Owner', status: 'active', suppressed_reason: null },
    { id: 'r2', email: 'Accounts@Firm.test', label: null, status: 'active', suppressed_reason: null },
    { id: 'r3', email: 'old@firm.test', label: null, status: 'suppressed', suppressed_reason: 'bounced' },
];

const RID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const choice = (over: Partial<SendNowChoice> = {}): SendNowChoice => ({
    clientRequestId: RID,
    reportKeys: ['sales_summary'],
    formats: ['xlsx'],
    from: '2026-09-16',
    to: '2026-09-16',
    dayClose: '',
    scope: 'outlet',
    recipientIds: ['r1'],
    ...over,
});

describe('the catalogue', () => {
    it('is the eighteen reports: the fifteen tabs in order, then Sales, GST and P&L', () => {
        expect(EMAILABLE_REPORTS).toHaveLength(18);
        expect(MIS_EMAIL_KEYS).toHaveLength(15);
        expect(EMAILABLE_REPORTS.slice(15).map((r) => r.title)).toEqual(['Sales (accounting)', 'GST', 'Profit & Loss']);
        expect(CALENDAR_ONLY_KEYS).toEqual(['gst', 'pnl']);
    });

    it('the fifteen are exactly the Reports page tabs, in the same order', () => {
        const mis = readSource('src/lib/mis-reports.ts');
        const tabs = [...mis.matchAll(/^\s+key: '([a-z_]+)', title: '([^']+)'/gm)].map((m) => [m[1], m[2]]);
        expect(tabs).toEqual(EMAILABLE_REPORTS.slice(0, 15).map((r) => [r.key, r.title]));
    });

    it('matches the backend catalogue, key, title and kind of day (when its checkout is beside this one)', () => {
        const src = sibling('Restaurant_Backend', 'report_catalogue.ts');
        if (!src) { return; }
        const rows = [...src.matchAll(/\{ key: "([a-z_]+)", title: "([^"]+)", family: "(mis|accounting)",[^}]*windowModes: (BOTH|CALENDAR_ONLY) \}/g)]
            .map((m) => ({ key: m[1], title: m[2], family: m[3], window_modes: m[4] === 'BOTH' ? ['calendar', 'trading_day'] : ['calendar'] }));
        expect(rows).toEqual(EMAILABLE_REPORTS.map((r) => ({ ...r })));
    });

    it('lists read like the email subject', () => {
        expect(reportListPhrase(['sales_summary'])).toBe('Sales Summary');
        expect(reportListPhrase(['void_kot', 'sales_summary'])).toBe('Void KOT and Sales Summary');
        expect(reportListPhrase(['item_wise', 'discount', 'void_kot', 'bill_edit'])).toBe('Item Wise, Discount and 2 more');
        // Up to `max`, every title is named — three once ran together as "Item WiseDiscountVoid KOT".
        expect(reportListPhrase(['item_wise', 'discount', 'void_kot'], 3)).toBe('Item Wise, Discount and Void KOT');
        expect(reportListPhrase(['item_wise', 'discount'], 3)).toBe('Item Wise and Discount');
        expect(reportListPhrase(['item_wise'], 3)).toBe('Item Wise');
        expect(reportListPhrase(['item_wise', 'discount', 'void_kot', 'bill_edit'], 3)).toBe('Item Wise, Discount, Void KOT and 1 more');
        expect(reportListPhrase([...MIS_EMAIL_KEYS])).toBe('All 15 MIS reports');
        expect(reportListPhrase(EMAILABLE_REPORTS.map((r) => r.key))).toBe('All reports');
        expect(orderedKeys(['pnl', 'item_wise', 'nope', 'item_wise'])).toEqual(['item_wise', 'pnl']);
    });

    it('the backend builds the same phrase (when its checkout is beside this one)', () => {
        const src = sibling('Restaurant_Backend', 'report_catalogue.ts');
        if (!src) { return; }
        expect(src).toContain('if (titles.length === REPORT_KEYS.length) {return "All reports";}');
        expect(src).toContain('return "All 15 MIS reports";');
        expect(src).toContain('return `${titles.slice(0, max).join(", ")} and ${String(titles.length - max)} more`;');
    });
});

describe('which days a report may be read on', () => {
    it('GST and P&L are calendar only — the server\'s own sentence', () => {
        expect(selectionProblem(['gst', 'pnl', 'sales'], 'trading_day'))
            .toBe('GST and Profit & Loss can only be sent for calendar days. Choose "previous calendar day", or leave them out.');
        expect(selectionProblem(['gst'], 'trading_day'))
            .toBe('GST can only be sent for calendar days. Choose "previous calendar day", or leave it out.');
        expect(selectionProblem(['gst', 'pnl'], 'calendar')).toBeNull();
        expect(selectionProblem([], 'calendar')).toBe('Pick at least one report to send.');
        expect(reportDisabledReason('pnl', 'trading_day')).toBe('Calendar days only');
        expect(reportDisabledReason('pnl', 'calendar')).toBeNull();
        expect(reportDisabledReason('sales', 'trading_day')).toBeNull();
    });

    it('the backend says the same thing (when its checkout is beside this one)', () => {
        const src = sibling('Restaurant_Backend', 'report_catalogue.ts');
        if (!src) { return; }
        expect(src).toContain('can only be sent for calendar days. Choose "previous calendar day", or leave ${blocked.length > 1 ? "them" : "it"} out.');
        expect(src).toContain('return { ok: false, error: "Pick at least one report to send." };');
    });

    it('a new daily schedule closes at its send time unless it carries GST or P&L', () => {
        expect(defaultWindowMode('daily', ['sales_summary'])).toBe('trading_day');
        expect(defaultWindowMode('daily', ['sales_summary', 'gst'])).toBe('calendar');
        expect(defaultWindowMode('weekly', ['sales_summary'])).toBe('calendar');
        const src = sibling('Restaurant_Backend', 'database_supabase.ts');
        if (!src) { return; }
        expect(src).toContain('windowMode = core.frequency === "daily" && !askedKeys.some((k) => CALENDAR_ONLY_KEYS.includes(k)) ? "trading_day" : "calendar";');
    });

    it('says what one run covers, naming the close', () => {
        expect(coverageCaption('daily', 'trading_day', '02:00')).toBe('Covers the 24 hours up to 02:00 — the trading day that just closed, so bills settled after midnight count on the day they belong to.');
        expect(coverageCaption('daily', 'calendar', '08:00')).toBe('Covers the previous calendar day, midnight to midnight.');
        expect(coverageCaption('weekly', 'calendar', '08:00')).toBe('Covers the seven restaurant days ending the day before it runs.');
        expect(coverageCaption('monthly', 'calendar', '08:00')).toBe('Covers the whole previous calendar month.');
    });
});

describe('Send now: the body', () => {
    it('a plain send: whole calendar days, the workbook, the addresses by id', () => {
        const built = buildSendBody(choice());
        expect(built).toEqual({
            ok: true,
            body: {
                client_request_id: RID,
                report_keys: ['sales_summary'],
                formats: ['xlsx'],
                window: { from: '2026-09-16', to: '2026-09-16' },
                outlet_scope: 'outlet',
                recipient_ids: ['r1'],
            },
        });
    });

    it('NEVER carries a session filter — the server refuses one', () => {
        const built = buildSendBody(choice({ dayClose: '02:00', reportKeys: ['void_kot', 'item_wise'], formats: ['csv', 'xlsx'], scope: 'all' }));
        if (!built.ok) { throw new Error(built.error); }
        expect(built.body.window).toEqual({ from: '2026-09-16', to: '2026-09-16', day_close: '02:00' });
        expect(Object.keys(built.body.window).sort()).toEqual(['day_close', 'from', 'to']);
        expect(built.body.report_keys).toEqual(['item_wise', 'void_kot']);
        expect(built.body.formats).toEqual(['xlsx', 'csv']);
        expect(built.body.outlet_scope).toBe('all');
        expect(WHOLE_DAYS_NOTE).toContain('whole days');
    });

    it('refuses what the server would refuse, in words', () => {
        const refused = (over: Partial<SendNowChoice>): string => {
            const b = buildSendBody(choice(over));
            return b.ok ? '' : b.error;
        };
        expect(refused({ dayClose: '25:00' })).toBe('Write the closing time as HH:mm, or leave it empty for calendar days.');
        expect(refused({ dayClose: '02:00', reportKeys: ['gst'] })).toContain('calendar days');
        expect(refused({ formats: [] })).toBe('Choose Excel, CSV or both.');
        expect(refused({ formats: ['pdf'] })).toBe('Choose Excel, CSV or both.');
        expect(refused({ recipientIds: [] })).toBe('Choose at least one address from the address book.');
        expect(refused({ recipientIds: Array.from({ length: 11 }, (_, i) => `r${i}`) })).toBe('Choose at most 10 addresses.');
        expect(refused({ from: '2026-09-17', to: '2026-09-16' })).toBe('Pick the days to send.');
        expect(refused({ clientRequestId: 'not-a-uuid' })).toContain('request id');
    });

    it('one request id per opening: a v4 UUID, and a new one each time', () => {
        let seed = 0;
        const fixed = () => { seed = (seed + 0.137) % 1; return seed; };
        const a = newClientRequestId(fixed);
        expect(isRequestId(a)).toBe(true);
        expect(a[14]).toBe('4');
        expect(['8', '9', 'a', 'b']).toContain(a[19]);
        const ids = new Set(Array.from({ length: 50 }, () => newClientRequestId()));
        expect(ids.size).toBe(50);
        for (const id of ids) { expect(isRequestId(id)).toBe(true); }
    });

    it('the SAME id only for a true retry: same body, no final answer yet', () => {
        let n = 0;
        const mint = () => { n += 1; return `id-${String(n)}`; };
        const body = buildSendBody(choice({ recipientIds: ['r1', 'r2'] }));
        if (!body.ok) { throw new Error(body.error); }
        const key = sendBodyKey(body.body);
        // The id is not part of what is asked; the order of the ticks is not either.
        const reordered = buildSendBody(choice({ clientRequestId: '3d6f0a51-8a7e-4c1b-9d2e-5f4a3b2c1d0e', recipientIds: ['r2', 'r1'] }));
        if (!reordered.ok) { throw new Error(reordered.error); }
        expect(sendBodyKey(reordered.body)).toBe(key);
        // First press: a new id.
        expect(requestIdFor(null, key, mint)).toBe('id-1');
        // A dropped response, pressed again: the same send.
        expect(requestIdFor({ id: 'id-1', bodyKey: key, settled: false }, key, mint)).toBe('id-1');
        // After a failure, the owner changes the addresses: a NEW send, not a replay of the old one.
        for (const changed of [
            choice({ recipientIds: ['r1'] }), choice({ reportKeys: ['void_kot'] }), choice({ formats: ['csv'] }),
            choice({ to: '2026-09-17' }), choice({ dayClose: '02:00' }), choice({ scope: 'all' }),
        ]) {
            const b = buildSendBody(changed);
            if (!b.ok) { throw new Error(b.error); }
            expect(sendBodyKey(b.body)).not.toBe(key);
            expect(requestIdFor({ id: 'id-1', bodyKey: key, settled: false }, sendBodyKey(b.body), mint)).not.toBe('id-1');
        }
        // The same choices again after a FINAL answer: sent again, deliberately.
        expect(requestIdFor({ id: 'id-1', bodyKey: key, settled: true }, key, () => 'fresh')).toBe('fresh');
    });

    it('refusal codes get a title a person can act on', () => {
        expect(refusalTitle('mail_not_configured')).toBe(MAIL_OFF_SENTENCE);
        expect(refusalTitle('rate_limited')).toBe('Too many emails in a short time');
        expect(refusalTitle('daily_limit')).toBe('Daily email limit reached');
        expect(refusalTitle(null)).toBe("Couldn't send");
    });
});

describe('what the server says it can do', () => {
    const raw = {
        email_available: true, transport: 'smtp', message: null, reason: null, schema_ready: true, send_now_enabled: true,
        scheduler: { enabled: true, armed_here: true, last_sweep_at: null, leader_seen_at: null, lease_until: null, mail_ready: true },
        limits: { recipients_per_send: 10, address_book: 25, email_schedules_per_outlet: 20, window_days: 92, restaurant_daily: 200, platform_daily: 2000, send_now_per_hour: 10, test_per_hour: 3 },
        formats: ['xlsx', 'csv'],
        reports: [{ key: 'sales_summary', title: 'Sales Summary', family: 'mis', window_modes: ['calendar', 'trading_day'] }],
        can_edit_recipients: true, can_use_all_outlets: false,
    };

    it('reads the config, and refuses what it cannot read', () => {
        const c = readReportEmailConfig(raw);
        expect(c?.email_available).toBe(true);
        expect(c?.reports).toHaveLength(1);
        expect(c?.can_use_all_outlets).toBe(false);
        expect(readReportEmailConfig(null)).toBeNull();
        expect(readReportEmailConfig({ transport: 'smtp' })).toBeNull();
        expect(readReportEmailConfig({ ...raw, reports: [] })?.reports).toHaveLength(18);
    });

    it('no answer is "could not ask", never "no email"', () => {
        expect(configBanners(null)[0].title).toBe("Couldn't check the email settings");
        expect(sendNowBlocked(null)).toContain("Couldn't check");
    });

    it('mail off: the server\'s sentence, and the reason only when the server sent one', () => {
        const off = readReportEmailConfig({ ...raw, email_available: false, transport: 'off', message: MAIL_OFF_SENTENCE, reason: 'SMTP_HOST is not set' });
        expect(configBanners(off)).toEqual([{ tone: 'error', title: 'Email is not set up on this server', detail: expect.stringContaining('(SMTP_HOST is not set)') }]);
        expect(sendNowBlocked(off)).toBe(MAIL_OFF_SENTENCE);
        const offNoReason = readReportEmailConfig({ ...raw, email_available: false });
        expect(configBanners(offNoReason)[0].detail).not.toContain('(');
    });

    it('the scheduler switched off is information, not an error; a pending schema blocks everything', () => {
        expect(configBanners(readReportEmailConfig({ ...raw, scheduler: { ...raw.scheduler, enabled: false } }))).toEqual([
            { tone: 'info', title: SCHEDULER_OFF_SENTENCE, detail: null },
        ]);
        const pending = readReportEmailConfig({ ...raw, schema_ready: false });
        expect(configBanners(pending)[0].tone).toBe('error');
        expect(sendNowBlocked(pending)).toContain('database update');
        expect(sendNowBlocked(readReportEmailConfig({ ...raw, send_now_enabled: false }))).toBe('Sending reports on demand is switched off on this server.');
        expect(sendNowBlocked(readReportEmailConfig(raw))).toBeNull();
    });

    it('"Email is not set up on this server" is the backend\'s sentence (when its checkout is beside this one)', () => {
        const src = sibling('Restaurant_Backend', path.join('routes', 'report_email.ts'));
        if (!src) { return; }
        expect(src).toContain(`export const MAIL_OFF_SENTENCE = "${MAIL_OFF_SENTENCE}";`);
        expect(src).toContain('"Sending reports on demand is switched off on this server."');
    });
});

describe('the address book', () => {
    it('reads the list; a suppressed address stays visible but cannot be chosen', () => {
        const b = readBook({ recipients: BOOK, can_edit: false, max: 25 });
        expect(b?.recipients.map((r) => r.status)).toEqual(['active', 'active', 'suppressed']);
        expect(b?.can_edit).toBe(false);
        expect(readBook({ nope: true })).toBeNull();
        expect(idsForAddresses(['OWNER@gaia.test', 'old@firm.test', 'gone@x.test'], BOOK)).toEqual({ ids: ['r1'], missing: ['old@firm.test', 'gone@x.test'] });
    });

    it('checks a typed address before the server does', () => {
        expect(addressProblem('', BOOK, 25)).toBe('Type an email address.');
        expect(addressProblem('no-at', BOOK, 25)).toBe('That does not look like an email address.');
        expect(addressProblem('accounts@firm.TEST', BOOK, 25)).toBe('That address is already in the address book.');
        expect(addressProblem('new@firm.test', BOOK, 3)).toBe('The address book holds at most 3 addresses. Remove one first.');
        expect(addressProblem('new+gst@firm.test', BOOK, 25)).toBeNull();
    });
});

describe('deliveries', () => {
    it('one word per state, the same on web and app', () => {
        expect(deliveryStatus({ status: 'delivered', channel: 'email' })).toEqual({ label: 'Sent', tone: 'ok' });
        expect(deliveryStatus({ status: 'delivered', channel: 'inbox' })).toEqual({ label: 'Delivered', tone: 'ok' });
        expect(deliveryStatus({ status: 'failed' }).label).toBe('Failed');
        expect(deliveryStatus({ status: 'abandoned' }).label).toBe('Missed');
        expect(deliveryStatus({ status: 'sending' }).label).toBe('Sending');
        expect(deliveryStatus({ status: 'rendered' }).label).toBe('Building');
        expect(deliveryStatus({ status: 'claimed' }).label).toBe('Queued');
        expect(['delivered', 'failed', 'abandoned'].every((status) => isFinalDelivery({ status }))).toBe(true);
        expect(['claimed', 'rendered', 'sending'].some((status) => isFinalDelivery({ status }))).toBe(false);
    });

    it('a failure the server will retry is not final, and says when', () => {
        const waiting = { status: 'failed', final: false, error: '421 try again later', next_attempt_at: '2026-09-17T20:35:00.000Z', timezone: 'Asia/Kolkata' };
        expect(isFinalDelivery(waiting)).toBe(false);
        expect(isResting(waiting)).toBe(true);
        expect(deliveryStatus(waiting)).toEqual({ label: WILL_RETRY_LABEL, tone: 'pending' });
        expect(retryCaption(waiting)).toBe('The server tries again at 18 Sep, 02:05.');
        expect(retryCaption({ ...waiting, next_attempt_at: null })).toBe('The server tries again shortly.');
        // Final, and anything that is not a failure, has no retry to announce.
        expect(retryCaption({ ...waiting, final: true })).toBe('');
        expect(retryCaption({ status: 'sending', final: false })).toBe('');
        expect(deliveryStatus({ status: 'failed', final: true })).toEqual({ label: 'Failed', tone: 'bad' });
        expect(isResting({ status: 'sending', final: false })).toBe(false);
        // A 15-minute watch, the same on the app.
        expect(WATCH_MAX_MS).toBe(15 * 60_000);
    });

    it('where a delivery came from', () => {
        expect(deliveryKind({ kind: 'adhoc', report_keys: [] })).toBe('Test email');
        expect(deliveryKind({ kind: 'adhoc', report_keys: ['sales'] })).toBe('Sent from Reports');
        expect(deliveryKind({ kind: 'manual' })).toBe('Run now');
        expect(deliveryKind({ kind: 'scheduled' })).toBe('Scheduled');
        // A 2.0.1 backend sends no kind: the key still tells.
        expect(deliveryKind({}, 'manual:2026-09-16T08:00')).toBe('Run now');
        expect(deliveryKind({}, '2026-09-16')).toBe('Scheduled');
    });

    it('ONE OUTCOME PER ADDRESS, matched case-insensitively', () => {
        const rows = recipientOutcomes({
            status: 'sending', channel: 'email',
            recipients: ['owner@gaia.test', 'Accounts@Firm.test', 'third@x.test', 'fourth@x.test'],
            delivered_to: ['owner@gaia.test'], rejected_to: ['accounts@firm.test'], skipped_to: ['third@x.test'],
        });
        expect(rows).toEqual([
            { email: 'owner@gaia.test', outcome: 'sent' },
            { email: 'Accounts@Firm.test', outcome: 'refused' },
            { email: 'third@x.test', outcome: 'skipped' },
            { email: 'fourth@x.test', outcome: 'waiting' },
        ]);
        // A scheduled row reads its schedule's list; an inbox row has no addresses.
        expect(recipientOutcomes({ status: 'claimed', channel: 'email', delivered_to: [] }, ['a@b.co']).map((r) => r.outcome)).toEqual(['waiting']);
        expect(recipientOutcomes({ status: 'delivered', channel: 'inbox' }, ['a@b.co'])).toEqual([]);
        expect(Object.values(RECIPIENT_OUTCOME_LABELS)).toEqual(['Sent', 'Refused', 'Skipped', 'Waiting']);
    });

    it('the toast a send ends with never claims more than it saw', () => {
        expect(sendOutcome({ status: 'delivered', channel: 'email', recipients: ['a@b.co', 'c@d.co'], delivered_to: ['a@b.co', 'c@d.co'] }, false).title).toBe('Sent to 2 addresses');
        const partial = sendOutcome({ status: 'delivered', channel: 'email', recipients: ['a@b.co', 'c@d.co'], delivered_to: ['a@b.co'], rejected_to: ['c@d.co'], maybe_duplicate: true }, false);
        expect(partial.title).toBe('Sent to 1 address');
        expect(partial.description).toContain('1 refused by the mail service');
        expect(partial.description).toContain('may have received it twice');
        const failed = sendOutcome({ status: 'failed', channel: 'email', error: 'Every address was refused' }, false);
        expect(failed).toEqual({ title: "Couldn't send", description: 'Every address was refused', destructive: true });
        expect(sendOutcome({ status: 'failed', final: true, channel: 'email', error: 'Every address was refused' }, false)).toEqual(failed);
        // Not final: the server retries it — never "Couldn't send", never an invitation to send twice.
        const later = sendOutcome({
            status: 'failed', final: false, channel: 'email', error: '421 try again later',
            next_attempt_at: '2026-09-17T20:35:00.000Z', timezone: 'Asia/Kolkata',
        }, true);
        expect(later).toEqual({
            title: 'Not sent yet',
            description: '421 try again later The server tries again at 18 Sep, 02:05. Its result will appear in Email reports → History; pressing Send again with the same choices does not send it twice.',
            destructive: false,
        });
        expect(sendOutcome({ status: 'sending', channel: 'email' }, true).title).toBe('Still sending');
        expect(sendOutcome(null, true).title).toBe('Queued');
    });

    it('files say what they are', () => {
        expect(fileLabel({ report_key: 'bundle', format: 'xlsx', bytes: 48_000, truncated: false, purged: false })).toBe('Excel workbook · 47 KB');
        expect(fileLabel({ report_key: 'void_kot', format: 'csv', bytes: 3 * 1024 * 1024, truncated: true, purged: false })).toBe('Void KOT (CSV) · 3.0 MB · cut short');
        expect(fileLabel({ report_key: 'sales', format: 'csv', bytes: 10, truncated: false, purged: true })).toBe('Sales (accounting) (CSV) · cleared after 90 days');
    });

    it('days and instants in the restaurant\'s words, never ICU\'s "Sept"', () => {
        expect(shortDay('2026-09-16')).toBe('Wed 16 Sep');
        expect(periodPhrase('2026-09-01', '2026-09-15')).toBe('1 Sep – 15 Sep');
        expect(periodPhrase('2026-09-16', '2026-09-16')).toBe('Wed 16 Sep');
        expect(wallClock('2026-09-17T20:30:00.000Z', 'Asia/Kolkata')).toBe('18 Sep, 02:00');
        expect(wallClock(null, 'Asia/Kolkata')).toBe('');
    });
});

describe('schedules', () => {
    it('any minute of the day', () => {
        const built = buildEmailSchedulePatch({ ...BLANK_EMAIL_SCHEDULE, name: 'Nightly', time: '23:47', recipient_ids: ['r1'] });
        if (!built.ok) { throw new Error(built.message); }
        expect(built.patch).toEqual({
            name: 'Nightly', report_keys: ['sales_summary', 'settlement_summary'], formats: ['xlsx'], frequency: 'daily',
            hour_local: 23, minute_local: 47, weekday: null, day_of_month: null, window_mode: 'trading_day',
            outlet_scope: 'outlet', channel: 'email', recipient_ids: ['r1'],
        });
        expect(parseTime('02:05')).toBe(125);
        expect(parseTime('24:00')).toBeNull();
    });

    it('weekly and monthly are calendar periods whatever the form says', () => {
        const built = buildEmailSchedulePatch({ ...BLANK_EMAIL_SCHEDULE, name: 'W', frequency: 'weekly', weekday: '1', window_mode: 'trading_day', recipient_ids: ['r1'] });
        expect(built.ok && built.patch.window_mode).toBe('calendar');
        expect(built.ok && built.patch.weekday).toBe(1);
    });

    it('an edit that did not touch the addresses leaves the stored list alone', () => {
        const built = buildEmailSchedulePatch({ ...BLANK_EMAIL_SCHEDULE, name: 'E', recipient_ids: [] }, { recipientsTouched: false });
        expect(built.ok).toBe(true);
        expect(built.ok && 'recipient_ids' in built.patch).toBe(false);
        const inbox = buildEmailSchedulePatch({ ...BLANK_EMAIL_SCHEDULE, name: 'I', channel: 'inbox', recipient_ids: ['r1'] });
        expect(inbox.ok && inbox.patch.recipient_ids).toEqual([]);
    });

    it('refuses in words', () => {
        const msg = (f: Partial<typeof BLANK_EMAIL_SCHEDULE>, o = {}) => {
            const b = buildEmailSchedulePatch({ ...BLANK_EMAIL_SCHEDULE, name: 'X', recipient_ids: ['r1'], ...f }, o);
            return b.ok ? '' : b.message;
        };
        expect(msg({ name: '  ' })).toBe('Give the schedule a name');
        expect(msg({ time: '' })).toBe('Pick a time of day');
        expect(msg({ report_keys: ['gst'] })).toContain('calendar days');
        expect(msg({ report_keys: ['gst'], window_mode: 'calendar' })).toBe('');
        expect(msg({ formats: [] })).toBe('Choose Excel, CSV or both.');
        expect(msg({ recipient_ids: [] })).toContain('at least one address');
        expect(msg({ recipient_ids: ['a', 'b', 'c'] }, { maxRecipients: 2 })).toBe('Choose at most 2 addresses.');
    });

    it('a 2.0.1 schedule opens as the single calendar-day CSV it always was', () => {
        const { form, missing } = formFromSchedule({
            name: 'Morning sales', report_key: 'sales', format: 'csv', frequency: 'daily', hour_local: 8, minute_local: 15,
            weekday: null, day_of_month: null, channel: 'email', recipients: ['owner@gaia.test', 'gone@x.test'],
        }, BOOK);
        expect(form).toMatchObject({ report_keys: ['sales'], formats: ['csv'], time: '08:15', window_mode: 'calendar', outlet_scope: 'outlet', recipient_ids: ['r1'] });
        expect(missing).toEqual(['gone@x.test']);
        const bundle = formFromSchedule({
            name: 'B', report_key: 'bundle', report_keys: ['void_kot', 'item_wise'], formats: ['csv', 'xlsx'], frequency: 'daily',
            hour_local: 2, minute_local: 0, weekday: null, day_of_month: null, window_mode: 'trading_day', outlet_scope: 'all',
            channel: 'email', recipients: [],
        }, BOOK).form;
        expect(bundle).toMatchObject({ report_keys: ['item_wise', 'void_kot'], formats: ['xlsx', 'csv'], window_mode: 'trading_day', outlet_scope: 'all' });
    });

    it('the row says when it next runs and what that run covers — the server\'s arithmetic, shown', () => {
        const trading = { enabled: true, next_run_at: '2026-09-17T20:30:00.000Z', next_window: { from: '2026-09-17', to: '2026-09-17', day_close: '02:00', start_at: '2026-09-16T20:30:00.000Z', end_at: '2026-09-17T20:30:00.000Z' } };
        expect(nextRunCaption(trading, 'Asia/Kolkata')).toBe('Next: 18 Sep, 02:00 — covers 17 Sep, 02:00 → 18 Sep, 02:00');
        const calendar = { enabled: true, next_run_at: '2026-09-18T02:30:00.000Z', next_window: { from: '2026-09-17', to: '2026-09-17', day_close: null, start_at: '', end_at: '' } };
        expect(nextRunCaption(calendar, 'Asia/Kolkata')).toBe('Next: 18 Sep, 08:00 — covers Thu 17 Sep');
        expect(nextRunCaption({ ...trading, enabled: false }, 'Asia/Kolkata')).toBe('');
        expect(nextRunCaption({ enabled: true }, 'Asia/Kolkata')).toBe('');
        expect(cadenceCaption({ frequency: 'daily', hour_local: 2, minute_local: 0, weekday: null, day_of_month: null, window_mode: 'trading_day' }))
            .toBe('Every day at 02:00 · the day that just ended');
        expect(cadenceCaption({ frequency: 'weekly', hour_local: 8, minute_local: 5, weekday: 1, day_of_month: null })).toBe('Every Monday at 08:05');
    });
});

describe('the Reports toolbar clamps', () => {
    it('a dropped closing time is a notice, not a shortened range', () => {
        expect(clampNotices(['day_close_with_slot'])).toEqual({ range: false, slot: 'A session is on calendar days — closing time not applied' });
        expect(clampNotices(['day_close_unparseable'])).toEqual({ range: false, slot: 'That closing time could not be read — showing calendar days' });
        expect(clampNotices(['slot_unknown', 'day_close_with_slot']).slot).toBe('That session no longer exists — showing all day');
        const src = sibling('Restaurant_Backend', 'report_window.ts');
        if (!src) { return; }
        expect(src).toContain('"day_close_unparseable"');
        expect(src).toContain('"day_close_with_slot"');
    });
});

describe('the same words as the app (when its checkout is beside this one)', () => {
    it('labels, sentences and states', () => {
        const app = sibling('restaurant_owner_app', path.join('lib', 'models', 'report_email.dart'));
        if (!app) { return; }
        for (const word of [
            EMAIL_AREA_TITLE, EMAIL_BUTTON_LABEL, EMAIL_BUTTON_TOOLTIP, MAIL_OFF_SENTENCE, SCHEDULER_OFF_SENTENCE,
            TEST_EMAIL_LABEL, ADDRESS_BOOK_TITLE, WHOLE_DAYS_NOTE,
            FORMAT_LABELS.xlsx, FORMAT_LABELS.csv, WINDOW_MODE_LABELS.trading_day, WINDOW_MODE_LABELS.calendar,
            'Sent', 'Delivered', 'Failed', 'Missed', 'Sending', 'Building', 'Queued', WILL_RETRY_LABEL, 'Not sent yet',
            'Test email', 'Sent from Reports', 'Run now', 'Refused', 'Skipped', 'Waiting',
            'Calendar days only', 'All 15 MIS reports',
        ]) {
            expect(app).toContain(`'${word.replace(/'/g, "\\'")}'`);
        }
        for (const r of EMAILABLE_REPORTS) { expect(app).toContain(`'${r.key}'`); }
    });
});

describe('the wiring', () => {
    const page = code(readSource('src/app/dashboard/reports/page.tsx'));
    const dialog = code(readSource('src/app/dashboard/reports/email-dialog.tsx'));
    const area = code(readSource('src/app/dashboard/reports/email-reports.tsx'));
    const db = readSource('src/lib/db.ts');

    it('the Reports page has the Email button beside Export, the dialog, and the Email reports view', () => {
        expect(page).toContain('onClick={() => { setEmailOpen(true) }}');
        expect(page.indexOf('<Mail className="mr-1.5 h-4 w-4" /> {EMAIL_BUTTON_LABEL}')).toBeGreaterThan(page.indexOf('doExport("pdf")'));
        expect(page).toContain('<EmailReportDialog');
        expect(page).toContain('reportKey={def.key}');
        expect(page).toContain('from={query.from}');
        expect(page).toContain('slotPhrase={slotPhrase}');
        expect(page).toContain('params?.get("view") === "email"');
        expect(page).toContain('<EmailReportsPanel rid={rid} timezone={timezone} />');
    });

    it('the dialog picks the request id per send and never sends a session filter', () => {
        const openEffect = dialog.slice(dialog.indexOf('useEffect(() => {'), dialog.indexOf('}, [open, rid, reportKey, from, to])'));
        expect(openEffect).toContain('lastSend.current = null');
        expect(dialog).toContain('const id = requestIdFor(lastSend.current, bodyKey, () => fresh)');
        expect(dialog).toContain('const bodyKey = sendBodyKey(built.body)');
        expect(dialog).toContain('if (d && isFinalDelivery(d)) {current.settled = true}');
        expect(dialog).toContain('if (isResting(d)) {return { d, timedOut: false }}');
        expect(dialog).not.toMatch(/\bslot:|time_from|timeFrom/);
        expect(dialog).toContain('await sendReportEmail(rid, { ...built.body, client_request_id: id }, asOutlet)');
        // The combined scope travels in the body; the request runs as a real outlet.
        expect(dialog).toContain('const asOutlet = combined ? fallbackOutletId : outletId');
        expect(dialog).toContain('scope: combined ? "all" : "outlet"');
        expect(dialog).toContain('await getReportDelivery(rid, deliveryId)');
        expect(dialog).toContain('disabled={!loaded || sending || Boolean(blocked) || allOutletsRefused || book.length === 0}');
    });

    it('the area: address book gated on the server\'s answer; test email; schedules by book id; history with files', () => {
        expect(area).toContain('const canEditBook = config?.can_edit_recipients === true');
        expect(area).toMatch(/\{canEdit && \(\s*<>\s*<Button/);
        expect(area).toContain('await sendReportTestEmail(rid, { recipientId: e.id, clientRequestId: newClientRequestId() })');
        expect(area).toContain('await addReportEmailRecipient(rid,');
        expect(area).toContain('await removeReportEmailRecipient(rid, e.id)');
        expect(area).toContain('await saveReportSchedule(rid, editing || null, { ...built.patch, enabled })');
        expect(area).toContain('await runReportScheduleFor(rid, s.id)');
        expect(area).toContain('await getReportDeliveryFile(rid, d.id, f.id)');
        expect(area).toContain('<Input id="sched-time" type="time" step={60}');
        expect(area).toContain('{config?.can_use_all_outlets && (');
        expect(area).toContain('<option value="email" disabled={!emailOk}>');
        // The history keeps watching a row the server will retry, for as long as the app does.
        expect(area).toContain('const inFlight = deliveries.some((d) => !isFinalDelivery(d) && Date.now() - Date.parse(d.created_at) < WATCH_MAX_MS)');
        expect(area).toContain('{retryCaption(d) && <p');
    });

    it('db.ts calls the routes the backend serves, and returns refusals instead of throwing them', () => {
        for (const needle of [
            '`/reports/email/config?restaurantId=',
            '`/reports/email/recipients?restaurantId=',
            '`/reports/email/recipients/${encodeURIComponent(id)}?restaurantId=',
            '`/reports/email/test?restaurantId=',
            '`/reports/email/send?restaurantId=',
            '`/reports/deliveries/${encodeURIComponent(deliveryId)}?restaurantId=',
            '`/reports/deliveries/${encodeURIComponent(deliveryId)}/files/${encodeURIComponent(fileId)}?restaurantId=',
        ]) {
            expect(db).toContain(needle);
        }
        const section = db.slice(db.indexOf('// --- Email reports (client item 9)'), db.indexOf('// --- Cash register / day-close'));
        expect(section).not.toContain('throw new Error');
        const manifest = sibling('Restaurant_Backend', path.join('scripts', 'route_manifest.baseline.txt'));
        if (!manifest) { return; }
        const served = [...manifest.matchAll(/^\d{4} (GET|POST|PATCH|PUT|DELETE)\s+(\S+)\s+\|/gm)].map((m) => `${m[1]} ${m[2]}`);
        for (const route of [
            'GET /reports/email/config', 'GET /reports/email/recipients', 'POST /reports/email/recipients',
            'DELETE /reports/email/recipients/:id', 'POST /reports/email/test', 'POST /reports/email/send',
            'GET /reports/deliveries/:id', 'GET /reports/deliveries/:id/files/:fileId',
        ]) {
            expect(served).toContain(route);
        }
    });

    it('a report bell opens the Email reports view; a 2.0.1 one opens Accounting', () => {
        const target = (module: string) => ({
            notification_id: 'n1', type: 'report', module, entity: null, outlet_id: null, outlet_name: null,
            still_exists: true, visible_here: true, switch_outlet_id: null, meta: {},
        });
        expect(notificationHref(target('Reports') as never)).toBe('/dashboard/reports?view=email');
        expect(notificationHref(target('Accounting') as never)).toBe('/dashboard/accounting');
        expect(page).toContain('useEffect(() => { if (viewParam === "email") {setView("email")} }, [viewParam])');
        const src = sibling('Restaurant_Backend', 'database_supabase.ts');
        if (!src) { return; }
        expect(src).toContain('return { module: s("module") === "Accounting" ? "Accounting" : "Reports", entity: null };');
    });

    it('the Accounting card points at the new home', () => {
        const card = readSource('src/app/dashboard/accounting/scheduled-reports.tsx');
        expect(card).toContain('href="/dashboard/reports?view=email"');
        expect(readSource('src/app/dashboard/accounting/page.tsx')).toContain('<ScheduledReportsSection rid={rid} />');
    });

    it('waiters never reach it: Reports is not on the waiter-only nav', () => {
        const layout = readSource('src/app/dashboard/layout.tsx');
        const waiter = layout.slice(layout.indexOf('if (isWaiterOnly) {'), layout.indexOf('return fullNavItems;'));
        expect(waiter).not.toContain('/dashboard/reports');
        // The nav's keyword table lives in lib/dashboard-sections.ts since client
        // item 10 (the Overview reads it too); the layout asks it by href.
        expect(layout).toContain("{ href: '/dashboard/reports', label: 'Reports', icon: <FileSpreadsheet className=\"h-6 w-6\" />, actionKeywords: sectionKeywords('/dashboard/reports') }");
        const sections = readSource('src/lib/dashboard-sections.ts');
        expect(sections).toContain("'/dashboard/reports': ['report', 'accounting', 'finance'],");
        expect(sections).toContain("export const WAITER_SECTIONS: readonly string[] = ['/dashboard/orders', '/dashboard/tables'];");
    });
});
