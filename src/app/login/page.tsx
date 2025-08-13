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

export default function LoginPage() {
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleLogin}>
          <Card>
            <CardHeader className="space-y-1 text-center">
               <div className="flex justify-center mb-4">
                 <ChefHat className="h-12 w-12 text-primary" />
               </div>
              <CardTitle className="text-2xl font-bold">Admin Login</CardTitle>
              <CardDescription>
                Enter your credentials to access the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="restaurantName">Restaurant Name</Label>
                <Input
                  id="restaurantName"
                  type="text"
                  placeholder="CuisineFlow"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="manager@cuisineflow.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input id="password" type="password" required />
              </div>
               <Button type="submit" className="w-full">
                Sign In
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
