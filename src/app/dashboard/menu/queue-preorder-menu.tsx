"use client";

/**
 * THE QUEUE PRE-ORDER MENU editor.
 *
 * A walk-in standing in the queue can stage a pre-order while they wait. Until
 * now they saw the WHOLE dine-in menu, which is wrong for a kitchen that cannot
 * start a 40-minute biryani for a party still at the door — but "mark it
 * unavailable" would also take it off the table menu, which is not what anyone
 * wants. This screen is the second, narrower view of the same menu.
 *
 * Two things it deliberately does NOT do:
 *  - it does not filter anything itself. The rule is enforced by the server on
 *    the endpoint the queue page reads AND on the pre-order write; this editor
 *    only says what the rule is, and `queue_included` on each row is computed by
 *    that same server function so the preview cannot drift from reality.
 *  - it does not invent knobs the queue page cannot honour. Headline, intro,
 *    prices on/off and the category order are exactly what that page renders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, ListFilter, RotateCcw, Search, Timer } from "lucide-react";
import {
    getQueueMenuConfig,
    resetQueueMenuConfig,
    saveQueueMenuConfig,
    type QueueMenuConfig,
    type QueueMenuConfigPayload,
    type QueueMenuItem,
    type QueueMenuMode,
} from "@/lib/db";
// The SAME ordering rule the queue page and the server apply, so this preview
// cannot promise a tab order the guest will not get.
import { isOfferedToQueue, orderCategoriesByPreference as orderCategories } from "@/lib/queue-menu";

// Mirrors the server-side caps (queue_menu.ts) so the field stops the owner at
// the same place the sanitizer would silently trim them.
const HEADLINE_MAX = 80;
const INTRO_MAX = 240;

const MODES: { value: QueueMenuMode; label: string; hint: string }[] = [
    { value: "all", label: "Everything", hint: "The whole menu, exactly as it is today." },
    { value: "include", label: "Only what I pick", hint: "Nothing is pre-orderable unless you tick it." },
    { value: "exclude", label: "Everything except", hint: "Keep the slow dishes off the queue list." },
];

const EMPTY: QueueMenuConfig = { mode: "all", items: [], categories: [], category_order: [], headline: "", intro: "", show_prices: true };

const sameKey = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function QueuePreorderMenuCard({ restaurantId }: { restaurantId: string }) {
    const [payload, setPayload] = useState<QueueMenuConfigPayload | null>(null);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        if (!restaurantId) {return;}
        setPayload(await getQueueMenuConfig(restaurantId));
    }, [restaurantId]);

    useEffect(() => { void load(); }, [load]);

    const cfg = payload?.config ?? EMPTY;
    const offered = (payload?.items ?? []).filter((i) => i.queue_included).length;
    const total = (payload?.items ?? []).length;

    const summary = (() => {
        if (!payload) {return "Loading…";}
        if (!payload.queue_show_menu) {return "The queue page is showing no menu at all right now (Settings → queue menu)."; }
        if (!payload.configured) {return "Queuing guests can pre-order anything on the menu — the default.";}
        if (cfg.mode === "all") {return `All ${String(offered)} available dishes are offered while guests wait.`;}
        return `${String(offered)} of ${String(total)} dishes are offered to guests waiting in the queue.`;
    })();

    return (
        <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2"><Timer className="h-5 w-5 text-primary" /> Queue pre-order menu</CardTitle>
                    <CardDescription>
                        What a walk-in waiting in the queue can order before they sit down. Leaving a dish off here does <strong>not</strong> take it off the dine-in menu.
                    </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setOpen(true); }} disabled={!payload}>
                    <ListFilter className="mr-2 h-4 w-4" /> Customise
                </Button>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{summary}</p>
                {payload?.configured && cfg.mode !== "all" ? (
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{MODES.find((m) => m.value === cfg.mode)?.label}</Badge>
                        {cfg.categories.map((c) => <Badge key={`c-${c}`} variant="outline">{c}</Badge>)}
                        {cfg.items.length > 0 && <Badge variant="outline">{cfg.items.length} named dish{cfg.items.length === 1 ? "" : "es"}</Badge>}
                    </div>
                ) : null}
            </CardContent>
            {payload ? (
                <QueuePreorderDialog
                    open={open}
                    onOpenChange={setOpen}
                    restaurantId={restaurantId}
                    payload={payload}
                    onSaved={() => { void load(); }}
                />
            ) : null}
        </Card>
    );
}

function QueuePreorderDialog({
    open, onOpenChange, restaurantId, payload, onSaved,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    restaurantId: string;
    payload: QueueMenuConfigPayload;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState<QueueMenuConfig>(payload.config);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-seed whenever the dialog is opened, so a cancelled edit never leaks
    // into the next one.
    useEffect(() => { if (open) { setDraft(payload.config); setQuery(""); setError(null); } }, [open, payload.config]);

    const allCategories = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const it of payload.items) {
            const c = (it.category || "").trim();
            if (!c || seen.has(c.toLowerCase())) {continue;}
            seen.add(c.toLowerCase());
            out.push(c);
        }
        return out.sort((a, b) => a.localeCompare(b));
    }, [payload.items]);

    // What a queuing guest would see under the CURRENT draft, grouped and
    // ordered the way the queue page will render it.
    const preview = useMemo(() => {
        const kept = payload.items.filter((i) => isOfferedToQueue(draft, i));
        const groups = new Map<string, QueueMenuItem[]>();
        for (const it of kept) {
            const c = (it.category || "Menu").trim();
            const bucket = groups.get(c);
            if (bucket) {bucket.push(it);} else {groups.set(c, [it]);}
        }
        return orderCategories(draft.category_order, [...groups.keys()]).map((c) => ({ category: c, items: groups.get(c) ?? [] }));
    }, [draft, payload.items]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {return payload.items;}
        return payload.items.filter((i) => `${i.name} ${i.category}`.toLowerCase().includes(q));
    }, [payload.items, query]);

    const toggleList = (field: "items" | "categories", value: string) => {
        setDraft((d) => {
            const has = d[field].some((v) => sameKey(v, value));
            return { ...d, [field]: has ? d[field].filter((v) => !sameKey(v, value)) : [...d[field], value] };
        });
    };

    const moveCategory = (category: string, delta: number) => {
        setDraft((d) => {
            // The stored order only ever contains real categories; anything the
            // owner has not moved yet is implicitly alphabetical after them.
            const base = d.category_order.length > 0 ? orderCategories(d.category_order, allCategories) : [...allCategories];
            const from = base.findIndex((c) => sameKey(c, category));
            const to = from + delta;
            if (from < 0 || to < 0 || to >= base.length) {return d;}
            const next = [...base];
            const [moved] = next.splice(from, 1);
            if (moved === undefined) {return d;}
            next.splice(to, 0, moved);
            return { ...d, category_order: next };
        });
    };

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            // Blank copy is sent as "" on purpose: the server reads that as a
            // CLEAR, which is the only way to remove a custom headline once set.
            await saveQueueMenuConfig(restaurantId, {
                mode: draft.mode,
                items: draft.items,
                categories: draft.categories,
                category_order: draft.category_order,
                headline: draft.headline,
                intro: draft.intro,
                show_prices: draft.show_prices,
            });
            onSaved();
            onOpenChange(false);
        } catch (e: unknown) {
            setError((e as { message?: string }).message ?? "Unable to save the queue menu.");
        } finally {
            setBusy(false);
        }
    };

    const reset = async () => {
        if (!window.confirm("Show queuing guests the whole menu again, and drop the custom wording?")) {return;}
        setBusy(true);
        setError(null);
        try {
            await resetQueueMenuConfig(restaurantId);
            onSaved();
            onOpenChange(false);
        } catch (e: unknown) {
            setError((e as { message?: string }).message ?? "Unable to reset the queue menu.");
        } finally {
            setBusy(false);
        }
    };

    const previewCount = preview.reduce((n, g) => n + g.items.length, 0);
    const orderedCategories = orderCategories(draft.category_order, allCategories);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Queue pre-order menu</DialogTitle>
                    <DialogDescription>
                        These rules apply only to guests waiting in the walk-in queue. The dine-in QR menu is untouched.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-6">
                        {/* --- WHICH dishes ------------------------------------ */}
                        <section className="space-y-2">
                            <Label className="text-sm font-semibold">Which dishes can they pre-order?</Label>
                            <div className="grid gap-2">
                                {MODES.map((m) => (
                                    <button
                                        key={m.value}
                                        type="button"
                                        onClick={() => { setDraft((d) => ({ ...d, mode: m.value })); }}
                                        className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${draft.mode === m.value ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                                    >
                                        <span className="font-medium">{m.label}</span>
                                        <span className="block text-xs text-muted-foreground">{m.hint}</span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        {draft.mode !== "all" && (
                            <section className="space-y-3">
                                <div>
                                    <Label className="text-sm font-semibold">
                                        {draft.mode === "include" ? "Offer these" : "Keep these off the queue menu"}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Tick a whole category, or individual dishes. Both lists apply together.
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {allCategories.map((c) => {
                                        const on = draft.categories.some((v) => sameKey(v, c));
                                        return (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => { toggleList("categories", c); }}
                                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-primary bg-primary/15 font-medium" : "hover:bg-muted"}`}
                                            >
                                                {c}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="relative">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        value={query}
                                        onChange={(e) => { setQuery(e.target.value); }}
                                        placeholder="Find a dish"
                                        className="pl-8"
                                        aria-label="Find a dish"
                                    />
                                </div>

                                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                                    {shown.length === 0 && <p className="p-2 text-sm text-muted-foreground">No dishes match.</p>}
                                    {shown.map((it) => {
                                        const listedByCategory = draft.categories.some((c) => sameKey(c, it.category));
                                        const ticked = draft.items.some((v) => sameKey(v, it.id)) || listedByCategory;
                                        return (
                                            <label
                                                key={it.id}
                                                className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted"
                                            >
                                                <Checkbox
                                                    checked={ticked}
                                                    // A dish covered by its whole category is already decided;
                                                    // letting the row be un-ticked would look like it worked
                                                    // and change nothing.
                                                    disabled={listedByCategory}
                                                    onCheckedChange={() => { toggleList("items", it.id); }}
                                                    aria-label={it.name}
                                                />
                                                <span className="flex-1 truncate">{it.name}</span>
                                                <span className="text-xs text-muted-foreground">{it.category}</span>
                                                {it.available === false && <Badge variant="outline" className="text-[10px]">Sold out</Badge>}
                                            </label>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* --- HOW it reads ------------------------------------ */}
                        <section className="space-y-3">
                            <Label className="text-sm font-semibold">How it reads</Label>
                            <div className="space-y-1">
                                <Label htmlFor="queue-headline" className="text-xs">Heading</Label>
                                <Input
                                    id="queue-headline"
                                    value={draft.headline}
                                    maxLength={HEADLINE_MAX}
                                    placeholder="Get a head start"
                                    onChange={(e) => { setDraft((d) => ({ ...d, headline: e.target.value })); }}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="queue-intro" className="text-xs">Line underneath</Label>
                                <Textarea
                                    id="queue-intro"
                                    value={draft.intro}
                                    maxLength={INTRO_MAX}
                                    rows={2}
                                    placeholder="Pick what you'd like — we'll confirm with you once you're seated, then it goes to the kitchen."
                                    onChange={(e) => { setDraft((d) => ({ ...d, intro: e.target.value })); }}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Leave both blank to keep the built-in wording, which is translated for Hindi guests. Your own words are shown as typed.
                                </p>
                            </div>
                            <div className="flex items-center justify-between rounded-md border p-3">
                                <div>
                                    <Label htmlFor="queue-prices" className="text-sm">Show prices</Label>
                                    <p className="text-xs text-muted-foreground">Nothing is charged while they wait either way.</p>
                                </div>
                                <Switch
                                    id="queue-prices"
                                    checked={draft.show_prices}
                                    onCheckedChange={(v) => { setDraft((d) => ({ ...d, show_prices: v })); }}
                                />
                            </div>
                        </section>

                        {/* --- Category order ---------------------------------- */}
                        {allCategories.length > 1 && (
                            <section className="space-y-2">
                                <Label className="text-sm font-semibold">Category order</Label>
                                <p className="text-xs text-muted-foreground">The order the tabs appear in on the queue page.</p>
                                <div className="space-y-1">
                                    {orderedCategories.map((c, i) => (
                                        <div key={c} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                                            <span className="flex-1 truncate">{c}</span>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => { moveCategory(c, -1); }} aria-label={`Move ${c} up`}>
                                                <ArrowUp className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={i === orderedCategories.length - 1} onClick={() => { moveCategory(c, 1); }} aria-label={`Move ${c} down`}>
                                                <ArrowDown className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>

                    {/* --- PREVIEW --------------------------------------------- */}
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold">What a queuing guest sees</Label>
                        <div className="rounded-lg border bg-muted/30 p-4">
                            <p className="text-sm font-semibold">{draft.headline.trim() || "Get a head start"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {draft.intro.trim() || "Pick what you'd like — we'll confirm with you once you're seated, then it goes to the kitchen."}
                            </p>

                            {previewCount === 0 ? (
                                <p className="mt-4 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                                    Nothing is offered — guests will see their place in the queue and no menu.
                                </p>
                            ) : (
                                <>
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {preview.map((g, i) => (
                                            <span key={g.category} className={`rounded-full px-2.5 py-1 text-[11px] ${i === 0 ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>
                                                {g.category}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="mt-3 space-y-1.5">
                                        {(preview[0]?.items ?? []).map((it) => (
                                            <div key={it.id} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm">
                                                <span className="truncate">{it.name}</span>
                                                {draft.show_prices && <span className="text-xs text-muted-foreground">₹{it.price}</span>}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                        Showing the first tab. {previewCount} dish{previewCount === 1 ? "" : "es"} offered in total.
                                    </p>
                                </>
                            )}
                        </div>
                        {!payload.queue_show_menu && (
                            <p className="text-xs text-amber-600">
                                The queue page is currently set to show no menu at all. Turn that back on in Settings for any of this to appear.
                            </p>
                        )}
                    </div>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="gap-2 sm:justify-between">
                    <Button type="button" variant="ghost" onClick={() => { void reset(); }} disabled={busy || !payload.configured}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Back to the whole menu
                    </Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
                        <Button type="button" onClick={() => { void save(); }} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
