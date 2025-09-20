
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
import { Users, Armchair, PlusCircle, MoreVertical, Trash2, GripVertical } from "lucide-react";
import { type Table } from "./data";
import { getTables, addTable, getBookings, removeTable, saveTables } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";


function SortableTable({ table, onRemove }: { table: Table, onRemove: (tableId: number) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: table.id });

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
    };
    
    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={cn(
                "transition-all touch-none",
                table.status === 'Booked' ? 'bg-secondary' : 'bg-background',
                isDragging ? 'opacity-50 shadow-2xl z-10' : 'hover:shadow-lg'
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                <CardTitle className="text-xs font-medium sm:text-sm flex items-center gap-2">
                    <button {...listeners} {...attributes} className="cursor-grab p-1">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {table.name}
                </CardTitle>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
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
                                        This will permanently delete the table "{table.name}". This action cannot be undone.
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
                 <Badge variant={table.status === 'Booked' ? 'destructive' : 'default'} className="text-[10px] sm:text-xs">
                    {table.status}
                </Badge>
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

  const fetchData = async () => {
    if (user) {
      const tables = await getTables(user.restaurantId);
      const bookings = await getBookings(user.restaurantId);
      // Sync table statuses with bookings
      tables.forEach(bookingTable => {
          const matchingBooking = bookings.find(b => b.table === bookingTable.name && (b.status === "Confirmed" || b.status === "Arrived" || b.status === "Seated"));
          bookingTable.status = matchingBooking ? "Booked" : "Available";
      });
      setTablesData(tables);
    }
  }

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleAddTable = async () => {
    if (newTableName && newTableCapacity && user?.restaurantId) {
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
      
      const newTable: Omit<Table, 'id'> = {
        name: trimmedName,
        capacity: parseInt(newTableCapacity, 10),
        status: "Available",
      };
      await addTable(user.restaurantId, newTable);
      await fetchData(); // Refetch to get the ID assigned by the DB
      setNewTableName("");
      setNewTableCapacity("");
      setIsDialogOpen(false);
    }
  };

  const handleRemoveTable = async (tableId: number) => {
    if (!user) return;
    await removeTable(user.restaurantId, tableId);
    setTablesData(prev => prev.filter(t => t.id !== tableId));
    toast({
        title: "Table Removed",
        description: "The table has been successfully deleted.",
    });
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
  };
  
  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (over && active.id !== over.id) {
        const oldIndex = tablesData.findIndex((t) => t.id === active.id);
        const newIndex = tablesData.findIndex((t) => t.id === over.id);
        const newOrder = arrayMove(tablesData, oldIndex, newIndex);
        setTablesData(newOrder);
        if (user) {
            await saveTables(user.restaurantId, newOrder);
        }
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
  const bookedTables = tablesData.filter(t => t.status === "Booked").length;

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
                    Enter the details for the new table. Click save when you're done.
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
                    {bookedTables} of {totalTables} tables are currently booked. Drag to reorder tables.
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
                                    <SortableTable key={table.id} table={table} onRemove={handleRemoveTable} />
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

    