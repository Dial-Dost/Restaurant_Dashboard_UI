"use client";

/**
 * The BULK TAGGER (menu_badges.dart `MenuBadgeTagDialog`) — which dishes carry
 * which badges. Tagging is a LIST, not a dialog per dish: a restaurant tagging
 * its veg dishes is doing one job across sixty items, so the tagger is the
 * whole menu in one searchable list with "apply to everything shown".
 *
 * Saving writes ONLY ids and tags — never whole items — so a stale menu in
 * this browser cannot overwrite an image, a recipe or a price.
 *
 * (The catalogue editor lives in src/components/menu/menu-badges-dialog.tsx;
 * the on-card chips in src/components/menu/badge-chips.tsx.)
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isDerivedBadge,
  staffBadgeClass,
  type MenuBadge,
} from "@/lib/menu-badges";
import { type MenuItem } from "./data";

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

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
  // [web-extra] the Tagged-"X" filter — Flutter's tagger has search only.
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
        <DialogHeader className="text-left">
          <div className="micro-label mb-1.5">Guest menu</div>
          <DialogTitle>Tag dishes with badges</DialogTitle>
          <DialogDescription>
            Saving writes only the tags — images, recipes, kitchen sections and prices are untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search dishes or categories…"
            aria-label="Search dishes or categories"
            value={search}
            className="max-w-[260px]"
            onChange={(e) => { setSearch(e.target.value); }}
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-border bg-inset p-2 text-xs">
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
              <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-inset p-2">
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
                          on ? staffBadgeClass(b.kind) : "border-dashed border-input text-muted-foreground hover:text-foreground",
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
