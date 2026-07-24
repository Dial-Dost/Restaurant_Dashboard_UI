"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreHorizontal, PlusCircle, Clock, Printer, Trash2, X, ChevronUp, ChevronDown, Flame, ChefHat, CheckCircle2, MonitorSmartphone, Megaphone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Image from 'next/image';
import {
  getMenuItems,
  getOrders,
  requestBackend,
  addOrder,
  deleteOrder,
  occupyTable,
  getMonthlyApcInsight,
  createBill,
  getTables,
  getOutletDefaultTax,
  setOutletDefaultTax,
  replaceBill,
  confirmBillPaymentByWaiter,
  approveBillPaymentByAdmin,
  closeBillByOrder,
  getDiscountRequests,
  decideDiscountRequest,
  reopenBill,
  getBillForTable,
  fireOrderItems,
  barkOrder,
  getKdsExpo,
  getKitchenSections,
  // addAuditLogEntry,
  type MonthlyApcInsight,
  type PaymentMethod,
  type PaymentSplit,
  type DiscountRequest,
  type ExpoTable,
} from "@/lib/db";
// Removed DnD kit - using simple arrow controls instead
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import type { MenuItem } from "../menu/data";
import { BillActions } from "./bill-actions";


interface OrderItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
  note?: string | null;
  // KOT station routing (enriched from the menu by the backend).
  station?: string | null;
  // Course hold-and-fire: held items wait (no prep ageing) until fired.
  course_hold?: boolean;
  fired_at?: string | null;
}

// Per-item prep timer as stored in Orders.timing (mirrors the backend shape).
interface OrderTimer {
  started_at: string | null;
  ended_at: string | null;
  paused: boolean;
  pause_started_at: string | null;
  paused_ms: number;
}

interface OrderTiming {
  ordered_at?: string;
  order?: OrderTimer;
  items?: Record<string, OrderTimer>;
}

export type OrderStatus =
  | "Preparing"
  | "Served"
  | "Bill Verification"
  | "Payment Pending Approval"
  | "Paid"
  | "Closed"
  | "Cancelled";

interface Tax {
  id: string;
  name: string;
  percentage: number;
}

export interface Order {
  id: string;
  table: string;
  customer: string;
  // Order channel: dine_in (default) / takeaway / delivery / swiggy / zomato.
  order_type?: string | null;
  taken_by_employee_id?: string | null;
  taken_by_employee_name?: string | null;
  taken_by_employee_role?: string | null;
  items: OrderItem[];
  // flattened items for backward compatibility and printing
  items_flattened?: OrderItem[];
  // split items as tuples, e.g. [['Served', [...]], ['Preparing', [...]]]
  items_split?: [string, OrderItem[]][];
  subtotal: number;
  serviceChargePercentage?: number;
  taxes?: Tax[];
  applyServiceCharge: boolean;
  total: number;
  status: OrderStatus;
  payment_method?: PaymentMethod | null;
  payment_proof_screenshot_url?: string | null;
  payment_waiter_confirmed_at?: string | null;
  payment_waiter_confirmed_by?: string | null;
  payment_admin_approved_at?: string | null;
  payment_admin_approved_by?: string | null;
  bill_closed_at?: string | null;
  bill_closed_by?: string | null;
  bill_id?: string | null;
  timing?: OrderTiming | null;
  // "Barked" step: when the expo announced the order to the kitchen. Null =
  // awaiting bark (greyed, no running timers); missing (old backend) = barked.
  barked_at?: string | null;
}

// Un-barked orders sit greyed with idle timers until the expo barks them.
const isOrderBarked = (o: Order): boolean => (o.barked_at === undefined ? true : o.barked_at !== null);

// Cancelled is a TERMINAL state: no control on any surface may modify the order
// (status, bark, fire, serve, hold, delete). The one sanctioned reversal is an
// undo from the Audit Log — the server refuses everything else anyway.
const isOrderCancelled = (o: Order): boolean => o.status === "Cancelled";
const CANCELLED_LOCK_REASON = "Cancelled orders are final — reverse from the Audit Log";

const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = [
  "Swiggy",
  "Dine Out",
  "Zomato Pay",
  "Eazydiner",
  "Cash",
  "Upi",
  "Card",
  "Online Transfer",
];

const PROOF_REQUIRED_METHODS = new Set<PaymentMethod>(["Swiggy", "Zomato Pay"]);
const MAX_PROOF_UPLOAD_BYTES = 400 * 1024;

const normalizeProofPreviewUrl = (value?: string | null): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) {return null;}
  if (/^https?:\/\//i.test(raw)) {return raw;}
  if (/^data:image\//i.test(raw)) {return raw;}
  return null;
};

const getDataUrlSizeBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
};

const compressProofImage = async (file: File): Promise<string | null> => {
  if (!file.type.startsWith("image/")) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = document.createElement('img');
      img.onload = () => { resolve(img); };
      img.onerror = () => { reject(new Error("Unable to load image")); };
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    let width = image.naturalWidth;
    let height = image.naturalHeight;
    const maxDimension = 1600;
    if (width > maxDimension || height > maxDimension) {
      const scale = Math.min(maxDimension / width, maxDimension / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const qualities = [0.82, 0.72, 0.62, 0.52, 0.45, 0.38];
    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (getDataUrlSizeBytes(dataUrl) <= MAX_PROOF_UPLOAD_BYTES) {
        return dataUrl;
      }
    }

    return canvas.toDataURL("image/jpeg", 0.35);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const pickPaymentProofScreenshot = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      void compressProofImage(file)
        .then((dataUrl) => { resolve(dataUrl); })
        .catch(() => { resolve(null); });
    };

    input.click();
  });
};

const calculateServiceCharge = (subtotal: number, percentage?: number, apply?: boolean) => {
  if (!apply || !percentage) {return 0;}
  return subtotal * (percentage / 100);
}

const calculateTaxes = (subtotal: number, taxes?: Tax[]) => {
  if (!taxes) {return [];}
  return taxes.map(tax => ({
    ...tax,
    amount: subtotal * (tax.percentage / 100)
  }));
}

const calculateTotal = (order: Omit<Order, 'total'>) => {
    const serviceCharge = calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge);
    const totalTaxAmount = calculateTaxes(order.subtotal, order.taxes).reduce((acc, tax) => acc + tax.amount, 0);
    return order.subtotal + serviceCharge + totalTaxAmount;
}

const deriveDefaultsForCharges = (defaultTax: Record<string, number> | null): {
  serviceChargePercentage?: number;
  applyServiceCharge: boolean;
  taxes: Tax[];
} => {
  if (!defaultTax || typeof defaultTax !== "object") {
    return { applyServiceCharge: false, taxes: [] };
  }

  const taxes: Tax[] = [];
  let serviceChargePercentage: number | undefined;
  let applyServiceCharge = false;

  for (const [name, rawValue] of Object.entries(defaultTax)) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {continue;}

    if (/service ?charge/i.test(name) || /service ?charges/i.test(name)) {
      serviceChargePercentage = value;
      applyServiceCharge = true;
      continue;
    }

    taxes.push({ id: `d-${name}`, name, percentage: value });
  }

  return { serviceChargePercentage, applyServiceCharge, taxes };
};

const formatOrderedAt = (isoOrString?: string) => {
  if (!isoOrString) {return "";}
  const d = new Date(isoOrString);
  if (Number.isNaN(d.getTime())) {return String(isoOrString);}
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

const dedupeOrdersById = (items: Order[]) => {
  const seen = new Map<string, Order>();
  for (const item of items) {
    seen.set(item.id, item);
  }
  return Array.from(seen.values());
};

const PRINT_BILL_STORAGE_PREFIX = "restaurant-dashboard:print-order:";

const createPrintBillStorageKey = () => `${PRINT_BILL_STORAGE_PREFIX}${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

const storePrintBillPayload = (order: Order) => {
  const storageKey = createPrintBillStorageKey();
  localStorage.setItem(storageKey, JSON.stringify(order));
  return storageKey;
};

// Entry point: a locked, full-screen kitchen display when the URL asks for one
// (?station=<Section>&kiosk=1), otherwise the normal Orders dashboard. Keeping
// this as a thin wrapper means the full dashboard tree only ever mounts in the
// non-kiosk case, so the existing page stays byte-for-byte unchanged.
export default function OrdersPage() {
  const searchParams = useSearchParams();
  const station = searchParams.get("station")?.trim() ?? "";
  const kiosk = (searchParams.get("kiosk")?.trim() ?? "").toLowerCase();
  const kioskMode = station.length > 0 && (kiosk === "1" || kiosk === "true" || kiosk === "yes");
  if (kioskMode) {
    return <KitchenKioskDisplay station={station} />;
  }
  return <OrdersDashboard />;
}

function OrdersDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currencySymbol } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager") => {
    if (!user) {return false;}
    if (user.role === role) {return true;}
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false;
  };
  const isAdmin = hasRole("admin");
  const isWaiterOnly = hasRole("waiter") && !isAdmin;

  const showRoleRequiredToast = (requiredRole: string) => {
    toast({
      title: "Access denied",
      description: `You do not have the required role for this action. Required role: ${requiredRole}.`,
      variant: "destructive",
    });
  };

  const runAdminAction = (action: () => void) => {
    if (!isAdmin) {
      showRoleRequiredToast("admin");
      return;
    }
    action();
  };

  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<{ id: number; name: string; capacity: number; qr_token?: string | null }[]>([]);
  const [monthlyApcInsight, setMonthlyApcInsight] = useState<MonthlyApcInsight | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [defaultTax, setDefaultTax] = useState<Record<string, number> | null>(null);
  const [isDefaultTaxDialogOpen, setIsDefaultTaxDialogOpen] = useState(false);
  const [isProofPreviewOpen, setIsProofPreviewOpen] = useState(false);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  // Pending staff discount requests (admin approval queue).
  const [discountRequests, setDiscountRequests] = useState<DiscountRequest[]>([]);
  // Split-tender dialog: the order being settled + its bill total + the rows.
  const [splitPayOrder, setSplitPayOrder] = useState<Order | null>(null);
  const [splitPayTotal, setSplitPayTotal] = useState<number | null>(null);
  const [splitRows, setSplitRows] = useState<{ method: string; amount: string }[]>([]);
  const [splitBusy, setSplitBusy] = useState(false);
  const selectedTableName = searchParams.get("table")?.trim() ?? "";
  // Deep-link a kitchen display to one section (?station=Tandoor) so a physical
  // kitchen screen can be locked to its own section.
  const stationParam = searchParams.get("station")?.trim() ?? "";
  // Managed kitchen sections (from settings) — drive the KDS filter chips even
  // before any ticket carries the station.
  const [kitchenSections, setKitchenSections] = useState<string[]>([]);
  useEffect(() => {
    if (!user) {return;}
    let cancelled = false;
    void getKitchenSections(user.restaurantUsername).then((s) => {
      if (!cancelled) {setKitchenSections(s);}
    });
    return () => { cancelled = true; };
  }, [user]);
  const selectedTable = useMemo(() => {
    if (!selectedTableName) {return null;}
    return tables.find((table) => table.name.toLowerCase() === selectedTableName.toLowerCase()) ?? null;
  }, [selectedTableName, tables]);

  const displayOrders = useMemo(() => dedupeOrdersById(orders), [orders]);

  const orderApcByOrderId = useMemo(() => {
    const map = new Map<string, MonthlyApcInsight["orders"][number]>();
    for (const item of monthlyApcInsight?.orders ?? []) {
      map.set(String(item.order_id), item);
    }
    return map;
  }, [monthlyApcInsight]);

  const tableApcSummaries = useMemo(() => {
    const summaryByTable = new Map<string, { table: string; revenue: number; covers: number; orders: number }>();

    for (const item of monthlyApcInsight?.orders ?? []) {
      const tableName = item.table_name?.trim() || "Unassigned";
      const current = summaryByTable.get(tableName) ?? {
        table: tableName,
        revenue: 0,
        covers: 0,
        orders: 0,
      };

      const covers = Number(item.people_count ?? 1);
      current.revenue += Number(item.total ?? 0);
      current.covers += Number.isFinite(covers) && covers > 0 ? covers : 1;
      current.orders += 1;
      summaryByTable.set(tableName, current);
    }

    return Array.from(summaryByTable.values())
      .map((item) => ({
        ...item,
        apc: item.covers > 0 ? item.revenue / item.covers : 0,
      }))
      .sort((left, right) => right.revenue - left.revenue);
  }, [monthlyApcInsight]);

  useEffect(() => {
    // Only open the Add Order dialog when a table param is present and
    // no highlightOrder parameter is provided (View Order should not open add dialog).
    const highlightParam = searchParams.get('highlightOrder')?.trim() ?? '';
    setIsAddDialogOpen(Boolean(selectedTableName) && !highlightParam);
  }, [selectedTableName, searchParams]);

  useEffect(() => {
    if (!user?.restaurantUsername) {
      return;
    }

    let isActive = true;

    const loadData = async () => {
      try {
        const [ordersData, menuData, apcInsight] = await Promise.all([
          getOrders(user.restaurantUsername),
          getMenuItems(user.restaurantUsername),
          getMonthlyApcInsight(user.restaurantUsername),
        ]);

        if (!isActive) {
          return;
        }

        setOrders(Array.isArray(ordersData) ? dedupeOrdersById(ordersData) : []);
        setMenuItems(Array.isArray(menuData) ? menuData : []);
        setMonthlyApcInsight(apcInsight ?? null);
        try {
          const dt = await getOutletDefaultTax(user.restaurantUsername);
          setDefaultTax(dt ?? null);
        } catch (e) {
          console.warn('failed to load default tax', e);
          setDefaultTax(null);
        }
        // load tables into cache for selector
        try {
          const t = await getTables(user.restaurantUsername);
          setTables(Array.isArray(t) ? t : []);
        } catch (e) {
          console.warn('failed to load tables', e);
          setTables([]);
        }
        // pending discount approvals (admin-only endpoint; harmless empty otherwise)
        if (isAdmin) {
          try {
            const reqs = await getDiscountRequests(user.restaurantUsername);
            if (isActive) {setDiscountRequests(reqs);}
          } catch {
            if (isActive) {setDiscountRequests([]);}
          }
        }
      } catch (error) {
        console.error("Failed to load orders", error);
        if (!isActive) {
          return;
        }
        setOrders([]);
        setMenuItems([]);
        setMonthlyApcInsight(null);
      }
    };

    loadData();

    return () => {
      isActive = false;
    };
  }, [user]);

    // Highlight order if requested via query param
    useEffect(() => {
      const param = searchParams.get('highlightOrder')?.trim() ?? '';
      if (!param) {return;}
      setHighlightedOrderId(param);
      // wait for DOM to render table rows
      setTimeout(() => {
        const el = document.getElementById(`order-row-${param}`);
        if (el) {
          try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
          try { el.focus(); } catch {}
          // remove highlight after a short delay
          setTimeout(() => { setHighlightedOrderId(null); }, 3500);
        }
      }, 250);
    }, [searchParams, displayOrders]);

  // Refresh tables when realtime table events occur
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const detail = e?.detail as { event: string } | undefined;
        if (!detail) {return;}
        if (detail.event === 'table:added' || detail.event === 'table:deleted' || detail.event === 'table:updated') {
          if (user?.restaurantUsername) {getTables(user.restaurantUsername).then(t => { setTables(Array.isArray(t) ? t : []); }).catch(() => {});}
        }
        // Keep the KDS/orders list live when items are fired or bills change.
        if (detail.event === 'order:updated' || detail.event === 'bill:updated') {
          if (user?.restaurantUsername) {getOrders(user.restaurantUsername).then(o => { setOrders(Array.isArray(o) ? dedupeOrdersById(o) : []); }).catch(() => {});}
        }
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('realtime:event', handler as EventListener);
    return () => { window.removeEventListener('realtime:event', handler as EventListener); };
  }, [user]);

  const triggerPrint = (order: Order) => {
    const flattenedItems = (order as any).items_flattened?.length ? (order as any).items_flattened : order.items;
    let calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
    if ((!calculatedTaxes || calculatedTaxes.length === 0) && defaultTax) {
      calculatedTaxes = Object.keys(defaultTax).map((name, i) => ({ id: `d${i}`, name, percentage: Number(defaultTax[name]), amount: order.subtotal * (Number(defaultTax[name]) / 100) }));
    }
    const orderWithCalculatedCharges = {
      ...order,
      items: flattenedItems,
      items_flattened: flattenedItems,
      serviceCharge: calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge),
      calculatedTaxes,
      currencySymbol,
    };
      const storageKey = storePrintBillPayload(orderWithCalculatedCharges);
      const url = `/dashboard/orders/print?orderKey=${encodeURIComponent(storageKey)}`;
    window.open(url, '_blank');
  }
  
  const handleAddOrder = async (newOrderData: { tableId: number; items: { id?: string; name: string; price: number; quantity?: number; note?: string | null; course_hold?: boolean }[]; covers?: number }) => {
    if (!user?.restaurantUsername) {return;}
    const items = newOrderData.items.map(it => ({
      id: it.id ?? `i${Date.now()}${Math.random().toString(36).slice(2,5)}`,
      name: it.name,
      quantity: Math.max(1, Number(it.quantity ?? 1)),
      price: Number(it.price ?? 0),
      orderedAt: new Date().toISOString(),
      note: typeof it.note === "string" && it.note.trim().length > 0 ? it.note.trim() : null,
      ...(it.course_hold ? { course_hold: true } : {}),
    }));
    const subtotal = items.reduce((acc, it) => acc + it.price * it.quantity, 0);
    const defaults = deriveDefaultsForCharges(defaultTax);
    const baseOrder: Omit<Order, "total"> = {
      id: (orders.length + 1).toString(),
      table: String(tables.find(t => t.id === newOrderData.tableId)?.name ?? ''),
      customer: "Guest",
      taken_by_employee_id: user.employeeId ?? null,
      taken_by_employee_name:
        user.employeeUsername
        || `${user.emp_Fname ?? ''} ${user.emp_Lname ?? ''}`.trim()
        || user.employeeId
        || null,
      taken_by_employee_role: hasRole("waiter") ? "waiter" : user.role,
      status: "Preparing",
      items,
      subtotal,
      serviceChargePercentage: defaults.serviceChargePercentage,
      taxes: defaults.taxes,
      applyServiceCharge: defaults.applyServiceCharge,
    };
    const newOrder: Order = { ...baseOrder, total: calculateTotal(baseOrder) };
    try {
      // Ensure table is occupied first (backend requires table to be occupied before adding order)
      const tableName = String(tables.find(t => t.id === newOrderData.tableId)?.name ?? '');
      if (tableName) {
        try {
          await occupyTable(user.restaurantUsername, tableName, newOrderData.covers ?? null);
        } catch (e) {
          // ignore occupancy errors — addOrder will fail if necessary
        }
      }

      const resp: any = await addOrder(user.restaurantUsername, newOrder);
      const createdId = resp?.id ?? resp?._id ?? null;

      // Link the table to the created order id for quick access
      if (createdId && tableName) {
        try {
          const occ = await occupyTable(user.restaurantUsername, tableName, null, createdId);
          // sanity check: backend should return linked_order_id
          if (!occ || (occ as any).linked_order_id == null) {
            console.warn('occupyTable did not persist linked_order_id', { tableName, createdId, resp: occ });
          }
        } catch (e) {
          console.error('occupyTable failed to link order', e);
        }
      }

      const [updatedOrders, updatedApcInsight] = await Promise.all([
        getOrders(user.restaurantUsername),
        getMonthlyApcInsight(user.restaurantUsername),
      ]);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
      setMonthlyApcInsight(updatedApcInsight ?? null);
      setIsAddDialogOpen(false);
    } catch (error) {
      console.error("Failed to add order", error);
    }
  }

  const handleEditOrder = (editedOrderData: Omit<Order, 'total'>) => {
    const total = calculateTotal(editedOrderData);
    const updatedOrder: Order = { ...editedOrderData, total };
    setOrders(orders.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    setIsEditDialogOpen(false);
    setSelectedOrder(null);
  }

  const handleAddItemToOrder = (orderId: string, itemName: string, itemPrice: number) => {
    setOrders((prev) => {
      const updated = prev.map(order => {
        if(order.id === orderId) {
          // add to Preparing section and flattened list
          const newItem: OrderItem = {
            id: `i${Date.now()}`,
            name: itemName,
            quantity: 1,
            price: itemPrice,
            orderedAt: new Date().toISOString(),
          };

          // merged flattened list
          const flattened: OrderItem[] = Array.isArray((order as any).items_flattened) ? [...(order as any).items_flattened as OrderItem[]] : [...order.items];
          // if same item name exists in flattened, increment quantity, else push
          const existingFlat = flattened.find(it => it.name.toLowerCase() === itemName.toLowerCase());
          if (existingFlat) {
            existingFlat.quantity = existingFlat.quantity + 1;
          } else {
            flattened.push(newItem);
          }

          // update split: push into Preparing tuple
          const split = Array.isArray((order as any).items_split)
            ? (JSON.parse(JSON.stringify((order as any).items_split)) as unknown as [string, OrderItem[]][])
            : ([['Served', []], ['Preparing', []]] as [string, OrderItem[]][]);
          const preparingTuple = split.find(s => s[0] === 'Preparing');
          if (preparingTuple) {
            preparingTuple[1].push(newItem);
          } else {
            split.push(['Preparing', [newItem]] as [string, OrderItem[]]);
          }

          const newSubtotal = flattened.reduce((acc: number, it: OrderItem) => acc + it.price * it.quantity, 0);
          const newTotal = calculateTotal({ ...order, items: flattened, subtotal: newSubtotal });
          return { ...order, items: flattened, items_flattened: flattened, items_split: split, subtotal: newSubtotal, total: newTotal, status: 'Preparing' as OrderStatus };
        }
        return order;
      });

      const newSelected = selectedOrder ? updated.find(o => o.id === selectedOrder.id) ?? null : null;
      if (selectedOrder && newSelected) {setSelectedOrder(newSelected);}
      return updated;
    });
  }

  const handleRemoveItemFromOrder = (orderId: string, itemId: string) => {
    setOrders((prev) => {
      const updated = prev.map(order => {
        if(order.id === orderId) {
          // remove from flattened and from split tuples
          const flattened: OrderItem[] = Array.isArray((order as any).items_flattened) ? ((order as any).items_flattened as OrderItem[]).filter((it) => it.id !== itemId) : order.items.filter(item => item.id !== itemId);

          const split = Array.isArray((order as any).items_split)
            ? (JSON.parse(JSON.stringify((order as any).items_split)) as unknown as [string, OrderItem[]][])
            : ([['Served', []], ['Preparing', []]] as [string, OrderItem[]][]);
          for (const tup of split) {
            tup[1] = tup[1].filter((it) => it.id !== itemId);
          }

          const newSubtotal = flattened.reduce((acc: number, item: OrderItem) => acc + item.price * item.quantity, 0);
          const newTotal = calculateTotal({ ...order, items: flattened, subtotal: newSubtotal });
          const hasPreparing = (split.find(s => s[0] === 'Preparing')?.[1]?.length ?? 0) > 0;
          const newStatus: OrderStatus = hasPreparing ? 'Preparing' : (flattened.length > 0 ? 'Served' : order.status);
          return { ...order, items: flattened, items_flattened: flattened, items_split: split, subtotal: newSubtotal, total: newTotal, status: newStatus };
        }
        return order;
      });

      const newSelected = selectedOrder ? updated.find(o => o.id === selectedOrder.id) ?? null : null;
      if (selectedOrder && newSelected) {setSelectedOrder(newSelected);}
      return updated;
    });
  }

  const handleDeleteOrder = async (orderId: string) => {
    if (!user?.restaurantUsername) {return;}
    try {
      await deleteOrder(user.restaurantUsername, orderId);
        const [updatedOrders, updatedApcInsight] = await Promise.all([
          getOrders(user.restaurantUsername),
          getMonthlyApcInsight(user.restaurantUsername),
        ]);
        setOrders(Array.isArray(updatedOrders) ? updatedOrders : []);
        setMonthlyApcInsight(updatedApcInsight ?? null);
      toast({ title: "Order deleted", description: "The order has been successfully deleted." });
    } catch (error) {
      console.error("Failed to delete order", error);
      // Surface the server's refusal verbatim (e.g. the cancelled-order guard).
      toast({ title: "Unable to delete order", description: String((error as Error)?.message ?? error), variant: "destructive" });
    }
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "Preparing":
        return "secondary";
      case "Served":
        return "default";
      case "Bill Verification":
        return "default";
      case "Payment Pending Approval":
        return "secondary";
      case "Paid":
        return "outline";
      case "Closed":
        return "outline";
      case "Cancelled":
        return "destructive";
      default:
        return "outline";
    }
  };
  
  const handleRowClick = (order: Order) => {
    setSelectedOrder(order);
    // open view-only dialog when clicking the row
    setIsViewOpen(true);
  }

  const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
    // optimistic UI update
    setOrders(orders.map(order => order.id === orderId ? { ...order, status } : order));

    if (!user?.restaurantUsername) {return;}

    const current = orders.find(o => o.id === orderId);
    if (!current) {return;}

    const updatedOrder: Order = { ...current, status };

    try {
      // persist via AddOrder upsert endpoint
      await addOrder(user.restaurantUsername, updatedOrder);
      const refreshed = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(refreshed) ? refreshed : []);
    } catch (err) {
      console.error('failed to persist order status', err);
      // Surface the server's refusal verbatim (e.g. "A cancelled order cannot be modified").
      toast({ title: "Unable to update status", description: String((err as Error)?.message ?? err), variant: "destructive" });
      // on error, revert optimistic update by reloading
      try {
        const refreshed = await getOrders(user.restaurantUsername);
        setOrders(Array.isArray(refreshed) ? refreshed : []);
      } catch (e) {
        // ignore
      }
    }
  };

  // Bark the order to the kitchen: advances the visible stage and starts the
  // order/dish prep timers (they stay idle until the bark).
  const handleBarkOrder = async (order: Order) => {
    if (!user?.restaurantUsername) {return;}
    try {
      await barkOrder(user.restaurantUsername, order.id);
      toast({ title: "Order barked", description: `Table ${order.table || "—"} announced to the kitchen — timers started.` });
      await refreshOrders();
    } catch (err) {
      toast({ title: "Unable to bark order", description: String((err as Error)?.message ?? err), variant: "destructive" });
    }
  };

  const handleSetBillVerification = async (order: Order) => {
    if (!user?.restaurantUsername) {return;}
    const confirmed = window.confirm(
      'Confirm move to Bill Verification? This action cannot be undone and you will not be able to revert to Preparing or Served.',
    );
    if (!confirmed) {return;}

    try {
      // decide which taxes to apply: prefer order.taxes if present, otherwise use defaultTax
      let taxesToApply: Tax[] | undefined = order.taxes?.length ? order.taxes : undefined;
      if ((!taxesToApply || taxesToApply.length === 0) && defaultTax) {
        taxesToApply = Object.keys(defaultTax).map((name, i) => ({ id: `d${i}` , name, percentage: Number(defaultTax[name]) }));
      }

      const serviceCharge = calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge);
      const taxAmount = (taxesToApply ?? []).reduce((acc, t) => acc + order.subtotal * (t.percentage / 100), 0);
      const totalAmt = Math.max(0, order.subtotal + serviceCharge + taxAmount);

      const tax_breakdown = (taxesToApply ?? []).map(t => ({ name: t.name, percentage: t.percentage, amount: Number((order.subtotal * (t.percentage/100)).toFixed(2)) }));

      // create bill in backend with status 1 and total including default taxes when applicable
      const billResp = await createBill(user.restaurantUsername, {
        order_id: order.id,
        total_amt: totalAmt,
        emp_id: user.employeeId ?? undefined,
        status: 1,
        tax_breakdown,
      });
      // update order status via upsert
      const updatedOrder: Order = { ...order, status: 'Bill Verification' };
      await addOrder(user.restaurantUsername, updatedOrder);
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
    } catch (err) {
      console.error('failed to set bill verification', err);
      // Surface the server's refusal verbatim (e.g. the cancelled-order guard).
      toast({ title: "Unable to create bill", description: String((err as Error)?.message ?? err), variant: "destructive" });
    }
  };

  const handleReplaceBill = async (order: Order, replacement: { items: OrderItem[]; taxes: { id?: string; name: string; percentage: number }[]; serviceChargePercentage?: number | undefined; applyServiceCharge?: boolean; reason: string; }) => {
    if (!user?.restaurantUsername) {return;}
    if (!replacement.reason?.trim()) {
      alert('Reason is required');
      return;
    }
    const confirmed = window.confirm('This will update the existing bill and order in-place. Continue?');
    if (!confirmed) {return;}

    try {
      const subtotal = replacement.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
      const serviceChargeAmount = replacement.applyServiceCharge && replacement.serviceChargePercentage ? subtotal * (replacement.serviceChargePercentage / 100) : 0;
      const tax_breakdown = (replacement.taxes || []).map((t) => ({ name: t.name, percentage: t.percentage, amount: Number(((subtotal) * (t.percentage/100)).toFixed(2)) }));
      const totalAmt = Math.max(0, subtotal + serviceChargeAmount + tax_breakdown.reduce((acc, t) => acc + (Number(t.amount) || 0), 0));

      // minimal payload: backend will keep existing emp_id/status if not provided
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

      const result = await replaceBill(user.restaurantUsername, payload);
      if (!result) {throw new Error('Replace failed');}

      // update the existing order in local state instead of creating a new one
      setOrders((prev) => {
        return prev.map(o => {
          if (o.id !== order.id) {return o;}
          const updated: Order = {
            ...o,
            items: replacement.items.map(it => ({ ...it })),
            subtotal,
            serviceChargePercentage: payload.new_order.serviceChargePercentage,
            taxes: payload.new_order.taxes as any,
            applyServiceCharge: payload.new_order.applyServiceCharge ?? false,
            total: Number((subtotal + serviceChargeAmount + tax_breakdown.reduce((acc, t) => acc + (Number(t.amount) || 0), 0)).toFixed(2)),
            status: 'Bill Verification',
          };
          return updated;
        });
      });

      // update APC insight if present
      setMonthlyApcInsight((prev) => {
        if (!prev) {return prev;}
        const ordersCopy = (prev.orders || []).map(a => {
          if (a.order_id !== order.id) {return a;}
          return { ...a, total: Number(totalAmt) };
        });
        return { ...prev, orders: ordersCopy };
      });

      setIsEditDialogOpen(false);
      setSelectedOrder(null);
    } catch (err: any) {
      console.error('replace bill failed', err);
      alert('Failed to replace bill: ' + String(err?.message ?? err));
    }
  };

  // What the guest actually pays for this table: the bill's grand_total
  // (discount + service charge + taxes), NOT total_amt — that field is the
  // PRE-TAX running sum while the bill is open. Display only; the settle
  // requests carry no amount. Returns null when the bill can't be read, in
  // which case the caller simply omits the figure.
  const fetchTablePayable = async (tableName: string): Promise<number | null> => {
    if (!user?.restaurantUsername) {return null;}
    try {
      const bill = await getBillForTable(user.restaurantUsername, tableName);
      const amount = Number(bill?.grand_total ?? bill?.total_amt);
      return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
    } catch {
      return null;
    }
  };

  const payableLine = (payable: number | null) =>
    payable != null ? `Amount payable: ${currencySymbol}${payable.toFixed(2)} (incl. taxes & charges)\n\n` : "";

  const handleWaiterConfirmPayment = async (order: Order, paymentMethod: PaymentMethod) => {
    if (!user?.restaurantUsername || !user.employeeId) {return;}
    if (!(hasRole("waiter") || hasRole("admin"))) {
      showRoleRequiredToast("waiter or admin");
      return;
    }

    let proofScreenshotUrl: string | null = null;
    if (PROOF_REQUIRED_METHODS.has(paymentMethod)) {
      alert(`Please upload the payment screenshot for ${paymentMethod}.`);
      proofScreenshotUrl = await pickPaymentProofScreenshot();
      if (!proofScreenshotUrl) {
        alert(`Payment screenshot is required for ${paymentMethod}.`);
        return;
      }
    }

    const payable = await fetchTablePayable(order.table);
    const confirmed = window.confirm(
      `${payableLine(payable)}Confirm payment by ${paymentMethod}? This sends the bill for admin approval.`,
    );
    if (!confirmed) {return;}

    try {
      await confirmBillPaymentByWaiter(
        user.restaurantUsername,
        user.employeeId,
        order.id,
        paymentMethod,
        proofScreenshotUrl,
      );
      const actorName = user.employeeUsername
        || `${user.emp_Fname ?? ''} ${user.emp_Lname ?? ''}`.trim()
        || user.employeeId
        || 'System';
      // await addAuditLogEntry(user.restaurantUsername, {
      //   employee: actorName,
      //   employeeId: user.employeeId,
      //   action: 'Bill Payment Confirmed',
      //   details: `Waiter confirmed payment for order ${order.id} via ${paymentMethod}`,
      // });
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
      alert('Payment confirmation submitted. Awaiting admin approval.');
    } catch (err: any) {
      console.error('failed to confirm payment', err);
      alert(String(err?.message ?? 'Unable to confirm payment.'));
    }
  };

  const handleAdminApprovePayment = async (order: Order) => {
    if (!user?.restaurantUsername || !user.employeeId) {return;}
    if (!hasRole('admin')) {
      showRoleRequiredToast('admin');
      return;
    }

    if (PROOF_REQUIRED_METHODS.has(order.payment_method ?? "Cash")) {
      const proofUrl = normalizeProofPreviewUrl(order.payment_proof_screenshot_url);
      if (!proofUrl) {
        alert("Payment screenshot is missing for this order.");
        return;
      }
    }

    const payable = await fetchTablePayable(order.table);
    const confirmed = window.confirm(`${payableLine(payable)}Approve this waiter-confirmed payment?`);
    if (!confirmed) {return;}

    try {
      await approveBillPaymentByAdmin(user.restaurantUsername, user.employeeId, order.id);
      const actorName = user.employeeUsername
        || `${user.emp_Fname ?? ''} ${user.emp_Lname ?? ''}`.trim()
        || user.employeeId
        || 'System';
      // await addAuditLogEntry(user.restaurantUsername, {
      //   employee: actorName,
      //   employeeId: user.employeeId,
      //   action: 'Bill Payment Approved',
      //   details: `Admin approved payment for order ${order.id}`,
      // });
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
    } catch (err: any) {
      console.error('failed to approve payment', err);
      alert(String(err?.message ?? 'Unable to approve payment.'));
    }
  };

  const handleCloseBill = async (order: Order) => {
    if (!user?.restaurantUsername || !user.employeeId) {return;}
    if (!hasRole('admin')) {
      showRoleRequiredToast('admin');
      return;
    }
    const confirmed = window.confirm('Close this bill? This finalizes the order.');
    if (!confirmed) {return;}

    try {
      await closeBillByOrder(user.restaurantUsername, user.employeeId, order.id);
      const actorName = user.employeeUsername
        || `${user.emp_Fname ?? ''} ${user.emp_Lname ?? ''}`.trim()
        || user.employeeId
        || 'System';
      // await addAuditLogEntry(user.restaurantUsername, {
      //   employee: actorName,
      //   employeeId: user.employeeId,
      //   action: 'Bill Closed',
      //   details: `Admin closed bill for order ${order.id}`,
      // });
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
    } catch (err: any) {
      console.error('failed to close bill', err);
      alert(String(err?.message ?? 'Unable to close bill.'));
    }
  };

  const refreshDiscountRequests = async () => {
    if (!user?.restaurantUsername || !isAdmin) {return;}
    try { setDiscountRequests(await getDiscountRequests(user.restaurantUsername)); } catch { /* keep current */ }
  };

  const handleDecideDiscount = async (request: DiscountRequest, approve: boolean) => {
    if (!user?.restaurantUsername) {return;}
    try {
      await decideDiscountRequest(user.restaurantUsername, request.id, approve);
      toast({
        title: approve ? "Discount approved" : "Discount rejected",
        description: `Table ${request.table_name ?? "?"} · ${request.discount_value}${request.discount_type === "percent" ? "%" : ""} (≈${currencySymbol}${request.amount.toFixed(2)})`,
      });
      await Promise.all([refreshDiscountRequests(), refreshOrders()]);
    } catch (err: unknown) {
      toast({ title: "Failed", description: String((err as Error)?.message ?? err), variant: "destructive" });
      await refreshDiscountRequests();
    }
  };

  const handleReopenBill = async (order: Order) => {
    if (!user?.restaurantUsername) {return;}
    if (!hasRole('admin')) {
      showRoleRequiredToast('admin');
      return;
    }
    if (!order.bill_id) {
      toast({ title: "No bill found for this order", variant: "destructive" });
      return;
    }
    const confirmed = window.confirm('Re-open this closed bill? The table goes back in service and the payment must be approved again.');
    if (!confirmed) {return;}
    try {
      const r = await reopenBill(user.restaurantUsername, order.bill_id);
      toast({ title: "Bill re-opened", description: `${r.restored_orders ?? 0} order(s) restored — approve the payment again to settle.` });
      await refreshOrders();
    } catch (err: unknown) {
      toast({ title: "Unable to re-open bill", description: String((err as Error)?.message ?? err), variant: "destructive" });
    }
  };

  // --- Split tender (multiple payment modes on one bill) --------------------
  const openSplitPayment = async (order: Order) => {
    if (!user?.restaurantUsername) {return;}
    if (!(hasRole("waiter") || hasRole("admin"))) {
      showRoleRequiredToast("waiter or admin");
      return;
    }
    // The bill total is the TABLE's consolidated grand total (discount + service
    // charge + taxes), not the single order's total — fetch it for prefill.
    let total: number | null = null;
    try {
      const bill = await getBillForTable(user.restaurantUsername, order.table);
      const g = Number(bill?.grand_total);
      if (Number.isFinite(g) && g > 0) {total = Math.round(g * 100) / 100;}
    } catch { /* leave null — user fills amounts manually */ }
    setSplitPayTotal(total);
    setSplitRows([
      { method: "Cash", amount: total != null ? total.toFixed(2) : "" },
      { method: "Card", amount: "0.00" },
    ]);
    setSplitPayOrder(order);
  };

  const updateSplitRow = (idx: number, patch: Partial<{ method: string; amount: string }>) => {
    setSplitRows((rows) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : { ...r }));
      // Auto-balance: the LAST row absorbs the remainder of the bill total.
      if (splitPayTotal != null && patch.amount !== undefined && idx < next.length - 1) {
        const sumOthers = next.slice(0, -1).reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const rest = Math.round((splitPayTotal - sumOthers) * 100) / 100;
        next[next.length - 1] = { ...next[next.length - 1], amount: rest > 0 ? rest.toFixed(2) : "0.00" };
      }
      return next;
    });
  };

  const submitSplitPayment = async () => {
    if (!user?.restaurantUsername || !user.employeeId || !splitPayOrder) {return;}
    const splits: PaymentSplit[] = splitRows
      .map((r) => ({ method: r.method, amount: Math.round((Number(r.amount) || 0) * 100) / 100 }))
      .filter((r) => r.amount > 0);
    if (splits.length < 2) {
      toast({ title: "A split payment needs at least two parts", variant: "destructive" });
      return;
    }
    setSplitBusy(true);
    try {
      await confirmBillPaymentByWaiter(user.restaurantUsername, user.employeeId, splitPayOrder.id, "Split", null, splits);
      toast({ title: "Split payment recorded", description: "Awaiting admin approval." });
      setSplitPayOrder(null);
      await refreshOrders();
    } catch (err: unknown) {
      toast({ title: "Unable to record split payment", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setSplitBusy(false);
    }
  };

  const refreshOrders = async () => {
    if (!user?.restaurantUsername) {return;}
    try {
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
      if (selectedOrder) {
        const updatedSelected = Array.isArray(updatedOrders) ? updatedOrders.find(o => o.id === selectedOrder.id) ?? null : null;
        if (updatedSelected) {setSelectedOrder(updatedSelected);}
      }
      if (isAdmin) {
        try { setDiscountRequests(await getDiscountRequests(user.restaurantUsername)); } catch { /* keep current */ }
      }
    } catch (err) {
      console.error('refreshOrders failed', err);
    }
  };

  const getApcBadgeClass = (zone?: "red" | "yellow" | "green") => {
    if (zone === "green") {return "bg-green-100 text-green-800 border-green-200";}
    if (zone === "yellow") {return "bg-yellow-100 text-yellow-900 border-yellow-200";}
    if (zone === "red") {return "bg-red-100 text-red-800 border-red-200";}
    return "";
  };


  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Reporting only. Start table-side ordering from the Tables view.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { router.push("/dashboard/tables"); }}>Open Tables</Button>
          {isAdmin ? (
            <Button variant="outline" onClick={() => { setIsDefaultTaxDialogOpen(true); }}>Modify Default Tax</Button>
          ) : null}
        </div>
      </div>
      {isAdmin && discountRequests.length > 0 ? (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Discount approvals</CardTitle>
            <CardDescription>
              Staff discounts above your approval threshold wait here until a manager decides.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {discountRequests.map((request) => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="text-sm">
                  <div className="font-medium">
                    Table {request.table_name ?? "?"} · {request.discount_value}{request.discount_type === "percent" ? "%" : ""} off
                    {" "}(≈{currencySymbol}{request.amount.toFixed(2)})
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Requested by {request.requested_by ?? "unknown"} · {formatOrderedAt(request.created_at)}
                    {request.reason ? ` · “${request.reason}”` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { void handleDecideDiscount(request, false); }}>Reject</Button>
                  <Button size="sm" onClick={() => { void handleDecideDiscount(request, true); }}>Approve</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <KitchenDisplay
        orders={displayOrders}
        restaurantId={user?.restaurantUsername ?? ""}
        onRefresh={refreshOrders}
        managedSections={kitchenSections}
        initialStation={stationParam || undefined}
      />
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>Add New Order</DialogTitle>
            <DialogDescription>
              {selectedTable ? `Taking orders for ${selectedTable.name}. Add items directly below.` : "Choose a table, then add items below."}
            </DialogDescription>
          </DialogHeader>
          <OrderForm
            onSubmit={handleAddOrder}
            menuItems={menuItems}
            tables={tables}
            selectedTableName={selectedTable?.name ?? selectedTableName}
            onClearSelectedTable={() => { router.push("/dashboard/orders"); }}
          />
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader>
          <CardTitle>Table APC Summary</CardTitle>
          <CardDescription>
            Final bill performance by table for the current month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tableApcSummaries.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tableApcSummaries.map((summary) => (
                <Card key={summary.table} className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardDescription>{summary.table}</CardDescription>
                    <CardTitle className="text-xl">{currencySymbol}{summary.apc.toFixed(2)}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    <div>{summary.orders} bill{summary.orders === 1 ? "" : "s"}</div>
                    <div>{summary.covers} covers</div>
                    <div>{currencySymbol}{summary.revenue.toFixed(2)} revenue</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No table APC data available yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Current Orders</CardTitle>
          <CardDescription>
            A list of all active orders in the restaurant. Click a row to see details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isWaiterOnly ? (
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardDescription>Monthly APC</CardDescription>
                <CardTitle className="text-xl">
                  {monthlyApcInsight ? `${currencySymbol}${monthlyApcInsight.monthly_apc.toFixed(2)}` : "N/A"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardDescription>Total Revenue</CardDescription>
                <CardTitle className="text-xl">
                  {monthlyApcInsight ? `${currencySymbol}${monthlyApcInsight.total_revenue.toFixed(2)}` : "N/A"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardDescription>Total Covers</CardDescription>
                <CardTitle className="text-xl">
                  {monthlyApcInsight ? monthlyApcInsight.total_covers : "N/A"}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead>Order Details</TableHead>
                <TableHead className="hidden md:table-cell text-right">Total</TableHead>
                <TableHead className="hidden md:table-cell">APC Zone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayOrders.map((order) => {
                const apcInsight = orderApcByOrderId.get(String(order.id));
                return (
                <TableRow
                  key={order.id}
                  id={`order-row-${order.id}`}
                  tabIndex={0}
                  onClick={() => { handleRowClick(order); }}
                  className={`cursor-pointer ${highlightedOrderId === String(order.id) ? 'ring-2 ring-primary/60' : ''}`}
                >
                  <TableCell className="font-medium">
                    <div>{order.table}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{(order as any).items_flattened?.length ? (order as any).items_flattened.map((i: any) => `${i.quantity}x ${i.name}${i.note ? ` (${i.note})` : ""}`).join(', ') : order.items.map(i => `${i.quantity}x ${i.name}${i.note ? ` (${i.note})` : ""}`).join(', ')}</div>
                    {order.payment_method ? (
                      <div className="text-xs text-muted-foreground">
                        Payment Method: {order.payment_method}
                      </div>
                    ) : null}
                    {order.payment_proof_screenshot_url ? (
                      <button
                        type="button"
                        className="text-xs text-primary underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          const proofUrl = normalizeProofPreviewUrl(order.payment_proof_screenshot_url);
                          if (!proofUrl) {
                            alert("Payment screenshot URL is invalid.");
                            return;
                          }
                          setProofPreviewUrl(proofUrl);
                          setIsProofPreviewOpen(true);
                        }}
                      >
                        View payment screenshot
                      </button>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">{currencySymbol}{order.total.toFixed(2)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {apcInsight ? (
                      <Badge variant="outline" className={getApcBadgeClass(apcInsight.zone)}>
                        {apcInsight.zone.toUpperCase()} ({currencySymbol}{apcInsight.target_total.toFixed(2)} target)
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No APC data</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {order.status === "Preparing" && !isOrderBarked(order) ? (
                      <Badge variant="outline" className="border-dashed text-muted-foreground">Not barked</Badge>
                    ) : (
                      <Badge variant={getStatusVariant(order.status)}>
                        {order.status}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {isWaiterOnly ? null : (
                    <div className="flex items-center justify-end gap-1" onClick={(e) => { e.stopPropagation(); }}>
                    {order.status === "Preparing" && !isOrderBarked(order) && !isOrderCancelled(order) ? (
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="Bark this order to the kitchen — starts the prep timers"
                        onClick={() => { void handleBarkOrder(order); }}
                      >
                        <Megaphone className="mr-1 h-3.5 w-3.5" /> Bark
                      </Button>
                    ) : null}
                    {order.table && order.status !== 'Cancelled' && (
                      <BillActions
                        restaurantId={user?.restaurantUsername ?? ''}
                        tableName={order.table}
                        isAdmin={isAdmin}
                        onChanged={() => { void refreshOrders(); }}
                      />
                    )}
                    {(() => {
                      // Customer-facing display: full-screen live bill for this table
                      // (public page — the signed table token is the auth).
                      const tbl = tables.find((t) => t.name.toLowerCase() === order.table?.toLowerCase());
                      if (!tbl?.qr_token || !user?.restaurantUsername) {return null;}
                      const cfdUrl = `/cfd/${encodeURIComponent(user.restaurantUsername)}?t=${encodeURIComponent(tbl.qr_token)}`;
                      return (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Open customer display"
                          onClick={() => window.open(cfdUrl, '_blank')}
                        >
                          <MonitorSmartphone className="h-4 w-4" />
                          <span className="sr-only">Open customer display</span>
                        </Button>
                      );
                    })()}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); }}>
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => { e.stopPropagation(); }}>
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        {isOrderCancelled(order) ? (
                          <div className="px-2 pb-1.5 text-xs text-muted-foreground max-w-[15rem]">{CANCELLED_LOCK_REASON}</div>
                        ) : null}
                        <DropdownMenuItem
                          disabled={
                            order.status === 'Bill Verification'
                            || order.status === 'Payment Pending Approval'
                            || order.status === 'Paid'
                            || order.status === 'Closed'
                            || order.status === 'Cancelled'
                          }
                          onClick={() => {
                            runAdminAction(() => {
                              setSelectedOrder(order);
                              setIsDetailsOpen(true);
                            });
                          }}
                        >
                          Update Order
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={order.status !== 'Bill Verification'}
                          onClick={() => {
                            runAdminAction(() => {
                              setSelectedOrder(order);
                              setIsEditDialogOpen(true);
                            });
                          }}
                        >
                          Edit Bill
                        </DropdownMenuItem>
                        <DropdownMenuItem
                                  onClick={() => {
                                    runAdminAction(() => { void handleSetBillVerification(order); });
                                  }}
                                  disabled={
                                    order.status === 'Preparing'||
                                    order.status === 'Bill Verification'
                                    || order.status === 'Payment Pending Approval'
                                    || order.status === 'Paid'
                                    || order.status === 'Closed'
                                    || order.status === 'Cancelled'
                                  }
                                >
                                  Bill Verification
                                </DropdownMenuItem>
                        {/* <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Update Status</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuItem
                                  onClick={() => {
                                    runAdminAction(() => { void updateOrderStatus(order.id, 'Preparing'); });
                                  }}
                                  disabled={
                                    order.status === 'Bill Verification'
                                    || order.status === 'Payment Pending Approval'
                                    || order.status === 'Paid'
                                    || order.status === 'Closed'
                                    || order.status === 'Cancelled'
                                  }
                                >
                                  Preparing
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    runAdminAction(() => { void updateOrderStatus(order.id, 'Served'); });
                                  }}
                                  disabled={
                                    order.status === 'Bill Verification'
                                    || order.status === 'Payment Pending Approval'
                                    || order.status === 'Paid'
                                    || order.status === 'Closed'
                                    || order.status === 'Cancelled'
                                  }
                                >
                                  Served
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    runAdminAction(() => { void handleSetBillVerification(order); });
                                  }}
                                  disabled={
                                    order.status === 'Preparing'||
                                    order.status === 'Bill Verification'
                                    || order.status === 'Payment Pending Approval'
                                    || order.status === 'Paid'
                                    || order.status === 'Closed'
                                    || order.status === 'Cancelled'
                                  }
                                >
                                  Bill Verification
                                </DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub> */}
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger
                            disabled={order.status !== "Bill Verification"}
                            className="data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                          >
                            Confirm Payment (Waiter)
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {PAYMENT_METHOD_OPTIONS.map((method) => (
                              <DropdownMenuItem
                                key={method}
                                onClick={() => {
                                  void handleWaiterConfirmPayment(order, method);
                                }}
                                disabled={order.status !== "Bill Verification"}
                                className="data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                              >
                                {method}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => { void openSplitPayment(order); }}
                              disabled={order.status !== "Bill Verification"}
                              className="data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                            >
                              Split payment…
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem
                          onClick={() => { void handleAdminApprovePayment(order); }}
                          disabled={order.status !== 'Payment Pending Approval'}
                        >
                          Approve Payment (Admin)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => { void handleCloseBill(order); }}
                          disabled={order.status !== 'Paid'}
                        >
                          Close Bill (Admin)
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem
                            onClick={() => { void handleReopenBill(order); }}
                            disabled={!order.bill_closed_at || !order.bill_id || order.status === 'Cancelled'}
                          >
                            Re-open Bill (Admin)
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={() => {
                            runAdminAction(() => {
                              if (confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
                                void handleDeleteOrder(order.id);
                              }
                            });
                          }}
                          disabled={
                            order.status === 'Bill Verification' ||
                            order.status === 'Payment Pending Approval'
                            || order.status === 'Paid'
                            || order.status === 'Closed'
                            || order.status === 'Cancelled'
                          }
                          className="text-red-600"
                        >
                          Delete Order
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { triggerPrint(order); }} disabled={order.status !== 'Bill Verification' && order.status !== 'Payment Pending Approval' && order.status !== 'Paid' && order.status !== 'Closed'}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print Bill
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </div>
                    )}
                  </TableCell>
                </TableRow>
              )})}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={splitPayOrder !== null} onOpenChange={(v) => { if (!v && !splitBusy) {setSplitPayOrder(null);} }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Split payment · Table {splitPayOrder?.table}</DialogTitle>
            <DialogDescription>
              {splitPayTotal != null
                ? `Bill total ${currencySymbol}${splitPayTotal.toFixed(2)} — the amounts must add up exactly (the last row auto-balances).`
                : "Enter the amount taken by each payment mode — together they must add up to the bill total."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {splitRows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select value={row.method} onValueChange={(v) => { updateSplitRow(idx, { method: v }); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Cash", "Upi", "Card"].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.amount}
                  onChange={(e) => { updateSplitRow(idx, { amount: e.target.value }); }}
                />
                {splitRows.length > 2 ? (
                  <Button variant="ghost" size="icon" onClick={() => { setSplitRows((rows) => rows.filter((_, i) => i !== idx)); }}>
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
            {splitRows.length < 4 ? (
              <Button variant="outline" size="sm" onClick={() => { setSplitRows((rows) => [...rows, { method: "Upi", amount: "0.00" }]); }}>
                Add payment mode
              </Button>
            ) : null}
            {splitPayTotal != null ? (() => {
              const sum = splitRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
              const diff = Math.round((splitPayTotal - sum) * 100) / 100;
              return Math.abs(diff) > 0.01 ? (
                <p className="text-xs text-red-600">
                  {diff > 0
                    ? `${currencySymbol}${diff.toFixed(2)} still unallocated`
                    : `${currencySymbol}${Math.abs(diff).toFixed(2)} over the bill total`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Amounts match the bill total.</p>
              );
            })() : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setSplitPayOrder(null); }} disabled={splitBusy}>Cancel</Button>
            <Button onClick={() => { void submitSplitPayment(); }} disabled={splitBusy}>Record split payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedOrder && <OrderDetailsDialog
        order={selectedOrder}
        canEditPrice={isAdmin}
        open={isDetailsOpen}
        onOpenChange={(isOpen) => {
          setIsDetailsOpen(isOpen);
          if (!isOpen) {setSelectedOrder(null);}
        }}
        onSave={async (updatedOrder) => {
          if (!user?.restaurantUsername) {return;}
          try {
            // detect removed item ids and call delete endpoint for each
            try {
              const orig = selectedOrder;
              const origIds = Array.isArray(orig?.items) ? orig.items.map(i => String(i.id)) : [];
              const updatedIds = Array.isArray(updatedOrder.items) ? updatedOrder.items.map(i => String(i.id)) : [];
              const removed = origIds.filter(id => !updatedIds.includes(id));
              if (removed.length > 0) {
                await Promise.all(removed.map(id => requestBackend({ path: `/orders/${encodeURIComponent(String(updatedOrder.id))}/items/${encodeURIComponent(id)}`, method: 'DELETE', restaurantId: user.restaurantUsername })));
              }
            } catch (e) {
              console.error('Failed to call delete-item endpoints', e);
            }

            await addOrder(user.restaurantUsername, updatedOrder);
            const [updatedOrders, updatedApcInsight] = await Promise.all([
              getOrders(user.restaurantUsername),
              getMonthlyApcInsight(user.restaurantUsername),
            ]);
            setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
            setMonthlyApcInsight(updatedApcInsight ?? null);
          } catch (err) {
            console.error('Failed to save order', err);
            alert('Unable to save order.');
          } finally {
            setSelectedOrder(null);
            setIsDetailsOpen(false);
          }
        }}
        menuItems={menuItems}
      />}

      {selectedOrder && <OrderViewDialog
        order={selectedOrder}
        open={isViewOpen}
        onOpenChange={(isOpen) => {
          setIsViewOpen(isOpen);
          if (!isOpen) {setSelectedOrder(null);}
        }}
        onRefreshOrders={refreshOrders}
      />}

        {selectedOrder && <EditOrderDialog
          key={selectedOrder.id}
          order={selectedOrder} 
          open={isEditDialogOpen}
          onOpenChange={(isOpen) => {
            if(!isOpen) {setSelectedOrder(null);}
            setIsEditDialogOpen(isOpen);
          }}
          onSubmit={handleEditOrder}
          onReplace={handleReplaceBill}
          canEditPrice={isAdmin}
          defaultTax={defaultTax}
          menuItems={menuItems}
        />}
      <DefaultTaxDialog
        open={isDefaultTaxDialogOpen}
        onOpenChange={setIsDefaultTaxDialogOpen}
        defaultTax={defaultTax}
        onSaved={async (t) => {
          if (user?.restaurantUsername) {
            try {
              await setOutletDefaultTax(user.restaurantUsername, t);
            } catch (err) {
              console.error('failed to save default tax', err);
            }
          }
          setDefaultTax(t);
        }}
      />

      <Dialog
        open={isProofPreviewOpen}
        onOpenChange={(open) => {
          setIsProofPreviewOpen(open);
          if (!open) {setProofPreviewUrl(null);}
        }}
      >
        <DialogContent className="sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>Payment Screenshot</DialogTitle>
            <DialogDescription>
              Preview the uploaded payment proof before approval.
            </DialogDescription>
          </DialogHeader>
          {proofPreviewUrl ? (
            <div className="max-h-[70vh] overflow-auto rounded-md border p-2">
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
            <Button variant="outline" onClick={() => { setIsProofPreviewOpen(false); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Kitchen display (KDS): station-filtered tickets + expo/pass view ------

// Live elapsed (ms) for a prep timer, mirroring the backend computation.
const timerElapsedMs = (t?: OrderTimer | null, nowMs?: number): number => {
  if (!t?.started_at) {return 0;}
  const now = nowMs ?? Date.now();
  const end = t.ended_at ? Date.parse(t.ended_at) : now;
  let paused = t.paused_ms ?? 0;
  if (t.paused && t.pause_started_at) {paused += now - Date.parse(t.pause_started_at);}
  return Math.max(0, end - Date.parse(t.started_at) - paused);
};

const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

const isItemHeld = (item: OrderItem) => item.course_hold === true && !item.fired_at;

const StationBadge = ({ station }: { station?: string | null }) =>
  station ? (
    <Badge variant="outline" className="text-[10px] uppercase tracking-wide px-1.5 py-0">
      {station}
    </Badge>
  ) : null;

// Order-channel badge (Swiggy/Zomato/takeaway/delivery) so aggregator tickets
// are unmissable on the pass. Dine-in (the default) shows nothing.
const SOURCE_BADGE_CLASS: Record<string, string> = {
  swiggy: "border-orange-400 bg-orange-50 text-orange-700",
  zomato: "border-red-400 bg-red-50 text-red-700",
};
const SourceBadge = ({ source }: { source?: string | null }) => {
  const s = (source ?? "").trim().toLowerCase();
  if (!s || s === "dine_in") {return null;}
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0 ${SOURCE_BADGE_CLASS[s] ?? ""}`}>
      {s.replace(/_/g, " ")}
    </Badge>
  );
};

function KitchenDisplay({ orders, restaurantId, onRefresh, managedSections = [], initialStation }: { orders: Order[]; restaurantId: string; onRefresh: () => Promise<void>; managedSections?: string[]; initialStation?: string }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"tickets" | "expo">("tickets");
  // ?station= deep link initialises the filter so a wall screen stays locked to
  // one kitchen section.
  const [station, setStation] = useState<string>(initialStation?.trim() || "All");
  const [expo, setExpo] = useState<ExpoTable[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busyItem, setBusyItem] = useState<string | null>(null);

  // Kitchen tickets = orders still in service; settled/verification orders left
  // out, and cancelled ones can never appear (terminal — no fire/serve/bark).
  const activeOrders = useMemo(
    () => orders.filter((o) => !isOrderCancelled(o) && (o.status === "Preparing" || o.status === "Served")),
    [orders],
  );

  // Chips = union of the MANAGED section list (settings order first) and any
  // station present on active tickets (legacy/free-form labels).
  const stations = useMemo(() => {
    const out: string[] = ["All"];
    const seen = new Set<string>();
    for (const s of managedSections) {
      const key = s.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(s); }
    }
    const extras = new Set<string>();
    for (const o of activeOrders) {for (const it of o.items) {
      if (it.station && !seen.has(it.station.toLowerCase())) {extras.add(it.station);}
    }}
    out.push(...Array.from(extras).sort());
    return out;
  }, [activeOrders, managedSections]);

  // Ageing tick while tickets are on screen.
  useEffect(() => {
    if (mode !== "tickets" || activeOrders.length === 0) {return;}
    const t = setInterval(() => { setNow(Date.now()); }, 10000);
    return () => { clearInterval(t); };
  }, [mode, activeOrders.length]);

  useEffect(() => {
    if (mode !== "expo" || !restaurantId) {return;}
    let cancelled = false;
    const load = async () => {
      try {
        const r = await getKdsExpo(restaurantId);
        if (!cancelled) {setExpo(r.tables);}
      } catch { /* keep the previous snapshot */ }
    };
    void load();
    const t = setInterval(() => { void load(); }, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [mode, restaurantId, orders]);

  const handleFire = async (orderId: string, itemId: string) => {
    setBusyItem(itemId);
    try {
      await fireOrderItems(restaurantId, orderId, [itemId]);
      toast({ title: "Course fired", description: "The kitchen has it now." });
      await onRefresh();
    } catch (err: unknown) {
      toast({ title: "Unable to fire course", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusyItem(null);
    }
  };

  const handleServe = async (orderId: string, itemId: string) => {
    setBusyItem(itemId);
    try {
      await requestBackend({
        path: `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/serve`,
        method: "POST",
        restaurantId,
      });
      await onRefresh();
    } catch (err: unknown) {
      toast({ title: "Unable to mark served", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusyItem(null);
    }
  };

  // Bark the ticket to the kitchen — the prep timers start at this instant.
  const handleBark = async (orderId: string) => {
    setBusyItem(orderId);
    try {
      await barkOrder(restaurantId, orderId);
      toast({ title: "Order barked", description: "The kitchen has it now — timers started." });
      await onRefresh();
    } catch (err: unknown) {
      toast({ title: "Unable to bark order", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusyItem(null);
    }
  };

  const tickets = activeOrders
    .map((order) => ({
      order,
      items: order.items.filter((it) => station === "All" || (it.station ?? "").toLowerCase() === station.toLowerCase()),
    }))
    .filter((t) => t.items.length > 0);

  const expoChipClass = (status: string) =>
    status === "served"
      ? "bg-green-100 text-green-800 border-green-300"
      : status === "held"
        ? "bg-muted text-muted-foreground border-dashed"
        : status === "unbarked"
          ? "bg-muted/70 text-muted-foreground border-dotted opacity-80"
          : "bg-amber-100 text-amber-900 border-amber-300";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><ChefHat className="h-5 w-5" /> Kitchen display</CardTitle>
          <CardDescription>
            {mode === "tickets"
              ? "Live tickets with station routing and course holds."
              : "Expo/pass: per-table ready vs pending consolidation."}
          </CardDescription>
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          <Button size="sm" variant={mode === "tickets" ? "default" : "ghost"} onClick={() => { setMode("tickets"); }}>Tickets</Button>
          <Button size="sm" variant={mode === "expo" ? "default" : "ghost"} onClick={() => { setMode("expo"); }}>Expo</Button>
        </div>
      </CardHeader>
      <CardContent>
        {mode === "tickets" ? (
          <>
            {stations.length > 1 ? (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {stations.map((s) => (
                  <span key={s} className="inline-flex items-center">
                    <Button
                      size="sm"
                      variant={station.toLowerCase() === s.toLowerCase() ? "default" : "outline"}
                      className={`h-7 px-2.5 text-xs capitalize ${s === "All" ? "" : "rounded-r-none"}`}
                      onClick={() => { setStation(s); }}
                    >
                      {s}
                    </Button>
                    {s !== "All" ? (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-l-none border-l-0 px-1.5"
                        title={`Open the locked ${s} kitchen display in a new tab`}
                      >
                        <a
                          href={`/dashboard/orders?station=${encodeURIComponent(s)}&kiosk=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open locked ${s} kitchen display`}
                        >
                          <MonitorSmartphone className="h-3 w-3" />
                        </a>
                      </Button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            {tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active kitchen tickets{station !== "All" ? ` for ${station}` : ""}.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tickets.map(({ order, items }) => {
                  const orderMs = timerElapsedMs(order.timing?.order, now);
                  // Un-barked tickets sit greyed with idle timers until barked.
                  const barked = isOrderBarked(order);
                  return (
                    <Card key={order.id} className={`border-dashed ${barked ? "" : "bg-muted/40"}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="flex items-center gap-1.5 text-base">
                            {order.table || "—"}
                            <SourceBadge source={order.order_type} />
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            {barked && order.timing?.order?.started_at ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />{formatElapsed(orderMs)}
                              </span>
                            ) : null}
                            {barked ? (
                              <Badge variant={order.status === "Preparing" ? "secondary" : "default"}>{order.status}</Badge>
                            ) : (
                              <Badge variant="outline" className="border-dashed text-muted-foreground">Not barked</Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-1.5 pt-0">
                        {items.map((item) => {
                          const held = isItemHeld(item);
                          const timer = order.timing?.items?.[item.id];
                          const served = Boolean(timer?.ended_at);
                          const ms = timerElapsedMs(timer, now);
                          return (
                            <div key={item.id} className={`flex items-center justify-between gap-2 text-sm ${held || !barked ? "opacity-60" : ""}`}>
                              <div className="min-w-0">
                                <span className={served ? "line-through text-muted-foreground" : ""}>
                                  {item.quantity}× {item.name}
                                </span>{" "}
                                <StationBadge station={item.station} />
                                {held ? (
                                  <Badge variant="outline" className="ml-1 border-amber-400 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0">HOLD</Badge>
                                ) : null}
                                {item.note ? <div className="text-xs text-muted-foreground">Note: {item.note}</div> : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {!barked ? null : served ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : held ? (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyItem === item.id} onClick={() => { void handleFire(order.id, item.id); }}>
                                    <Flame className="mr-1 h-3 w-3 text-orange-500" /> Fire
                                  </Button>
                                ) : (
                                  <>
                                    {timer?.started_at ? (
                                      <span className="text-xs text-muted-foreground">{formatElapsed(ms)}</span>
                                    ) : null}
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busyItem === item.id} onClick={() => { void handleServe(order.id, item.id); }}>
                                      Serve
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {!barked ? (
                          <Button size="sm" className="mt-2 w-full" disabled={busyItem === order.id} onClick={() => { void handleBark(order.id); }}>
                            <Megaphone className="mr-1.5 h-4 w-4" /> Bark to kitchen
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        ) : expo.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active tables on the pass.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {expo.map((t) => (
              <Card key={t.table} className={`border ${t.pending_count === 0 ? "border-green-300" : "border-amber-300"}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-1.5 text-base">
                      {t.table}
                      <SourceBadge source={t.source} />
                    </CardTitle>
                    <div className="flex items-center gap-1 text-xs">
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{t.ready_count} ready</Badge>
                      <Badge variant="secondary" className={t.pending_count > 0 ? "bg-amber-100 text-amber-900 hover:bg-amber-100" : ""}>{t.pending_count} pending</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {t.items.map((item, idx) => (
                      <span key={idx} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${expoChipClass(item.status)}`}>
                        {item.qty}× {item.name}
                        {item.station ? <span className="uppercase text-[9px] opacity-70">· {item.station}</span> : null}
                        {item.status === "held" ? <span className="text-[9px] font-semibold">HOLD</span> : null}
                        {item.status === "unbarked" ? <span className="text-[9px] font-semibold">NOT BARKED</span> : null}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Locked per-zone kitchen display (kiosk) -------------------------------
// A wall-mounted kitchen monitor locked to ONE section via ?station=X&kiosk=1.
// It renders ONLY that section's live tickets, full-screen and large, with
// nothing that could let kitchen staff switch sections or reach bill/admin
// actions. It pulls only that section server-side (?station=) AND re-filters
// client-side, so it stays locked even against a backend that ignores the
// param. There is deliberately NO chip bar and NO way to change the section.
function KitchenKioskDisplay({ station }: { station: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const restaurantId = user?.restaurantUsername ?? "";
  const [orders, setOrders] = useState<Order[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) {return;}
    try {
      const data = await getOrders(restaurantId, station);
      setOrders(Array.isArray(data) ? dedupeOrdersById(data) : []);
    } catch {
      // Keep the previous snapshot on a transient failure — a kitchen screen
      // should never flash empty because one poll blipped.
    } finally {
      setLoaded(true);
    }
  }, [restaurantId, station]);

  // Initial load + polling auto-refresh + realtime nudges.
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 10000);
    return () => { clearInterval(t); };
  }, [load]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as { event?: string } | undefined;
      if (!detail) {return;}
      if (detail.event === "order:updated" || detail.event === "bill:updated") {void load();}
    };
    window.addEventListener("realtime:event", handler as EventListener);
    return () => { window.removeEventListener("realtime:event", handler as EventListener); };
  }, [load]);

  // Ageing tick so item/urgency timers keep advancing on the wall screen.
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); }, 5000);
    return () => { clearInterval(t); };
  }, []);

  // Cancelled tickets are terminal and never reach a station display.
  const activeOrders = useMemo(
    () => orders.filter((o) => !isOrderCancelled(o) && (o.status === "Preparing" || o.status === "Served")),
    [orders],
  );

  // Locked to ONE section — re-filter client-side (defence in depth) so this
  // display can never show another zone's items even if the server returned the
  // full set.
  const tickets = useMemo(
    () =>
      activeOrders
        .map((order) => ({
          order,
          items: order.items.filter((it) => (it.station ?? "").toLowerCase() === station.toLowerCase()),
        }))
        .filter((t) => t.items.length > 0),
    [activeOrders, station],
  );

  const handleFire = async (orderId: string, itemId: string) => {
    setBusyItem(itemId);
    try {
      await fireOrderItems(restaurantId, orderId, [itemId]);
      await load();
    } catch (err: unknown) {
      toast({ title: "Unable to fire course", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusyItem(null);
    }
  };

  const handleServe = async (orderId: string, itemId: string) => {
    setBusyItem(itemId);
    try {
      await requestBackend({ path: `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/serve`, method: "POST", restaurantId });
      await load();
    } catch (err: unknown) {
      toast({ title: "Unable to mark served", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusyItem(null);
    }
  };

  const handleBark = async (orderId: string) => {
    setBusyItem(orderId);
    try {
      await barkOrder(restaurantId, orderId);
      await load();
    } catch (err: unknown) {
      toast({ title: "Unable to bark order", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusyItem(null);
    }
  };

  // Order-level urgency by minutes since the prep timer started (i.e. barked).
  const urgency = (order: Order): "fresh" | "warn" | "late" => {
    const min = timerElapsedMs(order.timing?.order, now) / 60000;
    if (min >= 10) {return "late";}
    if (min >= 5) {return "warn";}
    return "fresh";
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground">
      {/* Locked header: section name + kitchen-display badge. No chips, no way to switch. */}
      <header className="flex items-center justify-between gap-3 border-b bg-card px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <ChefHat className="h-8 w-8 shrink-0 text-primary" />
          <h1 className="truncate text-3xl font-bold capitalize md:text-4xl">{station}</h1>
          <Badge variant="secondary" className="ml-1 hidden items-center gap-1 text-xs uppercase tracking-wide sm:inline-flex">
            <MonitorSmartphone className="h-3.5 w-3.5" /> Kitchen display
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{tickets.length} active ticket{tickets.length === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="h-4 w-4" />{new Date(now).toLocaleTimeString()}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6">
        {!restaurantId ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-2xl text-muted-foreground">Signing in…</p>
          </div>
        ) : !loaded ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-2xl text-muted-foreground">Loading kitchen tickets…</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-2xl text-muted-foreground">No active tickets for {station}.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {tickets.map(({ order, items }) => {
              const barked = isOrderBarked(order);
              const orderMs = timerElapsedMs(order.timing?.order, now);
              const u = barked ? urgency(order) : "fresh";
              const accent = !barked
                ? "border-dashed opacity-80"
                : u === "late"
                  ? "border-red-500 ring-2 ring-red-500/40"
                  : u === "warn"
                    ? "border-amber-500"
                    : "border-border";
              return (
                <Card key={order.id} className={`flex flex-col border-2 ${accent} ${barked ? "" : "bg-muted/40"}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-2xl">
                        {order.table || "—"}
                        <SourceBadge source={order.order_type} />
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {barked && order.timing?.order?.started_at ? (
                          <span className={`flex items-center gap-1 text-base font-semibold tabular-nums ${u === "late" ? "text-red-600" : u === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
                            <Clock className="h-4 w-4" />{formatElapsed(orderMs)}
                          </span>
                        ) : null}
                        {barked ? (
                          <Badge variant={order.status === "Preparing" ? "secondary" : "default"} className="text-sm">{order.status}</Badge>
                        ) : (
                          <Badge variant="outline" className="border-dashed text-muted-foreground">Not barked</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 pt-0">
                    {items.map((item) => {
                      const held = isItemHeld(item);
                      const timer = order.timing?.items?.[item.id];
                      const served = Boolean(timer?.ended_at);
                      const ms = timerElapsedMs(timer, now);
                      return (
                        <div key={item.id} className={`flex items-center justify-between gap-2 text-lg ${held || !barked ? "opacity-60" : ""}`}>
                          <div className="min-w-0">
                            <span className={served ? "line-through text-muted-foreground" : "font-medium"}>
                              {item.quantity}× {item.name}
                            </span>
                            {held ? (
                              <Badge variant="outline" className="ml-2 border-amber-400 bg-amber-50 text-amber-800 text-[11px] px-1.5 py-0">HOLD</Badge>
                            ) : null}
                            {item.note ? <div className="text-sm text-muted-foreground">Note: {item.note}</div> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {!barked ? null : served ? (
                              <CheckCircle2 className="h-6 w-6 text-green-600" />
                            ) : held ? (
                              <Button size="sm" variant="outline" className="h-9 px-3 text-sm" disabled={busyItem === item.id} onClick={() => { void handleFire(order.id, item.id); }}>
                                <Flame className="mr-1 h-4 w-4 text-orange-500" /> Fire
                              </Button>
                            ) : (
                              <>
                                {timer?.started_at ? <span className="text-sm text-muted-foreground tabular-nums">{formatElapsed(ms)}</span> : null}
                                <Button size="sm" variant="ghost" className="h-9 px-3 text-sm" disabled={busyItem === item.id} onClick={() => { void handleServe(order.id, item.id); }}>
                                  Serve
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!barked ? (
                      <Button className="mt-2 w-full" disabled={busyItem === order.id} onClick={() => { void handleBark(order.id); }}>
                        <Megaphone className="mr-1.5 h-4 w-4" /> Bark to kitchen
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function OrderForm({ onSubmit, menuItems, tables, selectedTableName, onClearSelectedTable }: { onSubmit: (data: { tableId: number; items: { id?: string; name: string; price: number; quantity?: number; note?: string | null; course_hold?: boolean }[]; covers?: number }) => Promise<void> | void; menuItems: MenuItem[]; tables: { id: number; name: string; capacity: number }[]; selectedTableName?: string; onClearSelectedTable?: () => void }) {
  const { currencySymbol } = useCurrency();
  const [selectedTableId, setSelectedTableId] = useState<string>(() => {
    if (selectedTableName) {
      const matched = tables.find((table) => table.name.toLowerCase() === selectedTableName.toLowerCase());
      if (matched) {return String(matched.id);}
    }
    return tables?.[0]?.id?.toString() ?? '';
  });
  const [selectedItemValue, setSelectedItemValue] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState<number>(1);
  const [selectedNote, setSelectedNote] = useState("");
  const [selectedHold, setSelectedHold] = useState(false);
  const [itemsList, setItemsList] = useState<{ id?: string; name: string; price: number; quantity: number; note?: string | null; course_hold?: boolean }[]>([]);
  const [covers, setCovers] = useState<number>(1);

  useEffect(() => {
    if (selectedTableName) {
      const matched = tables.find((table) => table.name.toLowerCase() === selectedTableName.toLowerCase());
      if (matched) {
        setSelectedTableId(String(matched.id));
      }
      return;
    }

    if (!selectedTableId && tables[0]) {
      setSelectedTableId(String(tables[0].id));
    }
  }, [selectedTableName, selectedTableId, tables]);

  

  const menuOptions = menuItems.map(item => ({ value: item.name.toLowerCase(), label: item.name }));
  const tableOptions = tables.map(t => ({ value: String(t.id), label: t.name }));

  const addItem = () => {
    const name = selectedItemValue.trim();
    const selectedMenuItem = menuItems.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!selectedMenuItem) {return;}
    const price = Number(selectedMenuItem.price || 0);
    const note = selectedNote.trim();
    const hold = selectedHold;
    setItemsList(prev => {
      const existing = prev.find(
        p => p.name.toLowerCase() === name.toLowerCase() && String(p.note ?? "") === note && Boolean(p.course_hold) === hold,
      );
      if (existing) {
        return prev.map(p =>
          p.name.toLowerCase() === name.toLowerCase() && String(p.note ?? "") === note && Boolean(p.course_hold) === hold
            ? { ...p, quantity: p.quantity + selectedQuantity }
            : p,
        );
      }
      return [...prev, { id: undefined, name, price, quantity: selectedQuantity, note: note || null, course_hold: hold }];
    });
    setSelectedItemValue("");
    setSelectedQuantity(1);
    setSelectedNote("");
    setSelectedHold(false);
  };

  const removeItem = (name: string, note?: string | null) => {
    setItemsList(prev => prev.filter(p => !(p.name === name && String(p.note ?? "") === String(note ?? ""))));
  };

  const subtotal = itemsList.reduce((acc, it) => acc + it.price * it.quantity, 0);

  const handleSubmit = () => {
    const tableIdNum = Number(selectedTableId);
    if (!selectedTableId || Number.isNaN(tableIdNum) || itemsList.length === 0) {return;}
    void onSubmit({ tableId: tableIdNum, items: itemsList, covers });
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
      <Label htmlFor="table" className="text-right">Table</Label>
      <div className="col-span-3">
        {selectedTableName ? (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{selectedTableName}</span>
            {onClearSelectedTable ? (
              <Button variant="ghost" size="sm" onClick={onClearSelectedTable}>Change</Button>
            ) : null}
          </div>
        ) : (
          <Combobox
            options={tableOptions}
            value={selectedTableId || (tables?.[0]?.id?.toString() ?? '')}
            onChange={(value) => { setSelectedTableId(String(value ?? '')); }}
            placeholder="Select a table"
            searchPlaceholder="Search tables..."
            emptyPlaceholder="No tables available"
          />
        )}
      </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
      <Label htmlFor="covers" className="text-right">Guests</Label>
      <div className="col-span-3">
        <Input id="covers" type="number" min={1} value={String(covers)} onChange={(e) => { setCovers(Math.max(1, Number(e.target.value) || 1)); }} placeholder="Number of guests (covers)" />
      </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
      <Label htmlFor="item" className="text-right">Add Item</Label>
      <div className="col-span-3 grid grid-cols-12 gap-2">
        <div className="col-span-6">
          <Combobox
            options={menuOptions}
            value={selectedItemValue.toLowerCase()}
            onChange={(value) => {
              const selected = menuItems.find(m => m.name.toLowerCase() === value);
              setSelectedItemValue(selected?.name ?? value ?? '');
            }}
            placeholder="Select or type item"
            searchPlaceholder="Search for an item..."
            emptyPlaceholder="No items found."
          />
        </div>
        <Input placeholder="Qty" type="number" value={String(selectedQuantity)} onChange={e => { setSelectedQuantity(Math.max(1, Number(e.target.value) || 1)); }} className="col-span-4" />
        <Button onClick={addItem} className="col-span-2">Add</Button>
      </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="item-note" className="text-right">Note</Label>
        <Input
          id="item-note"
          placeholder="No onion, extra spicy, etc."
          value={selectedNote}
          onChange={(e) => { setSelectedNote(e.target.value); }}
          className="col-span-3"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="item-hold" className="text-right">Hold</Label>
        <div className="col-span-3 flex items-center gap-2">
          <Switch id="item-hold" checked={selectedHold} onCheckedChange={setSelectedHold} />
          <span className="text-sm text-muted-foreground">Hold this course — the kitchen fires it later.</span>
        </div>
      </div>

      <div>
      {itemsList.length === 0 ? (
        <div className="text-sm text-muted-foreground">No items added.</div>
      ) : (
        <div className="space-y-2">
          {itemsList.map(it => (
            <div key={`${it.name}-${String(it.note ?? "")}-${it.course_hold ? "h" : ""}`} className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  {it.quantity}x {it.name}
                  {it.course_hold ? (
                    <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0">HOLD</Badge>
                  ) : null}
                </div>
                {it.note ? <div className="text-xs text-muted-foreground">Note: {it.note}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <div>{currencySymbol}{(it.price * it.quantity).toFixed(2)}</div>
                <Button variant="ghost" size="icon" onClick={() => { removeItem(it.name, it.note); }}><X className="h-4 w-4"/></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      <div className="flex justify-between text-sm border-t pt-2">
        <div>Subtotal</div>
        <div>{currencySymbol}{subtotal.toFixed(2)}</div>
      </div>

      <DialogFooter>
      <Button onClick={handleSubmit}>Save Order</Button>
      </DialogFooter>
    </div>
  )
}

const EditOrderDialog = React.memo(({ order, open, onOpenChange, onSubmit, onReplace, canEditPrice, defaultTax, menuItems }: { order: Order, open: boolean, onOpenChange: (open: boolean) => void, onSubmit: (data: Omit<Order, 'total'>) => void, onReplace?: (order: Order, replacement: { items: OrderItem[]; taxes: { id?: string; name: string; percentage: number }[]; serviceChargePercentage?: number | undefined; applyServiceCharge?: boolean; reason: string; }) => Promise<void>, canEditPrice?: boolean, defaultTax?: Record<string, number> | null, menuItems?: MenuItem[] }) => {
  const { currencySymbol } = useCurrency();
  const [serviceChargePerc, setServiceChargePerc] = useState(order.serviceChargePercentage?.toString() || "");
  const [taxes, setTaxes] = useState<Tax[]>(order.taxes || []);
  const [applyServiceCharge, setApplyServiceCharge] = useState(order.applyServiceCharge);
  const [localItems, setLocalItems] = useState<OrderItem[]>(order.items.map(i => ({ ...i })));
  const [newItemName, setNewItemName] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState<number>(1);
  const [newItemNote, setNewItemNote] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    Promise.resolve().then(() => {
      setServiceChargePerc(order.serviceChargePercentage?.toString() || "");
      setApplyServiceCharge(order.applyServiceCharge);
      setLocalItems(order.items.map(i => ({ ...i })));
      setReason("");
      setNewItemName("");
      setNewItemQuantity(1);
      setNewItemNote("");

      if (Array.isArray(order.taxes) && order.taxes.length > 0) {
        setTaxes(order.taxes as any);
      } else if (defaultTax && typeof defaultTax === "object") {
        const taxesFromDefault: Tax[] = [];
        for (const [k, v] of Object.entries(defaultTax)) {
          if (!k) {continue;}
          if (/service ?charge/i.test(k) || /service ?charges/i.test(k)) {
            if (Number(v) > 0) {
              setServiceChargePerc(String(Number(v)));
              setApplyServiceCharge(true);
            }
          } else {
            taxesFromDefault.push({ id: `d-${k}`, name: k, percentage: Number(v) });
          }
        }
        setTaxes(taxesFromDefault);
      } else {
        setTaxes([]);
      }
    });
  }, [order, defaultTax]);

  const handleTaxChange = (id: string, field: "name" | "percentage", value: string) => {
    setTaxes(taxes.map(tax => tax.id === id ? { ...tax, [field]: field === "percentage" ? (parseFloat(value) || 0) : value } : tax));
  };

  const addTax = () => {
    setTaxes([...taxes, { id: `t${Date.now()}`, name: "", percentage: 0 }]);
  };

  const removeTax = (id: string) => {
    setTaxes(taxes.filter(tax => tax.id !== id));
  };

  const handleAddItem = () => {
    const itemName = newItemName.trim();
    const selectedMenuItem = (menuItems ?? []).find(m => m.name.toLowerCase() === itemName.toLowerCase());
    if (!selectedMenuItem) {return;}
    const normalizedNote = newItemNote.trim();

    setLocalItems(prev => {
      const existing = prev.find(
        p => p.name.trim().toLowerCase() === itemName.toLowerCase() && String(p.note ?? "") === normalizedNote,
      );
      if (existing) {
        return prev.map(p => p.id === existing.id ? { ...p, quantity: p.quantity + newItemQuantity } : p);
      }
      return [...prev, {
        id: `i${Date.now()}`,
        name: selectedMenuItem.name,
        quantity: newItemQuantity,
        price: Number(selectedMenuItem.price) || 0,
        orderedAt: new Date().toISOString(),
        note: normalizedNote || null,
      }];
    });

    setNewItemName("");
    setNewItemQuantity(1);
    setNewItemNote("");
  };

  const handleRemoveItem = (id: string) => { setLocalItems(prev => prev.filter(i => i.id !== id)); };

  const handleSubmit = async () => {
    const updatedOrder = {
      ...order,
      serviceChargePercentage: serviceChargePerc ? parseFloat(serviceChargePerc) : undefined,
      taxes: taxes.filter(t => t.name && t.percentage > 0),
      applyServiceCharge,
      items: localItems,
    };

    if (onReplace) {
      if (!reason?.trim()) {
        alert("Reason is required to replace bill");
        return;
      }
      await onReplace(order, {
        items: localItems,
        taxes: updatedOrder.taxes as any,
        serviceChargePercentage: updatedOrder.serviceChargePercentage,
        applyServiceCharge: updatedOrder.applyServiceCharge,
        reason: reason.trim(),
      });
      return;
    }

    onSubmit(updatedOrder);
  };

  const localSubtotal = localItems.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
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
            <div className="max-h-40 overflow-y-auto mb-2">
              <Table>
                <TableBody>
                  {localItems.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <div>{item.name}</div>
                        {item.note ? <div className="text-xs text-muted-foreground">Note: {item.note}</div> : null}
                      </TableCell>
                      <TableCell className="text-center">
                        <Input type="number" value={String(item.quantity)} onChange={(e) => { setLocalItems(prev => prev.map(p => p.id === item.id ? { ...p, quantity: Math.max(1, Number(e.target.value) || 1) } : p)); }} className="w-16 mx-auto" />
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

            <div className="grid grid-cols-12 gap-2 my-2">
              <div className="col-span-5">
                <Combobox
                  options={(menuItems ?? []).map(m => ({ value: m.name.toLowerCase(), label: m.name }))}
                  value={newItemName.toLowerCase()}
                  onChange={(value) => {
                    const selected = (menuItems ?? []).find(m => m.name.toLowerCase() === value);
                    setNewItemName(selected?.name ?? (value ?? ""));
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
            <Button variant="outline" size="sm" onClick={addTax} className="w-full mt-2">Add Tax</Button>
          </div>

          <div className="border-t pt-4 mt-2">
            <div className="flex justify-between text-sm">
              <span>Calculated Service Charge:</span>
              <span>{applyServiceCharge ? `${currencySymbol}${serviceChargeAmount.toFixed(2)}` : `${currencySymbol}0.00`}</span>
            </div>
            {calculatedTaxesWithAmounts.map(tax => (
              <div key={tax.id} className="flex justify-between text-sm">
                <span>{tax.name} ({tax.percentage}%):</span>
                <span>{currencySymbol}{tax.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-lg mt-2 border-t pt-2">
              <span>Final Total:</span>
              <span>{currencySymbol}{totalAmount.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-4">
            <Label>Reason for Edit (required)</Label>
            <textarea
              aria-label="Reason for bill replacement"
              placeholder="Write the reason for replacement"
              value={reason}
              onChange={e => { setReason(e.target.value); }}
              className="w-full border rounded p-2 mt-1"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleSubmit}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
EditOrderDialog.displayName = "EditOrderDialog";

const OrderDetailsDialog = React.memo(({ order, open, onOpenChange, onSave, menuItems, canEditPrice }: { order: Order | null, open: boolean, onOpenChange: (open: boolean) => void, onSave: (updated: Order) => Promise<void>, menuItems: MenuItem[], canEditPrice?: boolean }) => {
  const { currencySymbol } = useCurrency();
  const [localItems, setLocalItems] = useState<OrderItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemNote, setNewItemNote] = useState("");
  const [newItemHold, setNewItemHold] = useState(false);

  useEffect(() => {
    if (open && order) {
      Promise.resolve().then(() => {
        setLocalItems(order.items.map(i => ({ ...i })));
        setNewItemName("");
        setNewItemNote("");
        setNewItemHold(false);
      });
    }
  }, [open, order]);

  if (!order) {return null;}

  // Defence in depth: the "Update Order" entry is already disabled for a
  // cancelled order, but if this dialog is ever reached the editors stay locked.
  const cancelledLock = isOrderCancelled(order);

  const handleAddItem = () => {
    if (cancelledLock) {return;}
    const itemName = newItemName.trim();
    const selectedMenuItem = menuItems.find(item => item.name.toLowerCase() === itemName.toLowerCase());
    if (!selectedMenuItem) {
      return;
    }
    const normalizedNote = newItemNote.trim();
    const hold = newItemHold;

    setLocalItems(prev => {
      const nameLower = selectedMenuItem.name.trim().toLowerCase();
      const existing = prev.find(i => i.name.trim().toLowerCase() === nameLower && String(i.note ?? "") === normalizedNote && isItemHeld(i) === hold);
      if (existing) {
        return prev.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      const newItem: OrderItem = {
        id: `i${Date.now()}`,
        name: selectedMenuItem.name,
        quantity: 1,
        price: Number(selectedMenuItem.price) || 0,
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

  const handleRemove = (itemId: string) => {
    if (cancelledLock) {return;}
    setLocalItems(prev => prev.filter(i => i.id !== itemId));
  };

  const subtotal = localItems.reduce((acc, it) => acc + it.price * it.quantity, 0);
  const serviceCharge = calculateServiceCharge(subtotal, order.serviceChargePercentage, order.applyServiceCharge);
  const calculatedTaxes = calculateTaxes(subtotal, order.taxes);
  const totalTaxAmount = calculatedTaxes.reduce((sum, tax) => sum + tax.amount, 0);
  const total = subtotal + serviceCharge + totalTaxAmount;

  const menuOptions = menuItems.map(item => ({ value: item.name.toLowerCase(), label: item.name }));

  const handleSave = async () => {
    if (cancelledLock) {return;}
    const updatedOrder: Order = {
      ...order,
      items: localItems,
      subtotal,
      total,
      taxes: calculatedTaxes,
    };
    await onSave(updatedOrder);
  };

  const handleCancel = () => {
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
                <Badge variant="outline" className="border-dashed text-muted-foreground text-xs">Not barked</Badge>
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
          <div className="max-h-[40vh] overflow-y-auto my-4">
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
                {localItems.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {item.name}
                        <StationBadge station={item.station} />
                        {isItemHeld(item) ? (
                          <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0">HOLD</Badge>
                        ) : null}
                      </div>
                      {item.note ? <div className="text-xs text-muted-foreground">Note: {item.note}</div> : null}
                    </TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-muted-foreground text-center">
                      <div className="flex items-center justify-center">
                        <Clock className="h-3 w-3 mr-1" />
                        {formatOrderedAt(item.orderedAt)}
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
          <div className="grid grid-cols-12 gap-2 my-4 border-t pt-4">
            <Combobox
              options={menuOptions}
              value={newItemName.toLowerCase()}
              onChange={(value) => {
                const selectedItem = menuItems.find(item => item.name.toLowerCase() === value);
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
            {order.serviceChargePercentage && (
              <div className="flex justify-between">
                <span>Service Charge ({order.serviceChargePercentage}%)</span>
                <span>{order.applyServiceCharge ? `${currencySymbol}${serviceCharge.toFixed(2)}` : "Opted-out"}</span>
              </div>
            )}
            {calculatedTaxes.map(tax => (
              <div key={tax.id} className="flex justify-between">
                <span>{tax.name} ({tax.percentage}%)</span>
                <span>{currencySymbol}{tax.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
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
          <Button onClick={handleSave} disabled={cancelledLock}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
OrderDetailsDialog.displayName = "OrderDetailsDialog";

const OrderViewDialog = React.memo(({ order, open, onOpenChange, onRefreshOrders }: { order: Order | null, open: boolean, onOpenChange: (open: boolean) => void, onRefreshOrders?: () => Promise<void> }) => {
  const { currencySymbol } = useCurrency();
  const { user } = useAuth();
  if (!order) {return null;}

  const calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
  const serviceCharge = calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge);
  const totalTaxAmount = calculatedTaxes.reduce((sum, t) => sum + t.amount, 0);
  const total = order.subtotal + serviceCharge + totalTaxAmount;

  // derive split items
  const split = order.items_split ?? [['Served', order.items_flattened ?? order.items], ['Preparing', []]] as [string, OrderItem[]][];
  const servedInitial = Array.isArray(split[0][1]) ? split[0][1] : [];
  const preparingInitial = Array.isArray(split[1][1]) ? split[1][1] : [];

  const [served, setServed] = React.useState<OrderItem[]>(servedInitial);
  const [preparing, setPreparing] = React.useState<OrderItem[]>(preparingInitial);
  const [isDirty, setIsDirty] = React.useState(false);

  React.useEffect(() => {
    setServed(servedInitial);
    setPreparing(preparingInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.items_flattened?.length, order.items_split]);

  const dndEnabled = !(order.status === 'Bill Verification' || order.status === 'Payment Pending Approval' || order.status === 'Paid' || order.status === 'Closed' || order.status === 'Cancelled');

  const persistSplit = async (servedList: OrderItem[], preparingList: OrderItem[]) => {
    try {
      await requestBackend({ path: `/bills/order/${encodeURIComponent(order.id)}/status`, method: 'PATCH', restaurantId: user?.restaurantUsername, body: { items_split: [['Served', servedList], ['Preparing', preparingList]] } });
      // call parent refresh handler so OrdersPage can reload state
      if (onRefreshOrders) {await onRefreshOrders();}
    } catch (err) {
      console.error('persist items_split failed', err);
    }
  };

  const handleSaveChanges = async () => {
    if (!dndEnabled) {return;}
    try {
      await persistSplit(served, preparing);
      setIsDirty(false);
    } catch (err) {
      console.error('save changes failed', err);
    }
  };

  const handleDiscardChanges = () => {
    // reset to initial values from the order
    setServed(servedInitial);
    setPreparing(preparingInitial);
    setIsDirty(false);
  };

  const ItemRow: React.FC<{ item: OrderItem; side: 'served' | 'preparing' }> = ({ item, side }) => {
    const moveToOther = () => {
      const activeId = item.id;
      if (side === 'preparing') {
        const moving = preparing.find(p => p.id === activeId);
        if (!moving) {return;}
        setPreparing(prev => prev.filter(p => p.id !== activeId));
        setServed(prev => [...prev, moving]);
        setIsDirty(true);
      } else {
        const moving = served.find(s => s.id === activeId);
        if (!moving) {return;}
        setServed(prev => prev.filter(s => s.id !== activeId));
        setPreparing(prev => [...prev, moving]);
        setIsDirty(true);
      }
    };

    return (
      <TableRow key={item.id}>
        <TableCell className="font-medium">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                {item.name}
                <StationBadge station={item.station} />
                {isItemHeld(item) ? (
                  <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0">HOLD</Badge>
                ) : null}
              </div>
              {item.note ? <div className="text-xs text-muted-foreground">Note: {item.note}</div> : null}
            </div>
            <div>
              {!dndEnabled ? null : side === 'preparing' ? (
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); moveToOther(); }} title="Move to Served">
                  <ChevronUp className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); moveToOther(); }} title="Move to Preparing">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="text-center">{item.quantity}</TableCell>
        <TableCell className="text-muted-foreground text-center">
          <div className="flex items-center justify-center">
            <Clock className="h-3 w-3 mr-1" />
            {formatOrderedAt(item.orderedAt)}
          </div>
        </TableCell>
        <TableCell className="text-right">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</TableCell>
      </TableRow>
    );
  };

  // DnD removed: using explicit arrow controls for moves between Preparing and Served

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>View Order - {order.table}</DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2">
              <span>Status:</span>
              <Badge variant={isOrderCancelled(order) ? 'destructive' : order.status === 'Preparing' ? 'secondary' : order.status === 'Served' ? 'default' : 'outline'} className="text-xs">{order.status}</Badge>
            </span>
            {isOrderCancelled(order) ? (
              <span className="mt-1 block text-xs text-muted-foreground">{CANCELLED_LOCK_REASON}</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
            <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto my-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Served</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-center">Time</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {served.map(item => <ItemRow key={item.id} item={item} side="served" />)}
                  </TableBody>
                </Table>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Preparing</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-center">Time</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preparing.map(item => <ItemRow key={item.id} item={item} side="preparing" />)}
                  </TableBody>
                </Table>
              </div>
            </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-t pt-2">
              <span>Subtotal</span>
              <span>{currencySymbol}{order.subtotal.toFixed(2)}</span>
            </div>
            {order.serviceChargePercentage && (
              <div className="flex justify-between">
                <span>Service Charge ({order.serviceChargePercentage}%)</span>
                <span>{order.applyServiceCharge ? `${currencySymbol}${serviceCharge.toFixed(2)}` : 'Opted-out'}</span>
              </div>
            )}
            {calculatedTaxes.map(tax => (
              <div key={tax.id} className="flex justify-between">
                <span>{tax.name} ({tax.percentage}%):</span>
                <span>{currencySymbol}{tax.amount.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
              <span>Total:</span>
              <span>{currencySymbol}{total.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          {isDirty && dndEnabled ? (
            <>
              <Button variant="outline" onClick={handleDiscardChanges}>Discard</Button>
              <Button className="ml-2" onClick={handleSaveChanges}>Save Changes</Button>
            </>
          ) : null}
          <Button onClick={() => { onOpenChange(false); }}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
OrderViewDialog.displayName = 'OrderViewDialog';

const DefaultTaxDialog = React.memo(({ open, onOpenChange, defaultTax, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; defaultTax: Record<string, number> | null; onSaved: (t: Record<string, number>) => void }) => {
  const [taxes, setTaxes] = useState<{ id: string; name: string; percentage: number }[]>([]);

  useEffect(() => {
    if (open) {
      Promise.resolve().then(() => {
        if (defaultTax && typeof defaultTax === 'object') {
          setTaxes(Object.keys(defaultTax).map((k, i) => ({ id: `t${i}-${k}`, name: k, percentage: Number(defaultTax[k]) })));
        } else {
          setTaxes([]);
        }
      });
    }
  }, [open, defaultTax]);

  const addTax = () => { setTaxes(prev => [...prev, { id: `t${Date.now()}`, name: '', percentage: 0 }]); };
  const removeTax = (id: string) => { setTaxes(prev => prev.filter(t => t.id !== id)); };
  const updateTax = (id: string, field: 'name' | 'percentage', value: string) => {
    setTaxes(prev => prev.map(t => t.id === id ? { ...t, [field]: field === 'percentage' ? (parseFloat(value) || 0) : value } : t));
  };

  const handleSave = async () => {
    const payload: Record<string, number> = {};
    for (const t of taxes) {
      if (t.name && !Number.isNaN(t.percentage)) {payload[t.name] = Number(t.percentage);}
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
          {taxes.map(t => (
            <div key={t.id} className="grid grid-cols-12 gap-2 items-center">
              <Input value={t.name} placeholder="Tax name" onChange={e => { updateTax(t.id, 'name', e.target.value); }} className="col-span-7" />
              <Input value={String(t.percentage)} placeholder="%" type="number" onChange={e => { updateTax(t.id, 'percentage', e.target.value); }} className="col-span-3" />
              <Button variant="ghost" size="icon" onClick={() => { removeTax(t.id); }} className="col-span-2"><X className="h-4 w-4"/></Button>
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
});
DefaultTaxDialog.displayName = 'DefaultTaxDialog';
