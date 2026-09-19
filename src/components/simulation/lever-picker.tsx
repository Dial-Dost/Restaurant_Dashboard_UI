"use client";

// "+ Add a lever" — Flutter `_openPicker` / `_LeverPicker` (simulation.dart).
// Phone (<760px): a modal bottom sheet at 85% height. Desktop: a 360px popover
// anchored under the button (Radix flips it above when there is no room and
// keeps it on-screen; Escape / outside click close). Checking a row adds the
// lever to the panel live while the picker stays open.

import { useState, type JSX } from "react";
import { Check, Plus } from "lucide-react";

import { AppSearchField } from "@/components/ui/app-search-field";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { PARAM_CATALOG, groupedParams } from "@/lib/simulation-params";
import { useNarrow } from "./use-narrow";

interface LeverPickerProps {
  active: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

function PickerBody({ active, onToggle, className }: LeverPickerProps & { className?: string }): JSX.Element {
  const [query, setQuery] = useState("");
  const groups = groupedParams(query);
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <AppSearchField placeholder="Search levers…" onQuery={setQuery} autoFocus compact />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            No parameter matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.group} className="pb-1">
              <div className="micro-label px-1 pb-1 pt-2">{g.group}</div>
              {g.specs.map((spec) => {
                const on = active.has(spec.key);
                return (
                  <button
                    key={spec.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => { onToggle(spec.key); }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] focus-visible:outline-none"
                  >
                    {/* Display-only checkbox — the whole row is the target. */}
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                        on ? "border-accent-hi bg-accent-hi text-accent-on" : "border-input",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{spec.label}</span>
                    {spec.speculative && <StatusChip status="warning" label="speculative" dense />}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="mt-2 border-t border-divider pt-2 text-[11px] text-muted-foreground">
        {active.size} of {PARAM_CATALOG.length} levers active · removed levers keep their value and contribute your
        default.
      </div>
    </div>
  );
}

export function LeverPicker({ active, onToggle }: LeverPickerProps): JSX.Element {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button variant="outline" size="sm" onClick={narrow ? () => { setOpen(true); } : undefined}>
      <Plus className="mr-1.5 h-4 w-4" />
      Add a lever
    </Button>
  );

  if (narrow) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="flex h-[85vh] flex-col px-4 pb-4 pt-7">
            <SheetTitle className="text-[15px]">Add a lever</SheetTitle>
            <PickerBody active={active} onToggle={onToggle} className="flex-1" />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] flex-col bg-card p-3"
      >
        <PickerBody active={active} onToggle={onToggle} className="min-h-0 flex-1" />
      </PopoverContent>
    </Popover>
  );
}
