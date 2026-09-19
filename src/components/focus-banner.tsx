"use client";

// THE DEEP-LINK FOCUS MECHANISM — the web half of the Flutter shell's
// `ModuleFocusRequest` + per-module focus banner (module_navigator.dart and the
// banner in modules.dart).
//
// A tapped notification (or any cross-module drill-down) navigates with
// `?focus=<url-encoded JSON>` — the notification's meta merged with the
// resolver's entity — and the destination page:
//
//   1. reads it with `useFocusRequest()`;
//   2. refetches (the param arriving/changing is the signal — pass
//      `focus?.serial` into your loader deps so the record may have arrived);
//   3. scrolls to / highlights the record when found, and EITHER WAY shows the
//      persistent <FocusBanner> — copper "right here" or warning "not in this
//      list" — until the user dismisses it ("Show all …"), which strips the
//      param from the URL.
//
// Honest by construction: a transient ring that fades whether or not the row
// exists is exactly the dishonesty this replaces.

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** The query param carrying the focus payload. */
export const FOCUS_PARAM = "focus";

/** Append a focus payload to a route. Callers keep any legacy params they need. */
export const withFocusParam = (href: string, target: Record<string, unknown>): string => {
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}${FOCUS_PARAM}=${encodeURIComponent(JSON.stringify(target))}`;
};

export interface FocusRequest {
  /** The caller's payload: notification meta merged with the resolver's entity. */
  target: Record<string, unknown>;
  /**
   * Id of the record to focus: the resolver's `entity_id` first, then the
   * per-type meta keys the backend has always written (older rows carry only
   * those) — `ModuleFocusRequest.idOf`, line for line.
   */
  idOf: (fallbackKeys: string[]) => string | null;
  /** `order` / `booking` / `waitlist` / … when the resolver ran, else null. */
  entityType: string | null;
  /** Table name carried by table-scoped payloads (QR orders, payments). */
  tableName: string | null;
  /** Distinguishes two requests for the same record — key loaders off it. */
  serial: string;
  /** Drop the request: strips ?focus from the URL without a navigation entry. */
  dismiss: () => void;
}

const readString = (target: Record<string, unknown>, key: string): string | null => {
  const v = target[key];
  // Focus ids arrive as strings or numbers; anything else is not an id.
  if (typeof v !== "string" && typeof v !== "number") { return null; }
  const s = String(v).trim();
  return s.length === 0 || s === "null" ? null : s;
};

/**
 * The pending focus request for this page, or null. Reads `?focus=`; a page
 * only ever receives its own request because the shell routes by module href.
 */
export function useFocusRequest(): FocusRequest | null {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = searchParams.get(FOCUS_PARAM);

  return React.useMemo(() => {
    if (!raw) { return null; }
    let target: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { return null; }
      target = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    const dismiss = (): void => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete(FOCUS_PARAM);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };
    return {
      target,
      idOf: (fallbackKeys: string[]) => {
        const direct = readString(target, "entity_id");
        if (direct != null) { return direct; }
        for (const key of fallbackKeys) {
          const v = readString(target, key);
          if (v != null) { return v; }
        }
        return null;
      },
      entityType: readString(target, "entity_type"),
      tableName: readString(target, "table"),
      serial: raw,
      dismiss,
    };
  }, [raw, searchParams, pathname, router]);
}

export interface FocusBannerProps {
  /** True: the record is on this screen. False: it is not in this list. */
  found: boolean;
  /** The sentence — "Order #1042 is right here." / "Booking not in this list." */
  message: React.ReactNode;
  /**
   * Escape actions for the not-found case (switch outlet, widen the filter,
   * open History) — small ghost/outline buttons.
   */
  actions?: React.ReactNode;
  /** Dismiss ✕ — clears the focus request; label reads "Show all …". */
  onDismiss: () => void;
  /** What dismissing shows, e.g. "Show all orders". */
  showAllLabel?: string;
  className?: string;
}

/**
 * The persistent found / not-found banner a focused module shows above its
 * list. Copper voice when the record is right here; warning voice when it is
 * not — never a silent landing on a page the record cannot be on.
 */
export function FocusBanner({ found, message, actions, onDismiss, showAllLabel = "Show all", className }: FocusBannerProps): React.JSX.Element {
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
        found
          ? "border-accent-hi/40 bg-accent-hi/10 text-foreground"
          : "border-warning/40 bg-warning/10 text-foreground",
        className,
      )}
    >
      {found
        ? <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-accent-foreground" />
        : <TriangleAlert aria-hidden className="h-4 w-4 shrink-0 text-warning" />}
      <span className="min-w-0 flex-1">{message}</span>
      {actions != null && <span className="flex shrink-0 items-center gap-1.5">{actions}</span>}
      <button
        type="button"
        onClick={onDismiss}
        title={showAllLabel}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">{showAllLabel}</span>
      </button>
    </div>
  );
}
