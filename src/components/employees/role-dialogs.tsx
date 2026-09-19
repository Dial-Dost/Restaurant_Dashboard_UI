"use client";

// Core-role viewer (`_showCoreRole`) and the custom-role editor
// (`_CreateRoleDialog`) — modules.dart ~36651–36944.

import * as React from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { saveRole, type ActionGroup } from "@/lib/api/employees";
import type { CoreRoleRow, RoleDefinition } from "@/lib/db";
import {
  WILDCARD_ACTION,
  renderRolePermissions,
  roleActionIds,
  type ActionCatalog,
} from "@/lib/role-permissions";
import { cn } from "@/lib/utils";
import { roleColor } from "./shared";

const byGroup = <T,>(items: T[], groupOf: (t: T) => string, nameOf: (t: T) => string): [string, T[]][] => {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const g = groupOf(it) || "Other";
    m.set(g, [...(m.get(g) ?? []), it]);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([g, list]) => [g, [...list].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))]);
};

/** `_showCoreRole`: kicker, dot title, guidance, count, grouped checks. */
export function CoreRoleDialog({
  role,
  catalog,
  onOpenChange,
}: {
  role: CoreRoleRow;
  catalog: ActionCatalog;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const ids = roleActionIds(role);
  const wildcard = ids.includes(WILDCARD_ACTION);
  const rows = renderRolePermissions(role, catalog).filter((r) => r.id !== WILDCARD_ACTION);
  const named = rows.filter((r) => r.resolved);
  const unknown = rows.length - named.length;
  const groups = byGroup(named, (r) => r.group ?? "", (r) => r.name);
  const name = role.role.toLowerCase();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-[460px]">
        <DialogHeader>
          <div className="micro-label">Core role</div>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: roleColor(name) }} />
            {name}
          </DialogTitle>
          <DialogDescription>
            {wildcard
              ? "Every permission in the system, including ones added by future updates. Built in and not editable — it is the owner role."
              : "Built in and not editable. To give someone this plus something extra, create a custom role with the permissions you want and assign it alongside."}
          </DialogDescription>
        </DialogHeader>
        {!wildcard && (
          <div className="min-h-0 overflow-y-auto">
            <div className="micro-label mb-2">{rows.length} permission(s)</div>
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">This role grants no permissions of its own.</p>
            ) : (
              <>
                {groups.map(([g, list]) => (
                  <div key={g} className="mb-3">
                    <SectionHeader title={g} />
                    {list.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 py-1" title={r.desc ?? undefined}>
                        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                        <span className="text-[13px]">{r.name}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {unknown > 0 && (
                  <p className="text-xs text-warning">
                    {unknown} further permission(s) this app does not have a name for yet — update the app to see them listed.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); }}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `_CreateRoleDialog`: create / edit / read-only view of a custom role. */
export function RoleEditorDialog({
  restaurantId,
  existing,
  readOnly,
  actions,
  catalog,
  onSaved,
  onOpenChange,
}: {
  restaurantId: string;
  existing: RoleDefinition | null;
  readOnly: boolean;
  actions: ActionGroup[];
  catalog: ActionCatalog;
  onSaved: () => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const isEdit = existing != null;
  const [name, setName] = React.useState(existing?.role_name ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(Array.isArray(existing?.actions_performable) ? existing.actions_performable : []),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const flat = actions.flatMap((g) => g.actions.map((a) => ({ ...a, group: g.group })));
  const groups = byGroup(flat, (a) => a.group, (a) => a.name);
  const hasCatalog = flat.length > 0;

  const toggle = (id: string): void => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Role name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Sent exactly as typed (trimmed) — never lowercased.
      await saveRole(restaurantId, trimmed, [...selected]);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  // Read-only fallback without the View Actions catalogue [web-extra]: name
  // what the role grants from the server's projection.
  const granted = !hasCatalog && existing ? renderRolePermissions(existing, catalog) : [];

  return (
    <Dialog open onOpenChange={(o) => { if (!saving) { onOpenChange(o); } }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="micro-label">RBAC</div>
          <DialogTitle className="truncate">
            {isEdit ? `${readOnly ? "Role" : "Edit role"} · ${existing.role_name}` : "Create role"}
          </DialogTitle>
          {readOnly ? (
            <DialogDescription>
              What this role grants. Changing it needs the role-editing permission — ask an owner or a manager who has it.
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Pick the permissions this role grants.</DialogDescription>
          )}
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          disabled={isEdit || readOnly}
          placeholder="Role name (e.g. Floor Supervisor)"
          aria-label="Role name"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="micro-label">{selected.size} permission(s) selected</div>
        <div className="h-[320px] overflow-y-auto rounded-md border border-border bg-inset px-2 py-1">
          {hasCatalog ? (
            groups.map(([g, list]) => (
              <div key={g} className="mb-2">
                <SectionHeader title={g} className="mt-2" />
                {list.map((a) => {
                  const on = selected.has(a.id);
                  return (
                    <label
                      key={a.id}
                      title={a.desc ?? undefined}
                      className={cn(
                        "flex min-h-[40px] items-center gap-3 rounded-md px-2 py-1.5",
                        !readOnly && "cursor-pointer hover:bg-foreground/[0.04]",
                      )}
                    >
                      <Checkbox
                        checked={on}
                        disabled={readOnly || saving}
                        onCheckedChange={() => { toggle(a.id); }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{a.name}</span>
                        {a.desc && <span className="block truncate text-[11px] text-muted-foreground">{a.desc}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))
          ) : existing ? (
            <div className="grid gap-1 p-2">
              {granted.map((r, i) => (
                <div key={`${r.id}-${String(i)}`} className="flex items-center gap-2 text-[13px]">
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                  {r.resolved ? r.name : <span className="font-mono text-xs text-muted-foreground">{r.id}</span>}
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">
                Choosing permissions needs the “View Actions” permission, which this login does not hold.
              </p>
            </div>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              Choosing permissions needs the “View Actions” permission, which this login does not hold.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={() => { void save(); }} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
