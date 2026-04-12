"use client";

import { useMemo, useState, useEffect } from "react";
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
import { MoreHorizontal, PlusCircle, Trash2 } from "lucide-react";
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
import { addEmployeeToRestaurant, removeEmployeeFromRestaurant } from "@/services/authService";
import {
  User,
  RoleDefinition,
  getRestaurantUsers,
  getRoles,
  createRole,
  deleteRole,
  assignRoleToEmployee,
  removeRoleFromEmployee,
} from "@/lib/db";

const CORE_ROLES = ["admin", "employee", "valet"] as const;

const ACCESS_CATALOG: Array<{ group: string; actions: string[] }> = [
  {
    group: "Dashboard",
    actions: ["dashboard.view", "dashboard.analytics.view"],
  },
  {
    group: "Bookings",
    actions: ["bookings.view", "bookings.create", "bookings.edit", "bookings.cancel", "bookings.assign_table"],
  },
  {
    group: "Customers",
    actions: ["customers.view", "customers.create", "customers.edit"],
  },
  {
    group: "Tables",
    actions: ["tables.view", "tables.create", "tables.edit", "tables.delete", "tables.assign_employee"],
  },
  {
    group: "Orders",
    actions: ["orders.view", "orders.create", "orders.edit", "orders.status.update", "orders.apc.view"],
  },
  {
    group: "Menu",
    actions: ["menu.view", "menu.create", "menu.edit", "menu.delete"],
  },
  {
    group: "Inventory",
    actions: ["inventory.view", "inventory.create", "inventory.edit", "inventory.delete"],
  },
  {
    group: "Valet",
    actions: ["valet.view", "valet.create", "valet.edit", "valet.bays.manage"],
  },
  {
    group: "Feedback",
    actions: ["feedback.view", "feedback.summary.view", "feedback.stats.view"],
  },
  {
    group: "Employees & Roles",
    actions: ["employees.view", "employees.create", "employees.remove", "roles.create", "roles.delete", "roles.assign", "roles.remove"],
  },
  {
    group: "System",
    actions: ["settings.view", "settings.edit", "audit_logs.view"],
  },
];

const addEmployeeSchema = z.object({
  name: z.string().min(1, "Name is required."),
  employeeId: z.string().min(1, "Employee ID is required."),
  role: z.enum(["employee", "admin", "valet"]),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

type AddEmployeeFormData = z.infer<typeof addEmployeeSchema>;

export default function EmployeesPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [employees, setEmployees] = useState<User[]>([]);
  const [roleDefinitions, setRoleDefinitions] = useState<RoleDefinition[]>([]);

  const [isAddEmployeeDialogOpen, setIsAddEmployeeDialogOpen] = useState(false);
  const [isCreateRoleDialogOpen, setIsCreateRoleDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleActions, setNewRoleActions] = useState<string[]>([]);

  const allAssignableRoles = useMemo(() => {
    const custom = roleDefinitions.map((role) => role.role_name.trim().toLowerCase()).filter(Boolean);
    return Array.from(new Set([...CORE_ROLES, ...custom]));
  }, [roleDefinitions]);

  const fetchEmployees = async () => {
    if (!user?.restaurantId || !user.employeeId) return;
    try {
      const data = await getRestaurantUsers(user.restaurantId, user.employeeId);
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("fetch_employees_failed", error);
      setEmployees([]);
    }
  };

  const fetchRoles = async () => {
    if (!user?.restaurantId) return;
    try {
      const data = await getRoles(user.restaurantId);
      setRoleDefinitions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("fetch_roles_failed", error);
      setRoleDefinitions([]);
    }
  };

  useEffect(() => {
    void fetchEmployees();
    void fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantId, user?.employeeId]);

  const handleAddEmployee = async (data: AddEmployeeFormData) => {
    if (!user) return;
    try {
      await addEmployeeToRestaurant(user.restaurantId, data);
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
    if (!user) return;
    try {
      await removeEmployeeFromRestaurant(user.restaurantId, employeeId);
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
    if (!user?.restaurantId) return;
    const ok = await assignRoleToEmployee(user.restaurantId, employeeId, roleName);
    if (!ok) {
      toast({ title: "Error", description: "Unable to assign role.", variant: "destructive" });
      return;
    }

    await fetchEmployees();
    toast({ title: "Role Assigned", description: `Assigned ${roleName} to ${employeeId}.` });
  };

  const handleRemoveRole = async (employee: User, roleName: string) => {
    if (!user?.restaurantId) return;
    const normalized = roleName.trim().toLowerCase();
    if (normalized === employee.role) {
      toast({
        title: "Protected Role",
        description: "Cannot remove an employee's primary role.",
        variant: "destructive",
      });
      return;
    }

    const ok = await removeRoleFromEmployee(user.restaurantId, employee.employeeId, normalized);
    if (!ok) {
      toast({ title: "Error", description: "Unable to remove role.", variant: "destructive" });
      return;
    }

    await fetchEmployees();
    toast({ title: "Role Removed", description: `Removed ${normalized} from ${employee.employeeId}.` });
  };

  const toggleNewRoleAction = (action: string) => {
    setNewRoleActions((prev) =>
      prev.includes(action) ? prev.filter((entry) => entry !== action) : [...prev, action],
    );
  };

  const handleCreateCustomRole = async () => {
    if (!user?.restaurantId) return;

    const normalizedName = newRoleName.trim().toLowerCase();
    if (!normalizedName) {
      toast({ title: "Role Name Required", description: "Please provide a role name.", variant: "destructive" });
      return;
    }

    if (CORE_ROLES.includes(normalizedName as (typeof CORE_ROLES)[number])) {
      toast({ title: "Protected Role", description: "Core roles cannot be recreated as custom roles.", variant: "destructive" });
      return;
    }

    const created = await createRole(user.restaurantId, normalizedName, newRoleActions);
    if (!created) {
      toast({ title: "Error", description: "Unable to create role.", variant: "destructive" });
      return;
    }

    await fetchRoles();
    setNewRoleName("");
    setNewRoleActions([]);
    setIsCreateRoleDialogOpen(false);
    toast({ title: "Role Saved", description: `Role '${normalizedName}' has been saved with access rules.` });
  };

  const handleDeleteCustomRole = async (role: RoleDefinition) => {
    if (!user?.restaurantId) return;

    if (CORE_ROLES.includes(role.role_name as (typeof CORE_ROLES)[number])) {
      toast({ title: "Protected Role", description: "Core roles cannot be deleted.", variant: "destructive" });
      return;
    }

    const ok = await deleteRole(user.restaurantId, role.id);
    if (!ok) {
      toast({ title: "Error", description: "Unable to delete role.", variant: "destructive" });
      return;
    }

    await Promise.all([fetchRoles(), fetchEmployees()]);
    toast({ title: "Role Deleted", description: `Role '${role.role_name}' has been removed.` });
  };

  if (!user || user.role !== "admin") {
    return (
      <div className="p-4">
        <p>You do not have permission to view this page.</p>
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
            <AddEmployeeForm onSubmit={handleAddEmployee} />
          </DialogContent>
        </Dialog>
      </div>

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
                <TableHead>Employee ID</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => {
                const employeeRoles = Array.from(new Set(employee.role_all ?? [employee.role]));
                const normalizedRoles = employeeRoles.map((entry) => entry.trim().toLowerCase());
                const assignable = allAssignableRoles.filter((entry) => !normalizedRoles.includes(entry));
                const removable = normalizedRoles.filter((entry) => entry !== employee.role);

                return (
                  <TableRow key={employee.employeeId}>
                    <TableCell className="font-medium">{employee.name}</TableCell>
                    <TableCell>{employee.employeeId}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {employeeRoles.map((role) => (
                          <Badge key={`${employee.employeeId}-${role}`} variant={role === "admin" ? "default" : "secondary"}>
                            {role}
                          </Badge>
                        ))}
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
                                assignable.map((roleName) => (
                                  <DropdownMenuItem
                                    key={`${employee.employeeId}-assign-${roleName}`}
                                    onClick={() => void handleAssignRole(employee.employeeId, roleName)}
                                  >
                                    {roleName}
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
                                removable.map((roleName) => (
                                  <DropdownMenuItem
                                    key={`${employee.employeeId}-remove-${roleName}`}
                                    onClick={() => void handleRemoveRole(employee, roleName)}
                                  >
                                    {roleName}
                                  </DropdownMenuItem>
                                ))
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>

                          <DropdownMenuItem
                            onClick={() => void handleRemoveEmployee(employee.employeeId)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove Employee
                          </DropdownMenuItem>
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
                    onChange={(event) => setNewRoleName(event.target.value)}
                    placeholder="e.g. floor_manager"
                  />
                </div>

                <div className="max-h-[360px] overflow-y-auto rounded-md border p-3">
                  {ACCESS_CATALOG.map((group) => (
                    <div key={group.group} className="mb-3">
                      <p className="mb-1 text-sm font-semibold">{group.group}</p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {group.actions.map((action) => {
                          const checked = newRoleActions.includes(action);
                          return (
                            <label key={action} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleNewRoleAction(action)}
                              />
                              <span className="text-sm">{action}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button onClick={() => void handleCreateCustomRole()}>Save Role</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {CORE_ROLES.map((role) => (
                <Badge key={`core-${role}`} variant="default">{role} (core)</Badge>
              ))}
            </div>

            {roleDefinitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom roles created yet.</p>
            ) : (
              <div className="space-y-2">
                {roleDefinitions.map((role) => (
                  <div key={role.id} className="flex items-center justify-between rounded-md border p-2">
                    <div>
                      <p className="font-medium">{role.role_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {role.actions_performable.length} access rules configured
                      </p>
                    </div>
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

function AddEmployeeForm({ onSubmit }: { onSubmit: (data: AddEmployeeFormData) => void }) {
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
        <Label htmlFor="employeeId" className="text-right">
          Employee ID
        </Label>
        <div className="col-span-3">
          <Input id="employeeId" {...register("employeeId")} placeholder="e.g., JD001" />
          {errors.employeeId ? <p className="mt-1 text-sm text-destructive">{errors.employeeId.message}</p> : null}
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
