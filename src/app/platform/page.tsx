"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
	getPlatformAuth,
	listRestaurants,
	listPlans,
	suspendRestaurant,
	activateRestaurant,
	setSubscription,
	createPlan,
	updatePlan,
	platformLogout,
	listInvoices,
	createInvoice,
	markInvoicePaid,
	getPlatformHealth,
	getPlatformAudit,
	resetOwnerPassword,
	runBilling,
	createRestaurant,
	archiveRestaurant,
	restoreRestaurant,
	type PlatformRestaurant,
	type PlatformPlan,
	type PlatformInvoice,
	type PlatformHealth,
	type PlatformAuditEntry,
	type CreatedRestaurant,
} from "@/lib/platform";
import {
	EMPTY_CREATE_RESTAURANT_FORM,
	archiveConfirmationMatches,
	buildCreateRestaurantBody,
	describePlatformError,
	normalizeRestaurantSlug,
	validateCreateRestaurant,
} from "@/lib/platform-restaurant-actions";

export default function PlatformDashboard() {
	const router = useRouter();
	const [restaurants, setRestaurants] = useState<PlatformRestaurant[]>([]);
	const [plans, setPlans] = useState<PlatformPlan[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Non-failure feedback, kept apart from `error` so an archive that succeeded AND
	// stranded open bills can report both without one masquerading as the other.
	const [notice, setNotice] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	// Archived tenants stay in the list by default. A hidden row is how an operator
	// concludes a restaurant was deleted.
	const [showArchived, setShowArchived] = useState(true);
	const [newPlan, setNewPlan] = useState({ code: "", name: "", price: "", employees: "" });
	const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

	const [health, setHealth] = useState<PlatformHealth | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [r, p] = await Promise.all([listRestaurants(), listPlans()]);
			setRestaurants(r.restaurants);
			setPlans(p.plans);
			// Health is best-effort — never block the dashboard on it.
			getPlatformHealth().then(setHealth).catch(() => { setHealth(null); });
		} catch (err: any) {
			if (err?.message === "Unauthorized") {
				router.push("/platform/login");
				return;
			}
			setError(err?.message ?? "Failed to load");
		} finally {
			setLoading(false);
		}
	}, [router]);

	useEffect(() => {
		if (!getPlatformAuth()) {
			router.push("/platform/login");
			return;
		}
		void load();
	}, [load, router]);

	const run = async (id: string, fn: () => Promise<unknown>) => {
		setBusyId(id);
		setNotice(null);
		try {
			// Keep the result: restore answers 200 even when the tenant is back but
			// unsignable, and says so in `warning`. Throwing that away left the
			// operator with a green tick and a restaurant whose staff are locked out.
			const out = (await fn()) as { warning?: string } | undefined;
			if (out?.warning) { setNotice(out.warning); }
			await load();
		} catch (err) {
			// The backend's own sentence — "This restaurant is archived. Use Restore to
			// bring it back." is an instruction; "Action failed" is not.
			setError(describePlatformError(err, "Action failed"));
		} finally {
			setBusyId(null);
		}
	};

	// Billing history modal state.
	const [billingFor, setBillingFor] = useState<PlatformRestaurant | null>(null);
	const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
	const [invoicesLoading, setInvoicesLoading] = useState(false);
	const [billingBusy, setBillingBusy] = useState(false);
	const money = (cents: number) => `₹${(Number(cents ?? 0) / 100).toFixed(2)}`;

	const openBilling = async (r: PlatformRestaurant) => {
		setBillingFor(r);
		setInvoices([]);
		setInvoicesLoading(true);
		try {
			const res = await listInvoices(r.id);
			setInvoices(res.invoices);
		} catch (err: any) {
			setError(err?.message ?? "Failed to load invoices");
		} finally {
			setInvoicesLoading(false);
		}
	};

	const recordCharge = async (status: "paid" | "pending") => {
		if (!billingFor) {return;}
		setBillingBusy(true);
		try {
			await createInvoice(billingFor.id, { status });
			const res = await listInvoices(billingFor.id);
			setInvoices(res.invoices);
		} catch (err: any) {
			setError(err?.message ?? "Failed to record charge");
		} finally {
			setBillingBusy(false);
		}
	};

	// Confirm an offline payment: mark the invoice paid AND activate its plan.
	const markPaid = async (invoiceId: string) => {
		if (!billingFor) {return;}
		setBillingBusy(true);
		try {
			await markInvoicePaid(invoiceId);
			const res = await listInvoices(billingFor.id);
			setInvoices(res.invoices);
			await load(); // plan/status on the restaurant row may have changed
		} catch (err: any) {
			setError(err?.message ?? "Failed to mark paid");
		} finally {
			setBillingBusy(false);
		}
	};

	// Audit log modal.
	const [auditOpen, setAuditOpen] = useState(false);
	const [audit, setAudit] = useState<PlatformAuditEntry[]>([]);
	const [auditLoading, setAuditLoading] = useState(false);
	const openAudit = async () => {
		setAuditOpen(true);
		setAuditLoading(true);
		try {
			const res = await getPlatformAudit();
			setAudit(res.entries);
		} catch (err: any) {
			setError(err?.message ?? "Failed to load audit log");
		} finally {
			setAuditLoading(false);
		}
	};

	// Reset-owner-password modal.
	const [resetFor, setResetFor] = useState<PlatformRestaurant | null>(null);
	const [resetPw, setResetPw] = useState("");
	const [resetBusy, setResetBusy] = useState(false);
	const [resetMsg, setResetMsg] = useState<string | null>(null);
	const doResetOwner = async () => {
		if (!resetFor || resetPw.trim().length < 4) {return;}
		setResetBusy(true);
		setResetMsg(null);
		try {
			const res = await resetOwnerPassword(resetFor.id, resetPw.trim());
			setResetMsg(`Password updated for owner @${res.username}. Their sessions were signed out.`);
			setResetPw("");
		} catch (err: any) {
			setResetMsg(err?.message ?? "Failed to reset owner password");
		} finally {
			setResetBusy(false);
		}
	};

	// --- Add a restaurant ---------------------------------------------------
	// The only place in the product where an operator can bring a tenant into
	// existence (the other path, POST /auth/register-restaurant, is public
	// self-serve). On success the response carries the owner's temporary password
	// ONCE, so the modal switches into a result state that must not be dismissed by
	// a stray backdrop click.
	const [createOpen, setCreateOpen] = useState(false);
	const [createForm, setCreateForm] = useState(EMPTY_CREATE_RESTAURANT_FORM);
	const [slugEdited, setSlugEdited] = useState(false);
	const [createBusy, setCreateBusy] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createResult, setCreateResult] = useState<CreatedRestaurant | null>(null);
	const [copied, setCopied] = useState(false);

	const openCreate = () => {
		setCreateForm(EMPTY_CREATE_RESTAURANT_FORM);
		setSlugEdited(false);
		setCreateError(null);
		setCreateResult(null);
		setCopied(false);
		setCreateOpen(true);
	};
	const closeCreate = () => { setCreateOpen(false); };

	const doCreate = async (e: FormEvent) => {
		e.preventDefault();
		const invalid = validateCreateRestaurant(createForm);
		if (invalid) {
			setCreateError(invalid);
			return;
		}
		setCreateBusy(true);
		setCreateError(null);
		try {
			const created = await createRestaurant(buildCreateRestaurantBody(createForm));
			setCreateResult(created);
			await load();
		} catch (err) {
			// Verbatim. A slug collision answers 409 naming the slug, and choosing a
			// different one is the operator's next move — "Failed to create restaurant"
			// would send them to look for a fault that isn't there.
			setCreateError(describePlatformError(err, "Failed to create restaurant"));
		} finally {
			setCreateBusy(false);
		}
	};

	const copyTemporaryPassword = async () => {
		if (!createResult) {return;}
		try {
			await navigator.clipboard.writeText(createResult.owner.temporary_password);
			setCopied(true);
		} catch {
			// The clipboard API needs a secure context. The password is still on screen
			// and selectable, so say that rather than losing it.
			setCreateError("Couldn't reach the clipboard — select the password above and copy it by hand.");
		}
	};

	// --- Archive / restore ---------------------------------------------------
	// Archiving deletes nothing and Restore is its exact inverse, but it signs out
	// every staff session and cancels the subscription — done to the wrong row in
	// the middle of service that is a restaurant which cannot take an order or
	// settle the bills already on its tables. So the confirm is typing the name,
	// not clicking OK.
	const [archiveFor, setArchiveFor] = useState<PlatformRestaurant | null>(null);
	const [archiveConfirm, setArchiveConfirm] = useState("");
	const [archiveReason, setArchiveReason] = useState("");
	const [archiveBusy, setArchiveBusy] = useState(false);
	const [archiveError, setArchiveError] = useState<string | null>(null);
	const archiveConfirmed = archiveFor !== null && archiveConfirmationMatches(archiveConfirm, archiveFor.res_name);

	const openArchive = (r: PlatformRestaurant) => {
		setArchiveFor(r);
		setArchiveConfirm("");
		setArchiveReason("");
		setArchiveError(null);
	};

	const doArchive = async () => {
		// Re-checked here, not only on the button's disabled state: this is the guard.
		if (!archiveFor || !archiveConfirmed) {return;}
		const target = archiveFor;
		setArchiveBusy(true);
		setArchiveError(null);
		try {
			const res = await archiveRestaurant(target.id, archiveReason.trim() || undefined);
			setArchiveFor(null);
			await load();
			// The open-bill count arrives WITH the archive — no endpoint reports it
			// beforehand — so it is said here, after the fact. Those bills stay open on
			// occupied tables and no one can sign in to settle them until a restore.
			setNotice(
				res.open_bills
					? `${target.res_name} archived. ${String(res.open_bills)} bill(s) were still open and stay unsettled — restore the restaurant if staff need to close them.`
					: `${target.res_name} archived. Its orders, bills, tax records and audit history are kept.`,
			);
		} catch (err) {
			setArchiveError(describePlatformError(err, "Failed to archive restaurant"));
		} finally {
			setArchiveBusy(false);
		}
	};

	const onLogout = async () => {
		await platformLogout();
		router.push("/platform/login");
	};

	const onCreatePlan = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		try {
			await createPlan({
				code: newPlan.code.trim(),
				name: newPlan.name.trim(),
				price_cents: newPlan.price ? Math.round(Number(newPlan.price) * 100) : 0,
				limits: newPlan.employees ? { employees: Number(newPlan.employees) } : {},
			});
			setNewPlan({ code: "", name: "", price: "", employees: "" });
			await load();
		} catch (err: any) {
			setError(err?.message ?? "Failed to create plan");
		}
	};

	const onTogglePlan = (p: PlatformPlan) => run(p.id, () => updatePlan(p.id, { active: !p.active }));

	// Premium features a plan can include. Anything NOT set false here is allowed
	// (fail-open), so unchecking a box paywalls that area for the plan's tenants.
	const GATEABLE_FEATURES: { key: string; label: string }[] = [
		{ key: "accounting", label: "Accounting & cash" },
		{ key: "analytics", label: "Analytics" },
		{ key: "inventory", label: "Inventory & purchasing" },
		{ key: "valet", label: "Valet" },
		{ key: "coupons", label: "Coupons" },
		{ key: "attendance", label: "Attendance" },
		{ key: "multi_outlet", label: "Multi-outlet" },
	];
	const onToggleFeature = (p: PlatformPlan, key: string, include: boolean) =>
		run(p.id, () => updatePlan(p.id, { features: { ...(p.features ?? {}), [key]: include } }));

	// Archived tenants are counted on their own and left out of every other tile.
	// "Restaurants: 40" is a number an operator quotes to someone, so it has to mean
	// 40 restaurants they actually have — not 40 including the 12 who left. And a
	// departed tenant is a settled outcome, so it must not sit in "Needs attention"
	// forever, which is where a plain `account_status !== "active"` would park it.
	const liveRestaurants = restaurants.filter((r) => r.account_status !== "archived");
	const visibleRestaurants = showArchived ? restaurants : liveRestaurants;
	const stats = {
		total: liveRestaurants.length,
		archived: restaurants.length - liveRestaurants.length,
		active: liveRestaurants.filter((r) => r.account_status === "active").length,
		attention: liveRestaurants.filter(
			(r) => r.account_status !== "active" || ["past_due", "expired", "suspended", "cancelled"].includes(r.sub_status ?? ""),
		).length,
		trial: liveRestaurants.filter((r) => r.sub_status === "trial").length,
		staff: liveRestaurants.reduce((s, r) => s + (r.employees ?? 0), 0),
		outlets: liveRestaurants.reduce((s, r) => s + (r.outlets ?? 0), 0),
	};

	const statusBadge = (status: string) => {
		// Grey, not red: an archived tenant and the cancelled subscription that goes
		// with it are the intended end state of a deliberate operator action, not a
		// fault anyone should be chasing.
		const tone =
			status === "active"
				? "bg-green-100 text-green-800"
				: status === "expired"
					? "bg-amber-100 text-amber-800"
					: status === "archived" || status === "cancelled"
						? "bg-muted text-muted-foreground"
						: "bg-red-100 text-red-800";
		return <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
	};

	return (
		<div className="min-h-screen bg-muted/20 p-6">
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold">Platform overview</h1>
						<p className="text-sm text-muted-foreground">Monitor and manage every restaurant on your platform</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={() => { openCreate(); }}
							className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
						>
							Add restaurant
						</button>
						<button
							onClick={async () => {
								try {
									const r = await runBilling();
									setError(null);
									await load();
									alert(`Billing run complete: ${r.generated} invoice(s) generated, ${r.advanced} subscription(s) advanced.`);
								} catch (err: any) {
									setError(err?.message ?? "Billing run failed");
								}
							}}
							className="rounded-md border px-3 py-1.5 text-sm"
							title="Generate due invoices now (also runs automatically every day)"
						>
							Run billing
						</button>
						<button onClick={() => void openAudit()} className="rounded-md border px-3 py-1.5 text-sm">
							Audit log
						</button>
						<button onClick={() => void load()} disabled={loading} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">
							{loading ? "Refreshing…" : "Refresh"}
						</button>
						<button onClick={onLogout} className="rounded-md border px-3 py-1.5 text-sm">
							Sign out
						</button>
					</div>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}
				{notice && <p className="text-sm text-muted-foreground">{notice}</p>}

				{/* System health banner */}
				{health && (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-2 text-sm">
						<span className="flex items-center gap-1.5">
							<span className={`inline-block h-2 w-2 rounded-full ${health.db ? "bg-green-500" : "bg-red-500"}`} />
							<span className="font-medium">Database</span>
							<span className="text-muted-foreground">{health.db ? "connected" : "unreachable"}</span>
						</span>
						{health.fleet && (
							<span className="text-muted-foreground">
								{health.fleet.new_this_week} new this week · {health.fleet.suspended} suspended
								{health.fleet.archived ? ` · ${String(health.fleet.archived)} archived` : null}
							</span>
						)}
						{health.subscriptions && health.subscriptions.trials_expiring_soon > 0 && (
							<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
								{health.subscriptions.trials_expiring_soon} trial{health.subscriptions.trials_expiring_soon > 1 ? "s" : ""} expiring ≤7d
							</span>
						)}
						<span className="ml-auto text-xs text-muted-foreground">checked {new Date(health.ts).toLocaleTimeString()}</span>
					</div>
				)}

				{/* At-a-glance health */}
				<div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${stats.archived > 0 ? "lg:grid-cols-7" : "lg:grid-cols-6"}`}>
					<Stat label="Restaurants" value={stats.total} />
					<Stat label="Active" value={stats.active} tone="green" />
					<Stat label="Needs attention" value={stats.attention} tone={stats.attention > 0 ? "red" : undefined} />
					<Stat label="Trialing" value={stats.trial} tone="amber" />
					<Stat label="Total staff" value={stats.staff} />
					<Stat label="Total outlets" value={stats.outlets} />
					{stats.archived > 0 && <Stat label="Archived" value={stats.archived} />}
				</div>

				{/* Subscription plans */}
				<div className="rounded-lg border bg-card p-4 space-y-3">
					<h2 className="font-medium">Subscription plans</h2>
					<form onSubmit={onCreatePlan} className="flex flex-wrap items-end gap-2">
						<div className="space-y-1">
							<label className="block text-xs text-muted-foreground">Code</label>
							<input value={newPlan.code} onChange={(e) => { setNewPlan({ ...newPlan, code: e.target.value }); }} placeholder="starter" required className="block rounded-md border px-2 py-1 text-sm" />
						</div>
						<div className="space-y-1">
							<label className="block text-xs text-muted-foreground">Name</label>
							<input value={newPlan.name} onChange={(e) => { setNewPlan({ ...newPlan, name: e.target.value }); }} placeholder="Starter" required className="block rounded-md border px-2 py-1 text-sm" />
						</div>
						<div className="space-y-1">
							<label className="block text-xs text-muted-foreground">Price (₹/mo)</label>
							<input value={newPlan.price} onChange={(e) => { setNewPlan({ ...newPlan, price: e.target.value }); }} type="number" min="0" step="0.01" placeholder="0" className="block w-24 rounded-md border px-2 py-1 text-sm" />
						</div>
						<div className="space-y-1">
							<label className="block text-xs text-muted-foreground">Max staff</label>
							<input value={newPlan.employees} onChange={(e) => { setNewPlan({ ...newPlan, employees: e.target.value }); }} type="number" min="0" placeholder="unlimited" className="block w-28 rounded-md border px-2 py-1 text-sm" />
						</div>
						<button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Add plan</button>
					</form>
					<div className="flex flex-wrap gap-2">
						{plans.map((p) => (
							<div key={p.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
								<span className="font-medium">{p.name}</span>
								<span className="text-xs text-muted-foreground">₹{(p.price_cents / 100).toFixed(2)}/mo</span>
								<button
									disabled={busyId === p.id}
									onClick={() => onTogglePlan(p)}
									className={`rounded px-2 py-0.5 text-xs ${p.active ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}
								>
									{p.active ? "active" : "inactive"}
								</button>
								<button
									onClick={() => { setEditingPlanId(editingPlanId === p.id ? null : p.id); }}
									className="rounded px-2 py-0.5 text-xs underline text-muted-foreground hover:text-foreground"
								>
									Features
								</button>
							</div>
						))}
						{plans.length === 0 && <span className="text-sm text-muted-foreground">No plans yet.</span>}
					</div>

					{editingPlanId && (() => {
						const p = plans.find((x) => x.id === editingPlanId);
						if (!p) {return null;}
						const feats = (p.features ?? {});
						return (
							<div className="mt-3 rounded-lg border bg-muted/30 p-3">
								<p className="mb-2 text-sm font-medium">Included features — {p.name}</p>
								<p className="mb-3 text-xs text-muted-foreground">Unchecked = excluded (tenants on this plan get a 403 for that area). Core POS is always included.</p>
								<div className="flex flex-wrap gap-3">
									{GATEABLE_FEATURES.map((f) => {
										const included = feats[f.key] !== false;
										return (
											<label key={f.key} className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
												<input
													type="checkbox"
													checked={included}
													disabled={busyId === p.id}
													onChange={(e) => onToggleFeature(p, f.key, e.target.checked)}
												/>
												{f.label}
											</label>
										);
									})}
								</div>
							</div>
						);
					})()}
				</div>

				{loading ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : (
					<div className="space-y-2">
						{stats.archived > 0 && (
							<div className="flex items-center justify-between">
								<h2 className="font-medium">Restaurants</h2>
								<label className="flex items-center gap-2 text-xs text-muted-foreground">
									<input
										type="checkbox"
										checked={showArchived}
										onChange={(e) => { setShowArchived(e.target.checked); }}
									/>
									Show archived ({stats.archived})
								</label>
							</div>
						)}
						<div className="overflow-x-auto rounded-lg border bg-card">
							<table className="w-full text-sm">
								<thead className="border-b bg-muted/40 text-left">
									<tr>
										<th className="px-4 py-2 font-medium">Restaurant</th>
										<th className="px-4 py-2 font-medium">Account</th>
										<th className="px-4 py-2 font-medium">Subscription</th>
										<th className="px-4 py-2 font-medium">Plan</th>
										<th className="px-4 py-2 font-medium">Staff</th>
										<th className="px-4 py-2 font-medium">Outlets</th>
										<th className="px-4 py-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{visibleRestaurants.map((r) => (
										<tr key={r.id} className={`border-b last:border-0 ${r.account_status === "archived" ? "opacity-60" : ""}`}>
											<td className="px-4 py-3">
												<div className="font-medium">{r.res_name}</div>
												<div className="text-xs text-muted-foreground">{r.res_username}</div>
											</td>
											<td className="px-4 py-3">{statusBadge(r.account_status)}</td>
											<td className="px-4 py-3">{r.sub_status ? statusBadge(r.sub_status) : <span className="text-xs text-muted-foreground">none</span>}</td>
											<td className="px-4 py-3">{r.plan_name ?? <span className="text-xs text-muted-foreground">—</span>}</td>
											<td className="px-4 py-3 text-muted-foreground">{r.employees ?? "—"}</td>
											<td className="px-4 py-3 text-muted-foreground">{r.outlets ?? "—"}</td>
											<td className="px-4 py-3">
												<div className="flex flex-wrap items-center gap-2">
													{r.account_status === "archived" ? (
														// An archived tenant has no live sessions, no subscription and nothing
														// running to gate, so Suspend, the plan picker and Reset owner would all
														// be acting on a restaurant that is not trading — and Activate in
														// particular would half-revive it: live again, but on the cancelled
														// subscription archiving left behind, i.e. unbilled. Restore is the way
														// back. Billing stays, because the invoice history is precisely what
														// archiving preserves.
														<>
															<button
																disabled={busyId === r.id}
																onClick={() => {
																	if (confirm(`Bring ${r.res_name} back into service? Staff will be able to sign in again.`)) {
																		void run(r.id, () => restoreRestaurant(r.id));
																	}
																}}
																className="rounded-md border border-green-300 px-2 py-1 text-xs text-green-700 disabled:opacity-50"
																title="Bring this restaurant back into service"
															>
																Restore
															</button>
															<button onClick={() => void openBilling(r)} className="rounded-md border px-2 py-1 text-xs">
																Billing
															</button>
														</>
													) : (
														<>
															{r.account_status === "active" ? (
																<button
																	disabled={busyId === r.id}
																	onClick={() => run(r.id, () => suspendRestaurant(r.id))}
																	className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
																>
																	Suspend
																</button>
															) : (
																<button
																	disabled={busyId === r.id}
																	onClick={() => run(r.id, () => activateRestaurant(r.id))}
																	className="rounded-md border border-green-300 px-2 py-1 text-xs text-green-700 disabled:opacity-50"
																>
																	Activate
																</button>
															)}
															<select
																disabled={busyId === r.id}
																defaultValue=""
																onChange={(e) => {
																	const planId = e.target.value;
																	if (planId) {void run(r.id, () => setSubscription(r.id, { plan_id: planId, status: "active" }));}
																}}
																className="rounded-md border px-2 py-1 text-xs"
															>
																<option value="" disabled>
																	Assign plan…
																</option>
																{plans.map((p) => (
																	<option key={p.id} value={p.id}>
																		{p.name}
																	</option>
																))}
															</select>
															<button
																onClick={() => void openBilling(r)}
																className="rounded-md border px-2 py-1 text-xs"
															>
																Billing
															</button>
															<button
																onClick={() => { setResetFor(r); setResetPw(""); setResetMsg(null); }}
																className="rounded-md border px-2 py-1 text-xs"
																title="Reset the owner's password if they're locked out"
															>
																Reset owner
															</button>
															<button
																disabled={busyId === r.id}
																onClick={() => { openArchive(r); }}
																className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 disabled:opacity-50"
																title="Take this restaurant out of service. Reversible, and every order, bill and tax record is kept."
															>
																Archive
															</button>
														</>
													)}
												</div>
											</td>
										</tr>
									))}
									{visibleRestaurants.length === 0 && (
										<tr>
											<td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
												{restaurants.length === 0 ? "No restaurants yet." : "Every restaurant is archived — tick “Show archived” to see them."}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</div>
			{billingFor && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setBillingFor(null); }}>
					<div className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-lg" onClick={(e) => { e.stopPropagation(); }}>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-lg font-semibold">Billing · {billingFor.res_name}</h2>
							<button onClick={() => { setBillingFor(null); }} className="text-sm text-muted-foreground">Close</button>
						</div>
						<div className="mb-3 flex gap-2">
							<button disabled={billingBusy} onClick={() => void recordCharge("paid")} className="rounded-md border border-green-300 px-3 py-1 text-sm text-green-700 disabled:opacity-50">Record payment</button>
							<button disabled={billingBusy} onClick={() => void recordCharge("pending")} className="rounded-md border px-3 py-1 text-sm disabled:opacity-50">Mark pending</button>
						</div>
						<div className="max-h-[50vh] overflow-y-auto">
							{invoicesLoading ? (
								<p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
							) : invoices.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">No invoices yet. Use the buttons above to record a charge.</p>
							) : (
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b text-left text-xs text-muted-foreground">
											<th className="py-2">Date</th><th>Plan</th><th>Amount</th><th>Status</th><th></th>
										</tr>
									</thead>
									<tbody>
										{invoices.map((inv) => (
											<tr key={inv.id} className="border-b last:border-0">
												<td className="py-2">{new Date(inv.created_at).toLocaleDateString()}</td>
												<td>{inv.plan_name ?? "—"}</td>
												<td>{money(inv.amount_cents)}</td>
												<td>{inv.status}</td>
												<td className="text-right">
													{inv.status === "pending" && (
														<button
															disabled={billingBusy}
															onClick={() => void markPaid(inv.id)}
															className="rounded-md border border-green-300 px-2 py-0.5 text-xs text-green-700 disabled:opacity-50"
														>
															Mark paid
														</button>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Add-restaurant modal. Two states: the form, and then the credentials it
			    hands back — the only moment the owner's password ever exists anywhere. */}
			{createOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					onClick={() => {
						// Backdrop dismissal is disabled while the password is on screen: it is
						// shown once and nothing can bring it back.
						if (!createResult) { closeCreate(); }
					}}
				>
					<div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-lg" onClick={(e) => { e.stopPropagation(); }}>
						{createResult ? (
							<>
								<h2 className="mb-3 text-lg font-semibold">{createResult.restaurant.res_name} is ready</h2>
								<p className="mb-3 text-sm text-muted-foreground">
									Hand these to the owner. The password is shown <span className="font-medium text-foreground">once</span> — it is not stored anywhere and cannot be shown again. If it is lost, use “Reset owner” on their row.
								</p>
								<dl className="mb-3 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
									<div className="flex items-baseline justify-between gap-3">
										<dt className="text-muted-foreground">Restaurant ID</dt>
										<dd className="font-mono">{createResult.restaurant.res_username}</dd>
									</div>
									<div className="flex items-baseline justify-between gap-3">
										<dt className="text-muted-foreground">Owner username</dt>
										<dd className="font-mono">{createResult.owner.username}</dd>
									</div>
									<div className="flex items-baseline justify-between gap-3">
										<dt className="text-muted-foreground">Temporary password</dt>
										<dd className="select-all break-all font-mono">{createResult.owner.temporary_password}</dd>
									</div>
								</dl>
								<p className="mb-3 text-xs text-muted-foreground">
									Nothing forces a change at first sign-in, so tell the owner to set their own password under Settings.
								</p>
								{createError && <p className="mb-3 text-sm text-destructive">{createError}</p>}
								<div className="flex justify-end gap-2">
									<button onClick={() => void copyTemporaryPassword()} className="rounded-md border px-3 py-1.5 text-sm">
										{copied ? "Copied" : "Copy password"}
									</button>
									<button onClick={closeCreate} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
										Done
									</button>
								</div>
							</>
						) : (
							<form onSubmit={(e) => void doCreate(e)}>
								<div className="mb-3 flex items-center justify-between">
									<h2 className="text-lg font-semibold">Add restaurant</h2>
									<button type="button" onClick={closeCreate} className="text-sm text-muted-foreground">Close</button>
								</div>
								<p className="mb-3 text-sm text-muted-foreground">
									Creates the restaurant, its first outlet and an owner login. A temporary password is generated and shown once when this succeeds.
								</p>
								<div className="grid gap-3 sm:grid-cols-2">
									<div className="space-y-1">
										<label className="block text-xs text-muted-foreground">Restaurant name</label>
										<input
											value={createForm.resName}
											onChange={(e) => {
												const resName = e.target.value;
												setCreateForm((f) => ({
													...f,
													resName,
													// The ID follows the name only until the operator edits it
													// themselves — being able to fix a colliding or ugly derived
													// one is the whole reason this form exists.
													resUsername: slugEdited ? f.resUsername : normalizeRestaurantSlug(resName),
												}));
											}}
											placeholder="The Rustic Fork"
											maxLength={120}
											required
											className="block w-full rounded-md border px-2 py-1.5 text-sm"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-xs text-muted-foreground">Restaurant ID</label>
										<input
											value={createForm.resUsername}
											onChange={(e) => {
												// Normalized on every keystroke, so what is on screen is exactly
												// what gets stored — the backend rejects a supplied value that
												// changes under its own normalizer, and this makes that
												// rejection unreachable.
												const resUsername = normalizeRestaurantSlug(e.target.value);
												setSlugEdited(true);
												setCreateForm((f) => ({ ...f, resUsername }));
											}}
											placeholder="therusticfork"
											className="block w-full rounded-md border px-2 py-1.5 font-mono text-sm"
										/>
										<p className="text-xs text-muted-foreground">Lowercase letters and digits. It goes into every QR link and cannot be changed later.</p>
									</div>
									<div className="space-y-1">
										<label className="block text-xs text-muted-foreground">Owner name</label>
										<input
											value={createForm.ownerName}
											onChange={(e) => { const ownerName = e.target.value; setCreateForm((f) => ({ ...f, ownerName })); }}
											placeholder="Priya Nair"
											maxLength={120}
											required
											className="block w-full rounded-md border px-2 py-1.5 text-sm"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-xs text-muted-foreground">Owner username</label>
										<input
											value={createForm.ownerUsername}
											onChange={(e) => { const ownerUsername = e.target.value; setCreateForm((f) => ({ ...f, ownerUsername })); }}
											placeholder="priya"
											maxLength={120}
											required
											className="block w-full rounded-md border px-2 py-1.5 font-mono text-sm"
										/>
										<p className="text-xs text-muted-foreground">What the owner types to sign in.</p>
									</div>
									<div className="space-y-1 sm:col-span-2">
										<label className="block text-xs text-muted-foreground">Plan</label>
										<select
											value={createForm.planId}
											onChange={(e) => { const planId = e.target.value; setCreateForm((f) => ({ ...f, planId })); }}
											className="block w-full rounded-md border px-2 py-1.5 text-sm"
										>
											<option value="">Start a trial — no plan sold yet</option>
											{plans.map((pl) => (
												<option key={pl.id} value={pl.id}>
													{pl.name} · ₹{(pl.price_cents / 100).toFixed(2)}/mo
												</option>
											))}
										</select>
									</div>
									<div className="space-y-1 sm:col-span-2">
										<label className="block text-xs text-muted-foreground">Address (optional)</label>
										<input
											value={createForm.address}
											onChange={(e) => { const address = e.target.value; setCreateForm((f) => ({ ...f, address })); }}
											className="block w-full rounded-md border px-2 py-1.5 text-sm"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-xs text-muted-foreground">Phone (optional)</label>
										<input
											value={createForm.phone}
											onChange={(e) => { const phone = e.target.value; setCreateForm((f) => ({ ...f, phone })); }}
											className="block w-full rounded-md border px-2 py-1.5 text-sm"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-xs text-muted-foreground">Email (optional)</label>
										<input
											value={createForm.email}
											onChange={(e) => { const email = e.target.value; setCreateForm((f) => ({ ...f, email })); }}
											type="email"
											className="block w-full rounded-md border px-2 py-1.5 text-sm"
										/>
									</div>
								</div>
								{createError && <p className="mt-3 text-sm text-destructive">{createError}</p>}
								<div className="mt-4 flex justify-end gap-2">
									<button type="button" onClick={closeCreate} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
									<button
										type="submit"
										disabled={createBusy}
										className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
									>
										{createBusy ? "Creating…" : "Create restaurant"}
									</button>
								</div>
							</form>
						)}
					</div>
				</div>
			)}

			{/* Reset-owner-password modal */}
			{resetFor && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setResetFor(null); }}>
					<div className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg" onClick={(e) => { e.stopPropagation(); }}>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-lg font-semibold">Reset owner password</h2>
							<button onClick={() => { setResetFor(null); }} className="text-sm text-muted-foreground">Close</button>
						</div>
						<p className="mb-3 text-sm text-muted-foreground">
							Sets a new password for the owner (first admin) of <span className="font-medium text-foreground">{resetFor.res_name}</span> and signs out their live sessions. Use this when the owner is locked out.
						</p>
						<input
							type="text"
							value={resetPw}
							onChange={(e) => { setResetPw(e.target.value); }}
							placeholder="New password (min 4 chars)"
							className="mb-3 block w-full rounded-md border px-2 py-1.5 text-sm"
						/>
						{resetMsg && <p className="mb-3 text-sm">{resetMsg}</p>}
						<div className="flex justify-end gap-2">
							<button onClick={() => { setResetFor(null); }} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
							<button
								disabled={resetBusy || resetPw.trim().length < 4}
								onClick={() => void doResetOwner()}
								className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
							>
								{resetBusy ? "Setting…" : "Set password"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Archive-restaurant modal. The confirmation is typing the restaurant's
			    name: archiving is reversible, but on the wrong row mid-service it takes
			    a trading restaurant offline, and an OK button is one mis-click away. */}
			{archiveFor && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setArchiveFor(null); }}>
					<div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-5 shadow-lg" onClick={(e) => { e.stopPropagation(); }}>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-lg font-semibold">Archive {archiveFor.res_name}</h2>
							<button onClick={() => { setArchiveFor(null); }} className="text-sm text-muted-foreground">Close</button>
						</div>
						<div className="mb-3 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
							<p>
								<span className="font-medium">Kept:</span> every order, bill, tax record, invoice and audit entry. Nothing is deleted, and Restore undoes this.
							</p>
							<p>
								<span className="font-medium">Stops now:</span> staff can no longer sign in, and every live session is signed out. The subscription is cancelled, so billing stops.
							</p>
							<p className="text-muted-foreground">
								Guest QR ordering is <span className="font-medium text-foreground">not</span> blocked yet, so orders can still arrive with nobody able to sign in and settle them. Any bill already open stays open on an occupied table until this restaurant is restored.
							</p>
						</div>
						<div className="mb-3 space-y-1">
							<label className="block text-xs text-muted-foreground">Reason (optional — recorded in the audit log)</label>
							<input
								value={archiveReason}
								onChange={(e) => { setArchiveReason(e.target.value); }}
								placeholder="Closed the business"
								maxLength={500}
								className="block w-full rounded-md border px-2 py-1.5 text-sm"
							/>
						</div>
						<div className="mb-3 space-y-1">
							<label className="block text-xs text-muted-foreground">
								Type <span className="font-medium text-foreground">{archiveFor.res_name}</span> to confirm
							</label>
							<input
								value={archiveConfirm}
								onChange={(e) => { setArchiveConfirm(e.target.value); }}
								autoFocus
								className="block w-full rounded-md border px-2 py-1.5 text-sm"
							/>
						</div>
						{archiveError && <p className="mb-3 text-sm text-destructive">{archiveError}</p>}
						<div className="flex justify-end gap-2">
							<button onClick={() => { setArchiveFor(null); }} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
							<button
								disabled={archiveBusy || !archiveConfirmed}
								onClick={() => void doArchive()}
								className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50"
							>
								{archiveBusy ? "Archiving…" : "Archive restaurant"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Audit log modal */}
			{auditOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setAuditOpen(false); }}>
					<div className="w-full max-w-2xl rounded-lg border bg-card p-5 shadow-lg" onClick={(e) => { e.stopPropagation(); }}>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-lg font-semibold">Audit log</h2>
							<button onClick={() => { setAuditOpen(false); }} className="text-sm text-muted-foreground">Close</button>
						</div>
						<div className="max-h-[60vh] overflow-y-auto">
							{auditLoading ? (
								<p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
							) : audit.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">No audit entries yet.</p>
							) : (
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b text-left text-xs text-muted-foreground">
											<th className="py-2">When</th><th>Admin</th><th>Action</th><th>Target</th>
										</tr>
									</thead>
									<tbody>
										{audit.map((a) => (
											<tr key={a.id} className="border-b last:border-0 align-top">
												<td className="py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
												<td className="pr-2 text-xs">{a.admin_email ?? a.admin_id ?? "—"}</td>
												<td className="pr-2 font-medium">{a.action}</td>
												<td className="text-xs text-muted-foreground">{a.target_name ?? a.target_res_id ?? "—"}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "red" | "amber" }) {
	const toneCls =
		tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
	return (
		<div className="rounded-lg border bg-card p-3">
			<div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
			<div className="text-xs text-muted-foreground">{label}</div>
		</div>
	);
}
