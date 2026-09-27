"use client";

/**
 * Per-line controls on a table's KOT list (docs/parity/bill-preview.md 19–20;
 * Flutter modules.dart itemRow): the sticky-note button any staff may use
 * ("Add note" / "Edit note", copper when a note exists) and, for an admin, the
 * "Edit item" menu — Remove from KOT / Move to another table.
 *
 * ROUND 4 ITEM 2 — WHY THE FIRST ENTRY IS NO LONGER "REMOVE FROM BILL". The
 * client's words: 'Remove from bill makes it sound like the item is going to be
 * served but only removed from bill.' They are right, and the misreading is not
 * hypothetical — it is the exact description of a COMP, which this product has
 * as a separate act on a separate surface: "Non-chargeable item…" in the Orders
 * screen's capture menu, and "Comp an item" on the order sheet, both gated on
 * the comp permission. A comped dish IS cooked and IS carried to the table; the
 * house simply does not charge for it.
 *
 * This control does the opposite. The line comes off the ticket, the pass is
 * sent a CANCELLED slip for it, and nobody plates anything. Naming it after the
 * bill described the one part of the act that is a side effect and hid the part
 * that matters, on a menu that sits one row above "Move to another table" — two
 * kitchen acts and, until now, one of them wearing a money label.
 *
 * THE ROUTE IT POSTS TO IS UNCHANGED (/bills/remove-item). Every till in the
 * field speaks that path; a label is not a contract.
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

/**
 * CLIENT ITEM 2 — WHAT TO TELL THE ADMIN ABOUT THE PASS.
 *
 * A removed dish now prints a CANCELLED slip under the number the kitchen knows
 * the ticket by, the same sentence shape a move's correction docket gets. When
 * nothing printed — the line was never ticketed, or the tenant prints on demand
 * — there is nothing to say and the toast stays the plain confirmation, because
 * a docket line that names no docket is worse than none.
 */
const removedItemSentence = (dish: string, response: unknown): string => {
    const answer = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : {};
    const no = typeof answer.kot_no === "number" ? String(answer.kot_no) : typeof answer.kot_no === "string" ? answer.kot_no.trim() : "";
    return answer.kot_cancelled === true && no !== ""
        ? `Removed ${dish} from KOT-${no}. The slip is printing as CANCELLED — tell the pass.`
        : `Removed ${dish} from the KOT. It will not be cooked.`;
};

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
    /** The KOT block this line sits in — null on the trailing "No KOT number" block. */
    orderId: string | null;
    item: { name: string; price: number; note: string; id?: string | null };
    isAdmin: boolean;
    /** Every other table on the floor (move destinations). */
    otherTables: readonly string[];
    onChanged: () => void;
}

export function KotLineActions({ restaurantId, tableName, orderId, item, isAdmin, otherTables, onChanged }: KotLineActionsProps): React.JSX.Element {
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
            // The LINE, not every dish on the table with this name (client item 1).
            const res = await removeBillItem(restaurantId, tableName, { ...ref, id: item.id ?? null, orderId });
            toast({ title: removedItemSentence(item.name, res) });
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
                        <DropdownMenuItem onSelect={() => { setOpen("remove"); }}>Remove from KOT</DropdownMenuItem>
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
                        <AlertDialogTitle>Remove &quot;{item.name}&quot; from this KOT?</AlertDialogTitle>
                        {/* Says what the kitchen is about to be told, and what the
                            guest will not get — the two facts "remove from bill"
                            left to be guessed. To take the charge off but still
                            serve the dish, the act is Non-chargeable, not this. */}
                        <AlertDialogDescription>
                            It comes off the ticket and off the bill, and the kitchen gets a CANCELLED slip for it, so it
                            will not be cooked or served. To serve it free of charge instead, mark it non-chargeable.
                        </AlertDialogDescription>
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
