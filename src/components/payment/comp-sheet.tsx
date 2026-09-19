"use client";

/**
 * "Comp a dish" — the web `_NonChargeableSheet` (screens/mis_capture.dart).
 *
 * Works off the table's LIVE ORDERS (or a given order-id set), grouped under
 * "Order · 7:42 PM" headers, with the running "given away" headline a manager
 * is accountable for. Each line comps through the shared styled capture dialog
 * (kind pills, reason, pre-filled authoriser, quantity stepper) and a comp is
 * put back through the same dialog — never window.prompt.
 */

import * as React from "react";
import { Gift, Lock, RefreshCw, Undo2, UtensilsCrossed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/lib/use-timezone";
import { formatTime } from "@/lib/tz";
import type { AuthUser } from "@/context/AuthContext";
import { can } from "@/lib/session-scope";
import { formatAmount, type NonChargeableRecord } from "@/lib/mis-capture";
import { fetchOrdersBundle, type Order, type OrderItem } from "@/lib/api/orders";
import {
    NC_KINDS,
    compItem,
    fetchOrderComps,
    noPermission,
    paymentErrorText,
    uncompItem,
    vocabLabel,
} from "@/lib/api/payment";
import { CaptureReasonDialog } from "./capture-reason-dialog";

export interface CompSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    restaurantId: string;
    user: AuthUser;
    /** The table whose live orders are shown… */
    tableName?: string;
    /** …or exactly these orders (the order card's entry). */
    orderIds?: string[];
    onChanged: () => void;
}

const compable = (o: Order): boolean => {
    const st = (o.status as string).toLowerCase();
    return st !== "cancelled" && st !== "paid" && st !== "closed";
};

/** Struck through when comped. */
const cn2 = (struck: boolean, base: string): string =>
    struck ? `${base} line-through text-muted-foreground` : `${base} text-foreground`;

type Target =
    | { kind: "comp"; order: Order; item: OrderItem }
    | { kind: "reverse"; comp: NonChargeableRecord }
    | null;

export function CompSheet({
    open, onOpenChange, restaurantId, user, tableName = "", orderIds, onChanged,
}: CompSheetProps): React.JSX.Element {
    const { toast } = useToast();
    const { currencySymbol } = useCurrency();
    const { timezone } = useTimezone();
    const money = (v: number): string => formatAmount(v, currencySymbol);
    const may = can(user, "comp_item");

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [orders, setOrders] = React.useState<Order[]>([]);
    const [comps, setComps] = React.useState<NonChargeableRecord[]>([]);
    const [target, setTarget] = React.useState<Target>(null);
    const idsKey = (orderIds ?? []).join(",");

    const load = React.useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const wanted = new Set(idsKey === "" ? [] : idsKey.split(","));
            const bundle = await fetchOrdersBundle(restaurantId);
            const mine = bundle.orders.filter((o) => compable(o) && (wanted.size > 0
                ? wanted.has(o.id)
                : o.table.trim().toLowerCase() === tableName.trim().toLowerCase()));
            mine.sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
            const lists = await Promise.all(mine.map(async (o) => {
                try { return await fetchOrderComps(restaurantId, o.id); } catch { return []; }
            }));
            setOrders(mine);
            setComps(lists.flat());
        } catch (e: unknown) {
            setError(paymentErrorText(e));
        } finally {
            setLoading(false);
        }
    }, [restaurantId, tableName, idsKey]);

    React.useEffect(() => { if (open) { void load(); } }, [open, load]);

    const liveComps = comps.filter((c) => !c.reversed_at);
    const givenAway = liveComps.reduce((sum, c) => sum + (c.value || 0), 0);
    const where = tableName === "" ? "this order" : `Table ${tableName}`;
    const liveFor = (orderId: string, itemId: string): NonChargeableRecord | undefined =>
        liveComps.find((c) => c.order_id === orderId && c.item_id === itemId);

    const compTarget = target?.kind === "comp" ? target : null;
    const compQty = compTarget ? Math.max(1, compTarget.item.quantity || 1) : 1;
    const compPrice = compTarget ? compTarget.item.price || 0 : 0;

    return (
        <>
            <DrillSheet
                open={open}
                onOpenChange={onOpenChange}
                eyebrow="Non-chargeable"
                title={where}
                action={<Button variant="outline" onClick={() => { onOpenChange(false); }}>Done</Button>}
            >
                <div className="grid gap-4">
                    <div>
                        <div className="display-md tabular-nums text-destructive">{money(givenAway)}</div>
                        <div className="text-xs text-muted-foreground">
                            given away · {liveComps.length} line{liveComps.length === 1 ? "" : "s"}
                        </div>
                    </div>
                    {!may ? (
                        <ForkCard inset className="flex items-start gap-2 !p-3 text-sm text-muted-foreground">
                            <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                            {noPermission("comp a dish")}
                        </ForkCard>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                        Comping takes the line off what the guest pays. It is still counted as revenue given away, with your name, the reason and the authoriser against it.
                    </p>

                    {loading ? <SkeletonRows rows={4} /> : null}
                    {!loading && error !== null ? (
                        <EmptyState
                            icon={<UtensilsCrossed />}
                            title="Could not load the lines"
                            caption={error}
                            action={<Button size="sm" variant="outline" onClick={() => { void load(); }}><RefreshCw /> Retry</Button>}
                        />
                    ) : null}
                    {!loading && error === null && orders.length === 0 ? (
                        <EmptyState
                            icon={<Gift />}
                            title="Nothing to comp"
                            caption={`${where} has no open order lines. A settled or cancelled order cannot be comped — that is a refund, which has its own path.`}
                        />
                    ) : null}

                    {!loading && error === null ? orders.map((order) => (
                        <div key={order.id}>
                            <div className="micro-label mb-1.5">
                                Order · {formatTime(order.created_at ?? "", timezone)} · {order.items.length}
                            </div>
                            {order.items.length === 0 ? <p className="text-xs text-muted-foreground">This ticket carries no lines.</p> : null}
                            <div className="grid gap-1.5">
                                {order.items.map((item) => {
                                    const qty = Math.max(1, item.quantity || 1);
                                    const live = liveFor(order.id, item.id);
                                    const comped = live !== undefined || item.nc === true;
                                    return (
                                        <ForkCard key={item.id} inset className="!px-3 !py-2.5">
                                            <div className="flex items-start gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className={cn2(comped, "text-[13px] font-semibold")}>{qty} × {item.name}</div>
                                                    {item.variation_name ? <div className="text-xs text-muted-foreground">{item.variation_name}</div> : null}
                                                </div>
                                                <span className={cn2(comped, "text-[13px] font-semibold tabular-nums")}>{money((item.price || 0) * qty)}</span>
                                            </div>
                                            {live ? (
                                                <>
                                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                        <StatusChip status="danger" dense label={`NC · ${vocabLabel(NC_KINDS, live.nc_kind)}`} />
                                                        <InfoChip label={`${money(live.value)} given away`} />
                                                        <InfoChip label={`By ${live.authorised_by_username}`} />
                                                    </div>
                                                    <div className="mt-1 text-xs italic text-muted-foreground">
                                                        “{live.reason}” — marked by {live.marked_by_username}
                                                    </div>
                                                </>
                                            ) : null}
                                            {may ? (
                                                <div className="mt-2 flex justify-end">
                                                    {live ? (
                                                        <Button variant="ghost" size="sm" onClick={() => { setTarget({ kind: "reverse", comp: live }); }}>
                                                            <Undo2 /> Put it back on the bill
                                                        </Button>
                                                    ) : !comped ? (
                                                        <Button variant="outline" size="sm" onClick={() => { setTarget({ kind: "comp", order, item }); }}>
                                                            <Gift /> Make non-chargeable
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </ForkCard>
                                    );
                                })}
                            </div>
                        </div>
                    )) : null}
                </div>
            </DrillSheet>

            <CaptureReasonDialog
                open={compTarget !== null}
                onOpenChange={(o) => { if (!o) { setTarget(null); } }}
                title="Non-chargeable"
                headlineFor={(q) => money(compPrice * q)}
                danger
                subtitle={compTarget ? `${compTarget.item.name} · ${money(compPrice)} each. This comes OFF what the guest pays and stays ON the books as revenue given away — the NC Summary shows both.` : ""}
                confirmLabel="Comp it"
                kinds={NC_KINDS}
                needsAuthoriser
                suggestedAuthoriser={user.employeeUsername ?? ""}
                quantityMax={compQty}
                onConfirm={async ({ kind, reason, authorisedBy, quantity }) => {
                    if (!compTarget) { return; }
                    await compItem(restaurantId, compTarget.order.id, compTarget.item.id, {
                        nc_kind: kind, reason, authorised_by: authorisedBy,
                        ...(quantity < compQty ? { quantity } : {}),
                    });
                    toast({ title: `${String(quantity)} × ${compTarget.item.name} is non-chargeable — ${money(compPrice * quantity)} given away.` });
                    onChanged();
                    await load();
                }}
            />

            <CaptureReasonDialog
                open={target?.kind === "reverse"}
                onOpenChange={(o) => { if (!o) { setTarget(null); } }}
                title="Put it back on the bill"
                headline={target?.kind === "reverse" ? money(target.comp.value) : null}
                subtitle={target?.kind === "reverse" ? `${target.comp.item_name} becomes chargeable again. The original comp stays on the report, marked reversed — it is never deleted.` : ""}
                confirmLabel="Charge it again"
                onConfirm={async ({ reason }) => {
                    if (target?.kind !== "reverse") { return; }
                    await uncompItem(restaurantId, target.comp.id, reason);
                    toast({ title: `${target.comp.item_name} is chargeable again.` });
                    onChanged();
                    await load();
                }}
            />
        </>
    );
}
