
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
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { sendPasswordReset } from '@/services/authService';

const forgotPasswordSchema = z.object({
  restaurantName: z.string().min(1, "Restaurant name is required."),
  employeeId: z.string().min(1, "Employee ID is required."),
});

type ForgotPasswordFields = z.infer<typeof forgotPasswordSchema>;


function ForgotPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const { register, handleSubmit, formState: { errors }, setValue } = useForm<ForgotPasswordFields>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      restaurantName: "",
      employeeId: ""
    }
  });

  useEffect(() => {
    const name = searchParams.get('restaurant');
    Promise.resolve().then(() => {
      if (name) {
        setRestaurantName(name);
        setValue('restaurantName', name);
      }
      setIsReady(true);
    });
  }, [searchParams, setValue]);

  const handleReset = async (data: ForgotPasswordFields) => {
    try {
      await sendPasswordReset(data.restaurantName, data.employeeId);
      toast({
        title: "Check your email",
        description: "If an account with that ID exists, a password reset link has been sent.",
      });
      router.push(`/login/employee?restaurant=${encodeURIComponent(data.restaurantName)}`);
    } catch (error: any) {
       toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit(handleReset)}>
          <Card>
            <CardHeader className="space-y-1 text-center">
               <div className="flex justify-center mb-4">
                 <ChefHat className="h-12 w-12 text-primary" />
               </div>
              <CardTitle className="text-2xl font-bold">Forgot Password</CardTitle>
              <CardDescription>
                Enter your credentials to receive a password reset link.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="restaurantName">Restaurant Name</Label>
                <Input
                  id="restaurantName"
                  type="text"
                  placeholder="e.g., The Grand Bistro"
                  {...register("restaurantName")}
                  disabled={!isReady}
                />
                 {errors.restaurantName && <p className="text-sm text-destructive mt-1">{errors.restaurantName.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="employeeId">Employee ID</Label>
                <Input
                  id="employeeId"
                  type="text"
                  placeholder="e.g., 12345"
                  {...register("employeeId")}
                   disabled={!isReady}
                />
                {errors.employeeId && <p className="text-sm text-destructive mt-1">{errors.employeeId.message}</p>}
              </div>
               <Button type="submit" className="w-full" disabled={!isReady}>
                Send Reset Link
              </Button>
              <div className="mt-4 text-center text-sm">
                Remember your password?{" "}
                <Link href={`/login/employee?restaurant=${encodeURIComponent(restaurantName || '')}`} className="underline">
                  Sign in
                </Link>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}


export default function ForgotPasswordPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ForgotPasswordContent />
        </Suspense>
    )
}
