"use client"

// MENU GROUPS AND ITEM SIZES — the classification migration 039 added, and the
// only screen that can set it.
//
// A GROUP is how the money is CUT (Food / Beverage / Liquor / Tobacco) or where
// the food is MADE (Kitchen / Bar / Bakery). It is the axis an accountant and a
// licensing return ask for first, and until 039 nothing on the menu said which
// was which — so no report could produce it.
//
// A SIZE (a variation) is a PRICE POINT of one dish: Half at ₹150 against a Full
// at ₹250. Entered today as a second menu item or typed at the till as an
// off-menu line, which is how one dish's sales end up split across three rows
// with three different names.
//
// ===========================================================================
// THE FOUR RULES THIS FILE OBEYS
// ===========================================================================
//
// 1. TARGETED WRITES ONLY. Every save here is ONE row, PATCHed or POSTed on its
//    own, merged server-side over a snapshot of itself. There is no bulk save
//    and there is no PUT — a full-replace menu save once wiped 56 items' images,
//    sections and recipes, and the rule that came out of it is that a field
//    absent from a payload means "keep what is stored".
//
// 2. NOTHING IS DELETED. A group id sits on menu rows and categories and a
//    variation id is stamped onto order lines, and both are resolved when a
//    report runs — so a classification corrected today makes the last six months
//    right. Deleting one would strand those references and rewrite history.
//    Retiring is `{ active: false }`, and a retired row can be reinstated from
//    here, which is the only place it is even visible.
//
// 3. THE CATEGORY IS THE WORKFLOW, THE ITEM IS THE EXCEPTION. Precedence is item
//    override -> category default -> Unclassified. Setting the group on ~12
//    categories is the job; the per-item override exists for the genuine
//    exception (the mocktail listed under Desserts). Nobody is going to file 300
//    items one at a time, and this screen does not ask them to.
//
// 4. THE UNCLASSIFIED COUNT IS SHOWN HERE, BEFORE A REPORT SHOWS IT. A group
//    report's totals only equal the sales summary's because what it cannot
//    classify is COUNTED, in a bucket called Unclassified. An owner should meet
//    that number on the screen that can shrink it, not in front of their
//    accountant.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Info, Layers, Loader2, Plus, RotateCcw, Ruler } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SearchInput } from "@/components/ui/search-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import {
    assignMenuGroup,
    createMenuGroup,
    createMenuVariation,
    getMenuGroupAssignments,
    getMenuVariations,
    updateMenuGroup,
    updateMenuVariation,
} from "@/lib/db"
import {
    MENU_GROUP_KINDS,
    formatAmount,
    parseMoney,
    type MenuGroupAssignments,
    type MenuVariationRecord,
} from "@/lib/mis-capture"
import { cn } from "@/lib/utils"

/** The dishes this editor can attach sizes to. */
export interface TaxonomyMenuItem {
    id: string
    name: string
    price: number
    category: string
}

/** "no group" — a real, chosen value that CLEARS the assignment, not an absence. */
const NO_GROUP = "__none__"

function Hint({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
    const Icon = tone === "warn" ? AlertTriangle : Info
    return (
        <div className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug",
            tone === "warn"
                ? "border-amber-500/40 bg-amber-500/[0.05]"
                : "border-border bg-muted/40 text-muted-foreground",
        )}>
            <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone === "warn" && "text-amber-600 dark:text-amber-400")} />
            <div>{children}</div>
        </div>
    )
}

export function MenuTaxonomyCard({ restaurantId, menuItems, canEdit }: {
    restaurantId: string
    menuItems: TaxonomyMenuItem[]
    canEdit: boolean
}) {
    const [open, setOpen] = useState<null | "groups" | "sizes">(null)
    const [kind, setKind] = useState("revenue")
    const [map, setMap] = useState<MenuGroupAssignments | null>(null)
    // "Nothing configured" and "could not be read" are the same empty screen and
    // opposite facts. The read answers null for the second — including when
    // migration 039 has not been applied — and this keeps them apart, because
    // "every dish is classified" is a claim, and claiming it off a failed request
    // is how an owner stops trusting the number beside it.
    const [failed, setFailed] = useState(false)
    const [loading, setLoading] = useState(true)

    const load = useCallback(() => {
        if (!restaurantId) {return}
        setLoading(true)
        void getMenuGroupAssignments(restaurantId, kind)
            .then((m) => { setFailed(m === null); setMap(m) })
            .finally(() => { setLoading(false) })
    }, [restaurantId, kind])
    useEffect(() => { load() }, [load])

    const groups = map?.groups ?? []
    const unclassified = map?.unclassified_items ?? 0

    return (
        <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Layers className="h-5 w-5 text-primary" /> Groups &amp; sizes
                    </CardTitle>
                    <CardDescription>
                        A <b>group</b>{" "}is how the money is cut — Food, Beverage, Liquor — and it is what the Group
                        Summary reports on. A <b>size</b>{" "}is a price point of one dish (Half / Full), and it is what
                        stops one dish&apos;s sales being split across three differently-named rows.
                    </CardDescription>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setOpen("groups") }}>
                        <Layers className="mr-2 h-4 w-4" /> Groups
                    </Button>
                    <Button variant="outline" size="sm" disabled={menuItems.length === 0} onClick={() => { setOpen("sizes") }}>
                        <Ruler className="mr-2 h-4 w-4" /> Item sizes
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading this outlet&apos;s classification…
                    </div>
                ) : failed ? (
                    <p className="text-sm text-destructive">
                        This outlet&apos;s classification could not be read — which is not the same as &ldquo;nothing
                        configured&rdquo;. Reload before editing, so a save here cannot overwrite something this
                        screen never saw.
                    </p>
                ) : groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No groups configured. Every sale reports under <b>Unclassified</b>{" "}on the Group Summary —
                        which is honest, and is what every restaurant starts with. Two or three groups make that
                        report useful.
                    </p>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        {groups.filter((g) => g.active).map((g) => (
                            <Badge key={g.id} variant="outline" className="font-normal">{g.name}</Badge>
                        ))}
                        {unclassified > 0 ? (
                            <Badge variant="outline" className="border-amber-500/50 font-normal text-amber-700 dark:text-amber-400">
                                {unclassified} item{unclassified === 1 ? "" : "s"} unclassified
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="border-emerald-500/50 font-normal text-emerald-700 dark:text-emerald-400">
                                Every dish is classified
                            </Badge>
                        )}
                    </div>
                )}
            </CardContent>

            {open === "groups" ? (
                <GroupsDialog
                    restaurantId={restaurantId} kind={kind} setKind={setKind}
                    map={map} loading={loading} reload={load} canEdit={canEdit}
                    onClose={() => { setOpen(null) }}
                />
            ) : null}

            {open === "sizes" ? (
                <SizesDialog
                    restaurantId={restaurantId} menuItems={menuItems} canEdit={canEdit}
                    onClose={() => { setOpen(null) }}
                />
            ) : null}
        </Card>
    )
}

// ---------------------------------------------------------------------------
// GROUPS
// ---------------------------------------------------------------------------

function GroupsDialog({
    restaurantId, kind, setKind, map, loading, reload, canEdit, onClose,
}: {
    restaurantId: string
    kind: string
    setKind: (k: string) => void
    map: MenuGroupAssignments | null
    loading: boolean
    reload: () => void
    canEdit: boolean
    onClose: () => void
}) {
    const { toast } = useToast()
    const [busy, setBusy] = useState(false)
    const [newName, setNewName] = useState("")
    const [itemSearch, setItemSearch] = useState("")

    const fail = (e: unknown): void => {
        toast({ title: "Not saved", description: String((e as Error)?.message ?? e), variant: "destructive" })
    }

    const groups = map?.groups ?? []
    const active = groups.filter((g) => g.active)
    const categories = map?.categories ?? []
    const items = map?.items ?? []

    const shownItems = useMemo(() => {
        const q = itemSearch.trim().toLowerCase()
        // Default view is the items that CARRY AN OVERRIDE plus anything searched
        // for: listing 300 dishes with an empty picker each would bury the ~5 that
        // are genuine exceptions, which is the workflow this screen is built around.
        const base = q.length > 0
            ? items.filter((i) => i.name.toLowerCase().includes(q))
            : items.filter((i) => i.group_id !== null)
        return base.slice(0, 60)
    }, [items, itemSearch])

    const add = async (): Promise<void> => {
        if (!newName.trim()) {return}
        setBusy(true)
        try {
            const g = await createMenuGroup(restaurantId, { name: newName.trim(), kind })
            toast({ title: `Added ${g.name}` })
            setNewName("")
            reload()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const retire = async (id: string, name: string, next: boolean): Promise<void> => {
        setBusy(true)
        try {
            // A MERGE, not a replace: `{ active }` alone leaves the name, the axis and
            // the position exactly as stored. That is the whole reason a partial body
            // is allowed here.
            await updateMenuGroup(restaurantId, id, { active: next })
            toast({
                title: next ? `${name} is back` : `${name} retired`,
                description: next ? undefined : "It stops being offered. Every dish already filed under it still reports under it.",
            })
            reload()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const rename = async (id: string, was: string, name: string): Promise<void> => {
        if (name.trim().length === 0 || name.trim() === was) {return}
        setBusy(true)
        try {
            await updateMenuGroup(restaurantId, id, { name: name.trim() })
            reload()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const assign = async (target: { menu_id?: string; main_cat_id?: string }, groupId: string): Promise<void> => {
        setBusy(true)
        try {
            await assignMenuGroup(restaurantId, target, groupId === NO_GROUP ? null : groupId)
            reload()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Menu groups</DialogTitle>
                    <DialogDescription>
                        File each category under a group and the whole menu is classified. Use a per-dish
                        override only for the genuine exception.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-1.5">
                    <Label>Axis</Label>
                    <Select value={kind} onValueChange={setKind}>
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {MENU_GROUP_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {MENU_GROUP_KINDS.find((k) => k.value === kind)?.hint}
                        {" "}A group filed on one axis is invisible to a report asking for the other, so the two
                        sets are kept separate rather than merged.
                    </p>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <>
                        <div className="space-y-1.5">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                Groups on this axis
                            </Label>
                            {groups.length === 0 ? (
                                <p className="text-sm text-muted-foreground">None yet.</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {groups.map((g) => (
                                        <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5">
                                            <Input
                                                className="h-8 w-56" defaultValue={g.name}
                                                disabled={!canEdit || busy}
                                                aria-label={`Name of group ${g.name}`}
                                                onBlur={(e) => { void rename(g.id, g.name, e.target.value) }}
                                            />
                                            {g.active ? null : <Badge variant="secondary" className="text-[10px] uppercase">Retired</Badge>}
                                            <Button
                                                variant="ghost" size="sm" className="ml-auto gap-1"
                                                disabled={!canEdit || busy}
                                                onClick={() => void retire(g.id, g.name, !g.active)}
                                            >
                                                <RotateCcw className="h-3.5 w-3.5" /> {g.active ? "Retire" : "Reinstate"}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {canEdit ? (
                                <div className="flex gap-2 pt-1">
                                    <Input
                                        className="h-9 max-w-xs" value={newName} placeholder="New group, e.g. Beverage"
                                        onChange={(e) => { setNewName(e.target.value) }}
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add() } }}
                                    />
                                    <Button className="h-9 gap-1" disabled={busy || !newName.trim()} onClick={() => void add()}>
                                        <Plus className="h-4 w-4" /> Add
                                    </Button>
                                </div>
                            ) : null}
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                Categories — the default for everything under them
                            </Label>
                            {categories.length === 0 ? (
                                <p className="text-sm text-muted-foreground">This menu has no categories.</p>
                            ) : (
                                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                                    {categories.map((c) => (
                                        <div key={c.id} className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm">{c.name}</span>
                                            <Select
                                                value={c.group_id ?? NO_GROUP}
                                                disabled={!canEdit || busy}
                                                onValueChange={(v) => { void assign({ main_cat_id: c.id }, v) }}
                                            >
                                                <SelectTrigger className="h-8 w-52 shrink-0"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value={NO_GROUP}>Unclassified</SelectItem>
                                                    {active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                Per-dish exceptions
                            </Label>
                            <SearchInput
                                wrapperClassName="max-w-sm"
                                className="h-9" value={itemSearch} placeholder="Search a dish to override…"
                                aria-label="Search a dish to override"
                                onValueChange={setItemSearch}
                            />
                            {shownItems.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    {itemSearch.trim() ? "No dish matches that." : "No per-dish overrides — every dish takes its category's group, which is the usual and the tidier answer."}
                                </p>
                            ) : (
                                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                                    {shownItems.map((i) => (
                                        <div key={i.id} className="flex items-center justify-between gap-2">
                                            <span className="min-w-0 truncate text-sm">
                                                {i.name}
                                                {i.group_id === null && i.resolved_group_name ? (
                                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                                        ({i.resolved_group_name} — from its category)
                                                    </span>
                                                ) : null}
                                            </span>
                                            <Select
                                                value={i.group_id ?? NO_GROUP}
                                                disabled={!canEdit || busy}
                                                onValueChange={(v) => { void assign({ menu_id: i.id }, v) }}
                                            >
                                                <SelectTrigger className="h-8 w-52 shrink-0"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value={NO_GROUP}>Follow the category</SelectItem>
                                                    {active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {items.length === 0 ? (
                            <Hint tone="warn">
                                No dishes came back for this axis. That is either an outlet with no menu or a read
                                that did not complete — either way there is nothing here to classify yet, and this
                                screen is not claiming otherwise.
                            </Hint>
                        ) : (map?.unclassified_items ?? 0) > 0 ? (
                            <Hint tone="warn">
                                <b>{map?.unclassified_items} dish(es) resolve to no group.</b>{" "}They are not dropped —
                                the Group Summary counts them in an <b>Unclassified</b>{" "}row, which is why its total
                                still equals the Item Wise total. Filing their categories above shrinks that row to
                                nothing.
                            </Hint>
                        ) : (
                            <Hint>
                                Every dish on this menu resolves to a group. The Group Summary&apos;s Unclassified row
                                will be empty — though a separate <b>Unattributed</b>{" "}row can still appear there for
                                lines that match no menu dish at all, which is history and cannot be fixed backwards.
                            </Hint>
                        )}
                        <Hint>
                            The group is resolved when a report runs, never stamped onto a sale — so correcting a
                            misfiling today corrects the last six months of reports rather than only tomorrow&apos;s.
                        </Hint>
                    </>
                )}

                <DialogFooter><Button onClick={onClose} disabled={busy}>Done</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// SIZES (VARIATIONS)
// ---------------------------------------------------------------------------

function SizesDialog({ restaurantId, menuItems, canEdit, onClose }: {
    restaurantId: string
    menuItems: TaxonomyMenuItem[]
    canEdit: boolean
    onClose: () => void
}) {
    const { toast } = useToast()
    const { currencySymbol } = useCurrency()
    const [search, setSearch] = useState("")
    const [dishId, setDishId] = useState<string | null>(null)
    const [variations, setVariations] = useState<MenuVariationRecord[]>([])
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [name, setName] = useState("")
    const [price, setPrice] = useState("")

    const money = (v: unknown): string => formatAmount(v, currencySymbol)
    const dish = menuItems.find((m) => m.id === dishId) ?? null

    const fail = (e: unknown): void => {
        toast({ title: "Not saved", description: String((e as Error)?.message ?? e), variant: "destructive" })
    }

    const load = useCallback((id: string) => {
        setLoading(true)
        // include_inactive: the editor is the only place a retired size is visible,
        // which makes it the only place one can be reinstated — and reinstating is
        // what the server tells you to do instead of creating a second "Half".
        void getMenuVariations(restaurantId, { menuId: id, includeInactive: true })
            .then(setVariations)
            .finally(() => { setLoading(false) })
    }, [restaurantId])

    useEffect(() => { if (dishId) {load(dishId)} }, [dishId, load])

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase()
        return (q ? menuItems.filter((m) => m.name.toLowerCase().includes(q)) : menuItems).slice(0, 50)
    }, [menuItems, search])

    const add = async (): Promise<void> => {
        const p = parseMoney(price)
        if (!dishId || !name.trim() || p === null) {return}
        setBusy(true)
        try {
            const v = await createMenuVariation(restaurantId, { menu_id: dishId, name: name.trim(), price: p })
            toast({ title: `Added ${v.name}`, description: `${money(v.price)} — this is now the floor for any line naming it.` })
            setName(""); setPrice("")
            load(dishId)
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const patch = async (v: MenuVariationRecord, p: Parameters<typeof updateMenuVariation>[2]): Promise<void> => {
        setBusy(true)
        try {
            await updateMenuVariation(restaurantId, v.id, p)
            if (dishId) {load(dishId)}
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(vv) => { if (!vv && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Item sizes</DialogTitle>
                    <DialogDescription>
                        A dish&apos;s price points — Half and Full, 30ml and 60ml. A line that names one is billed at
                        that price and reports under it, instead of becoming a second dish with a different name.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-12">
                    <div className="space-y-1.5 sm:col-span-5">
                        <Label>Dish</Label>
                        <SearchInput
                            className="h-9" value={search} placeholder="Search the menu…"
                            aria-label="Search the menu"
                            onValueChange={setSearch}
                        />
                        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border p-1">
                            {shown.map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => { setDishId(m.id) }}
                                    className={cn(
                                        "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm",
                                        dishId === m.id ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
                                    )}
                                >
                                    <span className="min-w-0 truncate">{m.name}</span>
                                    <span className="ml-2 shrink-0 font-mono tabular-nums text-xs text-muted-foreground">
                                        {money(m.price)}
                                    </span>
                                </button>
                            ))}
                            {shown.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No dish matches that.</p> : null}
                        </div>
                    </div>

                    <div className="space-y-2 sm:col-span-7">
                        {!dish ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                Pick a dish to see or add its sizes.
                            </p>
                        ) : loading ? (
                            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Reading this dish&apos;s sizes…
                            </div>
                        ) : (
                            <>
                                <div className="text-sm">
                                    <span className="font-medium">{dish.name}</span>
                                    <span className="ml-2 text-muted-foreground">base {money(dish.price)}</span>
                                </div>

                                {variations.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No sizes. Every line of this dish is billed at its base price, and reports as one
                                        row — which is right for a dish that only comes one way.
                                    </p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {variations.map((v) => (
                                            <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2">
                                                <Input
                                                    className="h-8 w-32" defaultValue={v.name}
                                                    disabled={!canEdit || busy}
                                                    aria-label={`Name of size ${v.name}`}
                                                    onBlur={(e) => {
                                                        const next = e.target.value.trim()
                                                        if (next && next !== v.name) {void patch(v, { name: next })}
                                                    }}
                                                />
                                                <Input
                                                    className="h-8 w-24" inputMode="decimal" defaultValue={v.price.toFixed(2)}
                                                    disabled={!canEdit || busy}
                                                    aria-label={`Price of size ${v.name}`}
                                                    onBlur={(e) => {
                                                        const p = parseMoney(e.target.value)
                                                        if (p !== null && p !== v.price) {void patch(v, { price: p })}
                                                    }}
                                                />
                                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <Switch
                                                        checked={v.is_default}
                                                        disabled={!canEdit || busy}
                                                        onCheckedChange={(c) => { void patch(v, { is_default: c }) }}
                                                        aria-label={`Offer ${v.name} first`}
                                                    />
                                                    Default
                                                </label>
                                                {v.active ? null : <Badge variant="secondary" className="text-[10px] uppercase">Retired</Badge>}
                                                <Button
                                                    variant="ghost" size="sm" className="ml-auto gap-1"
                                                    disabled={!canEdit || busy}
                                                    onClick={() => void patch(v, { active: !v.active })}
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5" /> {v.active ? "Retire" : "Reinstate"}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {canEdit ? (
                                    <div className="flex flex-wrap gap-2 rounded-md border border-dashed p-2.5">
                                        <div>
                                            <Label className="text-[11px]">Size</Label>
                                            <Input
                                                className="h-9 w-32" value={name} placeholder="Half"
                                                onChange={(e) => { setName(e.target.value) }}
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-[11px]">Price</Label>
                                            <Input
                                                className="h-9 w-28" inputMode="decimal" value={price} placeholder="0.00"
                                                onChange={(e) => { setPrice(e.target.value) }}
                                            />
                                        </div>
                                        <div className="flex items-end">
                                            <Button
                                                className="h-9 gap-1"
                                                disabled={busy || !name.trim() || (parseMoney(price) ?? 0) <= 0}
                                                onClick={() => void add()}
                                            >
                                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}

                                <Hint tone="warn">
                                    A size&apos;s price is a <b>billing floor</b>, not a suggestion: from the moment a line
                                    names it, neither the till nor the guest QR page can ring that dish below it. That is
                                    why ₹0 is refused — free food is a non-chargeable, which carries a reason, an
                                    authoriser and a ledger row.
                                </Hint>
                                <Hint>
                                    A size is retired, never removed: its id is stamped on every order line that named it,
                                    and a bill re-printed next year must still say &ldquo;Half&rdquo;. It also cannot be moved
                                    to another dish — that would relabel every past sale.
                                </Hint>
                            </>
                        )}
                    </div>
                </div>

                <DialogFooter><Button onClick={onClose} disabled={busy}>Done</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
