
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
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { findRestaurantByName } from "@/lib/db";

export default function LoginPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const [restaurantName, setRestaurantName] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);

  const { toast } = useToast();

  // BUG A landing: the shared data layer redirects here with ?session=expired
  // when the backend rejects a stored token (HTTP 401). Drop any stale client
  // auth so the dashboard guard can't bounce the user straight back in, clear
  // the server cookie, and show a clear message instead of a silent empty tab.
  useEffect(() => {
    if (typeof window === "undefined") { return; }
    const params = new URLSearchParams(window.location.search);
    if (params.get("session") !== "expired") { return; }
    setSessionExpired(true);
    logout();
    fetch("/api/session", { method: "DELETE", cache: "no-store" }).catch(() => {});
    toast({
      title: "Session expired",
      description: "Your session expired — please sign in again.",
      variant: "destructive",
    });
    // Tidy the URL so a refresh doesn't replay the notice.
    window.history.replaceState(null, "", "/login");
    // Run once on mount; logout/toast identities are stable enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantName) {return;}

    const restaurant = await findRestaurantByName(restaurantName);

    if (restaurant) {
      router.push(`/login/employee?restaurant=${encodeURIComponent(restaurant.Restaurant_name)}`);
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
                Please enter your restaurant&apos;s name to begin.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionExpired && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Your session expired — please sign in again.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="restaurantName">Restaurant Name</Label>
                <Input
                  id="restaurantName"
                  type="text"
                  placeholder="e.g., The Grand Bistro"
                  required
                  value={restaurantName}
                  onChange={(e) => { setRestaurantName(e.target.value); }}
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
