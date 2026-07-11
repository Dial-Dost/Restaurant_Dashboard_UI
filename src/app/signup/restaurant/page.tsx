
"use client";

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
import { useRouter } from "next/navigation";
import Link from 'next/link';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { signUpRestaurant } from "@/services/authService";

const restaurantSignUpSchema = z.object({
  restaurantName: z.string().min(2, "Restaurant name is too short."),
  adminName: z.string().min(2, "Your name is too short."),
  adminEmployeeId: z.string().min(1, "Employee ID is required."),
  password: z.string()
    .min(10, "Password must be at least 10 characters.")
    .regex(/[a-zA-Z]/, "Password must contain a letter.")
    .regex(/[0-9]/, "Password must contain a number."),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"]
});

type RestaurantSignUpFormFields = z.infer<typeof restaurantSignUpSchema>;

export default function RestaurantSignUpPage() {
  const router = useRouter();
  const { toast } = useToast();

  const { register, handleSubmit, formState: { errors } } = useForm<RestaurantSignUpFormFields>({
    resolver: zodResolver(restaurantSignUpSchema)
  });

  const handleSignUp = async (data: RestaurantSignUpFormFields) => {
    try {
      await signUpRestaurant({
        restaurantName: data.restaurantName,
        adminName: data.adminName,
        adminEmployeeId: data.adminEmployeeId,
        password: data.password
      });
      toast({
        title: "Registration Successful!",
        description: "Your restaurant and admin account have been created.",
      });
      router.push(`/login`);
    } catch (error: any) {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit(handleSignUp)}>
          <Card>
            <CardHeader className="space-y-1 text-center">
               <div className="flex justify-center mb-4">
                 <ChefHat className="h-12 w-12 text-primary" />
               </div>
              <CardTitle className="text-2xl font-bold">Register Your Restaurant</CardTitle>
              <CardDescription>
                Fill in the details to get your restaurant set up on CuisineFlow.
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
                />
                {errors.restaurantName && <p className="text-sm text-destructive mt-1">{errors.restaurantName.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminName">Your Full Name (Admin)</Label>
                <Input
                  id="adminName"
                  type="text"
                  placeholder="John Doe"
                  {...register("adminName")}
                />
                 {errors.adminName && <p className="text-sm text-destructive mt-1">{errors.adminName.message}</p>}
              </div>
               <div className="space-y-2">
                <Label htmlFor="adminEmployeeId">Your Employee ID (Admin)</Label>
                <Input
                  id="adminEmployeeId"
                  type="text"
                  placeholder="e.g., admin01"
                  {...register("adminEmployeeId")}
                />
                 {errors.adminEmployeeId && <p className="text-sm text-destructive mt-1">{errors.adminEmployeeId.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Admin Password</Label>
                <Input id="password" type="password" {...register("password")} />
                 {errors.password && <p className="text-sm text-destructive mt-1">{errors.password.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" {...register("confirmPassword")} />
                 {errors.confirmPassword && <p className="text-sm text-destructive mt-1">{errors.confirmPassword.message}</p>}
              </div>
               <Button type="submit" className="w-full">
                Register Restaurant
              </Button>
               <div className="mt-4 text-center text-sm">
                Already registered?{" "}
                <Link href="/login" className="underline">
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
