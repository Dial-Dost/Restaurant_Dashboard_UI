"use client";

// Shared bits for the Employees + Roles modules — the web copy of Flutter
// `_roleColor` / `_roleChip` / `_roleLabel` / `_confirm` / `_kv`
// (modules.dart ~36300) and the date helpers the leave register uses.

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** The seven built-ins, in the app's fixed order (`_coreRoles`). */
export const CORE_ROLES = ["admin", "manager", "cashier", "waiter", "captain", "valet", "employee"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_RE.test(v.trim());

/**
 * `_roleColor`: a stable colour per role — admin red, manager purple (accent
 * hi), captain blue, cashier teal, waiter orange, valet brown (accent deep),
 * employee slate, any custom role indigo (accent mid). Never travels alone:
 * the chip always pairs it with a dot and the label.
 */
export function roleColor(role: string): string {
  switch (role.trim().toLowerCase()) {
    case "admin":
      return "hsl(var(--destructive))";
    case "manager":
      return "hsl(var(--accent-hi))";
    case "captain":
      return "hsl(var(--info))";
    case "cashier":
      return "hsl(var(--success))";
    case "waiter":
      return "hsl(var(--warning))";
    case "valet":
      return "hsl(var(--accent-deep))";
    case "employee":
      return "hsl(var(--neutral))";
    default:
      return "hsl(var(--accent-mid))";
  }
}

/** `_roleLabel`: a custom role's uuid by its name, else "Custom role" — never a raw uuid. */
export function roleLabel(role: string, nameById: Record<string, string>): string {
  const r = role.trim();
  if (!isUuid(r)) { return r; }
  if (r in nameById) { return nameById[r]; }
  const lower = r.toLowerCase();
  return lower in nameById ? nameById[lower] : "Custom role";
}

/** `_roleChip`: tint + edge + 5px dot + label, optionally with an × to remove. */
export function RoleChip({
  role,
  colorKey,
  onRemove,
  removeDisabled,
  className,
}: {
  role: string;
  /** Colour by this instead of the label (e.g. "+2" chips stay neutral-indigo). */
  colorKey?: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const c = roleColor(colorKey ?? role);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-[5px] rounded-full border py-[3px] pl-2 text-[10.5px] font-semibold tracking-[0.3px]",
        onRemove ? "pr-[5px]" : "pr-2",
        className,
      )}
      style={{
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 28%, transparent)`,
        color: `color-mix(in srgb, ${c} 75%, white)`,
      }}
    >
      <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: c }} />
      <span className="truncate">{role}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${role}`}
          disabled={removeDisabled}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="rounded-full opacity-80 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <X className="h-3 w-3" style={{ color: c }} />
        </button>
      )}
    </span>
  );
}

/** Token-styled key/value row (`_kv`). */
export function Kv({ k, children }: { k: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-4 py-1.5">
      <div className="micro-label w-[120px] shrink-0 pt-0.5">{k}</div>
      <div className="min-w-0 flex-1 break-words text-[13px] font-medium text-foreground">{children}</div>
    </div>
  );
}

/** The app's styled confirm (`_confirm`) — never window.confirm. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = true,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "bg-destructive bg-none text-destructive-foreground hover:bg-destructive/90" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------- dates

/** Today as YYYY-MM-DD in the restaurant's zone (`RestaurantTime.todayIso`). */
export function todayIn(timezone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Shift a YYYY-MM-DD key by whole days. */
export function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) { return key; }
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `_fmtDay`: "Aug 3" for a YYYY-MM-DD key; '—' when empty. */
export function fmtDay(key: string): string {
  if (!key) { return "—"; }
  const d = new Date(`${key.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) { return key; }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** `RestaurantTime.stamp`: a timestamp in the restaurant's zone. */
export function stamp(iso: string, timezone: string | undefined): string {
  if (!iso) { return "—"; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  try {
    return d.toLocaleString("en-IN", { timeZone: timezone || undefined, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return d.toLocaleString();
  }
}

export const str = (row: Record<string, unknown> | null | undefined, key: string, fallback = ""): string => {
  const v = row?.[key];
  const s = typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  return s === "" ? fallback : s;
};

export const intOrNull = (v: unknown): number | null => {
  if (v == null || v === "") { return null; }
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") { return null; }
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
