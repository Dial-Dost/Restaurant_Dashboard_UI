"use client";

// Customer-facing display (CFD): a full-screen second-screen page showing the
// table's LIVE running bill — item lines, discount, service charge, taxes and a
// big grand total. Public like /order: the signed table token in ?t= IS the
// auth (no session). Staff open it from the orders page per occupied table and
// point the browser at the counter/customer screen; it polls every 5 seconds.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { guestBackendBase } from "@/lib/guest-backend";

const BASE = guestBackendBase();
const DEFAULT_ACCENT = "#ea580c";
const POLL_MS = 5000;

interface TaxLine { name: string; percentage: number; amount: number }
interface BillData {
  items: { name: string; price: number; quantity: number }[];
  subtotal: number;
  discount: number;
  coupon_code: string | null;
  service_charge: number;
  service_charge_percent: number;
  taxes: TaxLine[];
  tax_total: number;
  grand_total: number;
  payment_status: string | null;
}

// Decode the friendly table name from the opaque ?t= token (base64url(name).sig).
function decodeTableName(token: string): string {
  try {
    const part = token.split(".")[0] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function shade(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) {return hex;}
  const num = parseInt(m[1], 16);
  const amt = Math.round(2.55 * pct);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function CfdInner() {
  const params = useParams();
  const search = useSearchParams();
  const restaurant = String((params as Record<string, unknown>)?.restaurant ?? "");
  const token = search?.get("t") ?? "";
  const tableLabel = useMemo(() => decodeTableName(token), [token]);

  const [restaurantName, setRestaurantName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [currency, setCurrency] = useState("₹");
  const [bill, setBill] = useState<BillData | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Branding (same public fetch the reservation/queue pages use).
  useEffect(() => {
    if (!restaurant) {return;}
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/branding`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !active) {return;}
        setRestaurantName(typeof data.restaurant_name === "string" ? data.restaurant_name : restaurant);
        if (typeof data.logo_url === "string") {setLogoUrl(data.logo_url);}
        const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
        const themePref = hex(data.theme_primary) ?? hex(data.theme_color);
        if (themePref) {setAccent(themePref);}
        if (typeof data.currency === "string" && data.currency.trim()) {setCurrency(data.currency.trim());}
      } catch {/* keep defaults */}
    })();
    return () => { active = false; };
  }, [restaurant]);

  // Live bill — poll every 5s (same endpoint + shape the QR order page reads).
  const loadBill = useCallback(async () => {
    if (!restaurant || !token) {return;}
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/bill?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setBill(null); return; }
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0 && !(Number(data?.grand_total ?? 0) > 0)) { setBill(null); return; }
      setBill({
        items,
        subtotal: Number(data?.subtotal ?? data?.total_amt ?? 0),
        discount: Number(data?.discount ?? 0),
        coupon_code: data?.coupon_code ?? null,
        service_charge: Number(data?.service_charge ?? 0),
        service_charge_percent: Number(data?.service_charge_percent ?? 0),
        taxes: Array.isArray(data?.taxes) ? data.taxes : [],
        tax_total: Number(data?.tax_total ?? 0),
        grand_total: Number(data?.grand_total ?? data?.total_amt ?? 0),
        payment_status: data?.payment_status ?? null,
      });
    } catch {/* keep the previous snapshot on transient errors */}
    finally { setLoaded(true); }
  }, [restaurant, token]);

  useEffect(() => {
    void loadBill();
    const t = setInterval(() => { void loadBill(); }, POLL_MS);
    return () => { clearInterval(t); };
  }, [loadBill]);

  const money = (n: number) => `${currency}${n.toFixed(2)}`;
  const settled = bill?.payment_status === "approved";
  const showThanks = loaded && (!bill || settled);

  const header = (
    <header
      className="flex items-center justify-between px-8 py-5 text-white shadow-md"
      style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -22)})` }}
    >
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="logo" className="h-16 w-16 rounded-2xl bg-white/95 object-contain p-1.5 shadow-lg ring-1 ring-white/40" />
        ) : null}
        <div>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight drop-shadow-sm">{restaurantName || restaurant}</h1>
          <p className="mt-0.5 text-sm font-medium text-white/85">{tableLabel ? `Table ${tableLabel}` : "Your table"}</p>
        </div>
      </div>
      <p className="hidden text-xs font-medium uppercase tracking-[0.25em] text-white/70 sm:block">Your bill · live</p>
    </header>
  );

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-8 text-center text-xl text-neutral-500">
        Open this display from the staff dashboard — the link carries the table&apos;s signed code.
      </div>
    );
  }

  if (showThanks) {
    return (
      <div className="flex min-h-screen flex-col bg-neutral-50">
        {header}
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-center">
            <div className="mb-4 text-7xl">🙏</div>
            <p className="text-4xl font-extrabold text-neutral-800">Thank you!</p>
            <p className="mt-3 text-xl text-neutral-500">
              {settled ? "Your bill is settled. We hope to see you again soon." : "We’ll show your bill here as soon as an order is placed."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded || !bill) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-2xl text-neutral-400">
        Loading your bill…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      {header}
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6 sm:p-8">
        {/* Item lines — counter-display sized. */}
        <div className="flex-1 overflow-y-auto rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
          <ul className="divide-y divide-neutral-100">
            {bill.items.map((it, i) => (
              <li key={`${it.name}-${i}`} className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-2xl font-medium text-neutral-800">
                  <span className="mr-3 inline-block min-w-[2.5rem] font-bold" style={{ color: accent }}>{it.quantity}×</span>
                  {it.name}
                </span>
                <span className="whitespace-nowrap text-2xl font-semibold tabular-nums text-neutral-700">
                  {money(it.price * it.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Totals block. */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
          <dl className="space-y-2 text-xl text-neutral-600">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(bill.subtotal)}</dd></div>
            {bill.discount > 0 && (
              <div className="flex justify-between text-green-700">
                <dt>Discount{bill.coupon_code ? ` (${bill.coupon_code})` : ""}</dt>
                <dd className="tabular-nums">−{money(bill.discount)}</dd>
              </div>
            )}
            {bill.service_charge > 0 && (
              <div className="flex justify-between">
                <dt>Service charge{bill.service_charge_percent ? ` (${bill.service_charge_percent}%)` : ""}</dt>
                <dd className="tabular-nums">{money(bill.service_charge)}</dd>
              </div>
            )}
            {bill.taxes.map((t, i) => (
              <div key={`${t.name}-${i}`} className="flex justify-between">
                <dt>{t.name}{t.percentage ? ` (${t.percentage}%)` : ""}</dt>
                <dd className="tabular-nums">{money(t.amount)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex items-baseline justify-between border-t-2 border-neutral-200 pt-4">
            <span className="text-3xl font-bold text-neutral-800">Total</span>
            <span className="text-6xl font-extrabold tabular-nums tracking-tight" style={{ color: accent }}>
              {money(bill.grand_total)}
            </span>
          </div>
          {bill.payment_status === "pending_approval" && (
            <p className="mt-3 text-right text-lg font-medium text-amber-600">Payment received — awaiting staff confirmation</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomerFacingDisplayPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-neutral-50 text-2xl text-neutral-400">Loading…</div>}>
      <CfdInner />
    </Suspense>
  );
}
