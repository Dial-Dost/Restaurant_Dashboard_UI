"use client";

// Roles — the web copy of Flutter `rolesModule` (modules.dart ~36405): a
// narrow page with a permission-aware intro, "Core roles" (all seven, fixed
// order, colour chips — inert when /core-roles could not be read), "Custom
// roles" (count, shield-tile cards, confirmed delete) and a floating
// "New role" action hidden without the create-role permission. Role
// ASSIGNMENT lives on the Employees page ("Manage roles" on a card).

import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import { Shield, ShieldPlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { CoreRoleDialog, RoleEditorDialog } from "@/components/employees/role-dialogs";
import { CORE_ROLES, ConfirmDialog, roleColor } from "@/components/employees/shared";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { deleteRoleById, fetchRolesBundle } from "@/lib/api/employees";
import type { CoreRoleRow, RoleDefinition } from "@/lib/db";
import type { ActionCatalog } from "@/lib/role-permissions";
import { roleIsEditable } from "@/lib/role-permissions";
import { can, canOpenRoles, hasPermission, PERM_DELETE_ROLES, PERM_VIEW_ACTIONS } from "@/lib/session-scope";

type Open =
  | { kind: "core"; role: CoreRoleRow }
  | { kind: "edit"; role: RoleDefinition | null }
  | { kind: "delete"; role: RoleDefinition };

export default function RolesPage(): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const restaurantId = user?.restaurantUsername ?? "";
  const canSee = canOpenRoles(user);
  const canEdit = can(user, "manage_roles");
  const canDelete = hasPermission(user?.actions_set, PERM_DELETE_ROLES);
  const canSeeActions = hasPermission(user?.actions_set, PERM_VIEW_ACTIONS);

  const fetcher = useCallback(() => fetchRolesBundle(restaurantId, canSeeActions), [restaurantId, canSeeActions]);
  const { data, loading, error, offline, fromCache, updatedAt, retry, refresh } = useCachedFetch(
    `roles.v2:${restaurantId}:${String(canSeeActions)}`,
    fetcher,
    { enabled: restaurantId !== "" && canSee },
  );
  const [open, setOpen] = useState<Open | null>(null);

  const catalog = useMemo<ActionCatalog>(() => {
    const m: Record<string, { name: string; desc: string | null; group: string | null }> = {};
    for (const g of data?.actions ?? []) {
      for (const a of g.actions) { m[a.id] = { name: a.name, desc: a.desc ?? null, group: g.group }; }
    }
    return m;
  }, [data]);

  const coreByName = useMemo(() => {
    const m = new Map<string, CoreRoleRow>();
    for (const c of data?.core ?? []) { m.set(c.role.toLowerCase(), c); }
    return m;
  }, [data]);

  if (!user || !canSee) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">You do not have permission to view this page.</p>
        <p className="mt-1">Viewing roles needs the “View Roles” permission.</p>
      </div>
    );
  }

  const doDelete = (role: RoleDefinition): void => {
    void (async () => {
      try {
        await deleteRoleById(restaurantId, role.id);
      } catch (e) {
        toast({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
      }
      refresh();
    })();
  };

  let body: JSX.Element;
  if (loading) {
    body = <SkeletonRows rows={6} />;
  } else if (error || !data) {
    body = <LoadErrorState whatFailed="Couldn't load the roles." error={error} onRetry={retry} />;
  } else {
    const roles = data.roles;
    body = (
      <div className="grid gap-10">
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "Custom roles are built from permissions and can be assigned to staff (tap an employee in the Employees tab)."
            : "Custom roles are built from permissions. You can see what each one grants; changing them needs the role-editing permission."}
        </p>

        <section>
          <SectionHeader title="Core roles" />
          <p className="mb-2.5 text-xs text-muted-foreground">
            {coreByName.size === 0
              ? "Built in and always available. Their permissions are set by the system."
              : "Built in and always available — tap one to see exactly what it grants."}
          </p>
          <div className="flex flex-wrap gap-2">
            {CORE_ROLES.map((r) => {
              const row = coreByName.get(r);
              const chip = <StatusChip color={roleColor(r)} label={r === "admin" ? "admin (owner-grantable)" : r} />;
              return row ? (
                <button
                  key={r}
                  type="button"
                  aria-label={`View what the ${r} role can do`}
                  className="rounded-full transition-transform duration-fast hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => { setOpen({ kind: "core", role: row }); }}
                >
                  {chip}
                </button>
              ) : (
                <span key={r}>{chip}</span>
              );
            })}
          </div>
        </section>

        <section>
          <SectionHeader title="Custom roles" count={roles.length} />
          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom roles yet — create one with the button below.</p>
          ) : (
            <div className="grid gap-2.5">
              {roles.map((role) => {
                const count = Array.isArray(role.actions_performable) ? role.actions_performable.length : 0;
                const mayEdit = canEdit && roleIsEditable(role) !== false;
                const c = roleColor(role.role_name);
                return (
                  <ForkCard
                    key={role.id}
                    className="px-4 py-3"
                    chevron={false}
                    onClick={() => { setOpen({ kind: "edit", role }); }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px]"
                        style={{ background: `color-mix(in srgb, ${c} 14%, transparent)` }}
                      >
                        <Shield className="h-[18px] w-[18px]" style={{ color: c }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{role.role_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {count} permission(s) · tap to {mayEdit ? "edit" : "view"}
                        </div>
                      </div>
                      {canDelete && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete role"
                          title="Delete role"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setOpen({ kind: "delete", role }); }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </ForkCard>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  const onOpenChange = (o: boolean): void => { if (!o) { setOpen(null); } };

  return (
    <div className="relative mx-auto w-full max-w-[760px] pb-24">
      {body}
      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />
      {canEdit && (
        <Button
          size="lg"
          onClick={() => { setOpen({ kind: "edit", role: null }); }}
          className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-5 shadow-card-hover"
        >
          <ShieldPlus /> New role
        </Button>
      )}
      {open?.kind === "core" && <CoreRoleDialog role={open.role} catalog={catalog} onOpenChange={onOpenChange} />}
      {open?.kind === "edit" && (
        <RoleEditorDialog
          restaurantId={restaurantId}
          existing={open.role}
          readOnly={open.role != null && !(canEdit && roleIsEditable(open.role) !== false)}
          actions={data?.actions ?? []}
          catalog={catalog}
          onSaved={() => { setOpen(null); refresh(); }}
          onOpenChange={onOpenChange}
        />
      )}
      <ConfirmDialog
        open={open?.kind === "delete"}
        title="Delete role"
        body={open?.kind === "delete" ? `Delete the "${open.role.role_name}" role?` : ""}
        confirmLabel="Delete"
        onConfirm={() => {
          if (open?.kind === "delete") { doDelete(open.role); }
          setOpen(null);
        }}
        onOpenChange={onOpenChange}
      />
    </div>
  );
}
