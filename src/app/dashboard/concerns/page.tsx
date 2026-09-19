"use client";

// Concerns — the web copy of the Flutter "Concerns" module (`concernsModule`,
// restaurant_owner_app/lib/screens/modules.dart ~7167): GET
// /analytics/concerns?days=30 rendered as the severity-banded board. Gated in
// the nav registry on the same analytics permission as the rest of
// /analytics/* — the server enforces it, and a refusal surfaces below with
// its own sentence.

import { useCallback } from "react";
import type { JSX } from "react";

import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton";
import { ForkCard } from "@/components/ui/fork-card";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { ConcernsBoard } from "@/components/feedback/concerns-board";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useAuth } from "@/context/AuthContext";
import { fetchConcerns, type ConcernsPayload } from "@/lib/api/feedback";

export default function ConcernsPage(): JSX.Element {
  const { user } = useAuth();
  const rid = user?.restaurantUsername ?? "";
  const employeeId = user?.employeeId;
  const outletId = user?.outlet_id;

  const concerns = useCachedFetch<ConcernsPayload>(
    `concerns:${rid}:${outletId ?? ""}`,
    useCallback(
      () => fetchConcerns({ restaurantId: rid, employeeId, outletId }),
      [rid, employeeId, outletId],
    ),
    { enabled: rid.length > 0 },
  );

  if (concerns.loading) {
    return (
      <div className="grid gap-4">
        <ForkCard>
          <SkeletonStats tiles={3} />
        </ForkCard>
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (concerns.error != null || concerns.data == null) {
    return (
      <LoadErrorState
        whatFailed="Couldn't load concerns."
        error={concerns.error}
        onRetry={concerns.retry}
      />
    );
  }

  return (
    <div className="relative">
      <ConcernsBoard data={concerns.data} reload={concerns.retry} />
      <CacheStalePill
        offline={concerns.offline}
        fromCache={concerns.fromCache}
        updatedAt={concerns.updatedAt}
      />
    </div>
  );
}
