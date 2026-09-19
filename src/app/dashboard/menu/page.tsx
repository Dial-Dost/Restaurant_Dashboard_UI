"use client";

/**
 * THE MENU MODULE — web twin of restaurant_owner_app _MenuModule
 * (lib/screens/modules.dart ~4450–5027).
 *
 * The page IS the menu: a compact toolbar of dense buttons, the search field,
 * category tabs (All + one per category), then the item grid grouped by
 * category. Every configuration surface (kitchen sections, badges, groups,
 * sizes, queue pre-order menu) is a DIALOG opened from the toolbar — never a
 * permanent card the operator must scroll past to reach the food.
 *
 * Tiles, not rows: a menu line is a picture, a name and a price, and a
 * full-width row per dish left two thirds of a desktop window empty. Same
 * 4/3/2/1 breakpoints as the Orders grid (≥1500 / ≥1120 / ≥720 / narrower).
 *
 * Everything the tile has no room for — the guest blurb and the destructive-ish
 * actions — is one tap away in the item's detail sheet, so a mis-tap in a dense
 * grid can never delete a dish or re-route its section. The one exception is
 * the availability toggle: 86-ing a dish is the one menu action taken
 * mid-service, so it stays ON the tile.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import {
  BookOpen,
  FolderPlus,
  Plus,
  Ruler,
  SearchX,
  Shapes,
  Soup,
  Tag,
  Tags,
  Timer,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { AppSearchField } from "@/components/ui/app-search-field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonBox, SkeletonStats } from "@/components/ui/fork-skeleton";
import { Label } from "@/components/ui/label";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { setMenuItemAvailability, tagMenuBadges } from "@/lib/db";
import {
  createMenuCategory,
  deleteMenuCategoryChecked,
  fetchMenuModule,
  replaceMenuItems,
  upsertMenuItem,
} from "@/lib/api/menu";
import type {
  MenuModuleData,
  MenuModuleItem,
  MenuReplaceRow,
  MenuUpsertPayload,
} from "@/lib/api/menu";
import { PERM_EDIT_MENU, hasPermission } from "@/lib/mis-capture";
import { isDerivedBadge } from "@/lib/menu-badges";
import { useConfirm, usePrompt } from "@/components/menu/confirm-dialog";
import { ItemDetailSheet } from "@/components/menu/item-detail-sheet";
import { KitchenSectionsDialog } from "@/components/menu/kitchen-sections-dialog";
import { MenuBadgesDialog } from "@/components/menu/menu-badges-dialog";
import { MenuItemCard } from "@/components/menu/menu-item-card";
import { MenuItemEditor } from "@/components/menu/menu-item-editor";
import { OrganiseByKitchenDialog } from "@/components/menu/organise-by-kitchen";
import { StationPickerSheet } from "@/components/menu/station-picker";
import { TagBadgesDialog } from "./badges";
import { QueuePreorderMenuDialog } from "./queue-preorder-menu";
import { MenuGroupsDialog, MenuSizesDialog } from "./taxonomy";
import type { MenuItem } from "./data";

/* ── Excel/CSV import parsing — [web-extra] the flat-table + CSV formats and
      the merge-by-category+name behaviour are kept from the old page (audit
      finding 43); Flutter parses the sectioned-sheet format only. ─────────── */

const normalizeColumn = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Spreadsheet cells arrive as unknown; only primitives are meaningful text. */
const cellText = (value: unknown): string => {
  if (typeof value === "string") { return value; }
  if (typeof value === "number" || typeof value === "boolean") { return String(value); }
  return "";
};
const normalizeCell = (value: unknown): string => cellText(value).trim();
const parsePriceValue = (value: unknown): number | null => {
  const parsed = Number(cellText(value).replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** "12" / "12.5" — a bare serial/amount, never a category label. */
const BARE_NUMBER = /^\d+\.?\d*$/;

const importId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Sectioned sheets: a lone text cell is a category row; name+price rows follow. */
const parseSectionedMenuRows = (rows: unknown[][]): MenuItem[] => {
  const importedItems: MenuItem[] = [];
  let currentCategory = "";

  for (const rawRow of rows) {
    const row = rawRow.map(normalizeCell);
    const nonEmptyCells = row.filter(Boolean);
    if (nonEmptyCells.length === 0) { continue; }

    const normalizedRow = row.map(normalizeColumn);
    const isHeaderRow = normalizedRow.includes("dishname") || normalizedRow.includes("itemname") || normalizedRow.includes("price");
    if (isHeaderRow) { continue; }

    // A lone text cell is a section/category header. A lone number is a
    // stray serial (S/NO) — never a category.
    if (nonEmptyCells.length === 1) {
      const label = nonEmptyCells[0].replace(/\s+/g, " ").trim();
      if (!label || BARE_NUMBER.test(label)) { continue; }
      if (!currentCategory && /menu/i.test(label)) { continue; }
      currentCategory = label;
      continue;
    }

    if (!currentCategory) { continue; }

    // Identify the item by NAME + PRICE, independent of any S/NO column: take
    // the price as the right-most positive amount, the name as the first
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
      if (i === priceIdx) { continue; }
      const cell = row[i];
      if (cell && !BARE_NUMBER.test(cell)) {
        itemName = cell.replace(/\s+/g, " ").trim();
        break;
      }
    }

    if (!itemName || priceValue == null) { continue; }

    importedItems.push({
      id: importId(),
      name: itemName,
      price: Number(priceValue.toFixed(2)),
      category: currentCategory,
    });
  }

  return importedItems;
};

/** The minimal full-replace projection: preserve-on-omit keeps every other
 *  stored field (blurb, badges, recipe, modifiers, station) untouched. */
const toReplaceRow = (it: MenuModuleItem | MenuItem): MenuReplaceRow => ({
  id: it.id,
  name: it.name,
  price: it.price,
  category: it.category,
  image_url: it.image_url ?? "",
  available: it.available !== false,
});

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

const ALL_TAB = "__all__";

export default function MenuPage(): JSX.Element {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { toast } = useToast();
  const rid = user?.restaurantUsername ?? "";
  const isAdmin = user?.role === "admin" || (Array.isArray(user?.role_all) && user.role_all.includes("admin"));
  const canEditMenu = hasPermission(user?.actions_set, PERM_EDIT_MENU);

  const menu = useCachedFetch<MenuModuleData>(
    `menu:module:${rid}`,
    () => fetchMenuModule(rid),
    { enabled: !!rid },
  );

  // Selected category tab (All by default). Kept by NAME so it survives
  // reloads after edits; a category that no longer exists falls back to All.
  const [selectedCat, setSelectedCat] = useState<string>(ALL_TAB);
  // The search the list is filtered on — also kept across reloads, so an edit
  // or toggle leaves the operator inside the same result set.
  const [query, setQuery] = useState("");
  // Bumping this remounts the search box — the one way to clear it from the
  // empty state's "Clear search" (the box never re-seeds text from props).
  const [searchSeed, setSearchSeed] = useState(0);

  // Optimistic availability flips, applied over the fetched items so the chip
  // answers the tap instantly; pruned once the server copy agrees.
  const [availOverride, setAvailOverride] = useState<Record<string, boolean>>({});
  const [toggleBusy, setToggleBusy] = useState<Set<string>>(new Set());

  // Dialog state.
  const [editor, setEditor] = useState<{ existing: MenuModuleItem | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [stationPickId, setStationPickId] = useState<string | null>(null);
  const [sizes, setSizes] = useState<{ dishId: string | null } | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [organiseOpen, setOrganiseOpen] = useState(false);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [taggerOpen, setTaggerOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();

  const data = menu.data;
  const sections = useMemo(() => data?.sections ?? [], [data]);
  const badges = useMemo(() => data?.badges ?? [], [data]);

  const items = useMemo<MenuModuleItem[]>(() => {
    const base = data?.items ?? [];
    if (Object.keys(availOverride).length === 0) { return base; }
    return base.map((it) =>
      it.id in availOverride ? { ...it, available: availOverride[it.id] } : it,
    );
  }, [data, availOverride]);

  // Drop overrides the server has confirmed, so a later flip from another
  // device is not pinned to this browser's stale answer.
  useEffect(() => {
    const fetched = data?.items;
    if (!fetched) { return; }
    setAvailOverride((prev) => {
      const entries = Object.entries(prev).filter(([id, want]) => {
        const server = fetched.find((it) => it.id === id);
        return server != null && (server.available !== false) !== want;
      });
      if (entries.length === Object.keys(prev).length) { return prev; }
      return Object.fromEntries(entries);
    });
  }, [data]);

  // Categories are derived from the items, alphabetically — exactly the list
  // Flutter tabs and sections show (a category with no items has no tile grid).
  const byCat = useMemo(() => {
    const m = new Map<string, MenuModuleItem[]>();
    for (const it of items) {
      const c = it.category || "Uncategorized";
      const bucket = m.get(c);
      if (bucket) { bucket.push(it); } else { m.set(c, [it]); }
    }
    return m;
  }, [items]);
  const cats = useMemo(() => [...byCat.keys()].sort((a, b) => a.localeCompare(b)), [byCat]);

  // The editor's dropdown also offers categories that exist server-side but
  // hold no items yet, so "Add category" → "Add item" works first time.
  const editorCategories = useMemo(() => {
    const seen = new Set(cats.map((c) => c.toLowerCase()));
    const extra = (data?.categories ?? []).filter((c) => {
      const k = c.trim().toLowerCase();
      if (!k || seen.has(k)) { return false; }
      seen.add(k);
      return true;
    });
    return [...cats, ...extra].sort((a, b) => a.localeCompare(b));
  }, [cats, data]);

  const tabValue = selectedCat !== ALL_TAB && cats.includes(selectedCat) ? selectedCat : ALL_TAB;
  const showCats = tabValue === ALL_TAB ? cats : [tabValue];

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  // While searching the category tabs are ignored entirely and the whole menu
  // is matched on name / category / kitchen section / description, so no
  // result can hide behind an unselected tab.
  const matches = useMemo(() => {
    if (!searching) { return []; }
    return items.filter((it) =>
      `${it.name} ${it.category} ${it.station ?? ""} ${it.blurb ?? ""}`.toLowerCase().includes(q),
    );
  }, [items, searching, q]);

  const clearSearch = (): void => {
    setQuery("");
    setSearchSeed((s) => s + 1);
  };

  const badgeUsage = (id: string): number =>
    items.filter((it) => (it.badges ?? []).includes(id)).length;

  const detailItem = detailId == null ? null : items.find((it) => it.id === detailId) ?? null;
  const stationPickItem = stationPickId == null ? null : items.find((it) => it.id === stationPickId) ?? null;

  /* ── Writes (each mirrors its Flutter handler; errors are the server's own
        sentence in a toast, exactly where Flutter snackbars them) ─────────── */

  const submitItem = (payload: MenuUpsertPayload): void => {
    // The dialog pops first; the module POSTs and toasts errors (Flutter order).
    setEditor(null);
    void (async () => {
      try {
        await upsertMenuItem(payload);
        menu.refresh();
      } catch (e) {
        toast({ title: errorText(e, "Unable to save menu item."), variant: "destructive" });
      }
    })();
  };

  const toggleAvailable = (item: MenuModuleItem): void => {
    if (toggleBusy.has(item.id)) { return; }
    const next = item.available === false; // flip
    setToggleBusy((b) => new Set(b).add(item.id));
    setAvailOverride((prev) => ({ ...prev, [item.id]: next }));
    void (async () => {
      try {
        await setMenuItemAvailability(rid, item.id, next);
        menu.refresh();
      } catch (e) {
        // Reverted: a chip that pretends the dish is off keeps taking orders.
        setAvailOverride((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => id !== item.id)),
        );
        toast({ title: errorText(e, "Unable to change availability."), variant: "destructive" });
      } finally {
        setToggleBusy((b) => {
          const n = new Set(b);
          n.delete(item.id);
          return n;
        });
      }
    })();
  };

  const deleteItem = async (item: MenuModuleItem): Promise<void> => {
    const ok = await confirm({
      title: "Delete item",
      body: `Delete "${item.name}"?`,
      confirmLabel: "Confirm",
    });
    if (!ok) { return; }
    // Full-replace PUT — preserve every other item's fields (image/availability).
    const remaining = items.filter((r) => r.id !== item.id).map(toReplaceRow);
    try {
      await replaceMenuItems(remaining);
      menu.refresh();
    } catch (e) {
      toast({ title: errorText(e, "Unable to delete item."), variant: "destructive" });
    }
  };

  // Quick per-item section assignment via the preserve-on-omit menu upsert:
  // only id/name/price/category/station travel, so recipes/modifiers/images
  // survive untouched.
  const assignStation = async (item: MenuModuleItem, picked: string): Promise<void> => {
    const station = picked.trim();
    try {
      await upsertMenuItem({
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category,
        station: station === "" ? null : station,
      });
      menu.refresh();
    } catch (e) {
      toast({ title: errorText(e, "Unable to assign the section."), variant: "destructive" });
    }
  };

  const addCategory = async (): Promise<void> => {
    const name = await prompt({ title: "Add category", label: "Category name" });
    if (name == null || name.trim() === "") { return; }
    try {
      await createMenuCategory(name.trim());
      menu.refresh();
    } catch (e) {
      toast({ title: errorText(e, "Unable to add category."), variant: "destructive" });
    }
  };

  const deleteCategory = async (cat: string): Promise<void> => {
    const ok = await confirm({
      title: "Delete category",
      body: `Delete "${cat}" and all its items?`,
      confirmLabel: "Confirm",
    });
    if (!ok) { return; }
    try {
      await deleteMenuCategoryChecked(cat);
      menu.refresh();
    } catch (e) {
      toast({ title: errorText(e, "Unable to delete category."), variant: "destructive" });
    }
  };

  // [web-extra] bulk organiser: each CHANGED item goes through the same
  // minimal preserve-on-omit upsert the quick picker uses.
  const saveOrganise = async (assignments: Record<string, string | null>): Promise<void> => {
    const changed = items.filter(
      (it) => it.id in assignments && (assignments[it.id] ?? "") !== (it.station ?? ""),
    );
    for (const it of changed) {
      await upsertMenuItem({
        id: it.id,
        name: it.name,
        price: it.price,
        category: it.category,
        station: assignments[it.id] ?? null,
      });
    }
    setOrganiseOpen(false);
    menu.refresh();
  };

  // Tag-only write: ids and tags travel, never whole items.
  const saveTags = async (updates: { id: string; badges: string[] }[]): Promise<void> => {
    await tagMenuBadges(rid, updates);
    setTaggerOpen(false);
    menu.refresh();
  };

  const importMenuFile = async (file: File): Promise<void> => {
    if (!rid) { return; }
    setIsImporting(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) { throw new Error("No sheet found in the uploaded file."); }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: true });
      const keys = Object.keys(rows[0] ?? {});
      const columnMap = new Map<string, string>();
      for (const key of keys) { columnMap.set(normalizeColumn(key), key); }

      const nameKey =
        columnMap.get("name") ?? columnMap.get("item") ?? columnMap.get("itemname")
        ?? columnMap.get("menuitem") ?? columnMap.get("menuitemname");
      const priceKey =
        columnMap.get("price") ?? columnMap.get("amount") ?? columnMap.get("rate") ?? columnMap.get("mrp");
      const categoryKey =
        columnMap.get("category") ?? columnMap.get("type") ?? columnMap.get("section") ?? columnMap.get("group");

      let importedItems: MenuItem[] = [];
      if (nameKey && priceKey) {
        // [web-extra] flat name/price/category header tables.
        for (const row of rows) {
          const itemName = normalizeCell(row[nameKey]);
          if (!itemName) { continue; }
          const rawPrice = parsePriceValue(row[priceKey]);
          if (rawPrice == null) { continue; }
          const categoryRaw = categoryKey ? normalizeCell(row[categoryKey]) : "";
          importedItems.push({
            id: importId(),
            name: itemName,
            price: Number(rawPrice.toFixed(2)),
            category: categoryRaw || "General",
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

      if (importedItems.length === 0) {
        throw new Error("No valid menu items found. Use category rows followed by item rows with a price, or a flat table with name and price columns.");
      }

      // The confirm gates ANY write (Flutter: 'Import N item(s) from the file?').
      const ok = await confirm({
        title: "Import menu",
        body: `Import ${importedItems.length} item(s) from the file?`,
        confirmLabel: "Confirm",
      });
      if (!ok) { return; }

      // [web-extra] merge by category+name: an existing dish keeps its identity
      // and takes the imported price instead of duplicating.
      const existingByKey = new Map<string, MenuModuleItem>();
      for (const item of items) {
        existingByKey.set(`${item.category.toLowerCase()}::${item.name.toLowerCase()}`, item);
      }
      const merged: MenuReplaceRow[] = items.map(toReplaceRow);
      for (const imported of importedItems) {
        const key = `${imported.category.toLowerCase()}::${imported.name.toLowerCase()}`;
        const existing = existingByKey.get(key);
        if (existing) {
          const idx = merged.findIndex((entry) => entry.id === existing.id);
          if (idx >= 0) { merged[idx] = { ...merged[idx], price: imported.price }; }
        } else {
          merged.push(toReplaceRow(imported));
        }
      }

      const known = new Set(editorCategories.map((c) => c.toLowerCase()));
      const newCategories = [...new Set(
        importedItems.map((i) => i.category).filter((c) => !known.has(c.toLowerCase())),
      )];
      await Promise.all(newCategories.map((category) => createMenuCategory(category)));
      await replaceMenuItems(merged);

      toast({ title: `Imported ${importedItems.length} of ${importedItems.length} items.` });
      menu.refresh();
    } catch (e) {
      toast({
        title: "Unable to import menu file.",
        description: errorText(e, "Could not read the file."),
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) { fileInputRef.current.value = ""; }
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (menu.loading) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {[112, 128, 148, 140, 122].map((w, i) => <SkeletonBox key={i} width={w} height={32} />)}
        </div>
        <SkeletonBox height={36} />
        <SkeletonStats tiles={8} />
      </div>
    );
  }

  if (menu.error != null || data == null) {
    return (
      <LoadErrorState
        whatFailed="Couldn't load the menu."
        error={menu.error}
        onRetry={menu.retry}
      />
    );
  }

  const grid = (cards: MenuModuleItem[]): JSX.Element => (
    <div className="grid grid-cols-1 gap-3.5 min-[720px]:grid-cols-2 min-[1120px]:grid-cols-3 min-[1500px]:grid-cols-4">
      {cards.map((item) => (
        <MenuItemCard
          key={item.id}
          item={item}
          sections={sections}
          badges={badges}
          currencySymbol={currencySymbol}
          onOpen={() => { setDetailId(item.id); }}
          onToggleAvailability={() => { toggleAvailable(item); }}
          toggleBusy={toggleBusy.has(item.id)}
        />
      ))}
    </div>
  );

  return (
    <div className="relative space-y-5">
      {/* Toolbar — the Flutter Wrap of dense buttons, in its order. */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => { setEditor({ existing: null }); }}>
          <Plus className="mr-2 h-4 w-4" /> Add item
        </Button>
        <Button size="sm" variant="outline" onClick={() => { void addCategory(); }}>
          <FolderPlus className="mr-2 h-4 w-4" /> Add category
        </Button>
        <Label htmlFor="import-menu-file" className="sr-only">Import menu file</Label>
        <input
          id="import-menu-file"
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          aria-label="Import menu file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) { void importMenuFile(file); }
          }}
        />
        <Button size="sm" variant="outline" disabled={isImporting} onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Import from Excel
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setSectionsOpen(true); }}>
          <Soup className="mr-2 h-4 w-4" /> Kitchen sections
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setBadgesOpen(true); }}>
          <Tag className="mr-2 h-4 w-4" /> Menu badges
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setGroupsOpen(true); }}>
          <Shapes className="mr-2 h-4 w-4" /> Menu groups
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setSizes({ dishId: null }); }}>
          <Ruler className="mr-2 h-4 w-4" /> Item sizes
        </Button>
        {/* Appears only when at least one enabled, hand-taggable badge exists. */}
        {badges.some((b) => b.enabled && !isDerivedBadge(b)) && (
          <Button size="sm" variant="outline" onClick={() => { setTaggerOpen(true); }}>
            <Tags className="mr-2 h-4 w-4" /> Tag dishes
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => { setQueueOpen(true); }}>
          <Timer className="mr-2 h-4 w-4" /> Queue pre-order menu
        </Button>
      </div>

      <AppSearchField
        key={`menu-search-${searchSeed}`}
        onQuery={setQuery}
        debounceMs={200}
        placeholder="Search menu…"
        aria-label="Search menu"
        className="max-w-md"
      />

      {/* Category tabs — hidden entirely while a search query is active. */}
      {cats.length > 0 && !searching && (
        <Tabs value={tabValue} onValueChange={setSelectedCat}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value={ALL_TAB}>All</TabsTrigger>
            {cats.map((c) => (
              <TabsTrigger key={c} value={c}>{c}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {searching ? (
        matches.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={`No items match "${query.trim()}"`}
            caption="Try another name, category or kitchen section — or clear the search."
            action={
              <Button variant="ghost" size="sm" onClick={clearSearch}>
                <X className="mr-2 h-4 w-4" /> Clear search
              </Button>
            }
          />
        ) : (
          <div>
            <SectionHeader title="Search results" count={matches.length} />
            {grid(matches)}
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="No menu items yet"
          caption="Add your first item, or import a full menu from Excel."
          action={
            <Button size="sm" onClick={() => { setEditor({ existing: null }); }}>
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {showCats.map((cat) => (
            <div key={cat}>
              <SectionHeader
                title={cat}
                count={byCat.get(cat)?.length ?? 0}
                trailing={
                  <Button variant="ghost" size="sm" onClick={() => { void deleteCategory(cat); }}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete category
                  </Button>
                }
              />
              {grid(byCat.get(cat) ?? [])}
            </div>
          ))}
        </div>
      )}

      <CacheStalePill offline={menu.offline} fromCache={menu.fromCache} updatedAt={menu.updatedAt} />

      {/* ── Dialogs & sheets ─────────────────────────────────────────────── */}

      {detailItem && (
        <ItemDetailSheet
          item={detailItem}
          badges={badges}
          currencySymbol={currencySymbol}
          onClose={() => { setDetailId(null); }}
          onEdit={() => {
            setDetailId(null);
            setEditor({ existing: detailItem });
          }}
          onKitchenSection={() => {
            setDetailId(null);
            setStationPickId(detailItem.id);
          }}
          onPricePoints={() => {
            setDetailId(null);
            setSizes({ dishId: detailItem.id });
          }}
          onDelete={() => {
            setDetailId(null);
            void deleteItem(detailItem);
          }}
        />
      )}

      {editor && (
        <MenuItemEditor
          restaurantId={rid}
          existing={editor.existing}
          categories={editorCategories}
          sections={sections}
          onSubmit={submitItem}
          onClose={() => { setEditor(null); }}
        />
      )}

      {stationPickItem && (
        <StationPickerSheet
          itemName={stationPickItem.name}
          current={stationPickItem.station ?? ""}
          sections={sections}
          onPick={(station) => {
            setStationPickId(null);
            void assignStation(stationPickItem, station);
          }}
          onClose={() => { setStationPickId(null); }}
        />
      )}

      {sectionsOpen && (
        <KitchenSectionsDialog
          isAdmin={isAdmin}
          initial={sections}
          organiseDisabled={items.length === 0}
          onOrganise={() => { setOrganiseOpen(true); }}
          onClose={(changed) => {
            setSectionsOpen(false);
            if (changed) { menu.refresh(); }
          }}
        />
      )}

      {organiseOpen && (
        <OrganiseByKitchenDialog
          items={items}
          sections={sections}
          onClose={() => { setOrganiseOpen(false); }}
          onSave={saveOrganise}
        />
      )}

      {badgesOpen && (
        <MenuBadgesDialog
          initial={badges}
          presets={data.badgePresets}
          labelMax={data.badgeLabelMax}
          usage={badgeUsage}
          onClose={(changed) => {
            setBadgesOpen(false);
            if (changed) { menu.refresh(); }
          }}
        />
      )}

      {taggerOpen && (
        <TagBadgesDialog
          items={items}
          catalogue={badges}
          perItemMax={data.badgePerItemMax}
          onClose={() => { setTaggerOpen(false); }}
          onSave={saveTags}
        />
      )}

      {queueOpen && (
        <QueuePreorderMenuDialog
          restaurantId={rid}
          onClose={(changed) => {
            setQueueOpen(false);
            if (changed) { menu.refresh(); }
          }}
        />
      )}

      {groupsOpen && (
        <MenuGroupsDialog
          restaurantId={rid}
          canEdit={canEditMenu}
          onClose={() => { setGroupsOpen(false); }}
        />
      )}

      {sizes && (
        <MenuSizesDialog
          restaurantId={rid}
          menuItems={items.map((m) => ({ id: m.id, name: m.name, price: m.price, category: m.category }))}
          canEdit={canEditMenu}
          initialDishId={sizes.dishId}
          onClose={() => { setSizes(null); }}
        />
      )}

      {confirmDialog}
      {promptDialog}
    </div>
  );
}
