"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import type { CSSProperties } from "react";
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
import { isMobile10, isOptionalMobile10, normalizeMobile10, sanitizePhoneInput } from "@/lib/phone";

const BASE = guestBackendBase();

interface MenuItem { id: string; name: string; price: number; category: string; image_url?: string; available?: boolean }
interface PreItem { id: string; name: string; price: number; quantity: number }
interface Entry {
  id: string;
  token: string;
  name: string;
  status: "waiting" | "called" | "seated" | "cancelled" | "no_show";
  position: number;
  party_size: number;
  pre_order: PreItem[];
  table_name: string | null;
  qr_token?: string | null;
}

// ---------------------------------------------------------------------------
// Static UI strings, per language — same mechanism (and the same localStorage
// key) as the customer order page, so a guest who picked Hindi at the table
// still gets Hindi in the queue. Only page CHROME is translated; dish and
// category names render exactly as the restaurant entered them.
// ---------------------------------------------------------------------------
type Lang = "en" | "hi";
const LANG_KEY = "qr_menu_lang";
const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    eyebrow: "JOIN · RELAX · DINE",
    loading: "Finding your place in line…",
    offlineTitle: "We couldn't reach the restaurant",
    offlineBody: "Check your connection — your place in line is safe.",
    retry: "Try again",
    joinTitle: "Join the waitlist",
    joinSub: "We'll alert you here the moment your table is ready.",
    fieldName: "Your name",
    namePlaceholder: "Full name",
    fieldPhone: "Mobile number",
    phonePlaceholder: "10-digit mobile",
    phoneHint: "So we can call you when your table is ready.",
    phoneTenDigits: "Enter a 10-digit mobile number",
    nameRequired: "Please enter your name",
    phoneRequired: "Please enter your mobile number so we can reach you",
    partySize: "Party size",
    guest: "guest",
    guests: "guests",
    joinCta: "Join the queue",
    joining: "Joining…",
    joinFailed: "Could not join the queue",
    networkError: "Network error — please try again",
    statusWaiting: "In the queue",
    statusCalled: "Table ready",
    statusSeated: "Seated",
    position: "POSITION",
    youreNext: "You're next — stay close!",
    aheadOne: "party ahead of you",
    aheadMany: "parties ahead of you",
    weWillAlert: "This page updates by itself. Keep it open and we'll buzz you.",
    partyOf: "Party of",
    leave: "Leave the queue",
    tableReady: "Your table is ready!",
    headToHost: "Please head over to the host to be seated.",
    seatedTitle: "You're seated",
    seatedAt: "You're seated at",
    seatedPre: "Your picks are on their way to the kitchen. Enjoy!",
    seatedPlain: "Enjoy your meal!",
    done: "Done",
    groupTitle: "You're joining the group",
    groupSub: "Add your name so the host knows you're here.",
    groupSubMenu: "Add your name so the host knows you're here — then pick your dishes below.",
    groupPhone: "Your phone",
    groupHint: "A 10-digit mobile number.",
    groupCta: "Add me to the group",
    groupAdding: "Adding…",
    groupFailed: "Could not add you to the group",
    groupDone: "You're added to the group",
    shareTitle: "Bring your party",
    shareSub: "Scan to follow this spot in line together.",
    shareSubMenu: "Scan to follow this spot in line together and add to the order.",
    preTitle: "Get a head start",
    preSub: "Pick what you'd like — it goes to the kitchen automatically when you're seated.",
    add: "Add",
    menuEmptyTitle: "Menu unavailable right now",
    menuEmptyBody: "You're still in the queue — we'll call you the moment a table frees up.",
    savePicks: "Save my picks",
    saved: "Saved",
    confirmTitle: "Confirm your pre-order",
    confirmBody: "Once you're seated, this goes straight to the kitchen as your order. Nothing is charged now — you can still change it while you wait.",
    confirmYes: "Confirm pre-order",
    confirmNo: "Cancel",
    item: "item",
    items: "items",
    popupBody: "Please head over to the host now to be seated.",
    popupBodySaved: "Please head over to the host now — your picks are saved.",
    gotIt: "Got it",
    notifTitle: "your table is ready!",
    notifBody: "Please head to the host.",
  },
  hi: {
    eyebrow: "जुड़ें · आराम करें · भोजन करें",
    loading: "आपकी बारी का पता लगाया जा रहा है…",
    offlineTitle: "रेस्टोरेंट से संपर्क नहीं हो पाया",
    offlineBody: "अपना इंटरनेट जाँचें — कतार में आपकी जगह सुरक्षित है।",
    retry: "फिर कोशिश करें",
    joinTitle: "वेटलिस्ट में जुड़ें",
    joinSub: "टेबल तैयार होते ही हम आपको यहीं सूचित कर देंगे।",
    fieldName: "आपका नाम",
    namePlaceholder: "पूरा नाम",
    fieldPhone: "मोबाइल नंबर",
    phonePlaceholder: "10 अंकों का मोबाइल",
    phoneHint: "ताकि टेबल तैयार होने पर हम आपको कॉल कर सकें।",
    phoneTenDigits: "10 अंकों का मोबाइल नंबर डालें",
    nameRequired: "कृपया अपना नाम डालें",
    phoneRequired: "कृपया अपना मोबाइल नंबर डालें ताकि हम संपर्क कर सकें",
    partySize: "कितने लोग",
    guest: "मेहमान",
    guests: "मेहमान",
    joinCta: "कतार में जुड़ें",
    joining: "जोड़ा जा रहा है…",
    joinFailed: "कतार में नहीं जुड़ पाए",
    networkError: "नेटवर्क समस्या — कृपया दोबारा कोशिश करें",
    statusWaiting: "कतार में",
    statusCalled: "टेबल तैयार",
    statusSeated: "बैठा दिया गया",
    position: "आपका नंबर",
    youreNext: "आपकी बारी अगली है — पास ही रहें!",
    aheadOne: "ग्रुप आपसे आगे है",
    aheadMany: "ग्रुप आपसे आगे हैं",
    weWillAlert: "यह पेज अपने आप अपडेट होता है। इसे खुला रखें, हम आपको बुला लेंगे।",
    partyOf: "कुल लोग",
    leave: "कतार छोड़ें",
    tableReady: "आपकी टेबल तैयार है!",
    headToHost: "कृपया बैठने के लिए होस्ट के पास पहुँचें।",
    seatedTitle: "आप बैठ चुके हैं",
    seatedAt: "आपकी टेबल है",
    seatedPre: "आपकी पसंद किचन तक पहुँच रही है। आनंद लें!",
    seatedPlain: "भोजन का आनंद लें!",
    done: "ठीक है",
    groupTitle: "आप ग्रुप में शामिल हो रहे हैं",
    groupSub: "अपना नाम जोड़ें ताकि होस्ट को पता रहे कि आप आ चुके हैं।",
    groupSubMenu: "अपना नाम जोड़ें ताकि होस्ट को पता रहे कि आप आ चुके हैं — फिर नीचे से व्यंजन चुनें।",
    groupPhone: "आपका फ़ोन",
    groupHint: "10 अंकों का मोबाइल नंबर।",
    groupCta: "मुझे ग्रुप में जोड़ें",
    groupAdding: "जोड़ा जा रहा है…",
    groupFailed: "आपको ग्रुप में नहीं जोड़ पाए",
    groupDone: "आप ग्रुप में जुड़ गए हैं",
    shareTitle: "अपने साथियों को जोड़ें",
    shareSub: "स्कैन करें और साथ मिलकर अपनी बारी देखें।",
    shareSubMenu: "स्कैन करें, साथ मिलकर बारी देखें और ऑर्डर में जोड़ें।",
    preTitle: "पहले से ऑर्डर चुनें",
    preSub: "जो पसंद हो चुन लें — बैठते ही यह अपने आप किचन को चला जाएगा।",
    add: "जोड़ें",
    menuEmptyTitle: "मेनू अभी उपलब्ध नहीं है",
    menuEmptyBody: "आप कतार में बने हुए हैं — टेबल खाली होते ही हम बुला लेंगे।",
    savePicks: "मेरी पसंद सेव करें",
    saved: "सेव हो गया",
    confirmTitle: "अपना प्री-ऑर्डर पक्का करें",
    confirmBody: "बैठते ही यह सीधे किचन को आपके ऑर्डर के रूप में चला जाएगा। अभी कोई पैसा नहीं लिया जा रहा — इंतज़ार के दौरान आप इसे बदल भी सकते हैं।",
    confirmYes: "प्री-ऑर्डर पक्का करें",
    confirmNo: "रहने दें",
    item: "आइटम",
    items: "आइटम",
    popupBody: "कृपया अभी होस्ट के पास पहुँचें, वे आपको बैठा देंगे।",
    popupBodySaved: "कृपया अभी होस्ट के पास पहुँचें — आपकी पसंद सेव है।",
    gotIt: "समझ गया",
    notifTitle: "आपकी टेबल तैयार है!",
    notifBody: "कृपया होस्ट के पास पहुँचें।",
  },
};
type Tr = (key: string) => string;

// Material Symbols glyph (renders nothing until the icon font lands).
function Icon(props: { name: string; className?: string; style?: CSSProperties }) {
  return <span className={props.className ? `ms ${props.className}` : "ms"} style={props.style} aria-hidden="true">{props.name}</span>;
}

// ---------------------------------------------------------------------------
// Surface recipes. Every value resolves through the CSS custom properties set
// on the page root — the accent RAMP (guestThemeVars) and the tenant's nine
// colour ROLES (paletteVars). There is no hardcoded colour on this page: the
// "greys" are the tenant's own text colour at low alpha, so a green brand gets
// green-tinted chrome rather than a grey page.
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
  background: "linear-gradient(180deg, var(--accHi), var(--accMid))",
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

// Status pill — waiting/called/seated map onto the palette's warning / accent /
// success roles, so the state reads at a glance without a single fixed colour.
function Chip({ tone, icon, label }: { tone: Tone; icon: string; label: string }) {
  const v = TONE_VAR[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.9px]"
      style={{ background: `rgba(${v.rgb},0.14)`, border: `1px solid rgba(${v.rgb},0.34)`, color: v.flat }}
    >
      <Icon name={icon} style={{ fontSize: 14 }} />
      {label}
    </span>
  );
}

// Inline banner for a recoverable problem (join failed, offline, …).
function Banner({ tone, icon, title, body, action }: { tone: Tone; icon: string; title: string; body?: string; action?: React.ReactNode }) {
  const v = TONE_VAR[tone];
  return (
    <div
      className="rf-rise flex items-start gap-3 px-4 py-3.5"
      style={{ borderRadius: "var(--rCard)", background: `rgba(${v.rgb},0.10)`, border: `1px solid rgba(${v.rgb},0.30)` }}
    >
      <Icon name={icon} style={{ fontSize: 20, color: v.flat, marginTop: 1 }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold" style={{ color: v.flat }}>{title}</p>
        {body ? <p className="mt-0.5 text-[12px]" style={muted(0.62)}>{body}</p> : null}
        {action}
      </div>
    </div>
  );
}

function QueueInner() {
  const params = useParams();
  const restaurant = String((params as Record<string, unknown>)?.restaurant ?? "");
  const search = useSearchParams();
  const outlet = search.get("outlet") ?? ""; // multi-outlet: branch QR carries ?outlet=<id>
  const urlToken = search.get("token"); // party-share: a member scanned the joiner's QR
  const storeKey = `waitlist_token_${restaurant}`;
  const ownerKey = `waitlist_owner_${restaurant}`; // the token THIS device originated (vs. a shared party link it merely followed)
  // Written ONLY when this device joins the queue. Unlike ownerKey (which is
  // backfilled on resume), its presence proves this device really joined, so a
  // reload can safely restore the seated→table redirect.
  const joinedKey = `waitlist_joined_${restaurant}`;
  // WHEN this device joined. The joined marker alone is not enough: it also
  // matched a visit from days ago, so reopening the queue page instantly threw a
  // fresh walk-in onto that old party's table. A seated entry only counts as
  // "mine, now" inside one dining session.
  const joinedAtKey = `waitlist_joined_at_${restaurant}`;
  const JOIN_SESSION_MS = 4 * 60 * 60 * 1000; // 4h — one sitting, generously

  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState<{ name: string; logo: string | null; currency: string; showMenu: boolean }>({
    name: restaurant, logo: null, currency: "₹", showMenu: true,
  });
  // The tenant's nine colour roles + the customer-page knobs (font, panel
  // material, control shape, hero wash). Defaults reproduce the shipped look.
  const [palette, setPalette] = useState<GuestPalette>(() => resolveGuestPalette(null));
  const [brandConfig, setBrandConfig] = useState<GuestBrandConfig | null>(null);
  const [brandError, setBrandError] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  // True only when THIS visit actively engaged with the current entry — i.e. the
  // person joined the queue in this session, or arrived via a party share link
  // (?token=). It stays FALSE for a token silently resumed from localStorage.
  // A seated entry only redirects to its table (with the OTP gate) when this is
  // true, so a fresh walk-in who scans the entrance QR on a device that still
  // holds a previous party's token is never hijacked to that party's table.
  const [activeThisSession, setActiveThisSession] = useState(false);
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
  const [lang, setLang] = useState<Lang>("en");

  // Party-guest capture: a device that opened a shared ?token= it did NOT originate.
  // We ask THIS person for their name/phone once and add them as a party member.
  const [isPartyGuest, setIsPartyGuest] = useState(false);
  const [memberDone, setMemberDone] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const money = (n: number) => `${brand.currency}${Number(n || 0).toFixed(0)}`;

  // Restore the guest's language choice (after mount — SSR always renders EN).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "hi") {setLang(saved);}
    } catch { /* private mode */ }
  }, []);
  const switchLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  };
  const t: Tr = useCallback((key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key, [lang]);

  // Load branding + menu. Kept in a callback so the offline banner can retry it
  // without a full page reload.
  const loadBrand = useCallback(async () => {
    if (!restaurant) {return;}
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/menu`);
      if (!r.ok) { setBrandError(true); return; }
      const d = await r.json();
      setBrand({
        name: d.restaurant_name ?? restaurant,
        logo: d.logo_url ?? null,
        currency: d.currency || "₹",
        showMenu: d.queue_show_menu !== false,
      });
      // Colour comes from the RESOLVED brand palette the backend returns; the
      // legacy theme_primary/theme_color pair is only a fallback for a payload
      // that predates it (for real tenants theme_color is often a dark grey,
      // which is exactly the monochrome look this page must not have).
      setPalette(resolveGuestPalette(d.brand_palette, pickHex(d.theme_primary, d.theme_color)));
      setBrandConfig((d.brand_config ?? null) as GuestBrandConfig | null);
      setMenu(Array.isArray(d.items) ? d.items : []);
      setBrandError(false);
    } catch { setBrandError(true); }
  }, [restaurant]);
  useEffect(() => { void loadBrand(); }, [loadBrand]);

  // Design constants (Instrument Serif display, Roboto numerals, Material
  // Symbols) + the tenant's own body font.
  useEffect(() => { loadDesignFonts(); }, []);
  useEffect(() => { if (brandConfig?.font) {loadBrandFont(brandConfig.font);} }, [brandConfig?.font]);

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
        // Arrived via a share link → a genuine participant in this entry.
        setActiveThisSession(true);
      } else {
        const t2 = localStorage.getItem(storeKey);
        if (t2) {
          setToken(t2);
          // A device that JOINED this entry keeps its seated→table redirect across
          // a reload. We key off a marker written only at join time (not the
          // backfilled ownerKey), so a device still holding a PREVIOUS party's
          // token — which never had this marker — still cannot be hijacked into
          // that party's table. Without this, reloading the page silently dropped
          // a legitimately seated party back to the queue view.
          try {
            const joinedAt = Number(localStorage.getItem(joinedAtKey) ?? 0);
            const fresh = Number.isFinite(joinedAt) && joinedAt > 0 && Date.now() - joinedAt < JOIN_SESSION_MS;
            if (localStorage.getItem(joinedKey) === t2 && fresh) {
              setActiveThisSession(true);
            } else if (!fresh) {
              // Stale sitting — forget it entirely so the guest gets the join form
              // instead of being bounced to a table they left long ago.
              localStorage.removeItem(storeKey);
              localStorage.removeItem(joinedKey);
              localStorage.removeItem(joinedAtKey);
              setToken(null);
            }
          } catch { /* ignore */ }
          // Backfill ownership so a device resuming its OWN saved entry is never
          // mistaken for a party guest if it later reopens via its share link.
          if (!owned) { try { localStorage.setItem(ownerKey, t2); } catch { /* ignore */ } }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [storeKey, ownerKey, joinedKey, joinedAtKey, urlToken, restaurant]);

  // Poll the entry status while we have a token.
  useEffect(() => {
    if (!token) {return;}
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}`);
        if (r.status === 404) { if (active) { try { localStorage.removeItem(storeKey); localStorage.removeItem(joinedKey); localStorage.removeItem(joinedAtKey); } catch {} setToken(null); setEntry(null); } return; }
        if (r.ok && active) {
          const d = await r.json();
          // Staff ended this entry → stop polling and reset to a fresh join form.
          if (d?.status === "cancelled" || d?.status === "no_show") {
            try { localStorage.removeItem(storeKey); localStorage.removeItem(joinedKey); localStorage.removeItem(joinedAtKey); } catch {}
            setToken(null); setEntry(null);
            return;
          }
          // A seated entry this device did NOT actively engage with this session is
          // a STALE token — a previous party's token left in this browser, or the
          // entrance QR scanned on a shared device. Don't adopt it (which would
          // hijack a fresh walk-in to that party's table + OTP): drop it and show
          // the join form. (Active waits — waiting/called — still resume normally.)
          if (d?.status === "seated" && !activeThisSession) {
            try { localStorage.removeItem(storeKey); localStorage.removeItem(joinedKey); localStorage.removeItem(joinedAtKey); } catch {}
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
  }, [token, restaurant, storeKey, joinedKey, joinedAtKey, activeThisSession]);

  // Seed the cart from a saved pre-order the first time the entry loads.
  useEffect(() => {
    if (entry && !cartSeeded) {
      const seed: Record<string, number> = {};
      for (const it of entry.pre_order ?? []) {seed[it.id] = it.quantity;}
      if (Object.keys(seed).length) {setCart(seed);}
      setCartSeeded(true);
    }
  }, [entry, cartSeeded]);

  // "It's your turn" → pop-up + browser notification + vibrate. Fires once per
  // entry whenever we observe 'called' — including the FIRST observed state after a
  // tab reopen/refresh (an ack flag in localStorage prevents re-firing on later polls).
  useEffect(() => {
    if (entry?.status !== "called") {return;}
    const ackKey = `waitlist_called_${restaurant}_${entry.token}`;
    let acked = false;
    try { acked = localStorage.getItem(ackKey) === "1"; } catch { /* ignore */ }
    if (acked) {return;}
    setShowCalled(true);
    try { if (typeof Notification !== "undefined" && Notification.permission === "granted") {new Notification(`${brand.name}: ${t("notifTitle")}`, { body: t("notifBody") });} } catch { /* ignore */ }
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
    try { localStorage.setItem(ackKey, "1"); } catch { /* ignore */ }
  }, [entry, brand.name, restaurant, t]);

  // Once seated, send the party straight to THEIR table's menu (signed token from
  // the backend) — the queue link becomes the ordering link.
  useEffect(() => {
    // Only redirect a party that genuinely engaged with this entry this session
    // (joined here, or arrived via a share link). A seated token merely resumed
    // from localStorage is stale and must never bounce a fresh visitor to a
    // table's order+OTP page — the poll effect above clears it instead.
    if (entry?.status === "seated" && entry.qr_token && activeThisSession && typeof window !== "undefined") {
      const url = `/order/${encodeURIComponent(restaurant)}?t=${encodeURIComponent(entry.qr_token)}`
        + (outlet ? `&outlet=${encodeURIComponent(outlet)}` : "");
      window.location.replace(url);
    }
  }, [entry?.status, entry?.qr_token, restaurant, outlet, activeThisSession]);

  // A shareable QR of THIS party's queue link so others in the group can scan,
  // watch the same spot in line, and add to the pre-order together.
  useEffect(() => {
    if (!entry || typeof window === "undefined" || (entry.status !== "waiting" && entry.status !== "called")) { setShareQr(""); return; }
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set("token", entry.token);
    if (outlet) {u.searchParams.set("outlet", outlet);}
    QRCode.toDataURL(u.toString(), { width: 512, margin: 2 }).then(setShareQr).catch(() => { setShareQr(""); });
  }, [entry, outlet]);

  const join = async () => {
    if (!name.trim()) { setError(t("nameRequired")); return; }
    // Phone is REQUIRED to join the queue: staff call people by phone when their
    // table is ready, and the waitlist board shows the number beside the party.
    if (!phone.trim()) { setError(t("phoneRequired")); return; }
    if (!isMobile10(phone)) { setError(t("phoneTenDigits")); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: normalizeMobile10(phone) ?? "", party_size: party, ...(outlet ? { outlet } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error ?? t("joinFailed")); return; }
      try {
        localStorage.setItem(storeKey, d.token);
        localStorage.setItem(ownerKey, d.token);
        localStorage.setItem(joinedKey, d.token);
        localStorage.setItem(joinedAtKey, String(Date.now()));
      } catch {}
      try { if (typeof Notification !== "undefined" && Notification.permission === "default") {Notification.requestPermission();} } catch {}
      setToken(d.token);
      // Joined in this session → this device genuinely owns this entry, so the
      // seated redirect is welcome once they're seated.
      setActiveThisSession(true);
    } catch { setError(t("networkError")); }
    finally { setBusy(false); }
  };

  const cartItems = useCallback((): PreItem[] => {
    return Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => { const m = menu.find((x) => x.id === id); return m ? { id, name: m.name, price: m.price, quantity: q } : null; })
      .filter((x): x is PreItem => x != null);
  }, [cart, menu]);

  // The guest confirms ONCE before anything is held. Tapping "save my picks" used
  // to POST immediately and show a small "Saved" chip — from the guest's side
  // that gave no sense that these items become a real order the moment they sit
  // down. So the tap now opens the summary below, and only the confirm sends.
  const [confirming, setConfirming] = useState(false);

  const savePreorder = async () => {
    if (!token) {return;}
    setConfirming(false);
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}/preorder`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cartItems() }),
      });
      if (r.ok) {setSavedAt(Date.now());}
    } catch {}
    finally { setBusy(false); }
  };

  // Party guest introduces themselves → appended to the host's party_members.
  // Phone must be EXACTLY 10 digits (AddWaitlistMember enforces the same rule
  // server-side; the old ">= 7 digits" allowed numbers the API now rejects).
  // Dedupe/cap is server-side.
  const submitMember = async () => {
    if (!token) {return;}
    const nm = memberName.trim();
    if (!nm) { setMemberError(t("nameRequired")); return; }
    const normalized = normalizeMobile10(memberPhone);
    if (!normalized) { setMemberError(t("phoneTenDigits")); return; }
    setMemberBusy(true); setMemberError(null);
    try {
      const r = await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}/member`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, phone: normalized }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMemberError(d?.error ?? t("groupFailed")); return; }
      try { localStorage.setItem(`waitlist_member_${restaurant}_${token}`, "1"); } catch {}
      setMemberDone(true);
    } catch { setMemberError(t("networkError")); }
    finally { setMemberBusy(false); }
  };

  const leave = async () => {
    if (!token) {return;}
    setBusy(true);
    try { await fetch(`${BASE}/qr/${encodeURIComponent(restaurant)}/waitlist/${token}/cancel`, { method: "POST" }); } catch {}
    try { localStorage.removeItem(storeKey); } catch {}
    setToken(null); setEntry(null); setCart({}); setCartSeeded(false); setBusy(false);
  };

  // Menu grouped by category (like the order interface).
  const availableMenu = useMemo(() => menu.filter((m) => m.available !== false), [menu]);
  const byCategory = useMemo(() => {
    const m: Record<string, MenuItem[]> = {};
    for (const it of availableMenu) {(m[it.category || "Menu"] ??= []).push(it);}
    return m;
  }, [availableMenu]);
  const categories = useMemo(() => Object.keys(byCategory).sort(), [byCategory]);
  const active = activeCat && categories.includes(activeCat) ? activeCat : categories[0];
  const shown = active ? byCategory[active] ?? [] : [];

  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);
  const cartTotal = cartItems().reduce((s, it) => s + it.price * it.quantity, 0);

  // Theme: the accent ramp from the tenant's PRIMARY brand colour + the panel
  // material / control shape / hero wash from brand_config, plus the nine roles.
  const theme = useMemo(() => resolveGuestTheme(palette.primary, brandConfig), [palette.primary, brandConfig]);
  const rootVars = useMemo(() => ({ ...guestThemeVars(theme), ...paletteVars(palette) }), [theme, palette]);
  const bodyFont = brandConfig?.font ? fontStack(brandConfig.font) : "Roboto, system-ui, sans-serif";

  if (loading) {return <QueueSkeleton vars={rootVars} font={bodyFont} label={t("loading")} />;}

  const setQty = (id: string, delta: number) => { setCart((c) => { const q = Math.max(0, (c[id] ?? 0) + delta); const n = { ...c }; if (q === 0) {delete n[id];} else {n[id] = q;} return n; }); };
  const onTabsDown = (e: { clientX: number }) => { const el = tabsRef.current; if (!el) {return;} drag.current = { down: true, startX: e.clientX, scroll: el.scrollLeft, moved: false }; };
  const onTabsMove = (e: { clientX: number }) => { const el = tabsRef.current; if (!el || !drag.current.down) {return;} const dx = e.clientX - drag.current.startX; if (Math.abs(dx) > 4) {drag.current.moved = true;} el.scrollLeft = drag.current.scroll - dx; };
  const onTabsUp = () => { drag.current.down = false; };

  const showJoinForm = !token || !entry || entry.status === "cancelled" || entry.status === "no_show";
  const waiting = !showJoinForm && entry && (entry.status === "waiting" || entry.status === "called");
  const showSaveBar = Boolean(brand.showMenu && token && waiting && cartCount > 0);
  const phoneBad = phone.length > 0 && !isMobile10(phone);
  const memberPhoneBad = memberPhone.length > 0 && !isMobile10(memberPhone);

  const MenuRow = ({ m }: { m: MenuItem }) => {
    const qty = cart[m.id] ?? 0;
    const monogram = (m.name.trim()[0] ?? "•").toUpperCase();
    return (
      <div className="flex items-center gap-3 p-2.5" style={{ ...PANEL, borderRadius: 18, boxShadow: "0 10px 26px rgba(0,0,0,0.32)" }}>
        <div className="relative flex h-[62px] w-[62px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[15px]" style={{ background: "linear-gradient(150deg, rgba(var(--accDeepRGB),0.35), rgba(var(--bgRGB),0.9))", border: "1px solid rgba(var(--inkRGB),0.07)" }}>
          {m.image_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={m.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            : <span className="rf-serif text-[26px] leading-none" style={{ color: "var(--accHi)" }}>{monogram}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{m.name}</p>
          <p className="rf-num mt-0.5 text-[17px]" style={{ color: "rgba(var(--inkRGB),0.8)" }}>{money(m.price)}</p>
        </div>
        {qty ? (
          <div className="flex flex-shrink-0 items-center gap-2 p-1.5" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.15)", border: "1px solid rgba(var(--accRGB),0.28)" }}>
            <button aria-label="Remove one" onClick={() => { setQty(m.id, -1); }} className="rf-press flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "rgba(var(--bgRGB),0.6)" }}>
              <Icon name="remove" style={{ fontSize: 17, color: "var(--accHi)" }} />
            </button>
            <span className="rf-num min-w-[16px] text-center text-[16px] font-medium" style={{ color: "var(--ink)" }}>{qty}</span>
            <button aria-label="Add one" onClick={() => { setQty(m.id, 1); }} className="rf-press flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "linear-gradient(180deg, var(--accHi), var(--accMid))" }}>
              <Icon name="add" style={{ fontSize: 17, color: "var(--onAcc)" }} />
            </button>
          </div>
        ) : (
          <button onClick={() => { setQty(m.id, 1); }} className="rf-press flex flex-shrink-0 items-center gap-1 px-3.5 py-2 text-[12.5px] font-bold" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.16)", border: "1px solid rgba(var(--accRGB),0.32)", color: "var(--accHi)" }}>
            <Icon name="add" style={{ fontSize: 16 }} />{t("add")}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative mx-auto min-h-dvh max-w-md overflow-x-hidden"
      style={{ ...rootVars, backgroundColor: "var(--bg)", color: "var(--ink)", fontFamily: bodyFont, paddingBottom: showSaveBar ? 124 : 44 }}
    >
      <style>{GUEST_CSS}{GUEST_FX_CSS}</style>

      {/* Page base + two floating brand orbs behind everything. */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{ backgroundColor: "var(--bg)" }} />
      <div className="pointer-events-none fixed z-0" style={{ top: -130, left: -90, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.22), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="pointer-events-none fixed z-0" style={{ bottom: -150, right: -70, width: 340, height: 340, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--brand2RGB),0.20), transparent 65%)", filter: "blur(34px)", animation: "rfFloatOrb 21s ease-in-out infinite reverse" }} />

      <div className="relative z-10">
        {/* HERO */}
        <header className="relative overflow-hidden" style={{ height: 186 }}>
          <div className="absolute inset-0" style={{ background: "var(--heroWash)" }} />
          {brand.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(var(--bgRGB),0.16), rgba(var(--bgRGB),0.55) 45%, rgba(var(--bgRGB),0.97))" }} />
          <div className="pointer-events-none absolute" style={{ top: -80, right: -50, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accHiRGB),0.34), transparent 62%)", filter: "blur(14px)" }} />
          <div className="relative flex h-full flex-col justify-between px-5 pb-4 pt-8">
            <div className="flex items-start justify-between gap-3">
              {brand.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt="" className="h-11 w-11 rounded-[14px] object-cover" style={{ border: "1px solid rgba(var(--inkRGB),0.18)", boxShadow: "0 8px 22px rgba(0,0,0,0.45)" }} />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-[14px]" style={{ background: "linear-gradient(145deg, var(--accHi), var(--accDeep))", boxShadow: "0 8px 22px rgba(var(--accShadowRGB),0.5)" }}>
                  <Icon name="restaurant" style={{ fontSize: 22, color: "var(--onAcc)" }} />
                </div>
              )}
              <div className="flex overflow-hidden text-[11px] font-bold" style={{ borderRadius: "var(--rCtrl)", border: "1px solid rgba(var(--inkRGB),0.14)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                {(["en", "hi"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => { switchLang(l); }}
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
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[2px]" style={{ color: "var(--accHi)", textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>{t("eyebrow")}</div>
              <h1 className="rf-serif text-[34px] leading-none" style={{ color: "var(--ink)", textShadow: "0 2px 16px rgba(0,0,0,0.55)" }}>{brand.name}</h1>
            </div>
          </div>
        </header>

        <div className="space-y-4 px-4 pt-4">
          {brandError ? (
            <Banner
              tone="err"
              icon="wifi_off"
              title={t("offlineTitle")}
              body={t("offlineBody")}
              action={(
                <button onClick={() => { void loadBrand(); }} className="rf-press mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--errRGB),0.16)", border: "1px solid rgba(var(--errRGB),0.34)", color: "var(--err)" }}>
                  <Icon name="refresh" style={{ fontSize: 15 }} />{t("retry")}
                </button>
              )}
            />
          ) : null}

          {showJoinForm ? (
            // --- Join form ---
            <section className="rf-rise overflow-hidden" style={PANEL}>
              <div className="px-5 pb-5 pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px]" style={{ background: "linear-gradient(145deg, var(--accHi), var(--accDeep))", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.45)" }}>
                    <Icon name="event_seat" style={{ fontSize: 22, color: "var(--onAcc)" }} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="rf-serif text-[24px] leading-none" style={{ color: "var(--ink)" }}>{t("joinTitle")}</h2>
                    <p className="mt-1.5 text-[12.5px] leading-snug" style={muted(0.6)}>{t("joinSub")}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="q-name" className="mb-1.5 block text-[11px] font-bold uppercase" style={LABEL}>{t("fieldName")}</label>
                    <input id="q-name" className="rf-field" value={name} onChange={(e) => { setName(e.target.value); }} placeholder={t("namePlaceholder")} autoComplete="name" />
                  </div>

                  <div>
                    <label htmlFor="q-phone" className="mb-1.5 block text-[11px] font-bold uppercase" style={LABEL}>{t("fieldPhone")}</label>
                    <input
                      id="q-phone"
                      className="rf-field"
                      value={phone}
                      onChange={(e) => { setPhone(sanitizePhoneInput(e.target.value)); }}
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={13}
                      aria-invalid={phoneBad}
                      placeholder={t("phonePlaceholder")}
                    />
                    <p className="mt-1.5 flex items-center gap-1 text-[11.5px]" style={phoneBad ? { color: "var(--err)" } : muted(0.5)}>
                      <Icon name={phoneBad ? "error" : "call"} style={{ fontSize: 14 }} />
                      {phoneBad ? t("phoneTenDigits") : t("phoneHint")}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[11px] font-bold uppercase" style={LABEL}>{t("partySize")}</label>
                    <div className="flex items-center gap-3 p-1.5" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--bgRGB),0.55)", border: "1.5px solid rgba(var(--inkRGB),0.10)" }}>
                      <button aria-label="Fewer guests" onClick={() => { setParty((p) => Math.max(1, p - 1)); }} className="rf-press flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(var(--inkRGB),0.06)", border: "1px solid rgba(var(--inkRGB),0.1)" }}>
                        <Icon name="remove" style={{ fontSize: 20, color: "var(--ink)" }} />
                      </button>
                      <div className="flex flex-1 items-baseline justify-center gap-1.5">
                        <span className="rf-num text-[30px] leading-none" style={{ color: "var(--ink)" }}>{party}</span>
                        <span className="text-[12px] font-medium" style={muted(0.5)}>{party > 1 ? t("guests") : t("guest")}</span>
                      </div>
                      <button aria-label="More guests" onClick={() => { setParty((p) => Math.min(50, p + 1)); }} className="rf-press flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "linear-gradient(180deg, var(--accHi), var(--accMid))", boxShadow: "0 8px 18px rgba(var(--accShadowRGB),0.45)" }}>
                        <Icon name="add" style={{ fontSize: 20, color: "var(--onAcc)" }} />
                      </button>
                    </div>
                  </div>

                  {error ? <Banner tone="err" icon="error" title={error} /> : null}

                  {/* Submit stays blocked while a typed number is not 10 digits. */}
                  <button onClick={join} disabled={busy || !name.trim() || !isOptionalMobile10(phone)} className="rf-press flex w-full items-center justify-center gap-2 py-4 text-[15px] font-bold disabled:opacity-45" style={PRIMARY_BTN}>
                    {busy ? <Icon name="progress_activity" style={{ fontSize: 19, animation: "rfSpin 1s linear infinite" }} /> : <Icon name="how_to_reg" style={{ fontSize: 19 }} />}
                    {busy ? t("joining") : t("joinCta")}
                  </button>
                </div>
              </div>
            </section>
          ) : entry && entry.status === "seated" ? (
            <section className="rf-rise px-6 py-9 text-center" style={PANEL}>
              <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
                <span className="absolute inset-0 rounded-full" style={{ background: "rgba(var(--okRGB),0.35)", animation: "rfHalo 2.4s ease-out infinite" }} />
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full" style={{ background: "linear-gradient(150deg, rgba(var(--okRGB),0.9), rgba(var(--okRGB),0.45))", boxShadow: "0 14px 30px rgba(var(--okRGB),0.3)" }}>
                  <Icon name="celebration" style={{ fontSize: 36, color: "var(--bg)" }} />
                </span>
              </div>
              <h2 className="rf-serif mt-5 text-[27px] leading-tight" style={{ color: "var(--ink)" }}>
                {entry.table_name ? `${t("seatedAt")} ${entry.table_name}` : t("seatedTitle")}
              </h2>
              <p className="mx-auto mt-2 max-w-[16rem] text-[13px] leading-snug" style={muted(0.6)}>
                {entry.pre_order.length ? t("seatedPre") : t("seatedPlain")}
              </p>
              <button onClick={leave} className="rf-press mt-6 px-5 py-2.5 text-[12.5px] font-bold" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--inkRGB),0.06)", border: "1px solid rgba(var(--inkRGB),0.12)", color: "rgba(var(--inkRGB),0.72)" }}>
                {t("done")}
              </button>
            </section>
          ) : entry ? (
            // --- Waiting / called ---
            <>
              <section className="rf-rise overflow-hidden" style={PANEL}>
                <div className="px-5 pb-6 pt-6 text-center">
                  {entry.status === "called" ? (
                    <>
                      <Chip tone="acc" icon="notifications_active" label={t("statusCalled")} />
                      <div className="relative mx-auto mt-6 flex h-[124px] w-[124px] items-center justify-center">
                        <span className="absolute inset-0 rounded-full" style={{ background: "rgba(var(--accRGB),0.4)", animation: "rfHalo 2.2s ease-out infinite" }} />
                        <span className="absolute inset-0 rounded-full" style={{ background: "rgba(var(--accRGB),0.28)", animation: "rfHalo 2.2s ease-out .7s infinite" }} />
                        <span className="relative flex h-[112px] w-[112px] items-center justify-center rounded-full" style={{ background: "linear-gradient(150deg, var(--accHi), var(--accDeep))", boxShadow: "0 18px 40px rgba(var(--accShadowRGB),0.55)" }}>
                          <Icon name="notifications_active" style={{ fontSize: 50, color: "var(--onAcc)", animation: "rfBellSwing 2.6s ease-in-out infinite", transformOrigin: "50% 20%" }} />
                        </span>
                      </div>
                      <h2 className="rf-serif mt-6 text-[29px] leading-tight" style={{ color: "var(--accHi)" }}>{t("tableReady")}</h2>
                      <p className="mx-auto mt-2 max-w-[17rem] text-[13px] leading-snug" style={muted(0.6)}>{t("headToHost")}</p>
                    </>
                  ) : (
                    <>
                      <Chip tone="warn" icon="hourglass_top" label={t("statusWaiting")} />
                      <div className="relative mx-auto mt-6 flex h-[150px] w-[150px] items-center justify-center">
                        {entry.position <= 1 && (
                          <span className="absolute rounded-full" style={{ inset: 4, background: "rgba(var(--accRGB),0.3)", animation: "rfHalo 2.4s ease-out infinite" }} />
                        )}
                        <span className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 200deg, rgba(var(--accHiRGB),0.95), rgba(var(--accDeepRGB),0.18) 52%, rgba(var(--brand2RGB),0.75) 78%, rgba(var(--accHiRGB),0.95))" }} />
                        <span className="absolute rounded-full" style={{ inset: 5, background: "linear-gradient(160deg, rgba(var(--surfaceRGB),0.97), rgba(var(--bgRGB),0.99))", border: "1px solid rgba(var(--inkRGB),0.07)" }} />
                        <span className="relative flex flex-col items-center">
                          <span className="text-[9.5px] font-bold uppercase tracking-[2px]" style={muted(0.45)}>{t("position")}</span>
                          <span className="rf-num mt-0.5 text-[58px] leading-none" style={{ color: "var(--ink)" }}>{entry.position}</span>
                        </span>
                      </div>
                      <p className="mt-6 text-[15.5px] font-semibold" style={{ color: entry.position <= 1 ? "var(--accHi)" : "var(--ink)" }}>
                        {entry.position <= 1 ? t("youreNext") : `${entry.position - 1} ${entry.position - 1 === 1 ? t("aheadOne") : t("aheadMany")}`}
                      </p>
                      <p className="mx-auto mt-2 max-w-[17rem] text-[12.5px] leading-snug" style={muted(0.55)}>{t("weWillAlert")}</p>
                    </>
                  )}

                  <div className="mt-6 flex items-center justify-between gap-2 pt-4" style={{ borderTop: "1px solid rgba(var(--inkRGB),0.09)" }}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: "rgba(var(--accRGB),0.16)", color: "var(--accHi)" }}>
                        {(entry.name.trim()[0] ?? "?").toUpperCase()}
                      </span>
                      <div className="min-w-0 text-left">
                        <p className="truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{entry.name}</p>
                        <p className="text-[11px]" style={muted(0.5)}>{t("partyOf")} {entry.party_size}</p>
                      </div>
                    </div>
                    <button onClick={leave} disabled={busy} className="rf-press flex-shrink-0 px-3 py-2 text-[11.5px] font-semibold disabled:opacity-50" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--errRGB),0.10)", border: "1px solid rgba(var(--errRGB),0.26)", color: "var(--err)" }}>
                      {t("leave")}
                    </button>
                  </div>
                </div>
              </section>

              {/* Party guest: capture this scanner's own contact once, then confirm. */}
              {isPartyGuest && !memberDone ? (
                <section className="rf-rise px-5 pb-5 pt-5" style={PANEL}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[13px]" style={{ background: "rgba(var(--brand2RGB),0.18)", border: "1px solid rgba(var(--brand2RGB),0.3)" }}>
                      <Icon name="group_add" style={{ fontSize: 20, color: "var(--brand2)" }} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{t("groupTitle")} · {entry.name}</h3>
                      <p className="mt-0.5 text-[12px] leading-snug" style={muted(0.58)}>{brand.showMenu ? t("groupSubMenu") : t("groupSub")}</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3.5">
                    <div>
                      <label htmlFor="q-mname" className="mb-1.5 block text-[11px] font-bold uppercase" style={LABEL}>{t("fieldName")}</label>
                      <input id="q-mname" className="rf-field" value={memberName} onChange={(e) => { setMemberName(e.target.value); }} placeholder={t("namePlaceholder")} autoComplete="name" />
                    </div>
                    <div>
                      <label htmlFor="q-mphone" className="mb-1.5 block text-[11px] font-bold uppercase" style={LABEL}>{t("groupPhone")}</label>
                      <input
                        id="q-mphone"
                        className="rf-field"
                        value={memberPhone}
                        onChange={(e) => { setMemberPhone(sanitizePhoneInput(e.target.value)); }}
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={13}
                        aria-invalid={memberPhoneBad}
                        placeholder={t("phonePlaceholder")}
                      />
                      <p className="mt-1.5 text-[11.5px]" style={memberPhoneBad ? { color: "var(--err)" } : muted(0.5)}>
                        {memberPhoneBad ? t("phoneTenDigits") : t("groupHint")}
                      </p>
                    </div>
                    {memberError ? <Banner tone="err" icon="error" title={memberError} /> : null}
                    {/* Required here: 10 digits or the button stays disabled. */}
                    <button onClick={submitMember} disabled={memberBusy || !memberName.trim() || !isMobile10(memberPhone)} className="rf-press flex w-full items-center justify-center gap-2 py-3.5 text-[14px] font-bold disabled:opacity-45" style={PRIMARY_BTN}>
                      {memberBusy ? <Icon name="progress_activity" style={{ fontSize: 18, animation: "rfSpin 1s linear infinite" }} /> : <Icon name="person_add" style={{ fontSize: 18 }} />}
                      {memberBusy ? t("groupAdding") : t("groupCta")}
                    </button>
                  </div>
                </section>
              ) : isPartyGuest && memberDone ? (
                <div className="rf-rise flex items-center justify-center gap-2 px-4 py-3.5 text-[13px] font-semibold" style={{ borderRadius: "var(--rCard)", background: "rgba(var(--okRGB),0.12)", border: "1px solid rgba(var(--okRGB),0.3)", color: "var(--ok)" }}>
                  <Icon name="check_circle" style={{ fontSize: 18 }} />
                  <span>{t("groupDone")} · {entry.name}</span>
                </div>
              ) : null}

              {shareQr ? (
                <section className="rf-rise px-5 pb-5 pt-5 text-center" style={PANEL}>
                  <div className="flex items-center justify-center gap-2">
                    <Icon name="qr_code_2" style={{ fontSize: 18, color: "var(--accHi)" }} />
                    <h3 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{t("shareTitle")}</h3>
                  </div>
                  <p className="mx-auto mt-1 max-w-[17rem] text-[12px] leading-snug" style={muted(0.58)}>{brand.showMenu ? t("shareSubMenu") : t("shareSub")}</p>
                  {/* The QR plate stays a light square on purpose — scanners need
                      the contrast; it sits inside an accent-lit frame. */}
                  <div className="mx-auto mt-4 inline-block rounded-[20px] p-2.5" style={{ background: "linear-gradient(150deg, rgba(var(--accHiRGB),0.55), rgba(var(--brand2RGB),0.35))", boxShadow: "0 14px 34px rgba(var(--accShadowRGB),0.4)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shareQr} alt="Share your place in line" className="h-40 w-40 rounded-[14px] bg-white p-2" />
                  </div>
                </section>
              ) : null}

              {/* Pre-order while waiting */}
              {brand.showMenu && availableMenu.length > 0 && (
                <section className="rf-rise pt-1">
                  <div className="flex items-center gap-2.5 px-1">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px]" style={{ background: "rgba(var(--accRGB),0.14)", border: "1px solid rgba(var(--accRGB),0.28)" }}>
                      <Icon name="restaurant_menu" style={{ fontSize: 19, color: "var(--accHi)" }} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[15.5px] font-bold" style={{ color: "var(--ink)" }}>{t("preTitle")}</h3>
                      <p className="mt-0.5 text-[11.5px] leading-snug" style={muted(0.55)}>{t("preSub")}</p>
                    </div>
                  </div>

                  {categories.length > 1 && (
                    <div
                      ref={tabsRef}
                      onPointerDown={onTabsDown}
                      onPointerMove={onTabsMove}
                      onPointerUp={onTabsUp}
                      onPointerLeave={onTabsUp}
                      className="rf-sc mt-3.5 flex cursor-grab select-none gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [touch-action:pan-x]"
                    >
                      {categories.map((cat) => {
                        const on = cat === active;
                        return (
                          <button
                            key={cat}
                            onClick={() => { if (!drag.current.moved) {setActiveCat(cat);} }}
                            className="rf-press whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] font-semibold"
                            style={on
                              ? { background: "var(--accHi)", color: "var(--onAcc)", border: "1px solid transparent", boxShadow: "0 8px 20px rgba(var(--accShadowRGB),0.4)" }
                              : { background: "rgba(var(--inkRGB),0.05)", color: "rgba(var(--inkRGB),0.6)", border: "1px solid rgba(var(--inkRGB),0.1)" }}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-3.5 space-y-2.5">
                    {shown.map((m) => <MenuRow key={m.id} m={m} />)}
                  </div>
                </section>
              )}

              {brand.showMenu && availableMenu.length === 0 && menu.length === 0 ? (
                <section className="rf-rise px-6 py-8 text-center" style={PANEL}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(var(--inkRGB),0.05)", border: "1px solid rgba(var(--inkRGB),0.1)" }}>
                    <Icon name="no_meals" style={{ fontSize: 26, color: "rgba(var(--inkRGB),0.45)" }} />
                  </div>
                  <p className="mt-3.5 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("menuEmptyTitle")}</p>
                  <p className="mx-auto mt-1 max-w-[17rem] text-[12px] leading-snug" style={muted(0.55)}>{t("menuEmptyBody")}</p>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Save-picks bar */}
      {showSaveBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md px-4 pb-4 pt-8" style={{ background: "linear-gradient(180deg, transparent, rgba(var(--bgRGB),0.9) 45%)", pointerEvents: "none" }}>
          <div
            className="flex items-center gap-3 px-3.5 py-3"
            style={{ pointerEvents: "auto", borderRadius: "var(--rCard)", background: "rgba(var(--surfaceRGB),0.78)", backdropFilter: "blur(26px) saturate(150%)", WebkitBackdropFilter: "blur(26px) saturate(150%)", border: "1px solid rgba(var(--inkRGB),0.13)", boxShadow: "0 20px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(var(--inkRGB),0.08)" }}
          >
            <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center" style={{ borderRadius: 14, background: "linear-gradient(145deg, var(--accHi), var(--accMid))", boxShadow: "0 8px 20px rgba(var(--accShadowRGB),0.5)" }}>
              <Icon name="shopping_bag" style={{ fontSize: 21, color: "var(--onAcc)" }} />
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold" style={{ background: "var(--brand2)", color: "var(--bg)", border: "2px solid rgba(var(--surfaceRGB),1)" }}>{cartCount}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide" style={muted(0.55)}>
                <span>{cartCount} {cartCount === 1 ? t("item") : t("items")}</span>
                {savedAt ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5" style={{ background: "rgba(var(--okRGB),0.16)", color: "var(--ok)" }}>
                    <Icon name="check" style={{ fontSize: 12 }} />{t("saved")}
                  </span>
                ) : null}
              </div>
              <div className="rf-num text-[23px] leading-tight" style={{ color: "var(--ink)" }}>{money(cartTotal)}</div>
            </div>
            <button onClick={() => setConfirming(true)} disabled={busy || cartItems().length === 0} className="rf-press flex flex-shrink-0 items-center gap-1.5 px-4 py-3 text-[13px] font-bold disabled:opacity-50" style={PRIMARY_BTN}>
              <Icon name="bookmark_added" style={{ fontSize: 17 }} />{t("savePicks")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Pre-order confirmation. Deliberately a blocking step and not a toast:
          confirming here is the guest agreeing that these items become a real
          order the moment they sit down, so it has to be read, not glimpsed. */}
      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(var(--bgRGB),0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", animation: "rfFadeIn .2s ease both" }}
          onClick={() => { setConfirming(false); }}
        >
          <div
            className="rf-rise w-full max-w-sm px-6 pb-6 pt-7"
            style={{ ...PANEL, background: "rgba(var(--surfaceRGB),0.92)" }}
            onClick={(e) => { e.stopPropagation(); }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: "rgba(var(--accRGB),0.16)" }}>
                <Icon name="bookmark_added" style={{ fontSize: 19, color: "var(--accHi)" }} />
              </span>
              <h2 className="rf-serif text-[21px] leading-tight" style={{ color: "var(--ink)" }}>{t("confirmTitle")}</h2>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed" style={muted()}>{t("confirmBody")}</p>

            {/* What they are agreeing to, itemised — a total alone is not consent. */}
            <div className="mt-4 max-h-52 overflow-y-auto rounded-xl" style={{ background: "rgba(var(--bgRGB),0.5)" }}>
              {cartItems().map((it) => (
                <div key={it.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-[13px]">
                  <span style={{ color: "var(--accHi)" }} className="rf-num flex-shrink-0">{it.quantity}&times;</span>
                  <span className="flex-1 truncate" style={{ color: "var(--ink)" }}>{it.name}</span>
                  <span className="rf-num flex-shrink-0" style={muted()}>{money(it.price * it.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-baseline justify-between px-1">
              <span className="text-[12px] font-bold uppercase tracking-wide" style={muted()}>
                {cartCount} {cartCount === 1 ? t("item") : t("items")}
              </span>
              <span className="rf-num text-[19px]" style={{ color: "var(--ink)" }}>{money(cartTotal)}</span>
            </div>

            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => { setConfirming(false); }}
                className="rf-press flex-1 rounded-full py-3 text-[13px] font-bold"
                style={{ background: "rgba(var(--inkRGB),0.10)", color: "var(--ink)" }}
              >
                {t("confirmNo")}
              </button>
              <button
                onClick={savePreorder}
                disabled={busy}
                className="rf-press flex-1 rounded-full py-3 text-[13px] font-bold disabled:opacity-50"
                style={PRIMARY_BTN}
              >
                {t("confirmYes")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* "Table ready" pop-up */}
      {showCalled ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(var(--bgRGB),0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", animation: "rfFadeIn .2s ease both" }}
          onClick={() => { setShowCalled(false); }}
        >
          <div className="rf-rise w-full max-w-sm px-6 pb-6 pt-8 text-center" style={{ ...PANEL, background: "rgba(var(--surfaceRGB),0.92)" }} onClick={(e) => { e.stopPropagation(); }}>
            <div className="relative mx-auto flex h-[92px] w-[92px] items-center justify-center">
              <span className="absolute inset-0 rounded-full" style={{ background: "rgba(var(--accRGB),0.4)", animation: "rfHalo 2s ease-out infinite" }} />
              <span className="relative flex h-[92px] w-[92px] items-center justify-center rounded-full" style={{ background: "linear-gradient(150deg, var(--accHi), var(--accDeep))", boxShadow: "0 16px 36px rgba(var(--accShadowRGB),0.55)" }}>
                <Icon name="notifications_active" style={{ fontSize: 42, color: "var(--onAcc)", animation: "rfBellSwing 2.6s ease-in-out infinite", transformOrigin: "50% 20%" }} />
              </span>
            </div>
            <h2 className="rf-serif mt-5 text-[28px] leading-tight" style={{ color: "var(--accHi)" }}>{t("tableReady")}</h2>
            <p className="mx-auto mt-2 max-w-[17rem] text-[13px] leading-snug" style={muted(0.62)}>
              {entry?.pre_order.length ? t("popupBodySaved") : t("popupBody")}
            </p>
            <button onClick={() => { setShowCalled(false); }} className="rf-press mt-6 w-full py-3.5 text-[14px] font-bold" style={PRIMARY_BTN}>{t("gotIt")}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Designed loading state — the same shell (page colour, orbs, panel material) as
// the real page, with shimmering placeholders instead of a bare "Loading…".
function QueueSkeleton({ vars, font, label }: { vars: CSSProperties; font: string; label: string }) {
  return (
    <div className="relative mx-auto min-h-dvh max-w-md overflow-x-hidden" style={{ ...vars, backgroundColor: "var(--bg)", color: "var(--ink)", fontFamily: font }}>
      <style>{GUEST_CSS}{GUEST_FX_CSS}</style>
      <div className="pointer-events-none fixed inset-0 z-0" style={{ backgroundColor: "var(--bg)" }} />
      <div className="pointer-events-none fixed z-0" style={{ top: -130, left: -90, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.22), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="relative z-10">
        <div className="relative overflow-hidden" style={{ height: 186 }}>
          <div className="absolute inset-0" style={{ background: "var(--heroWash)", opacity: 0.85 }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(var(--bgRGB),0.2), rgba(var(--bgRGB),0.97))" }} />
          <div className="absolute bottom-4 left-5 right-5">
            <div className="rf-skel h-3 w-28" />
            <div className="rf-skel mt-2.5 h-7 w-52" />
          </div>
        </div>
        <div className="px-4 pt-4">
          <div className="px-5 pb-6 pt-6" style={PANEL}>
            <div className="flex items-center gap-3">
              <div className="rf-skel h-11 w-11" style={{ borderRadius: 14 }} />
              <div className="flex-1">
                <div className="rf-skel h-5 w-40" />
                <div className="rf-skel mt-2 h-3 w-52" />
              </div>
            </div>
            <div className="rf-skel mt-6 h-12 w-full" />
            <div className="rf-skel mt-3.5 h-12 w-full" />
            <div className="rf-skel mt-3.5 h-14 w-full" />
            <div className="rf-skel mt-5 h-12 w-full" />
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 text-[12.5px]" style={{ color: "rgba(var(--inkRGB),0.5)" }}>
            <span className="ms" style={{ fontSize: 16, animation: "rfSpin 1s linear infinite" }}>progress_activity</span>
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function QueuePage() {
  const fallbackVars = { ...guestThemeVars(resolveGuestTheme(resolveGuestPalette(null).primary, null)), ...paletteVars(resolveGuestPalette(null)) };
  return (
    <Suspense fallback={<QueueSkeleton vars={fallbackVars} font="Roboto, system-ui, sans-serif" label={STRINGS.en.loading} />}>
      <QueueInner />
    </Suspense>
  );
}
