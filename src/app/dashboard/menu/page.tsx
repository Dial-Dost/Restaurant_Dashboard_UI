
"use client";

import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  DropdownMenu,
  DropdownMenuContent,
    DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlusCircle, MoreVertical, Trash2, Utensils, GripVertical, Upload } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { type MenuItem } from "./data";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import { getMenuItems, getMenuCategories, addMenuItem, addMenuCategory, removeMenuCategory, saveMenuItems } from "@/lib/db";

const menuItemSchema = z.object({
  name: z.string().min(1, "Item name is required."),
  price: z.coerce.number().min(0.01, "Price must be greater than 0."),
  category: z.string().min(1, "Category is required."),
});

const categorySchema = z.object({
  name: z.string().min(1, "Category name is required."),
});

type MenuItemFormData = z.infer<typeof menuItemSchema>;
type CategoryFormData = z.infer<typeof categorySchema>;

function SortableMenuItem({ item, onRemoveItem, currencySymbol, isDragging }: { item: MenuItem, onRemoveItem: (id: string) => void, currencySymbol: string, isDragging?: boolean }) {
    const { attributes, listeners, setNodeRef } = useSortable({
        id: item.id,
        data: { category: item.category },
    });

    return (
        <li ref={setNodeRef} className={cn("flex items-center justify-between rounded-md border p-3 bg-background touch-none", isDragging && "opacity-50")}>
            <div className="flex items-center gap-2">
                 <button {...listeners} {...attributes} className="cursor-grab p-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                </button>
                <p className="font-medium">{item.name}</p>
            </div>
            <div className="flex items-center gap-4">
                  <p className="text-muted-foreground">{currencySymbol}{item.price.toFixed(2)}</p>
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem className="text-destructive" onClick={() => onRemoveItem(item.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                 </DropdownMenu>
            </div>
        </li>
    );
}

function DroppableCategory({ category, items, onRemoveItem, onRemoveCategory, currencySymbol, activeId }: { category: string, items: MenuItem[], onRemoveItem: (id: string) => void, onRemoveCategory: (category: string) => void, currencySymbol: string, activeId: string | null }) {
    const { isOver, setNodeRef } = useDroppable({
        id: category,
    });
    
    return (
        <AccordionItem value={category} key={category}>
            <AccordionTrigger className="text-xl font-semibold hover:no-underline">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                   <Utensils className="h-5 w-5 text-primary" /> {category}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                                                <span
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label={`Category actions for ${category}`}
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                    onClick={(event) => event.stopPropagation()}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                        }
                                                    }}
                                                >
                                                        <MoreVertical className="h-4 w-4" />
                                                </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenuLabel>Category Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => onRemoveCategory(category)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete Category</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </AccordionTrigger>
            <AccordionContent ref={setNodeRef} className={`p-2 rounded-md transition-colors ${isOver ? 'bg-accent' : ''}`}>
                 <SortableContext items={items.map(i => i.id)}>
                    {items && items.length > 0 ? (
                        <ul className="space-y-2">
                            {items.map(item => (
                                <SortableMenuItem key={item.id} item={item} onRemoveItem={onRemoveItem} currencySymbol={currencySymbol} isDragging={activeId === item.id} />
                            ))}
                        </ul>
                    ) : (
                        <div className="text-muted-foreground p-4 text-center min-h-[50px]">
                            {isOver ? 'Drop item here' : 'No items in this category yet. Add one to get started!'}
                        </div>
                    )}
                 </SortableContext>
            </AccordionContent>
        </AccordionItem>
    );
}

export default function MenuPage() {
  const { user } = useAuth();
    const { currencySymbol } = useCurrency();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user) {
        const fetchData = async () => {
          setMenuItems(await getMenuItems(user.restaurantUsername));
          setCategories(await getMenuCategories(user.restaurantUsername));
        }
        fetchData();
    }
  }, [user]);

  const sensors = useSensors(useSensor(PointerSensor));

  const groupedItems = menuItems.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);
  
  const updateMenuItems = async (updatedItems: MenuItem[]) => {
    if (!user) return;
    setMenuItems(updatedItems);
    await saveMenuItems(user.restaurantUsername, updatedItems);
  }

  const handleAddItem = async (data: MenuItemFormData) => {
    if (!user) return;
    const newItem: MenuItem = {
      id: (menuItems.length + 1).toString() + Date.now(),
      ...data,
    };
    await addMenuItem(user.restaurantUsername, newItem);
    setMenuItems([...menuItems, newItem]);
    setIsItemDialogOpen(false);
  };
  
  const handleAddCategory = async (data: CategoryFormData) => {
    if (!user) return;
    if (!categories.find(c => c.toLowerCase() === data.name.toLowerCase())) {
        await addMenuCategory(user.restaurantUsername, data.name);
        setCategories([...categories, data.name]);
    }
    setIsCategoryDialogOpen(false);
  }

  const handleRemoveItem = (itemId: string) => {
    const newItems = menuItems.filter(item => item.id !== itemId);
    updateMenuItems(newItems);
  }

    const handleRemoveCategory = async (categoryName: string) => {
        if (!user?.restaurantUsername) return;

        const itemCount = menuItems.filter((item) => item.category === categoryName).length;
        const shouldDelete = window.confirm(
            itemCount > 0
                ? `Delete category "${categoryName}" and ${itemCount} item${itemCount === 1 ? "" : "s"} in it?`
                : `Delete category "${categoryName}"?`,
        );

        if (!shouldDelete) return;

        try {
            await removeMenuCategory(user.restaurantUsername, categoryName);
            setMenuItems((prev) => prev.filter((item) => item.category.toLowerCase() !== categoryName.toLowerCase()));
            setCategories((prev) => prev.filter((category) => category.toLowerCase() !== categoryName.toLowerCase()));
        } catch (error: any) {
            console.error("menu_category_delete_failed", error);
            window.alert(String(error?.message ?? "Unable to delete category."));
        }
    };

    const normalizeColumn = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizeCell = (value: unknown) => String(value ?? "").trim();
    const parsePriceValue = (value: unknown) => {
        const parsed = Number(String(value ?? "").replace(/[$,]/g, "").trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const parseSectionedMenuRows = (rows: unknown[][]): MenuItem[] => {
        const importedItems: MenuItem[] = [];
        let currentCategory = "";

        for (const rawRow of rows) {
            const row = (rawRow ?? []).map(normalizeCell);
            const nonEmptyCells = row.filter(Boolean);

            if (!nonEmptyCells.length) {
                continue;
            }

            const normalizedRow = row.map(normalizeColumn);
            const isHeaderRow = normalizedRow.includes("dishname") || normalizedRow.includes("itemname") || normalizedRow.includes("price");
            if (isHeaderRow) {
                continue;
            }

            if (nonEmptyCells.length === 1) {
                const label = nonEmptyCells[0].replace(/\s+/g, " ").trim();
                if (!label) {
                    continue;
                }

                if (!currentCategory && /menu/i.test(label)) {
                    continue;
                }

                currentCategory = label;
                continue;
            }

            if (!currentCategory) {
                continue;
            }

            let itemName = "";
            let priceValue: number | null = null;

            if (/^\d+$/.test(row[0] ?? "") && row[1]) {
                itemName = row[1];
                priceValue = parsePriceValue(row[2]);
            }

            if (!itemName && row[0] && row[1]) {
                itemName = row[0];
                priceValue = parsePriceValue(row[1]);
            }

            if (!itemName || priceValue == null) {
                continue;
            }

            importedItems.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: itemName,
                price: Number(priceValue.toFixed(2)),
                category: currentCategory,
            });
        }

        return importedItems;
    };

    const handleImportMenuFile = async (file: File) => {
        if (!user?.restaurantUsername) return;

        setIsImporting(true);
        try {
            const XLSX = await import("xlsx");
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: "array" });
            const firstSheetName = workbook.SheetNames[0];
            if (!firstSheetName) {
                throw new Error("No sheet found in the uploaded file.");
            }

            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
                defval: "",
                raw: false,
            });
            const keys = Object.keys(rows[0] ?? {});
            const columnMap = new Map<string, string>();
            for (const key of keys) {
                columnMap.set(normalizeColumn(key), key);
            }

            const nameKey =
                columnMap.get("name")
                || columnMap.get("item")
                || columnMap.get("itemname")
                || columnMap.get("menuitem")
                || columnMap.get("menuitemname");
            const priceKey =
                columnMap.get("price")
                || columnMap.get("amount")
                || columnMap.get("rate")
                || columnMap.get("mrp");
            const categoryKey =
                columnMap.get("category")
                || columnMap.get("type")
                || columnMap.get("section")
                || columnMap.get("group");

            let importedItems: MenuItem[] = [];
            if (nameKey && priceKey) {
                for (const row of rows) {
                    const itemName = String(row[nameKey] ?? "").trim();
                    if (!itemName) continue;

                    const rawPrice = parsePriceValue(row[priceKey]);
                    if (rawPrice == null) continue;

                    const categoryRaw = categoryKey ? String(row[categoryKey] ?? "").trim() : "";
                    const category = categoryRaw || "General";

                    importedItems.push({
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name: itemName,
                        price: Number(rawPrice.toFixed(2)),
                        category,
                    });
                }
            } else {
                const sectionedRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
                    header: 1,
                    defval: "",
                    raw: false,
                    blankrows: false,
                });
                importedItems = parseSectionedMenuRows(sectionedRows);
            }

            if (!importedItems.length) {
                throw new Error("No valid menu items found. Use category rows followed by item rows with a price, or a flat table with name and price columns.");
            }

            const existingByKey = new Map<string, MenuItem>();
            for (const item of menuItems) {
                existingByKey.set(`${item.category.toLowerCase()}::${item.name.toLowerCase()}`, item);
            }

            const mergedItems = [...menuItems];
            for (const imported of importedItems) {
                const key = `${imported.category.toLowerCase()}::${imported.name.toLowerCase()}`;
                const existing = existingByKey.get(key);
                if (existing) {
                    const idx = mergedItems.findIndex((entry) => entry.id === existing.id);
                    if (idx >= 0) {
                        mergedItems[idx] = { ...mergedItems[idx], price: imported.price };
                    }
                } else {
                    mergedItems.push(imported);
                }
            }

            const mergedCategories = Array.from(new Set([...categories, ...mergedItems.map((item) => item.category)]));

            await Promise.all(
                mergedCategories
                    .filter((category) => !categories.some((existing) => existing.toLowerCase() === category.toLowerCase()))
                    .map((category) => addMenuCategory(user.restaurantUsername, category)),
            );
            await saveMenuItems(user.restaurantUsername, mergedItems);

            setMenuItems(mergedItems);
            setCategories(mergedCategories);
            window.alert(`Imported ${importedItems.length} menu items from ${file.name}.`);
        } catch (error: any) {
            console.error("menu_import_failed", error);
            window.alert(String(error?.message ?? "Unable to import menu file."));
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };
  
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id.toString());
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
        return;
    }
    
    const activeId = active.id.toString();
    const overId = over.id.toString();
    const activeItem = menuItems.find(item => item.id === activeId);
    if (!activeItem) return;

    const overIsCategory = categories.includes(overId);
    let newItems: MenuItem[] = menuItems;

    if (overIsCategory && activeItem.category !== overId) {
        newItems = menuItems.map(item => item.id === activeId ? { ...item, category: overId } : item);
    } else {
        const activeIndex = menuItems.findIndex(item => item.id === activeId);
        const overItem = menuItems.find(item => item.id === overId);
        const overIndex = overItem ? menuItems.findIndex(item => item.id === overId) : -1;

        if (overItem && activeItem.category === overItem.category) {
            // Reorder within the same category
            if (activeIndex !== overIndex) {
                newItems = arrayMove(menuItems, activeIndex, overIndex);
            }
        } else if (overItem && activeItem.category !== overItem.category) {
            // Move to a new category by dropping on an item
            const newIndex = overIndex;
            newItems = arrayMove(menuItems, activeIndex, newIndex).map(item => 
                item.id === activeId ? { ...item, category: overItem.category } : item
            );
        }
    }
    updateMenuItems(newItems);
  }
  
  const activeItem = activeId ? menuItems.find(item => item.id === activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid gap-4 md:gap-8">
        <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold md:text-2xl">Menu Management</h1>
            <div className="flex gap-2">
                                <Label htmlFor="import-menu-file" className="sr-only">
                                    Import menu file
                                </Label>
                                <input
                                    id="import-menu-file"
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    className="hidden"
                                    title="Import menu file"
                                    aria-label="Import menu file"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        void handleImportMenuFile(file);
                                    }}
                                />
                                <Button
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isImporting}
                                >
                                    <Upload className="mr-2 h-4 w-4" />
                                    {isImporting ? "Importing..." : "Import Excel"}
                                </Button>
                <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
                    <DialogTrigger asChild><Button variant="outline">Add Category</Button></DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Add New Category</DialogTitle>
                            <DialogDescription>Create a new section for your menu.</DialogDescription>
                        </DialogHeader>
                        <CategoryForm onSubmit={handleAddCategory} />
                    </DialogContent>
                </Dialog>
                <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
                <DialogTrigger asChild>
                    <Button>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Item
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Add New Menu Item</DialogTitle>
                        <DialogDescription>Fill in the details for the new menu item.</DialogDescription>
                    </DialogHeader>
                    <MenuItemForm onSubmit={handleAddItem} categories={categories} />
                </DialogContent>
                </Dialog>
            </div>
        </div>
        <Card>
            <CardHeader>
            <CardTitle>Menu Items</CardTitle>
            <CardDescription>
                A list of all items on your menu, grouped by category. Drag items to re-categorize or re-order.
            </CardDescription>
            </CardHeader>
            <CardContent>
                {categories.length > 0 ? (
                    <Accordion type="multiple" defaultValue={categories} className="w-full">
                        {categories.map((category) => (
                            <DroppableCategory 
                                key={category} 
                                category={category} 
                                items={groupedItems[category] || []} 
                                onRemoveItem={handleRemoveItem}
                                onRemoveCategory={handleRemoveCategory}
                                currencySymbol={currencySymbol}
                                activeId={activeId}
                            />
                        ))}
                    </Accordion>
                ) : (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="mb-2">Your menu is empty.</p>
                        <p className="mb-4">Start by adding a category or a menu item.</p>
                    </div>
                )}
            </CardContent>
        </Card>
        </div>
        <DragOverlay>
            {activeItem ? (
                <div className="shadow-lg rounded-md">
                     <SortableMenuItem item={activeItem} onRemoveItem={() => {}} currencySymbol={currencySymbol} isDragging />
                </div>
            ) : null}
        </DragOverlay>
    </DndContext>
  );
}


function MenuItemForm({ onSubmit, categories }: { onSubmit: (data: MenuItemFormData) => void; categories: string[] }) {
    const { register, handleSubmit, control, formState: { errors } } = useForm<MenuItemFormData>({
        resolver: zodResolver(menuItemSchema)
    });

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">Name</Label>
                <div className="col-span-3">
                    <Input id="name" {...register("name")} placeholder="e.g., Caesar Salad" />
                    {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
                </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="price" className="text-right">Price</Label>
                <div className="col-span-3">
                    <Input id="price" type="number" step="0.01" {...register("price")} placeholder="e.g., 12.50" />
                     {errors.price && <p className="text-sm text-destructive mt-1">{errors.price.message}</p>}
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
                                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                                <SelectContent>
                                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    {errors.category && <p className="text-sm text-destructive mt-1">{errors.category.message}</p>}
                </div>
            </div>
             <DialogFooter>
                <Button type="submit">Save Item</Button>
            </DialogFooter>
        </form>
    );
}

function CategoryForm({ onSubmit }: { onSubmit: (data: CategoryFormData) => void; }) {
    const { register, handleSubmit, formState: { errors } } = useForm<CategoryFormData>({
        resolver: zodResolver(categorySchema)
    });
    
    return (
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">Name</Label>
                <div className="col-span-3">
                    <Input id="name" {...register("name")} placeholder="e.g., Sides" />
                    {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
                </div>
            </div>
             <DialogFooter>
                <Button type="submit">Save Category</Button>
            </DialogFooter>
        </form>
    )
}
