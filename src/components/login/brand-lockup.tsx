import { UtensilsCrossed } from "lucide-react";

/** Flutter `_brandLockup()`: copper gradient monogram tile + wordmark. */
export function BrandLockup(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-hi to-accent-deep shadow-[0_6px_18px_-6px_hsl(var(--accent-deep)/0.6)]">
        <UtensilsCrossed className="h-5 w-5 text-white" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold tracking-[0.17em]">RESTAURANT DASH</div>
        <div className="text-[11px] text-muted-foreground">Owner workspace</div>
      </div>
    </div>
  );
}
