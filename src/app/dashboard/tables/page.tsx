
"use client";

import { useState, useEffect } from "react";
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
    addAuditLogEntry,
    getTables,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";

const API_BASE_URL = process.env.NEXT_PUBLIC_RECEPTION_API_URL ?? "http://localhost:3000";


function SortableTable({
    table,
    onRemove,
}: {
    table: Table;
    onRemove: (tableId: number) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: table.id });

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
    };

    const isUnavailable = table.status === "Booked" || table.status === "Occupied";
    const isReserved = table.status === "Reserved";
    
    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={cn(
                "transition-all touch-none min-w-0",
                isUnavailable ? 'bg-secondary' : isReserved ? 'bg-muted/40' : 'bg-background',
                isDragging ? 'opacity-50 shadow-2xl z-10' : 'hover:shadow-lg'
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                <CardTitle className="text-xs font-medium sm:text-sm flex items-center gap-2 min-w-0">
                    <button {...listeners} {...attributes} className="cursor-grab p-1 shrink-0">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <span className="truncate" title={table.name}>{table.name}</span>
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
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
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
                                    <AlertDialogAction onClick={() => onRemove(table.id)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="p-3 pt-0 flex justify-between items-center">
                <div className="flex flex-wrap items-center gap-1">
                    <Badge
                        variant={isUnavailable ? 'destructive' : isReserved ? 'secondary' : 'default'}
                        className="text-[10px] sm:text-xs"
                    >
                        {table.status}
                    </Badge>
                </div>
                <div className="flex items-center text-muted-foreground">
                    <Users className="h-3 w-3 mr-1" />
                    <span className="text-xs">{table.capacity}</span>
                </div>
            </CardContent>
        </Card>
    )
}

export default function TablesPage() {
  const { user } = useAuth();
  const [tablesData, setTablesData] = useState<Table[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("");
    const [activeId, setActiveId] = useState<number | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(useSensor(PointerSensor));

    const loadTables = async () => {
        if (!user?.restaurantUsername) {
            setTablesData([]);
            return;
        }

        try {
            const data = await getTables(user.restaurantUsername);
            setTablesData(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Failed to load tables", error);
            setTablesData([]);
        }
    };

  useEffect(() => {
        void loadTables();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.restaurantUsername]);

  const handleAddTable = async () => {
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

            const response = await fetch(`${API_BASE_URL}/add-table`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Restaurant-Id": user.restaurantUsername,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error("Failed to create table");
            }

            await addAuditLogEntry(user.restaurantUsername, {
                employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
                employeeId: user?.employeeId,
                action: "Table Added",
                details: `Created table ${trimmedName}${payload.table.capacity ? ` (capacity ${payload.table.capacity})` : ""}`,
            });

            await loadTables();
      setNewTableName("");
      setNewTableCapacity("");
      setIsDialogOpen(false);
    }
  };

    const handleRemoveTable = async (tableId: number) => {
        if (!user?.restaurantUsername) return;
        const removed = tablesData.find(t => t.id === tableId);
        if (!removed) return;

        const response = await fetch(`${API_BASE_URL}/table/${encodeURIComponent(removed.name)}`, {
            method: "DELETE",
            headers: {
                "X-Restaurant-Id": user.restaurantUsername,
            },
        });

        if (!response.ok && response.status !== 204) {
            throw new Error("Failed to delete table");
        }

        await addAuditLogEntry(user.restaurantUsername, {
            employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
            employeeId: user?.employeeId,
            action: "Table Removed",
            details: `Deleted table ${removed.name}`,
        });

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

  const groupedTables = tablesData.reduce((acc, table) => {
    const capacity = table.capacity;
    if (!acc[capacity]) {
        acc[capacity] = [];
    }
    acc[capacity].push(table);
    return acc;
  }, {} as Record<number, Table[]>);

  const sortedCapacities = Object.keys(groupedTables).map(Number).sort((a, b) => a - b);
  const totalTables = tablesData.length;
    const unavailableTables = tablesData.filter(t => t.status !== "Available").length;

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
                    onChange={(e) => setNewTableName(e.target.value)}
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
                    onChange={(e) => setNewTableCapacity(e.target.value)}
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
                                        onRemove={handleRemoveTable}
                                    />
                                ))}
                            </div>
                        </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="mb-4">You have no tables configured for your restaurant.</p>
                        <Button onClick={() => setIsDialogOpen(true)}>Add Your First Table</Button>
                    </div>
                )}
             </SortableContext>
            </CardContent>
        </Card>
        </div>
         <DragOverlay>
            {activeTable ? (
                <SortableTable table={activeTable} onRemove={() => {}} />
            ) : null}
        </DragOverlay>
    </DndContext>
  );
}

    