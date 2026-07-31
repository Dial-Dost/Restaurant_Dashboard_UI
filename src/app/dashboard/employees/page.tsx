"use client";

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
  PasswordResetRequest} from "@/lib/db";
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

function EmployeesPageInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const hasShownAccessToastRef = useRef(false);

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
  const [coreRoles, setCoreRoles] = useState<{ role: string; actions: string[] }[]>([]);
  const [selectedCoreRoleToView, setSelectedCoreRoleToView] = useState<{ role: string; actions: string[] } | null>(null);
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

  const actionInfoMap = useMemo(() => {
    const m: Record<string, { name: string; desc?: string | null }> = {};
    for (const g of accessCatalog) {
      for (const a of g.actions) {
        m[a.id] = { name: a.name, desc: a.desc ?? null };
      }
    }
    return m;
  }, [accessCatalog]);

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

    (async () => {
      try {
        const [employeesData, rolesData] = await Promise.all([
          getRestaurantUsers(user.restaurantUsername, user.employeeId),
          getRoles(user.restaurantUsername),
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

      try {
        const cores = await getCoreRoles(user.restaurantUsername, user.actions_set);
        if (!isActive) {return;}
        setCoreRoles(Array.isArray(cores) ? cores : []);
      } catch (err) {
        console.error('fetch_core_roles_failed', err);
        if (isActive) {setCoreRoles([]);}
      }

      try {
        const catalog = await getActions(user.restaurantUsername, user.actions_set);
        if (!isActive) {return;}
        setAccessCatalog(Array.isArray(catalog) ? catalog : []);
      } catch (err) {
        console.error('fetch_actions_failed', err);
        if (isActive) {setAccessCatalog([]);}
      }

      try {
        const reqs = await getPasswordRequests(user.restaurantUsername);
        if (!isActive) {return;}
        setPasswordRequests(Array.isArray(reqs) ? reqs : []);
      } catch (err) {
        console.error('fetch_password_requests_failed', err);
        if (isActive) {setPasswordRequests([]);}
      }
    })();

    return () => { isActive = false; };
  }, [user?.restaurantUsername, user?.employeeId, user?.actions_set]);

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

  const openViewCoreRole = (role: { role: string; actions: string[] }) => {
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
    if (!user || user.role === "admin" || hasShownAccessToastRef.current) {
      return;
    }

    toast({
      title: "Access denied",
      description: "You do not have the required role for this page. Required role: admin.",
      variant: "destructive",
    });
    hasShownAccessToastRef.current = true;
  }, [user, toast]);

  if (user?.role !== "admin") {
    return (
      <div className="p-4">
        <p>You do not have permission to view this page. Required role: admin.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Employee List</h1>
        <Dialog open={isAddEmployeeDialogOpen} onOpenChange={setIsAddEmployeeDialogOpen}>
          <DialogTrigger asChild>
            <Button>
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

                          <DropdownMenuItem
                            onClick={() => { openResetPassword(
                              employee.employee_id,
                              `${employee.emp_Fname ?? ''}${employee.emp_Lname ? ` ${employee.emp_Lname}` : ''}`.trim() || (employee.employee_Username ?? employee.employee_id),
                            ); }}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Reset Password
                          </DropdownMenuItem>

                          {!employee.is_superadmin ? (
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

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Role Access Control</CardTitle>
            <CardDescription>
              Create custom roles and configure detailed access for each area. Core roles (admin, employee, valet) are protected.
            </CardDescription>
          </div>
          <Dialog open={isCreateRoleDialogOpen} onOpenChange={setIsCreateRoleDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Create Custom Role</Button>
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
                <DialogTitle>Edit Role</DialogTitle>
                <DialogDescription>
                  Modify the actions linked to this role.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label>Role Name</Label>
                  <Input value={selectedRoleToEdit?.role_name ?? ''} readOnly />
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
                            const checked = editRoleActions.includes(action.id);
                            return (
                              <label key={action.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                                <input
                                  type="checkbox"
                                  checked={checked}
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
                <Button onClick={() => void handleSaveRoleChanges()}>Save Changes</Button>
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
                {selectedCoreRoleToView?.actions?.length ? (
                  <div className="grid gap-2">
                    {selectedCoreRoleToView.actions.map((aid) => (
                      <div key={aid} className="text-sm" title={aid === '*' ? 'All actions' : actionInfoMap[aid]?.desc ?? ''}>
                        {aid === '*' ? 'All actions' : actionInfoMap[aid]?.name ?? aid}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No actions configured for this core role.</p>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => { setIsViewCoreRoleDialogOpen(false); }}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {coreRoles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No core roles available</p>
              ) : (
                coreRoles.map((r) => (
                  <Button key={`core-${r.role}`} variant="ghost" size="sm" onClick={() => { openViewCoreRole(r); }}>
                    {toTitleCase(r.role)} (core)
                  </Button>
                ))
              )}
            </div>

            {roleDefinitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom roles created yet.</p>
            ) : (
              <div className="space-y-2">
                {roleDefinitions.map((role) => (
                      <div key={role.id} className="flex items-center justify-between rounded-md border p-2">
                        <button type="button" onClick={() => { openEditRole(role); }} className="text-left">
                          <p className="font-medium">{toTitleCase(role.role_name)}</p>
                          <p className="text-xs text-muted-foreground break-words">
                            {(Array.isArray(role.actions_performable) && role.actions_performable.length > 0)
                              ? role.actions_performable.map((id) => actionInfoMap[id]?.name ?? id).join(', ')
                              : 'No actions configured'}
                          </p>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void handleDeleteCustomRole(role)}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
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
