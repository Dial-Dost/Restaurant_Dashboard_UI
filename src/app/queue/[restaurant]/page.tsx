"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { guestBackendBase } from "@/lib/guest-backend";

const BASE = guestBackendBase();
const DEFAULT_ACCENT = "#ea580c";

type MenuItem = { id: string; name: string; price: number; category: string; image_url?: string; available?: boolean };
type PreItem = { id: string; name: string; price: number; quantity: number };
type Entry = {
  id: string;
  token: string;
  name: string;
  status: "waiting" | "called" | "seated" | "cancelled" | "no_show";
  position: number;
  party_size: number;
  pre_order: PreItem[];
  table_name: string | null;
  qr_token?: string | null;
};

// Darken/tint a #rrggbb accent for gradients + soft backgrounds. The accent is the
// restaurant's BRAND colour; light/dark of the surrounding UI comes from the app
// theme tokens (so text stays readable in either mode).
function shade(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const amt = Math.round(2.55 * pct);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
function tint(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "rgba(234,88,12,0.14)";
  const num = parseInt(m[1], 16);
  return `rgba(${num >> 16}, ${(num >> 8) & 0xff}, ${num & 0xff}, 0.14)`;
}
// Readable text/icon colour to place ON the accent — white for dark accents,
// near-black for pale ones — so a light brand colour never yields white-on-white.
function onAccent(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#ffffff";
  const num = parseInt(m[1], 16);
  const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#1c1917" : "#ffffff";
}

function QueueInner() {
  const params = useParams();
  const restaurant = String((params as Record<string, unknown>)?.restaurant ?? "");
  const search = useSearchParams();
  const outlet = search.get("outlet") ?? ""; // multi-outlet: branch QR carries ?outlet=<id>
  const urlToken = search.get("token"); // party-share: a member scanned the joiner's QR
  const storeKey = `waitlist_token_${restaurant}`;
  const ownerKey = `waitlist_owner_${restaurant}`; // the token THIS device originated (vs. a shared party link it merely followed)

  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState<{ name: string; logo: string | null; accent: string; currency: string; showMenu: boolean }>({
    name: restaurant, logo: null, accent: DEFAULT_ACCENT, currency: "₹", showMenu: true,
  });
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartSeeded, setCartSeeded] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [shareQr, setShareQr] = useState("");
  const tabsRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, scroll: 0, moved: false });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(2);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [showCalled, setShowCalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Party-guest capture: a device that opened a shared ?token= it did NOT originate.
  // We ask THIS person for their name/phone once and add them as a party member.
  const [isPartyGuest, setIsPartyGuest] = useState(false);
  const [memberDone, setMemberDone] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const money = (n: number) => `${brand.currency}${Number(n || 0).toFixed(0)}`;

  // Load branding + menu once.
  useEffect(() => {
    if (!restaurant) return;
    (async () => {
      try {
        const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/menu`);
        if (r.ok) {
          const d = await r.json();
          // Accent precedence matches the order page: logo-derived primary → the
          // admin-set theme_color → the shared default, so all customer surfaces match.
          setBrand({ name: d.restaurant_name ?? restaurant, logo: d.logo_url ?? null, accent: d.theme_primary || d.theme_color || DEFAULT_ACCENT, currency: d.currency || "₹", showMenu: d.queue_show_menu !== false });
          setMenu(Array.isArray(d.items) ? d.items : []);
        }
      } catch { /* offline */ }
    })();
  }, [restaurant]);

  // Resume an existing queue entry: prefer a ?token= from the URL (a party member
  // scanned the joiner's share QR) and persist it so this device becomes a full
  // participant; otherwise fall back to this device's own saved token. A ?token=
  // this device did NOT originate (no matching owner marker) is a PARTY GUEST — we
  // capture their name/phone as a party member. The original joiner (owner marker
  // matches, or reopening their own share link) is never treated as a guest.
  useEffect(() => {
    try {
      const owned = localStorage.getItem(ownerKey);
      if (urlToken) {
        const guest = owned !== urlToken;
        setIsPartyGuest(guest);
        if (guest) {
          try { setMemberDone(localStorage.getItem(`waitlist_member_${restaurant}_${urlToken}`) === "1"); } catch { /* ignore */ }
        }
        localStorage.setItem(storeKey, urlToken);
        setToken(urlToken);
      } else {
        const t = localStorage.getItem(storeKey);
        if (t) {
          setToken(t);
          // Backfill ownership so a device resuming its OWN saved entry is never
          // mistaken for a party guest if it later reopens via its share link.
          if (!owned) { try { localStorage.setItem(ownerKey, t); } catch { /* ignore */ } }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [storeKey, ownerKey, urlToken, restaurant]);

  // Poll the entry status while we have a token.
  useEffect(() => {
    if (!token) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}`);
        if (r.status === 404) { if (active) { try { localStorage.removeItem(storeKey); } catch {} setToken(null); setEntry(null); } return; }
        if (r.ok && active) {
          const d = await r.json();
          // Staff ended this entry → stop polling and reset to a fresh join form.
          if (d?.status === "cancelled" || d?.status === "no_show") {
            try { localStorage.removeItem(storeKey); } catch {}
            setToken(null); setEntry(null);
            return;
          }
          setEntry(d);
        }
      } catch { /* keep last */ }
    };
    void tick();
    const id = setInterval(tick, 6000);
    return () => { active = false; clearInterval(id); };
  }, [token, restaurant, storeKey]);

  // Seed the cart from a saved pre-order the first time the entry loads.
  useEffect(() => {
    if (entry && !cartSeeded) {
      const seed: Record<string, number> = {};
      for (const it of entry.pre_order ?? []) seed[it.id] = it.quantity;
      if (Object.keys(seed).length) setCart(seed);
      setCartSeeded(true);
    }
  }, [entry, cartSeeded]);

  // "It's your turn" → pop-up + browser notification + vibrate. Fires once per
  // entry whenever we observe 'called' — including the FIRST observed state after a
  // tab reopen/refresh (an ack flag in localStorage prevents re-firing on later polls).
  useEffect(() => {
    if (!entry || entry.status !== "called") return;
    const ackKey = `waitlist_called_${restaurant}_${entry.token}`;
    let acked = false;
    try { acked = localStorage.getItem(ackKey) === "1"; } catch { /* ignore */ }
    if (acked) return;
    setShowCalled(true);
    try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(`${brand.name}: your table is ready!`, { body: "Please head to the host." }); } catch { /* ignore */ }
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
    try { localStorage.setItem(ackKey, "1"); } catch { /* ignore */ }
  }, [entry, brand.name, restaurant]);

  // Once seated, send the party straight to THEIR table's menu (signed token from
  // the backend) — the queue link becomes the ordering link.
  useEffect(() => {
    if (entry?.status === "seated" && entry.qr_token && typeof window !== "undefined") {
      const url = `/order/${encodeURIComponent(restaurant)}?t=${encodeURIComponent(entry.qr_token)}`
        + (outlet ? `&outlet=${encodeURIComponent(outlet)}` : "");
      window.location.replace(url);
    }
  }, [entry?.status, entry?.qr_token, restaurant, outlet]);

  // A shareable QR of THIS party's queue link so others in the group can scan,
  // watch the same spot in line, and add to the pre-order together.
  useEffect(() => {
    if (!entry || typeof window === "undefined" || (entry.status !== "waiting" && entry.status !== "called")) { setShareQr(""); return; }
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set("token", entry.token);
    if (outlet) u.searchParams.set("outlet", outlet);
    QRCode.toDataURL(u.toString(), { width: 512, margin: 2 }).then(setShareQr).catch(() => setShareQr(""));
  }, [entry, outlet]);

  const join = async () => {
    if (!name.trim()) { setError("Please enter your name"); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), party_size: party, ...(outlet ? { outlet } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error ?? "Could not join the queue"); return; }
      try { localStorage.setItem(storeKey, d.token); localStorage.setItem(ownerKey, d.token); } catch {}
      try { if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); } catch {}
      setToken(d.token);
    } catch { setError("Network error — please try again"); }
    finally { setBusy(false); }
  };

  const cartItems = useCallback((): PreItem[] => {
    return Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => { const m = menu.find((x) => x.id === id); return m ? { id, name: m.name, price: m.price, quantity: q } : null; })
      .filter((x): x is PreItem => x != null);
  }, [cart, menu]);

  const savePreorder = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}/preorder`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cartItems() }),
      });
      if (r.ok) setSavedAt(Date.now());
    } catch {}
    finally { setBusy(false); }
  };

  // Party guest introduces themselves → appended to the host's party_members.
  // Phone must carry >=7 digits (matches the backend); dedupe/cap is server-side.
  const submitMember = async () => {
    if (!token) return;
    const nm = memberName.trim();
    if (!nm) { setMemberError("Please enter your name"); return; }
    if (memberPhone.replace(/\D/g, "").length < 7) { setMemberError("Please enter a valid phone number"); return; }
    setMemberBusy(true); setMemberError(null);
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}/member`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, phone: memberPhone.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMemberError(d?.error ?? "Could not add you to the group"); return; }
      try { localStorage.setItem(`waitlist_member_${restaurant}_${token}`, "1"); } catch {}
      setMemberDone(true);
    } catch { setMemberError("Network error — please try again"); }
    finally { setMemberBusy(false); }
  };

  const leave = async () => {
    if (!token) return;
    setBusy(true);
    try { await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}/cancel`, { method: "POST" }); } catch {}
    try { localStorage.removeItem(storeKey); } catch {}
    setToken(null); setEntry(null); setCart({}); setCartSeeded(false); setBusy(false);
  };

  // Menu grouped by category (like the order interface).
  const availableMenu = useMemo(() => menu.filter((m) => m.available !== false), [menu]);
  const byCategory = useMemo(() => {
    const m: Record<string, MenuItem[]> = {};
    for (const it of availableMenu) (m[it.category || "Menu"] ??= []).push(it);
    return m;
  }, [availableMenu]);
  const categories = useMemo(() => Object.keys(byCategory).sort(), [byCategory]);
  const active = activeCat && categories.includes(activeCat) ? activeCat : categories[0];
  const shown = active ? byCategory[active] ?? [] : [];

  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);
  const cartTotal = cartItems().reduce((s, it) => s + it.price * it.quantity, 0);

  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;

  const accent = brand.accent;
  const ink = onAccent(accent); // readable text/icon colour on top of the accent
  const setQty = (id: string, delta: number) => setCart((c) => { const q = Math.max(0, (c[id] ?? 0) + delta); const n = { ...c }; if (q === 0) delete n[id]; else n[id] = q; return n; });
  const onTabsDown = (e: { clientX: number }) => { const el = tabsRef.current; if (!el) return; drag.current = { down: true, startX: e.clientX, scroll: el.scrollLeft, moved: false }; };
  const onTabsMove = (e: { clientX: number }) => { const el = tabsRef.current; if (!el || !drag.current.down) return; const dx = e.clientX - drag.current.startX; if (Math.abs(dx) > 4) drag.current.moved = true; el.scrollLeft = drag.current.scroll - dx; };
  const onTabsUp = () => { drag.current.down = false; };

  const MenuCard = ({ m }: { m: MenuItem }) => (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      {m.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={m.image_url} alt="" className="h-16 w-16 flex-shrink-0 rounded-xl object-cover" />
        : <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">🍽️</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-card-foreground">{m.name}</p>
        <p className="text-sm text-muted-foreground">{money(m.price)}</p>
      </div>
      {cart[m.id] ? (
        <div className="flex items-center gap-2 rounded-full px-2 py-1" style={{ backgroundColor: tint(accent) }}>
          <button aria-label="Remove one" onClick={() => setQty(m.id, -1)} className="h-7 w-7 rounded-full bg-card text-lg leading-none shadow ring-1 ring-border" style={{ color: accent }}>−</button>
          <span className="w-4 text-center font-semibold" style={{ color: accent }}>{cart[m.id]}</span>
          <button aria-label="Add one" onClick={() => setQty(m.id, 1)} className="h-7 w-7 rounded-full text-lg leading-none shadow" style={{ backgroundColor: accent, color: ink }}>+</button>
        </div>
      ) : (
        <button onClick={() => setQty(m.id, 1)} className="rounded-full px-4 py-2 text-sm font-semibold shadow transition active:scale-95" style={{ backgroundColor: accent, color: ink }}>Add</button>
      )}
    </div>
  );

  return (
    // Uses the app theme tokens (bg-card / text-foreground / …) so it stays readable
    // in BOTH light and dark mode; the restaurant accent is layered on top for brand.
    <div className="min-h-dvh bg-background pb-28 text-foreground">
      {/* Header — brand accent gradient with soft decorative glows */}
      <div className="relative overflow-hidden px-5 pt-9 pb-8 shadow-lg" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -28)})`, color: ink }}>
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-14 left-4 h-36 w-36 rounded-full bg-black/10 blur-2xl" />
        <div className="relative mx-auto flex max-w-md items-center gap-3.5">
          {brand.logo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={brand.logo} alt="" className="h-14 w-14 rounded-2xl bg-white/20 object-cover shadow-lg ring-2 ring-white/40" />
            : <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-2xl shadow-lg ring-2 ring-white/30">🍽️</div>}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{brand.name}</h1>
            <p className="mt-0.5 text-sm opacity-85">Join the queue · Relax · We&apos;ll call you</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-6">
        {!token || !entry || entry.status === "cancelled" || entry.status === "no_show" ? (
          // --- Join form ---
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-card-foreground">Join the waitlist</h2>
            <p className="mb-4 text-sm text-muted-foreground">We&apos;ll alert you here the moment your table is ready.</p>
            <label className="mb-1 block text-sm font-medium text-card-foreground">Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring" style={{ caretColor: accent }} placeholder="Name" />
            <label className="mb-1 block text-sm font-medium text-card-foreground">Phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring" style={{ caretColor: accent }} placeholder="Phone" />
            <label className="mb-1 block text-sm font-medium text-card-foreground">Party size</label>
            <div className="mb-4 flex items-center gap-3">
              <button onClick={() => setParty((p) => Math.max(1, p - 1))} className="h-10 w-10 rounded-lg border bg-background text-xl text-foreground">−</button>
              <span className="w-8 text-center text-lg font-semibold text-card-foreground">{party}</span>
              <button onClick={() => setParty((p) => Math.min(50, p + 1))} className="h-10 w-10 rounded-lg border bg-background text-xl text-foreground">+</button>
            </div>
            {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <button onClick={join} disabled={busy} className="w-full rounded-lg py-2.5 font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60" style={{ background: accent, color: ink }}>
              {busy ? "Joining…" : "Join the queue"}
            </button>
          </div>
        ) : entry.status === "seated" ? (
          <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
            <div className="mb-2 text-4xl">🎉</div>
            <h2 className="text-lg font-semibold text-card-foreground">You&apos;re seated{entry.table_name ? ` at ${entry.table_name}` : ""}!</h2>
            <p className="mt-1 text-sm text-muted-foreground">{entry.pre_order.length ? "Your picks have been sent to the kitchen. Enjoy!" : "Enjoy your meal!"}</p>
            <button onClick={leave} className="mt-4 text-sm text-muted-foreground underline">Done</button>
          </div>
        ) : (
          // --- Waiting / called ---
          <>
            <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
              {entry.status === "called" ? (
                <>
                  <div className="relative mx-auto my-1 flex h-24 w-24 items-center justify-center">
                    <span className="absolute inset-0 rounded-full opacity-30 motion-safe:animate-ping" style={{ background: accent }} />
                    <span className="relative flex h-24 w-24 items-center justify-center rounded-full text-4xl shadow-lg" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -22)})` }}>🔔</span>
                  </div>
                  <h2 className="mt-3 text-xl font-bold" style={{ color: accent }}>Your table is ready!</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Please head to the host to be seated.</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your place in line</p>
                  <div className="relative mx-auto my-3 flex h-28 w-28 items-center justify-center">
                    {entry.position <= 1 && <span className="absolute inset-0 rounded-full opacity-30 motion-safe:animate-ping" style={{ background: accent }} />}
                    <span className="relative flex h-28 w-28 items-center justify-center rounded-full text-5xl font-extrabold leading-none shadow-lg" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -22)})`, color: ink }}>#{entry.position}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{entry.position <= 1 ? "You're next! 🎉" : `${entry.position - 1} ${entry.position - 1 === 1 ? "party" : "parties"} ahead of you`}</p>
                </>
              )}
              <p className="mt-4 text-xs text-muted-foreground">Hi {entry.name} · party of {entry.party_size}</p>
              <button onClick={leave} disabled={busy} className="mt-1.5 text-xs text-muted-foreground underline underline-offset-2 transition hover:text-foreground">Leave the queue</button>
            </div>

            {/* Party guest: capture this scanner's own contact once, then confirm. */}
            {isPartyGuest && !memberDone ? (
              <div className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
                <h3 className="text-base font-semibold text-card-foreground">You&apos;re joining {entry.name}&apos;s group 👋</h3>
                <p className="mb-4 mt-0.5 text-sm text-muted-foreground">Add your name so the host knows you&apos;re here{brand.showMenu ? " — then pick your dishes below" : ""}.</p>
                <label className="mb-1 block text-sm font-medium text-card-foreground">Your name</label>
                <input value={memberName} onChange={(e) => setMemberName(e.target.value)} className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring" style={{ caretColor: accent }} placeholder="Name" />
                <label className="mb-1 block text-sm font-medium text-card-foreground">Your phone</label>
                <input value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} inputMode="tel" className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring" style={{ caretColor: accent }} placeholder="Phone" />
                {memberError ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{memberError}</p> : null}
                <button onClick={submitMember} disabled={memberBusy} className="w-full rounded-lg py-2.5 font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60" style={{ background: accent, color: ink }}>
                  {memberBusy ? "Adding…" : "Add me to the group"}
                </button>
              </div>
            ) : isPartyGuest && memberDone ? (
              <div className="mt-6 flex items-center justify-center gap-1.5 rounded-2xl border bg-card p-3 text-center text-sm text-muted-foreground shadow-sm">
                <span>You&apos;re added to {entry.name}&apos;s group</span>
                <span style={{ color: accent }}>✓</span>
              </div>
            ) : null}

            {shareQr ? (
              <div className="mt-6 rounded-2xl border bg-card p-5 text-center shadow-sm">
                <h3 className="text-base font-semibold text-card-foreground">Bring your party 👥</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">Scan to follow this spot in line together{brand.showMenu ? " and add to the order" : ""}.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shareQr} alt="Share your place in line" className="mx-auto mt-3 h-44 w-44 rounded-md border bg-white p-2" />
              </div>
            ) : null}

            {/* Pre-order while waiting */}
            {brand.showMenu && availableMenu.length > 0 && (
              <div className="mt-6">
                <h3 className="text-base font-semibold text-foreground">Get a head start 🍽️</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">Pick what you&apos;d like — it&apos;s sent to the kitchen automatically when you&apos;re seated.</p>

                {categories.length > 1 && (
                  <div
                    ref={tabsRef}
                    onPointerDown={onTabsDown}
                    onPointerMove={onTabsMove}
                    onPointerUp={onTabsUp}
                    onPointerLeave={onTabsUp}
                    className="mt-3 flex cursor-grab select-none gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"
                  >
                    {categories.map((cat) => {
                      const on = cat === active;
                      return (
                        <button
                          key={cat}
                          onClick={() => { if (!drag.current.moved) setActiveCat(cat); }}
                          className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium shadow-sm transition ${on ? "" : "bg-card text-card-foreground"}`}
                          style={on ? { backgroundColor: accent, borderColor: accent, color: ink } : undefined}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                )}

                {categories.length > 1 && active ? (
                  <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">{active}</h4>
                ) : <div className="mt-3" />}

                <div className="space-y-2">
                  {shown.map((m) => <MenuCard key={m.id} m={m} />)}
                </div>
              </div>
            )}
            {brand.showMenu && availableMenu.length === 0 && menu.length === 0 ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">Menu unavailable right now — you&apos;re still in the queue.</p>
            ) : null}
          </>
        )}
      </div>

      {/* Save-picks bar */}
      {brand.showMenu && token && entry && (entry.status === "waiting" || entry.status === "called") && cartCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="flex-1 text-sm text-card-foreground">
              <span className="font-semibold">{cartCount}</span> item{cartCount === 1 ? "" : "s"} · <span className="font-semibold">{money(cartTotal)}</span>
              {savedAt ? <span className="ml-2 text-green-600 dark:text-green-400">saved ✓</span> : null}
            </div>
            <button onClick={savePreorder} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold shadow transition active:scale-95 disabled:opacity-60" style={{ background: accent, color: ink }}>
              Save my picks
            </button>
          </div>
        </div>
      ) : null}

      {/* "Table ready" pop-up */}
      {showCalled ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setShowCalled(false)}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-5xl">🔔</div>
            <h2 className="text-xl font-bold" style={{ color: accent }}>Your table is ready!</h2>
            <p className="mt-2 text-sm text-muted-foreground">Please head over to the host now to be seated{entry?.pre_order.length ? " — your picks are saved" : ""}.</p>
            <button onClick={() => setShowCalled(false)} className="mt-5 w-full rounded-lg py-2.5 font-semibold shadow-sm" style={{ background: accent, color: ink }}>Got it</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>}>
      <QueueInner />
    </Suspense>
  );
}
