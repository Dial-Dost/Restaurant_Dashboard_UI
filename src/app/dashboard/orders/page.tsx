"use client";

import React, { useState, useEffect, useMemo } from "react";
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
import { MoreHorizontal, PlusCircle, Clock, Printer, Trash2, X } from "lucide-react";
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
import {
  getMenuItems,
  getOrders,
  addOrder,
  deleteOrder,
  getMonthlyApcInsight,
  createBill,
  getTables,
  getOutletDefaultTax,
  setOutletDefaultTax,
  replaceBill,
  confirmBillPaymentByWaiter,
  approveBillPaymentByAdmin,
  closeBillByOrder,
  addAuditLogEntry,
  type MonthlyApcInsight,
  type PaymentMethod,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import type { MenuItem } from "../menu/data";


type OrderItem = {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
  note?: string | null;
};

export type OrderStatus =
  | "Preparing"
  | "Served"
  | "Bill Verification"
  | "Payment Pending Approval"
  | "Paid"
  | "Closed"
  | "Cancelled";

type Tax = {
  id: string;
  name: string;
  percentage: number;
};

export type Order = {
  id: string;
  table: string;
  customer: string;
  taken_by_employee_id?: string | null;
  taken_by_employee_name?: string | null;
  taken_by_employee_role?: string | null;
  items: OrderItem[];
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
};

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
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^data:image\//i.test(raw)) return raw;
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
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to load image"));
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
        .then((dataUrl) => resolve(dataUrl))
        .catch(() => resolve(null));
    };

    input.click();
  });
};

const calculateServiceCharge = (subtotal: number, percentage?: number, apply?: boolean) => {
  if (!apply || !percentage) return 0;
  return subtotal * (percentage / 100);
}

const calculateTaxes = (subtotal: number, taxes?: Tax[]) => {
  if (!taxes) return [];
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
    if (!Number.isFinite(value) || value <= 0) continue;

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
  if (!isoOrString) return "";
  const d = new Date(isoOrString);
  if (Number.isNaN(d.getTime())) return String(isoOrString);
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

export default function OrdersPage() {
  
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { toast } = useToast();
  const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager") => {
    if (!user) return false;
    if (user.role === role) return true;
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
  const [tables, setTables] = useState<{ id: number; name: string; capacity: number }[]>([]);
  const [monthlyApcInsight, setMonthlyApcInsight] = useState<MonthlyApcInsight | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [defaultTax, setDefaultTax] = useState<Record<string, number> | null>(null);
  const [isDefaultTaxDialogOpen, setIsDefaultTaxDialogOpen] = useState(false);
  const [isProofPreviewOpen, setIsProofPreviewOpen] = useState(false);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);

  const displayOrders = useMemo(() => dedupeOrdersById(orders), [orders]);

  const orderApcByOrderId = useMemo(() => {
    const map = new Map<string, MonthlyApcInsight["orders"][number]>();
    for (const item of monthlyApcInsight?.orders ?? []) {
      map.set(String(item.order_id), item);
    }
    return map;
  }, [monthlyApcInsight]);

  useEffect(() => {
    if (!user?.restaurantUsername) {
      setOrders([]);
      setMenuItems([]);
      setMonthlyApcInsight(null);
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

  // Refresh tables when realtime table events occur
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const detail = e?.detail as { event: string } | undefined;
        if (!detail) return;
        if (detail.event === 'table:added' || detail.event === 'table:deleted' || detail.event === 'table:updated') {
          if (user?.restaurantUsername) getTables(user.restaurantUsername).then(t => setTables(Array.isArray(t) ? t : [])).catch(() => {});
        }
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('realtime:event', handler as EventListener);
    return () => window.removeEventListener('realtime:event', handler as EventListener);
  }, [user]);

  const triggerPrint = (order: Order) => {
    let calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
    if ((!calculatedTaxes || calculatedTaxes.length === 0) && defaultTax) {
      calculatedTaxes = Object.keys(defaultTax).map((name, i) => ({ id: `d${i}`, name, percentage: Number(defaultTax[name]), amount: order.subtotal * (Number(defaultTax[name]) / 100) }));
    }
    const orderWithCalculatedCharges = {
        ...order,
        serviceCharge: calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge),
        calculatedTaxes,
        currencySymbol,
    };
      const storageKey = storePrintBillPayload(orderWithCalculatedCharges);
      const url = `/dashboard/orders/print?orderKey=${encodeURIComponent(storageKey)}`;
    window.open(url, '_blank');
  }
  
  const handleAddOrder = async (newOrderData: { tableId: number; items: { id?: string; name: string; price: number; quantity?: number; note?: string | null }[] }) => {
    if (!user?.restaurantUsername) return;
    const items = newOrderData.items.map(it => ({
      id: it.id ?? `i${Date.now()}${Math.random().toString(36).slice(2,5)}`,
      name: it.name,
      quantity: Math.max(1, Number(it.quantity ?? 1)),
      price: Number(it.price ?? 0),
      orderedAt: new Date().toISOString(),
      note: typeof it.note === "string" && it.note.trim().length > 0 ? it.note.trim() : null,
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
      await addOrder(user.restaurantUsername, newOrder);
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
          const existingItem = order.items.find(item => item.name.toLowerCase() === itemName.toLowerCase());

          let newItems;
          if (existingItem) {
            newItems = order.items.map(item => item.id === existingItem.id ? { ...item, quantity: item.quantity + 1 } : item);
          } else {
            newItems = [...order.items, {
              id: `i${Date.now()}`,
              name: itemName,
              quantity: 1,
              price: itemPrice,
              orderedAt: new Date().toISOString()
            }];
          }
                
          const newSubtotal = newItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
          const newTotal = calculateTotal({ ...order, items: newItems, subtotal: newSubtotal });
          return { ...order, items: newItems, subtotal: newSubtotal, total: newTotal };
        }
        return order;
      });

      const newSelected = selectedOrder ? updated.find(o => o.id === selectedOrder.id) ?? null : null;
      if (selectedOrder && newSelected) setSelectedOrder(newSelected);
      return updated;
    });
  }

  const handleRemoveItemFromOrder = (orderId: string, itemId: string) => {
    setOrders((prev) => {
      const updated = prev.map(order => {
        if(order.id === orderId) {
          const newItems = order.items.filter(item => item.id !== itemId);
          const newSubtotal = newItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
          const newTotal = calculateTotal({ ...order, items: newItems, subtotal: newSubtotal });
          return { ...order, items: newItems, subtotal: newSubtotal, total: newTotal };
        }
        return order;
      });

      const newSelected = selectedOrder ? updated.find(o => o.id === selectedOrder.id) ?? null : null;
      if (selectedOrder && newSelected) setSelectedOrder(newSelected);
      return updated;
    });
  }

  const handleDeleteOrder = async (orderId: string) => {
    if (!user?.restaurantUsername) return;
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
      toast({ title: "Error", description: "Failed to delete order", variant: "destructive" });
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

    if (!user?.restaurantUsername) return;

    const current = orders.find(o => o.id === orderId);
    if (!current) return;

    const updatedOrder: Order = { ...current, status };

    try {
      // persist via AddOrder upsert endpoint
      await addOrder(user.restaurantUsername, updatedOrder);
      const refreshed = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(refreshed) ? refreshed : []);
    } catch (err) {
      console.error('failed to persist order status', err);
      // on error, revert optimistic update by reloading
      try {
        const refreshed = await getOrders(user.restaurantUsername);
        setOrders(Array.isArray(refreshed) ? refreshed : []);
      } catch (e) {
        // ignore
      }
    }
  };

  const handleSetBillVerification = async (order: Order) => {
    if (!user?.restaurantUsername) return;
    const confirmed = window.confirm(
      'Confirm move to Bill Verification? This action cannot be undone and you will not be able to revert to Preparing or Served.',
    );
    if (!confirmed) return;

    try {
      // decide which taxes to apply: prefer order.taxes if present, otherwise use defaultTax
      let taxesToApply: Tax[] | undefined = order.taxes && order.taxes.length ? order.taxes : undefined;
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
      alert('Unable to create bill. Please try again.');
    }
  };

  const handleReplaceBill = async (order: Order, replacement: { items: OrderItem[]; taxes: { id?: string; name: string; percentage: number }[]; serviceChargePercentage?: number | undefined; applyServiceCharge?: boolean; reason: string; }) => {
    if (!user?.restaurantUsername) return;
    if (!replacement.reason || !replacement.reason.trim()) {
      alert('Reason is required');
      return;
    }

    const confirmed = window.confirm('This will cancel the existing order and bill and create a new order and bill. Continue?');
    if (!confirmed) return;

    try {
      const subtotal = replacement.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
      const serviceCharge = replacement.applyServiceCharge && replacement.serviceChargePercentage ? subtotal * (replacement.serviceChargePercentage / 100) : 0;
      const tax_breakdown = (replacement.taxes || []).map((t) => ({ name: t.name, percentage: t.percentage, amount: Number(((subtotal) * (t.percentage/100)).toFixed(2)) }));
      const totalAmt = Math.max(0, subtotal + serviceCharge + tax_breakdown.reduce((acc, t) => acc + (Number(t.amount) || 0), 0));

      const payload = {
        old_order_id: order.id,
        reason: replacement.reason,
        new_order: {
          table: order.table,
          customer: order.customer,
          taken_by_employee_id: order.taken_by_employee_id ?? null,
          taken_by_employee_name: order.taken_by_employee_name ?? null,
          taken_by_employee_role: order.taken_by_employee_role ?? null,
          items: replacement.items,
          subtotal,
          serviceChargePercentage: replacement.serviceChargePercentage ?? order.serviceChargePercentage,
          applyServiceCharge: replacement.applyServiceCharge ?? order.applyServiceCharge,
          taxes: replacement.taxes,
        },
        new_bill: {
          total_amt: totalAmt,
          emp_id: user.employeeId ?? null,
          status: 1,
          tax_breakdown,
        },
      } as const;

      const result = await replaceBill(user.restaurantUsername, payload);
      if (!result) throw new Error('Replace failed');

      // refresh orders list and APC data to show cancelled + new order
      const [updatedOrders, updatedApcInsight] = await Promise.all([
        getOrders(user.restaurantUsername),
        getMonthlyApcInsight(user.restaurantUsername),
      ]);
      setOrders(Array.isArray(updatedOrders) ? updatedOrders : []);
      setMonthlyApcInsight(updatedApcInsight ?? null);
      // also poll once after a short delay in case backend propagation is slightly delayed
      setTimeout(async () => {
        try {
          const [later, laterApc] = await Promise.all([
            getOrders(user.restaurantUsername),
            getMonthlyApcInsight(user.restaurantUsername),
          ]);
          if (Array.isArray(later)) setOrders(dedupeOrdersById(later));
          if (laterApc) setMonthlyApcInsight(laterApc);
        } catch (e) {
          // ignore
        }
      }, 700);

      setIsEditDialogOpen(false);
      setSelectedOrder(null);
    } catch (err: any) {
      console.error('replace bill failed', err);
      alert('Failed to replace bill: ' + String(err?.message ?? err));
    }
  };

  const handleWaiterConfirmPayment = async (order: Order, paymentMethod: PaymentMethod) => {
    if (!user?.restaurantUsername || !user.employeeId) return;
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

    const confirmed = window.confirm(
      `Confirm payment by ${paymentMethod}? This sends the bill for admin approval.`,
    );
    if (!confirmed) return;

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
      await addAuditLogEntry(user.restaurantUsername, {
        employee: actorName,
        employeeId: user.employeeId,
        action: 'Bill Payment Confirmed',
        details: `Waiter confirmed payment for order ${order.id} via ${paymentMethod}`,
      });
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
      alert('Payment confirmation submitted. Awaiting admin approval.');
    } catch (err: any) {
      console.error('failed to confirm payment', err);
      alert(String(err?.message ?? 'Unable to confirm payment.'));
    }
  };

  const handleAdminApprovePayment = async (order: Order) => {
    if (!user?.restaurantUsername || !user.employeeId) return;
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

    const confirmed = window.confirm('Approve this waiter-confirmed payment?');
    if (!confirmed) return;

    try {
      await approveBillPaymentByAdmin(user.restaurantUsername, user.employeeId, order.id);
      const actorName = user.employeeUsername
        || `${user.emp_Fname ?? ''} ${user.emp_Lname ?? ''}`.trim()
        || user.employeeId
        || 'System';
      await addAuditLogEntry(user.restaurantUsername, {
        employee: actorName,
        employeeId: user.employeeId,
        action: 'Bill Payment Approved',
        details: `Admin approved payment for order ${order.id}`,
      });
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
    } catch (err: any) {
      console.error('failed to approve payment', err);
      alert(String(err?.message ?? 'Unable to approve payment.'));
    }
  };

  const handleCloseBill = async (order: Order) => {
    if (!user?.restaurantUsername || !user.employeeId) return;
    if (!hasRole('admin')) {
      showRoleRequiredToast('admin');
      return;
    }
    const confirmed = window.confirm('Close this bill? This finalizes the order.');
    if (!confirmed) return;

    try {
      await closeBillByOrder(user.restaurantUsername, user.employeeId, order.id);
      const actorName = user.employeeUsername
        || `${user.emp_Fname ?? ''} ${user.emp_Lname ?? ''}`.trim()
        || user.employeeId
        || 'System';
      await addAuditLogEntry(user.restaurantUsername, {
        employee: actorName,
        employeeId: user.employeeId,
        action: 'Bill Closed',
        details: `Admin closed bill for order ${order.id}`,
      });
      const updatedOrders = await getOrders(user.restaurantUsername);
      setOrders(Array.isArray(updatedOrders) ? dedupeOrdersById(updatedOrders) : []);
    } catch (err: any) {
      console.error('failed to close bill', err);
      alert(String(err?.message ?? 'Unable to close bill.'));
    }
  };

  const getApcBadgeClass = (zone?: "red" | "yellow" | "green") => {
    if (zone === "green") return "bg-green-100 text-green-800 border-green-200";
    if (zone === "yellow") return "bg-yellow-100 text-yellow-900 border-yellow-200";
    if (zone === "red") return "bg-red-100 text-red-800 border-red-200";
    return "";
  };


  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Orders</h1>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Order
            </Button>
          </DialogTrigger>
          {isAdmin ? (
            <Button variant="outline" className="ml-2" onClick={() => setIsDefaultTaxDialogOpen(true)}>Modify Default Tax</Button>
          ) : null}
          <DialogContent className="sm:max-w-2xl w-full">
            <DialogHeader>
              <DialogTitle>Add New Order</DialogTitle>
              <DialogDescription>
                Fill in the details for the new order.
              </DialogDescription>
            </DialogHeader>
            <OrderForm onSubmit={handleAddOrder} menuItems={menuItems} tables={tables} />
          </DialogContent>
        </Dialog>
      </div>
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
                <TableRow key={order.id} onClick={() => handleRowClick(order)} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <div>{order.table}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.items.map(i => `${i.quantity}x ${i.name}${i.note ? ` (${i.note})` : ""}`).join(', ')}</div>
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
                    <Badge variant={getStatusVariant(order.status)}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isWaiterOnly ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                          disabled={
                            order.status === 'Bill Verification'
                            || order.status === 'Payment Pending Approval'
                            || order.status === 'Paid'
                            || order.status === 'Closed'
                            || order.status === 'Cancelled'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
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
                          onClick={(e) => {
                            e.stopPropagation();
                            runAdminAction(() => {
                              setSelectedOrder(order);
                              setIsEditDialogOpen(true);
                            });
                          }}
                        >
                          Edit Bill
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger onClick={(e) => {e.stopPropagation();}}>Update Status</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
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
                                  onClick={(e) => {
                                    e.stopPropagation();
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    runAdminAction(() => { void handleSetBillVerification(order); });
                                  }}
                                  disabled={
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
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger
                            onClick={(e) => { e.stopPropagation(); }}
                            disabled={order.status !== 'Bill Verification'}
                          >
                            Confirm Payment (Waiter)
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {PAYMENT_METHOD_OPTIONS.map((method) => (
                              <DropdownMenuItem
                                key={method}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleWaiterConfirmPayment(order, method);
                                }}
                                disabled={order.status !== 'Bill Verification'}
                              >
                                {method}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); void handleAdminApprovePayment(order); }}
                          disabled={order.status !== 'Payment Pending Approval'}
                        >
                          Approve Payment (Admin)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); void handleCloseBill(order); }}
                          disabled={order.status !== 'Paid'}
                        >
                          Close Bill (Admin)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={(e) => {
                            e.stopPropagation();
                            runAdminAction(() => {
                              if (confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
                                void handleDeleteOrder(order.id);
                              }
                            });
                          }}
                          disabled={
                            order.status === 'Payment Pending Approval'
                            || order.status === 'Paid'
                            || order.status === 'Closed'
                          }
                          className="text-red-600"
                        >
                          Delete Order
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); triggerPrint(order); }}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print Bill
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              )})}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {selectedOrder && <OrderDetailsDialog
        order={selectedOrder}
        canEditPrice={isAdmin}
        open={isDetailsOpen}
        onOpenChange={(isOpen) => {
          setIsDetailsOpen(isOpen);
          if (!isOpen) setSelectedOrder(null);
        }}
        onSave={async (updatedOrder) => {
          if (!user?.restaurantUsername) return;
          try {
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
          if (!isOpen) setSelectedOrder(null);
        }}
      />}

        {selectedOrder && <EditOrderDialog
          key={selectedOrder.id}
          order={selectedOrder} 
          open={isEditDialogOpen}
          onOpenChange={(isOpen) => {
            if(!isOpen) setSelectedOrder(null);
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
          if (!open) setProofPreviewUrl(null);
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
              <img
                src={proofPreviewUrl}
                alt="Payment proof screenshot"
                className="h-auto w-full rounded-md object-contain"
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No screenshot available.</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProofPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderForm({ onSubmit, menuItems, tables }: { onSubmit: (data: { tableId: number; items: { id?: string; name: string; price: number; quantity?: number; note?: string | null }[] }) => Promise<void> | void; menuItems: MenuItem[]; tables: { id: number; name: string; capacity: number }[] }) {
  const { currencySymbol } = useCurrency();
  const [selectedTableId, setSelectedTableId] = useState<string>(tables?.[0]?.id?.toString() ?? '');
  const [selectedItemValue, setSelectedItemValue] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState<number>(1);
  const [selectedNote, setSelectedNote] = useState("");
  const [itemsList, setItemsList] = useState<{ id?: string; name: string; price: number; quantity: number; note?: string | null }[]>([]);

  useEffect(() => {
    if (tables && tables.length && !selectedTableId) {
      setSelectedTableId(tables[0].id.toString());
    }
  }, [tables]);

  const menuOptions = menuItems.map(item => ({ value: item.name.toLowerCase(), label: item.name }));
  const tableOptions = tables.map(t => ({ value: String(t.id), label: t.name }));

  const addItem = () => {
    const name = selectedItemValue.trim();
    const selectedMenuItem = menuItems.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!selectedMenuItem) return;
    const price = Number(selectedMenuItem.price || 0);
    const note = selectedNote.trim();
    setItemsList(prev => {
      const existing = prev.find(
        p => p.name.toLowerCase() === name.toLowerCase() && String(p.note ?? "") === note,
      );
      if (existing) {
        return prev.map(p =>
          p.name.toLowerCase() === name.toLowerCase() && String(p.note ?? "") === note
            ? { ...p, quantity: p.quantity + selectedQuantity }
            : p,
        );
      }
      return [...prev, { id: undefined, name, price, quantity: selectedQuantity, note: note || null }];
    });
    setSelectedItemValue("");
    setSelectedQuantity(1);
    setSelectedNote("");
  };

  const removeItem = (name: string, note?: string | null) => {
    setItemsList(prev => prev.filter(p => !(p.name === name && String(p.note ?? "") === String(note ?? ""))));
  };

  const subtotal = itemsList.reduce((acc, it) => acc + it.price * it.quantity, 0);

  const handleSubmit = () => {
    const tableIdNum = Number(selectedTableId);
    if (!selectedTableId || Number.isNaN(tableIdNum) || itemsList.length === 0) return;
    void onSubmit({ tableId: tableIdNum, items: itemsList });
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
      <Label htmlFor="table" className="text-right">Table</Label>
      <div className="col-span-3">
        <Combobox
          options={tableOptions}
          value={selectedTableId}
          onChange={(value) => setSelectedTableId(String(value ?? ''))}
          placeholder="Select a table"
          searchPlaceholder="Search tables..."
          emptyPlaceholder="No tables available"
        />
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
        <Input placeholder="Qty" type="number" value={String(selectedQuantity)} onChange={e => setSelectedQuantity(Math.max(1, Number(e.target.value) || 1))} className="col-span-4" />
        <Button onClick={addItem} className="col-span-2">Add</Button>
      </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="item-note" className="text-right">Note</Label>
        <Input
          id="item-note"
          placeholder="No onion, extra spicy, etc."
          value={selectedNote}
          onChange={(e) => setSelectedNote(e.target.value)}
          className="col-span-3"
        />
      </div>

      <div>
      {itemsList.length === 0 ? (
        <div className="text-sm text-muted-foreground">No items added.</div>
      ) : (
        <div className="space-y-2">
          {itemsList.map(it => (
            <div key={`${it.name}-${String(it.note ?? "")}`} className="flex items-center justify-between">
              <div>
                <div>{it.quantity}x {it.name}</div>
                {it.note ? <div className="text-xs text-muted-foreground">Note: {it.note}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <div>{currencySymbol}{(it.price * it.quantity).toFixed(2)}</div>
                <Button variant="ghost" size="icon" onClick={() => removeItem(it.name, it.note)}><X className="h-4 w-4"/></Button>
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
        if (!k) continue;
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
    if (!selectedMenuItem) return;
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

  const handleRemoveItem = (id: string) => setLocalItems(prev => prev.filter(i => i.id !== id));

  const handleSubmit = async () => {
    const updatedOrder = {
      ...order,
      serviceChargePercentage: serviceChargePerc ? parseFloat(serviceChargePerc) : undefined,
      taxes: taxes.filter(t => t.name && t.percentage > 0),
      applyServiceCharge,
      items: localItems,
    };

    if (onReplace) {
      if (!reason || !reason.trim()) {
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
            <Input id="serviceCharge" type="number" value={serviceChargePerc} onChange={(e) => setServiceChargePerc(e.target.value)} className="col-span-2" placeholder="e.g., 10" disabled={!applyServiceCharge} />
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
                        <Input type="number" value={String(item.quantity)} onChange={(e) => setLocalItems(prev => prev.map(p => p.id === item.id ? { ...p, quantity: Math.max(1, Number(e.target.value) || 1) } : p))} className="w-16 mx-auto" />
                      </TableCell>
                      <TableCell className="text-right">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(item.id)}>
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
                onChange={(e) => setNewItemNote(e.target.value)}
                className="col-span-4"
              />
              <Input placeholder="Qty" type="number" value={String(newItemQuantity)} onChange={(e) => setNewItemQuantity(Math.max(1, Number(e.target.value) || 1))} className="col-span-2" />
              <Button onClick={handleAddItem} className="col-span-1">Add</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-y-2">
            <Label>Taxes</Label>
            <div className="space-y-2">
              {taxes.map((tax) => (
                <div key={tax.id} className="grid grid-cols-12 items-center gap-2">
                  <Input placeholder="Tax Name (e.g., VAT)" value={tax.name} onChange={(e) => handleTaxChange(tax.id, "name", e.target.value)} className="col-span-7" />
                  <Input placeholder="%" type="number" value={tax.percentage} onChange={(e) => handleTaxChange(tax.id, "percentage", e.target.value)} className="col-span-3" />
                  <Button variant="ghost" size="icon" onClick={() => removeTax(tax.id)} className="col-span-2"><X className="h-4 w-4" /></Button>
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
              onChange={e => setReason(e.target.value)}
              className="w-full border rounded p-2 mt-1"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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

  useEffect(() => {
    if (open && order) {
      setLocalItems(order.items.map(i => ({ ...i })));
      setNewItemName("");
      setNewItemNote("");
    }
  }, [open, order]);

  if (!order) return null;

  const handleAddItem = () => {
    const itemName = newItemName.trim();
    const selectedMenuItem = menuItems.find(item => item.name.toLowerCase() === itemName.toLowerCase());
    if (!selectedMenuItem) {
      return;
    }
    const normalizedNote = newItemNote.trim();

    setLocalItems(prev => {
      const nameLower = selectedMenuItem.name.trim().toLowerCase();
      const existing = prev.find(i => i.name.trim().toLowerCase() === nameLower && String(i.note ?? "") === normalizedNote);
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
      };
      return [...prev, newItem];
    });
    setNewItemName("");
    setNewItemNote("");
  };

  const handleRemove = (itemId: string) => {
    setLocalItems(prev => prev.filter(i => i.id !== itemId));
  };

  const subtotal = localItems.reduce((acc, it) => acc + it.price * it.quantity, 0);
  const serviceCharge = calculateServiceCharge(subtotal, order.serviceChargePercentage, order.applyServiceCharge);
  const calculatedTaxes = calculateTaxes(subtotal, order.taxes);
  const totalTaxAmount = calculatedTaxes.reduce((sum, tax) => sum + tax.amount, 0);
  const total = subtotal + serviceCharge + totalTaxAmount;

  const menuOptions = menuItems.map(item => ({ value: item.name.toLowerCase(), label: item.name }));

  const handleSave = async () => {
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
              <Badge variant={order.status === "Preparing" ? "secondary" : order.status === "Served" ? "default" : "outline"} className="text-xs">{order.status}</Badge>
            </span>
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
                      <div>{item.name}</div>
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
                      <Button variant="ghost" size="icon" onClick={() => handleRemove(item.id)}>
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
              className="col-span-6"
            />
            <Input
              placeholder="Note"
              value={newItemNote}
              onChange={(e) => setNewItemNote(e.target.value)}
              className="col-span-5"
            />
            <Button onClick={handleAddItem} className="col-span-1">Add</Button>
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
          <Button variant="outline" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
OrderDetailsDialog.displayName = "OrderDetailsDialog";

const OrderViewDialog = React.memo(({ order, open, onOpenChange }: { order: Order | null, open: boolean, onOpenChange: (open: boolean) => void }) => {
  const { currencySymbol } = useCurrency();
  if (!order) return null;

  const calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
  const serviceCharge = calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge);
  const totalTaxAmount = calculatedTaxes.reduce((sum, t) => sum + t.amount, 0);
  const total = order.subtotal + serviceCharge + totalTaxAmount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>View Order - {order.table}</DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2">
              <span>Status:</span>
              <Badge variant={order.status === 'Preparing' ? 'secondary' : order.status === 'Served' ? 'default' : 'outline'} className="text-xs">{order.status}</Badge>
            </span>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div>{item.name}</div>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
          <Button onClick={() => onOpenChange(false)}>Close</Button>
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
      if (defaultTax && typeof defaultTax === 'object') {
        setTaxes(Object.keys(defaultTax).map((k, i) => ({ id: `t${i}-${k}`, name: k, percentage: Number(defaultTax[k]) })));
      } else {
        setTaxes([]);
      }
    }
  }, [open, defaultTax]);

  const addTax = () => setTaxes(prev => [...prev, { id: `t${Date.now()}`, name: '', percentage: 0 }]);
  const removeTax = (id: string) => setTaxes(prev => prev.filter(t => t.id !== id));
  const updateTax = (id: string, field: 'name' | 'percentage', value: string) => {
    setTaxes(prev => prev.map(t => t.id === id ? { ...t, [field]: field === 'percentage' ? (parseFloat(value) || 0) : value } : t));
  };

  const handleSave = async () => {
    const payload: Record<string, number> = {};
    for (const t of taxes) {
      if (t.name && !Number.isNaN(t.percentage)) payload[t.name] = Number(t.percentage);
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
              <Input value={t.name} placeholder="Tax name" onChange={e => updateTax(t.id, 'name', e.target.value)} className="col-span-7" />
              <Input value={String(t.percentage)} placeholder="%" type="number" onChange={e => updateTax(t.id, 'percentage', e.target.value)} className="col-span-3" />
              <Button variant="ghost" size="icon" onClick={() => removeTax(t.id)} className="col-span-2"><X className="h-4 w-4"/></Button>
            </div>
          ))}
          <Button variant="outline" onClick={addTax}>Add Tax</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
DefaultTaxDialog.displayName = 'DefaultTaxDialog';
