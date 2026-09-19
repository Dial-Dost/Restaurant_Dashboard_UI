"use client";

/**
 * The service-charge block on the table sheet — the web `misServiceChargeBlock`
 * (screens/mis_capture.dart). Either the ONE control that takes the charge off
 * and prints ("Remove service charge & print", client item 6), disabled with
 * the reason for a non-holder, or the waived card: kind, both figures, the
 * attribution, "Reprint / Print without the charge" and "Put the charge back".
 * Nothing at all when the bill carries no service charge in either tax shape.
 */

import * as React from "react";
import { BadgeIndianRupee, Printer, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { ForkCard } from "@/components/ui/fork-card";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import type { AuthUser } from "@/context/AuthContext";
import { can } from "@/lib/session-scope";
import { SERVICE_CHARGE_WAIVER_KINDS, formatAmount } from "@/lib/mis-capture";
import {
    billHasServiceCharge,
    liveWaiverOf,
    noPermission,
    paymentErrorText,
    putServiceChargeBack,
    removeServiceChargeAndPrint,
    serviceChargeOnBill,
    serviceChargeRemovalBody,
    serviceChargeRemovalOutcome,
    serviceChargeWaivedPrintCopy,
    serviceChargeWaiverAttribution,
    vocabLabel,
} from "@/lib/api/payment";
import { CaptureReasonDialog } from "./capture-reason-dialog";

export interface ServiceChargeBlockProps {
    restaurantId: string;
    user: AuthUser;
    bill: Record<string, unknown>;
    tableName: string;
    /** False for a scoped waiter: the figures go, the controls stay (item 19). */
    showsMoney: boolean;
    onChanged: () => void;
}

export function ServiceChargeBlock({
    restaurantId, user, bill, tableName, showsMoney, onChanged,
}: ServiceChargeBlockProps): React.JSX.Element | null {
    const { toast } = useToast();
    const { currencySymbol } = useCurrency();
    const money = (v: number): string => formatAmount(v, currencySymbol);
    const may = can(user, "waive_service_charge");
    const [dialog, setDialog] = React.useState<"remove" | "reprint" | "putBack" | null>(null);
    const [busy, setBusy] = React.useState(false);

    const waiver = liveWaiverOf(bill);
    if (waiver === null && !billHasServiceCharge(bill)) { return null; }

    const announce = (res: unknown): void => {
        const outcome = serviceChargeRemovalOutcome(res, money);
        toast({ title: outcome.message, duration: outcome.durationMs });
    };

    const reprint = async (): Promise<void> => {
        if (busy) { return; }
        setBusy(true);
        try {
            announce(await removeServiceChargeAndPrint(restaurantId, { table_name: tableName }));
        } catch (e: unknown) {
            toast({ title: paymentErrorText(e), variant: "destructive" });
        } finally {
            setBusy(false);
            onChanged();
        }
    };

    if (waiver !== null) {
        const copy = serviceChargeWaivedPrintCopy(bill);
        return (
            <>
                <ForkCard inset className="!px-3.5 !py-3">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-warning">
                        <BadgeIndianRupee aria-hidden className="h-4 w-4 shrink-0" />
                        Service charge waived — {vocabLabel(SERVICE_CHARGE_WAIVER_KINDS, waiver.waiver_kind)}
                    </div>
                    {showsMoney ? (
                        <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                            {money(waiver.amount_waived)} charge off · {money(waiver.grand_total_reduction)} with its tax, before round-off
                        </div>
                    ) : null}
                    <div className="mt-1 text-xs italic text-muted-foreground">{serviceChargeWaiverAttribution(waiver)}</div>
                    <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setDialog("reprint"); }}>
                            <Printer /> {copy.label}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy || !may} onClick={() => { setDialog("putBack"); }}>
                            <Undo2 /> Put the charge back
                        </Button>
                    </div>
                    {!may ? <p className="mt-1.5 text-xs text-muted-foreground">{noPermission("put a waived service charge back")}</p> : null}
                </ForkCard>

                <AlertDialog open={dialog === "reprint"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
                            <AlertDialogDescription>{copy.body}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => { setDialog(null); void reprint(); }}>{copy.confirm}</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <CaptureReasonDialog
                    open={dialog === "putBack"}
                    onOpenChange={(o) => { if (!o) { setDialog(null); } }}
                    title="Put the service charge back"
                    subtitle="The charge goes back on this bill. The original waiver stays on the report, marked reversed — it is never deleted."
                    confirmLabel="Charge it again"
                    onConfirm={async ({ reason }) => {
                        await putServiceChargeBack(restaurantId, waiver.id, reason);
                        toast({ title: "The service charge is back on the bill." });
                        onChanged();
                    }}
                />
            </>
        );
    }

    const charge = serviceChargeOnBill(bill);
    return (
        <>
            <div>
                <Button variant="outline" className="w-full" disabled={busy || !may} onClick={() => { setDialog("remove"); }}>
                    <BadgeIndianRupee /> {busy ? "Working…" : "Remove service charge & print"}
                </Button>
                {!may ? <p className="mt-1.5 text-xs text-muted-foreground">{noPermission("remove a service charge")}</p> : null}
            </div>
            <CaptureReasonDialog
                open={dialog === "remove"}
                onOpenChange={(o) => { if (!o) { setDialog(null); } }}
                title="Remove service charge & print"
                headline={charge > 0 && showsMoney ? money(charge) : null}
                subtitle="The charge comes off this OPEN bill and the bill prints straight away without it. Where tax rides on the charge the total falls by more than the charge itself, and you are told both totals. A settled bill cannot be changed — that is a refund."
                confirmLabel="Remove & print"
                kinds={SERVICE_CHARGE_WAIVER_KINDS}
                needsAuthoriser
                suggestedAuthoriser={user.employeeUsername ?? ""}
                reasonOptional
                onConfirm={async ({ kind, reason, authorisedBy }) => {
                    setBusy(true);
                    try {
                        announce(await removeServiceChargeAndPrint(
                            restaurantId,
                            serviceChargeRemovalBody({ tableName, kind, reason, authorisedBy }),
                        ));
                    } finally {
                        setBusy(false);
                        onChanged();
                    }
                }}
            />
        </>
    );
}
