"use client";

// One active lever — Flutter `_leverRow` and its three controls (simulation.dart
// 560-728): label + speculative chip + change-dot + per-lever reset on the
// left, the copper value and the remove control on the right, the control
// under them, the explainer (and the second-outlet plan gate) below that.

import type { JSX } from "react";
import { Check, Lock, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { StatusChip } from "@/components/ui/status-chip";
import { Switch } from "@/components/ui/switch";
import {
  numberValue,
  planTierValue,
  sliderDomain,
  snapToStep,
  toggleValue,
  type MoneyFormat,
  type ParamSpec,
  type ParamValue,
  type ParamValues,
} from "@/lib/simulation-params";

interface LeverRowProps {
  spec: ParamSpec;
  values: ParamValues;
  defaults: ParamValues;
  changed: boolean;
  /** The second-outlet plan gate sentence; null when the plan allows it. */
  gate: string | null;
  money: MoneyFormat;
  onChange: (key: string, value: ParamValue) => void;
  onReset: (key: string) => void;
  onRemove: (key: string) => void;
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-hi"
    >
      {children}
    </button>
  );
}

export function LeverRow({ spec, values, defaults, changed, gate, money, onChange, onReset, onRemove }: LeverRowProps): JSX.Element {
  let control: JSX.Element;
  if (spec.kind === "number") {
    const domain = sliderDomain(spec, numberValue(defaults, spec.key, spec.min));
    // The stored value is never clamped into the catalogue range; only the
    // slider's thumb position is kept inside the (widened) domain.
    const pos = Math.min(domain.max, Math.max(domain.min, numberValue(values, spec.key, domain.min)));
    control = (
      <Slider
        className="py-2"
        value={[pos]}
        min={domain.min}
        max={domain.max}
        step={spec.step}
        aria-label={spec.label}
        onValueChange={(vals) => {
          const v = vals.at(0);
          if (v !== undefined) {onChange(spec.key, snapToStep(spec, domain, v));}
        }}
      />
    );
  } else if (spec.kind === "enum") {
    const selected = planTierValue(values);
    control = (
      <div className="flex flex-wrap gap-2 py-1.5">
        {spec.options.map((o) =>
          o.value === selected ? (
            <Button key={o.value} size="sm" aria-pressed onClick={() => { onChange(spec.key, o.value); }}>
              <Check className="mr-1 h-3.5 w-3.5" />
              {o.label}
            </Button>
          ) : (
            <Button key={o.value} size="sm" variant="outline" aria-pressed={false} onClick={() => { onChange(spec.key, o.value); }}>
              {o.label}
            </Button>
          ),
        )}
      </div>
    );
  } else {
    const on = toggleValue(values, spec.key);
    control = (
      <div className="flex items-center gap-2 py-1.5">
        {/* Gated = cannot be switched ON; it can always be switched off. */}
        <Switch
          checked={on}
          aria-label={spec.label}
          disabled={gate != null && !on}
          onCheckedChange={(v) => { onChange(spec.key, v); }}
        />
        <span className="text-xs text-muted-foreground">{on ? "On" : "Off"}</span>
      </div>
    );
  }

  return (
    <div className="pb-4">
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="micro-label truncate">{spec.label}</span>
          {spec.speculative && <StatusChip status="warning" label="speculative" dense />}
          {changed && (
            <>
              <span
                title="Changed from your default"
                aria-label="Changed from your default"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-hi"
              />
              <IconAction label={`Reset ${spec.label} to your default`} onClick={() => { onReset(spec.key); }}>
                <RotateCcw className="h-3.5 w-3.5" />
              </IconAction>
            </>
          )}
        </div>
        {spec.kind === "number" && (
          <span className="ml-2 truncate whitespace-nowrap text-sm font-semibold tabular-nums text-accent-hi">
            {spec.format(numberValue(values, spec.key), money)}
          </span>
        )}
        <IconAction label={`Remove ${spec.label} (its value is kept)`} onClick={() => { onRemove(spec.key); }}>
          <X className="h-3.5 w-3.5" />
        </IconAction>
      </div>
      {control}
      <p className="text-xs text-muted-foreground">{spec.explainer}</p>
      {gate != null && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
          <span>{gate}</span>
        </p>
      )}
    </div>
  );
}
