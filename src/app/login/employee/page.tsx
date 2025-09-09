
"use client";

import { Suspense } from 'react';
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
  employeeId: z.string().min(1, "Employee ID is required."),
  password: z.string().min(1, "Password is required."),
});

type LoginFormFields = z.infer<typeof loginSchema>;


function EmployeeLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const restaurantName = searchParams.get('restaurant');
  const { toast } = useToast();
  const { login } = useAuth();

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
      const user = await signInEmployee(restaurantName, data.employeeId, data.password);
      login(user);
      router.push("/dashboard");
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

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
                Enter your credentials for {restaurantName || "your restaurant"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="employeeId">Employee ID</Label>
                <Input
                  id="employeeId"
                  type="text"
                  placeholder="e.g., 12345"
                  {...register("employeeId")}
                />
                {errors.employeeId && <p className="text-sm text-destructive mt-1">{errors.employeeId.message}</p>}
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
                <Input id="password" type="password" {...register("password")} />
                {errors.password && <p className="text-sm text-destructive mt-1">{errors.password.message}</p>}
              </div>
               <Button type="submit" className="w-full">
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
