"use client";

/**
 * Per-line controls on a table's KOT list (docs/parity/bill-preview.md 19–20;
 * Flutter modules.dart itemRow): the sticky-note button any staff may use
 * ("Add note" / "Edit note", copper when a note exists) and, for an admin, the
 * "Edit item" menu — Remove from bill / Move to another table.
 */

import * as React from "react";
import { MoreVertical, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { moveDishSummary, movedDishesOf } from "@/lib/api/tables-floor";
import { announceReprintNeeded, readReprintNeeded } from "@/lib/reprint-needed";
import { moveBillItem, removeBillItem, saveBillItemNote } from "@/lib/api/bill-print";

/** order_moves.dart `movedItemSentence`. */
const movedItemSentence = (toTable: string, fallbackName: string, response: unknown): string => {
    const dishes = movedDishesOf(response);
    const what = dishes.length === 0 ? fallbackName : moveDishSummary(dishes);
    const prints = typeof response === "object" && response !== null && Array.isArray((response as { prints?: unknown }).prints)
        ? ((response as { prints: unknown[] }).prints.filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null))
        : [];
    const nos = prints
        .map((p) => ({ printed: p.printed === true, no: typeof p.kot_no === "number" ? String(p.kot_no) : typeof p.kot_no === "string" ? p.kot_no.trim() : "" }))
        .filter((p) => p.printed && p.no !== "")
        .map((p) => `KOT-${p.no}`);
    const docket = nos.length === 0
        ? ""
        : ` Docket ${nos.join(", ")} ${nos.length === 1 ? "is" : "are"} printing for ${toTable} — tell the pass.`;
    return `Moved ${what} to Table ${toTable}.${docket}`;
};

export interface KotLineActionsProps {
    restaurantId: string;
    tableName: string;
    item: { name: string; price: number; note: string };
    isAdmin: boolean;
    /** Every other table on the floor (move destinations). */
    otherTables: readonly string[];
    onChanged: () => void;
}

export function KotLineActions({ restaurantId, tableName, item, isAdmin, otherTables, onChanged }: KotLineActionsProps): React.JSX.Element {
    const { toast } = useToast();
    const [open, setOpen] = React.useState<"note" | "remove" | "move" | null>(null);
    const [noteText, setNoteText] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const hasNote = item.note.trim() !== "";
    const ref = { name: item.name, price: item.price };

    const fail = (e: unknown): void => {
        toast({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    };

    const saveNote = async (): Promise<void> => {
        const note = noteText.trim();
        setBusy(true);
        try {
            await saveBillItemNote(restaurantId, tableName, ref, note);
            toast({ title: note === "" ? "Note cleared." : "Note saved." });
            setOpen(null);
            onChanged();
        } catch (e: unknown) { fail(e); } finally { setBusy(false); }
    };

    const remove = async (): Promise<void> => {
        setBusy(true);
        try {
            await removeBillItem(restaurantId, tableName, ref);
            toast({ title: `Removed ${item.name}.` });
            setOpen(null);
            onChanged();
        } catch (e: unknown) { fail(e); } finally { setBusy(false); }
    };

    const move = async (dest: string): Promise<void> => {
        setBusy(true);
        try {
            const res = await moveBillItem(restaurantId, tableName, dest, ref);
            const lead = movedItemSentence(dest, item.name, res);
            const reprints = readReprintNeeded(res);
            toast({ title: lead });
            if (reprints.length > 0) { announceReprintNeeded(reprints); }
            setOpen(null);
            onChanged();
        } catch (e: unknown) {
            // A comped dish / a printed bill is refused in the server's words.
            fail(e);
        } finally { setBusy(false); }
    };

    return (
        <>
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title={hasNote ? "Edit note" : "Add note"}
                aria-label={hasNote ? "Edit note" : "Add note"}
                onClick={() => { setNoteText(item.note); setOpen("note"); }}
            >
                <StickyNote className={`h-[18px] w-[18px] ${hasNote ? "text-primary" : "text-muted-foreground"}`} />
            </Button>
            {isAdmin ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Edit item" aria-label="Edit item">
                            <MoreVertical className="h-[18px] w-[18px]" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => { setOpen("remove"); }}>Remove from bill</DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() => {
                                if (otherTables.length === 0) { toast({ title: "No other tables available." }); return; }
                                setOpen("move");
                            }}
                        >Move to another table</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}

            <Dialog open={open === "note"} onOpenChange={(o) => { if (!o && !busy) { setOpen(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Note for {item.name}</DialogTitle>
                        <DialogDescription className="sr-only">A kitchen note on this item. Leave it empty to clear it.</DialogDescription>
                    </DialogHeader>
                    <Textarea
                        autoFocus
                        rows={3}
                        placeholder="e.g. no onions, extra spicy…"
                        value={noteText}
                        onChange={(e) => { setNoteText(e.target.value); }}
                    />
                    <DialogFooter>
                        <Button variant="ghost" disabled={busy} onClick={() => { setOpen(null); }}>Cancel</Button>
                        <Button disabled={busy} onClick={() => { void saveNote(); }}>{busy ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={open === "remove"} onOpenChange={(o) => { if (!o && !busy) { setOpen(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove item?</AlertDialogTitle>
                        <AlertDialogDescription>Remove &quot;{item.name}&quot; from this table&apos;s bill?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(e) => { e.preventDefault(); void remove(); }}
                        >Remove</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={open === "move"} onOpenChange={(o) => { if (!o && !busy) { setOpen(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Move &quot;{item.name}&quot; to…</DialogTitle>
                        <DialogDescription className="sr-only">Pick the table this item moves to.</DialogDescription>
                    </DialogHeader>
                    <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                        {otherTables.map((t) => (
                            <Button key={t} variant="outline" disabled={busy} onClick={() => { void move(t); }}>Table {t}</Button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
