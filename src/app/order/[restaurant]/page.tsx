"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { guestBackendBase } from "@/lib/guest-backend";

const BASE = guestBackendBase();
const DEFAULT_ACCENT = "#ea580c";

type ModOption = { name: string; price: number };
type ModGroup = { name: string; multi: boolean; required: boolean; options: ModOption[] };
type MenuItem = { id: string; name: string; price: number; category: string; image_url?: string; available?: boolean; modifiers?: ModGroup[]; allergens?: string[] };
type CartLine = { key: string; itemId: string; name: string; unitPrice: number; quantity: number };
type PayMethod = { id: string; label: string; enabled?: boolean; requires_screenshot?: boolean; online?: boolean };
type TaxLine = { name: string; percentage: number; amount: number };
type BillData = {
  items: Array<{ name: string; price: number; quantity: number }>;
  subtotal: number;
  discount: number;
  coupon_code: string | null;
  service_charge: number;
  service_charge_percent: number;
  taxes: TaxLine[];
  tax_total: number;
  grand_total: number;
  payment_status: string | null;
};

// Fallback if the restaurant hasn't configured methods (or the API omits them).
const DEFAULT_METHODS: PayMethod[] = [
  { id: "Razorpay", label: "Pay online (Razorpay)", requires_screenshot: false, online: true },
  { id: "Upi", label: "UPI", requires_screenshot: false },
  { id: "Cash", label: "Cash", requires_screenshot: false },
  { id: "Card", label: "Card", requires_screenshot: false },
  { id: "Dineout", label: "Dineout", requires_screenshot: true },
  { id: "Zomato", label: "Zomato", requires_screenshot: true },
  { id: "Eazydiner", label: "EasyDiner", requires_screenshot: true },
  { id: "District", label: "District", requires_screenshot: true },
];

// ---------------------------------------------------------------------------
// Static UI strings, per language. This translates the page CHROME (buttons,
// labels, sheets) only — menu item/category names render as the restaurant
// entered them; translating dish names would need per-item content entry in
// the menu editor (out of scope for now). Choice persists in localStorage.
// ---------------------------------------------------------------------------
type Lang = "en" | "hi";
const LANG_KEY = "qr_menu_lang";
const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    loadingMenu: "Loading menu…",
    scanPrompt: "Scan the QR code at your table to start ordering.",
    thanks: "Thanks for dining with us!",
    settledMsg: "Your bill is settled. To place a new order, please scan the QR code at your table again.",
    yourTable: "Your table",
    table: "Table",
    bill: "Bill",
    tagline: "Scan · Order · Pay — from your table",
    searchPlaceholder: "Search the menu…",
    add: "Add",
    customize: "Customize",
    soldOut: "Sold out",
    noItems: "No items found.",
    reviewCart: "Review cart",
    yourOrder: "Your order",
    reviewSubtitle: "Review your items, then send to the restaurant.",
    emptyCart: "Your cart is empty.",
    notePlaceholder: "Add a note (e.g. no onions, less spicy, allergies)…",
    guestName: "Your name",
    guestPhone: "Phone number",
    contactHint: "Name & phone are required to place your order.",
    contactMissing: "Please enter your name and a valid phone number to order.",
    total: "Total",
    subtotal: "Subtotal",
    discount: "Discount",
    coupon: "Coupon",
    serviceCharge: "Service charge",
    sendOrder: "Send order to the restaurant",
    sending: "Sending…",
    addMore: "Add more items",
    yourBill: "Your bill",
    billSubtitle: "Everything ordered on this table so far.",
    emptyBill: "No items on the bill yet. Add something from the menu!",
    each: "each",
    couponPlaceholder: "Coupon code",
    apply: "Apply",
    payNow: "Pay now",
    close: "Close",
    cancel: "Cancel",
    base: "base",
    chooseAny: "choose any",
    chooseOne: "choose one",
    addToOrder: "Add to order",
    payYourBill: "Pay your bill",
    paySubtitleOnline: "Pay instantly online, or choose another method for staff to confirm.",
    paySubtitleOffline: "Choose a payment method — staff will confirm.",
    payOnlineNow: "Pay online now (UPI · Card · Netbanking)",
    opening: "Opening…",
    orPayAnother: "or pay another way",
    uploadProof: "Upload payment screenshot",
    tapUpload: "Tap to upload screenshot",
    submitPayment: "Submit payment",
    submitting: "Submitting…",
    orderSent: "Order sent to the kitchen! 🍽️",
    orderPending: "Order sent — waiting for staff to approve ✅",
    downloadBill: "Download bill (PDF)",
  },
  hi: {
    loadingMenu: "मेनू लोड हो रहा है…",
    scanPrompt: "ऑर्डर शुरू करने के लिए अपनी टेबल का QR कोड स्कैन करें।",
    thanks: "हमारे यहाँ भोजन करने के लिए धन्यवाद!",
    settledMsg: "आपका बिल चुका दिया गया है। नया ऑर्डर देने के लिए कृपया टेबल का QR कोड दोबारा स्कैन करें।",
    yourTable: "आपकी टेबल",
    table: "टेबल",
    bill: "बिल",
    tagline: "स्कैन · ऑर्डर · भुगतान — अपनी टेबल से",
    searchPlaceholder: "मेनू में खोजें…",
    add: "जोड़ें",
    customize: "पसंद चुनें",
    soldOut: "उपलब्ध नहीं",
    noItems: "कोई आइटम नहीं मिला।",
    reviewCart: "कार्ट देखें",
    yourOrder: "आपका ऑर्डर",
    reviewSubtitle: "अपने आइटम जाँचें, फिर रेस्टोरेंट को भेजें।",
    emptyCart: "आपका कार्ट खाली है।",
    notePlaceholder: "नोट जोड़ें (जैसे — प्याज़ नहीं, कम तीखा, एलर्जी)…",
    guestName: "आपका नाम",
    guestPhone: "फ़ोन नंबर",
    contactHint: "ऑर्डर देने के लिए नाम और फ़ोन नंबर ज़रूरी है।",
    contactMissing: "ऑर्डर करने के लिए अपना नाम और सही फ़ोन नंबर डालें।",
    total: "कुल",
    subtotal: "उप-योग",
    discount: "छूट",
    coupon: "कूपन",
    serviceCharge: "सेवा शुल्क",
    sendOrder: "ऑर्डर रेस्टोरेंट को भेजें",
    sending: "भेजा जा रहा है…",
    addMore: "और आइटम जोड़ें",
    yourBill: "आपका बिल",
    billSubtitle: "इस टेबल पर अब तक ऑर्डर किया गया सब कुछ।",
    emptyBill: "बिल में अभी कोई आइटम नहीं है। मेनू से कुछ जोड़ें!",
    each: "प्रति",
    couponPlaceholder: "कूपन कोड",
    apply: "लागू करें",
    payNow: "अभी भुगतान करें",
    close: "बंद करें",
    cancel: "रद्द करें",
    base: "मूल दाम",
    chooseAny: "कोई भी चुनें",
    chooseOne: "एक चुनें",
    addToOrder: "ऑर्डर में जोड़ें",
    payYourBill: "बिल का भुगतान करें",
    paySubtitleOnline: "तुरंत ऑनलाइन भुगतान करें, या कोई और तरीका चुनें — स्टाफ़ पुष्टि करेगा।",
    paySubtitleOffline: "भुगतान का तरीका चुनें — स्टाफ़ पुष्टि करेगा।",
    payOnlineNow: "अभी ऑनलाइन भुगतान करें (UPI · कार्ड · नेटबैंकिंग)",
    opening: "खुल रहा है…",
    orPayAnother: "या किसी और तरीके से भुगतान करें",
    uploadProof: "भुगतान का स्क्रीनशॉट अपलोड करें",
    tapUpload: "स्क्रीनशॉट अपलोड करने के लिए टैप करें",
    submitPayment: "भुगतान सबमिट करें",
    submitting: "सबमिट हो रहा है…",
    orderSent: "ऑर्डर किचन को भेज दिया गया! 🍽️",
    orderPending: "ऑर्डर भेज दिया गया — स्टाफ़ की मंज़ूरी का इंतज़ार है ✅",
    downloadBill: "बिल डाउनलोड करें (PDF)",
  },
};
type Tr = (key: string) => string;

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

function OrderInner() {
  const params = useParams();
  const search = useSearchParams();
  const restaurant = String((params as Record<string, unknown>)?.restaurant ?? "");
  const token = search?.get("t") ?? "";
  const tableLabel = useMemo(() => decodeTableName(token), [token]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [currency, setCurrency] = useState("₹");
  const [payMethods, setPayMethods] = useState<PayMethod[]>(DEFAULT_METHODS);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [billTotal, setBillTotal] = useState(0);
  const [bill, setBill] = useState<BillData | null>(null);
  const [placing, setPlacing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showBill, setShowBill] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [settled, setSettled] = useState(false);
  const [modItem, setModItem] = useState<MenuItem | null>(null);
  const [lang, setLang] = useState<Lang>("en");

  // Restore the guest's language choice (after mount — SSR always renders EN).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "hi") setLang(saved);
    } catch {/* private mode etc. */}
  }, []);
  const switchLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch {/* ignore */}
  };
  const t: Tr = useCallback((key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key, [lang]);

  const itemsById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const tabsRef = useRef<HTMLDivElement>(null);
  // Drag-to-scroll the category bar (touch scrolls natively; this adds mouse drag
  // and tracks movement so a drag doesn't accidentally fire a tab tap).
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false });
  const onTabsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tabsRef.current;
    if (!el) return;
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  };
  const onTabsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tabsRef.current;
    if (!el || !drag.current.down) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.startScroll - dx;
  };
  const endTabsDrag = () => { drag.current.down = false; };

  const loadBill = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/bill?t=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        const subtotal = Number(data?.subtotal ?? data?.total_amt ?? 0);
        const taxes: TaxLine[] = Array.isArray(data?.taxes) ? data.taxes : [];
        const grand = Number(data?.grand_total ?? data?.total_amt ?? subtotal);
        setBill({
          items: Array.isArray(data?.items) ? data.items : [],
          subtotal,
          discount: Number(data?.discount ?? 0),
          coupon_code: data?.coupon_code ?? null,
          service_charge: Number(data?.service_charge ?? 0),
          service_charge_percent: Number(data?.service_charge_percent ?? 0),
          taxes,
          tax_total: Number(data?.tax_total ?? 0),
          grand_total: grand,
          payment_status: data?.payment_status ?? null,
        });
        setBillTotal(grand);
      }
    } catch {/* ignore */}
  }, [restaurant, token]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/menu`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load menu");
        if (!active) return;
        setRestaurantName(data.restaurant_name ?? restaurant);
        setLogoUrl(typeof data.logo_url === "string" ? data.logo_url : "");
        // Prefer the logo-derived primary colour; fall back to the configured theme_color.
        const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
        const themePref = hex(data.theme_primary) ?? hex(data.theme_color);
        if (themePref) setAccent(themePref);
        if (typeof data.currency === "string" && data.currency.trim()) setCurrency(data.currency.trim());
        if (Array.isArray(data.payment_methods) && data.payment_methods.length > 0) setPayMethods(data.payment_methods);
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to load menu");
      } finally {
        if (active) setLoading(false);
      }
    })();
    loadBill();
    return () => {
      active = false;
    };
  }, [restaurant, loadBill]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const byCategory = useMemo(() => {
    const m: Record<string, MenuItem[]> = {};
    for (const it of items) (m[it.category || "Menu"] ??= []).push(it);
    return m;
  }, [items]);
  const categories = useMemo(() => Object.keys(byCategory).sort(), [byCategory]);
  const searching = query.trim().length > 0;
  const active = activeCat && categories.includes(activeCat) ? activeCat : categories[0];
  const shown = searching ? filtered : (active ? byCategory[active] ?? [] : []);

  const cartLines = Object.values(cart);
  const cartTotal = cartLines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);

  const setLineQty = (key: string, d: number) =>
    setCart((c) => {
      const line = c[key];
      if (!line) return c;
      const q = line.quantity + d;
      const next = { ...c };
      if (q <= 0) delete next[key];
      else next[key] = { ...line, quantity: q };
      return next;
    });
  const addLine = (line: CartLine) =>
    setCart((c) => {
      const ex = c[line.key];
      return { ...c, [line.key]: ex ? { ...ex, quantity: ex.quantity + line.quantity } : line };
    });
  // Add a plain item (no modifiers) keyed by its id; modifier items open the sheet.
  const addItem = (it: MenuItem) => {
    if (it.modifiers && it.modifiers.length > 0) {
      setModItem(it);
      return;
    }
    addLine({ key: it.id, itemId: it.id, name: it.name, unitPrice: it.price, quantity: 1 });
  };

  const [orderNote, setOrderNote] = useState("");
  // Optional guest identity — registers the guest as a customer (loyalty, CRM
  // visit history). Remembered on this device so repeat visits auto-fill.
  const [guestName, setGuestName] = useState(() => { try { return localStorage.getItem("qr_guest_name") ?? ""; } catch { return ""; } });
  const [guestPhone, setGuestPhone] = useState(() => { try { return localStorage.getItem("qr_guest_phone") ?? ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem("qr_guest_name", guestName); } catch { /* ignore */ } }, [guestName]);
  useEffect(() => { try { localStorage.setItem("qr_guest_phone", guestPhone); } catch { /* ignore */ } }, [guestPhone]);
  const placeOrder = async () => {
    // Name + phone are REQUIRED (captured for the customer database / marketing).
    // A valid phone = at least 10 digits (Indian mobile). Block the order otherwise.
    const digitCount = guestPhone.replace(/\D/g, "").length;
    if (guestName.trim().length === 0 || digitCount < 10) {
      setError(t("contactMissing"));
      setShowCart(true);
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      const phoneDigits = guestPhone.replace(/[^0-9+]/g, "");
      const payload = {
        t: token,
        items: cartLines.map((l) => ({ id: l.itemId, name: l.name, price: l.unitPrice, quantity: l.quantity })),
        note: orderNote.trim() || undefined,
        customer: guestName.trim(),
        customer_phone: phoneDigits,
      };
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Order failed");
      setBillTotal(Number(data?.bill_total ?? cartTotal));
      void loadBill(); // refresh the authoritative bill (incl. taxes)
      setCart({});
      setOrderNote("");
      setShowCart(false);
      setToast(data?.status === "Pending" ? t("orderPending") : t("orderSent"));
    } catch (e: any) {
      setError(e?.message ?? "Order failed");
    } finally {
      setPlacing(false);
    }
  };

  if (!token) {
    return <Centered>{t("scanPrompt")}</Centered>;
  }
  if (loading) return <Centered>{t("loadingMenu")}</Centered>;

  // Once the bill is settled, ordering is locked — the guest must re-scan the QR
  // (which starts a fresh table session) to order again.
  if (settled || bill?.payment_status === "approved") {
    return (
      <Centered>
        <div className="text-center">
          <div className="mb-3 text-5xl">🙏</div>
          <p className="mb-1 text-lg font-semibold text-neutral-800">{t("thanks")}</p>
          <p className="text-sm text-neutral-500">{t("settledMsg")}</p>
          {bill && (bill.items?.length ?? 0) > 0 && (
            <button
              onClick={() => { try { window.print(); } catch { /* ignore */ } }}
              className="mt-4 rounded-2xl border px-5 py-2.5 text-sm font-semibold"
              style={{ borderColor: accent, color: accent }}
            >
              {t("downloadBill")}
            </button>
          )}
        </div>
        <GuestBillReceipt bill={bill} restaurantName={restaurantName || restaurant} logoUrl={logoUrl} tableLabel={tableLabel} currency={currency} />
      </Centered>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-neutral-50 pb-28">
      <GuestBillReceipt bill={bill} restaurantName={restaurantName || restaurant} logoUrl={logoUrl} tableLabel={tableLabel} currency={currency} />
      <header className="relative overflow-hidden px-5 pb-6 pt-7 text-white shadow-md" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -22)})` }}>
        {/* Soft decorative glows for depth. */}
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-black/10 blur-2xl" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="logo" className="h-14 w-14 rounded-2xl bg-white/95 object-contain p-1.5 shadow-lg ring-1 ring-white/40" />
            )}
            <div>
              <h1 className="text-2xl font-extrabold leading-tight tracking-tight drop-shadow-sm">{restaurantName || restaurant}</h1>
              <p className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/90 backdrop-blur">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-300" />
                {tableLabel ? `${t("table")} ${tableLabel}` : t("yourTable")}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={() => { void loadBill(); setShowBill(true); }}
              className="rounded-full bg-white/20 px-4 py-2 text-sm font-semibold shadow-sm backdrop-blur transition active:scale-95"
            >
              {t("bill")} {currency}{billTotal.toFixed(0)}
            </button>
            {/* Language toggle — translates the page chrome (dish names stay as entered). */}
            <div className="flex overflow-hidden rounded-full bg-white/20 text-[11px] font-semibold backdrop-blur">
              {(["en", "hi"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => switchLang(l)}
                  aria-pressed={lang === l}
                  className={`px-2.5 py-1 transition ${lang === l ? "bg-white/90" : "text-white/90"}`}
                  style={lang === l ? { color: accent } : undefined}
                >
                  {l === "en" ? "EN" : "हिंदी"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="relative mt-3 text-xs font-medium uppercase tracking-[0.2em] text-white/70">{t("tagline")}</p>
      </header>

      {/* Sticky search + category tabs. Tapping a tab shows only that section. */}
      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 backdrop-blur">
        <div className="px-4 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-800 outline-none"
            style={{ caretColor: accent }}
          />
        </div>
        {!searching && categories.length > 1 && (
          <div
            ref={tabsRef}
            onPointerDown={onTabsPointerDown}
            onPointerMove={onTabsPointerMove}
            onPointerUp={endTabsDrag}
            onPointerLeave={endTabsDrag}
            className="flex cursor-grab select-none gap-2 overflow-x-auto px-4 py-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"
          >
            {categories.map((cat) => {
              const on = cat === active;
              return (
                <button
                  key={cat}
                  onClick={() => { if (!drag.current.moved) setActiveCat(cat); }}
                  className="whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium shadow-sm ring-1 transition"
                  style={on
                    ? { backgroundColor: accent, color: "white", borderColor: accent, boxShadow: "none" }
                    : { backgroundColor: "white", color: "#404040", borderColor: "#e5e5e5" }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <main className="px-4 pt-4">
        {!searching && active && <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-500">{active}</h2>}
        <div className="space-y-2">
          {shown.map((it) => {
            const soldOut = it.available === false;
            return (
              <div key={it.id} className={`flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ${soldOut ? "opacity-60" : ""}`}>
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_url} alt={it.name} className={`h-16 w-16 flex-shrink-0 rounded-xl object-cover ${soldOut ? "grayscale" : ""}`} />
                ) : (
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-2xl">🍽️</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-neutral-800">{it.name}</p>
                  {searching && <p className="text-xs text-neutral-400">{it.category}</p>}
                  <p className="text-sm text-neutral-500">{currency}{Number(it.price).toFixed(2)}</p>
                  {(it.allergens ?? []).length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {it.allergens!.map((a) => (
                        <span key={a} className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] capitalize leading-none text-neutral-500 ring-1 ring-neutral-200">{a}</span>
                      ))}
                    </p>
                  )}
                </div>
                {soldOut ? (
                  <span className="rounded-full bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-500">{t("soldOut")}</span>
                ) : (it.modifiers && it.modifiers.length > 0) ? (
                  <button onClick={() => addItem(it)} className="rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition active:scale-95" style={{ backgroundColor: accent }}>{t("customize")}</button>
                ) : cart[it.id] ? (
                  <div className="flex items-center gap-2 rounded-full px-2 py-1" style={{ backgroundColor: tint(accent) }}>
                    <button onClick={() => setLineQty(it.id, -1)} className="h-7 w-7 rounded-full bg-white text-lg leading-none shadow" style={{ color: accent }}>−</button>
                    <span className="w-4 text-center font-semibold" style={{ color: accent }}>{cart[it.id].quantity}</span>
                    <button onClick={() => setLineQty(it.id, 1)} className="h-7 w-7 rounded-full text-lg leading-none text-white shadow" style={{ backgroundColor: accent }}>+</button>
                  </div>
                ) : (
                  <button onClick={() => addItem(it)} className="rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition active:scale-95" style={{ backgroundColor: accent }}>{t("add")}</button>
                )}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && <p className="mt-10 text-center text-neutral-400">{t("noItems")}</p>}
      </main>

      {cartCount > 0 && !showCart && (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md p-4">
          <button
            onClick={() => setShowCart(true)}
            className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-white shadow-xl ring-1 ring-black/5 transition active:scale-[0.98]"
            style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -22)})` }}
          >
            <span className="flex items-center gap-2 font-semibold">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-bold backdrop-blur">{cartCount}</span>
              {t("reviewCart")}
            </span>
            <span className="font-bold">{currency}{cartTotal.toFixed(2)} →</span>
          </button>
        </div>
      )}

      {showCart && (
        <CartSheet
          lines={cartLines}
          accent={accent}
          currency={currency}
          total={cartTotal}
          placing={placing}
          error={error}
          onQty={setLineQty}
          note={orderNote}
          onNote={setOrderNote}
          guestName={guestName}
          onGuestName={setGuestName}
          guestPhone={guestPhone}
          onGuestPhone={setGuestPhone}
          onClose={() => setShowCart(false)}
          onConfirm={placeOrder}
          t={t}
        />
      )}

      {modItem && (
        <ModifierSheet
          item={modItem}
          accent={accent}
          currency={currency}
          onClose={() => setModItem(null)}
          onAdd={(line) => { addLine(line); setModItem(null); }}
          t={t}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-20 mx-auto max-w-md px-4">
          <div className="rounded-xl bg-green-600 px-4 py-3 text-center text-sm text-white shadow-lg">{toast}</div>
        </div>
      )}

      {showBill && (
        <BillSheet
          bill={bill}
          accent={accent}
          currency={currency}
          restaurant={restaurant}
          token={token}
          onApplied={() => void loadBill()}
          onClose={() => setShowBill(false)}
          onPay={() => { setShowBill(false); setShowPay(true); }}
          onDownload={() => { try { window.print(); } catch { /* ignore */ } }}
          t={t}
        />
      )}

      {showPay && (
        <PaySheet
          restaurant={restaurant}
          restaurantName={restaurantName || restaurant}
          token={token}
          tableLabel={tableLabel}
          accent={accent}
          currency={currency}
          methods={payMethods}
          billTotal={billTotal}
          t={t}
          onClose={() => setShowPay(false)}
          onPaid={(msg, feedbackUrl) => {
            setShowPay(false);
            setSettled(true); // lock ordering — a new order needs a fresh QR scan
            void loadBill();
            if (feedbackUrl) {
              // Payment done — send the guest to rate the waiter who served them.
              setToast(msg ?? "Payment received — taking you to feedback… 🙏");
              setTimeout(() => { window.location.href = feedbackUrl; }, 1800);
            } else {
              setToast(msg ?? "Payment submitted — staff will confirm shortly. ✅");
            }
          }}
        />
      )}
    </div>
  );
}

// Lighten/darken a hex color by a percentage (-100..100) for gradients/tints.
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
  if (!m) return "#fff3ec";
  const num = parseInt(m[1], 16);
  return `rgba(${num >> 16}, ${(num >> 8) & 0xff}, ${num & 0xff}, 0.12)`;
}

function ModifierSheet(props: {
  item: MenuItem;
  accent: string;
  currency: string;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
  t: Tr;
}) {
  const { item, accent, currency, onClose, onAdd, t } = props;
  const groups = item.modifiers ?? [];
  // selection: groupIndex -> set of chosen option names
  const [sel, setSel] = useState<Record<number, string[]>>(() => {
    const init: Record<number, string[]> = {};
    groups.forEach((g, i) => {
      if (!g.multi && g.required && g.options[0]) init[i] = [g.options[0].name];
      else init[i] = [];
    });
    return init;
  });
  const [err, setErr] = useState<string | null>(null);

  const toggle = (gi: number, name: string, multi: boolean) =>
    setSel((s) => {
      const cur = s[gi] ?? [];
      if (multi) {
        return { ...s, [gi]: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] };
      }
      return { ...s, [gi]: cur.includes(name) ? [] : [name] };
    });

  const optByName = (g: ModGroup, name: string) => g.options.find((o) => o.name === name);
  const delta = groups.reduce((sum, g, i) => sum + (sel[i] ?? []).reduce((s, n) => s + (optByName(g, n)?.price ?? 0), 0), 0);
  const unitPrice = item.price + delta;
  const summaryParts = groups.flatMap((_, i) => sel[i] ?? []);
  const summary = summaryParts.join(", ");

  const confirm = () => {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].required && (sel[i] ?? []).length === 0) {
        setErr(`Please choose ${groups[i].name}.`);
        return;
      }
    }
    onAdd({
      key: `${item.id}|${summary}`,
      itemId: item.id,
      name: summary ? `${item.name} (${summary})` : item.name,
      unitPrice,
      quantity: 1,
    });
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="mx-auto w-full max-w-md rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" />
        <h2 className="text-lg font-bold">{item.name}</h2>
        <p className="mb-4 text-sm text-neutral-500">{currency}{item.price.toFixed(2)} {t("base")}</p>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {groups.map((g, gi) => (
            <div key={gi}>
              <p className="mb-2 text-sm font-semibold text-neutral-700">
                {g.name}
                {g.required && <span className="ml-1 text-red-500">*</span>}
                <span className="ml-2 text-xs font-normal text-neutral-400">{g.multi ? t("chooseAny") : t("chooseOne")}</span>
              </p>
              <div className="space-y-1.5">
                {g.options.map((o) => {
                  const on = (sel[gi] ?? []).includes(o.name);
                  return (
                    <button
                      key={o.name}
                      onClick={() => toggle(gi, o.name, g.multi)}
                      className="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm"
                      style={on ? { borderColor: accent, backgroundColor: tint(accent) } : { borderColor: "#e5e5e5" }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`flex h-4 w-4 items-center justify-center ${g.multi ? "rounded" : "rounded-full"} border`}
                          style={{ borderColor: on ? accent : "#cbd5e1", backgroundColor: on ? accent : "transparent" }}
                        >
                          {on && <span className="text-[10px] leading-none text-white">✓</span>}
                        </span>
                        {o.name}
                      </span>
                      {o.price > 0 && <span className="text-neutral-500">+{currency}{o.price.toFixed(0)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        <button
          onClick={confirm}
          className="mt-5 flex w-full items-center justify-between rounded-2xl px-5 py-4 font-semibold text-white shadow"
          style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}
        >
          <span>{t("addToOrder")}</span>
          <span>{currency}{unitPrice.toFixed(2)}</span>
        </button>
        <button onClick={onClose} className="mt-2 w-full py-2 text-sm text-neutral-500">{t("cancel")}</button>
      </div>
    </div>
  );
}

function CartSheet(props: {
  lines: CartLine[];
  accent: string;
  currency: string;
  total: number;
  placing: boolean;
  note: string;
  error: string | null;
  onNote: (v: string) => void;
  guestName: string;
  onGuestName: (v: string) => void;
  guestPhone: string;
  onGuestPhone: (v: string) => void;
  onQty: (key: string, d: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  t: Tr;
}) {
  const { lines, accent, currency, total, placing, note, error, onNote, guestName, onGuestName, guestPhone, onGuestPhone, onQty, onClose, onConfirm, t } = props;
  // Name + phone are required before an order can be sent (customer data capture).
  const contactOk = guestName.trim().length > 0 && guestPhone.replace(/\D/g, "").length >= 10;
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="mx-auto w-full max-w-md rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" />
        <h2 className="mb-1 text-lg font-bold" style={{ color: 'black' }}>
          {t("yourOrder")}
        </h2>
        <p className="mb-4 text-sm text-neutral-500">{t("reviewSubtitle")}</p>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-neutral-400">{t("emptyCart")}</p>
        ) : (
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-800">{l.name}</p>
                  <p className="text-sm text-neutral-500">{currency}{l.unitPrice.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-2 rounded-full px-2 py-1" style={{ backgroundColor: tint(accent) }}>
                  <button onClick={() => onQty(l.key, -1)} className="h-7 w-7 rounded-full bg-white text-lg leading-none shadow" style={{ color: accent }}>−</button>
                  <span className="w-4 text-center font-semibold" style={{ color: accent }}>{l.quantity}</span>
                  <button onClick={() => onQty(l.key, 1)} className="h-7 w-7 rounded-full text-lg leading-none text-white shadow" style={{ backgroundColor: accent }}>+</button>
                </div>
                <span className="w-16 text-right font-semibold text-neutral-800">{currency}{(l.unitPrice * l.quantity).toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input
                value={guestName}
                onChange={(e) => onGuestName(e.target.value)}
                maxLength={60}
                placeholder={t("guestName")}
                className="w-full rounded-xl border border-neutral-200 p-3 text-sm text-neutral-800 outline-none focus:border-neutral-400"
              />
              <input
                value={guestPhone}
                onChange={(e) => onGuestPhone(e.target.value)}
                inputMode="tel"
                maxLength={16}
                placeholder={t("guestPhone")}
                className="w-full rounded-xl border border-neutral-200 p-3 text-sm text-neutral-800 outline-none focus:border-neutral-400"
              />
            </div>
            {!contactOk && (
              <p className="mt-1 text-xs text-neutral-500">{t("contactHint")}</p>
            )}
            <textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t("notePlaceholder")}
              className="mt-2 w-full resize-none rounded-xl border border-neutral-200 p-3 text-sm text-neutral-800 outline-none focus:border-neutral-400"
            />
          </>
        )}

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-neutral-500">{t("total")}</span>
          <span className="text-xl font-bold" style={{ color: 'black' }}>
            {currency}{total.toFixed(2)}
          </span>
        </div>

        {error && (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        )}

        <button
          onClick={onConfirm}
          disabled={placing || lines.length === 0 || !contactOk}
          className="mt-4 w-full rounded-2xl py-4 font-semibold text-white shadow transition active:scale-[0.99] disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}
        >
          {placing ? t("sending") : t("sendOrder")}
        </button>
        <button onClick={onClose} className="mt-2 w-full py-2 text-sm text-neutral-500">{t("addMore")}</button>
      </div>
    </div>
  );
}

// Itemized running bill: line items, subtotal, each tax line, grand total, and a
// Pay action. Opened from the header "Bill" button.
function BillSheet(props: {
  bill: BillData | null;
  accent: string;
  currency: string;
  restaurant: string;
  token: string;
  onApplied: () => void;
  onClose: () => void;
  onPay: () => void;
  onDownload: () => void;
  t: Tr;
}) {
  const { bill, accent, currency, restaurant, token, onApplied, onClose, onPay, onDownload, t } = props;
  const items = bill?.items ?? [];
  const hasItems = items.length > 0;
  const alreadyPaying = bill?.payment_status === "pending_approval" || bill?.payment_status === "approved";
  const [coupon, setCoupon] = useState(bill?.coupon_code ?? "");
  const [applying, setApplying] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) return;
    setApplying(true);
    setCouponMsg(null);
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/coupon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCouponMsg({ ok: false, text: data?.error ?? "Couldn't apply that code." });
      } else {
        setCouponMsg({ ok: true, text: `Coupon applied — ${currency}${Number(data?.discount ?? 0).toFixed(0)} off!` });
        onApplied();
      }
    } catch {
      setCouponMsg({ ok: false, text: "Couldn't reach the server." });
    } finally {
      setApplying(false);
    }
  };
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="mx-auto w-full max-w-md rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" />
        <h2 className="mb-1 text-lg font-bold" style={{ color: 'black' }}>{t("yourBill")}</h2>
        <p className="mb-4 text-sm text-neutral-500">{t("billSubtitle")}</p>

        {!hasItems ? (
          <p className="py-8 text-center text-neutral-400">{t("emptyBill")}</p>
        ) : (
          <>
            <div className="max-h-[40vh] space-y-2 overflow-y-auto">
              {items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3">
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white" style={{ backgroundColor: accent }}>{it.quantity}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-neutral-800">{it.name}</p>
                    <p className="text-xs text-neutral-400">{currency}{Number(it.price).toFixed(2)} {t("each")}</p>
                  </div>
                  <span className="w-16 text-right font-semibold text-neutral-800">{currency}{(Number(it.price) * Number(it.quantity)).toFixed(0)}</span>
                </div>
              ))}
            </div>

            {/* Coupon entry */}
            {!alreadyPaying && (
              <div className="mt-4">
                <div className="flex gap-2">
                  <input
                    value={coupon}
                    onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                    placeholder={t("couponPlaceholder")}
                    className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm font-medium tracking-wide text-neutral-800 outline-none"
                    style={{ caretColor: accent }}
                  />
                  <button
                    onClick={applyCoupon}
                    disabled={applying || !coupon.trim()}
                    className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow disabled:opacity-50"
                    style={{ backgroundColor: accent }}
                  >
                    {applying ? "…" : t("apply")}
                  </button>
                </div>
                {couponMsg && (
                  <p className={`mt-1.5 text-xs font-medium ${couponMsg.ok ? "text-green-600" : "text-red-600"}`}>{couponMsg.text}</p>
                )}
              </div>
            )}

            <div className="mt-4 space-y-1.5 border-t pt-3 text-sm">
              <div className="flex items-center justify-between text-neutral-500">
                <span>{t("subtotal")}</span>
                <span>{currency}{Number(bill?.subtotal ?? 0).toFixed(2)}</span>
              </div>
              {Number(bill?.discount ?? 0) > 0 && (
                <div className="flex items-center justify-between font-medium text-green-600">
                  <span>{bill?.coupon_code ? `${t("coupon")} ${bill.coupon_code}` : t("discount")}</span>
                  <span>− {currency}{Number(bill?.discount).toFixed(2)}</span>
                </div>
              )}
              {Number(bill?.service_charge ?? 0) > 0 && (
                <div className="flex items-center justify-between text-neutral-500">
                  <span>{t("serviceCharge")} ({bill?.service_charge_percent}%)</span>
                  <span>{currency}{Number(bill?.service_charge).toFixed(2)}</span>
                </div>
              )}
              {(bill?.taxes ?? []).map((t) => (
                <div key={t.name} className="flex items-center justify-between text-neutral-500">
                  <span>{t.name} ({t.percentage}%)</span>
                  <span>{currency}{Number(t.amount).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2 text-neutral-900">
                <span className="font-semibold">{t("total")}</span>
                <span className="text-xl font-bold">{currency}{Number(bill?.grand_total ?? 0).toFixed(2)}</span>
              </div>
            </div>

            {alreadyPaying ? (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                Payment {bill?.payment_status === "approved" ? "approved" : "submitted"} — staff will take it from here.
              </p>
            ) : (
              <button
                onClick={onPay}
                className="mt-4 flex w-full items-center justify-between rounded-2xl px-5 py-4 font-semibold text-white shadow"
                style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}
              >
                <span>{t("payNow")}</span>
                <span>{currency}{Number(bill?.grand_total ?? 0).toFixed(2)}</span>
              </button>
            )}
          </>
        )}
        {hasItems && (
          <button
            onClick={onDownload}
            className="mt-3 w-full rounded-2xl border py-3 text-sm font-semibold"
            style={{ borderColor: accent, color: accent }}
          >
            {t("downloadBill")}
          </button>
        )}
        <button onClick={onClose} className="mt-2 w-full py-2 text-sm text-neutral-500">{t("close")}</button>
      </div>
    </div>
  );
}

// Dependency-free printable receipt for the guest. Hidden on screen; the
// @media print block below hides the live app and shows ONLY this block, so the
// browser's print → "Save as PDF" (mobile Chrome/Safari included) produces a
// clean bill the guest can save or share. Built entirely from the loaded
// BillData — no extra network calls, no npm deps.
function GuestBillReceipt(props: {
  bill: BillData | null;
  restaurantName: string;
  logoUrl: string;
  tableLabel: string;
  currency: string;
}) {
  const { bill, restaurantName, logoUrl, tableLabel, currency } = props;
  if (!bill) return null;
  const items = bill.items ?? [];
  const money = (n: number) => `${currency}${Number(n || 0).toFixed(2)}`;
  const cell = { padding: "2px 0" };
  return (
    <>
      <style>{`
        #guest-bill-print { display: none; }
        @media print {
          @page { margin: 12mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          #guest-bill-print, #guest-bill-print * { visibility: visible !important; }
          #guest-bill-print { display: block !important; position: fixed; left: 0; top: 0; width: 100%; color: #000; }
        }
      `}</style>
      <div id="guest-bill-print" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#000", maxWidth: 360, margin: "0 auto", fontSize: 13 }}>
        <div style={{ textAlign: "center", borderBottom: "1px solid #000", paddingBottom: 8, marginBottom: 8 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="logo" style={{ height: 56, objectFit: "contain", margin: "0 auto 6px", display: "block" }} />
          ) : null}
          <div style={{ fontSize: 18, fontWeight: 700 }}>{restaurantName}</div>
          {tableLabel ? <div style={{ fontSize: 12 }}>Table {tableLabel}</div> : null}
          <div style={{ fontSize: 11 }}>{new Date().toLocaleString()}</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #000" }}>
              <th style={{ ...cell, textAlign: "left" }}>Item</th>
              <th style={{ ...cell, textAlign: "center" }}>Qty</th>
              <th style={{ ...cell, textAlign: "right" }}>Price</th>
              <th style={{ ...cell, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.name}-${i}`}>
                <td style={{ ...cell, textAlign: "left" }}>{it.name}</td>
                <td style={{ ...cell, textAlign: "center" }}>{it.quantity}</td>
                <td style={{ ...cell, textAlign: "right" }}>{Number(it.price).toFixed(2)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{(Number(it.price) * Number(it.quantity)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ borderTop: "1px solid #000", marginTop: 8, paddingTop: 6, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{money(bill.subtotal)}</span></div>
          {Number(bill.discount) > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{bill.coupon_code ? `Coupon ${bill.coupon_code}` : "Discount"}</span><span>- {money(bill.discount)}</span>
            </div>
          ) : null}
          {Number(bill.service_charge) > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Service charge ({bill.service_charge_percent}%)</span><span>{money(bill.service_charge)}</span>
            </div>
          ) : null}
          {(bill.taxes ?? []).map((tax) => (
            <div key={tax.name} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{tax.name} ({tax.percentage}%)</span><span>{money(tax.amount)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #000", marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 14 }}>
            <span>Grand Total</span><span>{money(bill.grand_total)}</span>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 11 }}>Thank you for dining with us!</div>
      </div>
    </>
  );
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function PaySheet(props: {
  restaurant: string;
  restaurantName: string;
  token: string;
  tableLabel: string;
  accent: string;
  currency: string;
  methods: PayMethod[];
  billTotal: number;
  t: Tr;
  onClose: () => void;
  onPaid: (msg?: string, feedbackUrl?: string | null) => void;
}) {
  const { restaurant, restaurantName, token, tableLabel, accent, currency, methods, billTotal, t, onClose, onPaid } = props;
  const razorpay = methods.find((m) => m.id === "Razorpay" && m.enabled !== false);
  const offlineMethods = methods.filter((m) => m.id !== "Razorpay" && m.enabled !== false);
  const [method, setMethod] = useState(offlineMethods[0]?.id ?? "Cash");
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageType, setImageType] = useState<string>("image/jpeg");
  const [submitting, setSubmitting] = useState(false);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const needsProof = offlineMethods.find((m) => m.id === method)?.requires_screenshot === true;

  const payOnline = async () => {
    setOnlineLoading(true);
    setErr(null);
    try {
      const createRes = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/razorpay/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const order = await createRes.json();
      if (!createRes.ok) {
        throw new Error(
          createRes.status === 503 ? "Online payment isn't set up yet — please pick another method below." : (order?.error ?? "Couldn't start online payment"),
        );
      }
      const ready = await loadRazorpay();
      if (!ready) throw new Error("Couldn't load the payment gateway. Check your connection.");
      const RZP = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
      const rzp = new RZP({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.razorpay_order_id,
        name: restaurantName,
        description: tableLabel ? `Table ${tableLabel}` : "Order",
        theme: { color: accent },
        modal: { ondismiss: () => setOnlineLoading(false) },
        handler: async (resp: Record<string, string>) => {
          try {
            const vr = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/razorpay/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ t: token, ...resp }),
            });
            const vd = await vr.json();
            if (!vr.ok) throw new Error(vd?.error ?? "Payment verification failed");
            onPaid("Payment successful! 🎉", vd?.feedback_url);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Payment verification failed");
            setOnlineLoading(false);
          }
        },
      });
      rzp.open();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Online payment failed");
      setOnlineLoading(false);
    }
  };

  // Downscale + JPEG-compress the photo before upload (phone photos are often
  // 5–15 MB, which blows past the request size limit).
  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const img = new window.Image();
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setImageB64(dataUrl);
          setImageType(file.type || "image/jpeg");
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        setImageB64(canvas.toDataURL("image/jpeg", 0.7));
        setImageType("image/jpeg");
      };
      img.onerror = () => {
        setImageB64(dataUrl);
        setImageType(file.type || "image/jpeg");
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (needsProof && !imageB64) {
      setErr("Please upload your payment screenshot.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          t: token,
          payment_method: method,
          ...(needsProof && imageB64 ? { screenshot_base64: imageB64, screenshot_content_type: imageType } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Payment failed");
      onPaid(undefined, data?.feedback_url);
    } catch (e: any) {
      setErr(e?.message ?? "Payment failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-md rounded-t-3xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" />
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold" style={{ color: 'black' }}>
            {t("payYourBill")}
          </h2>
          <span className="text-2xl font-bold" style={{ color: 'black' }}>{currency}{billTotal.toFixed(2)}</span>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          {razorpay ? t("paySubtitleOnline") : t("paySubtitleOffline")}
        </p>

        {razorpay && (
          <>
            <button
              onClick={payOnline}
              disabled={onlineLoading || billTotal <= 0}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold text-white shadow disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, -18)})` }}
            >
              {onlineLoading ? t("opening") : t("payOnlineNow")}
            </button>
            {offlineMethods.length > 0 && (
              <div className="mb-3 flex items-center gap-3 text-xs text-neutral-400">
                <div className="h-px flex-1 bg-neutral-200" />
                {t("orPayAnother")}
                <div className="h-px flex-1 bg-neutral-200" />
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-3 gap-2">
          {offlineMethods.map((m) => {
            const on = method === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className="rounded-xl border px-2 py-3 text-sm font-medium"
                style={on ? { borderColor: accent, backgroundColor: tint(accent), color: accent } : { borderColor: "#e5e5e5", color: "#404040" }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {needsProof && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">{t("uploadProof")}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickImage(f);
              }}
            />
            {imageB64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageB64} alt="proof" className="h-40 w-full rounded-xl object-contain bg-neutral-100" onClick={() => fileRef.current?.click()} />
            ) : (
              <button onClick={() => fileRef.current?.click()} className="flex h-28 w-full items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 text-sm text-neutral-500">
                {t("tapUpload")}
              </button>
            )}
          </div>
        )}

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        {offlineMethods.length > 0 && (
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-5 w-full rounded-2xl bg-neutral-900 py-4 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? t("submitting") : t("submitPayment")}
          </button>
        )}
        <button onClick={onClose} className="mt-2 w-full py-2 text-sm text-neutral-500">{t("cancel")}</button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6 text-center text-neutral-600">
      {children}
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <OrderInner />
    </Suspense>
  );
}
