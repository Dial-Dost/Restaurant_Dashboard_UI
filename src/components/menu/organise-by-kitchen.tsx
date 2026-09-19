"use client";

/**
 * "Organise by kitchen" — [web-extra] kept from the old menu page (audit
 * finding 25): every menu item grouped by its CURRENT section (managed →
 * unmanaged → Unassigned), searchable, with a quick per-row section picker.
 * Saving persists through the preserve-on-omit bulk menu save, so recipes,
 * modifiers, allergens and images survive untouched. Flutter's own path for
 * this job is the per-item station picker sheet; this bulk view is extra, and
 * its entry point lives inside the Kitchen sections dialog.
 */

import * as React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/app/dashboard/menu/data";
import { StationSelect } from "./section-selector";

export function OrganiseByKitchenDialog({
    items,
    sections,
    onClose,
    onSave,
}: {
    items: MenuItem[];
    sections: string[];
    onClose: () => void;
    onSave: (assignments: Record<string, string | null>) => Promise<void>;
}): React.JSX.Element {
    const [assignments, setAssignments] = React.useState<Record<string, string | null>>({});
    const [search, setSearch] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const stationOf = (item: MenuItem): string =>
        (item.id in assignments ? assignments[item.id] : item.station) ?? "";

    const q = search.trim().toLowerCase();
    const visible = q
        ? items.filter((it) =>
            it.name.toLowerCase().includes(q)
            || it.category.toLowerCase().includes(q)
            || stationOf(it).toLowerCase().includes(q))
        : items;

    // Group by current section: managed sections first (in managed order), then
    // any unmanaged station labels still on items, then Unassigned.
    const managedLower = sections.map((s) => s.toLowerCase());
    const groups: { label: string; unmanaged: boolean; rows: MenuItem[] }[] =
        sections.map((s) => ({ label: s, unmanaged: false, rows: [] as MenuItem[] }));
    const extra = new Map<string, MenuItem[]>();
    const unassigned: MenuItem[] = [];
    for (const it of visible) {
        const st = stationOf(it).trim();
        if (!st) { unassigned.push(it); continue; }
        const idx = managedLower.indexOf(st.toLowerCase());
        if (idx >= 0) { groups[idx].rows.push(it); continue; }
        const list = extra.get(st) ?? [];
        list.push(it);
        extra.set(st, list);
    }
    for (const [label, rows] of Array.from(extra.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        groups.push({ label, unmanaged: true, rows });
    }
    groups.push({ label: "Unassigned", unmanaged: true, rows: unassigned });

    const changedCount = Object.keys(assignments).filter((id) => {
        const item = items.find((it) => it.id === id);
        return item && (assignments[id] ?? "") !== (item.station ?? "");
    }).length;

    const save = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            await onSave(assignments);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save assignments.");
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader className="text-left">
                    <DialogTitle>Organise menu by kitchen</DialogTitle>
                    <DialogDescription>
                        Assign every dish to its kitchen section — each section has its own display in the kitchen.
                    </DialogDescription>
                </DialogHeader>
                <Input
                    placeholder="Search items, categories or sections…"
                    aria-label="Search items, categories or sections"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); }}
                />
                <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
                    {groups.filter((g) => g.rows.length > 0 || !g.unmanaged).map((g) => (
                        <div key={g.label}>
                            <p className={cn("micro-label mb-1.5 flex items-center gap-2", g.unmanaged && "text-warning")}>
                                {g.label}
                                {g.unmanaged && g.label !== "Unassigned" ? (
                                    <span className="font-normal normal-case tracking-normal">(not a managed section)</span>
                                ) : null}
                                <span className="font-normal">· {g.rows.length}</span>
                            </p>
                            {g.rows.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No items yet.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {g.rows.map((it) => (
                                        <li key={it.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-inset p-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">{it.name}</p>
                                                <p className="text-xs text-muted-foreground">{it.category}</p>
                                            </div>
                                            <div className="w-44 shrink-0">
                                                <StationSelect
                                                    value={stationOf(it)}
                                                    sections={sections}
                                                    onChange={(v) => {
                                                        setAssignments((prev) => ({ ...prev, [it.id]: v || null }));
                                                    }}
                                                />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                    {visible.length === 0 && <p className="text-sm text-muted-foreground">No items match “{search}”.</p>}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={busy || changedCount === 0}>
                        {busy ? "Saving…" : `Save${changedCount > 0 ? ` (${changedCount} change${changedCount === 1 ? "" : "s"})` : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
