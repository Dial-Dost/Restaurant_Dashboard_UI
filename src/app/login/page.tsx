"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import type { AuthUser } from "@/context/AuthContext";
import { getOutlets, signInEmployee } from "@/services/authService";
import { BrandLockup } from "@/components/login/brand-lockup";
import { ForgotPasswordDialog } from "@/components/login/forgot-password-dialog";

/** Per-device saved restaurant (Flutter `restaurant_name` pref). */
const RESTAURANT_KEY = "cuisineflow-restaurant";
const outletKey = (restaurant: string): string => `employeeLoginOutlet:${restaurant}`;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) { localStorage.removeItem(key); } else { localStorage.setItem(key, value); }
  } catch {
    // Storage unavailable (private mode): the flow still works for this visit.
  }
}

interface Outlet { id: string; name: string }

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const { user, login, logout } = useAuth();
  const { toast } = useToast();

  // null until mounted (localStorage read) so SSR and first paint agree.
  const [restaurant, setRestaurant] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restaurant phase
  const [restaurantInput, setRestaurantInput] = useState("");
  const [restaurantError, setRestaurantError] = useState<string | null>(null);

  // Credentials phase
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletsLoading, setOutletsLoading] = useState(false);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string; outlet?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      const saved = readStored(RESTAURANT_KEY);
      setRestaurant(saved?.trim() ? saved : null);
      setMounted(true);
    }, 0);
    return () => { clearTimeout(id); };
  }, []);

  // A signed-in device never sits on the login screen (Flutter app.dart).
  useEffect(() => {
    if (!user || sessionExpired || busy) { return; }
    // The expiry landing logs out on mount; don't bounce back in before it does.
    if (new URLSearchParams(window.location.search).get("session") === "expired") { return; }
    router.replace("/dashboard");
  }, [user, sessionExpired, busy, router]);

  // The shared data layer redirects here with ?session=expired when the backend
  // rejects a stored token (HTTP 401). Drop stale client auth, clear the server
  // cookie, and show the notice once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("session") !== "expired") { return; }
    setSessionExpired(true);
    logout();
    fetch("/api/session", { method: "DELETE", cache: "no-store" }).catch(() => undefined);
    toast({
      title: "Session expired",
      description: "Your session expired — please sign in again.",
      variant: "destructive",
    });
    window.history.replaceState(null, "", "/login");
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch outlets once the restaurant is known; >1 renders a picker.
  useEffect(() => {
    if (!restaurant) { return; }
    const cancelled = { current: false };
    setOutletsLoading(true);
    void (async () => {
      const list = await getOutlets(restaurant);
      if (cancelled.current) { return; }
      setOutlets(list);
      setOutletsLoading(false);
      if (list.length > 1) {
        const stored = readStored(outletKey(restaurant));
        setSelectedOutletId(stored && list.some((o) => o.id === stored) ? stored : list[0].id);
      } else {
        setSelectedOutletId("");
      }
    })();
    return () => { cancelled.current = true; };
  }, [restaurant]);

  const saveRestaurant = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    const name = restaurantInput.trim();
    if (!name) {
      setRestaurantError("Required");
      return;
    }
    writeStored(RESTAURANT_KEY, name);
    setAuthError(null);
    setRestaurant(name);
  };

  const changeRestaurant = useCallback((): void => {
    writeStored(RESTAURANT_KEY, null);
    setRestaurantInput(restaurant ?? "");
    setRestaurant(null);
    setOutlets([]);
    setSelectedOutletId("");
    setAuthError(null);
    setFieldErrors({});
  }, [restaurant]);

  const signIn = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!restaurant || busy) { return; }
    const hasPicker = outlets.length > 1;
    const errs: typeof fieldErrors = {};
    if (!username.trim()) { errs.username = "Required"; }
    if (!password) { errs.password = "Required"; }
    if (hasPicker && !selectedOutletId) { errs.outlet = "Required"; }
    setFieldErrors(errs);
    if (Object.keys(errs).length) { return; }

    setBusy(true);
    setAuthError(null);
    try {
      if (hasPicker) { writeStored(outletKey(restaurant), selectedOutletId); }
      // The action RETURNS failure rather than throwing: a thrown Error's
      // message is redacted at the server-action boundary in production.
      const result = await signInEmployee(
        restaurant.trim(),
        username.trim(),
        password,
        hasPicker ? selectedOutletId : undefined,
      );
      if (!result.ok) {
        setAuthError(result.error);
        setBusy(false);
        return;
      }
      const u = result.user;
      const authUser: AuthUser & { token: string } = {
        uid: (u.uid ?? u.employeeId) as string,
        token: u.token as string,
        employeeId: u.employeeId as string,
        employeeUsername: u.employeeUsername as string,
        role: u.role as AuthUser["role"],
        role_all: (u.role_all ?? undefined) as string[] | undefined,
        restaurantUsername: u.restaurantUsername as string,
        restaurantName: u.restaurantName as string,
        res_id: u.res_id as string,
        outlet_id: u.outlet_id as string,
        emp_Fname: (u.emp_Fname ?? u.name ?? null) as string | null,
        emp_Lname: (u.emp_Lname ?? null) as string | null,
        actions_set: u.actions_set as string[],
        action_names: (u.action_names ?? []) as string[],
        // Server's floor-scoping answer carried through, never re-derived; left
        // undefined when absent so AuthContext re-hydrates it from /auth/me.
        scope: u.scope as AuthUser["scope"],
        features: u.features as AuthUser["features"],
      };
      login(authUser);
      try {
        // Persist session on server so server-side helpers can read it via cookies.
        await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authUser }),
          cache: "no-store",
        });
      } catch (err) {
        console.warn("Unable to persist session cookie", err);
      }
      setSessionExpired(false);
      router.push("/dashboard");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-background p-6">
      {/* Copper radial ambience (Flutter: 460px circle, top:-160 right:-120). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-[120px] -top-[160px] h-[460px] w-[460px] rounded-full"
        style={{ background: "radial-gradient(circle, hsl(var(--accent-deep) / 0.18), transparent 70%)" }}
      />
      <div className="relative w-full max-w-[400px]">
        <ForkCard className="p-8">
          <BrandLockup />
          <div className="mt-7">
            {!mounted ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-accent-foreground" aria-label="Loading" />
              </div>
            ) : restaurant === null ? (
              <form onSubmit={saveRestaurant} noValidate>
                <h1 className="text-xl font-semibold">Set up this device</h1>
                <p className="mt-1 text-sm text-muted-foreground">Enter your restaurant name to get started.</p>
                {sessionExpired && (
                  <InlineError message="Your session expired — please sign in again." />
                )}
                <div className="mt-5 space-y-2">
                  <Label htmlFor="restaurantName">Restaurant name</Label>
                  <Input
                    id="restaurantName"
                    autoFocus
                    autoComplete="organization"
                    value={restaurantInput}
                    onChange={(e) => { setRestaurantInput(e.target.value); setRestaurantError(null); }}
                  />
                  {restaurantError && <p className="text-sm text-destructive">{restaurantError}</p>}
                  <p className="text-xs text-tertiary">Saved on this device — staff just sign in after this.</p>
                </div>
                <Button type="submit" className="mt-5">
                  Continue
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Button>
              </form>
            ) : (
              <form onSubmit={(e) => { void signIn(e); }} noValidate>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-inset py-1 pl-3 pr-1">
                  <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{restaurant}</span>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={changeRestaurant}>
                    Change
                  </Button>
                </div>
                {sessionExpired && !authError && (
                  <InlineError message="Your session expired — please sign in again." />
                )}
                {authError && <InlineError message={authError} />}
                {outletsLoading && (
                  <div className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading outlets…
                  </div>
                )}
                <div className="mt-5 space-y-4">
                  {outlets.length > 1 && (
                    <div className="space-y-2">
                      <Label htmlFor="outlet">Outlet</Label>
                      <Select
                        value={selectedOutletId}
                        onValueChange={(v) => { setSelectedOutletId(v); setFieldErrors((f) => ({ ...f, outlet: undefined })); }}
                        disabled={busy}
                      >
                        <SelectTrigger id="outlet">
                          <SelectValue placeholder="Select your outlet" />
                        </SelectTrigger>
                        <SelectContent>
                          {outlets.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldErrors.outlet && <p className="text-sm text-destructive">{fieldErrors.outlet}</p>}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      autoFocus
                      autoComplete="username"
                      value={username}
                      disabled={busy}
                      onChange={(e) => { setUsername(e.target.value); setFieldErrors((f) => ({ ...f, username: undefined })); }}
                    />
                    {fieldErrors.username && <p className="text-sm text-destructive">{fieldErrors.username}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      disabled={busy}
                      onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); }}
                    />
                    {fieldErrors.password && <p className="text-sm text-destructive">{fieldErrors.password}</p>}
                  </div>
                </div>
                <Button type="submit" className="mt-6 w-full" disabled={busy} aria-busy={busy}>
                  {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-label="Signing in" /> : "Sign in"}
                </Button>
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    disabled={busy}
                    onClick={() => { setForgotOpen(true); }}
                  >
                    Forgot password?
                  </Button>
                </div>
                <ForgotPasswordDialog
                  open={forgotOpen}
                  onOpenChange={setForgotOpen}
                  restaurantName={restaurant}
                  initialUsername={username.trim()}
                />
              </form>
            )}
          </div>
        </ForkCard>
        {/* [web-extra] kept reachable: restaurant self-signup (no Flutter equivalent). */}
        {mounted && restaurant === null && (
          <p className="mt-4 text-center text-xs text-tertiary">
            New restaurant?{" "}
            <Link href="/signup/restaurant" className="underline underline-offset-2 hover:text-foreground">
              Register here
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive"
    >
      <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
