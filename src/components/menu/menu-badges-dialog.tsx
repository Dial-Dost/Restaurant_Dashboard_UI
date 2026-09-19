"use client";

/**
 * The badge CATALOGUE editor (menu_badges.dart `MenuBadgesDialog`), opened from
 * the "Menu badges" toolbar button.
 *
 * Every single action persists IMMEDIATELY — add, toggle, rename, remove each
 * PUT the whole catalogue — and the component keeps the last state the SERVER
 * accepted. A refused or failed write rolls the list back to it: otherwise the
 * owner is left looking at a badge they think they disabled while the guest
 * menu still shows it.
 *
 * A 409 is the server refusing to drop a dietary/safety badge dishes still
 * carry. That is a question, not an error: ask, then repeat the write with
 * `release_tagged`. Nothing was written on the refused attempt, so answering
 * "no" leaves the menu exactly as it was rather than half-applied.
 */

import * as React from "react";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import {
    BADGE_KIND_HINT,
    BADGE_KIND_LABEL,
    BADGE_KIND_ORDER,
    isDerivedBadge,
    isProtectedBadge,
    type MenuBadge,
    type MenuBadgeKind,
} from "@/lib/menu-badges";
import { putMenuBadgeCatalogue } from "@/lib/api/menu";
import { BadgePill } from "./badge-chips";
import { useConfirm, usePrompt } from "./confirm-dialog";

/** Slug rule, mirroring the server's menuBadgeSlug so ids agree on both sides. */
const slugify = (label: string): string =>
    label.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);

export function MenuBadgesDialog({
    initial,
    presets,
    labelMax,
    usage,
    onClose,
}: {
    initial: MenuBadge[];
    /** The starter set the server offers. Never applied on the tenant's behalf. */
    presets: MenuBadge[];
    labelMax: number;
    /** How many dishes currently carry a badge id — drives the removal warning. */
    usage: (id: string) => number;
    /** `changed` = anything was accepted by the server, so the menu reloads. */
    onClose: (changed: boolean) => void;
}): React.JSX.Element {
    const [badges, setBadges] = React.useState<MenuBadge[]>(initial);
    /** The last state the SERVER accepted — the rollback target. */
    const committed = React.useRef<MenuBadge[]>(initial);
    const saved = React.useRef(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [addLabel, setAddLabel] = React.useState("");
    const [addKind, setAddKind] = React.useState<MenuBadgeKind>("promo");
    const { confirm, confirmDialog } = useConfirm();
    const { prompt, promptDialog } = usePrompt();

    const persist = async (next: MenuBadge[], releaseTagged = false): Promise<void> => {
        setBadges(next);
        setBusy(true);
        setError(null);
        const res = await putMenuBadgeCatalogue(next, releaseTagged);
        if (res.ok) {
            committed.current = res.badges;
            saved.current = true;
            setBadges(res.badges);
            setBusy(false);
            return;
        }
        if (res.status === 409 && !releaseTagged) {
            setBusy(false);
            const ok = await confirm({
                title: "Dishes still carry that badge",
                body: `${res.message}\n\nRemove it from those dishes as well?`,
                confirmLabel: "Continue",
            });
            if (ok) {
                await persist(next, true);
            } else {
                // Declined: the server wrote NOTHING, so the list goes back to
                // what it actually holds rather than showing a change that
                // never happened.
                setBadges([...committed.current]);
            }
            return;
        }
        setBadges([...committed.current]);
        setError(res.message);
        setBusy(false);
    };

    const addBadge = async (): Promise<void> => {
        let label = addLabel.trim();
        if (label.length > labelMax) { label = label.slice(0, labelMax); }
        const id = slugify(label);
        if (!id) { return; }
        if (badges.some((b) => b.id === id)) {
            setError(`"${label}" already exists.`);
            return;
        }
        setAddLabel("");
        await persist([...badges, { id, label, kind: addKind, enabled: true }]);
    };

    const removeBadge = async (b: MenuBadge): Promise<void> => {
        const n = usage(b.id);
        // Ask HERE, with the count, rather than letting the server's refusal be
        // the first the owner hears of it: a dietary claim leaving forty dishes
        // should read as a decision, not as an error message.
        if (isProtectedBadge(b) && !isDerivedBadge(b) && n > 0) {
            const ok = await confirm({
                title: `Remove "${b.label}"?`,
                body: `It is on ${n} dish${n === 1 ? "" : "es"}. Removing it removes that claim from ${n === 1 ? "it" : "them"} too.`,
                confirmLabel: "Continue",
            });
            if (!ok) { return; }
            await persist(badges.filter((x) => x.id !== b.id), true);
            return;
        }
        await persist(badges.filter((x) => x.id !== b.id));
    };

    const renameBadge = async (b: MenuBadge): Promise<void> => {
        const to = await prompt({
            title: "Rename badge",
            label: "Label guests see",
            initial: b.label,
            maxLength: labelMax,
        });
        const label = (to ?? "").trim();
        if (!label || label === b.label) { return; }
        // The id never moves, so every dish already tagged keeps its badge.
        await persist(badges.map((x) => (x.id === b.id ? { ...x, label } : x)));
    };

    const toggleBadge = async (b: MenuBadge, on: boolean): Promise<void> => {
        await persist(badges.map((x) => (x.id === b.id ? { ...x, enabled: on } : x)));
    };

    const usageLine = (b: MenuBadge): string => {
        if (isDerivedBadge(b)) { return `Automatic — on any dish listing "${b.allergen ?? ""}"`; }
        const n = usage(b.id);
        return n > 0 ? `${n} dish${n === 1 ? "" : "es"}` : "not used yet";
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) { onClose(saved.current); } }}>
            <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[520px]">
                <DialogHeader className="px-5 pb-2 pt-5 text-left">
                    <div className="micro-label mb-1.5">Guest menu</div>
                    <DialogTitle>Menu badges</DialogTitle>
                    <DialogDescription>
                        Small labels guests see on a dish. Warnings and dietary badges are always shown;
                        highlights are trimmed first when a card is tight. Nothing appears on your menu
                        until you add one.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
                    {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
                    {badges.length === 0 ? (
                        <EmptyState
                            icon={<Tag />}
                            title="No badges yet"
                            caption="Your menu looks exactly as it does today. Start from the set suggested for Indian restaurants, then edit or remove anything you do not want."
                            action={
                                <Button
                                    size="sm"
                                    disabled={busy || presets.length === 0}
                                    onClick={() => { void persist(presets.map((b) => ({ ...b }))); }}
                                >
                                    Use the starter set ({presets.length})
                                </Button>
                            }
                        />
                    ) : (
                        BADGE_KIND_ORDER.filter((kind) => badges.some((b) => b.kind === kind)).map((kind) => (
                            <div key={kind}>
                                <div className="micro-label pb-1.5 pt-1">
                                    {BADGE_KIND_LABEL[kind]} — <span className="normal-case tracking-normal">{BADGE_KIND_HINT[kind]}</span>
                                </div>
                                {badges.filter((b) => b.kind === kind).map((b) => (
                                    <div key={b.id} className="mb-2 flex items-center gap-2.5 rounded-[10px] border border-border bg-inset px-3 py-2">
                                        <BadgePill badge={b} dense={false} />
                                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{usageLine(b)}</span>
                                        <Switch
                                            checked={b.enabled}
                                            disabled={busy}
                                            aria-label={`${b.enabled ? "Disable" : "Enable"} ${b.label}`}
                                            onCheckedChange={(v) => { void toggleBadge(b, v); }}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="Rename"
                                            aria-label={`Rename ${b.label}`}
                                            disabled={busy}
                                            onClick={() => { void renameBadge(b); }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="Remove"
                                            aria-label={`Remove ${b.label}`}
                                            disabled={busy}
                                            onClick={() => { void removeBadge(b); }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>

                <div className="shrink-0 space-y-3 border-t border-divider px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            value={addLabel}
                            maxLength={labelMax}
                            placeholder="New badge (e.g. Gluten free)"
                            aria-label="New badge"
                            className="min-w-[180px] flex-1"
                            disabled={busy}
                            onChange={(e) => { setAddLabel(e.target.value); }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    void addBadge();
                                }
                            }}
                        />
                        <Select value={addKind} onValueChange={(v) => { setAddKind(v as MenuBadgeKind); }}>
                            <SelectTrigger className="w-[140px]" aria-label="New badge type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {BADGE_KIND_ORDER.map((k) => (
                                    <SelectItem key={k} value={k}>{BADGE_KIND_LABEL[k]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Add badge"
                            aria-label="Add badge"
                            disabled={busy}
                            onClick={() => { void addBadge(); }}
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="flex justify-end">
                        <Button type="button" onClick={() => { onClose(saved.current); }}>Done</Button>
                    </div>
                </div>

                {confirmDialog}
                {promptDialog}
            </DialogContent>
        </Dialog>
    );
}
