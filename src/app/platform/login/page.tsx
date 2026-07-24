"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { platformLogin } from "@/lib/platform";

export default function PlatformLoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const onSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await platformLogin(email, password);
			router.push("/platform");
		} catch (err: any) {
			setError(err?.message ?? "Login failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
			<form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm space-y-4">
				<div>
					<h1 className="text-xl font-semibold">Platform Admin</h1>
					<p className="text-sm text-muted-foreground">SaaS control plane sign-in</p>
				</div>
				{error && <p className="text-sm text-destructive">{error}</p>}
				<div className="space-y-1">
					<label className="text-sm font-medium" htmlFor="email">Email</label>
					<input
						id="email"
						type="email"
						autoComplete="username"
						value={email}
						onChange={(e) => { setEmail(e.target.value); }}
						className="w-full rounded-md border px-3 py-2 text-sm"
						required
					/>
				</div>
				<div className="space-y-1">
					<label className="text-sm font-medium" htmlFor="password">Password</label>
					<input
						id="password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => { setPassword(e.target.value); }}
						className="w-full rounded-md border px-3 py-2 text-sm"
						required
					/>
				</div>
				<button
					type="submit"
					disabled={busy}
					className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
				>
					{busy ? "Signing in…" : "Sign in"}
				</button>
			</form>
		</div>
	);
}
