
"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, PlusCircle, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addAuditLogEntry, getInventory, addInventoryItem, removeInventoryItem } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  status: "In Stock" | "Low Stock" | "Out of Stock";
};

const inventorySchema = z.object({
    name: z.string().min(1, "Item name is required."),
    category: z.string().min(1, "Category is required."),
    stock: z.coerce.number().min(0, "Stock cannot be negative."),
    unit: z.string().min(1, "Unit is required."),
});

type InventoryFormData = z.infer<typeof inventorySchema>;


export default function InventoryPage() {
  const { user } = useAuth();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  useEffect(() => {
    if (user) {
        const fetchInventory = async () => {
          setInventory(await getInventory(user.restaurantId));
        }
        fetchInventory();
    }
  }, [user]);
  
  const handleAddItem = async (data: InventoryFormData) => {
    if (!user || !user.restaurantId) return;
    let status: InventoryItem['status'] = "In Stock";
    if (data.stock === 0) status = "Out of Stock";
    else if (data.stock < 10) status = "Low Stock";
    
    const newItem: InventoryItem = {
        id: (inventory.length + 1).toString(),
        ...data,
        status,
    };
    await addInventoryItem(user.restaurantId, newItem);

    await addAuditLogEntry(user.restaurantId, {
        employee: user?.name || 'System',
        action: 'Inventory Add',
        details: `Added new item: ${data.name} (${data.stock} ${data.unit})`,
    });
    
    setInventory(await getInventory(user.restaurantId));
    setIsDialogOpen(false);
  }

  const handleRemoveItem = async (itemId: string) => {
    if (!user || !user.restaurantId) return;
    await removeInventoryItem(user.restaurantId, itemId);
    setInventory(await getInventory(user.restaurantId));
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "In Stock":
        return "default";
      case "Low Stock":
        return "secondary";
      case "Out of Stock":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Inventory</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Item
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Inventory Item</DialogTitle>
              <DialogDescription>
                Fill in the details to add a new item to the inventory.
              </DialogDescription>
            </DialogHeader>
            <InventoryForm onSubmit={handleAddItem} afterSubmit={() => setIsDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Inventory List</CardTitle>
          <CardDescription>
            A list of all items in your restaurant's inventory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="hidden md:table-cell text-center">Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <div>{item.name}</div>
                    <div className="text-sm text-muted-foreground md:hidden">{item.category}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{item.category}</TableCell>
                  <TableCell className="hidden md:table-cell text-center">{item.stock} {item.unit}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(item.status)}>
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleRemoveItem(item.id)} className="text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryForm({ onSubmit, afterSubmit }: { onSubmit: (data: InventoryFormData) => void; afterSubmit: () => void; }) {
    const { register, handleSubmit, control, formState: { errors } } = useForm<InventoryFormData>({
        resolver: zodResolver(inventorySchema)
    });

    const handleFormSubmit = (data: InventoryFormData) => {
        onSubmit(data);
        afterSubmit();
    }

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Item Name</Label>
            <div className="col-span-3">
              <Input id="name" {...register("name")} placeholder="e.g., Tomatoes" />
              {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">Category</Label>
            <div className="col-span-3">
              <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <SelectTrigger>
                              <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                          <SelectContent>
                              <SelectItem value="Vegetable">Vegetable</SelectItem>
                              <SelectItem value="Meat">Meat</SelectItem>
                              <SelectItem value="Dairy">Dairy</SelectItem>
                              <SelectItem value="Dry Goods">Dry Goods</SelectItem>
                              <SelectItem value="Oil">Oil</SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                      </Select>
                  )}
              />
              {errors.category && <p className="text-sm text-destructive mt-1">{errors.category.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="stock" className="text-right">Stock</Label>
            <div className="col-span-3">
              <Input id="stock" type="number" {...register("stock")} placeholder="e.g., 50" />
              {errors.stock && <p className="text-sm text-destructive mt-1">{errors.stock.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="unit" className="text-right">Unit</Label>
            <div className="col-span-3">
              <Input id="unit" {...register("unit")} placeholder="e.g., kg" />
              {errors.unit && <p className="text-sm text-destructive mt-1">{errors.unit.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Save Item</Button>
          </DialogFooter>
        </form>
    )
}
