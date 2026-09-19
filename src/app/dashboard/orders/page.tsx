"use client";

/*
  ORDERS — rebuilt to the Flutter owner app's Orders module (the source of
  truth: restaurant_owner_app/lib/screens/modules.dart `ordersModule`, audited
  in docs/parity/orders.md).

  WHAT THIS PAGE IS NOW. Three titled sections — Upcoming (Pending guest-QR /
  queue tickets awaiting approval), Current (everything mid-flight) and Paid
  (settled, closed and cancelled) — of clickable ForkCard tiles in a 4/3/2/1
  column grid, sorted focused → pending → newest. The whole tile opens the
  detail sheet (the ONLY place the stage is advanced — mis-tap safety); the
  time-critical acts stay ON the tile: Bark → kitchen for an unbarked ticket,
  Approve / Decline for a Pending one. Settled tickets older than 24h leave the
  page (hidden, not deleted — the note under the grid counts them and History
  keeps them); an unpaid ticket never ages out and wears "Over 24h · unsettled"
  instead. A floating "Takeaway / Delivery" action starts a no-table order.

  WHAT LEFT. The embedded kitchen display moved to the Kitchen module
  (/dashboard/kitchen owns that surface; the old kiosk URL redirects there).
  The reason-less hard Delete is gone — every cancel routes through the
  reasoned void/cancel dialogs (parity finding 17). The row table, the
  row-click split-editor dialog and the analytics cards are superseded by the
  card grid, the Flutter detail sheet and the per-order APC row in it.

  WHAT STAYED (web-extras the audit says to keep, re-homed to the sheet): the
  C3 print-claim flow, the 6.5 Bill menu, the Update Order / Edit Bill
  editors, waiter payment confirmation + split tender, approve/close/re-open,
  the CFD launcher, the discount-approvals queue and the Add Order form the
  Tables page deep-links into.
*/

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  CalendarDays,
  History,
  Layers,
  Loader2,
  MonitorSmartphone,
  MoreHorizontal,
  Printer,
  ShoppingBag,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { CacheStalePill } from "@/components/ui/stale-pill";

import {
  addOrder,
  approveBillPaymentByAdmin,
  closeBillByOrder,
  createBill,
  decideDiscountRequest,
  getBillForTable,
  getDiscountRequests,
  getMenuItems,
  getMenuVariations,
  getMonthlyApcInsight,
  getOutletDefaultTax,
  getTables,
  reopenBill,
  replaceBill,
  requestBackend,
  setOutletDefaultTax,
  type DiscountRequest,
  type MonthlyApcInsight,
} from "@/lib/db";
import type { Table as FloorTable } from "@/app/dashboard/tables/data";
import {
  advanceOrderStatus,
  barkOrderDetailed,
  barkOutcomeMessage,
  cancelNeedsSeniorSentence,
  fetchOrdersBundle,
  isCancelledStatus,
  isOrderBarked,
  isOrderCancelled,
  orderAgedOut,
  orderIsPending,
  orderSection,
  ORDER_PAID_CAPTION,
  ORDER_SECTION_TITLES,
  ORDERS_LIVE_WINDOW_HOURS,
  SETTLED_LOCKED_NOTE,
  sortLiveOrders,
  type Order,
  type OrderItem,
  type OrdersBundle,
  type OrderTax as Tax,
} from "@/lib/api/orders";
import { OrderCard } from "@/components/orders/order-card";
import { OrderDetailSheet } from "@/components/orders/order-detail-sheet";
import { PaymentSheet } from "@/components/payment/payment-sheet";
import { CompSheet } from "@/components/payment/comp-sheet";
import { ChangeStageDialog } from "@/components/orders/change-stage-dialog";
import { CancelOrderDialog, type CancelRoute } from "@/components/orders/cancel-order-dialog";
import { ChannelSheet } from "@/components/orders/channel-sheet";
import { OrderPad, type OrderPadRequest } from "@/components/order-pad/order-pad";
import { DiscountApprovals } from "@/components/orders/discount-approvals";
import { OrdersEmptyState, OutletScopeBar } from "@/components/orders/outlet-scope";
import { FocusBanner, useFocusRequest } from "@/components/focus-banner";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { useVisibleNav } from "@/hooks/use-nav";
import { useTimezone } from "@/lib/use-timezone";
import { formatDateTime } from "@/lib/tz";
import {
  methodNeedsScreenshot,
} from "@/lib/payment-methods";
import {
  can,
  hasPermission,
  isWaiterOnly as sessionIsWaiterOnly,
  PERM_ORDER_ADD,
  showsMoney,
} from "@/lib/session-scope";
import {
  billPrintScope,
  serverSaysBillPrinted,
  type BillPrintState,
} from "@/lib/bill-print-state";
import { visibleAmount, visibleMoneyText } from "@/lib/order-prices";
import { printTableBill } from "@/lib/api/tables-floor";
import { BillPreviewDialog } from "@/components/bill-print/bill-preview-dialog";
import { canBarkFromBoard, cancelKotRoute } from "@/lib/orders-grid";
import { ALL_OUTLETS, applySelectedOutlet } from "@/lib/outlet";
import type { MenuItem } from "../menu/data";
import { type MenuVariationRecord } from "@/lib/mis-capture";
import { BillActions } from "./bill-actions";
import { TableKotPreview } from "./table-kot-preview";

/*
  THE ORDER SHAPE LIVES IN THE MODULE'S OWN DATA LAYER NOW
  (src/lib/api/orders.ts — a full `mapOrder` equivalent that also lifts the
  four fields db.ts drops: moved_from, moved_items, note and the
  takeaway/delivery contact pair, and admits the "Pending" stage). Re-exported
  from here because db.ts's own mapper types itself against this page's Order.
*/
export type { Order, OrderItem, OrderStatus } from "@/lib/api/orders";

const CANCELLED_LOCK_REASON = "Cancelled orders are final — reverse from the Audit Log";

// The payment modes offered here — and which of them need a screenshot — are
// the restaurant's own (usePaymentMethods, src/lib/payment-methods.ts). The
// settle itself (tenders, tips, proof, till, NC) is the payment sheet's
// (src/components/payment/payment-sheet.tsx).

const normalizeProofPreviewUrl = (value?: string | null): string | null => {
  const raw = (value ?? "").trim();
  if (!raw) { return null; }
  if (/^https?:\/\//i.test(raw)) { return raw; }
  if (/^data:image\//i.test(raw)) { return raw; }
  return null;
};

const calculateServiceCharge = (subtotal: number, percentage?: number, apply?: boolean): number => {
  if (!apply || !percentage) { return 0; }
  return subtotal * (percentage / 100);
};

const calculateTaxes = (subtotal: number, taxes?: Tax[]): (Tax & { amount: number })[] => {
  if (!taxes) { return []; }
  return taxes.map((tax) => ({
    ...tax,
    amount: subtotal * (tax.percentage / 100),
  }));
};

// Same `dd/mm/yy hh:mm` shape as before, rendered in the RESTAURANT's zone.
const formatOrderedAt = (isoOrString: string | null | undefined, timeZone: string): string => {
  if (!isoOrString) { return ""; }
  return formatDateTime(isoOrString, timeZone, isoOrString);
};

const dedupeOrdersById = (items: Order[]): Order[] => {
  const seen = new Map<string, Order>();
  for (const item of items) {
    seen.set(item.id, item);
  }
  return Array.from(seen.values());
};

const PRINT_BILL_STORAGE_PREFIX = "restaurant-dashboard:print-order:";

const createPrintBillStorageKey = (): string => `${PRINT_BILL_STORAGE_PREFIX}${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

const storePrintBillPayload = (order: Record<string, unknown>): string => {
  const storageKey = createPrintBillStorageKey();
  localStorage.setItem(storageKey, JSON.stringify(order));
  return storageKey;
};

/** A held course waiting to be fired (shared with the Update Order editor). */
const isItemHeld = (item: OrderItem): boolean => item.course_hold === true && !item.fired_at;

const StationBadge = ({ station }: { station?: string | null }): React.JSX.Element | null =>
  station ? (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
      {station}
    </Badge>
  ) : null;

/** Everything the support fetch decorates the page with; each part degrades alone. */
interface OrdersSupportData {
  menuItems: MenuItem[];
  variations: MenuVariationRecord[];
  tables: FloorTable[];
  defaultTax: Record<string, number> | null;
  apc: MonthlyApcInsight | null;
}

/** A styled confirmation — the app's dialog pattern where window.confirm() sat. */
interface ConfirmActionRequest {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Runs on confirm. It must catch its own errors (each handler toasts). */
  run: () => Promise<void>;
}

// Entry point. The old kiosk URL (?station=X&kiosk=1) belongs to the Kitchen
// module now — a wall screen bookmarked on this page is sent there rather than
// broken.
export default function OrdersPage(): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const station = searchParams.get("station")?.trim() ?? "";
  const kiosk = (searchParams.get("kiosk")?.trim() ?? "").toLowerCase();
  const kioskMode = station.length > 0 && (kiosk === "1" || kiosk === "true" || kiosk === "yes");
  useEffect(() => {
    if (kioskMode) {
      router.replace(`/dashboard/kitchen?station=${encodeURIComponent(station)}`);
    }
  }, [kioskMode, station, router]);
  if (kioskMode) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        The kitchen board lives in the Kitchen module now — taking you there…
      </div>
    );
  }
  return <OrdersDashboard />;
}

function OrdersDashboard(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currencySymbol } = useCurrency();
  const { user } = useAuth();
  const rid = user?.restaurantUsername ?? "";
  // The modes a bill may be settled with at this till: the owner's config.
  const { methods: paymentMethods } = usePaymentMethods(user?.restaurantUsername);
  const { toast } = useToast();
  // Every instant on this screen renders in the restaurant's zone.
  const { timezone } = useTimezone();
  const nav = useVisibleNav();

  const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager"): boolean => {
    if (!user) { return false; }
    if (user.role === role) { return true; }
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false;
  };
  const isAdmin = hasRole("admin");
  // THE SERVER DECIDES WHO IS A SCOPED WAITER (src/lib/session-scope.ts).
  const isWaiterOnly = sessionIsWaiterOnly(user);
  // C2 — settling a bill is a PERMISSION, not the word "admin".
  const canSettleBill = can(user, "settle_bill");
  const canVoidOrder = can(user, "void_order");
  // May this session perform ANY of the three recorded control acts?
  const canAnyControlAct = canVoidOrder || can(user, "comp_item") || can(user, "waive_service_charge");
  // Same gate as the header's OutletSwitcher.
  const canSwitchOutlet = isAdmin || hasRole("manager");
  // "Add Orders" — the permission the everyday order writes ride on. It gates
  // the Update Order editor and the takeaway pad the way Flutter's server does,
  // instead of the old hard `isAdmin` test (parity finding 16).
  const mayAddOrder = hasPermission(user?.actions_set, PERM_ORDER_ADD);
  const canBark = canBarkFromBoard(user);
  const moneyShows = showsMoney(user);

  // "₹840.00" for sessions that see money, "" for a scoped waiter (C4: the
  // figure is GONE, not blanked).
  const money = useCallback(
    (v: unknown): string => visibleMoneyText(currencySymbol, visibleAmount(user, v)) ?? "",
    [currencySymbol, user],
  );

  // "Jun 26, 14:05" in the restaurant's zone — Flutter's RestaurantTime.short.
  const placedShort = useCallback((iso: string | null | undefined): string => {
    const raw = (iso ?? "").trim();
    if (!raw) { return ""; }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) { return ""; }
    try {
      const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(d);
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      return `${day}, ${clock}`;
    } catch {
      return "";
    }
  }, [timezone]);

  const actorName =
    user?.employeeUsername
    || `${user?.emp_Fname ?? ""} ${user?.emp_Lname ?? ""}`.trim()
    || user?.employeeId
    || "";

  const showRoleRequiredToast = (requiredRole: string): void => {
    toast({
      title: "Access denied",
      description: `You do not have the required role for this action. Required role: ${requiredRole}.`,
      variant: "destructive",
    });
  };

  // The refusal an owner can ACT on: name the permission, not a role.
  const showPermissionRequiredToast = (permissionName: string): void => {
    toast({
      title: "Access denied",
      description: `This action needs the “${permissionName}” permission. An admin can grant it from Role Access Control.`,
      variant: "destructive",
    });
  };

  /* ── Data: the grid (orders + scope) rides useCachedFetch ─────────────── */

  const bundle = useCachedFetch<OrdersBundle>(
    `orders:${rid}`,
    () => fetchOrdersBundle(rid),
    { pollMs: 30_000, enabled: rid !== "" },
  );
  const refreshOrders = bundle.refresh;

  // Decoration for a working grid: the menu (order forms), sizes, tables (the
  // selector, CFD tokens and the C3 print ledger), default tax and the APC
  // insight. Each part degrades alone; none may fail the page.
  const fetchSupport = useCallback(async (): Promise<OrdersSupportData> => {
    const [menuR, varR, tableR, taxR, apcR] = await Promise.allSettled([
      getMenuItems(rid),
      getMenuVariations(rid),
      getTables(rid),
      getOutletDefaultTax(rid),
      getMonthlyApcInsight(rid),
    ]);
    return {
      menuItems: menuR.status === "fulfilled" && Array.isArray(menuR.value) ? menuR.value : [],
      variations: varR.status === "fulfilled" ? varR.value : [],
      tables: tableR.status === "fulfilled" && Array.isArray(tableR.value) ? tableR.value : [],
      defaultTax: taxR.status === "fulfilled" ? taxR.value : null,
      apc: apcR.status === "fulfilled" ? apcR.value : null,
    };
  }, [rid]);
  const support = useCachedFetch<OrdersSupportData>(`orders-support:${rid}`, fetchSupport, { enabled: rid !== "" });
  const refreshSupport = support.refresh;

  // Pending staff discounts (admin approval queue) — kept per finding 35.
  const discounts = useCachedFetch<DiscountRequest[]>(
    `orders-discounts:${rid}`,
    () => getDiscountRequests(rid),
    { pollMs: 60_000, enabled: rid !== "" && isAdmin },
  );
  const refreshDiscounts = discounts.refresh;

  const menuItems = useMemo(() => support.data?.menuItems ?? [], [support.data]);
  const tables = useMemo(() => support.data?.tables ?? [], [support.data]);
  const monthlyApcInsight = support.data?.apc ?? null;
  const ordersScope = bundle.data?.scope ?? null;

  // The owner can retune the default tax without waiting for a refetch.
  const [defaultTaxOverride, setDefaultTaxOverride] = useState<Record<string, number> | null | undefined>(undefined);
  const defaultTax = defaultTaxOverride === undefined ? (support.data?.defaultTax ?? null) : defaultTaxOverride;

  /* ── Realtime: the socket nudges the same silent refresh the poll uses ── */

  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ event?: string } | undefined>).detail;
      const name = detail?.event ?? "";
      if (name === "order:updated" || name === "bill:updated") {
        refreshOrders();
        if (isAdmin) { refreshDiscounts(); }
      }
      if (name === "table:added" || name === "table:deleted" || name === "table:updated") {
        refreshSupport();
      }
    };
    window.addEventListener("realtime:event", handler);
    return () => { window.removeEventListener("realtime:event", handler); };
  }, [refreshOrders, refreshSupport, refreshDiscounts, isAdmin]);

  /* ── Deep-link focus (the notification banner, findings 25 & 10) ──────── */

  const focus = useFocusRequest();
  // The legacy ?highlightOrder= param is still appended by older links; it is
  // folded into the same banner mechanism rather than kept as a fading ring.
  const legacyHighlightId = searchParams.get("highlightOrder")?.trim() ?? "";
  const focusId = focus?.idOf(["order_id"]) ?? (legacyHighlightId === "" ? null : legacyHighlightId);
  const focusTable = focus?.tableName ?? null;
  const focusRequested = focusId !== null || focusTable !== null;

  // The param arriving is the refetch signal — the record may just have landed.
  const focusSerial = focus?.serial ?? legacyHighlightId;
  useEffect(() => {
    if (focusSerial !== "") { refreshOrders(); }
  }, [focusSerial, refreshOrders]);

  const isFocused = useCallback((o: Order): boolean => {
    if (focusId !== null) { return o.id === focusId; }
    if (focusTable !== null) { return o.table === focusTable; }
    return false;
  }, [focusId, focusTable]);

  const dismissFocus = useCallback((): void => {
    if (focus) { focus.dismiss(); return; }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("highlightOrder");
    const qs = next.toString();
    router.replace(qs ? `/dashboard/orders?${qs}` : "/dashboard/orders", { scroll: false });
  }, [focus, searchParams, router]);

  /* ── The list the grid draws ──────────────────────────────────────────── */

  const rawOrders = useMemo(() => dedupeOrdersById(bundle.data?.orders ?? []), [bundle.data]);

  // C3 — the server's print ledger, keyed the way every table is looked up.
  const billPrintByTable = useMemo(() => {
    const map = new Map<string, BillPrintState | null>();
    for (const table of tables) {
      map.set((table.name || "").toLowerCase(), table.bill_print ?? null);
    }
    return map;
  }, [tables]);

  // What this session may do about one table's bill (print / reprint / retire).
  const printScopeForTable = useCallback(
    (tableName: string) =>
      billPrintScope(user, serverSaysBillPrinted(billPrintByTable.get((tableName || "").toLowerCase()) ?? null)),
    [user, billPrintByTable],
  );

  // C3's second half — a printed table clears from a WAITER's list (their job
  // there is done; a manager settles it). Nothing is written; managers keep it.
  const sessionOrders = useMemo(
    () => rawOrders.filter((order) => !printScopeForTable(order.table).retiresTable),
    [rawOrders, printScopeForTable],
  );

  // The 24h live window: settled tickets age off (hidden, never deleted — the
  // note below the grid counts them); unpaid and focused tickets never do.
  const liveOrders = useMemo(
    () => sessionOrders.filter((o) => !orderAgedOut(o, isFocused(o))),
    [sessionOrders, isFocused],
  );
  const hiddenCount = sessionOrders.length - liveOrders.length;

  // Focused first, then Pending (awaiting approval), then strictly newest.
  const sorted = useMemo(() => sortLiveOrders(liveOrders, isFocused), [liveOrders, isFocused]);

  // Grouped in the order the owner works them; an empty section collapses away.
  const grouped = useMemo(() => {
    const g: [Order[], Order[], Order[]] = [[], [], []];
    for (const o of sorted) { g[orderSection(o.status)].push(o); }
    return g;
  }, [sorted]);

  const focusFound = focusRequested && sessionOrders.some(isFocused);
  const focusedOrder = focusFound ? sorted.find(isFocused) ?? null : null;
  const focusedTableName = focusedOrder?.table ?? "";
  const canOpenTables = nav.labels.includes("Tables");
  const historyModule = nav.modules.find((m) => m.label === "History") ?? null;
  const canOpenHistory = historyModule !== null;
  const openHistory = useCallback((): void => {
    if (historyModule) { router.push(historyModule.href); }
  }, [historyModule, router]);

  // Land the eye on the focused card once it is on screen.
  useEffect(() => {
    if (!focusFound || focusId === null) { return; }
    const el = document.getElementById(`order-card-${focusId}`);
    if (el) {
      try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* ignore */ }
    }
  }, [focusFound, focusId]);

  // A discount-approval notification lands here too (entity `discount_request`).
  const requestHighlight = useHighlightRow("highlightRequest", discounts.data?.length ?? 0);

  const orderApcByOrderId = useMemo(() => {
    const map = new Map<string, MonthlyApcInsight["orders"][number]>();
    for (const item of monthlyApcInsight?.orders ?? []) {
      map.set(item.order_id, item);
    }
    return map;
  }, [monthlyApcInsight]);

  /* ── Sheet / dialog state ─────────────────────────────────────────────── */

  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  // Read fresh off the refreshed list so the open sheet tracks every write.
  const openOrder = useMemo(
    () => (openOrderId === null ? null : sessionOrders.find((o) => o.id === openOrderId) ?? null),
    [openOrderId, sessionOrders],
  );
  const [stageOrderId, setStageOrderId] = useState<string | null>(null);
  const stageOrder = useMemo(
    () => (stageOrderId === null ? null : sessionOrders.find((o) => o.id === stageOrderId) ?? null),
    [stageOrderId, sessionOrders],
  );
  const [cancelReq, setCancelReq] = useState<{ orderId: string; pending: boolean; route: CancelRoute } | null>(null);
  const cancelOrderRow = useMemo(
    () => (cancelReq === null ? null : sessionOrders.find((o) => o.id === cancelReq.orderId) ?? null),
    [cancelReq, sessionOrders],
  );
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [padRequest, setPadRequest] = useState<OrderPadRequest | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionRequest | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [updateOrderTarget, setUpdateOrderTarget] = useState<Order | null>(null);
  const [editBillTarget, setEditBillTarget] = useState<Order | null>(null);
  const [isDefaultTaxDialogOpen, setIsDefaultTaxDialogOpen] = useState(false);
  // The payment sheet (settle) and the comp sheet, per order.
  const [settleTarget, setSettleTarget] = useState<Order | null>(null);
  const [compTarget, setCompTarget] = useState<Order | null>(null);

  const selectedTableName = searchParams.get("table")?.trim() ?? "";
  const selectedTable = useMemo(() => {
    if (!selectedTableName) { return null; }
    return tables.find((table) => table.name.toLowerCase() === selectedTableName.toLowerCase()) ?? null;
  }, [selectedTableName, tables]);

  // The ?table= deep link opens the order pad for that table — never when the
  // Tables page opened it to PREVIEW (`preview=1`) or a focus/highlight rides.
  // `addToPrinted=1` is the table sheet's confirmed "Add to printed bill"; a
  // table that is not occupied yet is seated BY the send (covers asked then).
  const deepLinkPad = useMemo<OrderPadRequest | null>(() => {
    const highlightParam = searchParams.get("highlightOrder")?.trim() ?? "";
    const focusParam = searchParams.get("focus")?.trim() ?? "";
    const previewParam = searchParams.get("preview")?.trim() ?? "";
    if (!selectedTableName || highlightParam || focusParam || previewParam) { return null; }
    return {
      kind: "dine",
      table: selectedTable?.name ?? selectedTableName,
      occupyOnSend: selectedTable !== null && selectedTable.status !== "Occupied",
      addToPrintedBill: searchParams.get("addToPrinted") === "1",
    };
  }, [selectedTableName, selectedTable, searchParams]);
  const deepLinkKey = deepLinkPad === null ? "" : `${deepLinkPad.kind}:${searchParams.toString()}`;
  const [dismissedDeepLink, setDismissedDeepLink] = useState("");
  const supportReady = support.data !== null;
  useEffect(() => {
    if (deepLinkPad !== null && deepLinkKey !== dismissedDeepLink && supportReady) {
      setPadRequest(deepLinkPad);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per deep link, after tables load
  }, [deepLinkKey, supportReady]);
  const closePad = (): void => {
    setPadRequest(null);
    if (deepLinkKey !== "") {
      setDismissedDeepLink(deepLinkKey);
      router.replace("/dashboard/orders");
    }
  };

  /* ── Write handlers ───────────────────────────────────────────────────── */

  const serverWords = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  // Bark: the toast reads the SERVER's own KOT print report (finding 28) — a
  // dead printer is said out loud, never a silent tick.
  const handleBark = async (order: Order): Promise<void> => {
    if (rid === "") { return; }
    setBusyOrderId(order.id);
    try {
      const resp = await barkOrderDetailed(rid, order.id);
      toast({ title: barkOutcomeMessage(resp) ?? "Sent to the kitchen." });
      refreshOrders();
    } catch (err) {
      toast({ title: "Unable to bark order", description: serverWords(err), variant: "destructive" });
    } finally {
      setBusyOrderId(null);
    }
  };

  // Approve a Pending (guest QR / queue) ticket: PATCH → Preparing.
  const handleApprovePending = async (order: Order): Promise<void> => {
    if (rid === "") { return; }
    setBusyOrderId(order.id);
    try {
      await advanceOrderStatus(rid, order.id, "Preparing");
      refreshOrders();
    } catch (err) {
      toast({ title: "Unable to approve order", description: serverWords(err), variant: "destructive" });
    } finally {
      setBusyOrderId(null);
    }
  };

  // Every cancel is prompted for a reason; the ROUTE depends on what this
  // session holds (`cancelKotRoute` — Flutter's `_mayCancelKot` two-route
  // rule). A Pending decline is everybody's; a ticketed cancel without the
  // permission gets the server's senior sentence and nothing is sent.
  const requestCancel = (order: Order, pending: boolean): void => {
    const route: CancelRoute | null = pending
      ? (canVoidOrder ? "void" : "status")
      : cancelKotRoute(user, order.status);
    if (route === null) {
      toast({ title: "Cancel needs a senior", description: cancelNeedsSeniorSentence(order.kot_nos ?? []) });
      return;
    }
    setCancelReq({ orderId: order.id, pending, route });
  };

  // The unified stage picker (finding 15) — the only stage walk on this page.
  const openChangeStage = (order: Order): void => {
    const cur = order.status.toLowerCase();
    if (cur === "paid" || cur === "closed") {
      // A settled bill is view-once: its order status is locked.
      toast({ title: SETTLED_LOCKED_NOTE });
      return;
    }
    setStageOrderId(order.id);
  };

  const handleStagePick = async (stage: string): Promise<void> => {
    const order = stageOrder;
    if (!order || rid === "") { return; }
    setStageOrderId(null);
    if (stage === order.status) { return; }
    if (stage === "Cancelled") {
      requestCancel(order, orderIsPending(order.status));
      return;
    }
    setBusyOrderId(order.id);
    try {
      if (stage === "Barked") {
        const resp = await barkOrderDetailed(rid, order.id);
        toast({ title: barkOutcomeMessage(resp) ?? "Sent to the kitchen." });
      } else {
        await advanceOrderStatus(rid, order.id, stage);
      }
      refreshOrders();
    } catch (err) {
      toast({ title: "Unable to update that order", description: serverWords(err), variant: "destructive" });
    } finally {
      setBusyOrderId(null);
    }
  };

  // "Table bill · APC" — the shared table-bill surface, exactly where Flutter's
  // sheet action lands. The preview opens at the top of this same page.
  const openTableBill = (order: Order): void => {
    setOpenOrderId(null);
    router.push(`/dashboard/orders?table=${encodeURIComponent(order.table)}&preview=1`);
  };

  /*
    PRINT BILL PREVIEWS FIRST AND CLAIMS ONLY ON PRINT (bill-preview.md 1-3).
    The preview is the in-place BillPreviewDialog the Tables sheet uses: it
    only READS the bill, and POST /print/bill (the thermal print and its
    ledger) runs when Print is pressed, so Cancel costs a waiter nothing. A
    waiter-only session skips the priced preview (item 19) and confirms
    without money. The server refuses a waiter's second print itself.
  */
  const [printPreviewTable, setPrintPreviewTable] = useState<string | null>(null);

  const printTableBillNow = async (tableName: string): Promise<boolean> => {
    if (!rid) { return false; }
    try {
      const { nextParty } = await printTableBill(rid, tableName);
      toast({ title: nextParty.message !== null ? `Printing bill… ${nextParty.message}` : "Printing bill…" });
      return true;
    } catch (err: unknown) {
      toast({ title: "Bill not printed", description: serverWords(err), variant: "destructive" });
      return false;
    } finally {
      // Re-read the floor either way, so the button and the row follow the SERVER's ledger.
      refreshSupport();
      refreshOrders();
    }
  };

  const triggerPrint = (order: Order): void => {
    const tableName = (order.table || "").trim();
    if (tableName !== "") {
      if (isWaiterOnly) {
        setConfirmAction({
          title: `Print the bill for Table ${tableName}?`,
          description: "The printed bill goes to the guest.",
          confirmLabel: "Print",
          run: async () => { await printTableBillNow(tableName); },
        });
      } else {
        setPrintPreviewTable(tableName);
      }
      return;
    }

    // A counter order with no table has no print ledger: the browser receipt, as before.
    const flattenedItems = order.items_flattened?.length ? order.items_flattened : order.items;
    let calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
    if (calculatedTaxes.length === 0 && defaultTax) {
      calculatedTaxes = Object.keys(defaultTax).map((name, i) => ({ id: `d${i}`, name, percentage: defaultTax[name], amount: order.subtotal * (defaultTax[name] / 100) }));
    }
    const orderWithCalculatedCharges = {
      ...order,
      items: flattenedItems,
      items_flattened: flattenedItems,
      serviceCharge: calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge),
      calculatedTaxes,
      currencySymbol,
    };
    const storageKey = storePrintBillPayload({
      ...orderWithCalculatedCharges,
      // No table, so no print ledger: nothing was claimed and nothing is.
      bill_print_state: null,
      printable_bill: null,
    });
    const url = `/dashboard/orders/print?orderKey=${encodeURIComponent(storageKey)}`;
    window.open(url, "_blank");
  };

  // Generate the bill (Bill Verification) — a styled confirmation carrying the
  // exact charges the bill will be created with (was a bare window.confirm).
  const requestBillVerification = (order: Order): void => {
    if (!user?.restaurantUsername) { return; }
    const restaurantId = user.restaurantUsername;
    let taxesToApply: Tax[] | undefined = order.taxes?.length ? order.taxes : undefined;
    if ((!taxesToApply || taxesToApply.length === 0) && defaultTax) {
      taxesToApply = Object.keys(defaultTax).map((name, i) => ({ id: `d${i}`, name, percentage: defaultTax[name] }));
    }
    const serviceChargeAmt = calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge);
    const taxRows = (taxesToApply ?? []).map((t) => ({ ...t, amount: order.subtotal * (t.percentage / 100) }));
    const taxAmount = taxRows.reduce((acc, t) => acc + t.amount, 0);
    const totalAmt = Math.max(0, order.subtotal + serviceChargeAmt + taxAmount);
    setConfirmAction({
      title: `Generate the bill for Table ${order.table}?`,
      confirmLabel: "Generate bill",
      description: (
        <>
          <p>
            Moves this order to Bill Verification and creates the bill. This cannot be undone —
            it will not go back to Preparing or Served.
          </p>
          <div className="rounded-md border border-divider p-2.5">
            <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{currencySymbol}{order.subtotal.toFixed(2)}</span></div>
            {order.applyServiceCharge && (order.serviceChargePercentage ?? 0) > 0 && (
              <div className="flex justify-between"><span>Service Charge ({order.serviceChargePercentage}%)</span><span className="tabular-nums">{currencySymbol}{serviceChargeAmt.toFixed(2)}</span></div>
            )}
            {taxRows.map((t) => (
              <div key={t.id} className="flex justify-between"><span>{t.name} ({t.percentage}%)</span><span className="tabular-nums">{currencySymbol}{t.amount.toFixed(2)}</span></div>
            ))}
            <div className="mt-1 flex justify-between border-t border-divider pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{currencySymbol}{totalAmt.toFixed(2)}</span></div>
          </div>
        </>
      ),
      run: async () => {
        try {
          const tax_breakdown = taxRows.map((t) => ({ name: t.name, percentage: t.percentage, amount: Number(t.amount.toFixed(2)) }));
          await createBill(restaurantId, {
            order_id: order.id,
            total_amt: totalAmt,
            emp_id: user.employeeId,
            status: 1,
            tax_breakdown,
          });
          const updatedOrder: Order = { ...order, status: "Bill Verification" };
          await addOrder(restaurantId, updatedOrder);
          refreshOrders();
        } catch (err) {
          toast({ title: "Unable to create bill", description: serverWords(err), variant: "destructive" });
        }
      },
    });
  };

  const handleReplaceBill = (order: Order, replacement: { items: OrderItem[]; taxes: { id?: string; name: string; percentage: number }[]; serviceChargePercentage?: number | undefined; applyServiceCharge?: boolean; reason: string }): void => {
    if (!user?.restaurantUsername) { return; }
    const restaurantId = user.restaurantUsername;
    if (!replacement.reason.trim()) {
      toast({ title: "Reason is required", description: "Say why the bill is being replaced.", variant: "destructive" });
      return;
    }

    const run = async (): Promise<void> => {
      try {
        const subtotal = replacement.items.reduce((s, it) => s + (it.price || 0) * (it.quantity || 0), 0);
        const serviceChargeAmount = replacement.applyServiceCharge && replacement.serviceChargePercentage ? subtotal * (replacement.serviceChargePercentage / 100) : 0;
        const tax_breakdown = replacement.taxes.map((t) => ({ name: t.name, percentage: t.percentage, amount: Number((subtotal * (t.percentage / 100)).toFixed(2)) }));
        const totalAmt = Math.max(0, subtotal + serviceChargeAmount + tax_breakdown.reduce((acc, t) => acc + (t.amount || 0), 0));

        const payload = {
          old_order_id: order.id,
          reason: replacement.reason,
          new_order: {
            items: replacement.items,
            subtotal,
            serviceChargePercentage: replacement.serviceChargePercentage ?? order.serviceChargePercentage,
            applyServiceCharge: replacement.applyServiceCharge ?? order.applyServiceCharge,
            taxes: replacement.taxes,
            table: order.table,
            customer: order.customer,
            taken_by_employee_id: order.taken_by_employee_id ?? null,
            taken_by_employee_name: order.taken_by_employee_name ?? null,
            taken_by_employee_role: order.taken_by_employee_role ?? null,
          },
          new_bill: {
            total_amt: totalAmt,
            tax_breakdown,
          },
        } as const;

        const result: unknown = await replaceBill(restaurantId, payload);
        if (!result) { throw new Error("Replace failed"); }
        refreshOrders();
        refreshSupport();
        setEditBillTarget(null);
      } catch (err) {
        toast({ title: "Failed to replace bill", description: serverWords(err), variant: "destructive" });
      }
    };

    setConfirmAction({
      title: "Replace this bill?",
      confirmLabel: "Replace bill",
      description: <p>This will update the existing bill and order in-place. The reason is recorded on the Bill Edit report.</p>,
      run,
    });
  };

  // What the guest actually pays for this table (the bill's grand_total).
  // Display only; the settle requests carry no amount.
  const fetchTablePayable = async (tableName: string): Promise<number | null> => {
    if (!user?.restaurantUsername) { return null; }
    try {
      const bill = await getBillForTable(user.restaurantUsername, tableName) as { grand_total?: unknown; total_amt?: unknown } | null;
      const amount = Number(bill?.grand_total ?? bill?.total_amt);
      return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
    } catch {
      return null;
    }
  };

  const payableRow = (payable: number | null): React.ReactNode =>
    payable == null ? null : (
      <p className="font-medium text-foreground">
        Amount payable: {currencySymbol}{payable.toFixed(2)} <span className="font-normal text-muted-foreground">(incl. taxes &amp; charges)</span>
      </p>
    );

  const handleAdminApprovePayment = async (order: Order): Promise<void> => {
    if (!user?.restaurantUsername || !user.employeeId) { return; }
    const restaurantId = user.restaurantUsername;
    const employeeId = user.employeeId;
    // C2 — the same permission POST .../admin-approve-payment checks.
    if (!canSettleBill) {
      showPermissionRequiredToast("Close Bill");
      return;
    }

    if (methodNeedsScreenshot(order.payment_method ?? "Cash", paymentMethods)) {
      const proofUrl = normalizeProofPreviewUrl(order.payment_proof_screenshot_url);
      if (!proofUrl) {
        toast({ title: "Payment screenshot is missing for this order.", variant: "destructive" });
        return;
      }
    }

    const payable = await fetchTablePayable(order.table);
    setConfirmAction({
      title: "Approve this payment?",
      confirmLabel: "Approve payment",
      description: (
        <>
          {payableRow(payable)}
          <p>Approves the waiter-confirmed payment for Table {order.table}.</p>
        </>
      ),
      run: async () => {
        try {
          await approveBillPaymentByAdmin(restaurantId, employeeId, order.id);
          refreshOrders();
        } catch (err) {
          toast({ title: "Unable to approve payment", description: serverWords(err), variant: "destructive" });
        }
      },
    });
  };

  // The sheet's one combined act — Flutter's table-bill "Approve payment &
  // close" — approve, then close, behind one styled confirmation.
  const handleApprovePaymentAndClose = async (order: Order): Promise<void> => {
    if (!user?.restaurantUsername || !user.employeeId) { return; }
    const restaurantId = user.restaurantUsername;
    const employeeId = user.employeeId;
    if (!canSettleBill) {
      showPermissionRequiredToast("Close Bill");
      return;
    }
    if (methodNeedsScreenshot(order.payment_method ?? "Cash", paymentMethods)) {
      const proofUrl = normalizeProofPreviewUrl(order.payment_proof_screenshot_url);
      if (!proofUrl) {
        toast({ title: "Payment screenshot is missing for this order.", variant: "destructive" });
        return;
      }
    }
    const payable = await fetchTablePayable(order.table);
    setConfirmAction({
      title: "Approve payment & close?",
      confirmLabel: "Approve & close",
      description: (
        <>
          {payableRow(payable)}
          <p>Approves the waiter-confirmed payment and closes the bill — this settles Table {order.table}.</p>
        </>
      ),
      run: async () => {
        try {
          await approveBillPaymentByAdmin(restaurantId, employeeId, order.id);
          await closeBillByOrder(restaurantId, employeeId, order.id);
          refreshOrders();
          toast({ title: "Bill settled" });
        } catch (err) {
          toast({ title: "Unable to settle the bill", description: serverWords(err), variant: "destructive" });
          refreshOrders();
        }
      },
    });
  };

  const handleCloseBill = (order: Order): void => {
    if (!user?.restaurantUsername || !user.employeeId) { return; }
    const restaurantId = user.restaurantUsername;
    const employeeId = user.employeeId;
    if (!canSettleBill) {
      showPermissionRequiredToast("Close Bill");
      return;
    }
    setConfirmAction({
      title: "Close this bill?",
      confirmLabel: "Close bill",
      description: <p>This finalizes the order on Table {order.table}.</p>,
      run: async () => {
        try {
          await closeBillByOrder(restaurantId, employeeId, order.id);
          refreshOrders();
        } catch (err) {
          toast({ title: "Unable to close bill", description: serverWords(err), variant: "destructive" });
        }
      },
    });
  };

  const handleReopenBill = (order: Order): void => {
    if (!user?.restaurantUsername) { return; }
    const restaurantId = user.restaurantUsername;
    if (!isAdmin) {
      showRoleRequiredToast("admin");
      return;
    }
    const billId = order.bill_id;
    if (!billId) {
      toast({ title: "No bill found for this order", variant: "destructive" });
      return;
    }
    setConfirmAction({
      title: "Re-open this closed bill?",
      confirmLabel: "Re-open bill",
      description: <p>The table goes back in service and the payment must be approved again.</p>,
      run: async () => {
        try {
          const r = await reopenBill(restaurantId, billId);
          toast({ title: "Bill re-opened", description: `${r.restored_orders ?? 0} order(s) restored — approve the payment again to settle.` });
          refreshOrders();
        } catch (err) {
          toast({ title: "Unable to re-open bill", description: serverWords(err), variant: "destructive" });
        }
      },
    });
  };

  const handleDecideDiscount = async (request: DiscountRequest, approve: boolean): Promise<void> => {
    if (!user?.restaurantUsername) { return; }
    try {
      await decideDiscountRequest(user.restaurantUsername, request.id, approve);
      toast({
        title: approve ? "Discount approved" : "Discount rejected",
        description: `Table ${request.table_name ?? "?"} · ${request.discount_value}${request.discount_type === "percent" ? "%" : ""} (≈${currencySymbol}${request.amount.toFixed(2)})`,
      });
      refreshDiscounts();
      refreshOrders();
    } catch (err) {
      toast({ title: "Failed", description: serverWords(err), variant: "destructive" });
      refreshDiscounts();
    }
  };

  /* ── 6.7 — the table preview's Print control (C3 claim + scope) ───────── */

  const previewPrintAnchor: Order | null = selectedTableName
    ? sessionOrders
        .filter((order) => (order.table || "").toLowerCase() === selectedTableName.toLowerCase() && !isOrderCancelled(order) && order.status !== "Closed")
        .reduce<Order | null>((newest, order) => (
          newest === null || Date.parse(order.created_at ?? "") > Date.parse(newest.created_at ?? "") ? order : newest
        ), null)
    : null;
  const previewPrintControl = !selectedTableName ? null : !printScopeForTable(selectedTableName).print ? (
    <div className="flex min-h-14 items-center rounded-md border border-border px-3 text-sm text-muted-foreground">
      Bill printed — a reprint has to be made by a senior.
    </div>
  ) : (
    <Button
      size="lg"
      variant="outline"
      className="h-14 w-full text-base [&_svg]:size-5"
      disabled={previewPrintAnchor === null}
      title={previewPrintAnchor === null ? "Nothing has been ordered on this table yet" : "Print this table's bill"}
      onClick={() => { if (previewPrintAnchor) { triggerPrint(previewPrintAnchor); } }}
    >
      <Printer /> Print Bill
    </Button>
  );

  /* ── The detail sheet's web-extra actions ─────────────────────────────── */

  const cfdUrlFor = (order: Order): string | null => {
    const tbl = tables.find((t) => t.name.toLowerCase() === order.table.toLowerCase());
    if (!tbl?.qr_token || !user?.restaurantUsername) { return null; }
    return `/cfd/${encodeURIComponent(user.restaurantUsername)}?t=${encodeURIComponent(tbl.qr_token)}`;
  };

  const sheetExtras = (order: Order): React.ReactNode => {
    const cancelled = isOrderCancelled(order);
    const printScope = printScopeForTable(order.table);
    const billStage =
      order.status === "Bill Verification"
      || order.status === "Payment Pending Approval"
      || order.status === "Paid"
      || order.status === "Closed";
    const cfdUrl = cfdUrlFor(order);
    return (
      <>
        {/* C3 — a waiter gets Print Bill and keeps it, once; the ledger's
            refusal is a sentence, not a blank space. */}
        {isWaiterOnly ? (
          printScope.print ? (
            <Button variant="outline" size="sm" disabled={cancelled} title="Print this table's bill" onClick={() => { triggerPrint(order); }}>
              <Printer /> Print Bill
            </Button>
          ) : (
            <span className="text-[11px] leading-tight text-muted-foreground">
              Bill printed — a reprint has to be made by a senior.
            </span>
          )
        ) : (
          <Button variant="outline" size="sm" disabled={!billStage} title="Print this table's bill" onClick={() => { triggerPrint(order); }}>
            <Printer /> Print Bill
          </Button>
        )}
        {/* 6.5 — the bill operations menu (discount / loyalty / split / merge
            / refund / name-GSTIN), hidden from a scoped waiter. */}
        {!isWaiterOnly && order.table && !cancelled ? (
          <BillActions
            restaurantId={rid}
            tableName={order.table}
            isAdmin={isAdmin}
            onChanged={() => { refreshOrders(); }}
          />
        ) : null}
        {/* Customer-facing display for this table (public page; the signed
            table token is the auth). */}
        {cfdUrl !== null ? (
          <Button variant="ghost" size="icon" title="Open customer display" onClick={() => { window.open(cfdUrl, "_blank"); }}>
            <MonitorSmartphone className="h-4 w-4" />
            <span className="sr-only">Open customer display</span>
          </Button>
        ) : null}
        {!isWaiterOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="More actions">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {cancelled ? (
                <div className="max-w-[15rem] px-2 pb-1.5 text-xs text-muted-foreground">{CANCELLED_LOCK_REASON}</div>
              ) : null}
              {mayAddOrder ? (
                <DropdownMenuItem
                  disabled={billStage || cancelled}
                  onClick={() => { setUpdateOrderTarget(order); }}
                >
                  Update Order
                </DropdownMenuItem>
              ) : null}
              {canSettleBill ? (
                <DropdownMenuItem
                  disabled={order.status !== "Bill Verification"}
                  onClick={() => { setEditBillTarget(order); }}
                >
                  Edit Bill
                </DropdownMenuItem>
              ) : null}
              {canSettleBill ? (
                <DropdownMenuItem
                  disabled={order.status !== "Served"}
                  onClick={() => { requestBillVerification(order); }}
                >
                  Bill Verification
                </DropdownMenuItem>
              ) : null}
              {/* The one settle door — the unified payment sheet (tenders,
                  splits, tips, proof, till, Settle as NC), Flutter's settle. */}
              {canSettleBill ? (
                <DropdownMenuItem
                  disabled={cancelled || order.status === "Payment Pending Approval" || order.status === "Paid" || !!order.bill_closed_at}
                  onClick={() => { setSettleTarget(order); }}
                >
                  Settle bill…
                </DropdownMenuItem>
              ) : null}
              {/* C2 — only someone who may settle sees a settle control. */}
              {canSettleBill ? (
                <>
                  <DropdownMenuItem
                    onClick={() => { void handleAdminApprovePayment(order); }}
                    disabled={order.status !== "Payment Pending Approval"}
                  >
                    Approve Payment
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => { handleCloseBill(order); }}
                    disabled={order.status !== "Paid"}
                  >
                    Close Bill
                  </DropdownMenuItem>
                </>
              ) : null}
              {isAdmin ? (
                <DropdownMenuItem
                  onClick={() => { handleReopenBill(order); }}
                  disabled={!order.bill_closed_at || !order.bill_id || cancelled}
                >
                  Re-open Bill (Admin)
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </>
    );
  };

  /* ── Render ───────────────────────────────────────────────────────────── */

  const openOrderProofUrl = openOrder ? normalizeProofPreviewUrl(openOrder.payment_proof_screenshot_url) : null;
  const openOrderApc = openOrder ? orderApcByOrderId.get(openOrder.id) ?? null : null;

  const hiddenNote = hiddenCount > 0 ? (
    <HiddenOrdersNote hidden={hiddenCount} canOpenHistory={canOpenHistory} onOpenHistory={openHistory} />
  ) : null;

  return (
    <div className="relative grid gap-5 pb-24">
      {/* The quiet outlet strip (only for multi-outlet tenants) + the one
          header action kept from the web page (tax defaults, admin-only). */}
      {(ordersScope && ordersScope.outlets.length >= 2) || isAdmin ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <OutletScopeBar scope={ordersScope} canSwitchOutlet={canSwitchOutlet} />
          </div>
          {isAdmin ? (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { setIsDefaultTaxDialogOpen(true); }}>
              <SlidersHorizontal /> Modify Default Tax
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* The notification banner — persistent until dismissed, copper when the
          order is right here, warning when it is not (finding 25). */}
      {focusRequested ? (
        <FocusBanner
          found={focusFound}
          message={focusFound
            ? "Showing the order from your notification."
            : "That order isn't in this list — it may be settled and past the live window, or on another outlet."}
          actions={focusFound ? (
            focusedTableName && focusedTableName !== "—" && canOpenTables ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { router.push(`/dashboard/tables?focus=${encodeURIComponent(JSON.stringify({ table: focusedTableName }))}`); }}
              >
                <Table2 /> Open {focusedTableName}
              </Button>
            ) : null
          ) : (
            <>
              {canOpenHistory ? (
                <Button size="sm" variant="outline" onClick={openHistory}>
                  <CalendarDays /> History
                </Button>
              ) : null}
              {canSwitchOutlet && (ordersScope?.outlets.length ?? 0) > 1 ? (
                <Button size="sm" variant="outline" onClick={() => { void applySelectedOutlet(ALL_OUTLETS); }}>
                  <Layers /> All outlets
                </Button>
              ) : null}
            </>
          )}
          onDismiss={dismissFocus}
          showAllLabel="Show all orders"
        />
      ) : null}

      {/* 1.8 / 1.3 / 6.7 — the selected table's preview, first thing on the
          page whenever the Tables page (or "Table bill · APC") named a table. */}
      {selectedTableName ? (
        <TableKotPreview
          restaurantId={rid}
          tableName={selectedTable?.name ?? selectedTableName}
          // rawOrders, not sessionOrders: C3 retires a printed table from a
          // waiter's LIST, but the preview names the table explicitly.
          orders={rawOrders}
          cancelLocked={printScopeForTable(selectedTable?.name ?? selectedTableName).retiresTable}
          canEditCustomer={!isWaiterOnly}
          onAddOrder={() => {
            const padTable = selectedTable?.name ?? selectedTableName;
            setPadRequest({
              kind: "dine",
              table: padTable,
              occupyOnSend: selectedTable !== null && selectedTable.status !== "Occupied",
              // order-entry.md 27: a printed bill's Add Order is the table
              // sheet's "Add to printed bill" — the pad's orange strip and flag.
              addToPrintedBill: serverSaysBillPrinted(billPrintByTable.get(padTable.toLowerCase()) ?? null),
            });
          }}
          printControl={previewPrintControl}
          onChanged={() => { refreshOrders(); }}
          onClose={() => { router.push("/dashboard/orders"); }}
        />
      ) : null}

      {/* Admin approval queue for staff discounts (web-extra, kept). */}
      {isAdmin ? (
        <DiscountApprovals
          requests={discounts.data ?? []}
          highlight={requestHighlight}
          currencySymbol={currencySymbol}
          formatWhen={(iso) => formatOrderedAt(iso, timezone)}
          onDecide={(request, approve) => { void handleDecideDiscount(request, approve); }}
        />
      ) : null}

      {/* The grid: three sections of clickable tiles at 4/3/2/1 columns. */}
      {bundle.loading ? (
        <SkeletonRows rows={6} />
      ) : bundle.error != null ? (
        <LoadErrorState whatFailed="Couldn't load orders." error={bundle.error} onRetry={bundle.retry} />
      ) : sorted.length === 0 ? (
        <div className="grid gap-4">
          <OrdersEmptyState
            scope={ordersScope}
            canSwitchOutlet={canSwitchOutlet}
            canOpenHistory={canOpenHistory}
            onOpenHistory={openHistory}
          />
          {hiddenNote}
        </div>
      ) : (
        <div className="grid gap-7">
          {([0, 1, 2] as const).map((s) => {
            const rows = grouped[s];
            if (rows.length === 0) { return null; }
            return (
              <section key={ORDER_SECTION_TITLES[s]}>
                <SectionHeader
                  title={ORDER_SECTION_TITLES[s]}
                  count={rows.length}
                  trailing={s === 2 && rows.some((o) => isCancelledStatus(o.status))
                    ? <span className="text-xs text-muted-foreground">{ORDER_PAID_CAPTION}</span>
                    : null}
                />
                <div className="mt-3 grid grid-cols-1 gap-3.5 min-[720px]:grid-cols-2 min-[1120px]:grid-cols-3 min-[1500px]:grid-cols-4">
                  {rows.map((o) => (
                    <div key={o.id} id={`order-card-${o.id}`}>
                      <OrderCard
                        order={o}
                        focused={isFocused(o)}
                        showsMoney={moneyShows}
                        money={money}
                        placedLabel={placedShort(o.created_at)}
                        canBark={canBark}
                        busy={busyOrderId === o.id}
                        onOpen={() => { setOpenOrderId(o.id); }}
                        onBark={() => { void handleBark(o); }}
                        onApprove={() => { void handleApprovePending(o); }}
                        onDecline={() => { requestCancel(o, true); }}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {hiddenNote}
        </div>
      )}

      <CacheStalePill offline={bundle.offline} fromCache={bundle.fromCache} updatedAt={bundle.updatedAt} />

      {/* The floating "Takeaway / Delivery" action (finding 27). */}
      {mayAddOrder ? (
        <Button
          size="lg"
          className="fixed bottom-6 right-6 z-40 shadow-card-hover"
          onClick={() => { setChannelOpen(true); }}
        >
          <ShoppingBag /> Takeaway / Delivery
        </Button>
      ) : null}

      {/* ── Drill-down & flows ─────────────────────────────────────────── */}

      <OrderDetailSheet
        order={openOrder}
        open={openOrderId !== null && openOrder !== null}
        onOpenChange={(o) => { if (!o) { setOpenOrderId(null); } }}
        restaurantId={rid}
        focused={openOrder ? isFocused(openOrder) : false}
        showsMoney={moneyShows}
        money={money}
        placedLabel={placedShort(openOrder?.created_at)}
        showsControls={openOrder !== null && openOrder.table !== "" && !isOrderCancelled(openOrder) && (!isWaiterOnly || canAnyControlAct)}
        canSettleBill={canSettleBill}
        canBark={canBark}
        onChangeStage={() => { if (openOrder) { openChangeStage(openOrder); } }}
        onBark={() => { if (openOrder) { void handleBark(openOrder); } }}
        onOpenTableBill={() => { if (openOrder) { openTableBill(openOrder); } }}
        onApprovePayment={() => { if (openOrder) { void handleApprovePaymentAndClose(openOrder); } }}
        onSettle={() => { if (openOrder) { setSettleTarget(openOrder); } }}
        canComp={can(user, "comp_item")}
        onComp={() => { if (openOrder) { setCompTarget(openOrder); } }}
        onViewProof={openOrderProofUrl === null ? null : () => { setProofPreviewUrl(openOrderProofUrl); }}
        extraRows={openOrderApc && moneyShows ? (
          <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1.5 text-sm last:border-b-0">
            <span className="shrink-0 text-xs text-muted-foreground">APC zone</span>
            <StatusChip
              status={openOrderApc.zone === "green" ? "success" : openOrderApc.zone === "yellow" ? "warning" : "danger"}
              label={`${openOrderApc.zone.toUpperCase()} (${currencySymbol}${openOrderApc.target_total.toFixed(2)} target)`}
              dense
            />
          </div>
        ) : null}
        extraActions={openOrder ? sheetExtras(openOrder) : null}
        onChanged={() => { refreshOrders(); }}
        busy={openOrder !== null && busyOrderId === openOrder.id}
      />

      {stageOrder ? (
        <ChangeStageDialog
          open={stageOrderId !== null}
          onOpenChange={(o) => { if (!o) { setStageOrderId(null); } }}
          current={stageOrder.status}
          barked={isOrderBarked(stageOrder)}
          mayCancel={orderIsPending(stageOrder.status) || cancelKotRoute(user, stageOrder.status) !== null}
          onPick={(stage) => { void handleStagePick(stage); }}
          busy={busyOrderId === stageOrder.id}
        />
      ) : null}

      {cancelReq !== null && cancelOrderRow !== null ? (
        <CancelOrderDialog
          open
          onOpenChange={(o) => { if (!o) { setCancelReq(null); } }}
          restaurantId={rid}
          order={cancelOrderRow}
          route={cancelReq.route}
          value={money(cancelOrderRow.total)}
          pending={cancelReq.pending}
          suggestedAuthoriser={actorName}
          onCancelled={() => { setCancelReq(null); refreshOrders(); }}
        />
      ) : null}

      <ChannelSheet
        open={channelOpen}
        onOpenChange={setChannelOpen}
        onPick={(channel) => { setChannelOpen(false); setPadRequest({ kind: channel }); }}
      />


      <ConfirmActionDialog request={confirmAction} onClose={() => { setConfirmAction(null); }} />

      {/* The in-place bill preview: nothing is claimed until Print. */}
      {!isWaiterOnly ? (
        <BillPreviewDialog
          open={printPreviewTable !== null}
          onOpenChange={(open) => { if (!open) { setPrintPreviewTable(null); } }}
          restaurantId={rid}
          tableName={printPreviewTable ?? ""}
          printedFallback={printPreviewTable !== null && serverSaysBillPrinted(billPrintByTable.get(printPreviewTable.toLowerCase()) ?? null)}
          onPrint={() => (printPreviewTable === null ? Promise.resolve(false) : printTableBillNow(printPreviewTable))}
        />
      ) : null}

      {/* The staff order pad (docs/parity/order-entry.md) — dine-in via the
          ?table= deep link, takeaway / delivery via the channel picker. */}
      {padRequest !== null && rid !== "" ? (
        <OrderPad
          request={padRequest}
          restaurantId={rid}
          onClose={closePad}
          onSent={() => { refreshOrders(); refreshSupport(); }}
        />
      ) : null}

      {settleTarget !== null && user ? (
        <PaymentSheet
          open
          onOpenChange={(o) => { if (!o) { setSettleTarget(null); } }}
          restaurantId={rid}
          user={user}
          orderId={settleTarget.id}
          tableName={settleTarget.table}
          fallbackTotal={Number.isFinite(settleTarget.total) ? settleTarget.total : null}
          onSettled={() => { setOpenOrderId(null); refreshOrders(); }}
        />
      ) : null}
      {compTarget !== null && user ? (
        <CompSheet
          open
          onOpenChange={(o) => { if (!o) { setCompTarget(null); } }}
          restaurantId={rid}
          user={user}
          tableName={compTarget.table}
          orderIds={[compTarget.id]}
          onChanged={refreshOrders}
        />
      ) : null}

      {updateOrderTarget ? (
        <OrderDetailsDialog
          order={updateOrderTarget}
          canEditPrice={isAdmin}
          open
          onOpenChange={(isOpen) => { if (!isOpen) { setUpdateOrderTarget(null); } }}
          onSave={async (updatedOrder) => {
            if (!user?.restaurantUsername) { return; }
            try {
              // Removed lines go through the item-delete endpoint first.
              try {
                const orig = updateOrderTarget;
                const origIds = orig.items.map((i) => i.id);
                const updatedIds = updatedOrder.items.map((i) => i.id);
                const removed = origIds.filter((id) => !updatedIds.includes(id));
                if (removed.length > 0) {
                  await Promise.all(removed.map((id) => requestBackend({ path: `/orders/${encodeURIComponent(updatedOrder.id)}/items/${encodeURIComponent(id)}`, method: "DELETE", restaurantId: user.restaurantUsername })));
                }
              } catch (e) {
                console.error("Failed to call delete-item endpoints", e);
              }

              await addOrder(user.restaurantUsername, updatedOrder);
              refreshOrders();
              refreshSupport();
            } catch (err) {
              toast({ title: "Unable to save order", description: serverWords(err), variant: "destructive" });
            } finally {
              setUpdateOrderTarget(null);
            }
          }}
          menuItems={menuItems}
        />
      ) : null}

      {editBillTarget ? (
        <EditOrderDialog
          key={editBillTarget.id}
          order={editBillTarget}
          open
          onOpenChange={(isOpen) => { if (!isOpen) { setEditBillTarget(null); } }}
          onReplace={handleReplaceBill}
          canEditPrice={isAdmin}
          defaultTax={defaultTax}
          menuItems={menuItems}
        />
      ) : null}

      <DefaultTaxDialog
        open={isDefaultTaxDialogOpen}
        onOpenChange={setIsDefaultTaxDialogOpen}
        defaultTax={defaultTax}
        onSaved={(t) => {
          setDefaultTaxOverride(t);
          if (user?.restaurantUsername) {
            void setOutletDefaultTax(user.restaurantUsername, t).catch((err: unknown) => {
              toast({ title: "Unable to save default tax", description: serverWords(err), variant: "destructive" });
            });
          }
        }}
      />

      <Dialog
        open={proofPreviewUrl !== null}
        onOpenChange={(open) => { if (!open) { setProofPreviewUrl(null); } }}
      >
        <DialogContent className="w-full sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment Screenshot</DialogTitle>
            <DialogDescription>
              Preview the uploaded payment proof before approval.
            </DialogDescription>
          </DialogHeader>
          {proofPreviewUrl !== null ? (
            <div className="max-h-[70vh] overflow-auto rounded-md border border-border p-2">
              <Image
                src={proofPreviewUrl}
                alt="Payment proof screenshot"
                width={1024}
                height={768}
                className="h-auto w-full rounded-md object-contain"
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No screenshot available.</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setProofPreviewUrl(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── The hidden-orders accounting note (findings 22–23) ────────────────── */

function HiddenOrdersNote({ hidden, canOpenHistory, onOpenHistory }: { hidden: number; canOpenHistory: boolean; onOpenHistory: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <History className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-hidden />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
        {hidden} settled order{hidden === 1 ? "" : "s"} placed over {ORDERS_LIVE_WINDOW_HOURS} hours ago {hidden === 1 ? "is" : "are"} hidden here.{" "}
        {canOpenHistory
          ? "Nothing was deleted — they are in History."
          : "Nothing was deleted — they are kept on record, and anyone with History access can still pull them up."}
      </span>
      {canOpenHistory ? (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onOpenHistory}>
          <CalendarDays /> History
        </Button>
      ) : null}
    </div>
  );
}

/* ── The styled confirmation every window.confirm() became (finding 33) ── */

function ConfirmActionDialog({ request, onClose }: { request: ConfirmActionRequest | null; onClose: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => { if (!open && !busy) { onClose(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">{request?.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={request?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            disabled={busy || request === null}
            onClick={(e) => {
              // Keep the dialog up while the write runs; close when it lands.
              e.preventDefault();
              if (request === null) { return; }
              setBusy(true);
              void request.run()
                .catch(() => { /* each run() reports its own failure */ })
                .finally(() => { setBusy(false); onClose(); });
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Edit Bill (web-extra 40 — bill replacement with a recorded reason) ── */

function EditOrderDialog({ order, open, onOpenChange, onReplace, canEditPrice, defaultTax, menuItems }: { order: Order; open: boolean; onOpenChange: (open: boolean) => void; onReplace: (order: Order, replacement: { items: OrderItem[]; taxes: { id?: string; name: string; percentage: number }[]; serviceChargePercentage?: number | undefined; applyServiceCharge?: boolean; reason: string }) => void; canEditPrice?: boolean; defaultTax?: Record<string, number> | null; menuItems?: MenuItem[] }): React.JSX.Element {
  const { currencySymbol } = useCurrency();
  const [serviceChargePerc, setServiceChargePerc] = useState(order.serviceChargePercentage?.toString() ?? "");
  const [taxes, setTaxes] = useState<Tax[]>(order.taxes ?? []);
  const [applyServiceCharge, setApplyServiceCharge] = useState(order.applyServiceCharge);
  const [localItems, setLocalItems] = useState<OrderItem[]>(order.items.map((i) => ({ ...i })));
  const [newItemName, setNewItemName] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState<number>(1);
  const [newItemNote, setNewItemNote] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    void Promise.resolve().then(() => {
      setServiceChargePerc(order.serviceChargePercentage?.toString() ?? "");
      setApplyServiceCharge(order.applyServiceCharge);
      setLocalItems(order.items.map((i) => ({ ...i })));
      setReason("");
      setNewItemName("");
      setNewItemQuantity(1);
      setNewItemNote("");

      if (Array.isArray(order.taxes) && order.taxes.length > 0) {
        setTaxes(order.taxes);
      } else if (defaultTax && typeof defaultTax === "object") {
        const taxesFromDefault: Tax[] = [];
        for (const [k, v] of Object.entries(defaultTax)) {
          if (!k) { continue; }
          if (/service ?charge/i.test(k) || /service ?charges/i.test(k)) {
            if (v > 0) {
              setServiceChargePerc(String(v));
              setApplyServiceCharge(true);
            }
          } else {
            taxesFromDefault.push({ id: `d-${k}`, name: k, percentage: v });
          }
        }
        setTaxes(taxesFromDefault);
      } else {
        setTaxes([]);
      }
    });
  }, [order, defaultTax]);

  const handleTaxChange = (id: string, field: "name" | "percentage", value: string): void => {
    setTaxes(taxes.map((tax) => tax.id === id ? { ...tax, [field]: field === "percentage" ? (parseFloat(value) || 0) : value } : tax));
  };

  const addTax = (): void => {
    setTaxes([...taxes, { id: `t${Date.now()}`, name: "", percentage: 0 }]);
  };

  const removeTax = (id: string): void => {
    setTaxes(taxes.filter((tax) => tax.id !== id));
  };

  const handleAddItem = (): void => {
    const itemName = newItemName.trim();
    const selectedMenuItem = (menuItems ?? []).find((m) => m.name.toLowerCase() === itemName.toLowerCase());
    if (!selectedMenuItem) { return; }
    const normalizedNote = newItemNote.trim();

    setLocalItems((prev) => {
      const existing = prev.find(
        (p) => p.name.trim().toLowerCase() === itemName.toLowerCase() && (p.note ?? "") === normalizedNote,
      );
      if (existing) {
        return prev.map((p) => p.id === existing.id ? { ...p, quantity: p.quantity + newItemQuantity } : p);
      }
      return [...prev, {
        id: `i${Date.now()}`,
        name: selectedMenuItem.name,
        quantity: newItemQuantity,
        price: selectedMenuItem.price || 0,
        orderedAt: new Date().toISOString(),
        note: normalizedNote || null,
      }];
    });

    setNewItemName("");
    setNewItemQuantity(1);
    setNewItemNote("");
  };

  const handleRemoveItem = (id: string): void => { setLocalItems((prev) => prev.filter((i) => i.id !== id)); };

  const handleSubmit = (): void => {
    const cleanTaxes = taxes.filter((t) => t.name && t.percentage > 0);
    if (!reason.trim()) { return; }
    onReplace(order, {
      items: localItems,
      taxes: cleanTaxes,
      serviceChargePercentage: serviceChargePerc ? parseFloat(serviceChargePerc) : undefined,
      applyServiceCharge,
      reason: reason.trim(),
    });
  };

  const localSubtotal = localItems.reduce((acc, it) => acc + (it.price || 0) * (it.quantity || 0), 0);
  const serviceChargeAmount = calculateServiceCharge(localSubtotal, parseFloat(serviceChargePerc), applyServiceCharge);
  const calculatedTaxesWithAmounts = calculateTaxes(localSubtotal, taxes);
  const totalTaxAmount = calculatedTaxesWithAmounts.reduce((acc, tax) => acc + tax.amount, 0);
  const totalAmount = localSubtotal + serviceChargeAmount + totalTaxAmount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Bill - {order.table}</DialogTitle>
          <DialogDescription>
            Add service charges and taxes. Item prices are locked to the menu price in the order tab.
            {!canEditPrice ? " Price changes are disabled for your role." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="subtotal">Subtotal</Label>
            <Input id="subtotal" type="number" value={localSubtotal.toFixed(2)} className="col-span-2" disabled />
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
            <Label>Service Charge</Label>
            <div className="col-span-2 flex items-center space-x-2">
              <Switch id="applyServiceCharge" checked={applyServiceCharge} onCheckedChange={setApplyServiceCharge} />
              <Label htmlFor="applyServiceCharge" className="text-sm font-normal">{applyServiceCharge ? "Enabled" : "Disabled"}</Label>
            </div>
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="serviceCharge">Percentage (%)</Label>
            <Input id="serviceCharge" type="number" value={serviceChargePerc} onChange={(e) => { setServiceChargePerc(e.target.value); }} className="col-span-2" placeholder="e.g., 10" disabled={!applyServiceCharge} />
          </div>

          <div className="grid grid-cols-1 gap-y-2">
            <Label>Items</Label>
            <div className="mb-2 max-h-40 overflow-y-auto">
              <Table>
                <TableBody>
                  {localItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <div>{item.name}</div>
                        {item.note ? <div className="text-xs text-muted-foreground">Note: {item.note}</div> : null}
                      </TableCell>
                      <TableCell className="text-center">
                        <Input type="number" value={String(item.quantity)} onChange={(e) => { setLocalItems((prev) => prev.map((p) => p.id === item.id ? { ...p, quantity: Math.max(1, Number(e.target.value) || 1) } : p)); }} className="mx-auto w-16" />
                      </TableCell>
                      <TableCell className="text-right">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => { handleRemoveItem(item.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="my-2 grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <Combobox
                  options={(menuItems ?? []).map((m) => ({ value: m.name.toLowerCase(), label: m.name }))}
                  value={newItemName.toLowerCase()}
                  onChange={(value) => {
                    const selected = (menuItems ?? []).find((m) => m.name.toLowerCase() === value);
                    setNewItemName(selected?.name ?? value);
                  }}
                  placeholder="Select item"
                  searchPlaceholder="Search for an item..."
                  emptyPlaceholder="No items found."
                />
              </div>
              <Input
                placeholder="Note"
                value={newItemNote}
                onChange={(e) => { setNewItemNote(e.target.value); }}
                className="col-span-4"
              />
              <Input placeholder="Qty" type="number" value={String(newItemQuantity)} onChange={(e) => { setNewItemQuantity(Math.max(1, Number(e.target.value) || 1)); }} className="col-span-2" />
              <Button onClick={handleAddItem} className="col-span-1">Add</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-y-2">
            <Label>Taxes</Label>
            <div className="space-y-2">
              {taxes.map((tax) => (
                <div key={tax.id} className="grid grid-cols-12 items-center gap-2">
                  <Input placeholder="Tax Name (e.g., VAT)" value={tax.name} onChange={(e) => { handleTaxChange(tax.id, "name", e.target.value); }} className="col-span-7" />
                  <Input placeholder="%" type="number" value={tax.percentage} onChange={(e) => { handleTaxChange(tax.id, "percentage", e.target.value); }} className="col-span-3" />
                  <Button variant="ghost" size="icon" onClick={() => { removeTax(tax.id); }} className="col-span-2"><X className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addTax} className="mt-2 w-full">Add Tax</Button>
          </div>

          <div className="mt-2 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span>Calculated Service Charge:</span>
              <span>{applyServiceCharge ? `${currencySymbol}${serviceChargeAmount.toFixed(2)}` : `${currencySymbol}0.00`}</span>
            </div>
            {calculatedTaxesWithAmounts.map((tax) => (
              <div key={tax.id} className="flex justify-between text-sm">
                <span>{tax.name} ({tax.percentage}%):</span>
                <span>{currencySymbol}{tax.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t pt-2 text-lg font-bold">
              <span>Final Total:</span>
              <span>{currencySymbol}{totalAmount.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="edit-bill-reason">Reason for Edit (required)</Label>
            <textarea
              id="edit-bill-reason"
              aria-label="Reason for bill replacement"
              placeholder="Write the reason for replacement"
              value={reason}
              onChange={(e) => { setReason(e.target.value); }}
              className="mt-1 w-full rounded border p-2"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button disabled={!reason.trim()} onClick={handleSubmit}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Update Order (web-extra 39 — the item editor) ────────────────────── */

function OrderDetailsDialog({ order, open, onOpenChange, onSave, menuItems, canEditPrice }: { order: Order | null; open: boolean; onOpenChange: (open: boolean) => void; onSave: (updated: Order) => Promise<void>; menuItems: MenuItem[]; canEditPrice?: boolean }): React.JSX.Element | null {
  const { currencySymbol } = useCurrency();
  const { timezone } = useTimezone();
  const [localItems, setLocalItems] = useState<OrderItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemNote, setNewItemNote] = useState("");
  const [newItemHold, setNewItemHold] = useState(false);

  useEffect(() => {
    if (open && order) {
      void Promise.resolve().then(() => {
        setLocalItems(order.items.map((i) => ({ ...i })));
        setNewItemName("");
        setNewItemNote("");
        setNewItemHold(false);
      });
    }
  }, [open, order]);

  if (!order) { return null; }

  // Defence in depth: the "Update Order" entry is already disabled for a
  // cancelled order, but if this dialog is ever reached the editors stay locked.
  const cancelledLock = isOrderCancelled(order);

  const handleAddItem = (): void => {
    if (cancelledLock) { return; }
    const itemName = newItemName.trim();
    const selectedMenuItem = menuItems.find((item) => item.name.toLowerCase() === itemName.toLowerCase());
    if (!selectedMenuItem) {
      return;
    }
    const normalizedNote = newItemNote.trim();
    const hold = newItemHold;

    setLocalItems((prev) => {
      const nameLower = selectedMenuItem.name.trim().toLowerCase();
      const existing = prev.find((i) => i.name.trim().toLowerCase() === nameLower && (i.note ?? "") === normalizedNote && isItemHeld(i) === hold);
      if (existing) {
        return prev.map((i) => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      const newItem: OrderItem = {
        id: `i${Date.now()}`,
        name: selectedMenuItem.name,
        quantity: 1,
        price: selectedMenuItem.price || 0,
        orderedAt: new Date().toISOString(),
        note: normalizedNote || null,
        ...(hold ? { course_hold: true } : {}),
      };
      return [...prev, newItem];
    });
    setNewItemName("");
    setNewItemNote("");
    setNewItemHold(false);
  };

  const handleRemove = (itemId: string): void => {
    if (cancelledLock) { return; }
    setLocalItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const subtotal = localItems.reduce((acc, it) => acc + it.price * it.quantity, 0);
  const serviceCharge = calculateServiceCharge(subtotal, order.serviceChargePercentage, order.applyServiceCharge);
  const calculatedTaxes = calculateTaxes(subtotal, order.taxes);
  const totalTaxAmount = calculatedTaxes.reduce((sum, tax) => sum + tax.amount, 0);
  const total = subtotal + serviceCharge + totalTaxAmount;

  const menuOptions = menuItems.map((item) => ({ value: item.name.toLowerCase(), label: item.name }));

  const handleSave = async (): Promise<void> => {
    if (cancelledLock) { return; }
    const updatedOrder: Order = {
      ...order,
      items: localItems,
      subtotal,
      total,
      taxes: calculatedTaxes,
    };
    await onSave(updatedOrder);
  };

  const handleCancel = (): void => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Order Details - {order.table}</DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2">
              <span>Status:</span>
              {order.status === "Preparing" && !isOrderBarked(order) ? (
                <Badge variant="outline" className="border-dashed text-xs text-muted-foreground">Not barked</Badge>
              ) : (
                <Badge variant={cancelledLock ? "destructive" : order.status === "Preparing" ? "secondary" : order.status === "Served" ? "default" : "outline"} className="text-xs">{order.status}</Badge>
              )}
            </span>
            {cancelledLock ? (
              <span className="mt-1 block text-xs text-muted-foreground">{CANCELLED_LOCK_REASON}</span>
            ) : null}
            {!canEditPrice ? " Price changes are disabled for your role." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <div className="my-4 max-h-[40vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-center">Time</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {item.name}
                        <StationBadge station={item.station} />
                        {isItemHeld(item) ? (
                          <Badge variant="outline" className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] text-warning">HOLD</Badge>
                        ) : null}
                      </div>
                      {item.note ? <div className="text-xs text-muted-foreground">Note: {item.note}</div> : null}
                    </TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      <div className="flex items-center justify-center">
                        {formatOrderedAt(item.orderedAt, timezone)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" disabled={cancelledLock} onClick={() => { handleRemove(item.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="my-4 grid grid-cols-12 gap-2 border-t pt-4">
            <Combobox
              options={menuOptions}
              value={newItemName.toLowerCase()}
              onChange={(value) => {
                const selectedItem = menuItems.find((item) => item.name.toLowerCase() === value);
                setNewItemName(selectedItem?.name || value);
              }}
              placeholder="Select item"
              searchPlaceholder="Search for an item..."
              emptyPlaceholder="No items found."
              className="col-span-5"
            />
            <Input
              placeholder="Note"
              value={newItemNote}
              onChange={(e) => { setNewItemNote(e.target.value); }}
              className="col-span-4"
            />
            <div className="col-span-2 flex items-center justify-center gap-1" title="Hold this course — fire it from the KDS later">
              <Switch id="details-item-hold" checked={newItemHold} disabled={cancelledLock} onCheckedChange={setNewItemHold} />
              <Label htmlFor="details-item-hold" className="text-xs font-normal text-muted-foreground">Hold</Label>
            </div>
            <Button onClick={handleAddItem} disabled={cancelledLock} className="col-span-1">Add</Button>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-t pt-2">
              <span>Subtotal</span>
              <span>{currencySymbol}{subtotal.toFixed(2)}</span>
            </div>
            {/* Only a charge that is charged. A removed one shows no row, and a
                0% no longer renders a stray "0" through the && short-circuit. */}
            {order.applyServiceCharge && (order.serviceChargePercentage ?? 0) > 0 && (
              <div className="flex justify-between">
                <span>Service Charge ({order.serviceChargePercentage}%)</span>
                <span>{currencySymbol}{serviceCharge.toFixed(2)}</span>
              </div>
            )}
            {calculatedTaxes.map((tax) => (
              <div key={tax.id} className="flex justify-between">
                <span>{tax.name} ({tax.percentage}%)</span>
                <span>{currencySymbol}{tax.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t pt-2 text-lg font-bold">
              <span>Total:</span>
              <span>{currencySymbol}{total.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          {cancelledLock ? (
            <span className="mr-auto self-center text-xs text-muted-foreground">{CANCELLED_LOCK_REASON}</span>
          ) : null}
          <Button variant="outline" onClick={handleCancel}>Cancel</Button>
          <Button onClick={() => { void handleSave(); }} disabled={cancelledLock}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Default tax (web-extra 41 — the header's tax defaults editor) ─────── */

function DefaultTaxDialog({ open, onOpenChange, defaultTax, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; defaultTax: Record<string, number> | null; onSaved: (t: Record<string, number>) => void }): React.JSX.Element {
  const [taxes, setTaxes] = useState<{ id: string; name: string; percentage: number }[]>([]);

  useEffect(() => {
    if (open) {
      void Promise.resolve().then(() => {
        if (defaultTax && typeof defaultTax === "object") {
          setTaxes(Object.keys(defaultTax).map((k, i) => ({ id: `t${i}-${k}`, name: k, percentage: defaultTax[k] })));
        } else {
          setTaxes([]);
        }
      });
    }
  }, [open, defaultTax]);

  const addTax = (): void => { setTaxes((prev) => [...prev, { id: `t${Date.now()}`, name: "", percentage: 0 }]); };
  const removeTax = (id: string): void => { setTaxes((prev) => prev.filter((t) => t.id !== id)); };
  const updateTax = (id: string, field: "name" | "percentage", value: string): void => {
    setTaxes((prev) => prev.map((t) => t.id === id ? { ...t, [field]: field === "percentage" ? (parseFloat(value) || 0) : value } : t));
  };

  const handleSave = (): void => {
    const payload: Record<string, number> = {};
    for (const t of taxes) {
      if (t.name && !Number.isNaN(t.percentage)) { payload[t.name] = t.percentage; }
    }
    onSaved(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modify Default Tax</DialogTitle>
          <DialogDescription>
            These taxes will be applied when generating bills if Edit Bill is not used.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {taxes.map((t) => (
            <div key={t.id} className="grid grid-cols-12 items-center gap-2">
              <Input value={t.name} placeholder="Tax name" onChange={(e) => { updateTax(t.id, "name", e.target.value); }} className="col-span-7" />
              <Input value={String(t.percentage)} placeholder="%" type="number" onChange={(e) => { updateTax(t.id, "percentage", e.target.value); }} className="col-span-3" />
              <Button variant="ghost" size="icon" onClick={() => { removeTax(t.id); }} className="col-span-2"><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" onClick={addTax}>Add Tax</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
