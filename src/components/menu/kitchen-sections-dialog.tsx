"use client";

/**
 * Kitchen-sections manager (modules.dart `_KitchenSectionsDialog`): opened from
 * the toolbar, eyebrow "KOT ROUTING", title "Kitchen sections", the admin-only
 * note when relevant, an add field, and list rows (tag icon · name · rename
 * pencil · delete) as inset cards. Rename cascades onto items server-side.
 * Errors land INLINE (403s humanised: "Only an admin can change kitchen
 * sections."), and `Done` reports whether anything changed so the menu reloads.
 *
 * The "Organise by kitchen" bulk assigner is a [web-extra] kept from the old
 * page; its entry point lives here, beside the list it organises against.
 */

import * as React from "react";
import { ChefHat, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameKitchenSectionChecked, saveKitchenSectionList } from "@/lib/api/menu";
import { useConfirm, usePrompt } from "./confirm-dialog";

export function KitchenSectionsDialog({
    isAdmin,
    initial,
    organiseDisabled,
    onOrganise,
    onClose,
}: {
    isAdmin: boolean;
    initial: string[];
    organiseDisabled: boolean;
    /** Opens the [web-extra] Organise-by-kitchen bulk dialog. */
    onOrganise: () => void;
    /** `changed` = anything was written, so the caller reloads the menu. */
    onClose: (changed: boolean) => void;
}): React.JSX.Element {
    const [sections, setSections] = React.useState<string[]>(initial);
    const [add, setAdd] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const changed = React.useRef(false);
    const { confirm, confirmDialog } = useConfirm();
    const { prompt, promptDialog } = usePrompt();

    const save = async (next: string[]): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            setSections(await saveKitchenSectionList(next));
            changed.current = true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const addSection = async (): Promise<void> => {
        const name = add.trim().replace(/\s+/g, " ");
        if (!name) { return; }
        if (sections.some((s) => s.toLowerCase() === name.toLowerCase())) {
            setAdd("");
            return;
        }
        setAdd("");
        await save([...sections, name]);
    };

    const rename = async (from: string): Promise<void> => {
        const raw = await prompt({ title: `Rename "${from}"`, label: "New section name" });
        const to = (raw ?? "").trim().replace(/\s+/g, " ");
        if (!to || to === from) { return; }
        setBusy(true);
        setError(null);
        try {
            const result = await renameKitchenSectionChecked(from, to);
            setSections(result.kitchen_sections ?? sections.map((s) => (s === from ? to : s)));
            changed.current = true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (name: string): Promise<void> => {
        const ok = await confirm({
            title: "Remove section",
            body: `Remove "${name}"? Items keep the label but show as unassigned until re-organised.`,
        });
        if (!ok) { return; }
        await save(sections.filter((s) => s.toLowerCase() !== name.toLowerCase()));
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) { onClose(changed.current); } }}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader className="text-left">
                    <div className="micro-label mb-1.5">KOT Routing</div>
                    <DialogTitle>Kitchen sections</DialogTitle>
                    {!isAdmin ? (
                        <DialogDescription>Adding or removing sections is admin-only.</DialogDescription>
                    ) : (
                        <DialogDescription className="sr-only">Kitchen sections</DialogDescription>
                    )}
                </DialogHeader>

                <div className="flex items-center gap-2">
                    <Input
                        placeholder="New section (e.g. tandoor)"
                        aria-label="New section"
                        value={add}
                        maxLength={32}
                        disabled={busy}
                        onChange={(e) => { setAdd(e.target.value); }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void addSection();
                            }
                        }}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Add section"
                        aria-label="Add section"
                        disabled={busy}
                        onClick={() => void addSection()}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                {sections.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">No sections yet. Add one above, then assign items to it.</p>
                ) : (
                    <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                        {sections.map((s) => (
                            <div key={s} className="flex items-center gap-2 rounded-[10px] border border-border bg-inset px-3 py-2">
                                <Tag className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Rename"
                                    aria-label={`Rename ${s}`}
                                    disabled={busy}
                                    onClick={() => void rename(s)}
                                >
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Remove"
                                    aria-label={`Remove ${s}`}
                                    disabled={busy}
                                    onClick={() => void remove(s)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                    <Button type="button" variant="ghost" size="sm" disabled={organiseDisabled} onClick={onOrganise}>
                        <ChefHat className="mr-2 h-4 w-4" /> Organise by kitchen
                    </Button>
                    <Button type="button" onClick={() => { onClose(changed.current); }}>Done</Button>
                </div>

                {confirmDialog}
                {promptDialog}
            </DialogContent>
        </Dialog>
    );
}
