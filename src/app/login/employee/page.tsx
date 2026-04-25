
"use client";

import { Suspense, useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChefHat } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { signInEmployee } from '@/services/authService';
import { useAuth } from '@/context/AuthContext';


const loginSchema = z.object({
  employeeUsername: z.string().min(1, "Employee ID is required."),
  password: z.string().min(1, "Password is required."),
});

type LoginFormFields = z.infer<typeof loginSchema>;


function EmployeeLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { login } = useAuth();
  
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const name = searchParams.get('restaurant');
    const id = setTimeout(() => {
      setRestaurantName(name);
      setIsReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, [searchParams]);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormFields>({
    resolver: zodResolver(loginSchema)
  });

  const handleLogin = async (data: LoginFormFields) => {
    if (!restaurantName) {
      toast({
        title: "Error",
        description: "Restaurant name is missing. Please go back and select your restaurant.",
        variant: "destructive",
      });
      return;
    }
    try {
      const user = await signInEmployee(restaurantName, data.employeeUsername, data.password);
      // normalize backend response to AuthUser shape
      const authUser = {
        uid: (user.uid ?? user.employeeId) as string,
        employeeId: user.employeeId as string,
        employeeUsername: user.employeeUsername as string,
        role: user.role,
        role_all: user.role_all ?? undefined,
        restaurantUsername: user.restaurantUsername as string,
        restaurantName: user.restaurantName as string,
        res_id: user.res_id as string,
        outlet_id: user.outlet_id as string,
        emp_Fname: user.emp_Fname as string ?? (user.name ?? null) as string | null,
        emp_Lname: user.emp_Lname ?? null as string | null,
        actions_set: user.actions_set as string[],
      };
      console.log("Login successful, user data:", authUser);
      login(authUser);
      try {
        // Persist session on server so server-side helpers can read outlet/actions via cookies
        await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authUser }),
          cache: 'no-store',
        });
      } catch (err) {
        console.warn('Unable to persist session cookie', err);
      }
      router.push('/dashboard');
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };
  const descriptionText = isReady 
    ? `Enter your credentials for ${restaurantName || "your restaurant"}.`
    : "Loading restaurant...";

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit(handleLogin)}>
          <Card>
            <CardHeader className="space-y-1 text-center">
               <div className="flex justify-center mb-4">
                 <ChefHat className="h-12 w-12 text-primary" />
               </div>
              <CardTitle className="text-2xl font-bold">Employee Login</CardTitle>
              <CardDescription>
                {descriptionText}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="employeeUsername">Employee Username</Label>
                <Input
                  id="employeeUsername"
                  type="text"
                  placeholder="e.g., john_doe"
                  {...register("employeeUsername")}
                  disabled={!isReady || !restaurantName}
                />
                {errors.employeeUsername && <p className="text-sm text-destructive mt-1">{errors.employeeUsername.message}</p>}
              </div>
              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href={`/forgot-password?restaurant=${encodeURIComponent(restaurantName || "")}`}
                    className="ml-auto inline-block text-sm underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input id="password" type="password" {...register("password")} disabled={!isReady || !restaurantName} />
                {errors.password && <p className="text-sm text-destructive mt-1">{errors.password.message}</p>}
              </div>
               <Button type="submit" className="w-full" disabled={!isReady || !restaurantName}>
                Sign In
              </Button>
               <div className="mt-4 text-center text-sm">
                Not your restaurant?{" "}
                <Link href="/login" className="underline">
                  Go back
                </Link>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}


export default function EmployeeLoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EmployeeLoginContent />
    </Suspense>
  )
}
