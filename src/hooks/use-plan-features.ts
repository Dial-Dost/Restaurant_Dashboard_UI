"use client";

// THE SUBSCRIPTION PLAN'S FEATURE FLAGS, as the session carries them.
//
// The backend ships `features` (the active plan's flag map) on both
// /auth/employee-login and /auth/me — the same payload the Flutter app reads
// into `Profile.features`. AuthContext stores and re-hydrates it; this hook is
// the one place the rest of the app asks the question.
//
// ADDITIVE, exactly like `Profile.featureEnabled` and the backend's own
// FEATURE_BY_PREFIX gate: a module is hidden only when the plan EXPLICITLY sets
// its flag to false. An unknown flag, an empty map, or a session stored before
// `features` shipped all answer "allowed" — the failure direction that keeps an
// owner's nav intact rather than blanking it on a stale payload.

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";

export interface PlanFeaturesApi {
  /** The raw flag map, or null when the session carries none. */
  features: Record<string, unknown> | null;
  /** Additive gate: false ONLY when the plan explicitly disables the flag. */
  featureEnabled: (feature?: string | null) => boolean;
}

export function usePlanFeatures(): PlanFeaturesApi {
  const { user } = useAuth();
  const features = user?.features ?? null;

  const featureEnabled = useCallback(
    (feature?: string | null): boolean => {
      if (!feature) { return true; }
      if (!features) { return true; }
      return features[feature] !== false;
    },
    [features],
  );

  return { features, featureEnabled };
}
