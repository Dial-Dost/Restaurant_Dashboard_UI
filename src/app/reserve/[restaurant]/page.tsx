"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { guestBackendBase } from "@/lib/guest-backend";
import { isMobile10, MOBILE_10_ERROR, normalizeMobile10, sanitizePhoneInput } from "@/lib/phone";

const BASE = guestBackendBase();
const DEFAULT_ACCENT = "#ea580c";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// yyyy-mm-dd -> dd/mm/yyyy
function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

// Same lazy checkout.js loader as the ordering/billing pages.
function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {resolve(false); return;}
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) {resolve(true); return;}
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => { resolve(true); };
    s.onerror = () => { resolve(false); };
    document.body.appendChild(s);
  });
}

// Reservation-deposit checkout state (set when the backend answers the reserve
// request with deposit_required).
interface DepositInfo {
  booking_id: string;
  order_id: string;
  key_id: string;
  amount: number;
  table_name: string | null;
  min_spend?: number;
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

export default function ReservePage() {
  const params = useParams();
  const restaurant = String((params as Record<string, unknown>)?.restaurant ?? "");

  const [restaurantName, setRestaurantName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("19:00");
  const [party, setParty] = useState(2);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ table_name: string | null; deposit_paid?: boolean; min_spend?: number } | null>(null);
  // Set when the restaurant requires a deposit for this booking: the guest must
  // complete Razorpay checkout before the reservation reaches the staff list.
  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [depositErr, setDepositErr] = useState<string | null>(null);
  const [payingDeposit, setPayingDeposit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/branding`, { cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setRestaurantName(data?.restaurant_name ?? restaurant);
          setLogoUrl(typeof data?.logo_url === "string" ? data.logo_url : "");
          // Reservation page uses the logo's SECONDARY tone so it reads distinct
          // from the ordering page; falls back to theme_color.
          const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
          const themePref = hex(data?.theme_secondary) ?? hex(data?.theme_color);
          if (themePref) {setAccent(themePref);}
        }
      } catch {/* ignore */}
    })();
  }, [restaurant]);

  // POST /qr/:slug/reserve requires a 10-digit mobile, so keep submit disabled
  // until the field actually is one — otherwise the guest fills the whole form
  // and only then gets a 400.
  const phoneOk = isMobile10(phone);
  const canSubmit = useMemo(
    () => Boolean(name.trim()) && phoneOk && Boolean(date) && Boolean(time) && party > 0 && !submitting,
    [name, phoneOk, date, time, party, submitting],
  );

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const iso = new Date(`${date}T${time}`).toISOString();
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: normalizeMobile10(phone) ?? phone.trim(),
          email: email.trim() || undefined,
          party_size: party,
          date: iso,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {throw new Error(data?.error ?? "Could not create the reservation");}
      const minSpend = Number(data?.min_spend) > 0 ? Number(data.min_spend) : undefined;
      if (data?.deposit_required && data?.order_id && data?.key_id && data?.booking_id) {
        const info: DepositInfo = {
          booking_id: String(data.booking_id),
          order_id: String(data.order_id),
          key_id: String(data.key_id),
          amount: Number(data.amount) || 0,
          table_name: data?.table_name ?? null,
          min_spend: minSpend,
        };
        setDeposit(info);
        void payDeposit(info);
      } else {
        setDone({ table_name: data?.table_name ?? null, min_spend: minSpend });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the reservation");
    } finally {
      setSubmitting(false);
    }
  };

  // Open Razorpay checkout for the reservation deposit, then confirm it with
  // the backend (signature verify). Retry-able — the same order stays payable.
  const payDeposit = async (info: DepositInfo) => {
    setPayingDeposit(true);
    setDepositErr(null);
    try {
      const ready = await loadRazorpay();
      if (!ready) {throw new Error("Couldn't load the payment gateway. Check your connection and retry.");}
      const RZP = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
      const rzp = new RZP({
        key: info.key_id,
        amount: Math.round(info.amount * 100),
        currency: "INR",
        order_id: info.order_id,
        name: restaurantName || restaurant,
        description: "Reservation deposit",
        prefill: { name: name.trim(), contact: phone.trim(), email: email.trim() || undefined },
        theme: { color: accent },
        modal: {
          ondismiss: () => {
            setPayingDeposit(false);
            setDepositErr("Payment not completed — your table isn't held until the deposit is paid.");
          },
        },
        handler: async (resp: Record<string, string>) => {
          try {
            const vr = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/reserve/verify-deposit`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ booking_id: info.booking_id, ...resp }),
            });
            const vd = await vr.json();
            if (!vr.ok) {throw new Error(vd?.error ?? "Deposit verification failed");}
            setDeposit(null);
            setDone({ table_name: info.table_name, deposit_paid: true, min_spend: info.min_spend });
          } catch (e) {
            setDepositErr(e instanceof Error ? e.message : "Deposit verification failed");
          } finally {
            setPayingDeposit(false);
          }
        },
      });
      rzp.open();
    } catch (e) {
      setPayingDeposit(false);
      setDepositErr(e instanceof Error ? e.message : "Couldn't start the deposit payment");
    }
  };

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✅</div>
        <h1 className="text-2xl font-bold text-neutral-800">Reservation requested!</h1>
        <p className="text-neutral-600">
          Thanks {name.trim()} — we&apos;ve received your request for {party} {party > 1 ? "people" : "person"} on{" "}
          {dmy(date)} at {time}.
        </p>
        {done.deposit_paid && (
          <p className="rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800">
            Deposit paid — thank you! It will be adjusted or refunded as per the restaurant&apos;s policy.
          </p>
        )}
        {typeof done.min_spend === "number" && done.min_spend > 0 && (
          <p className="text-sm text-neutral-500">
            Please note: this booking carries a minimum spend of ₹{done.min_spend}.
          </p>
        )}
        {done.table_name ? (
          <p className="text-sm text-neutral-500">A table is held for you. The restaurant will confirm shortly.</p>
        ) : (
          // No single table could hold the party. The public page has no way to
          // show a staff seating chooser (the suggester is staff-only), and we
          // never club tables behind anyone's back — so say so plainly and point
          // the guest at the phone. The request is still recorded for the staff.
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            We couldn&apos;t hold a single table for {party} {party > 1 ? "guests" : "guest"} automatically. Your request has
            been sent to the restaurant — please call them to confirm, as a large party may need two tables put together.
          </p>
        )}
      </div>
    );
  }

  if (deposit) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl">💳</div>
        <h1 className="text-2xl font-bold text-neutral-800">Deposit required</h1>
        <p className="text-neutral-600">
          {restaurantName || restaurant} asks for a <span className="font-semibold">₹{deposit.amount}</span> deposit to
          hold a table for {party} {party > 1 ? "people" : "person"} on {dmy(date)} at {time}.
        </p>
        {typeof deposit.min_spend === "number" && deposit.min_spend > 0 && (
          <p className="text-sm text-neutral-500">This booking carries a minimum spend of ₹{deposit.min_spend}.</p>
        )}
        {depositErr && <p className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-700">{depositErr}</p>}
        <button
          onClick={() => payDeposit(deposit)}
          disabled={payingDeposit}
          className="w-full rounded-2xl py-4 font-semibold text-white shadow disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}
        >
          {payingDeposit ? "Opening payment…" : `Pay ₹${deposit.amount} deposit`}
        </button>
        <p className="text-xs text-neutral-400">
          Your reservation stays &quot;awaiting deposit&quot; until the payment completes.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-neutral-50 pb-10">
      <header className="px-6 pb-8 pt-8 text-white" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}>
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl bg-white/90 object-contain p-1" />
          )}
          <div>
            <p className="text-sm uppercase tracking-wider text-white/80">Book a table</p>
            <h1 className="text-3xl font-bold leading-tight">{restaurantName || restaurant}</h1>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-5">
        <Field label="Your name">
          <input value={name} onChange={(e) => { setName(e.target.value); }} className={inputCls} placeholder="Full name" />
        </Field>
        <Field label="Phone number">
          <input
            value={phone}
            onChange={(e) => { setPhone(sanitizePhoneInput(e.target.value)); }}
            className={inputCls}
            placeholder="10-digit mobile"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={13}
          />
          {phone.length > 0 && !phoneOk && <p className="mt-1 text-xs text-red-600">{MOBILE_10_ERROR}</p>}
        </Field>
        <Field label="Email (optional)">
          <input value={email} onChange={(e) => { setEmail(e.target.value); }} className={inputCls} placeholder="you@email.com" inputMode="email" />
        </Field>

        <div className="flex gap-3">
          <Field label="Date" className="flex-1">
            <input type="date" value={date} min={todayStr()} onChange={(e) => { setDate(e.target.value); }} className={inputCls} />
            <p className="mt-1 text-xs text-neutral-400">{dmy(date)}</p>
          </Field>
          <Field label="Time" className="flex-1">
            <input type="time" value={time} onChange={(e) => { setTime(e.target.value); }} className={inputCls} />
          </Field>
        </div>

        <Field label="Party size">
          <div className="flex items-center gap-4" style={{ color: "black" }}>
            <button onClick={() => { setParty((p) => Math.max(1, p - 1)); }} className="h-10 w-10 rounded-full bg-white text-xl shadow ring-1 ring-neutral-200">−</button>
            <span className="w-10 text-center text-xl font-bold">{party}</span>
            <button onClick={() => { setParty((p) => Math.min(30, p + 1)); }} className="h-10 w-10 rounded-full bg-orange-600 text-xl text-white shadow">+</button>
            <span className="text-sm text-neutral-500">{party > 1 ? "guests" : "guest"}</span>
          </div>
        </Field>

        <Field label="Special requests (optional)">
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); }} rows={2} className={inputCls} placeholder="High chair, window seat, allergies…" />
        </Field>

        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full rounded-2xl py-4 font-semibold text-white shadow disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}
        >
          {submitting ? "Requesting…" : "Request reservation"}
        </button>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-800 outline-none focus:border-orange-400";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}
