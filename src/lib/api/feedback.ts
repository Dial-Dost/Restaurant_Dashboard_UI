// Feedback + Concerns module fetchers — the web half of the Flutter
// `feedbackModule` load and `concernsModule`
// (restaurant_owner_app/lib/screens/modules.dart ~18732 / ~7167).
//
// These deliberately bypass db.ts's silent-empty fallbacks: `useCachedFetch`
// owns caching and staleness on these pages, so a failure must THROW (offline
// throws a TypeError, a refusal throws the server's own sentence) instead of
// quietly answering zeros. Two loads are TOLERATED failures, exactly as in
// Flutter: recovery tickets and the employee list (`.catchError((_) => {})`) —
// the module still renders without them.

import { requestBackend } from "@/lib/db";
import type { AttentionDeepLink, AttentionItem } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

/** Who is asking — forwarded to requestBackend on every call. */
export interface FeedbackScope {
  restaurantId: string;
  employeeId?: string;
  outletId?: string;
}

export interface FeedbackCategoryRating {
  key: string;
  label?: string | null;
  rating?: number | null;
  question?: string | null;
  follow_up?: string | null;
  /** The guest's reply to the follow-up, when one was asked. */
  follow_up_answer?: string | null;
}

export interface FeedbackEntry {
  id: string;
  employee_id?: string | null;
  customer_name?: string | null;
  comments?: string | null;
  overall_rating?: number | null;
  category_ratings?: FeedbackCategoryRating[] | null;
  source?: string | null;
  /** 0–10 "would you recommend" score, when the guest answered it. */
  nps?: number | null;
  submitted_at: string;
}

export interface FeedbackSummary {
  totalResponses: number | null;
  /** The backend sends the 2dp mean; render it verbatim like Flutter does. */
  averageRating: number | string | null;
  categoryAverages: Record<string, { label?: string | null; average?: number | null }> | null;
  last30DaysResponses: number | null;
}

/** One open (or resolved) service-recovery ticket — GET /feedback/recovery.
 *  The recovery reader returns only {key,label,rating,follow_up_answer} per
 *  question; the full wording lives on the matching /feedback row. */
export interface RecoveryTicket {
  id: string;
  customer_name?: string | null;
  overall_rating?: number | null;
  comments?: string | null;
  category_ratings?: FeedbackCategoryRating[] | null;
  submitted_at: string;
  recovery_status?: string | null;
  recovery_resolved_at?: string | null;
  recovery_resolved_by?: string | null;
  recovery_note?: string | null;
}

/** One /restaurant/users row, in the backend's own field names. */
export interface FeedbackEmployee {
  id?: string | null;
  employee_id?: string | null;
  emp_Fname?: string | null;
  emp_Lname?: string | null;
  employee_Username?: string | null;
}

/** The four payloads the Feedback module holds — Flutter's load, verbatim. */
export interface FeedbackBundle {
  summary: FeedbackSummary;
  items: FeedbackEntry[];
  tickets: RecoveryTicket[];
  employees: FeedbackEmployee[];
}

/**
 * Turn a failed `requestBackend` result into the throw `useCachedFetch`
 * expects: status 0 (fetch never reached the server) throws a TypeError so
 * `isUnreachableError` reads it as an outage; anything else throws the
 * server's sentence (`details` first) as a refusal.
 */
const throwBackendError = (status: number, text: string, fallback: string): never => {
  if (status === 0) {
    throw new TypeError("Failed to fetch");
  }
  let message = "";
  try {
    message = refusalSentence(JSON.parse(text)) ?? "";
  } catch {
    /* not JSON — the raw body is the best we have */
  }
  if (!message) {
    message = text.trim() || fallback;
  }
  throw Object.assign(new Error(message), { status });
};

const EMPTY_SUMMARY: FeedbackSummary = {
  totalResponses: 0,
  averageRating: null,
  categoryAverages: {},
  last30DaysResponses: 0,
};

/**
 * GET /feedback/summary + /feedback + /feedback/recovery + /restaurant/users —
 * the Flutter `feedbackModule` load. Summary and items failing is fatal
 * (throws); recovery and users failing simply leaves those lists empty.
 */
export const fetchFeedbackBundle = async (scope: FeedbackScope): Promise<FeedbackBundle> => {
  const [summaryRes, itemsRes] = await Promise.all([
    requestBackend<FeedbackSummary>({ ...scope, path: "/feedback/summary", method: "GET" }),
    requestBackend<{ items?: FeedbackEntry[] }>({ ...scope, path: "/feedback", method: "GET" }),
  ]);
  if (!summaryRes.ok) {
    throwBackendError(summaryRes.status, summaryRes.text, "Couldn't load feedback.");
  }
  if (!itemsRes.ok) {
    throwBackendError(itemsRes.status, itemsRes.text, "Couldn't load feedback.");
  }

  const [recoveryRes, usersRes] = await Promise.all([
    requestBackend<{ tickets?: RecoveryTicket[] }>({ ...scope, path: "/feedback/recovery", method: "GET" }),
    requestBackend<{ users?: FeedbackEmployee[] }>({ ...scope, path: "/restaurant/users", method: "GET" }),
  ]);

  return {
    summary: summaryRes.data ?? EMPTY_SUMMARY,
    items: Array.isArray(itemsRes.data?.items) ? itemsRes.data.items : [],
    tickets: recoveryRes.ok && Array.isArray(recoveryRes.data?.tickets) ? recoveryRes.data.tickets : [],
    employees: usersRes.ok && Array.isArray(usersRes.data?.users) ? usersRes.data.users : [],
  };
};

/**
 * POST /feedback/recovery/:id/resolve — Flutter `_resolveRecovery`. The note
 * is omitted from the body when blank, exactly as the app sends it. Throws
 * the server's sentence on refusal.
 */
export const resolveRecoveryTicket = async (
  scope: FeedbackScope,
  ticketId: string,
  note: string,
): Promise<void> => {
  const trimmed = note.trim();
  const response = await requestBackend({
    ...scope,
    path: `/feedback/recovery/${encodeURIComponent(ticketId)}/resolve`,
    method: "POST",
    body: trimmed.length > 0 ? { note: trimmed } : {},
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't resolve the ticket.");
  }
};

/* ── Concerns board ───────────────────────────────────────────────────── */

export type ConcernSeverity = "high" | "medium" | "low";

/** One concern off GET /analytics/concerns — an `AttentionRow` plus the
 *  board-only fields (`title`, `what_to_do`). */
export interface Concern {
  key: string;
  /** `title ?? label`, the headline the board renders. */
  title: string;
  count: number;
  severity: ConcernSeverity;
  /** Legacy single-label route older payloads shipped — the fallback only. */
  module: string;
  detail: string;
  items: AttentionItem[];
  /** Money at stake, when the row is about money. */
  amount: number | null;
  what_to_do: string;
  deep_link: AttentionDeepLink;
}

export interface ConcernsPayload {
  window_days: number;
  generated_at: string;
  totals: Partial<Record<ConcernSeverity, number>>;
  concerns: Concern[];
}

const asSeverity = (v: unknown): ConcernSeverity =>
  v === "high" || v === "medium" ? v : "low";

const asStr = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(typeof v === "string" ? v : "");
  return Number.isFinite(n) ? n : null;
};

const mapConcern = (raw: Record<string, unknown>): Concern => {
  const link = (raw.deep_link ?? {}) as Record<string, unknown>;
  return {
    key: asStr(raw.key),
    title: (asStr(raw.title) || asStr(raw.label)).trim(),
    count: Math.round(asNum(raw.count) ?? 0),
    severity: asSeverity(raw.severity),
    module: asStr(raw.module),
    detail: asStr(raw.detail).trim(),
    items: Array.isArray(raw.items)
      ? raw.items.filter((it): it is AttentionItem => it != null && typeof it === "object")
      : [],
    amount: raw.amount == null ? null : asNum(raw.amount),
    what_to_do: asStr(raw.what_to_do).trim(),
    deep_link: {
      module: asStr(link.module),
      params:
        link.params != null && typeof link.params === "object"
          ? (link.params as Record<string, string>)
          : undefined,
      href: asStr(link.href) || undefined,
    },
  };
};

/**
 * GET /analytics/concerns?days=N — everything that needs a person, worst
 * first. EXTENDS the Overview strip's `needs_attention` server-side, so the
 * two screens can never disagree. Throws like every fetcher here.
 */
export const fetchConcerns = async (scope: FeedbackScope, days = 30): Promise<ConcernsPayload> => {
  const response = await requestBackend<Record<string, unknown>>({
    ...scope,
    path: `/analytics/concerns?days=${encodeURIComponent(String(days))}`,
    method: "GET",
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't load concerns.");
  }
  const raw = response.data ?? {};
  const totalsRaw = (raw.totals ?? {}) as Record<string, unknown>;
  return {
    window_days: Math.round(asNum(raw.window_days) ?? 30),
    generated_at: asStr(raw.generated_at),
    totals: {
      high: asNum(totalsRaw.high) == null ? undefined : Math.round(asNum(totalsRaw.high) ?? 0),
      medium: asNum(totalsRaw.medium) == null ? undefined : Math.round(asNum(totalsRaw.medium) ?? 0),
      low: asNum(totalsRaw.low) == null ? undefined : Math.round(asNum(totalsRaw.low) ?? 0),
    },
    concerns: Array.isArray(raw.concerns)
      ? raw.concerns
          .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
          .map(mapConcern)
      : [],
  };
};
