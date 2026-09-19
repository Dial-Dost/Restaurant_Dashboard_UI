"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function Redirect(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    // Old links carried the restaurant in the query; adopt it as the device's
    // saved restaurant so /login lands straight on the credentials step.
    const name = params.get("restaurant")?.trim();
    if (name) {
      try { localStorage.setItem("cuisineflow-restaurant", name); } catch { /* storage unavailable */ }
    }
    router.replace("/login");
  }, [params, router]);
  return <LoginSpinner />;
}

export function LoginSpinner(): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-accent-foreground" aria-label="Loading" />
    </div>
  );
}

/** `/login/employee` and `/forgot-password` are folded into the single /login screen. */
export function LegacyLoginRedirect(): React.JSX.Element {
  return (
    <Suspense fallback={<LoginSpinner />}>
      <Redirect />
    </Suspense>
  );
}
