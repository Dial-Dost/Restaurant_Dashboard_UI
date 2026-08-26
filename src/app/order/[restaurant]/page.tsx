"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { guestBackendBase, readGuestJson, readGuestBody, GUEST_UNREACHABLE } from "@/lib/guest-backend";
import { fontStack, loadBrandFont, loadDesignFonts } from "@/lib/brand-fonts";
import {
  DEFAULT_ACCENT,
  GUEST_CSS,
  type GuestBrandConfig,
  type GuestPalette,
  guestThemeVars,
  paletteVars,
  pickHex,
  resolveGuestPalette,
  resolveGuestTheme,
} from "@/lib/guest-theme";
import { isMobile10, normalizeMobile10, sanitizePhoneInput } from "@/lib/phone";

const BASE = guestBackendBase();

interface ModOption { name: string; price: number }
interface ModGroup { name: string; multi: boolean; required: boolean; options: ModOption[] }
interface MenuItem { id: string; name: string; price: number; category: string; image_url?: string; available?: boolean; modifiers?: ModGroup[]; allergens?: string[]; blurb?: string }
interface CartLine { key: string; itemId: string; name: string; unitPrice: number; quantity: number }
interface PayMethod { id: string; label: string; enabled?: boolean; requires_screenshot?: boolean; online?: boolean }
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
    preorderSeeded: "Your saved picks from the queue are in your cart.",
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
    guestPhone: "10-digit mobile",
    contactHint: "Name & phone are required to place your order.",
    contactMissing: "Please enter your name and a 10-digit mobile number to order.",
    phoneTenDigits: "Enter a 10-digit mobile number",
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
    tableCode: "Table code",
    shareCodeHint: "Share this code with your table so friends can order too.",
    otpTitle: "Enter your table code",
    otpHelper: "Ask our staff for the 4-digit code for your table.",
    otpSubmit: "Continue",
    otpVerifying: "Checking…",
    otpNotSeated: "Please ask our staff to seat you first, then enter the code.",
    otpWrong: "That code isn't right — check with staff.",
    // Premium dark redesign chrome.
    eyebrow: "SCAN · CHOOSE · ENJOY",
    dineIn: "DINE-IN",
    tapToReview: "TAP TO REVIEW",
    orderEmpty: "Your order is empty",
    review: "Review",
    items: "items",
    item: "item",
    popular: "POPULAR",
    fullMenu: "FULL MENU",
    // Item description (menu item `blurb`).
    aboutDish: "About this dish",
    details: "Details",
  },
  hi: {
    loadingMenu: "मेनू लोड हो रहा है…",
    preorderSeeded: "क़तार में चुने आपके व्यंजन कार्ट में आ गए हैं।",
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
    guestPhone: "10 अंकों का मोबाइल नंबर",
    contactHint: "ऑर्डर देने के लिए नाम और फ़ोन नंबर ज़रूरी है।",
    contactMissing: "ऑर्डर करने के लिए अपना नाम और 10 अंकों का मोबाइल नंबर डालें।",
    phoneTenDigits: "10 अंकों का मोबाइल नंबर डालें",
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
    tableCode: "टेबल कोड",
    shareCodeHint: "यह कोड अपनी टेबल के साथ साझा करें ताकि दोस्त भी ऑर्डर कर सकें।",
    otpTitle: "अपनी टेबल का कोड डालें",
    otpHelper: "अपनी टेबल का 4-अंकों वाला कोड स्टाफ़ से पूछें।",
    otpSubmit: "आगे बढ़ें",
    otpVerifying: "जाँच हो रही है…",
    otpNotSeated: "कृपया पहले स्टाफ़ से टेबल पर बैठाने को कहें, फिर कोड डालें।",
    otpWrong: "यह कोड सही नहीं है — स्टाफ़ से जाँच करें।",
    // Premium dark redesign chrome.
    eyebrow: "स्कैन · चुनें · आनंद लें",
    dineIn: "डाइन-इन",
    tapToReview: "देखने के लिए टैप करें",
    orderEmpty: "आपका ऑर्डर खाली है",
    review: "देखें",
    items: "आइटम",
    item: "आइटम",
    popular: "लोकप्रिय",
    fullMenu: "पूरा मेनू",
    // Item description (menu item `blurb`).
    aboutDish: "इस व्यंजन के बारे में",
    details: "जानकारी",
  },
};
type Tr = (key: string) => string;

// ---------------------------------------------------------------------------
// Premium dark "Rustic Fork" design system. The whole page is dark; the accent
// RAMP + the tenant's panel material / control shape / hero wash drive every
// surface via CSS vars. The accent is DERIVED from the restaurant's brand accent
// (copper is only the fallback) — controlled by the owner via brand_config, not
// by the guest. The colour maths, the CSS-var bag and the utility CSS now live in
// @/lib/guest-theme so the feedback + valet screens render the SAME surfaces.
// ---------------------------------------------------------------------------

const GLOBAL_CSS = GUEST_CSS;

// Material Symbols icon (falls back to nothing if the font hasn't loaded yet).
function Icon(props: { name: string; className?: string; style?: React.CSSProperties }) {
  const cls = props.className ? `ms ${props.className}` : "ms";
  return <span className={cls} style={props.style} aria-hidden="true">{props.name}</span>;
}

// A dish "opens" (shows the item sheet) when there is something to read or pick:
// a human description (blurb) and/or modifier groups. Items with neither keep the
// original one-tap "add to cart" behaviour.
const itemBlurb = (it: MenuItem) => (typeof it.blurb === "string" ? it.blurb.trim() : "");
const hasItemDetails = (it: MenuItem) => (it.modifiers?.length ?? 0) > 0 || itemBlurb(it).length > 0;

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
  // Rich customer-page branding (font/colours/header/button style). Null until
  // the menu loads (or when the tenant never customised) — every use falls back
  // to today's hardcoded look so existing tenants are visually unchanged.
  const [brandConfig, setBrandConfig] = useState<GuestBrandConfig | null>(null);
  // The server-resolved brand_palette (scheme + explicit roles + defaults, with
  // the WCAG text clamp already applied). Starts as the shipped dark shell so a
  // failed fetch still paints the classic design, never a grey page.
  const [palette, setPalette] = useState<GuestPalette>(() => resolveGuestPalette(null));
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
  // Per-table OTP gate: when the tenant requires it, the guest must enter the
  // 4-digit code staff read off the floor grid before browsing/ordering. The
  // verified code is remembered per table token so a reload doesn't re-prompt,
  // and is threaded into the order payload (the order endpoint re-checks it).
  const [requireOtp, setRequireOtp] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [verifiedOtp, setVerifiedOtp] = useState("");
  // Restore a previously-verified table OTP (keyed by the signed table token).
  useEffect(() => {
    if (!token) {return;}
    try {
      const saved = localStorage.getItem(`otp_ok_${token}`);
      if (saved) { setVerifiedOtp(saved); setOtpVerified(true); }
    } catch {/* private mode etc. */}
  }, [token]);

  const markOtpVerified = useCallback((code: string) => {
    setVerifiedOtp(code);
    setOtpVerified(true);
    try { localStorage.setItem(`otp_ok_${token}`, code); } catch {/* ignore */}
  }, [token]);
  const clearOtpVerified = useCallback(() => {
    setVerifiedOtp("");
    setOtpVerified(false);
    try { localStorage.removeItem(`otp_ok_${token}`); } catch {/* ignore */}
  }, [token]);

  // Restore the guest's language choice (after mount — SSR always renders EN).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "hi") {setLang(saved);}
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
    if (!el) {return;}
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  };
  const onTabsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tabsRef.current;
    if (!el || !drag.current.down) {return;}
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) {drag.current.moved = true;}
    el.scrollLeft = drag.current.startScroll - dx;
  };
  const endTabsDrag = () => { drag.current.down = false; };

  const loadBill = useCallback(async () => {
    if (!token) {return;}
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/bill?t=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const { ok, data } = await readGuestBody(res);
      if (ok) {
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
        const data: any = await readGuestJson(res, "Failed to load menu");
        if (!active) {return;}
        setRestaurantName(data.restaurant_name ?? restaurant);
        setLogoUrl(typeof data.logo_url === "string" ? data.logo_url : "");
        // brand_config.color_primary wins, then the logo-derived primary, then
        // the configured theme_color (keeps existing tenants unchanged).
        const bcfg = data.brand_config && typeof data.brand_config === "object" ? (data.brand_config as GuestBrandConfig) : null;
        setBrandConfig(bcfg);
        const themePref = pickHex(bcfg?.color_primary, data.theme_primary, data.theme_color);
        if (themePref) {setAccent(themePref);}
        // Adopt the resolved palette (page shell, panels, ink, states). Absent
        // or partial payloads fall back role-by-role to the shipped design.
        setPalette(resolveGuestPalette(data.brand_palette, themePref));
        if (typeof data.currency === "string" && data.currency.trim()) {setCurrency(data.currency.trim());}
        if (Array.isArray(data.payment_methods) && data.payment_methods.length > 0) {setPayMethods(data.payment_methods);}
        setRequireOtp(data.require_table_otp === true);
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e: any) {
        if (active) {setError(e?.message ?? "Failed to load menu");}
      } finally {
        if (active) {setLoading(false);}
      }
    })();
    loadBill();
    return () => {
      active = false;
    };
  }, [restaurant, loadBill]);

  useEffect(() => {
    if (!toast) {return;}
    const t = setTimeout(() => { setToast(null); }, 3500);
    return () => { clearTimeout(t); };
  }, [toast]);

  // --- Waitlist pre-order hand-off ------------------------------------------
  // A party seated from the queue who chose "I'll order at the table" arrives
  // with ?wl=<queue token>. Claim their saved picks ONCE (the backend flips the
  // entry to 'claimed', so a refresh can't add them twice) and seed the cart so
  // they don't retype what they picked at the door. Strictly best-effort: any
  // failure, foreign token, or already-claimed state leaves this page exactly
  // as it is — this path must never break /order.
  const wlToken = search?.get("wl") ?? "";
  const wlClaimed = useRef(false);
  useEffect(() => {
    if (!wlToken || !restaurant || wlClaimed.current || items.length === 0) {return;}
    wlClaimed.current = true;
    (async () => {
      try {
        const res = await fetch(
          `${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${encodeURIComponent(wlToken)}/preorder/claim`,
          { method: "POST" },
        );
        if (!res.ok) {return;}
        const d: any = await res.json().catch(() => null);
        const claimed: { id?: unknown; quantity?: unknown }[] = Array.isArray(d?.items) ? d.items : [];
        if (d?.status !== "claimed" || claimed.length === 0) {return;}
        let seeded = false;
        setCart((c) => {
          const next = { ...c };
          for (const it of claimed) {
            const id = String(it.id ?? "");
            const menuItem = itemsById[id];
            // Seed only items still on the menu, at the MENU price — the claim
            // payload is a convenience, never a pricing authority.
            if (!menuItem) {continue;}
            const qty = Math.max(1, Math.round(Number(it.quantity ?? 1) || 1));
            const ex = next[id];
            next[id] = ex
              ? { ...ex, quantity: ex.quantity + qty }
              : { key: id, itemId: id, name: menuItem.name, unitPrice: menuItem.price, quantity: qty };
            seeded = true;
          }
          return next;
        });
        if (seeded) {setToast(t("preorderSeeded"));}
      } catch { /* best-effort — ordering continues normally */ }
    })();
  }, [wlToken, restaurant, items.length, itemsById, t]);

  // Load the tenant's chosen Google Font (once) so the page renders in it.
  useEffect(() => { if (brandConfig?.font) {loadBrandFont(brandConfig.font);} }, [brandConfig?.font]);
  // Load the design constants (Instrument Serif display, Roboto body/numerals,
  // Material Symbols icons) — always, they drive the premium dark look.
  useEffect(() => { loadDesignFonts(); }, []);

  // Resolve the accent RAMP from the restaurant's brand accent (copper is the
  // ultimate fallback), combined with the tenant's panel material (surface_style),
  // control shape (button_shape) and hero wash (header_style) → CSS vars.
  const theme = useMemo(() => resolveGuestTheme(accent, brandConfig, palette), [accent, brandConfig, palette]);
  // One CSS custom-property bag: the accent ramp/material vars plus the palette
  // role + derived shell-tone vars every replaced literal now reads from.
  const themeVars = useMemo(() => ({ ...guestThemeVars(theme), ...paletteVars(palette) }), [theme, palette]);
  // Body font: the tenant's brand font still applies to body text; the serif
  // display + thin numerals are design constants layered on top.
  const bodyFont = brandConfig?.font ? fontStack(brandConfig.font) : "Roboto, system-ui, sans-serif";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Match either the dish name OR its category, so searching a category name
    // (e.g. "dimsum") surfaces every item in that category, not just items whose
    // own name contains the word.
    return q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            (i.category ?? "").toLowerCase().includes(q),
        )
      : items;
  }, [items, query]);
  const byCategory = useMemo(() => {
    const m: Record<string, MenuItem[]> = {};
    for (const it of items) {(m[it.category || "Menu"] ??= []).push(it);}
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
    { setCart((c) => {
      const line = c[key];
      if (!line) {return c;}
      const q = line.quantity + d;
      const next = { ...c };
      if (q <= 0) {delete next[key];}
      else {next[key] = { ...line, quantity: q };}
      return next;
    }); };
  const addLine = (line: CartLine) =>
    { setCart((c) => {
      const ex = c[line.key];
      return { ...c, [line.key]: ex ? { ...ex, quantity: ex.quantity + line.quantity } : line };
    }); };
  // Add a plain item keyed by its id. Items with modifiers OR a description open
  // the item sheet first (the sheet is where the guest reads the description and
  // picks options); an item with neither goes straight into the cart as before.
  const addItem = (it: MenuItem) => {
    if (hasItemDetails(it)) {
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
    // A valid phone is EXACTLY 10 digits (Indian mobile) — not "10 or more", which
    // used to let an 11-digit typo through to a backend that now 400s it.
    const normalizedPhone = normalizeMobile10(guestPhone);
    if (guestName.trim().length === 0 || !normalizedPhone) {
      setError(t("contactMissing"));
      setShowCart(true);
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      const phoneDigits = normalizedPhone;
      const payload = {
        t: token,
        items: cartLines.map((l) => ({ id: l.itemId, name: l.name, price: l.unitPrice, quantity: l.quantity })),
        note: orderNote.trim() || undefined,
        customer: guestName.trim(),
        customer_phone: phoneDigits,
        // Re-checked server-side; only present when the OTP gate is in play.
        ...(verifiedOtp ? { otp: verifiedOtp } : {}),
      };
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { ok, status, data } = await readGuestBody(res);
      if (!ok) {
        // A stale/rotated code (e.g. table was released & re-seated) — drop the
        // saved verification so the guest is re-prompted with the gate.
        if (data?.code === "otp_required" || data?.code === "otp_wrong") {clearOtpVerified();}
        throw new Error(data?.error ?? (status >= 500 ? GUEST_UNREACHABLE : "Order failed"));
      }
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
    return <Centered vars={themeVars}>{t("scanPrompt")}</Centered>;
  }
  if (loading) {return <Centered vars={themeVars}>{t("loadingMenu")}</Centered>;}

  // Once the bill is settled, ordering is locked — the guest must re-scan the QR
  // (which starts a fresh table session) to order again.
  if (settled || bill?.payment_status === "approved") {
    return (
      <Centered vars={themeVars}>
        <div className="text-center">
          <div className="mb-3 text-5xl">🙏</div>
          <p className="mb-1 rf-serif text-3xl leading-tight text-[color:var(--ink)]">{t("thanks")}</p>
          <p className="text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("settledMsg")}</p>
          {bill && (bill.items?.length ?? 0) > 0 && (
            <button
              onClick={() => { try { window.print(); } catch { /* ignore */ } }}
              className="mt-5 inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-semibold transition active:scale-[0.98]"
              style={{ borderColor: `rgba(${theme.accRGB},0.5)`, color: theme.accHi, backgroundColor: `rgba(${theme.accRGB},0.1)` }}
            >
              <Icon name="download" style={{ fontSize: "calc(18px*var(--fs,1))" }} />
              {t("downloadBill")}
            </button>
          )}
        </div>
        <GuestBillReceipt bill={bill} restaurantName={restaurantName || restaurant} logoUrl={logoUrl} tableLabel={tableLabel} currency={currency} />
      </Centered>
    );
  }

  // OTP gate: block browsing/ordering until the guest enters the per-table code.
  if (requireOtp && !otpVerified) {
    return (
      <OtpGate
        restaurant={restaurant}
        token={token}
        themeVars={themeVars}
        bodyFont={bodyFont}
        restaurantName={restaurantName || restaurant}
        logoUrl={logoUrl}
        tableLabel={tableLabel}
        t={t}
        onVerified={markOtpVerified}
      />
    );
  }

  // Premium dark redesign. All colour comes from the accent RAMP (CSS vars in
  // `themeVars`) derived from the restaurant's brand accent; brand_config.font
  // still drives body text.
  const heroImage = logoUrl; // brand logo doubles as the hero cover when present
  const countLabel = `${cartCount} ${cartCount === 1 ? t("item") : t("items")}`;

  return (
    <div
      className="relative mx-auto min-h-screen max-w-md overflow-x-hidden pb-40 text-[color:var(--ink)]"
      style={{ ...themeVars, backgroundColor: "var(--bg)", fontFamily: bodyFont }}
    >
      <style>{GLOBAL_CSS}</style>
      <GuestBillReceipt bill={bill} restaurantName={restaurantName || restaurant} logoUrl={logoUrl} tableLabel={tableLabel} currency={currency} />

      {/* Near-black base + two floating accent orbs behind everything. The base
          paints --bgWash: plain var(--bg) normally (identical to the old solid
          paint) or the tenant's page-background gradient when one is set. */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bgWash)" }} />
      <div className="pointer-events-none fixed z-0" style={{ top: -120, left: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.20), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="pointer-events-none fixed z-0" style={{ bottom: -140, right: -60, width: 340, height: 340, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accDeepRGB),0.22), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 20s ease-in-out infinite reverse" }} />

      <div className="relative z-10">
        {/* HERO */}
        <header className="relative overflow-hidden" style={{ height: 172 }}>
          {/* Hero wash — accent gradient or a flat accent block (header_style). */}
          <div className="absolute inset-0" style={{ background: "var(--heroWash)" }} />
          {heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(6,6,7,0.15), rgba(6,6,7,0.4) 45%, rgba(var(--bgRGB),0.96))" }} />
          <div className="pointer-events-none absolute" style={{ top: -70, right: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accHiRGB),0.3), transparent 62%)", filter: "blur(12px)" }} />
          <div className="relative flex h-full flex-col justify-between px-5 pb-4 pt-9">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ backgroundColor: "rgba(var(--chipRGB),0.5)", borderColor: "rgba(var(--edgeRGB),0.14)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                <Icon name="table_restaurant" style={{ fontSize: "calc(13px*var(--fs,1))", color: "var(--accHi)" }} />
                <span className="text-[length:calc(10.5px*var(--fs,1))] font-bold tracking-wide text-[color:var(--inkStrong)]">{tableLabel ? `${t("table")} ${tableLabel} · ${t("dineIn")}` : t("yourTable")}</span>
              </div>
            </div>
            <div>
              <div className="mb-1 text-[length:calc(10px*var(--fs,1))] font-bold uppercase tracking-[2px]" style={{ color: "var(--accHi)", textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>{t("eyebrow")}</div>
              <h1 className="rf-serif text-[length:calc(34px*var(--fs,1))] leading-none text-[color:var(--inkStrong)]" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.55)" }}>{restaurantName || restaurant}</h1>
            </div>
          </div>
        </header>

        {/* CONTROLS: bill total, shared table code, language. */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <button
            onClick={() => { void loadBill(); setShowBill(true); }}
            className="flex items-center gap-2 border px-3.5 py-2.5 transition active:scale-95"
            style={{ backgroundColor: "rgba(var(--panelRGB),0.7)", borderColor: "rgba(var(--edgeRGB),0.08)", borderRadius: "var(--rCtrl)" }}
          >
            <Icon name="receipt_long" style={{ fontSize: "calc(17px*var(--fs,1))", color: "var(--accHi)" }} />
            <span className="text-[length:calc(10px*var(--fs,1))] font-bold uppercase tracking-wide text-[color:var(--inkMuted)]">{t("bill")}</span>
            <span className="rf-num text-[length:calc(17px*var(--fs,1))] text-[color:var(--ink)]">{currency}{billTotal.toFixed(0)}</span>
          </button>
          <div className="flex-1" />
          {requireOtp && otpVerified && verifiedOtp && (
            <div className="flex items-center gap-1.5 border px-2.5 py-2" title={t("shareCodeHint")} style={{ backgroundColor: "rgba(var(--panelRGB),0.7)", borderColor: "rgba(var(--edgeRGB),0.08)", borderRadius: "var(--rCtrl)" }}>
              <span className="text-[length:calc(9px*var(--fs,1))] font-bold uppercase tracking-wide text-[color:var(--inkDim)]">{t("tableCode")}</span>
              <span className="text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-bold tracking-[0.2em]" style={{ color: "var(--accHi)" }}>{verifiedOtp}</span>
            </div>
          )}
          <div className="flex overflow-hidden border text-[length:calc(11px*var(--fs,1))] font-semibold" style={{ borderColor: "rgba(var(--edgeRGB),0.08)", borderRadius: "var(--rCtrl)" }}>
            {(["en", "hi"] as const).map((l) => (
              <button
                key={l}
                onClick={() => { switchLang(l); }}
                aria-pressed={lang === l}
                className="px-2.5 py-2 transition"
                style={lang === l ? { backgroundColor: "var(--accHi)", color: "var(--onAcc)" } : { backgroundColor: "rgba(var(--panelRGB),0.7)", color: "var(--inkMuted)" }}
              >
                {l === "en" ? "EN" : "हिं"}
              </button>
            ))}
          </div>
        </div>

        {/* SEARCH */}
        <div className="px-4 pt-2.5">
          <div className="flex items-center gap-2 border px-3.5 py-2.5" style={{ backgroundColor: "rgba(var(--panelRGB),0.7)", borderColor: "rgba(var(--edgeRGB),0.08)", borderRadius: "var(--rCtrl)" }}>
            <Icon name="search" style={{ fontSize: "calc(19px*var(--fs,1))", color: "var(--inkDim)" }} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              placeholder={t("searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--inkDim)]"
              style={{ caretColor: "var(--accHi)" }}
            />
            {query && (
              <button onClick={() => { setQuery(""); }} aria-label={t("close")} className="transition active:scale-90">
                <Icon name="close" style={{ fontSize: "calc(18px*var(--fs,1))", color: "var(--inkMuted)" }} />
              </button>
            )}
          </div>
        </div>

        {/* CATEGORY CHIPS */}
        {!searching && categories.length > 1 && (
          <div
            ref={tabsRef}
            onPointerDown={onTabsPointerDown}
            onPointerMove={onTabsPointerMove}
            onPointerUp={endTabsDrag}
            onPointerLeave={endTabsDrag}
            className="rf-sc flex cursor-grab select-none gap-2 overflow-x-auto px-4 py-3 [-webkit-overflow-scrolling:touch] [touch-action:pan-x]"
          >
            {categories.map((cat) => {
              const on = cat === active;
              return (
                <button
                  key={cat}
                  onClick={() => { if (!drag.current.moved) {setActiveCat(cat);} }}
                  className="whitespace-nowrap rounded-full px-4 py-2 text-[length:calc(12.5px*var(--fs,1))] font-semibold transition"
                  style={on
                    ? { background: "var(--accHi)", color: "var(--onAcc)", border: "1px solid transparent" }
                    : { backgroundColor: "rgba(var(--edgeRGB),0.04)", color: "var(--inkMuted)", border: "1px solid rgba(var(--edgeRGB),0.08)" }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mx-4 mt-2 rounded-xl border px-4 py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))]" style={{ backgroundColor: "rgba(201,123,110,0.12)", borderColor: "rgba(201,123,110,0.3)", color: "var(--err)" }}>{error}</div>
        )}

        {/* MENU GRID (2 columns) */}
        <main className="px-4 pb-4 pt-2.5">
          {!searching && active && (
            <div className="mb-3 mt-1 px-1 text-[length:calc(11px*var(--fs,1))] font-bold uppercase tracking-[1.3px] text-[color:var(--inkDim)]">{t("fullMenu")} · {active}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {shown.map((it) => {
              const soldOut = it.available === false;
              const line = cart[it.id];
              const monogram = (it.name.trim()[0] ?? "•").toUpperCase();
              const blurb = itemBlurb(it);
              const openable = hasItemDetails(it);
              // Tapping the photo/name of a dish that has a description and/or
              // options opens its sheet (read the blurb, pick options) without
              // adding anything to the cart.
              const openSheet = () => { if (openable) {setModItem(it);} };
              return (
                <div
                  key={it.id}
                  className="relative overflow-hidden"
                  style={{ borderRadius: "var(--rCard)", background: "var(--panelBg)", backdropFilter: "blur(var(--blur))", WebkitBackdropFilter: "blur(var(--blur))", border: "1.5px solid rgba(var(--edgeRGB),var(--pbA))", boxShadow: "0 14px 34px rgba(0,0,0,0.45)", opacity: soldOut ? 0.6 : 1 }}
                >
                  <div
                    role={openable ? "button" : undefined}
                    tabIndex={openable ? 0 : undefined}
                    onClick={openSheet}
                    onKeyDown={(e) => { if (openable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSheet(); } }}
                    aria-label={openable ? `${it.name} — ${t("details")}` : undefined}
                    className="relative flex items-center justify-center"
                    style={{ height: 96, background: "linear-gradient(140deg,var(--phTop),var(--phBot))", borderBottom: "1px solid rgba(var(--edgeRGB),0.05)", cursor: openable ? "pointer" : "default" }}
                  >
                    {it.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image_url} alt={it.name} className={`absolute inset-0 h-full w-full object-cover ${soldOut ? "grayscale" : ""}`} />
                    ) : (
                      <>
                        <div className="pointer-events-none absolute" style={{ width: 74, height: 74, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accDeepRGB),0.55), transparent 70%)" }} />
                        <span className="rf-serif relative text-[length:calc(36px*var(--fs,1))] leading-none" style={{ color: "var(--accHi)" }}>{monogram}</span>
                      </>
                    )}
                    {soldOut && (
                      <div className="absolute right-2 top-2 rounded-[10px] border px-2 py-1 text-[length:calc(10px*var(--fs,1))] font-bold tracking-wide" style={{ backgroundColor: "rgba(201,123,110,0.16)", borderColor: "rgba(201,123,110,0.35)", color: "var(--err)" }}>{t("soldOut")}</div>
                    )}
                  </div>
                  <div className="px-3 pb-3 pt-2.5">
                    <div
                      role={openable ? "button" : undefined}
                      tabIndex={openable ? 0 : undefined}
                      onClick={openSheet}
                      onKeyDown={(e) => { if (openable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSheet(); } }}
                      className="text-[length:calc(13.5px*var(--fs,1))] font-semibold leading-tight text-[color:var(--ink)]"
                      style={{ minHeight: 34, cursor: openable ? "pointer" : "default" }}
                    >
                      {it.name}
                    </div>
                    {searching && <div className="mt-0.5 text-[length:calc(11px*var(--fs,1))] text-[color:var(--inkDim)]">{it.category}</div>}
                    {/* Two-line teaser of the dish description; the full text is in
                        the item sheet (tap the photo, the name or this line). */}
                    {blurb ? (
                      <div
                        onClick={openSheet}
                        className="mt-1 text-[length:calc(11px*var(--fs,1))] leading-snug text-[color:var(--inkMuted)]"
                        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", cursor: "pointer" }}
                      >
                        {blurb}
                      </div>
                    ) : null}
                    {(it.allergens ?? []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(it.allergens ?? []).map((a) => (
                          <span key={a} className="rounded-full border px-1.5 py-0.5 text-[length:calc(9px*var(--fs,1))] capitalize leading-none text-[color:var(--inkMuted)]" style={{ borderColor: "rgba(var(--edgeRGB),0.1)", backgroundColor: "rgba(var(--edgeRGB),0.04)" }}>{a}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="rf-num text-[length:calc(22px*var(--fs,1))] text-[color:var(--ink)]">{currency}{Number(it.price).toFixed(0)}</div>
                      {soldOut ? null : (it.modifiers && it.modifiers.length > 0) ? (
                        <button onClick={() => { addItem(it); }} className="flex items-center gap-1 px-2.5 py-2 transition active:scale-95" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.16)", border: "1px solid rgba(var(--accRGB),0.3)" }}>
                          <Icon name="tune" style={{ fontSize: "calc(16px*var(--fs,1))", color: "var(--accHi)" }} />
                          <span className="text-[length:calc(11px*var(--fs,1))] font-semibold" style={{ color: "var(--accHi)" }}>{t("customize")}</span>
                        </button>
                      ) : line ? (
                        <div className="flex items-center gap-2 p-1" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.14)" }}>
                          <button onClick={() => { setLineQty(it.id, -1); }} aria-label="remove" className="transition active:scale-90"><Icon name="remove" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--acc)" }} /></button>
                          <span className="min-w-[14px] text-center text-[length:calc(14px*var(--fs,1))] font-bold text-[color:var(--ink)]">{line.quantity}</span>
                          <button onClick={() => { setLineQty(it.id, 1); }} aria-label="add" className="transition active:scale-90"><Icon name="add" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--accHi)" }} /></button>
                        </div>
                      ) : (
                        <button onClick={() => { addItem(it); }} aria-label={t("add")} className="flex h-[34px] w-[34px] items-center justify-center transition active:scale-95" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.16)", border: "1px solid rgba(var(--accRGB),0.3)" }}>
                          <Icon name="add" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--accHi)" }} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {shown.length === 0 && <p className="mt-14 text-center text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkDim)]">{t("noItems")}</p>}
        </main>
      </div>

      {/* FLOATING TOTAL BAR — replaces the old bottom review affordance. */}
      {!showCart && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-4 pb-5 pt-8" style={{ background: "linear-gradient(180deg, transparent, rgba(6,6,7,0.85) 40%)", pointerEvents: "none" }}>
          <div
            onClick={() => { if (cartCount > 0) {setShowCart(true);} }}
            className="flex items-center gap-3 px-4 py-3.5"
            style={{ pointerEvents: "auto", borderRadius: "var(--rCard)", background: "rgba(var(--floatRGB),0.72)", backdropFilter: "blur(26px) saturate(150%)", WebkitBackdropFilter: "blur(26px) saturate(150%)", border: "1px solid rgba(var(--edgeRGB),0.12)", boxShadow: "0 20px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(var(--edgeRGB),0.08)", cursor: cartCount > 0 ? "pointer" : "default" }}
          >
            <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center" style={{ borderRadius: 13, background: "linear-gradient(145deg, var(--accHi), var(--accMid))", boxShadow: "0 8px 20px rgba(var(--accShadowRGB),0.55)" }}>
              <Icon name="shopping_bag" style={{ fontSize: "calc(22px*var(--fs,1))", color: "var(--onAcc)" }} />
              {cartCount > 0 && (
                <div className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[length:calc(11px*var(--fs,1))] font-bold text-white" style={{ backgroundColor: "#C97B6E", border: "2px solid #16161A" }}>{cartCount}</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {cartCount > 0 ? (
                <>
                  <div className="text-[length:calc(11px*var(--fs,1))] font-semibold uppercase tracking-wide text-[color:var(--inkMuted)]">{countLabel} · {t("tapToReview")}</div>
                  <div className="rf-num text-[length:calc(26px*var(--fs,1))] leading-tight text-[color:var(--ink)]">{currency}{cartTotal.toFixed(2)}</div>
                </>
              ) : (
                <div className="text-[length:calc(13px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("orderEmpty")}</div>
              )}
            </div>
            {cartCount > 0 && (
              <button onClick={(e) => { e.stopPropagation(); setShowCart(true); }} className="flex items-center gap-1 px-4 py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-bold transition active:scale-95" style={{ borderRadius: 14, background: "var(--btnGrad)", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}>
                {t("review")}<Icon name="expand_less" style={{ fontSize: "calc(19px*var(--fs,1))" }} />
              </button>
            )}
          </div>
        </div>
      )}

      {showCart && (
        <CartSheet
          lines={cartLines}
          accent={theme.acc}
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
          onClose={() => { setShowCart(false); }}
          onConfirm={placeOrder}
          t={t}
        />
      )}

      {modItem && (
        <ModifierSheet
          item={modItem}
          accent={theme.acc}
          currency={currency}
          onClose={() => { setModItem(null); }}
          onAdd={(line) => { addLine(line); setModItem(null); }}
          t={t}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-28 z-40 mx-auto max-w-md px-4">
          <div className="rounded-xl px-4 py-3 text-center text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-semibold shadow-lg" style={{ background: "var(--btnGrad)", color: "var(--onAcc)" }}>{toast}</div>
        </div>
      )}

      {showBill && (
        <BillSheet
          bill={bill}
          accent={theme.acc}
          currency={currency}
          restaurant={restaurant}
          token={token}
          onApplied={() => void loadBill()}
          onClose={() => { setShowBill(false); }}
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
          accent={theme.acc}
          currency={currency}
          methods={payMethods}
          billTotal={billTotal}
          t={t}
          onClose={() => { setShowPay(false); }}
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

function ModifierSheet(props: {
  item: MenuItem;
  accent: string;
  currency: string;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
  t: Tr;
}) {
  const { item, currency, onClose, onAdd, t } = props;
  const groups = item.modifiers ?? [];
  const blurb = itemBlurb(item);
  // selection: groupIndex -> set of chosen option names
  const [sel, setSel] = useState<Record<number, string[]>>(() => {
    const init: Record<number, string[]> = {};
    groups.forEach((g, i) => {
      if (!g.multi && g.required && g.options[0]) {init[i] = [g.options[0].name];}
      else {init[i] = [];}
    });
    return init;
  });
  const [err, setErr] = useState<string | null>(null);

  const toggle = (gi: number, name: string, multi: boolean) =>
    { setSel((s) => {
      const cur = s[gi] ?? [];
      if (multi) {
        return { ...s, [gi]: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] };
      }
      return { ...s, [gi]: cur.includes(name) ? [] : [name] };
    }); };

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
      // No options chosen (e.g. a description-only dish) → key by the plain item
      // id so the menu tile's own +/- stepper stays wired to this line.
      key: summary ? `${item.id}|${summary}` : item.id,
      itemId: item.id,
      name: summary ? `${item.name} (${summary})` : item.name,
      unitPrice,
      quantity: 1,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose} style={{ background: "rgba(4,4,6,0.55)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)", animation: "rfFadeIn .2s ease" }}>
      <div
        className="rf-sc mx-auto flex max-h-[92dvh] w-full max-w-md flex-col p-5"
        onClick={(e) => { e.stopPropagation(); }}
        style={{ borderRadius: "26px 26px 0 0", background: "linear-gradient(180deg,var(--sheetTop),var(--sheetBot))", borderTop: "1px solid rgba(var(--edgeRGB),0.1)", boxShadow: "0 -30px 60px rgba(0,0,0,0.6)", animation: "rfSheetUp .32s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="shrink-0">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: "rgba(var(--edgeRGB),0.15)" }} />
          <h2 className="rf-serif text-[length:calc(24px*var(--fs,1))] leading-none text-[color:var(--ink)]">{item.name}</h2>
          <p className="mb-4 mt-1 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{currency}{item.price.toFixed(2)} {t("base")}</p>
        </div>

        <div className="rf-sc min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          {/* The kitchen's own words about the dish (brand_config-independent —
              it comes from the menu item). Newlines are preserved. */}
          {blurb ? (
            <div className="p-3.5" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--edgeRGB),0.04)", border: "1px solid rgba(var(--edgeRGB),0.07)" }}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[length:calc(10px*var(--fs,1))] font-bold uppercase tracking-[1.3px]" style={{ color: "var(--accHi)" }}>
                <Icon name="restaurant_menu" style={{ fontSize: "calc(13px*var(--fs,1))" }} />
                {t("aboutDish")}
              </p>
              <p className="text-[length:calc(13px*var(--fs,1))] leading-relaxed text-[color:var(--inkSoft)]" style={{ whiteSpace: "pre-line" }}>{blurb}</p>
            </div>
          ) : null}
          {groups.map((g, gi) => (
            <div key={gi}>
              <p className="mb-2 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-semibold text-[color:var(--ink)]">
                {g.name}
                {g.required && <span className="ml-1" style={{ color: "var(--err)" }}>*</span>}
                <span className="ml-2 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] font-normal text-[color:var(--inkDim)]">{g.multi ? t("chooseAny") : t("chooseOne")}</span>
              </p>
              <div className="space-y-1.5">
                {g.options.map((o) => {
                  const on = (sel[gi] ?? []).includes(o.name);
                  return (
                    <button
                      key={o.name}
                      onClick={() => { toggle(gi, o.name, g.multi); }}
                      className="flex w-full items-center justify-between border px-4 py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--ink)]"
                      style={on ? { borderColor: "rgba(var(--accRGB),0.5)", backgroundColor: "rgba(var(--accRGB),0.14)", borderRadius: "var(--rCtrl)" } : { borderColor: "rgba(var(--edgeRGB),0.1)", background: "rgba(var(--edgeRGB),0.03)", borderRadius: "var(--rCtrl)" }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`flex h-4 w-4 items-center justify-center ${g.multi ? "rounded" : "rounded-full"} border`}
                          style={{ borderColor: on ? "var(--accHi)" : "rgba(var(--edgeRGB),0.25)", backgroundColor: on ? "var(--accHi)" : "transparent" }}
                        >
                          {on && <Icon name="check" style={{ fontSize: "calc(12px*var(--fs,1))", color: "var(--onAcc)" }} />}
                        </span>
                        {o.name}
                      </span>
                      {o.price > 0 && <span className="text-[color:var(--inkMuted)]">+{currency}{o.price.toFixed(0)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {err && <p className="mt-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))]" style={{ color: "var(--err)" }}>{err}</p>}

        <button
          onClick={confirm}
          className="mt-5 flex w-full items-center justify-between px-5 py-4 font-bold transition active:scale-[0.99]"
          style={{ borderRadius: "var(--rCtrl)", background: "var(--btnGrad)", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}
        >
          <span>{t("addToOrder")}</span>
          <span className="rf-num text-[length:calc(20px*var(--fs,1))]" style={{ color: "var(--onAcc)" }}>{currency}{unitPrice.toFixed(2)}</span>
        </button>
        <button onClick={onClose} className="mt-2 w-full py-2 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("cancel")}</button>
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
  const { lines, currency, total, placing, note, error, onNote, guestName, onGuestName, guestPhone, onGuestPhone, onQty, onClose, onConfirm, t } = props;
  // Name + phone are required before an order can be sent (customer data capture).
  // EXACTLY 10 digits — the old `>= 10` accepted 11-digit typos the API now 400s.
  const phoneOk = isMobile10(guestPhone);
  const contactOk = guestName.trim().length > 0 && phoneOk;
  // Only nag about the phone once something has been typed, so the field doesn't
  // look broken before the guest has started.
  const phoneTouched = guestPhone.trim().length > 0;
  const inputStyle: React.CSSProperties = { background: "rgba(var(--panelRGB),0.7)", border: "1px solid rgba(var(--edgeRGB),0.1)", borderRadius: "var(--rCtrl)", color: "var(--ink)" };
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose} style={{ background: "rgba(4,4,6,0.55)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)", animation: "rfFadeIn .2s ease" }}>
      <div
        className="mx-auto flex max-h-[92dvh] w-full max-w-md flex-col"
        onClick={(e) => { e.stopPropagation(); }}
        style={{ borderRadius: "26px 26px 0 0", background: "linear-gradient(180deg,var(--sheetTop),var(--sheetBot))", borderTop: "1px solid rgba(var(--edgeRGB),0.1)", boxShadow: "0 -30px 60px rgba(0,0,0,0.6)", animation: "rfSheetUp .32s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: "rgba(var(--edgeRGB),0.15)" }} />
          <h2 className="rf-serif text-[length:calc(24px*var(--fs,1))] leading-none text-[color:var(--ink)]">{t("yourOrder")}</h2>
          <p className="mb-4 mt-1 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("reviewSubtitle")}</p>
        </div>

        {/* The sheet is capped to the viewport and everything above the pinned
            footer scrolls, so a long cart stays fully reachable on a phone
            instead of overflowing off the top of the screen. */}
        <div className="rf-sc min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 [-webkit-overflow-scrolling:touch]">
        {lines.length === 0 ? (
          <p className="py-8 text-center text-[color:var(--inkDim)]">{t("emptyCart")}</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-3 p-3" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--edgeRGB),0.04)", border: "1px solid rgba(var(--edgeRGB),0.06)" }}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[color:var(--ink)]">{l.name}</p>
                  <p className="text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{currency}{l.unitPrice.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-2 p-1" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.14)" }}>
                  <button onClick={() => { onQty(l.key, -1); }} aria-label="remove" className="transition active:scale-90"><Icon name="remove" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--acc)" }} /></button>
                  <span className="min-w-[14px] text-center text-[length:calc(14px*var(--fs,1))] font-bold text-[color:var(--ink)]">{l.quantity}</span>
                  <button onClick={() => { onQty(l.key, 1); }} aria-label="add" className="transition active:scale-90"><Icon name="add" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--accHi)" }} /></button>
                </div>
                <span className="rf-num w-16 text-right text-[length:calc(16px*var(--fs,1))] text-[color:var(--ink)]">{currency}{(l.unitPrice * l.quantity).toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input
                value={guestName}
                onChange={(e) => { onGuestName(e.target.value); }}
                maxLength={60}
                placeholder={t("guestName")}
                className="w-full p-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] outline-none placeholder:text-[color:var(--inkDim)]"
                style={inputStyle}
              />
              <input
                value={guestPhone}
                onChange={(e) => { onGuestPhone(sanitizePhoneInput(e.target.value)); }}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={13}
                placeholder={t("guestPhone")}
                className="w-full p-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] outline-none placeholder:text-[color:var(--inkDim)]"
                style={{ ...inputStyle, ...(phoneTouched && !phoneOk ? { border: "1px solid rgba(239,68,68,0.6)" } : {}) }}
              />
            </div>
            {/* Live, specific message once they've started typing; the generic
                "name & phone required" hint otherwise. */}
            {phoneTouched && !phoneOk ? (
              <p className="mt-1 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] text-[#F0A6A0]">{t("phoneTenDigits")}</p>
            ) : !contactOk ? (
              <p className="mt-1 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("contactHint")}</p>
            ) : null}
            <textarea
              value={note}
              onChange={(e) => { onNote(e.target.value); }}
              maxLength={500}
              rows={2}
              placeholder={t("notePlaceholder")}
              className="mt-2 w-full resize-none p-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] outline-none placeholder:text-[color:var(--inkDim)]"
              style={inputStyle}
            />
          </>
        )}
        </div>

        {/* Pinned footer: the total and the send button stay visible no matter
            how many items are in the cart. */}
        <div className="shrink-0 px-5 pb-5 pt-3" style={{ borderTop: "1px solid rgba(var(--edgeRGB),0.08)" }}>
          <div className="flex items-center justify-between">
            <span className="text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("total")}</span>
            <span className="rf-num text-[length:calc(26px*var(--fs,1))] text-[color:var(--ink)]">{currency}{total.toFixed(2)}</span>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border px-4 py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-medium" style={{ background: "rgba(201,123,110,0.12)", borderColor: "rgba(201,123,110,0.3)", color: "var(--err)" }}>{error}</div>
          )}

          <button
            onClick={onConfirm}
            disabled={placing || lines.length === 0 || !contactOk}
            className="mt-4 w-full py-4 font-bold transition active:scale-[0.99] disabled:opacity-50"
            style={{ borderRadius: "var(--rCtrl)", background: "var(--btnGrad)", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}
          >
            {placing ? t("sending") : t("sendOrder")}
          </button>
          <button onClick={onClose} className="mt-2 w-full py-2 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("addMore")}</button>
        </div>
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
  const { bill, currency, restaurant, token, onApplied, onClose, onPay, onDownload, t } = props;
  const items = bill?.items ?? [];
  const hasItems = items.length > 0;
  const alreadyPaying = bill?.payment_status === "pending_approval" || bill?.payment_status === "approved";
  const [coupon, setCoupon] = useState(bill?.coupon_code ?? "");
  const [applying, setApplying] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) {return;}
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
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose} style={{ background: "rgba(4,4,6,0.55)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)", animation: "rfFadeIn .2s ease" }}>
      <div
        className="rf-sc mx-auto flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain p-5"
        onClick={(e) => { e.stopPropagation(); }}
        style={{ borderRadius: "26px 26px 0 0", background: "linear-gradient(180deg,var(--sheetTop),var(--sheetBot))", borderTop: "1px solid rgba(var(--edgeRGB),0.1)", boxShadow: "0 -30px 60px rgba(0,0,0,0.6)", animation: "rfSheetUp .32s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="shrink-0">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: "rgba(var(--edgeRGB),0.15)" }} />
          <h2 className="rf-serif text-[length:calc(24px*var(--fs,1))] leading-none text-[color:var(--ink)]">{t("yourBill")}</h2>
          <p className="mb-4 mt-1 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("billSubtitle")}</p>
        </div>

        {!hasItems ? (
          <p className="py-8 text-center text-[color:var(--inkDim)]">{t("emptyBill")}</p>
        ) : (
          <>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="flex items-center gap-3 p-3" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--edgeRGB),0.04)", border: "1px solid rgba(var(--edgeRGB),0.06)" }}>
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] font-bold" style={{ background: "rgba(var(--accRGB),0.16)", color: "var(--accHi)" }}>{it.quantity}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[color:var(--ink)]">{it.name}</p>
                    <p className="text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] text-[color:var(--inkDim)]">{currency}{Number(it.price).toFixed(2)} {t("each")}</p>
                  </div>
                  <span className="rf-num w-16 text-right text-[length:calc(16px*var(--fs,1))] text-[color:var(--ink)]">{currency}{(Number(it.price) * Number(it.quantity)).toFixed(0)}</span>
                </div>
              ))}
            </div>

            {/* Coupon entry */}
            {!alreadyPaying && (
              <div className="mt-4">
                <div className="flex gap-2">
                  <input
                    value={coupon}
                    onChange={(e) => { setCoupon(e.target.value.toUpperCase()); }}
                    placeholder={t("couponPlaceholder")}
                    className="min-w-0 flex-1 px-4 py-2.5 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-medium tracking-wide outline-none placeholder:text-[color:var(--inkDim)]"
                    style={{ caretColor: "var(--accHi)", background: "rgba(var(--panelRGB),0.7)", border: "1px solid rgba(var(--edgeRGB),0.1)", borderRadius: "var(--rCtrl)", color: "var(--ink)" }}
                  />
                  <button
                    onClick={applyCoupon}
                    disabled={applying || !coupon.trim()}
                    className="shrink-0 px-4 py-2.5 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-bold disabled:opacity-50"
                    style={{ borderRadius: "var(--rCtrl)", background: "var(--btnGrad)", color: "var(--onAcc)" }}
                  >
                    {applying ? "…" : t("apply")}
                  </button>
                </div>
                {couponMsg && (
                  <p className="mt-1.5 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] font-medium" style={{ color: couponMsg.ok ? "var(--ok)" : "var(--err)" }}>{couponMsg.text}</p>
                )}
              </div>
            )}

            <div className="mt-4 space-y-1.5 pt-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))]" style={{ borderTop: "1px solid rgba(var(--edgeRGB),0.08)" }}>
              <div className="flex items-center justify-between text-[color:var(--inkMuted)]">
                <span>{t("subtotal")}</span>
                <span>{currency}{Number(bill?.subtotal ?? 0).toFixed(2)}</span>
              </div>
              {Number(bill?.discount ?? 0) > 0 && (
                <div className="flex items-center justify-between font-medium" style={{ color: "var(--ok)" }}>
                  <span>{bill?.coupon_code ? `${t("coupon")} ${bill.coupon_code}` : t("discount")}</span>
                  <span>− {currency}{Number(bill?.discount).toFixed(2)}</span>
                </div>
              )}
              {Number(bill?.service_charge ?? 0) > 0 && (
                <div className="flex items-center justify-between text-[color:var(--inkMuted)]">
                  <span>{t("serviceCharge")} ({bill?.service_charge_percent}%)</span>
                  <span>{currency}{Number(bill?.service_charge).toFixed(2)}</span>
                </div>
              )}
              {(bill?.taxes ?? []).map((t) => (
                <div key={t.name} className="flex items-center justify-between text-[color:var(--inkMuted)]">
                  <span>{t.name} ({t.percentage}%)</span>
                  <span>{currency}{Number(t.amount).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 text-[color:var(--ink)]" style={{ borderTop: "1px solid rgba(var(--edgeRGB),0.08)" }}>
                <span className="font-semibold">{t("total")}</span>
                <span className="rf-num text-[length:calc(24px*var(--fs,1))]">{currency}{Number(bill?.grand_total ?? 0).toFixed(2)}</span>
              </div>
            </div>

            {alreadyPaying ? (
              <p className="mt-4 rounded-xl border px-4 py-3 text-center text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))]" style={{ background: "rgba(217,169,98,0.1)", borderColor: "rgba(217,169,98,0.3)", color: "var(--warn)" }}>
                Payment {bill?.payment_status === "approved" ? "approved" : "submitted"} — staff will take it from here.
              </p>
            ) : (
              <button
                onClick={onPay}
                className="mt-4 flex w-full items-center justify-between px-5 py-4 font-bold transition active:scale-[0.99]"
                style={{ borderRadius: "var(--rCtrl)", background: "var(--btnGrad)", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}
              >
                <span>{t("payNow")}</span>
                <span className="rf-num text-[length:calc(20px*var(--fs,1))]" style={{ color: "var(--onAcc)" }}>{currency}{Number(bill?.grand_total ?? 0).toFixed(2)}</span>
              </button>
            )}
          </>
        )}
        {hasItems && (
          <button
            onClick={onDownload}
            className="mt-3 flex w-full items-center justify-center gap-2 border py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-semibold"
            style={{ borderRadius: "var(--rCtrl)", borderColor: "rgba(var(--accRGB),0.5)", color: "var(--accHi)", background: "rgba(var(--accRGB),0.08)" }}
          >
            <Icon name="download" style={{ fontSize: "calc(17px*var(--fs,1))" }} />
            {t("downloadBill")}
          </button>
        )}
        <button onClick={onClose} className="mt-2 w-full py-2 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("close")}</button>
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
  if (!bill) {return null;}
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
    if (typeof window === "undefined") {resolve(false); return;}
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) {resolve(true); return;}
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => { resolve(true); };
    s.onerror = () => { resolve(false); };
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
      if (!ready) {throw new Error("Couldn't load the payment gateway. Check your connection.");}
      const RZP = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
      const rzp = new RZP({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.razorpay_order_id,
        name: restaurantName,
        description: tableLabel ? `Table ${tableLabel}` : "Order",
        theme: { color: accent },
        modal: { ondismiss: () => { setOnlineLoading(false); } },
        handler: async (resp: Record<string, string>) => {
          try {
            const vr = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/razorpay/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ t: token, ...resp }),
            });
            const vd = await vr.json();
            if (!vr.ok) {throw new Error(vd?.error ?? "Payment verification failed");}
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
      if (!res.ok) {throw new Error(data?.error ?? "Payment failed");}
      onPaid(undefined, data?.feedback_url);
    } catch (e: any) {
      setErr(e?.message ?? "Payment failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose} style={{ background: "rgba(4,4,6,0.55)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)", animation: "rfFadeIn .2s ease" }}>
      <div
        className="rf-sc mx-auto max-h-[92dvh] w-full max-w-md overflow-y-auto p-5"
        onClick={(e) => { e.stopPropagation(); }}
        style={{ borderRadius: "26px 26px 0 0", background: "linear-gradient(180deg,var(--sheetTop),var(--sheetBot))", borderTop: "1px solid rgba(var(--edgeRGB),0.1)", boxShadow: "0 -30px 60px rgba(0,0,0,0.6)", animation: "rfSheetUp .32s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: "rgba(var(--edgeRGB),0.15)" }} />
        <div className="flex items-baseline justify-between">
          <h2 className="rf-serif text-[length:calc(24px*var(--fs,1))] leading-none text-[color:var(--ink)]">{t("payYourBill")}</h2>
          <span className="rf-num text-[length:calc(26px*var(--fs,1))] text-[color:var(--ink)]">{currency}{billTotal.toFixed(2)}</span>
        </div>
        <p className="mb-4 mt-1 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">
          {razorpay ? t("paySubtitleOnline") : t("paySubtitleOffline")}
        </p>

        {razorpay && (
          <>
            <button
              onClick={payOnline}
              disabled={onlineLoading || billTotal <= 0}
              className="mb-4 flex w-full items-center justify-center gap-2 py-4 font-bold transition active:scale-[0.99] disabled:opacity-50"
              style={{ borderRadius: "var(--rCtrl)", background: "var(--btnGrad)", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}
            >
              {onlineLoading ? t("opening") : t("payOnlineNow")}
            </button>
            {offlineMethods.length > 0 && (
              <div className="mb-3 flex items-center gap-3 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] text-[color:var(--inkDim)]">
                <div className="h-px flex-1" style={{ background: "rgba(var(--edgeRGB),0.1)" }} />
                {t("orPayAnother")}
                <div className="h-px flex-1" style={{ background: "rgba(var(--edgeRGB),0.1)" }} />
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
                onClick={() => { setMethod(m.id); }}
                className="border px-2 py-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-medium"
                style={on ? { borderColor: "rgba(var(--accRGB),0.4)", background: "rgba(var(--accRGB),0.14)", color: "var(--accHi)", borderRadius: "var(--rCtrl)" } : { borderColor: "rgba(var(--edgeRGB),0.08)", background: "rgba(var(--edgeRGB),0.03)", color: "var(--inkMuted)", borderRadius: "var(--rCtrl)" }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {needsProof && (
          <div className="mt-4">
            <p className="mb-2 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-medium text-[color:var(--ink)]">{t("uploadProof")}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {pickImage(f);}
              }}
            />
            {imageB64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageB64} alt="proof" className="h-40 w-full rounded-xl object-contain" style={{ background: "rgba(var(--edgeRGB),0.04)" }} onClick={() => fileRef.current?.click()} />
            ) : (
              <button onClick={() => fileRef.current?.click()} className="flex h-28 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]" style={{ borderColor: "rgba(var(--edgeRGB),0.15)" }}>
                <Icon name="add_photo_alternate" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--accHi)" }} />
                {t("tapUpload")}
              </button>
            )}
          </div>
        )}

        {err && <p className="mt-3 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))]" style={{ color: "var(--err)" }}>{err}</p>}

        {offlineMethods.length > 0 && (
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-5 w-full py-4 font-bold text-[color:var(--ink)] disabled:opacity-50"
            style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--edgeRGB),0.06)", border: "1px solid rgba(var(--edgeRGB),0.12)" }}
          >
            {submitting ? t("submitting") : t("submitPayment")}
          </button>
        )}
        <button onClick={onClose} className="mt-2 w-full py-2 text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("cancel")}</button>
      </div>
    </div>
  );
}

// Full-screen, branded gate shown when the tenant requires a per-table OTP.
// The guest enters the 4-digit code staff read off the floor grid; on success
// the parent persists it and reveals the menu. No re-prompt on reload.
function OtpGate(props: {
  restaurant: string;
  token: string;
  themeVars: React.CSSProperties;
  bodyFont: string;
  restaurantName: string;
  logoUrl: string;
  tableLabel: string;
  t: Tr;
  onVerified: (code: string) => void;
}) {
  const { restaurant, token, themeVars, bodyFont, restaurantName, logoUrl, tableLabel, t, onVerified } = props;
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const otp = code.trim();
    if (otp.length < 4 || checking) {return;}
    setChecking(true);
    setErr(null);
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, otp }),
      });
      const data = await res.json().catch(() => null);
      if (data?.ok) { onVerified(otp); return; }
      setErr(data?.reason === "not_seated" ? t("otpNotSeated") : t("otpWrong"));
    } catch {
      setErr(t("otpWrong"));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center overflow-hidden px-6 text-center text-[color:var(--ink)]"
      style={{ ...themeVars, background: "var(--bgWash)", fontFamily: bodyFont }}
    >
      <style>{GLOBAL_CSS}</style>
      <div className="pointer-events-none fixed" style={{ top: -120, left: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.2), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="relative flex flex-col items-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="logo" className="mb-4 h-16 w-16 rounded-2xl object-contain p-1.5" style={{ background: "rgba(var(--edgeRGB),0.06)", border: "1px solid rgba(var(--edgeRGB),0.1)" }} />
        ) : (
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: "linear-gradient(145deg, var(--accHi), var(--accDeep))" }}>
            <Icon name="lock" style={{ fontSize: "calc(30px*var(--fs,1))", color: "var(--onAcc)" }} />
          </div>
        )}
        <p className="text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-medium text-[color:var(--inkMuted)]">{restaurantName}</p>
        {tableLabel ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[length:calc(12px*var(--fs,1))] leading-[calc(16px*var(--fs,1))] font-semibold" style={{ background: "rgba(var(--accRGB),0.16)", color: "var(--accHi)" }}>
            <Icon name="table_restaurant" style={{ fontSize: "calc(13px*var(--fs,1))" }} />
            {t("table")} {tableLabel}
          </p>
        ) : null}
        <h1 className="rf-serif mt-4 text-[length:calc(30px*var(--fs,1))] leading-tight text-[color:var(--ink)]">{t("otpTitle")}</h1>
        <p className="mt-2 max-w-xs text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] text-[color:var(--inkMuted)]">{t("otpHelper")}</p>

        <input
          value={code}
          onChange={(e) => { setErr(null); setCode(e.target.value.replace(/\D/g, "").slice(0, 4)); }}
          onKeyDown={(e) => { if (e.key === "Enter") {void submit();} }}
          inputMode="numeric"
          autoFocus
          maxLength={4}
          placeholder="••••"
          aria-label={t("otpTitle")}
          className="rf-num mt-6 w-52 py-4 text-center text-[length:calc(34px*var(--fs,1))] tracking-[0.4em] text-[color:var(--ink)] outline-none"
          style={{ borderRadius: "var(--rCtrl)", border: "2px solid rgba(var(--accRGB),0.5)", background: "rgba(var(--panelRGB),0.7)", caretColor: "var(--accHi)" }}
        />

        {err && <p className="mt-3 max-w-xs text-[length:calc(14px*var(--fs,1))] leading-[calc(20px*var(--fs,1))] font-medium" style={{ color: "var(--err)" }}>{err}</p>}

        <button
          onClick={submit}
          disabled={checking || code.trim().length < 4}
          className="mt-6 w-52 py-4 font-bold transition active:scale-[0.99] disabled:opacity-50"
          style={{ borderRadius: "var(--rCtrl)", background: "var(--btnGrad)", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}
        >
          {checking ? t("otpVerifying") : t("otpSubmit")}
        </button>
      </div>
    </div>
  );
}

// Default var bag for screens that render before (or without) the tenant's
// branding — the shipped dark shell, so var(--bg)/var(--ink*) always resolve.
const FALLBACK_VARS: React.CSSProperties = {
  ...guestThemeVars(resolveGuestTheme(DEFAULT_ACCENT, null)),
  ...paletteVars(resolveGuestPalette(null)),
};

function Centered({ children, vars }: { children: React.ReactNode; vars?: React.CSSProperties }) {
  return (
    <div
      className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6 text-center text-[color:var(--inkMuted)]"
      style={{ ...(vars ?? FALLBACK_VARS), background: "var(--bgWash)", fontFamily: "Roboto, system-ui, sans-serif" }}
    >
      <style>{GLOBAL_CSS}</style>
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
