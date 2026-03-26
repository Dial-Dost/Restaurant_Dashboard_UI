
"use client";

import { useState, useEffect } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { addEmployeeToRestaurant, removeEmployeeFromRestaurant } from "@/services/authService";
import { findRestaurantByName, User } from "@/lib/db";

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
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchEmployees = async () => {
      if (user && user.restaurantId) {
        const restaurant = await findRestaurantByName(user.restaurantName);
        setEmployees(restaurant?.users || []);
      }
  };

  useEffect(() => {
    fetchEmployees();
  }, [user]);

  const handleAddEmployee = async (data: AddEmployeeFormData) => {
    if (!user) return;
    try {
      await addEmployeeToRestaurant(user.restaurantId, data);
      await fetchEmployees(); // Refetch employees to update list
      toast({
        title: "Employee Added",
        description: `${data.name} has been added to the system.`,
      });
      setIsDialogOpen(false);
    } catch (error: any) {
       toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };
  
  const handleRemoveEmployee = async (employeeId: string) => {
    if (!user) return;
    try {
      await removeEmployeeFromRestaurant(user.restaurantId, employeeId);
      await fetchEmployees(); // Refetch employees to update list
       toast({
        title: "Employee Removed",
        description: `The employee has been removed from the system.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  if (!user || user.role !== 'admin') {
    return (
        <div className="p-4">
            <p>You do not have permission to view this page.</p>
        </div>
    )
  }

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Employee List</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Employee</DialogTitle>
              <DialogDescription>
                Fill in the details for the new employee.
              </DialogDescription>
            </DialogHeader>
            <AddEmployeeForm onSubmit={handleAddEmployee} />
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All Employees</CardTitle>
          <CardDescription>
            A list of all employees at {user.restaurantName}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.employeeId}>
                  <TableCell className="font-medium">{employee.name}</TableCell>
                  <TableCell>{employee.employeeId}</TableCell>
                  <TableCell>
                    <Badge variant={employee.role === 'admin' ? 'default' : 'secondary'}>
                      {employee.role}
                    </Badge>
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
                        <DropdownMenuItem onClick={() => handleRemoveEmployee(employee.employeeId)} className="text-destructive">
                           <Trash2 className="mr-2 h-4 w-4" />
                           Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AddEmployeeForm({ onSubmit }: { onSubmit: (data: AddEmployeeFormData) => void; }) {
    const { register, handleSubmit, control, reset, formState: { errors } } = useForm<AddEmployeeFormData>({
        resolver: zodResolver(addEmployeeSchema)
    });

    const handleFormSubmit = (data: AddEmployeeFormData) => {
        onSubmit(data);
        reset();
    };

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">Full Name</Label>
              <div className="col-span-3">
                <Input id="name" {...register("name")} placeholder="e.g., John Doe" />
                {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
              </div>
            </div>
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="employeeId" className="text-right">Employee ID</Label>
              <div className="col-span-3">
                <Input id="employeeId" {...register("employeeId")} placeholder="e.g., JD001" />
                {errors.employeeId && <p className="text-sm text-destructive mt-1">{errors.employeeId.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="role" className="text-right">Role</Label>
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
                    {errors.role && <p className="text-sm text-destructive mt-1">{errors.role.message}</p>}
               </div>
            </div>
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="password" className="text-right">Password</Label>
              <div className="col-span-3">
                <Input id="password" type="password" {...register("password")} />
                {errors.password && <p className="text-sm text-destructive mt-1">{errors.password.message}</p>}
              </div>
            </div>
          <DialogFooter>
            <Button type="submit">Save Employee</Button>
          </DialogFooter>
        </form>
    )
}
