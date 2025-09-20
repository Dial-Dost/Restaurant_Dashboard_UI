
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlusCircle, MoreVertical, Trash2, Utensils, GripVertical } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { type MenuItem } from "./data";
import { useAuth } from "@/context/AuthContext";
import { getMenuItems, getMenuCategories, addMenuItem, addMenuCategory, saveMenuItems } from "@/lib/db";

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

function SortableMenuItem({ item, onRemoveItem, isDragging }: { item: MenuItem, onRemoveItem: (id: string) => void, isDragging?: boolean }) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
        id: item.id,
        data: { category: item.category },
    });

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
    };

    return (
        <li ref={setNodeRef} style={style} className={cn("flex items-center justify-between rounded-md border p-3 bg-background touch-none", isDragging && "opacity-50")}>
            <div className="flex items-center gap-2">
                 <button {...listeners} {...attributes} className="cursor-grab p-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                </button>
                <p className="font-medium">{item.name}</p>
            </div>
            <div className="flex items-center gap-4">
                 <p className="text-muted-foreground">${item.price.toFixed(2)}</p>
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

function DroppableCategory({ category, items, onRemoveItem, activeId }: { category: string, items: MenuItem[], onRemoveItem: (id: string) => void, activeId: string | null }) {
    const { isOver, setNodeRef } = useDroppable({
        id: category,
    });
    
    return (
        <AccordionItem value={category} key={category}>
            <AccordionTrigger className="text-xl font-semibold hover:no-underline">
                <div className="flex items-center gap-2">
                   <Utensils className="h-5 w-5 text-primary" /> {category}
                </div>
            </AccordionTrigger>
            <AccordionContent ref={setNodeRef} className={`p-2 rounded-md transition-colors ${isOver ? 'bg-accent' : ''}`}>
                 <SortableContext items={items.map(i => i.id)}>
                    {items && items.length > 0 ? (
                        <ul className="space-y-2">
                            {items.map(item => (
                                <SortableMenuItem key={item.id} item={item} onRemoveItem={onRemoveItem} isDragging={activeId === item.id} />
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
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
        const fetchData = async () => {
          setMenuItems(await getMenuItems(user.restaurantId));
          setCategories(await getMenuCategories(user.restaurantId));
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
    await saveMenuItems(user.restaurantId, updatedItems);
  }

  const handleAddItem = async (data: MenuItemFormData) => {
    if (!user) return;
    const newItem: MenuItem = {
      id: (menuItems.length + 1).toString() + Date.now(),
      ...data,
    };
    await addMenuItem(user.restaurantId, newItem);
    setMenuItems([...menuItems, newItem]);
    setIsItemDialogOpen(false);
  };
  
  const handleAddCategory = async (data: CategoryFormData) => {
    if (!user) return;
    if (!categories.find(c => c.toLowerCase() === data.name.toLowerCase())) {
        await addMenuCategory(user.restaurantId, data.name);
        setCategories([...categories, data.name]);
    }
    setIsCategoryDialogOpen(false);
  }

  const handleRemoveItem = (itemId: string) => {
    const newItems = menuItems.filter(item => item.id !== itemId);
    updateMenuItems(newItems);
  }
  
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
                     <SortableMenuItem item={activeItem} onRemoveItem={() => {}} isDragging />
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
