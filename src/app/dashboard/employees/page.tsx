"use client";

import type { JSX } from "react";
import { Suspense, useMemo, useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, PlusCircle, Trash2, Crown, KeyRound, LockKeyhole } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { isOptionalMobile10, MOBILE_10_ERROR, normalizeMobile10, PHONE_INPUT_PROPS, sanitizePhoneInput } from "@/lib/phone";
import { addEmployeeToRestaurant, removeEmployeeFromRestaurant } from "@/services/authService";
import type {
  User,
  RoleDefinition,
  CoreRoleRow,
  PasswordResetRequest} from "@/lib/db";
import {
  UNKNOWN_PERMISSION_LABEL,
  permissionSummary,
  renderRolePermissions,
  roleIsEditable,
  unresolvedCount,
  type ActionCatalog,
  type RoleLike,
} from "@/lib/role-permissions";
import {
  getRestaurantUsers,
  getRoles,
  getActions,
  getCoreRoles,
  createRole,
  deleteRole,
  assignRoleToEmployee,
  removeRoleFromEmployee,
  setUserPassword,
  getPasswordRequests,
  dismissPasswordRequest,
} from "@/lib/db";
import{ toTitleCase } from "@/lib/utils";
import {
  can,
  canOpenEmployeesPage,
  canOpenRoles,
  hasPermission,
  PERM_ADD_EMPLOYEE,
  PERM_ASSIGN_ROLE,
  PERM_DELETE_ROLES,
  PERM_PASSWORDS,
  PERM_REMOVE_EMPLOYEE,
  PERM_REMOVE_ROLE,
  PERM_VIEW_ACTIONS,
  PERM_VIEW_EMPLOYEES,
} from "@/lib/session-scope";

// core roles are loaded from server

// Actions catalog is fetched from backend into `accessCatalog` state.

const addEmployeeSchema = z.object({
  name: z.string().min(1, "Name is required."),
  username: z.string().min(1, "Username is required."),
  // Allow empty string or undefined, but validate non-empty values as email
  email: z
    .string()
    .trim()
    .optional()
    .refine((val) => {
      if (!val) {return true;}
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    }, { message: "Invalid email" }),
  // Optional, but anything typed must be exactly 10 digits — POST
  // /restaurant/users applies the same optional-field rule server-side.
  phone: z.string().optional().refine(isOptionalMobile10, { message: MOBILE_10_ERROR }),
  address: z.string().optional(),
  // Any built-in role name OR a custom role's uuid. The old z.enum only allowed
  // employee/admin/valet, so choosing Cashier/Captain/Manager failed validation
  // and a CUSTOM role could not be picked at all. The server validates the value
  // (an unknown role is rejected there), so a non-empty string is right here.
  role: z.string().min(1, "Pick a role"),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

type AddEmployeeFormData = z.infer<typeof addEmployeeSchema>;

/**
 * WHAT A ROLE GRANTS, READABLE — C6.
 *
 * ONE renderer for both kinds of role, because "what does this grant" is one
 * question and answering it twice is how a core role and a custom role start
 * disagreeing about the same permission id.
 *
 * IT DRAWS EVERY ID THE ROLE CARRIES. An id the server could not name is still a
 * permission the role GRANTS: it keeps its place, says so, and prints its id.
 * Dropping it — or shortening the list to the rows that resolved — would let
 * somebody open a role, count the lines and conclude it grants less than it
 * does, which on an access-control screen is the failure worth fearing. It is
 * not an ugly row that is dangerous, it is a safe-looking one.
 *
 * The names come from the server's `permissions` projection and need NO second
 * read; `renderRolePermissions` only falls back to the /actions catalogue for a
 * backend older than the projection. That is the whole of C6: this dialog used
 * to render uuids for anybody holding View Roles without View Actions.
 */
function PermissionList({
  role,
  catalog,
  emptyLabel,
}: {
  role: RoleLike | null | undefined;
  catalog: ActionCatalog;
  emptyLabel: string;
}): JSX.Element {
  const rows = renderRolePermissions(role, catalog);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const unnamed = unresolvedCount(rows);
  return (
    <div className="grid gap-2">
      {rows.map((row, index) => (
        <div key={`${row.id}-${String(index)}`} className="text-sm" title={row.desc ?? row.id}>
          {row.resolved ? (
            <>
              <span>{row.name}</span>
              {row.group ? (
                <span className="ml-2 text-xs text-muted-foreground">{row.group}</span>
              ) : null}
            </>
          ) : (
            <>
              <span className="text-muted-foreground">{UNKNOWN_PERMISSION_LABEL}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground break-all">{row.id}</span>
            </>
          )}
        </div>
      ))}
      {unnamed > 0 ? (
        // Said out loud, because the alternative reading of an unnamed row is
        // "this screen is broken" and the true one is "this role grants
        // something whose catalogue entry is missing" — a real answer, and one
        // an admin can act on.
        <p className="pt-1 text-xs text-muted-foreground">
          {unnamed} of these {unnamed === 1 ? 'is' : 'are'} granted by id with no matching entry in the
          permissions catalogue. {unnamed === 1 ? 'It is' : 'They are'} still granted.
        </p>
      ) : null}
    </div>
  );
}

function EmployeesPageInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const hasShownAccessToastRef = useRef(false);

  /*
    C5 + C6 — WHAT THIS SCREEN OFFERS IS DECIDED BY THE SERVER'S RESOLVED ACTION
    SET, NOT BY THE NAME OF A ROLE.

    THE C6 DEFECT, WHICH TURNED OUT NOT TO BE THE CORE-ROLE DIALOG AT ALL. The
    dialog, the fetch and the click handler were all present and correct. What
    stopped "users clicking and viewing core roles" was the gate above them:

        if (user?.role !== "admin") { return <p>You do not have permission…</p> }

    `user.role` is the PRIMARY role from the session, and the backend's
    `parseEmployeeRoles` rewrites a primary it does not recognise — a custom
    role's UUID, or an employee record whose primary was never set — to the
    literal string "employee" (database_supabase.ts, `toRole` does the same).
    So a genuine Super Admin who had also been given one custom role arrived
    here as `role: "employee"`, was refused the entire page, and never reached a
    core role to click. It is the same defect family as the waiter scoping that
    just landed: a decision taken on the SPELLING of a role rather than on
    authority, taken in the client, where the answer is a guess.

    AND C5's OTHER HALF. "Super Admins and Managers can view and edit custom
    roles" cannot be expressed as `role === "admin"` at all. It is expressed as
    the permission the route itself demands: GET /roles and GET /core-roles are
    gated on "View Roles", POST /roles on "Create Role", and so on. Asking
    `actions_set` means an admin is admitted by the "*" wildcard however their
    primary role was recorded, and a manager is admitted exactly when the tenant
    has granted them the permission — which is what "customizable" means.

    THE HIDING IS THE COURTESY, NOT THE CONTROL. Every one of these ids is the
    backend's own `validateAction` argument; a control hidden here is a control
    whose route already refuses, so a deep link or a stale tab gains nothing.
  */
  const actions = user?.actions_set;
  const canSeeEmployees = hasPermission(actions, PERM_VIEW_EMPLOYEES);
  const canAddEmployee = hasPermission(actions, PERM_ADD_EMPLOYEE);
  const canRemoveEmployee = hasPermission(actions, PERM_REMOVE_EMPLOYEE);
  const canManagePasswords = hasPermission(actions, PERM_PASSWORDS);
  const canSeeRoles = canOpenRoles(user);
  const canEditRoles = can(user, "manage_roles");
  const canDeleteRoles = hasPermission(actions, PERM_DELETE_ROLES);
  const canAssignRoles = hasPermission(actions, PERM_ASSIGN_ROLE);
  const canRemoveRoles = hasPermission(actions, PERM_REMOVE_ROLE);
  const canSeeActionCatalog = hasPermission(actions, PERM_VIEW_ACTIONS);
  const canOpenPage = canOpenEmployeesPage(user);

  const [employees, setEmployees] = useState<User[]>([]);
  const [roleDefinitions, setRoleDefinitions] = useState<RoleDefinition[]>([]);
  // An employee-related notification links here as ?highlightEmployee=<id>.
  const highlight = useHighlightRow("highlightEmployee", employees.length);

  const [isAddEmployeeDialogOpen, setIsAddEmployeeDialogOpen] = useState(false);
  const [isCreateRoleDialogOpen, setIsCreateRoleDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleActions, setNewRoleActions] = useState<string[]>([]);

  const [accessCatalog, setAccessCatalog] = useState<
    { group: string; actions: { id: string; name: string; desc?: string | null }[] }[]
  >([]);
  const [selectedRoleToEdit, setSelectedRoleToEdit] = useState<RoleDefinition | null>(null);
  const [isEditRoleDialogOpen, setIsEditRoleDialogOpen] = useState(false);
  const [editRoleActions, setEditRoleActions] = useState<string[]>([]);
  const [coreRoles, setCoreRoles] = useState<CoreRoleRow[]>([]);
  const [selectedCoreRoleToView, setSelectedCoreRoleToView] = useState<CoreRoleRow | null>(null);
  const [isViewCoreRoleDialogOpen, setIsViewCoreRoleDialogOpen] = useState(false);

  const [passwordRequests, setPasswordRequests] = useState<PasswordResetRequest[]>([]);
  const [resetTarget, setResetTarget] = useState<{ employeeId: string; label: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  const allAssignableRoles = useMemo(() => {
    // Represent custom roles by their IDs (so assignment stores IDs). Core roles remain names.
    const custom = roleDefinitions.map((role) => role.id).filter(Boolean);
    const cores = coreRoles.map((c) => (typeof c.role === 'string' ? c.role.trim().toLowerCase() : '')).filter(Boolean);
    return Array.from(new Set([...cores, ...custom]));
  }, [roleDefinitions, coreRoles]);

  /*
    THE /actions CATALOGUE — NOW A FALLBACK, NOT THE RENDERING STRATEGY.

    C6's symptom was a role that opened to a column of raw UUIDs, and the reason
    was here: to put a NAME on an id this screen had to join it against GET
    /actions, which carries its OWN permission (2b6f7948…), different from the one
    that opens this screen (17ba6407…). The stock core `manager` holds both; a
    tenant's custom "shift lead" granted View Roles and not View Actions holds
    one, opens a role, and is shown uuids. A join across two differently-
    permissioned reads is not a rendering strategy, it is a coin flip on how the
    tenant configured their roles.

    /core-roles and /roles now project `permissions` — the same ids, same order,
    same length, with name, description and group attached — exactly so this join
    is no longer needed. `src/lib/role-permissions.ts` reads that projection and
    falls back to this map ONLY for a backend older than it, which is why the map
    survives at all. The checkbox grids below still need the full catalogue,
    because offering a permission to GRANT is a different question from naming
    one a role already holds.
  */
  const actionCatalog = useMemo<ActionCatalog>(() => {
    const m: Record<string, { name: string; desc: string | null; group: string | null }> = {};
    for (const g of accessCatalog) {
      for (const a of g.actions) {
        m[a.id] = { name: a.name, desc: a.desc ?? null, group: g.group };
      }
    }
    return m;
  }, [accessCatalog]);

  /*
    MAY THE ROLE CURRENTLY OPEN BE WRITTEN?

    TWO questions, and both are the server's. `manage_roles` is whether this
    SESSION may edit roles at all. `editable` is whether THIS ROLE has a write
    route behind it — /roles projects it precisely so a client stops re-deriving
    "is this name one of the core roles" by matching strings, which is the same
    spelling-versus-authority mistake that un-scoped a waiter in production.

    `!== false` and not `=== true`: a backend that does not send the flag leaves
    the answer undefined, and the screen must then behave exactly as it did
    before the flag existed rather than locking every role.
  */
  const editingRoleWritable = canEditRoles && roleIsEditable(selectedRoleToEdit) !== false;

  const roleIdToName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roleDefinitions) {
      if (r.id) {m[r.id] = r.role_name;}
    }
    return m;
  }, [roleDefinitions]);

  function isUuid(val?: string) {
    return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
  }

  const fetchEmployees = async () => {
    if (!user?.restaurantUsername || !user.employeeId) {return;}
    try {
      const data = await getRestaurantUsers(user.restaurantUsername, user.employeeId);
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("fetch_employees_failed", error);
      setEmployees([]);
    }
  };

  const fetchRoles = async () => {
    if (!user?.restaurantUsername) {return;}
    try {
      const data = await getRoles(user.restaurantUsername);
      setRoleDefinitions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("fetch_roles_failed", error);
      setRoleDefinitions([]);
    }
  };

  const fetchPasswordRequests = async () => {
    if (!user?.restaurantUsername) {return;}
    try {
      setPasswordRequests(await getPasswordRequests(user.restaurantUsername));
    } catch (error) {
      console.error("fetch_password_requests_failed", error);
      setPasswordRequests([]);
    }
  };

  const openResetPassword = (employeeId: string, label: string) => {
    setResetTarget({ employeeId, label });
    setNewPassword("");
    setIsResetDialogOpen(true);
  };

  const handleResetPassword = async () => {
    if (!user?.restaurantUsername || !resetTarget) {return;}
    if (newPassword.trim().length < 4) {
      toast({ title: "Password too short", description: "Use at least 4 characters.", variant: "destructive" });
      return;
    }
    try {
      await setUserPassword(user.restaurantUsername, resetTarget.employeeId, newPassword.trim());
      setIsResetDialogOpen(false);
      setResetTarget(null);
      setNewPassword("");
      await fetchPasswordRequests();
      toast({ title: "Password updated", description: "The new password is active immediately." });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message ?? "Unable to set password", variant: "destructive" });
    }
  };

  const handleDismissRequest = async (requestId: string) => {
    if (!user?.restaurantUsername) {return;}
    await dismissPasswordRequest(user.restaurantUsername, requestId);
    await fetchPasswordRequests();
  };

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}

    let isActive = true;

    /*
      EACH READ IS ASKED FOR ONLY BY A SESSION THE ROUTE WILL ANSWER.

      Every one of these four endpoints carries its own permission, and firing
      all four regardless meant a manager holding one half of this screen
      collected three 403s on every mount — noise in the logs, and a console full
      of failures that look like a broken page rather than a deliberate one.

      A failure still degrades to empty rather than to a crash: `getCoreRoles`
      and friends are 'use server' actions, and a throw there arrives as an
      opaque redacted error, so the catch stays.
    */
    (async () => {
      try {
        const [employeesData, rolesData] = await Promise.all([
          canSeeEmployees ? getRestaurantUsers(user.restaurantUsername, user.employeeId) : Promise.resolve([]),
          canSeeRoles ? getRoles(user.restaurantUsername) : Promise.resolve([]),
        ]);
        if (!isActive) {return;}
        setEmployees(Array.isArray(employeesData) ? employeesData : []);
        setRoleDefinitions(Array.isArray(rolesData) ? rolesData : []);
      } catch (err) {
        console.error('fetch_employees_or_roles_failed', err);
        if (isActive) {
          setEmployees([]);
          setRoleDefinitions([]);
        }
      }

      if (canSeeRoles) {
        try {
          // `actions_set` may be undefined on a session stored before it existed;
          // getCoreRoles joins it into a header, and an undefined there throws
          // ACROSS the server-action boundary, which lands in the catch below and
          // renders as "No core roles available" — a page that looks broken for a
          // reason that has nothing to do with roles.
          const cores = await getCoreRoles(user.restaurantUsername, actions ?? []);
          if (!isActive) {return;}
          setCoreRoles(Array.isArray(cores) ? cores : []);
        } catch (err) {
          console.error('fetch_core_roles_failed', err);
          if (isActive) {setCoreRoles([]);}
        }
      }

      if (canSeeActionCatalog) {
        try {
          const catalog = await getActions(user.restaurantUsername, actions ?? []);
          if (!isActive) {return;}
          setAccessCatalog(Array.isArray(catalog) ? catalog : []);
        } catch (err) {
          console.error('fetch_actions_failed', err);
          if (isActive) {setAccessCatalog([]);}
        }
      }

      if (canManagePasswords) {
        try {
          const reqs = await getPasswordRequests(user.restaurantUsername);
          if (!isActive) {return;}
          setPasswordRequests(Array.isArray(reqs) ? reqs : []);
        } catch (err) {
          console.error('fetch_password_requests_failed', err);
          if (isActive) {setPasswordRequests([]);}
        }
      }
    })();

    return () => { isActive = false; };
  }, [user?.restaurantUsername, user?.employeeId, actions,
      canSeeEmployees, canSeeRoles, canSeeActionCatalog, canManagePasswords]);

  const handleAddEmployee = async (data: AddEmployeeFormData) => {
    if (!user) {return;}
    try {
      // split full name into first + last
      const parts = (data.name || '').trim().replace(/\s+/g, ' ').split(' ');
      const first = parts.shift() ?? '';
      const last = parts.join(' ') || null;

      const payload = {
        emp_Fname: first,
        emp_Lname: last,
        employeeId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2,8),
        username: data.username,
        email: data.email?.trim() ? data.email.trim() : null,
        // Blank stays blank; a typed number is stored as bare 10 digits.
        ph: data.phone?.trim() ? normalizeMobile10(data.phone) : null,
        add: data.address ?? null,
        role: data.role,
        password: data.password,
      } as any;

      await addEmployeeToRestaurant(user.restaurantUsername, user.outlet_id, payload, user.employeeId);
      await fetchEmployees();
      toast({
        title: "Employee Added",
        description: `${data.name} has been added to the system.`,
      });
      setIsAddEmployeeDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message ?? "Unable to add employee",
        variant: "destructive",
      });
    }
  };

  const handleRemoveEmployee = async (employeeId: string) => {
    if (!user) {return;}
    try {
      await removeEmployeeFromRestaurant(user.restaurantUsername, employeeId, user.res_id, user.employeeId, user.outlet_id);
      await fetchEmployees();
      toast({
        title: "Employee Removed",
        description: "The employee has been removed from the system.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message ?? "Unable to remove employee",
        variant: "destructive",
      });
    }
  };

  const handleAssignRole = async (employeeId: string, roleName: string) => {
    if (!user?.restaurantUsername) {return;}
    const ok = await assignRoleToEmployee(user.restaurantUsername, employeeId, roleName);
    if (!ok) {
      toast({ title: "Error", description: "Unable to assign role.", variant: "destructive" });
      return;
    }

    await fetchEmployees();
    toast({ title: "Role Assigned", description: `Assigned ${roleName} to ${employeeId}.` });
  };

  const handleRemoveRole = async (employee: User, roleName: string) => {
    if (!user?.restaurantUsername) {return;}
    const normalized = roleName.trim().toLowerCase();
    if (normalized === employee.role) {
      toast({
        title: "Protected Role",
        description: "Cannot remove an employee's primary role.",
        variant: "destructive",
      });
      return;
    }

    const ok = await removeRoleFromEmployee(user.restaurantUsername, employee.employee_id, normalized);
    if (!ok) {
      toast({ title: "Error", description: "Unable to remove role.", variant: "destructive" });
      return;
    }

    await fetchEmployees();
    toast({ title: "Role Removed", description: `Removed ${normalized} from ${employee.employee_id}.` });
  };

  const toggleNewRoleAction = (action: string) => {
    setNewRoleActions((prev) =>
      prev.includes(action) ? prev.filter((entry) => entry !== action) : [...prev, action],
    );
  };

  const toggleEditRoleAction = (action: string) => {
    setEditRoleActions((prev) => (prev.includes(action) ? prev.filter((entry) => entry !== action) : [...prev, action]));
  };

  const openEditRole = (role: RoleDefinition) => {
    setSelectedRoleToEdit(role);
    setEditRoleActions(Array.isArray(role.actions_performable) ? role.actions_performable.slice() : []);
    setIsEditRoleDialogOpen(true);
  };

  const openViewCoreRole = (role: CoreRoleRow): void => {
    setSelectedCoreRoleToView(role);
    setIsViewCoreRoleDialogOpen(true);
  };

  const handleSaveRoleChanges = async () => {
    if (!user?.restaurantUsername || !selectedRoleToEdit) {return;}
    try {
      await createRole(user.restaurantUsername, selectedRoleToEdit.role_name, editRoleActions);
      await fetchRoles();
      setIsEditRoleDialogOpen(false);
      setSelectedRoleToEdit(null);
      setEditRoleActions([]);
      toast({ title: 'Role Updated', description: `Role '${selectedRoleToEdit.role_name}' updated.` });
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message ?? 'Unable to update role', variant: 'destructive' });
    }
  };

  const handleCreateCustomRole = async () => {
    if (!user?.restaurantUsername) {return;}

    const normalizedName = newRoleName.trim().toLowerCase();
    if (!normalizedName) {
      toast({ title: "Role Name Required", description: "Please provide a role name.", variant: "destructive" });
      return;
    }

    if (coreRoles.some((c) => c.role.trim().toLowerCase() === normalizedName)) {
      toast({ title: "Protected Role", description: "Core roles cannot be recreated as custom roles.", variant: "destructive" });
      return;
    }

    try {
      const created = await createRole(user.restaurantUsername, normalizedName, newRoleActions);
      if (!created) {
        toast({ title: "Error", description: "Unable to create role.", variant: "destructive" });
        return;
      }

      await fetchRoles();
    } catch (error: any) {
      toast({ title: "Error", description: error?.message ?? "Unable to create role", variant: "destructive" });
      return;
    }
    setNewRoleName("");
    setNewRoleActions([]);
    setIsCreateRoleDialogOpen(false);
    toast({ title: "Role Saved", description: `Role '${normalizedName}' has been saved with access rules.` });
  };

  const handleDeleteCustomRole = async (role: RoleDefinition) => {
    if (!user?.restaurantUsername) {return;}

    if (coreRoles.some((c) => c.role.trim().toLowerCase() === role.role_name.trim().toLowerCase())) {
      toast({ title: "Protected Role", description: "Core roles cannot be deleted.", variant: "destructive" });
      return;
    }

    const ok = await deleteRole(user.restaurantUsername, role.id);
    if (!ok) {
      toast({ title: "Error", description: "Unable to delete role.", variant: "destructive" });
      return;
    }

    await Promise.all([fetchRoles(), fetchEmployees()]);
    toast({ title: "Role Deleted", description: `Role '${role.role_name}' has been removed.` });
  };

  useEffect(() => {
    if (!user || canOpenPage || hasShownAccessToastRef.current) {
      return;
    }

    toast({
      title: "Access denied",
      description: "This page needs the “View Employees” or “View Roles” permission.",
      variant: "destructive",
    });
    hasShownAccessToastRef.current = true;
  }, [user, canOpenPage, toast]);

  /*
    The front door, and it names the PERMISSION rather than a role — see the
    block at the top of this component for why "Required role: admin" was both
    wrong and unactionable. It stays a hard stop because a deep link, a bookmark
    or a back-navigation reaches this page regardless of the nav; the routes
    behind it refuse independently, which is what makes that safe.
  */
  if (!user || !canOpenPage) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">You do not have permission to view this page.</p>
        <p className="mt-1">
          Viewing staff needs the “View Employees” permission and viewing roles needs “View Roles”.
          An admin can grant either from Role Access Control.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between max-lg:flex-wrap max-lg:gap-2">
        <h1 className="text-lg font-semibold md:text-2xl">Employee List</h1>
        {/* POST /restaurant/users carries its own permission; without it the
            dialog's Save button is the only thing that would tell you. */}
        <Dialog open={isAddEmployeeDialogOpen} onOpenChange={setIsAddEmployeeDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canAddEmployee} title={canAddEmployee ? undefined : "Adding staff needs the “Add Employee” permission"}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Employee</DialogTitle>
              <DialogDescription>Fill in the details for the new employee.</DialogDescription>
            </DialogHeader>
            <AddEmployeeForm onSubmit={handleAddEmployee} customRoles={roleDefinitions} />
          </DialogContent>
        </Dialog>
      </div>

      {passwordRequests.length > 0 ? (
        <Card className="border-amber-500/60 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockKeyhole className="h-4 w-4 text-amber-600" />
              {passwordRequests.length} password reset request{passwordRequests.length > 1 ? "s" : ""}
            </CardTitle>
            <CardDescription>Staff who can&apos;t sign in have asked you to reset their password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {passwordRequests.map((req) => (
              <div key={req.id} className="flex items-center justify-between gap-2 rounded-md border bg-background p-2">
                <div>
                  <p className="font-medium">{req.name}</p>
                  <p className="text-xs text-muted-foreground">@{req.username}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => { openResetPassword(req.employee_id, req.name); }}>
                    <KeyRound className="mr-1 h-4 w-4" /> Reset
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDismissRequest(req.id)}>Dismiss</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Set a new password for {resetTarget?.label}. They can sign in with it immediately.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); }}
              placeholder="At least 4 characters"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIsResetDialogOpen(false); }}>Cancel</Button>
            <Button onClick={() => void handleResetPassword()}>Set password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The staff half of this page. A session holding only "View Roles" — a
          manager the tenant set up to manage permissions but not people — gets
          the Role Access Control card below and nothing here, rather than an
          empty table that looks like the restaurant has no staff. */}
      {canSeeEmployees ? (
      <Card>
        <CardHeader>
          <CardTitle>All Employees</CardTitle>
          <CardDescription>A list of all employees at {user.restaurantName}.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Employee Username</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee, idx) => {
                const employeeRoles = Array.from(new Set(employee.role_all ?? [employee.role]));
                // normalizedRoles set should include raw ids and lowercase names for comparison
                const normalizedRolesSet = new Set<string>(
                  employeeRoles.map((entry) => (isUuid(entry) ? entry : entry.trim().toLowerCase())),
                );
                const assignable = allAssignableRoles.filter((entry) => !normalizedRolesSet.has(entry));
                const removable = Array.from(employeeRoles).filter((entry) => {
                  const key = isUuid(entry) ? entry : entry.trim().toLowerCase();
                  return key !== employee.role;
                });

                return (
                  <TableRow key={employee.employee_id ?? employee.employee_Username ?? `emp-${idx}`} {...highlight.rowProps(employee.employee_id)}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {`${employee.emp_Fname ?? ''}${employee.emp_Lname ? ` ${employee.emp_Lname}` : ''}`.trim() || employee.employee_id}
                        {employee.is_superadmin ? (
                          <span title="Superadmin (owner)" className="inline-flex">
                            <Crown className="h-4 w-4 text-amber-500" aria-label="Superadmin" />
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>{employee.employee_Username ?? employee.employee_id}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {employeeRoles.map((role) => {
                          const display = isUuid(role) ? (roleIdToName[role] ?? role) : role;
                          const key = `${employee.employee_id}-${role}`;
                          return (
                            <Badge key={key} variant={display === "admin" ? "default" : "secondary"}>
                              {toTitleCase(display)}
                            </Badge>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>

                          {/* Each entry below is the permission the route it calls
                              demands. A menu item that 403s is a menu item that
                              teaches staff the screen is lying to them. */}
                          {canAssignRoles ? (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Add Role</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {assignable.length === 0 ? (
                                <DropdownMenuItem disabled>No roles available</DropdownMenuItem>
                              ) : (
                                assignable.map((roleKey) => (
                                  <DropdownMenuItem
                                    key={`${employee.employee_id}-assign-${roleKey}`}
                                    onClick={() => void handleAssignRole(employee.employee_id, roleKey)}
                                  >
                                    {toTitleCase(isUuid(roleKey) ? (roleIdToName[roleKey] ?? roleKey) : roleKey)}
                                  </DropdownMenuItem>
                                ))
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          ) : null}

                          {canRemoveRoles ? (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Remove Role</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {removable.length === 0 ? (
                                <DropdownMenuItem disabled>No removable roles</DropdownMenuItem>
                              ) : (
                                removable.map((roleKey) => (
                                  <DropdownMenuItem
                                    key={`${employee.employee_id}-remove-${roleKey}`}
                                    onClick={() => void handleRemoveRole(employee, roleKey)}
                                  >
                                    {toTitleCase(isUuid(roleKey) ? (roleIdToName[roleKey] ?? roleKey) : roleKey)}
                                  </DropdownMenuItem>
                                ))
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          ) : null}

                          {canManagePasswords ? (
                          <DropdownMenuItem
                            onClick={() => { openResetPassword(
                              employee.employee_id,
                              `${employee.emp_Fname ?? ''}${employee.emp_Lname ? ` ${employee.emp_Lname}` : ''}`.trim() || (employee.employee_Username ?? employee.employee_id),
                            ); }}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Reset Password
                          </DropdownMenuItem>
                          ) : null}

                          {canRemoveEmployee && !employee.is_superadmin ? (
                            <DropdownMenuItem
                              onClick={() => void handleRemoveEmployee(employee.employee_id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove Employee
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      ) : null}

      {canSeeRoles ? (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 max-lg:flex-wrap">
          <div className="max-lg:min-w-0 max-lg:flex-[1_1_14rem]">
            <CardTitle>Role Access Control</CardTitle>
            <CardDescription>
              Create custom roles and configure detailed access for each area. Core roles (admin, employee, valet) are protected.
            </CardDescription>
          </div>
          <Dialog open={isCreateRoleDialogOpen} onOpenChange={setIsCreateRoleDialogOpen}>
            <DialogTrigger asChild>
              {/* POST /roles is what both creating and EDITING a role write, so
                  one permission governs both and the button says so rather than
                  failing after the form is filled in. */}
              <Button
                variant="outline"
                disabled={!canEditRoles}
                title={canEditRoles ? undefined : "Creating a role needs the “Create Role” permission"}
              >
                Create Custom Role
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[740px]">
              <DialogHeader>
                <DialogTitle>Create Custom Role</DialogTitle>
                <DialogDescription>
                  Choose what this role can access. This role can then be assigned to employees from the list above.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="role-name">Role Name</Label>
                  <Input
                    id="role-name"
                    value={newRoleName}
                    onChange={(event) => { setNewRoleName(event.target.value); }}
                    placeholder="e.g. floor_manager"
                  />
                </div>

                <div className="max-h-[360px] overflow-y-auto rounded-md border p-3">
                  {accessCatalog.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No actions available.</p>
                  ) : (
                    accessCatalog.map((group) => (
                      <div key={group.group} className="mb-3">
                        <p className="mb-1 text-sm font-semibold">{group.group}</p>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {group.actions.map((action) => {
                            const checked = newRoleActions.includes(action.id);
                            return (
                              <label key={action.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => { toggleNewRoleAction(action.id); }}
                                />
                                <span className="text-sm" title={action.desc ?? ''} aria-label={action.desc ?? ''}>{action.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button onClick={() => void handleCreateCustomRole()}>Save Role</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isEditRoleDialogOpen} onOpenChange={setIsEditRoleDialogOpen}>
            <DialogContent className="sm:max-w-[740px]">
              <DialogHeader>
                <DialogTitle>{editingRoleWritable ? "Edit Role" : "Role"}</DialogTitle>
                <DialogDescription>
                  {editingRoleWritable
                    ? "Modify the actions linked to this role. Saving signs out everyone holding it, so the new list actually applies."
                    : roleIsEditable(selectedRoleToEdit) === false
                      ? "What this role grants. This role is defined in the product and has no write route — a tenant that wants a different split creates a custom role."
                      : "What this role grants. Changing it needs the “Create Role” permission."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label>Role Name</Label>
                  <Input value={selectedRoleToEdit?.role_name ?? ''} readOnly />
                </div>

                <div className="max-h-[360px] overflow-y-auto rounded-md border p-3">
                  {accessCatalog.length === 0 ? (
                    /*
                      NO CATALOGUE IS NOT "NO PERMISSIONS" — C6 ON A CUSTOM ROLE.

                      The checkbox grid needs GET /actions, which carries its own
                      permission: it is the list of everything that COULD be
                      granted. An identity holding View Roles without View Actions
                      cannot have it, and this panel used to answer them with "No
                      actions available" — which reads as "this role grants
                      nothing" and is false.

                      What the role actually holds comes from the role itself now,
                      so that session sees the grant read-only instead of an empty
                      box. They still cannot re-grant it, which is correct: that
                      is what the missing permission means.
                    */
                    <>
                      <PermissionList
                        role={selectedRoleToEdit}
                        catalog={actionCatalog}
                        emptyLabel="This role grants no permissions."
                      />
                      <p className="pt-2 text-xs text-muted-foreground">
                        Shown read-only: changing which permissions a role holds needs the “View Actions”
                        permission as well, because the full list of grantable permissions is served by it.
                      </p>
                    </>
                  ) : (
                    accessCatalog.map((group) => (
                      <div key={group.group} className="mb-3">
                        <p className="mb-1 text-sm font-semibold">{group.group}</p>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {group.actions.map((action) => {
                            const checked = editRoleActions.includes(action.id);
                            return (
                              <label key={action.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!editingRoleWritable}
                                  onChange={() => { toggleEditRoleAction(action.id); }}
                                />
                                <span className="text-sm" title={action.desc ?? ''} aria-label={action.desc ?? ''}>{action.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <DialogFooter>
                {editingRoleWritable ? (
                  <Button onClick={() => void handleSaveRoleChanges()}>Save Changes</Button>
                ) : (
                  <Button variant="outline" onClick={() => { setIsEditRoleDialogOpen(false); }}>Close</Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isViewCoreRoleDialogOpen} onOpenChange={setIsViewCoreRoleDialogOpen}>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Core Role: {selectedCoreRoleToView?.role}</DialogTitle>
                <DialogDescription>Actions granted to this core role.</DialogDescription>
              </DialogHeader>
              <div className="p-3">
                <PermissionList
                  role={selectedCoreRoleToView}
                  catalog={actionCatalog}
                  emptyLabel="No actions configured for this core role."
                />
              </div>
              <DialogFooter>
                <Button onClick={() => { setIsViewCoreRoleDialogOpen(false); }}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          <div className="space-y-3">
            {/* C6 — THE CORE ROLES, CLICKABLE. Each opens a read-only view of
                exactly what that role grants. The roles themselves are the
                backend's `CORE_ROLES` table and are not editable from anywhere;
                a tenant that wants a different split creates a custom role, which
                is what the list underneath is for. */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Core roles — click one to see what it grants
              </p>
              <div className="flex flex-wrap gap-2">
                {coreRoles.length === 0 ? (
                  // Says WHICH of the two it is. "No core roles available" was
                  // shown both when the read was refused and when it failed, and
                  // an owner looking at it had no way to tell a permissions
                  // problem from an outage.
                  <p className="text-sm text-muted-foreground">
                    Core roles could not be loaded. They are served by GET /core-roles, which needs the
                    “View Roles” permission — if you hold it, the backend is unreachable right now.
                  </p>
                ) : (
                  coreRoles.map((r) => (
                    <Button key={`core-${r.role}`} variant="outline" size="sm" onClick={() => { openViewCoreRole(r); }}>
                      {toTitleCase(r.role)} (core)
                    </Button>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Custom roles
              </p>
              {roleDefinitions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom roles created yet.</p>
              ) : (
                <div className="space-y-2">
                  {roleDefinitions.map((role) => (
                      <div key={role.id} className="flex items-center justify-between rounded-md border p-2">
                        {/* Clickable whether or not you may SAVE: a manager who can
                            see the roles but not change them still needs to be able
                            to look at what one grants, which is the same thing C6
                            asks for on the core roles. The dialog turns itself
                            read-only rather than disappearing. */}
                        <button type="button" onClick={() => { openEditRole(role); }} className="text-left">
                          <p className="font-medium">{toTitleCase(role.role_name)}</p>
                          {/* NAMES, FROM THE SERVER'S OWN PROJECTION — and the
                              ids it could not name are still COUNTED into this
                              line rather than quietly dropped from it. A summary
                              that is shorter than the grant is how a reviewer
                              decides a role is safe when it is not. */}
                          <p className="text-xs text-muted-foreground break-words">
                            {permissionSummary(renderRolePermissions(role, actionCatalog)) || 'No actions configured'}
                          </p>
                        </button>
                        {canDeleteRoles ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => void handleDeleteCustomRole(role)}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}

function AddEmployeeForm({ onSubmit, customRoles = [] }: { onSubmit: (data: AddEmployeeFormData) => void; customRoles?: RoleDefinition[] }) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<AddEmployeeFormData>({
    resolver: zodResolver(addEmployeeSchema),
  });

  const handleFormSubmit = (data: AddEmployeeFormData) => {
    onSubmit(data);
    reset();
  };

  // Keeps the phone field at 10 bare digits as it is typed or pasted.
  const phoneField = register("phone");

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="name" className="text-right">
          Full Name
        </Label>
        <div className="col-span-3">
          <Input id="name" {...register("name")} placeholder="e.g., John Doe" />
          {errors.name ? <p className="mt-1 text-sm text-destructive">{errors.name.message}</p> : null}
        </div>
      </div>

      

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="username" className="text-right">Username</Label>
        <div className="col-span-3">
          <Input id="username" {...register("username")} placeholder="e.g., jdoe" />
          {errors.username ? <p className="mt-1 text-sm text-destructive">{errors.username.message}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="email" className="text-right">Email</Label>
        <div className="col-span-3">
          <Input id="email" {...register("email")} placeholder="e.g., jdoe@example.com" />
          {errors.email ? <p className="mt-1 text-sm text-destructive">{errors.email.message}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="phone" className="text-right">Phone</Label>
        <div className="col-span-3">
          <Input
            id="phone"
            type="tel"
            {...PHONE_INPUT_PROPS}
            {...phoneField}
            onChange={(e) => { e.target.value = sanitizePhoneInput(e.target.value); void phoneField.onChange(e); }}
            placeholder="10-digit mobile (optional)"
          />
          {errors.phone ? <p className="mt-1 text-sm text-destructive">{errors.phone.message}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="address" className="text-right">Address</Label>
        <div className="col-span-3">
          <Input id="address" {...register("address")} placeholder="Optional address" />
          {errors.address ? <p className="mt-1 text-sm text-destructive">{errors.address.message}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="role" className="text-right">
          Role
        </Label>
        <div className="col-span-3">
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="valet">Valet</SelectItem>
                  <SelectItem value="cashier">Cashier</SelectItem>
                  <SelectItem value="captain">Captain</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  {/* Custom roles from Roles & Permissions — assigned by uuid, which
                      the backend resolves against "Roles". Without these a custom
                      role could only be granted AFTER the user was created. */}
                  {customRoles
                    .filter((r) => r.id && r.role_name)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.role_name} (custom)</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.role ? <p className="mt-1 text-sm text-destructive">{errors.role.message}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="password" className="text-right">
          Password
        </Label>
        <div className="col-span-3">
          <Input id="password" type="password" {...register("password")} />
          {errors.password ? <p className="mt-1 text-sm text-destructive">{errors.password.message}</p> : null}
        </div>
      </div>

      <DialogFooter>
        <Button type="submit">Save Employee</Button>
      </DialogFooter>
    </form>
  );
}

// useSearchParams (via useHighlightRow) requires a Suspense boundary
// (same pattern as the accounting and queue pages).
export default function EmployeesPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading…</div>}>
      <EmployeesPageInner />
    </Suspense>
  );
}
