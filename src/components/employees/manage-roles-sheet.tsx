"use client";

// `_ManageRolesSheet` (modules.dart ~36945): avatar header, the held roles as
// removable colour chips, then one switch per role (7 built-ins + customs,
// deduped case-insensitively). Every toggle applies immediately with a
// per-role busy lock; the only locked toggle is the superadmin's admin role.
// Toggles post the role's NAME (core and custom alike), as the app does.

import * as React from "react";
import { Check, Crown, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { InitialsAvatar } from "@/components/customers/guest-bits";
import { useToast } from "@/hooks/use-toast";
import { assignRole, unassignRole } from "@/lib/api/employees";
import type { RoleDefinition, User } from "@/lib/db";
import { cn } from "@/lib/utils";
import { CORE_ROLES, RoleChip, roleColor } from "./shared";

export function ManageRolesSheet({
  restaurantId,
  employee,
  display,
  initials,
  isSuper,
  customRoles,
  onDone,
}: {
  restaurantId: string;
  employee: User;
  display: string;
  initials: string;
  isSuper: boolean;
  customRoles: RoleDefinition[];
  /** Called on close with whether anything changed (reload once). */
  onDone: (changed: boolean) => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const nameById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of customRoles) {
      if (r.id && r.role_name) { m[r.id.toLowerCase().trim()] = r.role_name.toLowerCase().trim(); }
    }
    return m;
  }, [customRoles]);

  const [assigned, setAssigned] = React.useState<Set<string>>(() => {
    const raw = Array.isArray(employee.role_all) && employee.role_all.length > 0 ? employee.role_all : [employee.role];
    const s = new Set<string>();
    for (const r of raw) {
      const k = r.toLowerCase().trim();
      if (k) { s.add(k in nameById ? nameById[k] : k); }
    }
    return s;
  });
  const [busy, setBusy] = React.useState<Set<string>>(new Set());
  const changed = React.useRef(false);

  const all = React.useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; custom: boolean }[] = [];
    for (const r of CORE_ROLES) { seen.add(r); out.push({ name: r, custom: false }); }
    for (const r of customRoles) {
      const n = r.role_name.trim();
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push({ name: n, custom: true }); }
    }
    return out;
  }, [customRoles]);

  const locked = (role: string): boolean => (isSuper && role.toLowerCase() === "admin") || busy.has(role.toLowerCase());

  const toggle = async (role: string, add: boolean): Promise<void> => {
    const key = role.toLowerCase();
    setBusy((b) => new Set(b).add(key));
    try {
      if (add) {
        await assignRole(restaurantId, employee.employee_id, role);
      } else {
        await unassignRole(restaurantId, employee.employee_id, role);
      }
      changed.current = true;
      setAssigned((s) => {
        const n = new Set(s);
        if (add) { n.add(key); } else { n.delete(key); }
        return n;
      });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  };

  const held = all.filter((r) => assigned.has(r.name.toLowerCase()));

  return (
    <DrillSheet
      open
      onOpenChange={(o) => { if (!o) { onDone(changed.current); } }}
      eyebrow="Manage roles"
      title={
        <span className="inline-flex items-center gap-2.5">
          <InitialsAvatar
            initials={initials || "?"}
            size={32}
            className={isSuper ? "border-warning/50 text-warning" : undefined}
          />
          <span className="truncate">{display}</span>
          {isSuper && (
            <span title="Superadmin (owner)" aria-label="Superadmin (owner)">
              <Crown className="h-4 w-4 text-warning" />
            </span>
          )}
        </span>
      }
    >
      {held.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {held.map((r) => (
            <RoleChip
              key={r.name}
              role={r.name}
              colorKey={r.custom ? "custom" : r.name}
              onRemove={() => { void toggle(r.name, false); }}
              removeDisabled={locked(r.name)}
            />
          ))}
        </div>
      )}
      <Separator className="my-3" />
      <div className="grid">
        {all.map((r) => {
          const c = roleColor(r.custom ? "custom" : r.name);
          const on = assigned.has(r.name.toLowerCase());
          return (
            <label
              key={r.name}
              className={cn("flex items-center gap-3 rounded-md px-1 py-2", !locked(r.name) && "cursor-pointer hover:bg-foreground/[0.04]")}
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{ background: `color-mix(in srgb, ${c} 14%, transparent)` }}
              >
                <Shield className="h-3.5 w-3.5" style={{ color: c }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                {r.custom && <span className="block text-[11px] text-muted-foreground">Custom role</span>}
              </span>
              <Switch
                checked={on}
                disabled={locked(r.name)}
                onCheckedChange={(v) => { void toggle(r.name, v); }}
                aria-label={`${on ? "Remove" : "Assign"} ${r.name}`}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => { onDone(changed.current); }}>
          <Check /> Done
        </Button>
      </div>
    </DrillSheet>
  );
}
