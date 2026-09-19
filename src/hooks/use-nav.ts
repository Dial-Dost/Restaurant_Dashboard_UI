"use client";

// The ONE resolution of "which modules does this session see" — the React face
// of src/lib/nav-registry.ts. The sidebar, the route guard and the
// notifications bell all read this hook, so they can never disagree about what
// exists or who may open it.

import { useMemo } from "react";

import { useAuth } from "@/context/AuthContext";
import { usePlanFeatures } from "@/hooks/use-plan-features";
import { answered, isWaiterOnly } from "@/lib/session-scope";
import type { Capability } from "@/lib/session-scope";
import {
  landingModuleFor,
  visibleModulesFor,
  visibleSectionsFor,
  type NavGateContext,
  type NavModule,
  type NavSection,
  type PlanFeature,
} from "@/lib/nav-registry";

export interface VisibleNav {
  /** The grouped sidebar, empty sections already dropped. */
  sections: NavSection[];
  /** The flat list, in section order. */
  modules: NavModule[];
  /** Labels of `modules` — the bell's `visibleLabels`. */
  labels: string[];
  /** The module this session opens the dashboard on, or null (no modules). */
  landing: NavModule | null;
  isAdmin: boolean;
  waiterOnly: boolean;
  /** valet role without admin — the one landing preference beyond the Flutter rule. */
  valetOnly: boolean;
}

export function useVisibleNav(): VisibleNav {
  const { user } = useAuth();
  const { featureEnabled } = usePlanFeatures();

  return useMemo(() => {
    const roles = new Set(
      [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
        .map((r) => (r ?? "").toLowerCase())
        .filter((r) => r.length > 0),
    );
    const isAdmin = roles.has("admin");
    const waiterOnly = isWaiterOnly(user);
    const valetOnly = roles.has("valet") && !isAdmin;
    const hasAllActions = Array.isArray(user?.actions_set) && user.actions_set.includes("*");
    const actionNames = new Set(
      (user?.action_names ?? [])
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0),
    );

    const ctx: NavGateContext = {
      isAdmin,
      waiterOnly,
      hasAllActions,
      actionNames,
      capabilityAnswered: (c: Capability) => answered(user, c),
      featureEnabled: (feature?: PlanFeature) => featureEnabled(feature),
    };

    const sections = visibleSectionsFor(ctx);
    const modules = visibleModulesFor(ctx);
    return {
      sections,
      modules,
      labels: modules.map((m) => m.label),
      landing: landingModuleFor(modules, { waiterOnly, valetOnly }),
      isAdmin,
      waiterOnly,
      valetOnly,
    };
  }, [user, featureEnabled]);
}
