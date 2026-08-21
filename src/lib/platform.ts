// Client for the SaaS control-plane API. Platform-admin auth is kept entirely
// separate from the tenant `authUser` — it uses its own token under a different
// localStorage key and never shares the tenant session.

const BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, "");
const STORAGE_KEY = "platformAuth";

export interface PlatformAdmin { id: string; email: string; name: string | null }
interface PlatformAuth { token: string; admin: PlatformAdmin }

export function getPlatformAuth(): PlatformAuth | null {
	if (typeof window === "undefined") {return null;}
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as PlatformAuth) : null;
	} catch {
		return null;
	}
}

function setPlatformAuth(v: PlatformAuth | null): void {
	if (typeof window === "undefined") {return;}
	if (v) {window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));}
	else {window.localStorage.removeItem(STORAGE_KEY);}
}

async function platformFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
	const auth = getPlatformAuth();
	const headers = new Headers(init?.headers);
	if (auth?.token) {headers.set("Authorization", `Bearer ${auth.token}`);}
	if (init?.body && !headers.has("Content-Type")) {headers.set("Content-Type", "application/json");}

	const res = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
	if (res.status === 401) {
		setPlatformAuth(null);
		throw new Error("Unauthorized");
	}
	const text = await res.text();
	const data = text ? JSON.parse(text) : null;
	if (!res.ok) {throw new Error(data?.error ?? `Request failed (${res.status})`);}
	return data as T;
}

export async function platformLogin(email: string, password: string): Promise<PlatformAuth> {
	const data = await platformFetch<PlatformAuth>("/platform/auth/login", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	setPlatformAuth(data);
	return data;
}

export async function platformLogout(): Promise<void> {
	try {
		await platformFetch("/platform/auth/logout", { method: "POST" });
	} catch {
		/* ignore */
	}
	setPlatformAuth(null);
}

export interface PlatformRestaurant {
	id: string;
	res_username: string;
	res_name: string;
	account_status: string;
	created_at: string;
	sub_status: string | null;
	trial_ends_at: string | null;
	current_period_end: string | null;
	plan_code: string | null;
	plan_name: string | null;
	employees: number | null;
	outlets: number | null;
}

export interface PlatformPlan {
	id: string;
	code: string;
	name: string;
	price_cents: number;
	active: boolean;
	features?: Record<string, unknown>;
	limits?: Record<string, unknown>;
}

export const listRestaurants = () =>
	platformFetch<{ restaurants: PlatformRestaurant[] }>("/platform/restaurants");

export const listPlans = () => platformFetch<{ plans: PlatformPlan[] }>("/platform/plans");

export const createPlan = (body: {
	code: string;
	name: string;
	price_cents?: number;
	features?: Record<string, unknown>;
	limits?: Record<string, unknown>;
}) => platformFetch<{ plan: PlatformPlan }>("/platform/plans", { method: "POST", body: JSON.stringify(body) });

export const updatePlan = (
	id: string,
	body: Partial<{ name: string; price_cents: number; active: boolean; features: Record<string, unknown>; limits: Record<string, unknown> }>,
) => platformFetch<{ plan: PlatformPlan }>(`/platform/plans/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const suspendRestaurant = (id: string) =>
	platformFetch(`/platform/restaurants/${id}/suspend`, { method: "POST" });

export const activateRestaurant = (id: string) =>
	platformFetch(`/platform/restaurants/${id}/activate`, { method: "POST" });

// --- Tenant lifecycle: create, and the reversible half of "remove" ---------

export interface CreateRestaurantInput {
	res_name: string;
	/**
	 * The slug written to "Restaurant".res_username. Omit it and the backend
	 * derives one from res_name; supply one and it must already be normalized —
	 * POST /platform/restaurants answers 400 if the value changes under its own
	 * normalizer. Use normalizeRestaurantSlug() before sending.
	 */
	res_username?: string;
	owner_name: string;
	owner_username: string;
	/** A plan the operator already sold. Omitted, the tenant starts on a trial. */
	plan_id?: string;
	address?: string;
	phone?: string;
	email?: string;
}

export interface CreatedRestaurant {
	restaurant: { id: string; res_username: string; res_name: string };
	owner: {
		username: string;
		/**
		 * Generated server-side and returned exactly ONCE, here. It is never stored,
		 * never audited and cannot be shown again; a lost one is replaced with
		 * resetOwnerPassword. Do not persist it anywhere on the client.
		 */
		temporary_password: string;
	};
}

// Answers 409 when the slug is taken, with a message that names it — surface
// that sentence rather than a generic failure, it is the operator's next step.
export const createRestaurant = (body: CreateRestaurantInput) =>
	platformFetch<CreatedRestaurant>("/platform/restaurants", { method: "POST", body: JSON.stringify(body) });

/**
 * Take a restaurant out of service. This is NOT a delete — the backend has no
 * delete route, deliberately: every tenant table cascades from "Restaurant"(id),
 * so one DELETE would erase the tenant's orders, bills, GST breakdowns and audit
 * log irrecoverably. Archiving sets account_status = 'archived', cancels the
 * subscription and revokes every live staff session; not one row is removed.
 * restoreRestaurant is its exact inverse.
 *
 * `open_bills` is how many bills were still open at that moment. They stay open
 * and unsettled — and this response is the ONLY place that count is reported.
 */
export const archiveRestaurant = (id: string, reason?: string) =>
	platformFetch<{ ok: true; account_status: string; open_bills?: number | null; already_archived?: boolean }>(
		`/platform/restaurants/${id}/archive`,
		{ method: "POST", body: JSON.stringify(reason ? { reason } : {}) },
	);

/**
 * Bring an archived restaurant back. Restores the subscription to whatever it
 * was before the archive (read from that archive's own audit entry), so
 * `subscription_status` can be null when the backend could not recover it — the
 * plan then has to be re-assigned by hand. Staff sessions are not restored.
 */
export const restoreRestaurant = (id: string) =>
	platformFetch<{
		ok: true;
		account_status: string;
		subscription_status: string | null;
		// Present when the tenant is back but its staff still cannot sign in: the
		// subscription could not be rolled back to a signable status. Surfacing this
		// is the whole point - a restore that reads "done" while nobody can log in is
		// the worst possible outcome for an operator.
		current_subscription_status?: string | null;
		requires_plan_assignment?: boolean;
		warning?: string;
	}>(
		`/platform/restaurants/${id}/restore`,
		{ method: "POST" },
	);

export const setSubscription = (
	id: string,
	body: { plan_id?: string; status: string; trial_ends_at?: string; current_period_end?: string },
) => platformFetch(`/platform/restaurants/${id}/subscription`, { method: "PUT", body: JSON.stringify(body) });

export interface PlatformInvoice {
	id: string;
	res_id: string;
	plan_id: string | null;
	amount_cents: number;
	status: string;
	period_start: string | null;
	period_end: string | null;
	note: string | null;
	created_at: string;
	plan_name?: string | null;
	restaurant_name?: string | null;
}

export const listInvoices = (id: string) =>
	platformFetch<{ invoices: PlatformInvoice[] }>(`/platform/restaurants/${id}/invoices`);

// --- Monitoring + intervention -------------------------------------------
export interface PlatformHealth {
	db: boolean;
	ts: string;
	fleet?: { total: number; active: number; suspended: number; archived?: number; new_this_week: number } | null;
	subscriptions?: { by_status: Record<string, number>; trials_expiring_soon: number };
}

export const getPlatformHealth = () => platformFetch<PlatformHealth>("/platform/health");

export interface PlatformAuditEntry {
	id: string;
	admin_id: string | null;
	action: string;
	target_res_id: string | null;
	detail: unknown;
	created_at: string;
	admin_email: string | null;
	target_name: string | null;
}

export const getPlatformAudit = (resId?: string) =>
	platformFetch<{ entries: PlatformAuditEntry[] }>(
		`/platform/audit${resId ? `?res_id=${encodeURIComponent(resId)}` : ""}`,
	);

export const resetOwnerPassword = (id: string, password: string) =>
	platformFetch<{ ok: true; username: string }>(`/platform/restaurants/${id}/reset-owner-password`, {
		method: "POST",
		body: JSON.stringify({ password }),
	});

// Manually trigger the recurring-billing run (also runs automatically daily).
export const runBilling = () =>
	platformFetch<{ ok: true; generated: number; advanced: number }>("/platform/billing/run", { method: "POST" });

export const createInvoice = (
	id: string,
	body: { amount_cents?: number; status?: string; note?: string; period_start?: string; period_end?: string },
) => platformFetch<{ invoice: PlatformInvoice }>(`/platform/restaurants/${id}/invoices`, { method: "POST", body: JSON.stringify(body) });

// Mark an existing (pending) invoice paid AND activate its plan — for confirming
// an offline/manual payment.
export const markInvoicePaid = (invoiceId: string) =>
	platformFetch<{ ok: true }>(`/platform/invoices/${invoiceId}/mark-paid`, { method: "POST" });
