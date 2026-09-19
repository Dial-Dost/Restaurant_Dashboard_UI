"use client";

/**
 * The FULL item editor (modules.dart `_MenuItemDialog`), in Flutter's field
 * order: photo → Item name (autofocus) → Price (₹ prefix) → Category (with the
 * inline "+ New category" sentinel) → Description (500-char counter) →
 * Available switch → "KITCHEN SECTION · KOT ROUTING" selector → Modifiers /
 * variants → Recipe. Validation is Flutter's: name + category required,
 * silently (price defaults to 0).
 *
 * The photo uploads base64 to POST /menu/upload-image and travels as
 * `image_url` on save; an emptied description travels as "" (a clear).
 *
 * The allergen chip editor is a [web-extra] kept from the old Recipe & cost
 * dialog (Flutter's owner app has no allergen surface in this module) — parity
 * work must not delete it, and this dialog is now its home.
 */

import * as React from "react";
import { ImagePlus, Plus, PlusCircle, Trash2, X } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { cn } from "@/lib/utils";
import type { RecipeIngredient } from "@/app/dashboard/menu/data";
import {
    fetchRecipeInventory,
    uploadMenuImage,
} from "@/lib/api/menu";
import type {
    MenuModifierGroup,
    MenuModuleItem,
    MenuUpsertPayload,
} from "@/lib/api/menu";
import { SectionSelector } from "./section-selector";

// Guest-facing description cap — mirrors the server-side sanitizer.
const BLURB_MAX = 500;

const NEW_CAT = "__new_category__";

// Fixed allergen suggestion set (free-form tags are also allowed) — [web-extra].
const ALLERGEN_SUGGESTIONS = ["gluten", "dairy", "nuts", "peanut", "egg", "soy", "shellfish", "fish", "sesame"];

interface OptionRow { key: string; name: string; price: string }
interface GroupRow { key: string; name: string; multi: boolean; required: boolean; options: OptionRow[] }
interface RecipeRow { key: string; inventoryId: string; qty: string }

let rowSeq = 0;
const newKey = (): string => `row-${++rowSeq}`;

export function MenuItemEditor({
    restaurantId,
    existing,
    categories,
    sections,
    onSubmit,
    onClose,
}: {
    restaurantId: string;
    existing: MenuModuleItem | null;
    categories: string[];
    sections: string[];
    /** Called with the full upsert payload; the dialog closes itself first
     *  (Flutter pops the dialog, then the module POSTs and snackbars errors). */
    onSubmit: (payload: MenuUpsertPayload) => void;
    onClose: () => void;
}): React.JSX.Element {
    const { toast } = useToast();

    const [name, setName] = React.useState(existing?.name ?? "");
    const [price, setPrice] = React.useState(existing == null ? "" : String(existing.price));
    const [blurb, setBlurb] = React.useState(existing?.blurb ?? "");
    const [imageUrl, setImageUrl] = React.useState<string>(existing?.image_url ?? "");
    const [uploading, setUploading] = React.useState(false);
    const [available, setAvailable] = React.useState(existing ? existing.available !== false : true);
    const [station, setStation] = React.useState(existing?.station ?? "");
    const [allergens, setAllergens] = React.useState<string[]>(existing?.allergens ?? []);
    const [allergenInput, setAllergenInput] = React.useState("");

    // Category: current if managed, else the first, else straight into
    // new-category mode — so the very first item can always be created.
    const [category, setCategory] = React.useState<string>(() => {
        const cur = existing?.category ?? "";
        if (cur && categories.includes(cur)) { return cur; }
        return categories[0] ?? "";
    });
    const [addingNewCat, setAddingNewCat] = React.useState(categories.length === 0);
    const [newCat, setNewCat] = React.useState("");

    const [modifiers, setModifiers] = React.useState<GroupRow[]>(() =>
        (existing?.modifiers ?? []).map((g) => ({
            key: newKey(),
            name: g.name,
            multi: g.multi,
            required: g.required,
            options: g.options.map((o) => ({ key: newKey(), name: o.name, price: String(o.price) })),
        })),
    );
    const [recipe, setRecipe] = React.useState<RecipeRow[]>(() =>
        (existing?.recipe ?? []).map((r) => ({ key: newKey(), inventoryId: r.inventory_id, qty: String(r.qty) })),
    );

    // Inventory list for the recipe ingredient picker.
    const inventory = useCachedFetch(
        `menu:recipe-inventory:${restaurantId}`,
        fetchRecipeInventory,
    );
    const inventoryRows = inventory.data ?? [];

    const fileRef = React.useRef<HTMLInputElement | null>(null);

    const pickImage = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const buf = await file.arrayBuffer();
            let binary = "";
            const bytes = new Uint8Array(buf);
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) {
                binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            const b64 = btoa(binary);
            const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
            const ct = ext === "png" ? "image/png" : "image/jpeg";
            const url = await uploadMenuImage(b64, ct);
            setImageUrl(url);
        } catch (e) {
            toast({
                title: "Image upload failed.",
                description: e instanceof Error ? e.message : undefined,
                variant: "destructive",
            });
        } finally {
            setUploading(false);
            if (fileRef.current) { fileRef.current.value = ""; }
        }
    };

    const toggleAllergen = (tag: string): void => {
        const t = tag.trim().toLowerCase().slice(0, 24);
        if (!t) { return; }
        setAllergens((prev) => (prev.includes(t) ? prev.filter((a) => a !== t) : [...prev, t]));
    };
    const addFreeformAllergen = (): void => {
        const t = allergenInput.trim().toLowerCase().slice(0, 24);
        if (t && !allergens.includes(t)) { setAllergens((prev) => [...prev, t]); }
        setAllergenInput("");
    };

    const cleanModifiers = (): MenuModifierGroup[] =>
        modifiers
            .filter((g) => g.name.trim() !== "")
            .map((g) => ({
                name: g.name.trim(),
                multi: g.multi,
                required: g.required,
                options: g.options
                    .filter((o) => o.name.trim() !== "")
                    .map((o) => ({ name: o.name.trim(), price: Number.parseFloat(o.price) || 0 })),
            }))
            .filter((g) => g.options.length > 0);

    const cleanRecipe = (): RecipeIngredient[] =>
        recipe
            .filter((r) => r.inventoryId !== "" && (Number.parseFloat(r.qty) || 0) > 0)
            .map((r) => ({ inventory_id: r.inventoryId, qty: Number.parseFloat(r.qty) || 0 }));

    const submit = (): void => {
        const finalName = name.trim();
        const finalCategory = addingNewCat ? newCat.trim() : category;
        if (!finalName || !finalCategory) { return; }
        onSubmit({
            ...(existing?.id ? { id: existing.id } : {}),
            name: finalName,
            price: Number.parseFloat(price.trim()) || 0,
            category: finalCategory,
            // Always sent because this dialog always shows the current text:
            // "" clears it, which is what an owner who empties the field means.
            blurb: blurb.trim(),
            image_url: imageUrl,
            available,
            station: station.trim() === "" ? null : station.trim(),
            modifiers: cleanModifiers(),
            recipe: cleanRecipe(),
            allergens,
        });
    };

    const patchGroup = (key: string, patch: Partial<GroupRow>): void => {
        setModifiers((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
    };
    const patchOption = (groupKey: string, optionKey: string, patch: Partial<OptionRow>): void => {
        setModifiers((prev) =>
            prev.map((g) =>
                g.key === groupKey
                    ? { ...g, options: g.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) }
                    : g,
            ),
        );
    };

    const categoryOptions = [...categories, NEW_CAT];

    return (
        <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
            <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[460px]">
                <DialogHeader className="px-5 pb-2 pt-5 text-left">
                    <div className="micro-label mb-1.5">Menu</div>
                    <DialogTitle>{existing == null ? "Add menu item" : "Edit menu item"}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {existing == null ? "Add menu item" : "Edit menu item"}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3">
                    {/* Photo picker + preview (shown to customers while ordering). */}
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        className="hidden"
                        aria-label="Dish photo"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) { void pickImage(file); }
                        }}
                    />
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label={imageUrl ? "Change photo" : "Add photo"}
                        className={cn(
                            "relative flex h-[120px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-border bg-inset bg-cover bg-center outline-none",
                            !uploading && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        style={imageUrl ? { backgroundImage: `url(${JSON.stringify(imageUrl)})` } : undefined}
                        onClick={() => { if (!uploading) { fileRef.current?.click(); } }}
                        onKeyDown={(e) => {
                            if ((e.key === "Enter" || e.key === " ") && !uploading) {
                                e.preventDefault();
                                fileRef.current?.click();
                            }
                        }}
                    >
                        {uploading ? (
                            <SkeletonBox width={120} height={16} />
                        ) : imageUrl === "" ? (
                            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                <ImagePlus className="h-5 w-5" />
                                <span className="text-xs">Add photo</span>
                            </div>
                        ) : (
                            <button
                                type="button"
                                aria-label="Remove photo"
                                title="Remove photo"
                                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setImageUrl("");
                                }}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="menu-item-name">Item name</Label>
                        <Input id="menu-item-name" autoFocus value={name} onChange={(e) => { setName(e.target.value); }} />
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="menu-item-price">Price</Label>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                            <Input
                                id="menu-item-price"
                                className="pl-7"
                                inputMode="decimal"
                                value={price}
                                onChange={(e) => { setPrice(e.target.value); }}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="menu-item-category">{addingNewCat ? "New category" : "Category"}</Label>
                        {!addingNewCat ? (
                            <Select
                                value={category === "" ? undefined : category}
                                onValueChange={(v) => {
                                    if (v === NEW_CAT) {
                                        setAddingNewCat(true);
                                    } else {
                                        setCategory(v);
                                    }
                                }}
                            >
                                <SelectTrigger id="menu-item-category"><SelectValue placeholder="Category" /></SelectTrigger>
                                <SelectContent>
                                    {categoryOptions.map((c) => (
                                        <SelectItem key={c} value={c}>{c === NEW_CAT ? "+ New category" : c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Input
                                    id="menu-item-category"
                                    autoFocus
                                    value={newCat}
                                    onChange={(e) => { setNewCat(e.target.value); }}
                                />
                                {categories.length > 0 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Pick from list"
                                        aria-label="Pick from list"
                                        onClick={() => { setAddingNewCat(false); }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="menu-item-blurb">Description</Label>
                        <Textarea
                            id="menu-item-blurb"
                            rows={3}
                            maxLength={BLURB_MAX}
                            value={blurb}
                            onChange={(e) => { setBlurb(e.target.value); }}
                        />
                        <div className="flex items-start justify-between gap-2">
                            <p className="text-xs text-muted-foreground">Shown to guests when they open this item. Leave blank for none.</p>
                            <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", blurb.length >= BLURB_MAX && "text-destructive")}>
                                {blurb.length}/{BLURB_MAX}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 py-1">
                        <div>
                            <Label htmlFor="menu-item-available">Available</Label>
                            <p className="text-xs text-muted-foreground">{available ? "Customers can order this" : "Shown as Sold out"}</p>
                        </div>
                        <Switch id="menu-item-available" checked={available} onCheckedChange={setAvailable} />
                    </div>

                    <div className="space-y-1.5">
                        <div className="micro-label">Kitchen section · KOT routing</div>
                        <SectionSelector value={station} sections={sections} onChange={setStation} />
                    </div>

                    {/* ── MODIFIERS / VARIANTS ─────────────────────────────── */}
                    <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                            <div className="micro-label">Modifiers / variants</div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setModifiers((prev) => [
                                        ...prev,
                                        {
                                            key: newKey(),
                                            name: "",
                                            multi: false,
                                            required: false,
                                            options: [{ key: newKey(), name: "", price: "0" }],
                                        },
                                    ]);
                                }}
                            >
                                <Plus className="mr-1.5 h-3.5 w-3.5" /> Group
                            </Button>
                        </div>
                        {modifiers.map((g) => (
                            <div key={g.key} className="space-y-2 rounded-[10px] border border-border bg-inset p-3">
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <Input
                                            value={g.name}
                                            placeholder="Group (e.g. Size)"
                                            aria-label="Modifier group name"
                                            onChange={(e) => { patchGroup(g.key, { name: e.target.value }); }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Remove group"
                                        aria-label="Remove group"
                                        onClick={() => { setModifiers((prev) => prev.filter((x) => x.key !== g.key)); }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="flex items-center gap-5">
                                    <label className="flex items-center gap-2 text-xs">
                                        <Checkbox
                                            checked={g.multi}
                                            onCheckedChange={(v) => { patchGroup(g.key, { multi: v === true }); }}
                                        />
                                        Multi
                                    </label>
                                    <label className="flex items-center gap-2 text-xs">
                                        <Checkbox
                                            checked={g.required}
                                            onCheckedChange={(v) => { patchGroup(g.key, { required: v === true }); }}
                                        />
                                        Required
                                    </label>
                                </div>
                                {g.options.map((o) => (
                                    <div key={o.key} className="flex items-center gap-2">
                                        <div className="min-w-0 flex-[3]">
                                            <Input
                                                value={o.name}
                                                placeholder="Option"
                                                aria-label="Option name"
                                                onChange={(e) => { patchOption(g.key, o.key, { name: e.target.value }); }}
                                            />
                                        </div>
                                        <div className="flex-[2]">
                                            <Input
                                                value={o.price}
                                                inputMode="decimal"
                                                placeholder="+₹"
                                                aria-label="Option price"
                                                onChange={(e) => { patchOption(g.key, o.key, { price: e.target.value }); }}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="Remove option"
                                            aria-label="Remove option"
                                            onClick={() => {
                                                patchGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) });
                                            }}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        patchGroup(g.key, { options: [...g.options, { key: newKey(), name: "", price: "0" }] });
                                    }}
                                >
                                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add option
                                </Button>
                            </div>
                        ))}
                    </div>

                    {/* ── RECIPE · AUTO-DEDUCT STOCK ───────────────────────── */}
                    <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                            <div className="micro-label">Recipe · auto-deduct stock</div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={inventoryRows.length === 0}
                                onClick={() => { setRecipe((prev) => [...prev, { key: newKey(), inventoryId: "", qty: "1" }]); }}
                            >
                                <Plus className="mr-1.5 h-3.5 w-3.5" /> Ingredient
                            </Button>
                        </div>
                        {inventory.loading ? (
                            <SkeletonBox height={32} />
                        ) : inventory.error != null ? (
                            <div className="flex items-center gap-2 text-xs text-destructive">
                                <span>Couldn&apos;t load the inventory.</span>
                                <Button type="button" variant="ghost" size="sm" onClick={inventory.retry}>Retry</Button>
                            </div>
                        ) : inventoryRows.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Add inventory items first to build a recipe.</p>
                        ) : (
                            recipe.map((r) => (
                                <div key={r.key} className="flex items-center gap-2">
                                    <div className="min-w-0 flex-[3]">
                                        <Select
                                            value={r.inventoryId === "" ? undefined : r.inventoryId}
                                            onValueChange={(v) => {
                                                setRecipe((prev) => prev.map((x) => (x.key === r.key ? { ...x, inventoryId: v } : x)));
                                            }}
                                        >
                                            <SelectTrigger aria-label="Ingredient"><SelectValue placeholder="Ingredient" /></SelectTrigger>
                                            <SelectContent>
                                                {inventoryRows.map((inv) => (
                                                    <SelectItem key={inv.id} value={inv.id}>
                                                        {inv.name} ({inv.stock}{inv.unit})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex-[2]">
                                        <Input
                                            value={r.qty}
                                            inputMode="decimal"
                                            placeholder="Qty/unit"
                                            aria-label="Quantity per unit"
                                            onChange={(e) => {
                                                setRecipe((prev) => prev.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)));
                                            }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Remove ingredient"
                                        aria-label="Remove ingredient"
                                        onClick={() => { setRecipe((prev) => prev.filter((x) => x.key !== r.key)); }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>

                    {/* ── Allergens — [web-extra] kept from Recipe & cost ──── */}
                    <div className="space-y-1.5 pt-1">
                        <div className="micro-label">Allergens <span className="normal-case tracking-normal">(shown to guests on the QR menu)</span></div>
                        <div className="flex flex-wrap gap-1.5">
                            {ALLERGEN_SUGGESTIONS.map((a) => {
                                const on = allergens.includes(a);
                                return (
                                    <button
                                        key={a}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => { toggleAllergen(a); }}
                                        className={cn(
                                            "rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors duration-fast",
                                            on
                                                ? "border-warning/40 bg-warning/12 font-medium text-warning"
                                                : "border-border bg-inset text-muted-foreground hover:text-foreground",
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
                                    title="Click to remove"
                                    onClick={() => { toggleAllergen(a); }}
                                    className="rounded-full border border-warning/40 bg-warning/12 px-2.5 py-0.5 text-xs font-medium capitalize text-warning"
                                >
                                    {a} ×
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="Other allergen (free-form)…"
                                aria-label="Other allergen"
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
                            <Button type="button" variant="outline" size="sm" disabled={!allergenInput.trim()} onClick={addFreeformAllergen}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Add
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-divider px-5 py-3.5">
                    <Button type="button" variant="ghost" disabled={uploading} onClick={onClose}>Cancel</Button>
                    <Button type="button" disabled={uploading} onClick={submit}>Save</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
