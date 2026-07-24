
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Users, PlusCircle, MoreVertical, Trash2, GripVertical } from "lucide-react";
import { type Table } from "./data";
import {
    // addAuditLogEntry,
    occupyTable,
    releaseTable,
    updateTableCovers,
    getTables,
    getTableStatus,
    requestBackend,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragOverlay } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";

function SortableTable({
    table,
    occupancy,
    onRemove,
    onOpenOrders,
    onOccupy,
    onRelease,
    onUpdateCovers,
    busyTableName,
}: {
    table: Table;
    occupancy: { is_occupied: boolean; num_covers: number } | null;
    onRemove: (tableId: number) => void;
    onOpenOrders: (tableName: string, linkedOrderId?: string | null) => void;
    onOccupy: (tableName: string, numCovers: number) => void;
    onRelease: (tableName: string) => void;
    onUpdateCovers: (tableName: string, numCovers: number) => void;
    busyTableName: string | null;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: table.id });
    const [coverCount, setCoverCount] = useState(String(occupancy?.num_covers ?? table.capacity ?? 1));

    useEffect(() => {
        setCoverCount(String(occupancy?.num_covers ?? table.capacity ?? 1));
    }, [occupancy?.num_covers, table.capacity]);

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
    };

    const isOccupied = Boolean(occupancy?.is_occupied);
    // A table with an active booking window ("Booked") or an upcoming reservation
    // ("Reserved") is Reserved (blue) — clearly distinct from physically Occupied
    // (red) and still orderable/occupiable (the Occupy action below stays enabled).
    const isReserved = !isOccupied && (table.status === "Reserved" || table.status === "Booked");
    const parsedCoverCount = Math.max(1, Number(coverCount) || 1);
    const isBusy = busyTableName === table.name;
    
    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={cn(
                "transition-all touch-none min-w-0",
                isOccupied ? 'bg-red-950/40 border-red-900' : isReserved ? 'bg-blue-950/30 border-blue-800' : 'bg-slate-800/50 border-slate-700',
                isDragging ? 'opacity-50 shadow-2xl z-10' : 'hover:shadow-lg hover:border-slate-600'
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                <CardTitle className="text-xs font-medium sm:text-sm flex items-center gap-2 min-w-0">
                    <button {...listeners} {...attributes} className="cursor-grab p-1 shrink-0">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button type="button" className="truncate text-left hover:underline" title={table.name} onClick={() => { onOpenOrders(table.name); }}>
                        {table.name}
                    </button>
                </CardTitle>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); }} className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently delete the table &ldquo;{table.name}&rdquo;. This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => { onRemove(table.id); }} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="p-3 pt-0">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            variant={isOccupied ? 'destructive' : 'default'}
                            className={cn(
                                "text-[10px] sm:text-xs",
                                isOccupied && 'bg-red-600 text-white',
                                !isOccupied && isReserved && 'bg-blue-600 text-white'
                            )}
                        >
                            {isOccupied ? 'Occupied' : isReserved ? 'Reserved' : 'Available'}
                        </Badge>
                        {occupancy ? (
                            <Badge variant="outline" className="text-[10px] sm:text-xs bg-slate-700/50">
                                {occupancy.num_covers} covers
                            </Badge>
                        ) : null}
                        {isOccupied && table.order_otp ? (
                            <Badge className="text-[10px] sm:text-xs font-mono font-bold tracking-widest bg-amber-500 text-black hover:bg-amber-500">
                                OTP {table.order_otp}
                            </Badge>
                        ) : null}
                        {!isOccupied && isReserved ? (
                            <Badge variant="secondary" className="text-[10px] sm:text-xs">
                                {table.status === "Booked" ? "In booking window" : "Upcoming"}
                            </Badge>
                        ) : null}
                    </div>
                    <div className="flex items-center text-muted-foreground text-xs">
                        <Users className="h-3 w-3 mr-1" />
                        <span>Cap: {table.capacity}</span>
                    </div>
                </div>
            </CardContent>
            <div className="px-3 pb-3 space-y-2">
                <div className="grid gap-1.5 grid-cols-2">
                    <div className="space-y-1">
                        <Label htmlFor={`covers-${table.id}`} className="text-[9px] uppercase tracking-wide text-muted-foreground">
                            Covers
                        </Label>
                        <Input
                            id={`covers-${table.id}`}
                            type="number"
                            min={1}
                            value={coverCount}
                            onChange={(event) => { setCoverCount(event.target.value); }}
                            className="h-8 text-sm"
                        />
                    </div>
                    <Button
                        variant={isOccupied ? "outline" : "default"}
                        className="col-span-1 self-end h-8 text-xs"
                        disabled={isBusy}
                        onClick={() => { isOccupied ? onUpdateCovers(table.name, parsedCoverCount) : onOccupy(table.name, parsedCoverCount); }}
                    >
                        {isOccupied ? "Update" : "Occupy"}
                    </Button>
                </div>
                {isOccupied ? (
                    <Button
                        variant="outline"
                        className="w-full h-8 text-xs"
                        disabled={isBusy}
                        onClick={() => { onRelease(table.name); }}
                    >
                        Release
                    </Button>
                ) : null}
                {isOccupied ? (
                    <Button variant="ghost" className="w-full h-8 text-xs" onClick={() => { onOpenOrders(table.name, (occupancy as any)?.linkedOrderId ?? null); }}>
                        {(occupancy as any)?.linkedOrderId ? 'View Order' : 'Take Orders'}
                    </Button>
                ) : null}
            </div>
        </Card>
    )
}

export default function TablesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [tablesData, setTablesData] = useState<Table[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("");
    const [tableOccupancyByName, setTableOccupancyByName] = useState<Record<string, { is_occupied: boolean; num_covers: number; linkedOrderId?: string | null }>>({});
    const [busyTableName, setBusyTableName] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<number | null>(null);
  const { toast } = useToast();

    const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager") => {
        if (!user) {return false;}
        if (user.role === role) {return true;}
        return Array.isArray(user.role_all) ? user.role_all.includes(role) : false;
    };

    const ensureAdmin = () => {
        if (hasRole("admin")) {
            return true;
        }
        toast({
            title: "Access denied",
            description: "You do not have the required role for this action. Required role: admin.",
            variant: "destructive",
        });
        return false;
    };

  const sensors = useSensors(useSensor(PointerSensor));

    const loadTables = async () => {
        if (!user?.restaurantUsername) {
            setTablesData([]);
            setTableOccupancyByName({});
            return;
        }

        try {
            const data = await getTables(user.restaurantUsername);
            const nextTables = Array.isArray(data) ? data : [];
            setTablesData(nextTables);

            const statusEntries = await Promise.all(
                nextTables.map(async (table) => {
                    try {
                                const status = await getTableStatus(user.restaurantUsername, table.name);
                                return [
                                    table.name.toLowerCase(),
                                    {
                                        is_occupied: Boolean(status?.is_occupied),
                                        num_covers: Math.max(1, Number(status?.num_covers ?? table.capacity ?? 1) || 1),
                                        linkedOrderId: typeof status?.linked_order_id === 'string' && status?.linked_order_id ? String(status.linked_order_id) : null,
                                    },
                                ] as const;
                    } catch {
                        return [
                            table.name.toLowerCase(),
                            {
                                is_occupied: table.status === "Occupied",
                                num_covers: Math.max(1, Number(table.capacity ?? 1) || 1),
                            },
                        ] as const;
                    }
                }),
            );

            setTableOccupancyByName(Object.fromEntries(statusEntries));
        } catch (error) {
            console.error("Failed to load tables", error);
            setTablesData([]);
            setTableOccupancyByName({});
        }
    };

    useEffect(() => {
        if (!user?.restaurantUsername) {
            return;
        }

        loadTables().catch((error) => {
            console.error("Failed to load tables", error);
        });

        const handler = () => { loadTables().catch((err) => { console.error('tables:changed handler failed', err); }); };
        if (typeof window !== 'undefined') {
            window.addEventListener('tables:changed', handler as EventListener);
        }
        return () => {
            if (typeof window !== 'undefined') {window.removeEventListener('tables:changed', handler as EventListener);}
        };
    }, [user?.restaurantUsername]);

  const handleAddTable = async () => {
        if (!ensureAdmin()) {return;}

    if (newTableName && newTableCapacity && user?.restaurantUsername) {
      const trimmedName = newTableName.trim();
      const existingTable = tablesData.find(
        (table) => table.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (existingTable) {
        toast({
          title: "Duplicate Table",
          description: `A table with the name "${trimmedName}" already exists.`,
          variant: "destructive",
        });
        return;
      }
      
            const payload: any = {
                table: {
                    name: trimmedName,
                    capacity: newTableCapacity ? parseInt(newTableCapacity, 10) : undefined,
                },
            };

            const response = await requestBackend({
                path: "/add-table",
                method: "POST",
                restaurantId: user.restaurantUsername,
                body: payload,
            });

            if (!response.ok) {
                throw new Error("Failed to create table");
            }

            // await addAuditLogEntry(user.restaurantUsername, {
            //     employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
            //     employeeId: user?.employeeId,
            //     action: "Table Added",
            //     details: `Created table ${trimmedName}${payload.table.capacity ? ` (capacity ${payload.table.capacity})` : ""}`,
            // });

            await loadTables();
      setNewTableName("");
      setNewTableCapacity("");
      setIsDialogOpen(false);
    }
  };

    const handleRemoveTable = async (tableId: number) => {
        if (!ensureAdmin()) {return;}

        if (!user?.restaurantUsername) {return;}
        const removed = tablesData.find(t => t.id === tableId);
        if (!removed) {return;}

        const response = await requestBackend({
            path: `/table/${encodeURIComponent(removed.name)}`,
            method: "DELETE",
            restaurantId: user.restaurantUsername,
        });

        if (!response.ok && response.status !== 204) {
            throw new Error("Failed to delete table");
        }

        // await addAuditLogEntry(user.restaurantUsername, {
        //     employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
        //     employeeId: user?.employeeId,
        //     action: "Table Removed",
        //     details: `Deleted table ${removed.name}`,
        // });

        await loadTables();
        toast({
            title: "Table Removed",
            description: "The table has been successfully deleted.",
        });
    };

  const handleDragStart = (event: DragStartEvent) => {
        setActiveId(Number(event.active.id));
  };
  
  const handleDragEnd = async (event: DragEndEvent) => {
        if (!ensureAdmin()) {
            setActiveId(null);
            return;
        }

    setActiveId(null);
    const { active, over } = event;

    if (over && active.id !== over.id) {
        const oldIndex = tablesData.findIndex((t) => t.id === active.id);
        const newIndex = tablesData.findIndex((t) => t.id === over.id);
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }

        const dragged = tablesData[oldIndex];
        const target = tablesData[newIndex];

        if (dragged.capacity !== target.capacity) {
            const movedTable: Table = { ...dragged, capacity: target.capacity };
            const withoutDragged = tablesData.filter((_, index) => index !== oldIndex);
            const targetIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
            withoutDragged.splice(targetIndex, 0, movedTable);
            setTablesData(withoutDragged);
            toast({
                title: "Section updated",
                description: `${dragged.name} moved to ${target.capacity}-person tables.`,
            });
            return;
        }

        setTablesData(arrayMove(tablesData, oldIndex, newIndex));
    }
  };

    const activeTable = activeId ? tablesData.find(t => t.id === activeId) : null;

  const groupedTables = tablesData.reduce<Record<number, Table[]>>((acc, table) => {
    const capacity = table.capacity;
    if (!acc[capacity]) {
        acc[capacity] = [];
    }
    acc[capacity].push(table);
    return acc;
  }, {});

  const sortedCapacities = Object.keys(groupedTables).map(Number).sort((a, b) => a - b);
  const totalTables = tablesData.length;
    const unavailableTables = tablesData.filter(t => t.status !== "Available").length;
    const openOrdersForTable = (tableName: string, linkedOrderId?: string | null) => {
        const params = new URLSearchParams();
        params.set('table', tableName);
        if (linkedOrderId) {params.set('highlightOrder', linkedOrderId);}
        router.push(`/dashboard/orders?${params.toString()}`);
    };

    const handleOccupyTable = async (tableName: string, numCovers: number) => {
        if (!user?.restaurantUsername) {return;}
        setBusyTableName(tableName);
        try {
            await occupyTable(user.restaurantUsername, tableName, numCovers);
            toast({
                title: "Table occupied",
                description: `${tableName} is now marked occupied with ${numCovers} cover${numCovers === 1 ? "" : "s"}.`,
            });
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to update table",
                description: String(error?.message ?? "Failed to mark the table occupied."),
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleUpdateTableCovers = async (tableName: string, numCovers: number) => {
        if (!user?.restaurantUsername) {return;}
        setBusyTableName(tableName);
        try {
            await updateTableCovers(user.restaurantUsername, tableName, numCovers);
            toast({
                title: "Covers updated",
                description: `${tableName} now has ${numCovers} cover${numCovers === 1 ? "" : "s"}.`,
            });
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to update covers",
                description: String(error?.message ?? "Failed to save the cover count."),
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleReleaseTable = async (tableName: string) => {
        if (!user?.restaurantUsername) {return;}
        setBusyTableName(tableName);
        try {
            await releaseTable(user.restaurantUsername, tableName);
            toast({
                title: "Table released",
                description: `${tableName} is now available.`,
            });
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to release table",
                description: String(error?.message ?? "Failed to mark the table available."),
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid gap-4 md:gap-8">
        <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold md:text-2xl">Table Management</h1>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Table
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                <DialogTitle>Add New Table</DialogTitle>
                <DialogDescription>
                    Enter the details for the new table. Click save when you&apos;re done.
                </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">
                    Table Name
                    </Label>
                    <Input
                    id="name"
                    value={newTableName}
                    onChange={(e) => { setNewTableName(e.target.value); }}
                    className="col-span-3"
                    placeholder="e.g., T11"
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="capacity" className="text-right">
                    Capacity
                    </Label>
                    <Input
                    id="capacity"
                    type="number"
                    value={newTableCapacity}
                    onChange={(e) => { setNewTableCapacity(e.target.value); }}
                    className="col-span-3"
                    placeholder="e.g., 4"
                    />
                </div>
                </div>
                <DialogFooter>
                <Button onClick={handleAddTable}>Save changes</Button>
                </DialogFooter>
            </DialogContent>
            </Dialog>
        </div>
        <Card>
            <CardHeader>
            <CardTitle>Table Status Overview</CardTitle>
            {totalTables > 0 ? (
                <CardDescription className="text-sm text-muted-foreground">
                    {unavailableTables} of {totalTables} tables are currently booked or reserved. Drag to reorder tables.
                </CardDescription>
            ) : (
                <CardDescription className="text-sm text-muted-foreground">
                    No tables have been added yet.
                </CardDescription>
            )}
            </CardHeader>
            <CardContent>
             <SortableContext items={tablesData.map(t => t.id)}>
                {sortedCapacities.length > 0 ? (
                    <div className="space-y-8">
                        {sortedCapacities.map((capacity) => (
                        <div key={capacity}>
                            <h3 className="text-lg font-semibold mb-4 flex items-center md:text-xl">
                                <Users className="mr-2 h-5 w-5" /> {capacity}-Person Tables
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4">
                                {groupedTables[capacity].map((table) => (
                                    <SortableTable
                                        key={table.id}
                                        table={table}
                                        occupancy={tableOccupancyByName[table.name.toLowerCase()] ?? null}
                                        onRemove={handleRemoveTable}
                                        onOpenOrders={openOrdersForTable}
                                        onOccupy={handleOccupyTable}
                                        onRelease={handleReleaseTable}
                                        onUpdateCovers={handleUpdateTableCovers}
                                        busyTableName={busyTableName}
                                    />
                                ))}
                            </div>
                        </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="mb-4">You have no tables configured for your restaurant.</p>
                        <Button onClick={() => { setIsDialogOpen(true); }}>Add Your First Table</Button>
                    </div>
                )}
             </SortableContext>
            </CardContent>
        </Card>
        </div>
         <DragOverlay>
            {activeTable ? (
                <SortableTable
                    table={activeTable}
                    occupancy={tableOccupancyByName[activeTable.name.toLowerCase()] ?? null}
                    onRemove={() => {}}
                    onOpenOrders={openOrdersForTable}
                    onOccupy={handleOccupyTable}
                    onRelease={handleReleaseTable}
                    onUpdateCovers={handleUpdateTableCovers}
                    busyTableName={busyTableName}
                />
            ) : null}
        </DragOverlay>
    </DndContext>
  );
}

    