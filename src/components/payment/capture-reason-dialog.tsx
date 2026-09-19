"use client";

/**
 * The shared styled capture dialog — the web `_CaptureReasonDialog`
 * (screens/mis_capture.dart). Uppercase title, a money headline in display
 * type (danger or copper), kind pills, the reason (mandatory unless the act
 * says otherwise), the authoriser pre-filled with the signed-in username, and
 * a confirm that stays disabled until the form is valid. Every recorded act in
 * the payment flow (void a payment, put a comp back, remove / put back the
 * service charge, comp a line) goes through this — never window.prompt.
 */

import * as React from "react";
import { Info, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { OPTIONAL_REASON_LABEL } from "@/lib/api/payment";

/** One selectable pill — the `_CapturePill` chip. */
export function Pill({
    selected, onClick, disabled, children, danger,
}: {
    selected: boolean;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50",
                selected
                    ? danger
                        ? "border-destructive/60 bg-destructive/12 text-destructive"
                        : "border-accent-hi/60 bg-accent-hi/15 text-foreground"
                    : "border-border bg-inset text-muted-foreground hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
}

export interface CaptureAnswer {
    kind: string;
    reason: string;
    authorisedBy: string;
    quantity: number;
}

export interface CaptureReasonDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    headline?: string | null;
    /** Recompute the headline for the stepper's quantity (comp). */
    headlineFor?: (quantity: number) => string;
    danger?: boolean;
    subtitle: string;
    confirmLabel: string;
    kinds?: readonly { value: string; label: string; hint?: string }[];
    needsAuthoriser?: boolean;
    suggestedAuthoriser?: string;
    reasonOptional?: boolean;
    /** A quantity stepper 1..max (comp a line of several). */
    quantityMax?: number;
    /** Runs on confirm; throw to keep the dialog open (the error shows inline). */
    onConfirm: (answer: CaptureAnswer) => Promise<void>;
}

export function CaptureReasonDialog({
    open, onOpenChange, title, headline, headlineFor, danger, subtitle, confirmLabel,
    kinds = [], needsAuthoriser = false, suggestedAuthoriser = "", reasonOptional = false,
    quantityMax, onConfirm,
}: CaptureReasonDialogProps): React.JSX.Element {
    const [kind, setKind] = React.useState("");
    const [reason, setReason] = React.useState("");
    const [authorisedBy, setAuthorisedBy] = React.useState(suggestedAuthoriser);
    const [qty, setQty] = React.useState(quantityMax ?? 1);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (open) {
            setKind("");
            setReason("");
            setAuthorisedBy(suggestedAuthoriser);
            setQty(quantityMax ?? 1);
            setError(null);
            setBusy(false);
        }
    }, [open, suggestedAuthoriser, quantityMax]);

    const valid = (kinds.length === 0 || kind !== "")
        && (reasonOptional || reason.trim() !== "")
        && (!needsAuthoriser || authorisedBy.trim() !== "");

    const submit = async (): Promise<void> => {
        if (!valid || busy) { return; }
        setBusy(true);
        setError(null);
        try {
            await onConfirm({ kind, reason: reason.trim(), authorisedBy: authorisedBy.trim(), quantity: qty });
            onOpenChange(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const shownHeadline = headlineFor ? headlineFor(qty) : headline;
    const hint = kinds.find((k) => k.value === kind)?.hint;

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); } }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[460px]">
                <DialogHeader>
                    <DialogTitle className="micro-label !text-[11px]">{title}</DialogTitle>
                    {shownHeadline ? (
                        <div className={cn("display-md tabular-nums", danger ? "text-destructive" : "text-accent-foreground")}>
                            {shownHeadline}
                        </div>
                    ) : null}
                    <DialogDescription>{subtitle}</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    {quantityMax !== undefined && quantityMax > 1 ? (
                        <div>
                            <div className="micro-label mb-1.5">How many of the {quantityMax}?</div>
                            <div className="flex items-center gap-3">
                                <Button variant="outline" size="icon" aria-label="One fewer" disabled={qty <= 1 || busy} onClick={() => { setQty((q) => Math.max(1, q - 1)); }}>
                                    <Minus />
                                </Button>
                                <span className="display-sm w-10 text-center tabular-nums">{qty}</span>
                                <Button variant="outline" size="icon" aria-label="One more" disabled={qty >= quantityMax || busy} onClick={() => { setQty((q) => Math.min(quantityMax, q + 1)); }}>
                                    <Plus />
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                    {qty >= quantityMax ? "The whole line" : `The other ${String(quantityMax - qty)} stay on the bill`}
                                </span>
                            </div>
                        </div>
                    ) : null}

                    {kinds.length > 0 ? (
                        <div>
                            <div className="micro-label mb-1.5">Why</div>
                            <div className="flex flex-wrap gap-2">
                                {kinds.map((k) => (
                                    <Pill key={k.value} selected={kind === k.value} disabled={busy} onClick={() => { setKind(k.value); }}>
                                        {k.label}
                                    </Pill>
                                ))}
                            </div>
                            {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
                        </div>
                    ) : null}

                    <div className="grid gap-1.5">
                        <Label htmlFor="capture-reason">{reasonOptional ? OPTIONAL_REASON_LABEL : "Reason"}</Label>
                        <Textarea
                            id="capture-reason"
                            maxLength={400}
                            rows={2}
                            value={reason}
                            disabled={busy}
                            onChange={(e) => { setReason(e.target.value); }}
                        />
                        <p className="text-xs text-muted-foreground">
                            {reasonOptional
                                ? "Optional. If you add one, it goes on the control report, verbatim."
                                : "In your own words. It goes on the control report, verbatim."}
                        </p>
                    </div>

                    {needsAuthoriser ? (
                        <div className="grid gap-1.5">
                            <Label htmlFor="capture-authoriser">Authorised by (username)</Label>
                            <Input
                                id="capture-authoriser"
                                value={authorisedBy}
                                disabled={busy}
                                autoComplete="off"
                                onChange={(e) => { setAuthorisedBy(e.target.value); }}
                            />
                            <p className="text-xs text-muted-foreground">
                                The staff member who approved it. Yours is filled in — change it if someone else said yes.
                            </p>
                            <p className="flex gap-1.5 text-[11px] text-tertiary">
                                <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                                The name is checked against your staff list and against this same permission. Who is acting is taken from your own sign-in and cannot be typed.
                            </p>
                        </div>
                    ) : null}

                    {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={busy} onClick={() => { onOpenChange(false); }}>Cancel</Button>
                    <Button
                        variant={danger ? "destructive" : "default"}
                        disabled={!valid || busy}
                        onClick={() => { void submit(); }}
                    >
                        {busy ? "Working…" : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
