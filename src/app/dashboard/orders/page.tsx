
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
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { getMenuItems, getOrders, addOrder, getMonthlyApcInsight, type MonthlyApcInsight } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import type { MenuItem } from "../menu/data";


type OrderItem = {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
};

export type OrderStatus = "Preparing" | "Served" | "Paid";

type Tax = {
  id: string;
  name: string;
  percentage: number;
};

export type Order = {
  id: string;
  table: string;
  customer: string;
  items: OrderItem[];
  subtotal: number;
  serviceChargePercentage?: number;
  taxes?: Tax[];
  applyServiceCharge: boolean;
  total: number;
  status: OrderStatus;
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

export default function OrdersPage() {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [monthlyApcInsight, setMonthlyApcInsight] = useState<MonthlyApcInsight | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const orderApcByOrderId = useMemo(() => {
    const map = new Map<string, MonthlyApcInsight["orders"][number]>();
    for (const item of monthlyApcInsight?.orders ?? []) {
      map.set(String(item.order_id), item);
    }
    return map;
  }, [monthlyApcInsight]);

  useEffect(() => {
    if (!user?.restaurantId) {
      setOrders([]);
      setMenuItems([]);
      setMonthlyApcInsight(null);
      return;
    }

    let isActive = true;

    const loadData = async () => {
      try {
        const [ordersData, menuData, apcInsight] = await Promise.all([
          getOrders(user.restaurantId),
          getMenuItems(user.restaurantId),
          getMonthlyApcInsight(user.restaurantId),
        ]);

        if (!isActive) {
          return;
        }

        setOrders(Array.isArray(ordersData) ? ordersData : []);
        setMenuItems(Array.isArray(menuData) ? menuData : []);
        setMonthlyApcInsight(apcInsight ?? null);
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

  const triggerPrint = (order: Order) => {
    const calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
    const orderWithCalculatedCharges = {
        ...order,
        serviceCharge: calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge),
        calculatedTaxes,
        currencySymbol,
    };
    const orderData = encodeURIComponent(JSON.stringify(orderWithCalculatedCharges));
    const url = `/dashboard/orders/print?order=${orderData}`;
    window.open(url, '_blank');
    updateOrderStatus(order.id, "Paid");
  }
  
  const handleAddOrder = async (newOrderData: Omit<Order, 'id' | 'status' | 'items' | 'subtotal' | 'total' | 'applyServiceCharge'> & { items: string, subtotal: string }) => {
    if (!user?.restaurantId) return;
    const subtotal = parseFloat(newOrderData.subtotal);
    const selectedMenuItem = menuItems.find(item => item.name.toLowerCase() === newOrderData.items.toLowerCase());
    
    const newOrder: Order = {
        id: (orders.length + 1).toString(),
        table: newOrderData.table,
        customer: newOrderData.customer,
        status: "Preparing",
        items: [{
            id: `i${Date.now()}`,
            name: selectedMenuItem ? selectedMenuItem.name : newOrderData.items,
            quantity: 1,
            price: selectedMenuItem ? selectedMenuItem.price : subtotal,
            orderedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'})
        }],
        subtotal: selectedMenuItem ? selectedMenuItem.price : subtotal,
        total: selectedMenuItem ? selectedMenuItem.price : subtotal,
        applyServiceCharge: true,
    };
    try {
      await addOrder(user.restaurantId, newOrder);
      const updatedOrders = await getOrders(user.restaurantId);
      setOrders(Array.isArray(updatedOrders) ? updatedOrders : []);
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
    setOrders(orders.map(order => {
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
                    orderedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'})
                }];
            }
            
            const newSubtotal = newItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
            const newTotal = calculateTotal({ ...order, items: newItems, subtotal: newSubtotal });
            return { ...order, items: newItems, subtotal: newSubtotal, total: newTotal };
        }
        return order;
    }));
  }

  const handleRemoveItemFromOrder = (orderId: string, itemId: string) => {
     setOrders(orders.map(order => {
        if(order.id === orderId) {
            const newItems = order.items.filter(item => item.id !== itemId);
            const newSubtotal = newItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
            const newTotal = calculateTotal({ ...order, items: newItems, subtotal: newSubtotal });
            return { ...order, items: newItems, subtotal: newSubtotal, total: newTotal };
        }
        return order;
    }));
  }


  const getStatusVariant = (status: string) => {
    switch (status) {
      case "Preparing":
        return "secondary";
      case "Served":
        return "default";
      case "Paid":
        return "outline";
      default:
        return "outline";
    }
  };
  
  const handleRowClick = (order: Order) => {
    setSelectedOrder(order);
    setIsDetailsOpen(true);
  }

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(orders.map(order => order.id === orderId ? { ...order, status } : order));
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
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Order</DialogTitle>
              <DialogDescription>
                Fill in the details for the new order.
              </DialogDescription>
            </DialogHeader>
            <OrderForm onSubmit={handleAddOrder} menuItems={menuItems} />
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
              {orders.map((order) => {
                const apcInsight = orderApcByOrderId.get(String(order.id));
                return (
                <TableRow key={order.id} onClick={() => handleRowClick(order)} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <div>{order.table}</div>
                    <div className="text-sm text-muted-foreground">{order.customer}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</div>
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRowClick(order)}}>View Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); setIsEditDialogOpen(true); }}>Edit Bill</DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Update Status</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuItem onClick={(e) => {e.stopPropagation(); updateOrderStatus(order.id, 'Preparing')}}>Preparing</DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => {e.stopPropagation(); updateOrderStatus(order.id, 'Served')}}>Served</DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => {e.stopPropagation(); updateOrderStatus(order.id, 'Paid')}}>Paid</DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); triggerPrint(order); }}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print Bill
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )})}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {selectedOrder && <OrderDetailsDialog 
        order={selectedOrder} 
        open={isDetailsOpen} 
        onOpenChange={(isOpen) => { 
          if (!isOpen) setSelectedOrder(null);
          setIsDetailsOpen(isOpen);
        }}
        onAddItem={handleAddItemToOrder}
        onRemoveItem={handleRemoveItemFromOrder}
        menuItems={menuItems}
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
        />}
    </div>
  );
}

function OrderForm({ onSubmit, menuItems }: { onSubmit: (data: Omit<Order, 'id' | 'status' | 'items' | 'subtotal' | 'total' | 'applyServiceCharge'> & { items: string, subtotal: string }) => Promise<void> | void, menuItems: MenuItem[] }) {
    const [table, setTable] = useState("");
    const [customer, setCustomer] = useState("");
    const [items, setItems] = useState("");
    const [subtotal, setSubtotal] = useState("");

  const handleSubmit = () => {
        if(table && customer && items && subtotal) {
      void onSubmit({
                table,
                customer,
                items,
                subtotal
            });
        }
    }
    
    const menuOptions = menuItems.map(item => ({ value: item.name.toLowerCase(), label: item.name }));

    return (
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="table" className="text-right">Table</Label>
            <Input id="table" value={table} onChange={(e) => setTable(e.target.value)} className="col-span-3" placeholder="e.g., T5" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="customer" className="text-right">Customer</Label>
            <Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} className="col-span-3" placeholder="John Doe" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="items" className="text-right">Items</Label>
            <div className="col-span-3">
                 <Combobox
                    options={menuOptions}
                    value={items.toLowerCase()}
                    onChange={(value) => {
                        const selectedItem = menuItems.find(item => item.name.toLowerCase() === value);
                        setItems(selectedItem?.name || "");
                        setSubtotal(selectedItem?.price.toString() || "");
                    }}
                    placeholder="Select an item"
                    searchPlaceholder="Search for an item..."
                    emptyPlaceholder="No items found."
                />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="subtotal" className="text-right">Item Price</Label>
            <Input id="subtotal" type="number" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} className="col-span-3" placeholder="e.g., 14.00" disabled />
          </div>
          <DialogFooter>
            <Button onClick={handleSubmit}>Save Order</Button>
          </DialogFooter>
        </div>
    )
}

const EditOrderDialog = React.memo(({ order, open, onOpenChange, onSubmit }: { order: Order, open: boolean, onOpenChange: (open: boolean) => void, onSubmit: (data: Omit<Order, 'total'>) => void}) => {
    const { currencySymbol } = useCurrency();
    const [serviceChargePerc, setServiceChargePerc] = useState(order.serviceChargePercentage?.toString() || "");
    const [taxes, setTaxes] = useState<Tax[]>(order.taxes || []);
    const [applyServiceCharge, setApplyServiceCharge] = useState(order.applyServiceCharge);
    
    useEffect(() => {
        setServiceChargePerc(order.serviceChargePercentage?.toString() || "");
        setTaxes(order.taxes || []);
        setApplyServiceCharge(order.applyServiceCharge);
    }, [order]);

    const handleTaxChange = (id: string, field: 'name' | 'percentage', value: string) => {
        setTaxes(taxes.map(tax => tax.id === id ? { ...tax, [field]: field === 'percentage' ? (parseFloat(value) || 0) : value } : tax));
    }

    const addTax = () => {
        setTaxes([...taxes, { id: `t${Date.now()}`, name: "", percentage: 0 }]);
    }
    
    const removeTax = (id: string) => {
        setTaxes(taxes.filter(tax => tax.id !== id));
    }

    const handleSubmit = () => {
        const updatedOrder = {
            ...order,
            serviceChargePercentage: serviceChargePerc ? parseFloat(serviceChargePerc) : undefined,
            taxes: taxes.filter(t => t.name && t.percentage > 0),
            applyServiceCharge,
        };
        onSubmit(updatedOrder);
    }
    
    const serviceChargeAmount = calculateServiceCharge(order.subtotal, parseFloat(serviceChargePerc), applyServiceCharge);
    const calculatedTaxesWithAmounts = calculateTaxes(order.subtotal, taxes);
    const totalTaxAmount = calculatedTaxesWithAmounts.reduce((acc, tax) => acc + tax.amount, 0);
    const totalAmount = order.subtotal + serviceChargeAmount + totalTaxAmount;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Edit Bill - {order.table}</DialogTitle>
                    <DialogDescription>
                       Add service charges and taxes. These are percentage-based.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="subtotal">Subtotal</Label>
                        <Input id="subtotal" type="number" value={order.subtotal.toFixed(2)} className="col-span-2" disabled />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label>Service Charge</Label>
                        <div className="col-span-2 flex items-center space-x-2">
                            <Switch id="applyServiceCharge" checked={applyServiceCharge} onCheckedChange={setApplyServiceCharge}/>
                            <Label htmlFor="applyServiceCharge" className="text-sm font-normal">{applyServiceCharge ? 'Enabled' : 'Disabled'}</Label>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="serviceCharge">Percentage (%)</Label>
                        <Input id="serviceCharge" type="number" value={serviceChargePerc} onChange={(e) => setServiceChargePerc(e.target.value)} className="col-span-2" placeholder="e.g., 10" disabled={!applyServiceCharge}/>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-y-2">
                        <Label>Taxes</Label>
                        <div className="space-y-2">
                            {taxes.map((tax) => (
                                <div key={tax.id} className="grid grid-cols-12 items-center gap-2">
                                    <Input placeholder="Tax Name (e.g., VAT)" value={tax.name} onChange={(e) => handleTaxChange(tax.id, 'name', e.target.value)} className="col-span-7"/>
                                    <Input placeholder="%" type="number" value={tax.percentage} onChange={(e) => handleTaxChange(tax.id, 'percentage', e.target.value)} className="col-span-3"/>
                                    <Button variant="ghost" size="icon" onClick={() => removeTax(tax.id)} className="col-span-2"><X className="h-4 w-4"/></Button>
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
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
});
EditOrderDialog.displayName = 'EditOrderDialog';

const OrderDetailsDialog = React.memo(({ order, open, onOpenChange, onAddItem, onRemoveItem, menuItems }: { order: Order | null, open: boolean, onOpenChange: (open: boolean) => void, onAddItem: (orderId: string, name: string, price: number) => void, onRemoveItem: (orderId: string, itemId: string) => void, menuItems: MenuItem[] }) => {
    const { currencySymbol } = useCurrency();
    const [newItemName, setNewItemName] = useState("");
    const [newItemPrice, setNewItemPrice] = useState("");
    
    useEffect(() => {
        const selectedMenuItem = menuItems.find(item => item.name.toLowerCase() === newItemName.toLowerCase());
        if (selectedMenuItem) {
            setNewItemPrice(selectedMenuItem.price.toString());
        } else {
            setNewItemPrice("");
        }
    }, [newItemName, menuItems]);

    if (!order) return null;

    const handleAddItem = () => {
        if(newItemName && newItemPrice) {
            onAddItem(order.id, newItemName, parseFloat(newItemPrice));
            setNewItemName("");
            setNewItemPrice("");
        }
    }

    const serviceCharge = calculateServiceCharge(order.subtotal, order.serviceChargePercentage, order.applyServiceCharge);
    const calculatedTaxes = calculateTaxes(order.subtotal, order.taxes);
    const totalTaxAmount = calculatedTaxes.reduce((sum, tax) => sum + tax.amount, 0);
    const total = order.subtotal + serviceCharge + totalTaxAmount;
    
    const menuOptions = menuItems.map(item => ({ value: item.name.toLowerCase(), label: item.name }));


    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Order Details - {order.table}</DialogTitle>
                     <DialogDescription>
                        <span className="flex items-center gap-2">
                            <span>Customer: {order.customer} | Status:</span>
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
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {order.items.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.name}</TableCell>
                                        <TableCell className="text-center">{item.quantity}</TableCell>
                                        <TableCell className="text-muted-foreground text-center">
                                          <div className="flex items-center justify-center">
                                            <Clock className="h-3 w-3 mr-1"/>
                                            {item.orderedAt}
                                          </div>
                                        </TableCell>
                                        <TableCell className="text-right">{currencySymbol}{(item.price * item.quantity).toFixed(2)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => onRemoveItem(order.id, item.id)}>
                                                <Trash2 className="h-4 w-4 text-destructive"/>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="grid grid-cols-6 gap-2 my-4 border-t pt-4">
                         <Combobox
                            options={menuOptions}
                            value={newItemName.toLowerCase()}
                            onChange={(value) => {
                                const selectedItem = menuItems.find(item => item.name.toLowerCase() === value);
                                setNewItemName(selectedItem?.name || value);
                            }}
                            placeholder="Select or type item"
                            searchPlaceholder="Search for an item..."
                            emptyPlaceholder="No items found."
                            className="col-span-3"
                        />
                        <Input placeholder="Price" type="number" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} className="col-span-2" disabled={menuItems.some(i => i.name.toLowerCase() === newItemName.toLowerCase())}/>
                        <Button onClick={handleAddItem} className="col-span-1">Add</Button>
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
            </DialogContent>
        </Dialog>
    )
});
OrderDetailsDialog.displayName = 'OrderDetailsDialog';
