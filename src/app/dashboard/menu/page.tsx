
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
import { Badge } from "@/components/ui/badge";
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
import { PlusCircle, MoreVertical, Trash2, Utensils, GripVertical, Upload, ChefHat, X, Pencil, Flame, Search } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragOverlay } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { type MenuItem, type RecipeIngredient } from "./data";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import {
  getMenuItems,
  getMenuCategories,
  addMenuItem,
  addMenuCategory,
  removeMenuCategory,
  saveMenuItems,
  getMenuCosting,
  getKitchenSections,
  saveKitchenSections,
  renameKitchenSection,
  type MenuCosting,
  type MenuCostingItem,
} from "@/lib/db";

const menuItemSchema = z.object({
  name: z.string().min(1, "Item name is required."),
  price: z.coerce.number().min(0.01, "Price must be greater than 0."),
  category: z.string().min(1, "Category is required."),
  // Optional KOT prep station (tandoor/grill/bar/...) for KDS routing.
  station: z.string().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, "Category name is required."),
});

type MenuItemFormData = z.infer<typeof menuItemSchema>;
type CategoryFormData = z.infer<typeof categorySchema>;

// A station is "managed" when it appears in the restaurant's kitchen-section
// list; stations left behind by a deleted section stay on the item but render
// with unassigned (dashed/amber) styling until re-assigned.
const isManagedStation = (station: string | null | undefined, sections: string[]) =>
    !!station && sections.some((s) => s.toLowerCase() === station.toLowerCase());

function SortableMenuItem({ item, onRemoveItem, onEditRecipe, costing, currencySymbol, isDragging, sections = [], showCategory = false }: { item: MenuItem, onRemoveItem: (id: string) => void, onEditRecipe?: (item: MenuItem) => void, costing?: MenuCostingItem, currencySymbol: string, isDragging?: boolean, sections?: string[], showCategory?: boolean }) {
    const { attributes, listeners, setNodeRef } = useSortable({
        id: item.id,
        data: { category: item.category },
    });

    const unmanagedStation = !!item.station && sections.length > 0 && !isManagedStation(item.station, sections);

    return (
        <li ref={setNodeRef} className={cn("flex items-center justify-between rounded-md border p-3 bg-background touch-none", isDragging && "opacity-50")}>
            <div className="flex items-center gap-2">
                 <button {...listeners} {...attributes} className="cursor-grab p-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                </button>
                <div>
                    <p className="font-medium flex items-center gap-1.5">
                        {item.name}
                        {item.station ? (
                            <Badge
                                variant="outline"
                                title={unmanagedStation ? "This section was removed — item is unassigned until you pick a managed section." : undefined}
                                className={cn(
                                    "text-[10px] uppercase tracking-wide px-1.5 py-0",
                                    unmanagedStation && "border-dashed border-amber-400 text-amber-700 dark:text-amber-400",
                                )}
                            >
                                {item.station}
                            </Badge>
                        ) : null}
                        {showCategory ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {item.category}
                            </Badge>
                        ) : null}
                    </p>
                    {costing?.cost != null && (
                        <p className="text-xs text-muted-foreground">
                            Cost {currencySymbol}{costing.cost.toFixed(2)}
                            {costing.margin_pct != null && (
                                <span className={cn("ml-1 font-medium", costing.margin_pct >= 60 ? "text-green-600" : costing.margin_pct >= 40 ? "text-amber-600" : "text-destructive")}>
                                    · {costing.margin_pct.toFixed(0)}% margin
                                </span>
                            )}
                            {costing.missing_costs > 0 && <span className="ml-1">(partial — {costing.missing_costs} uncosted)</span>}
                        </p>
                    )}
                </div>
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
                        {onEditRecipe && (
                            <DropdownMenuItem onClick={() => { onEditRecipe(item); }}>
                                <ChefHat className="mr-2 h-4 w-4" />
                                <span>Recipe &amp; cost</span>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="text-destructive" onClick={() => { onRemoveItem(item.id); }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                 </DropdownMenu>
            </div>
        </li>
    );
}

function DroppableCategory({ category, items, onRemoveItem, onRemoveCategory, onEditRecipe, costingById, currencySymbol, activeId, sections }: { category: string, items: MenuItem[], onRemoveItem: (id: string) => void, onRemoveCategory: (category: string) => void, onEditRecipe: (item: MenuItem) => void, costingById: Map<string, MenuCostingItem>, currencySymbol: string, activeId: string | null, sections: string[] }) {
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
                                                    onClick={(event) => { event.stopPropagation(); }}
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
                    <DropdownMenuContent align="end" onClick={(event) => { event.stopPropagation(); }}>
                        <DropdownMenuLabel>Category Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => { onRemoveCategory(category); }}>
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
                                <SortableMenuItem key={item.id} item={item} onRemoveItem={onRemoveItem} onEditRecipe={onEditRecipe} costing={costingById.get(item.id)} currencySymbol={currencySymbol} isDragging={activeId === item.id} sections={sections} />
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
    const [costing, setCosting] = useState<MenuCosting>({ items: [], ingredients: [] });
    const [recipeItem, setRecipeItem] = useState<MenuItem | null>(null);
    // Managed kitchen sections (Tandoor/Curry/Bar/...) — each gets its own KDS display.
    const [sections, setSections] = useState<string[]>([]);
    const [newSection, setNewSection] = useState("");
    const [sectionBusy, setSectionBusy] = useState(false);
    const [isOrganiseOpen, setIsOrganiseOpen] = useState(false);
    // Menu search — while a query is active the list goes FLAT across every
    // category (same idiom as the order-entry search); empty query keeps the
    // grouped/draggable accordion exactly as before.
    const [menuSearch, setMenuSearch] = useState("");

    const refreshCosting = async (restaurantUsername: string) => {
        try {
            setCosting(await getMenuCosting(restaurantUsername));
        } catch {
            /* costing is an enrichment — never block the menu page on it */
        }
    };

  useEffect(() => {
    if (user) {
        const fetchData = async () => {
          setMenuItems(await getMenuItems(user.restaurantUsername));
          setCategories(await getMenuCategories(user.restaurantUsername));
          setSections(await getKitchenSections(user.restaurantUsername));
          await refreshCosting(user.restaurantUsername);
        }
        fetchData();
    }
  }, [user]);

    const costingById = new Map(costing.items.map((c) => [c.id, c]));

  const sensors = useSensors(useSensor(PointerSensor));

  const groupedItems = menuItems.reduce<Record<string, MenuItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});
  
  const updateMenuItems = async (updatedItems: MenuItem[]) => {
    if (!user) {return;}
    setMenuItems(updatedItems);
    await saveMenuItems(user.restaurantUsername, updatedItems);
  }

  const handleAddItem = async (data: MenuItemFormData) => {
    if (!user) {return;}
    const newItem: MenuItem = {
      id: (menuItems.length + 1).toString() + Date.now(),
      ...data,
    };
    await addMenuItem(user.restaurantUsername, newItem);
    setMenuItems([...menuItems, newItem]);
    setIsItemDialogOpen(false);
  };
  
  const handleAddCategory = async (data: CategoryFormData) => {
    if (!user) {return;}
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
        if (!user?.restaurantUsername) {return;}

        const itemCount = menuItems.filter((item) => item.category === categoryName).length;
        const shouldDelete = window.confirm(
            itemCount > 0
                ? `Delete category "${categoryName}" and ${itemCount} item${itemCount === 1 ? "" : "s"} in it?`
                : `Delete category "${categoryName}"?`,
        );

        if (!shouldDelete) {return;}

        try {
            await removeMenuCategory(user.restaurantUsername, categoryName);
            setMenuItems((prev) => prev.filter((item) => item.category.toLowerCase() !== categoryName.toLowerCase()));
            setCategories((prev) => prev.filter((category) => category.toLowerCase() !== categoryName.toLowerCase()));
        } catch (error: any) {
            console.error("menu_category_delete_failed", error);
            window.alert(String(error?.message ?? "Unable to delete category."));
        }
    };

    // --- Kitchen sections (managed list; each section = one KDS display) ----
    const handleAddSection = async () => {
        if (!user) {return;}
        const name = newSection.trim().replace(/\s+/g, " ").slice(0, 32);
        if (!name) {return;}
        if (sections.some((s) => s.toLowerCase() === name.toLowerCase())) {
            setNewSection("");
            return;
        }
        setSectionBusy(true);
        try {
            setSections(await saveKitchenSections(user.restaurantUsername, [...sections, name]));
            setNewSection("");
        } catch (error: any) {
            window.alert(String(error?.message ?? "Unable to add section."));
        } finally {
            setSectionBusy(false);
        }
    };

    const handleRenameSection = async (from: string) => {
        if (!user) {return;}
        const to = window.prompt(`Rename kitchen section "${from}" to:`, from)?.trim().replace(/\s+/g, " ").slice(0, 32) ?? "";
        if (!to || to === from) {return;}
        setSectionBusy(true);
        try {
            const result = await renameKitchenSection(user.restaurantUsername, from, to);
            setSections(result.kitchen_sections ?? (await getKitchenSections(user.restaurantUsername)));
            // The rename cascades onto menu items — reload them so badges update.
            setMenuItems(await getMenuItems(user.restaurantUsername));
            window.alert(`Renamed "${from}" to "${to}" (${result.updated_items ?? 0} menu item${(result.updated_items ?? 0) === 1 ? "" : "s"} updated).`);
        } catch (error: any) {
            window.alert(String(error?.message ?? "Unable to rename section."));
        } finally {
            setSectionBusy(false);
        }
    };

    const handleDeleteSection = async (name: string) => {
        if (!user) {return;}
        const count = menuItems.filter((it) => (it.station ?? "").toLowerCase() === name.toLowerCase()).length;
        if (!window.confirm(
            count > 0
                ? `Remove kitchen section "${name}"? ${count} item${count === 1 ? "" : "s"} keep the label but show as unassigned until re-organised.`
                : `Remove kitchen section "${name}"?`,
        )) {return;}
        setSectionBusy(true);
        try {
            setSections(await saveKitchenSections(user.restaurantUsername, sections.filter((s) => s.toLowerCase() !== name.toLowerCase())));
        } catch (error: any) {
            window.alert(String(error?.message ?? "Unable to remove section."));
        } finally {
            setSectionBusy(false);
        }
    };

    // Persist the organise-dialog assignments through the preserve-on-omit bulk
    // save: only id/name/price/category/station travel, so recipes, modifiers,
    // allergens and images are untouched server-side.
    const handleOrganiseSave = async (assignments: Record<string, string | null>) => {
        if (!user) {return;}
        const minimal = menuItems.map((it) => ({
            id: it.id,
            name: it.name,
            price: it.price,
            category: it.category,
            station: assignments[it.id] !== undefined ? assignments[it.id] : (it.station ?? null),
        }));
        await saveMenuItems(user.restaurantUsername, minimal);
        setMenuItems(await getMenuItems(user.restaurantUsername));
        setIsOrganiseOpen(false);
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

            // A lone text cell is a section/category header. A lone number is a
            // stray serial (S/NO) — never a category.
            if (nonEmptyCells.length === 1) {
                const label = nonEmptyCells[0].replace(/\s+/g, " ").trim();
                if (!label || /^\d+(\.\d+)?$/.test(label)) {
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

            // Identify the item by NAME + PRICE, independent of any S/NO column.
            // Serial numbers are often drag-filled formulas (=A2+1) that some
            // spreadsheet readers hand back as blank/formula text; keying off that
            // column silently dropped every auto-numbered row. Instead: take the
            // price as the right-most positive amount, and the name as the first
            // non-empty cell that isn't the price and isn't a bare serial number.
            let priceValue: number | null = null;
            let priceIdx = -1;
            for (let i = row.length - 1; i >= 0; i -= 1) {
                const candidate = parsePriceValue(row[i]);
                if (candidate != null) {
                    priceValue = candidate;
                    priceIdx = i;
                    break;
                }
            }

            let itemName = "";
            for (let i = 0; i < row.length; i += 1) {
                if (i === priceIdx) {continue;}
                const cell = row[i];
                if (cell && !/^\d+(\.\d+)?$/.test(cell)) {
                    itemName = cell.replace(/\s+/g, " ").trim();
                    break;
                }
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
        if (!user?.restaurantUsername) {return;}

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
                raw: true,
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
                    if (!itemName) {continue;}

                    const rawPrice = parsePriceValue(row[priceKey]);
                    if (rawPrice == null) {continue;}

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
                    raw: true,
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
    if (!activeItem) {return;}

    const overIsCategory = categories.includes(overId);
    let newItems: MenuItem[] = menuItems;

    if (overIsCategory && activeItem.category !== overId) {
        newItems = menuItems.map(item => item.id === activeId ? { ...item, category: overId } : item);
    } else {
        const activeIndex = menuItems.findIndex(item => item.id === activeId);
        const overItem = menuItems.find(item => item.id === overId);
        const overIndex = overItem ? menuItems.findIndex(item => item.id === overId) : -1;

        if (activeItem.category === overItem?.category) {
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

  const menuQuery = menuSearch.trim().toLowerCase();
  const isSearching = menuQuery.length > 0;
  const searchResults = isSearching
    ? menuItems.filter((item) =>
        [item.name, item.category, item.station ?? ""].some((field) =>
            field.toLowerCase().includes(menuQuery),
        ),
      )
    : [];

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
                                        if (!file) {return;}
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
                    <MenuItemForm onSubmit={handleAddItem} categories={categories} sections={sections} />
                </DialogContent>
                </Dialog>
            </div>
        </div>
        <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-primary" /> Kitchen sections</CardTitle>
                    <CardDescription>
                        Each item routes to its kitchen section, and every section gets its own display on the Orders page. Rename cascades to all items in the section.
                    </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setIsOrganiseOpen(true); }} disabled={menuItems.length === 0}>
                    <ChefHat className="mr-2 h-4 w-4" /> Organise by kitchen
                </Button>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    {sections.length === 0 && (
                        <p className="text-sm text-muted-foreground">No kitchen sections yet — add e.g. Tandoor, Curry, Bar, Dessert.</p>
                    )}
                    {sections.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-sm">
                            {s}
                            <button
                                type="button"
                                className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                                title={`Rename ${s} (updates all its items)`}
                                aria-label={`Rename section ${s}`}
                                disabled={sectionBusy}
                                onClick={() => void handleRenameSection(s)}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                                title={`Remove ${s}`}
                                aria-label={`Remove section ${s}`}
                                disabled={sectionBusy}
                                onClick={() => void handleDeleteSection(s)}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex max-w-sm items-center gap-2">
                    <Input
                        placeholder="New section (e.g. Tandoor)"
                        value={newSection}
                        maxLength={32}
                        onChange={(e) => { setNewSection(e.target.value); }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void handleAddSection();
                            }
                        }}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleAddSection()} disabled={sectionBusy || !newSection.trim()}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add
                    </Button>
                </div>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
            <CardTitle>Menu Items</CardTitle>
            <CardDescription>
                A list of all items on your menu, grouped by category. Drag items to re-categorize or re-order.
            </CardDescription>
            <div className="relative max-w-sm pt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={menuSearch}
                    onChange={(e) => { setMenuSearch(e.target.value); }}
                    placeholder="Search menu…"
                    aria-label="Search menu items"
                    className="pl-9 pr-9"
                />
                {isSearching && (
                    <button
                        type="button"
                        aria-label="Clear menu search"
                        title="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => { setMenuSearch(""); }}
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            {isSearching && (
                <p className="text-sm text-muted-foreground">
                    {searchResults.length} item{searchResults.length === 1 ? "" : "s"} match “{menuSearch.trim()}” across all categories
                </p>
            )}
            </CardHeader>
            <CardContent>
                {isSearching ? (
                    searchResults.length > 0 ? (
                        <SortableContext items={searchResults.map(i => i.id)}>
                            <ul className="space-y-2">
                                {searchResults.map(item => (
                                    <SortableMenuItem
                                        key={item.id}
                                        item={item}
                                        onRemoveItem={handleRemoveItem}
                                        onEditRecipe={setRecipeItem}
                                        costing={costingById.get(item.id)}
                                        currencySymbol={currencySymbol}
                                        isDragging={activeId === item.id}
                                        sections={sections}
                                        showCategory
                                    />
                                ))}
                            </ul>
                        </SortableContext>
                    ) : (
                        <div className="text-center text-muted-foreground py-12">
                            <p className="mb-2">No items match your search.</p>
                            <Button variant="outline" size="sm" onClick={() => { setMenuSearch(""); }}>Clear search</Button>
                        </div>
                    )
                ) : categories.length > 0 ? (
                    <Accordion type="multiple" defaultValue={categories} className="w-full">
                        {categories.map((category) => (
                            <DroppableCategory
                                key={category}
                                category={category}
                                items={groupedItems[category] || []}
                                onRemoveItem={handleRemoveItem}
                                onRemoveCategory={handleRemoveCategory}
                                onEditRecipe={setRecipeItem}
                                costingById={costingById}
                                currencySymbol={currencySymbol}
                                activeId={activeId}
                                sections={sections}
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
        {isOrganiseOpen && (
            <OrganiseByKitchenDialog
                items={menuItems}
                sections={sections}
                onClose={() => { setIsOrganiseOpen(false); }}
                onSave={handleOrganiseSave}
            />
        )}
        {recipeItem && user && (
            <RecipeDialog
                item={recipeItem}
                ingredients={costing.ingredients}
                currencySymbol={currencySymbol}
                sections={sections}
                onClose={() => { setRecipeItem(null); }}
                onSave={async (recipe, station, allergens) => {
                    await addMenuItem(user.restaurantUsername, { ...recipeItem, recipe, station, allergens });
                    setRecipeItem(null);
                    setMenuItems(await getMenuItems(user.restaurantUsername));
                    await refreshCosting(user.restaurantUsername);
                }}
            />
        )}
    </DndContext>
  );
}

// Common prep stations offered as suggestions — used only while the restaurant
// has no managed kitchen-section list yet (then the field stays free-form).
const STATION_SUGGESTIONS = ["tandoor", "grill", "curry", "chinese", "fryer", "salad", "bar", "dessert"];

// Radix Select forbids empty item values — sentinel for "no section".
const NO_STATION = "__none__";

// Kitchen-section picker: offers the MANAGED sections (plus the item's current
// station when it isn't in the list, styled as unassigned) and a None option.
function StationSelect({ value, sections, onChange, id }: { value: string; sections: string[]; onChange: (v: string) => void; id?: string }) {
    const current = value.trim();
    const unlisted = current && !sections.some((s) => s.toLowerCase() === current.toLowerCase());
    return (
        <Select value={current || NO_STATION} onValueChange={(v) => { onChange(v === NO_STATION ? "" : v); }}>
            <SelectTrigger id={id} className={cn(unlisted && "border-dashed border-amber-400 text-amber-700 dark:text-amber-400")}>
                <SelectValue placeholder="No section" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NO_STATION}>No section</SelectItem>
                {sections.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                {unlisted ? (
                    <SelectItem value={current} className="text-amber-700 dark:text-amber-400">{current} (unassigned)</SelectItem>
                ) : null}
            </SelectContent>
        </Select>
    );
}

// "Organise by kitchen": every menu item grouped by its CURRENT section (incl.
// Unassigned), searchable, with a quick per-row section picker. Saving persists
// through the preserve-on-omit bulk menu save (recipes etc. survive).
function OrganiseByKitchenDialog({
    items,
    sections,
    onClose,
    onSave,
}: {
    items: MenuItem[];
    sections: string[];
    onClose: () => void;
    onSave: (assignments: Record<string, string | null>) => Promise<void>;
}) {
    const [assignments, setAssignments] = useState<Record<string, string | null>>({});
    const [search, setSearch] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const stationOf = (item: MenuItem) => {
        const assigned = assignments[item.id];
        return (assigned !== undefined ? assigned : item.station) ?? "";
    };

    const q = search.trim().toLowerCase();
    const visible = q
        ? items.filter((it) => it.name.toLowerCase().includes(q) || it.category.toLowerCase().includes(q) || stationOf(it).toLowerCase().includes(q))
        : items;

    // Group by current section: managed sections first (in managed order), then
    // any unmanaged station labels still on items, then Unassigned.
    const managedLower = sections.map((s) => s.toLowerCase());
    const groups: { label: string; unmanaged: boolean; rows: MenuItem[] }[] = sections.map((s) => ({ label: s, unmanaged: false, rows: [] as MenuItem[] }));
    const extra = new Map<string, MenuItem[]>();
    const unassigned: MenuItem[] = [];
    for (const it of visible) {
        const st = stationOf(it).trim();
        if (!st) { unassigned.push(it); continue; }
        const idx = managedLower.indexOf(st.toLowerCase());
        if (idx >= 0) { groups[idx].rows.push(it); continue; }
        const list = extra.get(st) ?? [];
        list.push(it);
        extra.set(st, list);
    }
    for (const [label, rows] of Array.from(extra.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        groups.push({ label, unmanaged: true, rows });
    }
    groups.push({ label: "Unassigned", unmanaged: true, rows: unassigned });

    const changedCount = Object.keys(assignments).filter((id) => {
        const item = items.find((it) => it.id === id);
        return item && (assignments[id] ?? "") !== (item.station ?? "");
    }).length;

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await onSave(assignments);
        } catch (e: any) {
            setError(String(e?.message ?? "Unable to save assignments."));
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>Organise menu by kitchen</DialogTitle>
                    <DialogDescription>
                        Assign every dish to its kitchen section — each section has its own display in the kitchen.
                    </DialogDescription>
                </DialogHeader>
                <Input
                    placeholder="Search items, categories or sections…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); }}
                />
                <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
                    {groups.filter((g) => g.rows.length > 0 || !g.unmanaged).map((g) => (
                        <div key={g.label}>
                            <p className={cn("mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide", g.unmanaged ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                                {g.label}
                                {g.unmanaged && g.label !== "Unassigned" ? <span className="font-normal normal-case">(not a managed section)</span> : null}
                                <span className="font-normal">· {g.rows.length}</span>
                            </p>
                            {g.rows.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No items yet.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {g.rows.map((it) => (
                                        <li key={it.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">{it.name}</p>
                                                <p className="text-xs text-muted-foreground">{it.category}</p>
                                            </div>
                                            <div className="w-44 shrink-0">
                                                <StationSelect
                                                    value={stationOf(it)}
                                                    sections={sections}
                                                    onChange={(v) => { setAssignments((prev) => ({ ...prev, [it.id]: v || null })); }}
                                                />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                    {visible.length === 0 && <p className="text-sm text-muted-foreground">No items match “{search}”.</p>}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={busy || changedCount === 0}>
                        {busy ? "Saving…" : `Save${changedCount > 0 ? ` (${changedCount} change${changedCount === 1 ? "" : "s"})` : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Fixed allergen suggestion set (free-form tags are also allowed). These show
// as chips on the guest-facing QR menu.
const ALLERGEN_SUGGESTIONS = ["gluten", "dairy", "nuts", "peanut", "egg", "soy", "shellfish", "fish", "sesame"];

// Recipe/BOM editor: which inventory ingredients (and how much) one unit of the
// dish consumes. Costs use the latest recorded purchase price per ingredient.
// Also hosts the KOT prep-station assignment for the dish.
function RecipeDialog({
    item,
    ingredients,
    currencySymbol,
    sections,
    onClose,
    onSave,
}: {
    item: MenuItem;
    ingredients: MenuCosting["ingredients"];
    currencySymbol: string;
    sections: string[];
    onClose: () => void;
    onSave: (recipe: RecipeIngredient[], station: string | null, allergens: string[]) => Promise<void>;
}) {
    const [rows, setRows] = useState<{ inventory_id: string; qty: string; note: string }[]>(
        (item.recipe ?? []).map((r) => ({ inventory_id: r.inventory_id, qty: String(r.qty), note: r.note ?? "" })),
    );
    const [station, setStation] = useState<string>(item.station ?? "");
    const [allergens, setAllergens] = useState<string[]>(item.allergens ?? []);
    const [allergenInput, setAllergenInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggleAllergen = (tag: string) => {
        const t = tag.trim().toLowerCase().slice(0, 24);
        if (!t) {return;}
        setAllergens((prev) => (prev.includes(t) ? prev.filter((a) => a !== t) : [...prev, t]));
    };
    const addFreeformAllergen = () => {
        const t = allergenInput.trim().toLowerCase().slice(0, 24);
        if (t && !allergens.includes(t)) {setAllergens((prev) => [...prev, t]);}
        setAllergenInput("");
    };

    const costOf = (invId: string) => ingredients.find((i) => i.id === invId)?.unit_cost ?? null;
    const unitOf = (invId: string) => ingredients.find((i) => i.id === invId)?.unit ?? "";

    let estCost = 0;
    let uncosted = 0;
    for (const r of rows) {
        const qty = Number(r.qty);
        if (!r.inventory_id || !Number.isFinite(qty) || qty <= 0) {continue;}
        const uc = costOf(r.inventory_id);
        if (uc == null) {uncosted += 1;}
        else {estCost += qty * uc;}
    }
    const margin = item.price > 0 ? ((item.price - estCost) / item.price) * 100 : null;

    const save = async () => {
        const recipe: RecipeIngredient[] = [];
        for (const r of rows) {
            const qty = Number(r.qty);
            if (!r.inventory_id) {continue;}
            if (!Number.isFinite(qty) || qty <= 0) {
                setError("Every ingredient needs a positive quantity.");
                return;
            }
            recipe.push({ inventory_id: r.inventory_id, qty, ...(r.note.trim() ? { note: r.note.trim() } : {}) });
        }
        setBusy(true);
        setError(null);
        try {
            await onSave(recipe, station.trim() ? station.trim() : null, allergens);
        } catch (e: any) {
            setError(e?.message ?? "Unable to save recipe");
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Recipe &amp; cost — {item.name}</DialogTitle>
                    <DialogDescription>Ingredients consumed per unit sold. Costs come from the latest purchase price.</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <Label htmlFor="prep-station" className="shrink-0">Kitchen section</Label>
                    {sections.length > 0 ? (
                        <div className="flex-1">
                            <StationSelect id="prep-station" value={station} sections={sections} onChange={setStation} />
                        </div>
                    ) : (
                        <>
                            <Input
                                id="prep-station"
                                list="station-suggestions"
                                placeholder="e.g. tandoor, grill, bar (KOT routing)"
                                value={station}
                                onChange={(e) => { setStation(e.target.value); }}
                                maxLength={40}
                            />
                            <datalist id="station-suggestions">
                                {STATION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                            </datalist>
                        </>
                    )}
                </div>
                <div className="space-y-2">
                    <Label>Allergens <span className="font-normal text-muted-foreground">(shown to guests on the QR menu)</span></Label>
                    <div className="flex flex-wrap gap-1.5">
                        {ALLERGEN_SUGGESTIONS.map((a) => {
                            const on = allergens.includes(a);
                            return (
                                <button
                                    key={a}
                                    type="button"
                                    onClick={() => { toggleAllergen(a); }}
                                    className={cn(
                                        "rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors",
                                        on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                                    )}
                                >
                                    {a}
                                </button>
                            );
                        })}
                        {allergens.filter((a) => !ALLERGEN_SUGGESTIONS.includes(a)).map((a) => (
                            <button
                                key={a}
                                type="button"
                                onClick={() => { toggleAllergen(a); }}
                                className="rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs capitalize text-primary-foreground"
                                title="Click to remove"
                            >
                                {a} ×
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <Input
                            placeholder="Other allergen (free-form)…"
                            value={allergenInput}
                            maxLength={24}
                            onChange={(e) => { setAllergenInput(e.target.value); }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addFreeformAllergen();
                                }
                            }}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={addFreeformAllergen} disabled={!allergenInput.trim()}>Add</Button>
                    </div>
                </div>
                <div className="grid gap-2 py-2 max-h-[45vh] overflow-y-auto pr-1">
                    {rows.length === 0 && (
                        <p className="text-sm text-muted-foreground">No ingredients yet — add the first one below.</p>
                    )}
                    {rows.map((row, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <Select
                                    value={row.inventory_id}
                                    onValueChange={(v) => { setRows(rows.map((r, i) => (i === idx ? { ...r, inventory_id: v } : r))); }}
                                >
                                    <SelectTrigger><SelectValue placeholder="Ingredient" /></SelectTrigger>
                                    <SelectContent>
                                        {ingredients.map((ing) => (
                                            <SelectItem key={ing.id} value={ing.id}>
                                                {ing.name}{ing.unit_cost != null ? ` — ${currencySymbol}${ing.unit_cost}/${ing.unit}` : " (no cost yet)"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Input
                                type="number"
                                min="0"
                                step="any"
                                className="w-20"
                                placeholder={`Qty${unitOf(row.inventory_id) ? ` (${unitOf(row.inventory_id)})` : ""}`}
                                aria-label="Quantity"
                                value={row.qty}
                                onChange={(e) => { setRows(rows.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r))); }}
                            />
                            <Input
                                className="w-28"
                                placeholder="Note (opt.)"
                                aria-label="Unit note"
                                value={row.note}
                                onChange={(e) => { setRows(rows.map((r, i) => (i === idx ? { ...r, note: e.target.value } : r))); }}
                            />
                            <Button variant="ghost" size="icon" aria-label="Remove ingredient" onClick={() => { setRows(rows.filter((_, i) => i !== idx)); }}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => { setRows([...rows, { inventory_id: "", qty: "", note: "" }]); }}
                        disabled={ingredients.length === 0}
                    >
                        <PlusCircle className="mr-2 h-4 w-4" /> Add ingredient
                    </Button>
                    {ingredients.length === 0 && (
                        <p className="text-xs text-muted-foreground">Add inventory items first — recipes reference them.</p>
                    )}
                </div>
                <div className="rounded-md border p-3 text-sm">
                    <p>
                        Theoretical cost: <span className="font-medium">{currencySymbol}{estCost.toFixed(2)}</span>
                        {margin != null && (
                            <span className="text-muted-foreground"> · margin {margin.toFixed(0)}% at {currencySymbol}{item.price.toFixed(2)}</span>
                        )}
                    </p>
                    {uncosted > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">{uncosted} ingredient(s) have no recorded purchase cost — receive stock with a unit cost to complete the estimate.</p>
                    )}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={busy}>Save recipe</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


function MenuItemForm({ onSubmit, categories, sections = [] }: { onSubmit: (data: MenuItemFormData) => void; categories: string[]; sections?: string[] }) {
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
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="station" className="text-right">Section</Label>
                <div className="col-span-3">
                    {sections.length > 0 ? (
                        <Controller
                            name="station"
                            control={control}
                            render={({ field }) => (
                                <StationSelect id="station" value={field.value ?? ""} sections={sections} onChange={field.onChange} />
                            )}
                        />
                    ) : (
                        <>
                            <Input id="station" list="station-suggestions-add" maxLength={40} {...register("station")} placeholder="Optional — e.g. tandoor, grill, bar" />
                            <datalist id="station-suggestions-add">
                                {STATION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                            </datalist>
                        </>
                    )}
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
