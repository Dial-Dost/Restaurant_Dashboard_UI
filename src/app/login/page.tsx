
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
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { findRestaurantByName } from "@/lib/db";

export default function LoginPage() {
  const router = useRouter();
  const [restaurantName, setRestaurantName] = useState("");
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantName) return;

    const restaurant = await findRestaurantByName(restaurantName);

    if (restaurant) {
      router.push(`/login/employee?restaurant=${encodeURIComponent(restaurant.name)}`);
    } else {
       toast({
        title: "Restaurant Not Found",
        description: "This restaurant is not registered. Please sign up.",
        variant: "destructive",
      });
    }
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
              <CardTitle className="text-2xl font-bold">Welcome to CuisineFlow</CardTitle>
              <CardDescription>
                Please enter your restaurant's name to begin.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="restaurantName">Restaurant Name</Label>
                <Input
                  id="restaurantName"
                  type="text"
                  placeholder="e.g., The Grand Bistro"
                  required
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full">
                Continue
              </Button>
               <div className="mt-4 text-center text-sm">
                Need to register your restaurant?{" "}
                <Link href="/signup/restaurant" className="underline">
                  Sign up here
                </Link>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
