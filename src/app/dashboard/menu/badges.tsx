"use client";

/**
 * The staff-side badge editors: the CATALOGUE (which badges exist, what they are
 * called, whether they are on) and the BULK TAGGER (which dishes carry them).
 *
 * Two decisions this file makes visible:
 *
 *  - Tagging is a LIST, not a dialog per dish. A restaurant tagging its veg
 *    dishes is doing one job across sixty items; walking sixty edit dialogs is
 *    the same job made unusable. So the tagger is the whole menu in one
 *    searchable list with a filter, plus "apply to everything shown".
 *
 *  - Dietary and safety badges are not decoration, and the UI says so before the
 *    server has to. They are grouped apart, they are labelled with what they
 *    promise, and removing one that dishes still carry asks a real question
 *    instead of surfacing a 409. Allergen-derived badges (Contains nuts) are not
 *    taggable at all here — they follow the dish's allergen list, which is
 *    edited in Recipe & cost, and the UI explains that rather than hiding it.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PlusCircle, Sparkles, Tags, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BADGE_KIND_HINT,
  BADGE_KIND_LABEL,
  BADGE_KIND_ORDER,
  MenuBadgeInUseError,
  type MenuBadge,
  type MenuBadgeKind,
  isDerivedBadge,
  isProtectedBadge,
  resolveBadges,
  staffBadgeClass,
} from "@/lib/menu-badges";
import { type MenuItem } from "./data";

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

/** Slug rule, mirroring the server's menuBadgeSlug so ids agree on both sides. */
const slugify = (label: string): string =>
  label.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);

/** The chips shown on a menu row — what a guest will see, in the guest's order. */
export function ItemBadgeChips({ catalogue, item, className }: { catalogue: MenuBadge[]; item: MenuItem; className?: string }): React.JSX.Element | null {
  const resolved = resolveBadges(catalogue, item.badges, item.allergens);
  if (resolved.length === 0) {return null;}
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {resolved.map((b) => (
        <span
          key={b.id}
          title={isDerivedBadge(b) ? `Shown automatically because this dish lists "${b.allergen ?? ""}" as an allergen.` : BADGE_KIND_HINT[b.kind]}
          className={cn("rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4", staffBadgeClass(b.kind))}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Catalogue editor
// ---------------------------------------------------------------------------

export function MenuBadgesCard({
  catalogue,
  presets,
  labelMax,
  busy,
  itemsTaggedWith,
  onSave,
  onOpenTagger,
}: {
  catalogue: MenuBadge[];
  presets: MenuBadge[];
  labelMax: number;
  busy: boolean;
  /** How many dishes currently carry a badge id — drives the removal warning. */
  itemsTaggedWith: (id: string) => number;
  onSave: (next: MenuBadge[], opts?: { releaseTagged?: boolean }) => Promise<void>;
  onOpenTagger: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<MenuBadge[] | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<MenuBadgeKind>("promo");
  const [error, setError] = useState<string | null>(null);

  const current = draft ?? catalogue;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(catalogue);

  const edit = (next: MenuBadge[]): void => { setDraft(next); setError(null); };
  const patch = (id: string, fields: Partial<MenuBadge>): void => {
    edit(current.map((b) => (b.id === id ? { ...b, ...fields } : b)));
  };

  const remove = (badge: MenuBadge): void => {
    // Ask HERE, with the count, rather than letting the server's 409 be the
    // first the owner hears of it — a dietary claim disappearing from forty
    // dishes should read as a decision, not an error.
    const n = itemsTaggedWith(badge.id);
    if (isProtectedBadge(badge) && !isDerivedBadge(badge) && n > 0) {
      const ok = window.confirm(
        `"${badge.label}" is on ${String(n)} dish${n === 1 ? "" : "es"}. Removing it also removes that claim from ${n === 1 ? "it" : "them"}. Continue?`,
      );
      if (!ok) {return;}
    }
    edit(current.filter((b) => b.id !== badge.id));
  };

  const addCustom = (): void => {
    const label = newLabel.trim().slice(0, labelMax);
    const id = slugify(label);
    if (!id) {return;}
    if (current.some((b) => b.id === id)) { setError(`"${label}" already exists.`); return; }
    edit([...current, { id, label, kind: newKind, enabled: true }]);
    setNewLabel("");
  };

  const save = async (): Promise<void> => {
    setError(null);
    try {
      await onSave(current);
      setDraft(null);
    } catch (e: unknown) {
      // The server refuses a protected removal it can prove is in use. Offer the
      // same confirm the client-side count would have shown, so a dietary claim
      // leaving forty dishes always reads as a decision rather than an error.
      if (e instanceof MenuBadgeInUseError && e.badges.length > 0) {
        const detail = e.badges.map((b) => `"${b.label}" (${String(b.items)})`).join(", ");
        if (window.confirm(`These dishes still carry a badge you removed: ${detail}. Remove it from them too?`)) {
          try {
            await onSave(current, { releaseTagged: true });
            setDraft(null);
          } catch (e2: unknown) { setError(errorText(e2, "Unable to save badges.")); }
          return;
        }
        setError(e.message);
        return;
      }
      setError(errorText(e, "Unable to save badges."));
    }
  };

  const byKind = (kind: MenuBadgeKind): MenuBadge[] => current.filter((b) => b.kind === kind);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Tags className="h-5 w-5 text-primary" /> Menu badges</CardTitle>
          <CardDescription>
            Small labels guests see on a dish. Warnings and dietary badges are always shown to them; highlights are trimmed first when a card is tight.
            Nothing appears on your menu until you add a badge here.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenTagger} disabled={current.filter((b) => b.enabled && !isDerivedBadge(b)).length === 0}>
          <Tags className="mr-2 h-4 w-4" /> Tag dishes
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {current.length === 0 && (
          <div className="rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              No badges yet — your menu looks exactly as it does today. Start from the suggested set for Indian restaurants, then edit or remove anything you do not want.
            </p>
            <Button className="mt-3" variant="outline" size="sm" disabled={busy || presets.length === 0} onClick={() => { edit(presets.map((b) => ({ ...b }))); }}>
              <Sparkles className="mr-2 h-4 w-4" /> Use the starter set ({presets.length})
            </Button>
          </div>
        )}

        {BADGE_KIND_ORDER.filter((k) => byKind(k).length > 0).map((kind) => (
          <div key={kind}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {BADGE_KIND_LABEL[kind]} <span className="font-normal normal-case">— {BADGE_KIND_HINT[kind]}</span>
            </p>
            <ul className="space-y-1.5">
              {byKind(kind).map((b) => {
                const derived = isDerivedBadge(b);
                const count = itemsTaggedWith(b.id);
                return (
                  <li key={b.id} className="flex items-center gap-2 rounded-md border p-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", staffBadgeClass(b.kind))}>{b.label}</span>
                    <Input
                      value={b.label}
                      maxLength={labelMax}
                      aria-label={`Label for ${b.id}`}
                      className="h-8 max-w-[200px]"
                      onChange={(e) => { patch(b.id, { label: e.target.value }); }}
                    />
                    {derived ? (
                      <span className="text-xs text-muted-foreground">
                        Automatic — shown on any dish listing <b>{b.allergen}</b> as an allergen.
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{count > 0 ? `${String(count)} dish${count === 1 ? "" : "es"}` : "not used yet"}</span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Switch
                        checked={b.enabled}
                        aria-label={`${b.enabled ? "Disable" : "Enable"} ${b.label}`}
                        onCheckedChange={(v) => { patch(b.id, { enabled: v }); }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${b.label}`}
                        title={`Remove ${b.label}`}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => { remove(b); }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newLabel}
            maxLength={labelMax}
            placeholder="New badge (e.g. Gluten free)"
            className="max-w-[220px]"
            aria-label="New badge label"
            onChange={(e) => { setNewLabel(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          />
          <Select value={newKind} onValueChange={(v) => { setNewKind(v as MenuBadgeKind); }}>
            <SelectTrigger className="w-[150px]" aria-label="New badge type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BADGE_KIND_ORDER.map((k) => <SelectItem key={k} value={k}>{BADGE_KIND_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" disabled={!newLabel.trim()} onClick={addCustom}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {dirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save badges"}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>Discard</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bulk tagger
// ---------------------------------------------------------------------------

const NO_FILTER = "__all__";

export function TagBadgesDialog({
  items,
  catalogue,
  perItemMax,
  onClose,
  onSave,
}: {
  items: MenuItem[];
  catalogue: MenuBadge[];
  perItemMax: number;
  onClose: () => void;
  onSave: (updates: { id: string; badges: string[] }[]) => Promise<void>;
}): React.JSX.Element {
  // Only hand-taggable badges appear here. A derived one (Contains nuts) is not
  // a tag — it follows the dish's allergen list — so offering it as a toggle
  // would be offering a switch that does nothing.
  const taggable = useMemo(() => catalogue.filter((b) => b.enabled && !isDerivedBadge(b)), [catalogue]);
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>(NO_FILTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagsOf = (item: MenuItem): string[] =>
    Object.prototype.hasOwnProperty.call(edits, item.id) ? edits[item.id] : (item.badges ?? []);

  const q = search.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (q && !`${it.name} ${it.category}`.toLowerCase().includes(q)) {return false;}
    if (filter !== NO_FILTER && !tagsOf(it).includes(filter)) {return false;}
    return true;
  });

  const toggle = (item: MenuItem, badgeId: string): void => {
    const current = tagsOf(item);
    const next = current.includes(badgeId)
      ? current.filter((b) => b !== badgeId)
      : current.length >= perItemMax ? current : [...current, badgeId];
    setEdits((prev) => ({ ...prev, [item.id]: next }));
  };

  /** The reason this is a list and not a per-dish dialog: one action, many dishes. */
  const applyToVisible = (badgeId: string, on: boolean): void => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const it of visible) {
        const current = Object.prototype.hasOwnProperty.call(next, it.id) ? next[it.id] : (it.badges ?? []);
        if (on && !current.includes(badgeId)) {
          if (current.length >= perItemMax) {continue;}
          next[it.id] = [...current, badgeId];
        } else if (!on && current.includes(badgeId)) {
          next[it.id] = current.filter((b) => b !== badgeId);
        }
      }
      return next;
    });
  };

  const changed = items.filter((it) => {
    if (!Object.prototype.hasOwnProperty.call(edits, it.id)) {return false;}
    const next = edits[it.id];
    const before = it.badges ?? [];
    return next.length !== before.length || next.some((b, i) => b !== before[i]);
  });

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSave(changed.map((it) => ({ id: it.id, badges: tagsOf(it) })));
    } catch (e: unknown) {
      setError(errorText(e, "Unable to save tags."));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Tag dishes with badges</DialogTitle>
          <DialogDescription>
            Click a badge to put it on a dish. Saving writes only the tags — images, recipes, sections and prices are untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            placeholder="Search dishes or categories…"
            aria-label="Search dishes or categories"
            value={search}
            wrapperClassName="w-full max-w-[260px]"
            onValueChange={setSearch}
          />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[190px]" aria-label="Filter by badge"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FILTER}>All dishes</SelectItem>
              {taggable.map((b) => <SelectItem key={b.id} value={b.id}>Tagged “{b.label}”</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {visible.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/40 p-2 text-xs">
            <span className="text-muted-foreground">Apply to all {visible.length} shown:</span>
            {taggable.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  className={cn("rounded-full border px-2 py-0.5 font-medium hover:opacity-80", staffBadgeClass(b.kind))}
                  onClick={() => { applyToVisible(b.id, true); }}
                >
                  + {b.label}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${b.label} from all shown`}
                  title={`Remove ${b.label} from all shown`}
                  className="rounded px-1 text-muted-foreground hover:text-destructive"
                  onClick={() => { applyToVisible(b.id, false); }}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
          {visible.map((it) => {
            const tags = tagsOf(it);
            const full = tags.length >= perItemMax;
            return (
              <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <div className="min-w-[160px] flex-1">
                  <p className="truncate text-sm font-medium">{it.name}</p>
                  <p className="text-xs text-muted-foreground">{it.category}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {taggable.map((b) => {
                    const on = tags.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        disabled={!on && full}
                        title={!on && full ? `A dish can carry at most ${String(perItemMax)} badges.` : b.label}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                          on ? staffBadgeClass(b.kind) : "border-dashed text-muted-foreground hover:text-foreground",
                          !on && full && "opacity-40",
                        )}
                        onClick={() => { toggle(it, b.id); }}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && <p className="text-sm text-muted-foreground">No dishes match.</p>}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || changed.length === 0} onClick={() => void save()}>
            {busy ? "Saving…" : `Save${changed.length > 0 ? ` (${String(changed.length)} dish${changed.length === 1 ? "" : "es"})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
