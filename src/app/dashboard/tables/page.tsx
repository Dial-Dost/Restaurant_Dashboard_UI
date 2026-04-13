
"use client";

import { useState, useEffect, useMemo } from "react";
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
    getRestaurantUsers,
    getTableAssignments,
    assignTableToEmployee,
    unassignTableEmployee,
    getMonthlyApcInsight,
    type User,
    type TableAssignmentDefinition,
    type ApcZone,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";

const API_BASE_URL = process.env.NEXT_PUBLIC_RECEPTION_API_URL ?? "http://localhost:3000";


function getZoneBadgeClass(zone?: ApcZone) {
    if (zone === "green") return "bg-green-100 text-green-800 border-green-200";
    if (zone === "yellow") return "bg-yellow-100 text-yellow-900 border-yellow-200";
    if (zone === "red") return "bg-red-100 text-red-800 border-red-200";
    return "";
}

function SortableTable({
    table,
    onRemove,
    assignedEmployeeName,
    incentiveZone,
}: {
    table: Table;
    onRemove: (tableId: number) => void;
    assignedEmployeeName?: string;
    incentiveZone?: ApcZone;
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
                <div className="flex flex-wrap items-center gap-1">
                    <Badge
                        variant={isUnavailable ? 'destructive' : isReserved ? 'secondary' : 'default'}
                        className="text-[10px] sm:text-xs"
                    >
                        {table.status}
                    </Badge>
                    {assignedEmployeeName ? (
                        <Badge variant="outline" className="text-[10px] sm:text-xs">
                            {assignedEmployeeName}
                        </Badge>
                    ) : null}
                    {incentiveZone ? (
                        <Badge variant="outline" className={`text-[10px] sm:text-xs ${getZoneBadgeClass(incentiveZone)}`}>
                            {incentiveZone.toUpperCase()}
                        </Badge>
                    ) : null}
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
    const [employees, setEmployees] = useState<User[]>([]);
    const [assignments, setAssignments] = useState<TableAssignmentDefinition[]>([]);
    const [employeeIncentiveZone, setEmployeeIncentiveZone] = useState<Record<string, ApcZone>>({});
    const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("");
    const [activeId, setActiveId] = useState<number | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(useSensor(PointerSensor));

    const loadTables = async () => {
        if (!user?.restaurantId) {
            setTablesData([]);
            return;
        }

        try {
            const data = await getTables(user.restaurantId);
            setTablesData(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Failed to load tables", error);
            setTablesData([]);
        }
    };

    const loadAssignmentsAndIncentives = async () => {
        if (!user?.restaurantId || !user.employeeId) {
            setEmployees([]);
            setAssignments([]);
            setEmployeeIncentiveZone({});
            return;
        }

        try {
            const [userList, assignmentList, apcInsight] = await Promise.all([
                getRestaurantUsers(user.restaurantId, user.employeeId),
                getTableAssignments(user.restaurantId, user.employeeId),
                getMonthlyApcInsight(user.restaurantId),
            ]);

            setEmployees(Array.isArray(userList) ? userList : []);
            setAssignments(Array.isArray(assignmentList) ? assignmentList : []);

            const zoneByEmployee: Record<string, ApcZone> = {};
            for (const entry of apcInsight?.employee_incentives ?? []) {
                zoneByEmployee[entry.employee_id] = entry.zone;
            }
            setEmployeeIncentiveZone(zoneByEmployee);
        } catch (error) {
            console.error("Failed to load assignments/incentives", error);
            setEmployees([]);
            setAssignments([]);
            setEmployeeIncentiveZone({});
        }
    };

    const loadDashboardData = async () => {
        await Promise.all([loadTables(), loadAssignmentsAndIncentives()]);
    };

  useEffect(() => {
        void loadDashboardData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.restaurantId, user?.employeeId]);

  const assignmentByTable = useMemo(() => {
    const map = new Map<string, TableAssignmentDefinition>();
    for (const item of assignments) {
        map.set(item.table_name.toLowerCase(), item);
    }
    return map;
  }, [assignments]);

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
                    "X-Restaurant-Id": user.restaurantId,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error("Failed to create table");
            }

            await addAuditLogEntry(user.restaurantId, {
                employee: user?.name || user?.employeeId || "System",
                employeeId: user?.employeeId,
                action: "Table Added",
                details: `Created table ${trimmedName}${payload.table.capacity ? ` (capacity ${payload.table.capacity})` : ""}`,
            });

            await loadDashboardData();
      setNewTableName("");
      setNewTableCapacity("");
      setIsDialogOpen(false);
    }
  };

    const handleRemoveTable = async (tableId: number) => {
        if (!user?.restaurantId) return;
        const removed = tablesData.find(t => t.id === tableId);
        if (!removed) return;

        const response = await fetch(`${API_BASE_URL}/table/${encodeURIComponent(removed.name)}`, {
            method: "DELETE",
            headers: {
                "X-Restaurant-Id": user.restaurantId,
            },
        });

        if (!response.ok && response.status !== 204) {
            throw new Error("Failed to delete table");
        }

        await addAuditLogEntry(user.restaurantId, {
            employee: user?.name || user?.employeeId || "System",
            employeeId: user?.employeeId,
            action: "Table Removed",
            details: `Deleted table ${removed.name}`,
        });

        await loadDashboardData();
        toast({
            title: "Table Removed",
            description: "The table has been successfully deleted.",
        });
    };

  const handleAssignTable = async (tableName: string) => {
    if (!user?.restaurantId || !user.employeeId) return;

    const selectedEmployeeId = assignmentDrafts[tableName];
    if (!selectedEmployeeId) {
        toast({
            title: "Select Employee",
            description: `Choose an employee to assign for ${tableName}.`,
            variant: "destructive",
        });
        return;
    }

    const ok = await assignTableToEmployee(user.restaurantId, user.employeeId, tableName, selectedEmployeeId);
    if (!ok) {
        toast({
            title: "Assignment Failed",
            description: `Could not assign ${tableName}.`,
            variant: "destructive",
        });
        return;
    }

    await addAuditLogEntry(user.restaurantId, {
        employee: user?.name || user?.employeeId || "System",
        employeeId: user?.employeeId,
        action: "Table Assigned",
        details: `Assigned ${tableName} to employee ${selectedEmployeeId}`,
    });

    await loadAssignmentsAndIncentives();
    toast({
        title: "Table Assigned",
        description: `${tableName} was assigned successfully.`,
    });
  };

  const handleUnassignTable = async (tableName: string) => {
    if (!user?.restaurantId || !user.employeeId) return;

    const ok = await unassignTableEmployee(user.restaurantId, user.employeeId, tableName);
    if (!ok) {
        toast({
            title: "Unassign Failed",
            description: `Could not unassign ${tableName}.`,
            variant: "destructive",
        });
        return;
    }

    await addAuditLogEntry(user.restaurantId, {
        employee: user?.name || user?.employeeId || "System",
        employeeId: user?.employeeId,
        action: "Table Unassigned",
        details: `Removed employee assignment from ${tableName}`,
    });

    setAssignmentDrafts((prev) => ({ ...prev, [tableName]: "" }));
    await loadAssignmentsAndIncentives();
    toast({
        title: "Table Unassigned",
        description: `${tableName} is now unassigned.`,
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
                                        assignedEmployeeName={assignmentByTable.get(table.name.toLowerCase())?.employee_name}
                                        incentiveZone={(() => {
                                            const assignment = assignmentByTable.get(table.name.toLowerCase());
                                            return assignment ? employeeIncentiveZone[assignment.employee_id] : undefined;
                                        })()}
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

        <Card>
            <CardHeader>
                <CardTitle>Table Assignments And Incentives</CardTitle>
                <CardDescription>
                    Assign each table to an employee. Incentive zone is based on assigned employee mean APC versus monthly APC.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {tablesData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Add tables first to configure assignments.</p>
                ) : (
                    <div className="space-y-2">
                        {tablesData.map((table) => {
                            const assignment = assignmentByTable.get(table.name.toLowerCase());
                            const selectedEmployeeId = assignmentDrafts[table.name] ?? assignment?.employee_id ?? "";
                            const zone = assignment ? employeeIncentiveZone[assignment.employee_id] : undefined;

                            return (
                                <div key={`assignment-${table.id}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center">
                                    <div>
                                        <p className="font-medium">{table.name}</p>
                                        <p className="text-xs text-muted-foreground">Capacity {table.capacity}</p>
                                    </div>
                                    <div>
                                        <select
                                            aria-label={`Assign employee for ${table.name}`}
                                            value={selectedEmployeeId}
                                            onChange={(event) =>
                                                setAssignmentDrafts((prev) => ({
                                                    ...prev,
                                                    [table.name]: event.target.value,
                                                }))
                                            }
                                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                        >
                                            <option value="">Select employee</option>
                                            {employees.map((employee) => (
                                                <option key={`${table.name}-${employee.employeeId}`} value={employee.employeeId}>
                                                    {employee.name} ({employee.employeeId})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {assignment ? (
                                            <Badge variant="secondary">Assigned: {assignment.employee_name}</Badge>
                                        ) : (
                                            <Badge variant="outline">Unassigned</Badge>
                                        )}
                                        {zone ? (
                                            <Badge variant="outline" className={getZoneBadgeClass(zone)}>
                                                Incentive: {zone.toUpperCase()}
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() => void handleAssignTable(table.name)}
                                            disabled={!selectedEmployeeId}
                                        >
                                            Assign
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => void handleUnassignTable(table.name)}
                                            disabled={!assignment}
                                        >
                                            Unassign
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
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

    