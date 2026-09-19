"use client";

// The Overview's one way of leaving itself — the web face of Flutter's
// ModuleNavigator as this page uses it. `canOpen` answers off the nav registry
// (the same rule the sidebar and route guard read), so a tile whose module is
// gated for this user renders inert instead of offering a dead tap; `goTarget`
// primes the destination's reporting window (glance-destinations.ts) before
// the router moves, so a jump lands showing the same number the owner tapped.

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { withFocusParam } from "@/components/focus-banner";
import { moduleByLabel } from "@/lib/nav-registry";
import { primeGlanceTarget, type GlanceTarget } from "@/lib/glance-destinations";
import { useTimezone } from "@/lib/use-timezone";
import { useVisibleNav } from "@/hooks/use-nav";

export interface ModuleNav {
    /** May this session open the module with this shell label? */
    canOpen: (label: string) => boolean;
    /** Open a module by label, optionally with a deep-link focus payload. */
    openModule: (label: string, focus?: Record<string, unknown> | null) => void;
    /** Navigate to a raw href (a server-composed deep link), with optional focus. */
    openHref: (href: string, focus?: Record<string, unknown> | null) => void;
    /** Take a glance jump: prime the destination's window, then navigate. */
    goTarget: (target: GlanceTarget) => void;
}

export function useModuleNav(): ModuleNav {
    const router = useRouter();
    const { labels } = useVisibleNav();
    const { timezone } = useTimezone();

    const canOpen = useCallback((label: string) => labels.includes(label), [labels]);

    const openHref = useCallback((href: string, focus?: Record<string, unknown> | null) => {
        router.push(focus && Object.keys(focus).length > 0 ? withFocusParam(href, focus) : href);
    }, [router]);

    const openModule = useCallback((label: string, focus?: Record<string, unknown> | null) => {
        const href = moduleByLabel(label)?.href;
        if (!href) { return; }
        openHref(href, focus);
    }, [openHref]);

    const goTarget = useCallback((target: GlanceTarget) => {
        primeGlanceTarget(target, timezone);
        router.push(target.href);
    }, [router, timezone]);

    return { canOpen, openModule, openHref, goTarget };
}
