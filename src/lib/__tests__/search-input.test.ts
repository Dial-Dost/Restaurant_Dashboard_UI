// CLIENT ITEM 6 (app 2.0.2) — "pressing the 'x' does not clear the search …
// in tables and every other section with a search, clicking the 'x' at the
// rightmost end after typing must clear the search."
//
// The dashboard side. Every search box is the shared SearchInput (or the cmdk
// CommandInput, which got the same x), and what they decide lives in
// lib/search-input.ts. This suite runs in node with no DOM library, on
// purpose, so it holds the rules in two ways:
//
//   * THE LOGIC, as plain functions: when the x is drawn, when a screen hears
//     the query (debounced for typing, AT ONCE for an emptied box, never the
//     old word after an x), what Escape does, and when a dialog must stay open
//     for it. The query timing is driven the way React drives the effect: the
//     previous cleanup, then the next body.
//   * THE WIRING, as source guards: the components call that logic, every
//     search box on every page is one of them, the pinned inventory matches,
//     and no hand-rolled box or x is left anywhere under src/.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
    SEARCH_CLEAR_BUTTON_CLASS,
    SEARCH_CLEAR_LABEL,
    SEARCH_INPUT_ATTR,
    escapeBelongsToSearch,
    filterFetchDelayMs,
    keepOpenForSearchEscape,
    planSearchQuery,
    scheduleSearchQuery,
    searchKeyAction,
    searchQueryOf,
    showSearchClear,
} from '../search-input';

const SRC = join(__dirname, '..', '..');
/**
 * A source file with its comments blanked, so a comment that talks about a
 * <button> or an <Input> is never read as one. Only comments that start a line
 * or a JSX `{/* … *\/}` count: `accept="image/*"` is not the start of one.
 */
const read = (p: string): string =>
    readFileSync(join(SRC, p), 'utf8')
        .replace(/(^[ \t]*|\{\s*)\/\*[\s\S]*?\*\//gm, (c) => c.replace(/[^\n]/g, ' '))
        .replace(/^[ \t]*\/\/.*$/gm, '');

/** The box's effect, run the way React runs it across renders. */
function box(debounceMs: number, initial = ''): { type: (v: string) => void; unmount: () => void; sent: string[] } {
    const sent: string[] = [];
    const lastSent = { current: searchQueryOf(initial) };
    let cleanup: (() => void) | undefined;
    const type = (v: string): void => {
        cleanup?.();
        cleanup = scheduleSearchQuery(v, debounceMs, lastSent, (q) => { sent.push(q); });
    };
    return { type, unmount: () => { cleanup?.(); cleanup = undefined; }, sent };
}

describe('the x is drawn whenever the box holds anything', () => {
    it('no x on an empty box; an x for text, and for spaces too (there is something to clear)', () => {
        expect(showSearchClear('')).toBe(false);
        expect(showSearchClear('d')).toBe(true);
        expect(showSearchClear('   ')).toBe(true);
    });

    it('the query is the box trimmed', () => {
        expect(searchQueryOf('  dal makhani ')).toBe('dal makhani');
        expect(searchQueryOf('   ')).toBe('');
    });
});

describe('planSearchQuery — what a change of the text tells the screen', () => {
    it('nothing, when the query is the one the screen already has', () => {
        expect(planSearchQuery('dal', 'dal', 300)).toBeNull();
        expect(planSearchQuery(' dal  ', 'dal', 300)).toBeNull();
        expect(planSearchQuery('', '', 300)).toBeNull();
    });

    it('an emptied box is never debounced', () => {
        expect(planSearchQuery('', 'dal', 350)).toEqual({ query: '', delayMs: 0 });
        expect(planSearchQuery('   ', 'dal', 350)).toEqual({ query: '', delayMs: 0 });
    });

    it('typing waits out the debounce, or goes at once without one', () => {
        expect(planSearchQuery('dal', '', 350)).toEqual({ query: 'dal', delayMs: 350 });
        expect(planSearchQuery('dal', '', 0)).toEqual({ query: 'dal', delayMs: 0 });
    });
});

describe('scheduleSearchQuery — the query, over time', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('typing is one query per pause, not one per keystroke', () => {
        const b = box(300);
        b.type('d');
        jest.advanceTimersByTime(100);
        b.type('da');
        jest.advanceTimersByTime(100);
        b.type('dal');
        jest.advanceTimersByTime(299);
        expect(b.sent).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(b.sent).toEqual(['dal']);
    });

    it('THE ITEM: the x after a search empties the query in the same pass', () => {
        const b = box(350);
        b.type('dal');
        jest.advanceTimersByTime(350);
        expect(b.sent).toEqual(['dal']);
        b.type('');
        expect(b.sent).toEqual(['dal', '']); // no timer involved
        jest.advanceTimersByTime(5000);
        expect(b.sent).toEqual(['dal', '']);
    });

    it('an x pressed inside the debounce window: the cleared word never lands', () => {
        const b = box(300);
        b.type('dal');
        jest.advanceTimersByTime(100);
        b.type('');
        jest.advanceTimersByTime(5000);
        expect(b.sent).not.toContain('dal');
        expect(b.sent).toEqual([]); // the screen was never told "dal", so "" is not news
    });

    it('the next word after the x is a new search', () => {
        const b = box(300);
        b.type('dal');
        jest.advanceTimersByTime(300);
        b.type('');
        b.type('n');
        b.type('naan');
        jest.advanceTimersByTime(300);
        expect(b.sent).toEqual(['dal', '', 'naan']);
    });

    it('the same query differently spaced is not sent twice', () => {
        const b = box(300);
        b.type('dal');
        jest.advanceTimersByTime(300);
        b.type('dal  ');
        jest.advanceTimersByTime(300);
        b.type(' dal');
        jest.advanceTimersByTime(300);
        expect(b.sent).toEqual(['dal']);
    });

    it('without a debounce every change is heard at once', () => {
        const b = box(0);
        b.type('d');
        b.type('da');
        b.type('');
        expect(b.sent).toEqual(['d', 'da', '']);
    });

    it('a box that mounts holding a query does not repeat it', () => {
        const b = box(300, ' dal ');
        b.type(' dal ');
        jest.advanceTimersByTime(1000);
        expect(b.sent).toEqual([]);
    });

    it('a box taken away mid-wait sends nothing afterwards', () => {
        const b = box(300);
        b.type('dal');
        b.unmount();
        jest.advanceTimersByTime(1000);
        expect(b.sent).toEqual([]);
    });

    it('uses the timers it is given', () => {
        const scheduled: { fn: () => void; ms: number }[] = [];
        const cleared: unknown[] = [];
        const sent: string[] = [];
        const cleanup = scheduleSearchQuery('dal', 450, { current: '' }, (q) => { sent.push(q); }, {
            setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return 'handle'; },
            clearTimeout: (h) => { cleared.push(h); },
        });
        expect(scheduled.map((s) => s.ms)).toEqual([450]);
        cleanup?.();
        expect(cleared).toEqual(['handle']);
        scheduled[0]?.fn();
        expect(sent).toEqual(['dal']);
    });
});

describe('searchKeyAction — Escape', () => {
    const esc = (value: string, extra: Partial<{ handledByScreen: boolean; composing: boolean }> = {}): string =>
        searchKeyAction({ key: 'Escape', value, handledByScreen: false, composing: false, ...extra });

    it('clears a box that has text', () => {
        expect(esc('dal')).toBe('clear');
        expect(esc('  ')).toBe('clear');
    });

    it('leaves an empty box alone, so the dialog around it still closes', () => {
        expect(esc('')).toBe('pass');
    });

    it("gives way to the screen's own handler and to an IME mid-word", () => {
        expect(esc('dal', { handledByScreen: true })).toBe('pass');
        expect(esc('दाल', { composing: true })).toBe('pass');
    });

    it('no other key clears', () => {
        for (const key of ['Enter', 'Backspace', 'Esc', 'x', 'Delete']) {
            expect(searchKeyAction({ key, value: 'dal', handledByScreen: false, composing: false })).toBe('pass');
        }
    });
});

describe('escapeBelongsToSearch / keepOpenForSearchEscape — dialogs, sheets, popovers', () => {
    const input = (value: string, marked = true, tagName = 'INPUT'): { tagName: string; value: string; getAttribute: (name: string) => string | null } => ({
        tagName,
        value,
        getAttribute: (name: string) => (marked && name === SEARCH_INPUT_ATTR ? '' : null),
    });

    it('only a marked search box that holds text keeps its container open', () => {
        expect(escapeBelongsToSearch(input('dal'))).toBe(true);
        expect(escapeBelongsToSearch(input(''))).toBe(false);
        expect(escapeBelongsToSearch(input('dal', false))).toBe(false);
        expect(escapeBelongsToSearch(input('dal', true, 'TEXTAREA'))).toBe(false);
        expect(escapeBelongsToSearch(null)).toBe(false);
        expect(escapeBelongsToSearch('dal')).toBe(false);
        expect(escapeBelongsToSearch({ tagName: 'INPUT', value: 'dal' })).toBe(false);
    });

    it('prevents the close for a search with text, and still calls what the caller passed', () => {
        const calls: string[] = [];
        const handler = keepOpenForSearchEscape<{ target: unknown; preventDefault: () => void }>(() => { calls.push('caller'); });
        const withText = { target: input('dal'), preventDefault: () => { calls.push('prevented'); } };
        handler(withText);
        expect(calls).toEqual(['prevented', 'caller']);

        calls.length = 0;
        handler({ target: input(''), preventDefault: () => { calls.push('prevented'); } });
        expect(calls).toEqual(['caller']);

        calls.length = 0;
        keepOpenForSearchEscape()({ target: input(''), preventDefault: () => { calls.push('prevented'); } });
        expect(calls).toEqual([]);
    });
});

describe('filterFetchDelayMs — a page that gathers filter changes before asking', () => {
    const f = (search: string, category = 'All', from = ''): { search: string; category: string; from: string } => ({ search, category, from });

    it('the first page and a plain reload wait as before', () => {
        expect(filterFetchDelayMs(null, f(''), ['search'], 300)).toBe(300);
        expect(filterFetchDelayMs(f('dal'), f('dal'), ['search'], 300)).toBe(300);
    });

    it('a change to a self-debounced box alone goes at once — an emptied box re-asks now', () => {
        expect(filterFetchDelayMs(f('dal'), f(''), ['search'], 300)).toBe(0);
        expect(filterFetchDelayMs(f(''), f('dal'), ['search'], 300)).toBe(0);
    });

    it('any other change still waits', () => {
        expect(filterFetchDelayMs(f('dal'), f('dal', 'Bill'), ['search'], 300)).toBe(300);
        expect(filterFetchDelayMs(f('dal'), f('', 'Bill'), ['search'], 300)).toBe(300);
        expect(filterFetchDelayMs(f(''), f('', 'All', '2026-09-01'), ['search'], 300)).toBe(300);
    });
});

// ------------------------------------------------------------ the wiring --

/** Every .ts/.tsx file under src/, as a path relative to src with / separators. */
function sources(dir = SRC): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'node_modules') {continue;}
            out.push(...sources(full));
        } else if (/\.tsx?$/.test(name)) {
            out.push(relative(SRC, full).split(sep).join('/'));
        }
    }
    return out;
}

/**
 * Every JSX opening tag named `tag` in `code`, whole: attribute strings and
 * `{…}` expressions are stepped over, so an arrow's `=>` never ends the tag.
 */
function jsxTags(code: string, tag: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        let i = m.index + m[0].length;
        let depth = 0;
        let quote: string | null = null;
        for (; i < code.length; i++) {
            const c = code.charAt(i);
            if (quote !== null) {
                if (c === quote) {quote = null;}
                continue;
            }
            if (depth > 0) {
                if (c === '{') {depth++;}
                else if (c === '}') {depth--;}
                else if (c === '"' || c === "'" || c === '`') {quote = c;}
                continue;
            }
            if (c === '{') {depth++;}
            else if (c === '"' || c === "'") {quote = c;}
            else if (c === '>') {break;}
        }
        out.push(code.slice(m.index, i + 1));
    }
    return out;
}

const SHARED = new Set(['components/ui/search-input.tsx', 'components/ui/command.tsx', 'components/ui/input.tsx']);
const SEARCHY = /search|find|filter|query/i;

describe('the components call the logic', () => {
    const si = read('components/ui/search-input.tsx');
    const cmd = read('components/ui/command.tsx');

    it('SearchInput: the x is a 40px button that clears the box and keeps the caret', () => {
        expect(SEARCH_CLEAR_LABEL).toBe('Clear search');
        expect(SEARCH_CLEAR_BUTTON_CLASS).toMatch(/\bw-10\b/);
        expect(SEARCH_CLEAR_BUTTON_CLASS).toMatch(/\bh-full\b/);
        expect(SEARCH_CLEAR_BUTTON_CLASS).toMatch(/\bmin-h-9\b/);
        const [button] = jsxTags(si, 'button');
        expect(button).toContain('type="button"');
        expect(button).toContain('aria-label={clearLabel}');
        expect(button).toMatch(/onMouseDown=\{\(e\) => \{ e\.preventDefault\(\) \}\}/);
        expect(button).toContain('onClick={clear}');
        expect(button).toMatch(/bare \? "inline-flex h-10 w-10 [^"]*" : SEARCH_CLEAR_BUTTON_CLASS/);
        expect(si).toMatch(/const button = showSearchClear\(value\) \?/);
        expect(si).toMatch(/const clear = \(\): void => \{\s*onValueChange\(""\)\s*inner\.current\?\.focus\(\)\s*\}/);
        // Room for it in the box, and no browser-drawn cancel glyph beside it.
        expect(si).toContain('className={cn("pl-8 pr-10", className)}');
        expect(si).toMatch(/type: "text",\s*inputMode: "search" as const/);
        expect(si).toContain('[SEARCH_INPUT_ATTR]: ""');
    });

    it('SearchInput: one query path, and Escape through searchKeyAction', () => {
        expect(si).toMatch(/const lastSent = React\.useRef\(searchQueryOf\(value\)\)/);
        expect(si).toMatch(/scheduleSearchQuery\(value, debounceMs, lastSent, \(query\) => \{ onQuery\.current\?\.\(query\) \}\),\s*\[value, debounceMs\]/);
        expect(si).toMatch(/onChange: \(e: React\.ChangeEvent<HTMLInputElement>\) => \{ onValueChange\(e\.target\.value\) \}/);
        expect(si).toMatch(/handledByScreen: !before && e\.defaultPrevented/);
        expect(si).toMatch(/if \(action === "clear"\) \{\s*e\.preventDefault\(\)\s*e\.stopPropagation\(\)\s*clear\(\)/);
        // Both skins place the same button.
        expect(si.match(/\{button\}/g)).toHaveLength(2);
    });

    it('CommandInput (every cmdk search): the same x, on text it always holds', () => {
        expect(cmd).toMatch(/const text = value \?\? own/);
        expect(cmd).toMatch(/if \(value === undefined\) \{setOwn\(next\)\}\s*onValueChange\?\.\(next\)/);
        expect(cmd).toContain('value={text}');
        expect(cmd).toContain('onValueChange={setText}');
        expect(cmd).toContain('{showSearchClear(text) ? (');
        const [button] = jsxTags(cmd.slice(cmd.indexOf('const CommandInput')), 'button');
        expect(button).toContain('type="button"');
        expect(button).toContain('aria-label={SEARCH_CLEAR_LABEL}');
        expect(button).toContain('onClick={clear}');
        expect(button).toContain('SEARCH_CLEAR_BUTTON_CLASS');
        expect(cmd).toMatch(/const clear = \(\): void => \{\s*setText\(""\)\s*inner\.current\?\.focus\(\)/);
        expect(cmd).toMatch(/searchKeyAction\(\{\s*key: e\.key,\s*value: text,/);
        expect(cmd).toContain('{...{ [SEARCH_INPUT_ATTR]: "" }}');
    });

    it.each([
        'components/ui/dialog.tsx',
        'components/ui/sheet.tsx',
        'components/ui/popover.tsx',
    ])('%s lets Escape clear a search inside it, after the caller’s props', (file) => {
        const src = read(file);
        const content = src.slice(src.indexOf('Content = React.forwardRef'));
        expect(content).toMatch(/\{\.\.\.props\}\s*(\/\/[^\n]*\n\s*)*onEscapeKeyDown=\{keepOpenForSearchEscape\(onEscapeKeyDown\)\}/);
        expect(content).toMatch(/onEscapeKeyDown, \.\.\.props \}/);
    });

    it('"Search tables..." finds a table by the name on its row, not by its uuid', () => {
        // cmdk scores `value` and `keywords` only. The tables' values are uuids.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { defaultFilter } = require('cmdk') as { defaultFilter: (value: string, search: string, keywords?: string[]) => number };
        const id = 'b6a1c3e2-4f5d-4e6a-9c1b-2d3e4f5a6b7c';
        expect(defaultFilter(id, 'T4')).toBe(0);
        expect(defaultFilter(id, 'T4', ['T4'])).toBeGreaterThan(0);
        expect(defaultFilter(id, 'patio', ['Patio 3'])).toBeGreaterThan(0);
        expect(defaultFilter(id, 'T9', ['T4'])).toBe(0);
        const combobox = read('components/ui/combobox.tsx');
        const [item] = jsxTags(combobox, 'CommandItem');
        expect(item).toContain('value={option.value}');
        expect(item).toContain('keywords={[option.label]}');
    });

    it('nothing reaches cmdk’s input except through CommandInput', () => {
        const offenders = sources().filter((f) => f !== 'components/ui/command.tsx' && read(f).includes('CommandPrimitive.Input'));
        expect(offenders).toEqual([]);
        expect(read('components/ui/combobox.tsx')).toMatch(/<CommandInput placeholder=/);
        expect(read('app/dashboard/settings/timezone-selector.tsx')).toMatch(/<CommandInput\s+placeholder="Search city or offset/);
    });
});

describe('every search box on every page is the shared one', () => {
    const files = sources();

    it('no hand-rolled search box is left anywhere under src/', () => {
        expect(files.length).toBeGreaterThan(100);
        const offenders: string[] = [];
        let inputs = 0;
        for (const file of files) {
            if (SHARED.has(file) || !file.endsWith('.tsx')) {continue;}
            const code = read(file);
            for (const tag of [...jsxTags(code, 'Input'), ...jsxTags(code, 'input')]) {
                inputs++;
                const named = [...tag.matchAll(/\b(placeholder|aria-label|id|name)=(?:"([^"]*)"|\{([^}]*)\})/g)]
                    .map((a) => (a[2] as string | undefined) ?? (a[3] as string | undefined) ?? '');
                const bound = /\bvalue=\{([^}]*)\}/.exec(tag)?.[1] ?? '';
                if (tag.includes('type="search"') || named.some((n) => SEARCHY.test(n)) || /search|query/i.test(bound)) {
                    offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
                }
            }
        }
        expect(inputs).toBeGreaterThan(50);
        expect(offenders).toEqual([]);
    });

    it('no page draws its own clear button for a search', () => {
        const offenders = files.filter((f) => !SHARED.has(f) && /aria-label=["{][^"}]*[Cc]lear[^"}]*search/.test(read(f)));
        expect(offenders).toEqual([]);
    });

    it('the inventory of search boxes is pinned, and every one is wired both ways', () => {
        const found: Record<string, number> = {};
        for (const file of files) {
            if (SHARED.has(file) || !file.endsWith('.tsx')) {continue;}
            for (const tag of jsxTags(read(file), 'SearchInput')) {
                found[file] = (found[file] ?? 0) + 1;
                expect(tag).toMatch(/\bvalue=\{/);
                expect(tag).toMatch(/\bonValueChange=\{/);
                expect(tag).toMatch(/\b(placeholder|aria-label)=/);
            }
        }
        expect(found).toEqual({
            'app/dashboard/audit-logs/page.tsx': 1,
            'app/dashboard/bookings/page.tsx': 1,
            'app/dashboard/menu/badges.tsx': 1,
            'app/dashboard/menu/page.tsx': 2,
            'app/dashboard/menu/queue-preorder-menu.tsx': 1,
            'app/dashboard/menu/taxonomy.tsx': 2,
            'app/dashboard/reports/page.tsx': 1,
            'app/dashboard/valet/page.tsx': 1,
            'app/order/[restaurant]/page.tsx': 1,
            'components/closed-bills.tsx': 2,
            'components/dish-availability-sidebar.tsx': 1,
        });
    });

    it('the boxes that ask the server debounce in the box, and an emptied box asks at once', () => {
        const reports = read('app/dashboard/reports/page.tsx');
        const [r] = jsxTags(reports, 'SearchInput');
        expect(r).toMatch(/onQueryChange=\{setSearch\}/);
        expect(r).toMatch(/debounceMs=\{350\}/);
        // The old page-level debounce is gone: it is what made the x wait.
        expect(reports).not.toMatch(/setSearch\(searchInput/);

        const audit = read('app/dashboard/audit-logs/page.tsx');
        const [a] = jsxTags(audit, 'SearchInput');
        expect(a).toMatch(/value=\{searchInput\}/);
        expect(a).toMatch(/onQueryChange=\{setSearch\}/);
        expect(a).toMatch(/debounceMs=\{300\}/);
        expect(audit).toMatch(/filterFetchDelayMs\(lastFilters\.current, filters, \['search'\], 300\)/);
        expect(audit).toMatch(/\}, delay\);/);
        expect(audit).toMatch(/const resetFilters = \(\) => \{[^}]*setSearchInput\(''\)/);

        const bills = read('components/closed-bills.tsx');
        const boxes = jsxTags(bills, 'SearchInput');
        expect(boxes).toHaveLength(2);
        for (const b of boxes) {
            expect(b).toMatch(/onQueryChange=\{set(Search|Table)\}/);
            expect(b).toMatch(/debounceMs=\{300\}/);
        }
        expect(bills).toMatch(/filterFetchDelayMs\(lastFilters\.current, nextFilters, \['search', 'table'\], 300\)/);
        expect(bills).toMatch(/\}, delay\)/);
        expect(bills).toMatch(/const clearFilters = \(\) => \{ setSearchInput\(""\); setMethod\(""\); setTableInput\(""\)/);
    });

    it('the Menu’s empty state and a deep-linked booking clear through the box’s own value', () => {
        expect(read('app/dashboard/menu/page.tsx')).toMatch(/onClick=\{\(\) => \{ setMenuSearch\(""\); \}\}>Clear search</);
        expect(read('app/dashboard/bookings/page.tsx')).toMatch(/if \(highlight\.id\) \{setQuery\(""\);\}/);
    });

    it('the guest page keeps its skin, says the x in both languages, and uses the bare box', () => {
        const guest = read('app/order/[restaurant]/page.tsx');
        const [g] = jsxTags(guest, 'SearchInput');
        expect(g).toMatch(/^<SearchInput\s+bare\b/);
        expect(g).toContain('clearLabel={t("clearSearch")}');
        expect(guest).toContain('clearSearch: "Clear search",');
        expect(guest).toContain('clearSearch: "खोज साफ़ करें",');
    });
});
