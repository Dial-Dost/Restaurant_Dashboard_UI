"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useParams } from "next/navigation";
import { guestBackendBase } from "@/lib/guest-backend";
import { fontStack, loadBrandFont, loadDesignFonts } from "@/lib/brand-fonts";
import {
  GUEST_CSS,
  GUEST_FX_CSS,
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

// ---------------------------------------------------------------------------
// Static UI strings, per language — same mechanism and the same localStorage key
// as the order/queue surfaces, so a guest's choice follows them across pages.
// ---------------------------------------------------------------------------
type Lang = "en" | "hi";
const LANG_KEY = "qr_menu_lang";
const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    eyebrow: "RESERVE · ARRIVE · DINE",
    loading: "Setting your table…",
    formTitle: "Your reservation",
    formSub: "Tell us when you're coming — we'll hold a table and confirm shortly.",
    fieldName: "Your name",
    namePlaceholder: "Full name",
    fieldPhone: "Phone number",
    phonePlaceholder: "10-digit mobile",
    phoneTenDigits: "Enter a 10-digit mobile number",
    phoneHint: "The restaurant confirms your booking on this number.",
    fieldEmail: "Email (optional)",
    emailPlaceholder: "you@email.com",
    fieldDate: "Date",
    fieldTime: "Time",
    partySize: "Party size",
    guest: "guest",
    guests: "guests",
    fieldNotes: "Special requests (optional)",
    notesPlaceholder: "High chair, window seat, allergies…",
    submit: "Request reservation",
    submitting: "Requesting…",
    submitFailed: "Could not create the reservation",
    somethingWrong: "Something went wrong",
    doneTitle: "Reservation requested!",
    doneThanks: "Thanks",
    doneFor: "we've received your request for",
    depositPaid: "Deposit paid — thank you! It will be adjusted or refunded as per the restaurant's policy.",
    minSpendNote: "This booking carries a minimum spend of",
    tableHeld: "A table is held for you. The restaurant will confirm shortly.",
    noTableTitle: "We couldn't hold a single table automatically",
    noTableBody: "Your request has been sent to the restaurant — please call them to confirm, as a large party may need two tables put together.",
    depositTitle: "Deposit required",
    depositAsks: "asks for a deposit to hold your table for",
    payDeposit: "Pay",
    depositCta: "deposit",
    opening: "Opening payment…",
    depositFoot: "Your reservation stays \"awaiting deposit\" until the payment completes.",
    depositGateway: "Couldn't load the payment gateway. Check your connection and retry.",
    depositDismissed: "Payment not completed — your table isn't held until the deposit is paid.",
    depositVerifyFailed: "Deposit verification failed",
    depositStartFailed: "Couldn't start the deposit payment",
    depositDescription: "Reservation deposit",
    offlineTitle: "We couldn't reach the restaurant",
    offlineBody: "Check your connection — you can still send the request.",
    retry: "Try again",
  },
  hi: {
    eyebrow: "बुक करें · पहुँचें · भोजन करें",
    loading: "आपकी टेबल तैयार की जा रही है…",
    formTitle: "आपकी बुकिंग",
    formSub: "बताइए आप कब आ रहे हैं — हम टेबल रोक कर जल्द पुष्टि कर देंगे।",
    fieldName: "आपका नाम",
    namePlaceholder: "पूरा नाम",
    fieldPhone: "फ़ोन नंबर",
    phonePlaceholder: "10 अंकों का मोबाइल",
    phoneTenDigits: "10 अंकों का मोबाइल नंबर डालें",
    phoneHint: "रेस्टोरेंट इसी नंबर पर बुकिंग की पुष्टि करेगा।",
    fieldEmail: "ईमेल (वैकल्पिक)",
    emailPlaceholder: "you@email.com",
    fieldDate: "तारीख़",
    fieldTime: "समय",
    partySize: "कितने लोग",
    guest: "मेहमान",
    guests: "मेहमान",
    fieldNotes: "विशेष अनुरोध (वैकल्पिक)",
    notesPlaceholder: "बच्चों की कुर्सी, खिड़की के पास, एलर्जी…",
    submit: "बुकिंग का अनुरोध भेजें",
    submitting: "भेजा जा रहा है…",
    submitFailed: "बुकिंग नहीं हो पाई",
    somethingWrong: "कुछ गड़बड़ हो गई",
    doneTitle: "बुकिंग का अनुरोध भेज दिया गया!",
    doneThanks: "धन्यवाद",
    doneFor: "हमें आपका अनुरोध मिल गया —",
    depositPaid: "जमा राशि मिल गई — धन्यवाद! रेस्टोरेंट की नीति के अनुसार यह बिल में समायोजित या वापस कर दी जाएगी।",
    minSpendNote: "इस बुकिंग पर न्यूनतम खर्च है",
    tableHeld: "आपके लिए टेबल रोक ली गई है। रेस्टोरेंट जल्द पुष्टि करेगा।",
    noTableTitle: "एक ही टेबल अपने आप नहीं रोकी जा सकी",
    noTableBody: "आपका अनुरोध रेस्टोरेंट को भेज दिया गया है — कृपया उन्हें कॉल करके पुष्टि कर लें, बड़े ग्रुप के लिए दो टेबल जोड़नी पड़ सकती हैं।",
    depositTitle: "जमा राशि ज़रूरी है",
    depositAsks: "आपकी टेबल रोकने के लिए जमा राशि माँगता है —",
    payDeposit: "भुगतान करें",
    depositCta: "जमा राशि",
    opening: "भुगतान खुल रहा है…",
    depositFoot: "भुगतान पूरा होने तक आपकी बुकिंग \"जमा राशि बाकी\" रहेगी।",
    depositGateway: "पेमेंट गेटवे लोड नहीं हो पाया। कनेक्शन जाँचें और दोबारा कोशिश करें।",
    depositDismissed: "भुगतान पूरा नहीं हुआ — जमा राशि मिलने तक टेबल नहीं रुकेगी।",
    depositVerifyFailed: "जमा राशि की पुष्टि नहीं हो पाई",
    depositStartFailed: "जमा राशि का भुगतान शुरू नहीं हो पाया",
    depositDescription: "बुकिंग जमा राशि",
    offlineTitle: "रेस्टोरेंट से संपर्क नहीं हो पाया",
    offlineBody: "अपना इंटरनेट जाँचें — आप फिर भी अनुरोध भेज सकते हैं।",
    retry: "फिर कोशिश करें",
  },
};
type Tr = (key: string) => string;

function Icon(props: { name: string; className?: string; style?: CSSProperties }) {
  return <span className={props.className ? `ms ${props.className}` : "ms"} style={props.style} aria-hidden="true">{props.name}</span>;
}

// ---------------------------------------------------------------------------
// Surfaces. Every colour resolves through the CSS custom properties set on the
// page root: the accent RAMP (guestThemeVars, derived from the tenant's primary
// brand colour) and the nine colour ROLES (paletteVars, straight from
// brand_palette). No literal colour is written on this page.
// ---------------------------------------------------------------------------
const PANEL: CSSProperties = {
  borderRadius: "var(--rCard)",
  background: "var(--panelBg)",
  backdropFilter: "blur(var(--blur))",
  WebkitBackdropFilter: "blur(var(--blur))",
  border: "1.5px solid rgba(var(--inkRGB),var(--pbA))",
  boxShadow: "0 18px 44px rgba(0,0,0,0.46)",
};
const muted = (a = 0.58): CSSProperties => ({ color: `rgba(var(--inkRGB),${a})` });
const LABEL: CSSProperties = { color: "rgba(var(--inkRGB),0.5)", letterSpacing: "1.2px" };
const PRIMARY_BTN: CSSProperties = {
  borderRadius: "var(--rCtrl)",
  background: "var(--btnGrad)",
  color: "var(--onAcc)",
  boxShadow: "0 12px 28px rgba(var(--accShadowRGB),0.5)",
};

type Tone = "acc" | "ok" | "warn" | "err";
const TONE_VAR: Record<Tone, { flat: string; rgb: string }> = {
  acc: { flat: "var(--accHi)", rgb: "var(--accRGB)" },
  ok: { flat: "var(--ok)", rgb: "var(--okRGB)" },
  warn: { flat: "var(--warn)", rgb: "var(--warnRGB)" },
  err: { flat: "var(--err)", rgb: "var(--errRGB)" },
};

function Note({ tone, icon, title, body, action }: { tone: Tone; icon: string; title: string; body?: string; action?: ReactNode }) {
  const v = TONE_VAR[tone];
  return (
    <div
      className="rf-rise flex items-start gap-3 px-4 py-3.5 text-left"
      style={{ borderRadius: "var(--rCard)", background: `rgba(${v.rgb},0.10)`, border: `1px solid rgba(${v.rgb},0.30)` }}
    >
      <Icon name={icon} style={{ fontSize: "calc(20px*var(--fs,1))", color: v.flat, marginTop: 1 }} />
      <div className="min-w-0 flex-1">
        <p className="text-[length:calc(13px*var(--fs,1))] font-semibold leading-snug" style={{ color: v.flat }}>{title}</p>
        {body ? <p className="mt-1 text-[length:calc(12px*var(--fs,1))] leading-snug" style={muted(0.62)}>{body}</p> : null}
        {action}
      </div>
    </div>
  );
}

// A labelled form row. Defined at module scope so typing never remounts (and
// therefore never blurs) the input inside it.
function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[length:calc(11px*var(--fs,1))] font-bold uppercase" style={LABEL}>{label}</label>
      {children}
    </div>
  );
}

// The page shell every screen renders inside: brand-tinted near-black base, two
// floating accent orbs, and the hero (tenant wash + logo + language switch).
// Module scope for the same reason as Field — a component declared inside the
// page would be a NEW type on each render and remount the whole form.
interface ShellProps {
  vars: CSSProperties;
  font: string;
  logoUrl: string;
  title: string;
  lang: Lang;
  onLang: (l: Lang) => void;
  t: Tr;
  hero?: boolean;
  children: ReactNode;
}
function Shell({ vars, font, logoUrl, title, lang, onLang, t, hero = true, children }: ShellProps) {
  return (
    <div
      className="relative mx-auto min-h-dvh max-w-md overflow-x-hidden pb-12"
      style={{ ...vars, backgroundColor: "var(--bg)", color: "var(--ink)", fontFamily: font }}
    >
      <style>{GUEST_CSS}{GUEST_FX_CSS}</style>
      {/* --bgWash is plain var(--bg) unless the tenant set a page-background gradient. */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bgWash)" }} />
      <div className="pointer-events-none fixed z-0" style={{ top: -130, left: -90, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.22), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="pointer-events-none fixed z-0" style={{ bottom: -150, right: -70, width: 340, height: 340, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--brand2RGB),0.20), transparent 65%)", filter: "blur(34px)", animation: "rfFloatOrb 21s ease-in-out infinite reverse" }} />
      <div className="relative z-10">
        {hero ? (
          <header className="relative overflow-hidden" style={{ height: 186 }}>
            <div className="absolute inset-0" style={{ background: "var(--heroWash)" }} />
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            )}
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(var(--bgRGB),0.16), rgba(var(--bgRGB),0.55) 45%, rgba(var(--bgRGB),0.97))" }} />
            <div className="pointer-events-none absolute" style={{ top: -80, right: -50, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accHiRGB),0.34), transparent 62%)", filter: "blur(14px)" }} />
            <div className="relative flex h-full flex-col justify-between px-5 pb-4 pt-8">
              <div className="flex items-start justify-between gap-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-11 w-11 rounded-[14px] object-cover" style={{ border: "1px solid rgba(var(--inkRGB),0.18)", boxShadow: "0 8px 22px rgba(0,0,0,0.45)" }} />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-[14px]" style={{ background: "linear-gradient(145deg, var(--accHi), var(--accDeep))", boxShadow: "0 8px 22px rgba(var(--accShadowRGB),0.5)" }}>
                    <Icon name="restaurant" style={{ fontSize: "calc(22px*var(--fs,1))", color: "var(--onAcc)" }} />
                  </div>
                )}
                <div className="flex overflow-hidden text-[length:calc(11px*var(--fs,1))] font-bold" style={{ borderRadius: "var(--rCtrl)", border: "1px solid rgba(var(--inkRGB),0.14)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                  {(["en", "hi"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => { onLang(l); }}
                      aria-pressed={lang === l}
                      className="px-2.5 py-2 transition"
                      style={lang === l
                        ? { backgroundColor: "var(--accHi)", color: "var(--onAcc)" }
                        : { backgroundColor: "rgba(var(--bgRGB),0.55)", color: "rgba(var(--inkRGB),0.6)" }}
                    >
                      {l === "en" ? "EN" : "हिं"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[length:calc(10px*var(--fs,1))] font-bold uppercase tracking-[2px]" style={{ color: "var(--accHi)", textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>{t("eyebrow")}</div>
                <h1 className="rf-serif text-[length:calc(34px*var(--fs,1))] leading-none" style={{ color: "var(--ink)", textShadow: "0 2px 16px rgba(0,0,0,0.55)" }}>{title}</h1>
              </div>
            </div>
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export default function ReservePage() {
  const params = useParams();
  const restaurant = String((params as Record<string, unknown>)?.restaurant ?? "");

  const [restaurantName, setRestaurantName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [palette, setPalette] = useState<GuestPalette>(() => resolveGuestPalette(null));
  const [brandConfig, setBrandConfig] = useState<GuestBrandConfig | null>(null);
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandError, setBrandError] = useState(false);
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
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "hi") {setLang(saved);}
    } catch {/* private mode */}
  }, []);
  const switchLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch {/* ignore */}
  };
  const t: Tr = useCallback((key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key, [lang]);

  const loadBranding = useCallback(async () => {
    setBrandLoading(true);
    try {
      const res = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/branding`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setRestaurantName(data?.restaurant_name ?? restaurant);
        setLogoUrl(typeof data?.logo_url === "string" ? data.logo_url : "");
        // Colour comes from the RESOLVED brand palette. (This page used to prefer
        // theme_secondary → theme_color; for real tenants that pair is often an
        // unset/near-black grey, which is exactly the monochrome look the
        // reservation flow must not have. Those keys are now only a last-ditch
        // fallback for a payload that predates brand_palette.)
        setPalette(resolveGuestPalette(data?.brand_palette, pickHex(data?.theme_primary, data?.theme_secondary, data?.theme_color)));
        setBrandConfig((data?.brand_config ?? null) as GuestBrandConfig | null);
        setBrandError(false);
      } else {
        setBrandError(true);
      }
    } catch {
      setBrandError(true);
    } finally {
      setBrandLoading(false);
    }
  }, [restaurant]);
  useEffect(() => { void loadBranding(); }, [loadBranding]);

  useEffect(() => { loadDesignFonts(); }, []);
  useEffect(() => { if (brandConfig?.font) {loadBrandFont(brandConfig.font);} }, [brandConfig?.font]);

  const theme = useMemo(() => resolveGuestTheme(palette.primary, brandConfig, palette), [palette, brandConfig]);
  const rootVars = useMemo(() => ({ ...guestThemeVars(theme), ...paletteVars(palette) }), [theme, palette]);
  const bodyFont = brandConfig?.font ? fontStack(brandConfig.font) : "Roboto, system-ui, sans-serif";
  const currency = "₹";

  // POST /qr/:slug/reserve requires a 10-digit mobile, so keep submit disabled
  // until the field actually is one — otherwise the guest fills the whole form
  // and only then gets a 400.
  const phoneOk = isMobile10(phone);
  const canSubmit = useMemo(
    () => Boolean(name.trim()) && phoneOk && Boolean(date) && Boolean(time) && party > 0 && !submitting,
    [name, phoneOk, date, time, party, submitting],
  );

  // Open Razorpay checkout for the reservation deposit, then confirm it with
  // the backend (signature verify). Retry-able — the same order stays payable.
  const payDeposit = async (info: DepositInfo) => {
    setPayingDeposit(true);
    setDepositErr(null);
    try {
      const ready = await loadRazorpay();
      if (!ready) {throw new Error(t("depositGateway"));}
      const RZP = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
      const rzp = new RZP({
        key: info.key_id,
        amount: Math.round(info.amount * 100),
        currency: "INR",
        order_id: info.order_id,
        name: restaurantName || restaurant,
        description: t("depositDescription"),
        prefill: { name: name.trim(), contact: phone.trim(), email: email.trim() || undefined },
        theme: { color: palette.primary },
        modal: {
          ondismiss: () => {
            setPayingDeposit(false);
            setDepositErr(t("depositDismissed"));
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
            if (!vr.ok) {throw new Error(vd?.error ?? t("depositVerifyFailed"));}
            setDeposit(null);
            setDone({ table_name: info.table_name, deposit_paid: true, min_spend: info.min_spend });
          } catch (e) {
            setDepositErr(e instanceof Error ? e.message : t("depositVerifyFailed"));
          } finally {
            setPayingDeposit(false);
          }
        },
      });
      rzp.open();
    } catch (e) {
      setPayingDeposit(false);
      setDepositErr(e instanceof Error ? e.message : t("depositStartFailed"));
    }
  };

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
      if (!res.ok) {throw new Error(data?.error ?? t("submitFailed"));}
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
      setErr(e instanceof Error ? e.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // Props every screen passes to the shared page shell.
  const shell = { vars: rootVars, font: bodyFont, logoUrl, title: restaurantName || restaurant, lang, onLang: switchLang, t };

  // --- LOADING -------------------------------------------------------------
  if (brandLoading) {
    return (
      <Shell {...shell} hero={false}>
        <div className="relative overflow-hidden" style={{ height: 186 }}>
          <div className="absolute inset-0" style={{ background: "var(--heroWash)", opacity: 0.85 }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(var(--bgRGB),0.2), rgba(var(--bgRGB),0.97))" }} />
          <div className="absolute bottom-4 left-5 right-5">
            <div className="rf-skel h-3 w-32" />
            <div className="rf-skel mt-2.5 h-7 w-52" />
          </div>
        </div>
        <div className="px-4 pt-4">
          <div className="px-5 pb-6 pt-6" style={PANEL}>
            <div className="rf-skel h-5 w-40" />
            <div className="rf-skel mt-2.5 h-3 w-56" />
            <div className="rf-skel mt-6 h-12 w-full" />
            <div className="rf-skel mt-3.5 h-12 w-full" />
            <div className="flex gap-3">
              <div className="rf-skel mt-3.5 h-12 flex-1" />
              <div className="rf-skel mt-3.5 h-12 flex-1" />
            </div>
            <div className="rf-skel mt-3.5 h-14 w-full" />
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 text-[length:calc(12.5px*var(--fs,1))]" style={muted(0.5)}>
            <Icon name="progress_activity" style={{ fontSize: "calc(16px*var(--fs,1))", animation: "rfSpin 1s linear infinite" }} />
            {t("loading")}
          </p>
        </div>
      </Shell>
    );
  }

  // --- CONFIRMED -----------------------------------------------------------
  if (done) {
    return (
      <Shell {...shell} hero={false}>
        <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
          <section className="rf-rise w-full px-6 pb-7 pt-9 text-center" style={PANEL}>
            <div className="relative mx-auto flex h-[92px] w-[92px] items-center justify-center">
              <span className="absolute inset-0 rounded-full" style={{ background: "rgba(var(--okRGB),0.32)", animation: "rfHalo 2.4s ease-out infinite" }} />
              <span className="relative flex h-[92px] w-[92px] items-center justify-center rounded-full" style={{ background: "linear-gradient(150deg, rgba(var(--okRGB),0.95), rgba(var(--okRGB),0.5))", boxShadow: "0 16px 36px rgba(var(--okRGB),0.28)" }}>
                <Icon name="event_available" style={{ fontSize: "calc(42px*var(--fs,1))", color: "var(--bg)" }} />
              </span>
            </div>
            <h1 className="rf-serif mt-5 text-[length:calc(30px*var(--fs,1))] leading-tight" style={{ color: "var(--ink)" }}>{t("doneTitle")}</h1>
            <p className="mx-auto mt-2 max-w-[18rem] text-[length:calc(13px*var(--fs,1))] leading-snug" style={muted(0.62)}>
              {t("doneThanks")} {name.trim()} — {t("doneFor")} {party} {party > 1 ? t("guests") : t("guest")}.
            </p>

            <div className="mt-5 flex items-stretch gap-2.5">
              <div className="flex-1 px-3 py-3" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.10)", border: "1px solid rgba(var(--accRGB),0.24)" }}>
                <div className="flex items-center justify-center gap-1.5 text-[length:calc(10px*var(--fs,1))] font-bold uppercase" style={LABEL}>
                  <Icon name="calendar_month" style={{ fontSize: "calc(13px*var(--fs,1))", color: "var(--accHi)" }} />{t("fieldDate")}
                </div>
                <div className="rf-num mt-1 text-[length:calc(18px*var(--fs,1))]" style={{ color: "var(--ink)" }}>{dmy(date)}</div>
              </div>
              <div className="flex-1 px-3 py-3" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.10)", border: "1px solid rgba(var(--accRGB),0.24)" }}>
                <div className="flex items-center justify-center gap-1.5 text-[length:calc(10px*var(--fs,1))] font-bold uppercase" style={LABEL}>
                  <Icon name="schedule" style={{ fontSize: "calc(13px*var(--fs,1))", color: "var(--accHi)" }} />{t("fieldTime")}
                </div>
                <div className="rf-num mt-1 text-[length:calc(18px*var(--fs,1))]" style={{ color: "var(--ink)" }}>{time}</div>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {done.deposit_paid && <Note tone="ok" icon="verified" title={t("depositPaid")} />}
              {typeof done.min_spend === "number" && done.min_spend > 0 && (
                <Note tone="warn" icon="payments" title={`${t("minSpendNote")} ${currency}${done.min_spend}.`} />
              )}
              {done.table_name ? (
                <Note tone="acc" icon="table_restaurant" title={t("tableHeld")} />
              ) : (
                // No single table could hold the party. The public page has no way to
                // show a staff seating chooser (the suggester is staff-only), and we
                // never club tables behind anyone's back — so say so plainly and point
                // the guest at the phone. The request is still recorded for the staff.
                <Note tone="warn" icon="groups" title={t("noTableTitle")} body={t("noTableBody")} />
              )}
            </div>
          </section>
        </div>
      </Shell>
    );
  }

  // --- DEPOSIT -------------------------------------------------------------
  if (deposit) {
    return (
      <Shell {...shell} hero={false}>
        <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
          <section className="rf-rise w-full px-6 pb-7 pt-9 text-center" style={PANEL}>
            <div className="mx-auto flex h-[84px] w-[84px] items-center justify-center rounded-full" style={{ background: "linear-gradient(150deg, var(--accHi), var(--accDeep))", boxShadow: "0 16px 36px rgba(var(--accShadowRGB),0.5)" }}>
              <Icon name="credit_card" style={{ fontSize: "calc(38px*var(--fs,1))", color: "var(--onAcc)" }} />
            </div>
            <h1 className="rf-serif mt-5 text-[length:calc(29px*var(--fs,1))] leading-tight" style={{ color: "var(--ink)" }}>{t("depositTitle")}</h1>
            <p className="mx-auto mt-2 max-w-[18rem] text-[length:calc(13px*var(--fs,1))] leading-snug" style={muted(0.62)}>
              {restaurantName || restaurant} {t("depositAsks")} {party} {party > 1 ? t("guests") : t("guest")} · {dmy(date)} · {time}
            </p>
            <div className="rf-num mt-5 text-[length:calc(46px*var(--fs,1))] leading-none" style={{ color: "var(--accHi)" }}>{currency}{deposit.amount}</div>

            {typeof deposit.min_spend === "number" && deposit.min_spend > 0 && (
              <div className="mt-4"><Note tone="warn" icon="payments" title={`${t("minSpendNote")} ${currency}${deposit.min_spend}.`} /></div>
            )}
            {depositErr && <div className="mt-4"><Note tone="err" icon="error" title={depositErr} /></div>}

            <button
              onClick={() => payDeposit(deposit)}
              disabled={payingDeposit}
              className="rf-press mt-5 flex w-full items-center justify-center gap-2 py-4 text-[length:calc(15px*var(--fs,1))] font-bold disabled:opacity-50"
              style={PRIMARY_BTN}
            >
              {payingDeposit
                ? <><Icon name="progress_activity" style={{ fontSize: "calc(19px*var(--fs,1))", animation: "rfSpin 1s linear infinite" }} />{t("opening")}</>
                : <><Icon name="lock" style={{ fontSize: "calc(18px*var(--fs,1))" }} />{`${t("payDeposit")} ${currency}${deposit.amount} ${t("depositCta")}`}</>}
            </button>
            <p className="mt-3 text-[length:calc(11.5px*var(--fs,1))] leading-snug" style={muted(0.42)}>{t("depositFoot")}</p>
          </section>
        </div>
      </Shell>
    );
  }

  // --- FORM ----------------------------------------------------------------
  const phoneBad = phone.length > 0 && !phoneOk;
  return (
    <Shell {...shell}>
      <div className="space-y-4 px-4 pt-4">
        {brandError ? (
          <Note
            tone="err"
            icon="wifi_off"
            title={t("offlineTitle")}
            body={t("offlineBody")}
            action={(
              <button onClick={() => { void loadBranding(); }} className="rf-press mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[length:calc(12px*var(--fs,1))] font-bold" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--errRGB),0.16)", border: "1px solid rgba(var(--errRGB),0.34)", color: "var(--err)" }}>
                <Icon name="refresh" style={{ fontSize: "calc(15px*var(--fs,1))" }} />{t("retry")}
              </button>
            )}
          />
        ) : null}

        <section className="rf-rise px-5 pb-5 pt-5" style={PANEL}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px]" style={{ background: "linear-gradient(145deg, var(--accHi), var(--accDeep))", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.45)" }}>
              <Icon name="event" style={{ fontSize: "calc(22px*var(--fs,1))", color: "var(--onAcc)" }} />
            </div>
            <div className="min-w-0">
              <h2 className="rf-serif text-[length:calc(24px*var(--fs,1))] leading-none" style={{ color: "var(--ink)" }}>{t("formTitle")}</h2>
              <p className="mt-1.5 text-[length:calc(12.5px*var(--fs,1))] leading-snug" style={muted(0.6)}>{t("formSub")}</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <Field label={t("fieldName")} htmlFor="r-name">
              <input id="r-name" className="rf-field" value={name} onChange={(e) => { setName(e.target.value); }} placeholder={t("namePlaceholder")} autoComplete="name" />
            </Field>

            <Field label={t("fieldPhone")} htmlFor="r-phone">
              <input
                id="r-phone"
                className="rf-field"
                value={phone}
                onChange={(e) => { setPhone(sanitizePhoneInput(e.target.value)); }}
                placeholder={t("phonePlaceholder")}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={13}
                aria-invalid={phoneBad}
              />
              <p className="mt-1.5 flex items-center gap-1 text-[length:calc(11.5px*var(--fs,1))]" style={phoneBad ? { color: "var(--err)" } : muted(0.5)}>
                <Icon name={phoneBad ? "error" : "call"} style={{ fontSize: "calc(14px*var(--fs,1))" }} />
                {phoneBad ? t("phoneTenDigits") : t("phoneHint")}
              </p>
            </Field>

            <Field label={t("fieldEmail")} htmlFor="r-email">
              <input id="r-email" className="rf-field" value={email} onChange={(e) => { setEmail(e.target.value); }} placeholder={t("emailPlaceholder")} inputMode="email" autoComplete="email" />
            </Field>

            <div className="flex gap-3">
              <Field label={t("fieldDate")} htmlFor="r-date" className="min-w-0 flex-1">
                <input id="r-date" type="date" value={date} min={todayStr()} onChange={(e) => { setDate(e.target.value); }} className="rf-field" style={{ colorScheme: "dark" }} />
                <p className="rf-num mt-1.5 text-[length:calc(12px*var(--fs,1))]" style={muted(0.45)}>{dmy(date)}</p>
              </Field>
              <Field label={t("fieldTime")} htmlFor="r-time" className="min-w-0 flex-1">
                <input id="r-time" type="time" value={time} onChange={(e) => { setTime(e.target.value); }} className="rf-field" style={{ colorScheme: "dark" }} />
              </Field>
            </div>

            <Field label={t("partySize")}>
              <div className="flex items-center gap-3 p-1.5" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--bgRGB),0.55)", border: "1.5px solid rgba(var(--inkRGB),0.10)" }}>
                <button aria-label="Fewer guests" onClick={() => { setParty((p) => Math.max(1, p - 1)); }} className="rf-press flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(var(--inkRGB),0.06)", border: "1px solid rgba(var(--inkRGB),0.1)" }}>
                  <Icon name="remove" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--ink)" }} />
                </button>
                <div className="flex flex-1 items-baseline justify-center gap-1.5">
                  <span className="rf-num text-[length:calc(30px*var(--fs,1))] leading-none" style={{ color: "var(--ink)" }}>{party}</span>
                  <span className="text-[length:calc(12px*var(--fs,1))] font-medium" style={muted(0.5)}>{party > 1 ? t("guests") : t("guest")}</span>
                </div>
                <button aria-label="More guests" onClick={() => { setParty((p) => Math.min(30, p + 1)); }} className="rf-press flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "var(--btnGrad)", boxShadow: "0 8px 18px rgba(var(--accShadowRGB),0.45)" }}>
                  <Icon name="add" style={{ fontSize: "calc(20px*var(--fs,1))", color: "var(--onAcc)" }} />
                </button>
              </div>
            </Field>

            <Field label={t("fieldNotes")} htmlFor="r-notes">
              {/* Multi-line fields keep a fixed generous radius: a tenant on the
                  "pill" control shape would otherwise get capsule ends on a
                  two-row box. Radius is a shape constant, not a brand colour. */}
              <textarea id="r-notes" value={notes} onChange={(e) => { setNotes(e.target.value); }} rows={2} className="rf-field" placeholder={t("notesPlaceholder")} style={{ resize: "none", borderRadius: 18 }} />
            </Field>

            {err && <Note tone="err" icon="error" title={t("somethingWrong")} body={err} />}

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rf-press flex w-full items-center justify-center gap-2 py-4 text-[length:calc(15px*var(--fs,1))] font-bold disabled:opacity-45"
              style={PRIMARY_BTN}
            >
              {submitting
                ? <><Icon name="progress_activity" style={{ fontSize: "calc(19px*var(--fs,1))", animation: "rfSpin 1s linear infinite" }} />{t("submitting")}</>
                : <><Icon name="event_available" style={{ fontSize: "calc(19px*var(--fs,1))" }} />{t("submit")}</>}
            </button>
          </div>
        </section>
      </div>
    </Shell>
  );
}
