"use client";

// Public customer feedback form (the valet step is the first screen of this same
// flow) — behaviour ported verbatim from the standalone Restaurant_Feedback_UI
// Vite app (src/App.tsx). Same URL params (rid/eid/oid + restaurantId/employeeId/
// outletId), same localStorage keys, same valet gate → categories → NPS → submit
// flow. Only the PRESENTATION changed: it now renders in the same premium-dark
// design language as the guest ordering page and derives every colour from the
// same brand ramp (see @/lib/guest-theme), so the three customer-facing surfaces
// look like one product and react to brand_config identically.
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fontStack, loadBrandFont, loadDesignFonts } from "@/lib/brand-fonts";
import {
  DEFAULT_ACCENT,
  GUEST_CSS,
  type GuestBrandConfig,
  type GuestPalette,
  guestThemeVars,
  paletteVars,
  resolveGuestPalette,
  shellTones,
  pickHex,
  resolveGuestTheme,
} from "@/lib/guest-theme";
import {
  type CategoryQuestion,
  type FeedbackFormConfig,
  type ThemeTokens,
  fetchBranding,
  fetchDynamicFollowUpPrompt,
  fetchFollowUpQuestion,
  fetchMainQuestion,
  submitFeedback,
  verifyValetAndAdvanceStage,
} from "./api";
import { feedbackFormCategories } from "@/lib/feedback-form";
import styles from "./feedback.module.css";

// Material Symbols glyph (the .ms class comes from GUEST_CSS; renders as nothing
// until the icon font has loaded).
function Icon({ name, size, filled, style }: { name: string; size?: number; filled?: boolean; style?: CSSProperties }) {
  return (
    <span
      className="ms"
      aria-hidden="true"
      style={{ fontSize: size ?? 18, ...(filled ? { fontVariationSettings: "'FILL' 1" } : null), ...style }}
    >
      {name}
    </span>
  );
}

type RatingMap = Record<number, number>;
type QuestionMap = Record<number, { mainQuestion: string; followUpQuestion: string | null }>;
type FollowUpAnswerMap = Record<number, string>;
type FollowUpSuggestionMap = Record<number, string>;
type FollowUpCommittedMap = Record<number, boolean>;
type FollowUpErrorMap = Record<number, string>;
type FollowUpSuggestionCommittedMap = Record<number, boolean>;
type FollowUpSuggestionErrorMap = Record<number, string>;
type FollowUpDynamicPromptMap = Record<number, string>;
type FollowUpDynamicPromptLoadingMap = Record<number, boolean>;
interface SubmissionSummary {
  submittedAt: string;
  customerName: string | null;
  ratedCount: number;
  averageScore: number;
}

const DEFAULT_CATEGORIES: CategoryQuestion[] = [
  { id: 1, key: "initial_greeting", label: "Initial Greeting" },
  { id: 2, key: "waiter_serving", label: "Waiter Service" },
  { id: 3, key: "food", label: "Food Quality" },
  { id: 4, key: "ambience", label: "Ambience" },
  { id: 5, key: "restroom", label: "Restroom" },
  { id: 6, key: "valet_parking", label: "Valet Parking" },
];

const DEFAULT_CONFIG: FeedbackFormConfig = {
  title: "Restaurant Feedback",
  subtitle: "We'd love to hear about your visit.",
  valet_enabled: false,
  require_image: false,
  review_url: "",
  categories: DEFAULT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
};

// The near-black shell + the same DEFAULT accent (#ea580c) the customer order page
// uses, so an unbranded restaurant looks identical across both. These tokens are
// ALSO what gets recorded with the submission (`image_theme`), so they track the
// resolved ramp rather than the old light palette.
const fallbackTheme: ThemeTokens = {
  background: "#08080A",
  surface: "#16161A",
  text: "#ECEAE6",
  accent: DEFAULT_ACCENT,
  mutedText: "#9A978F",
  ring: DEFAULT_ACCENT,
};

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Resolve a link identity value: URL param (long alias first, then short) falls
// back to the value the last valid link stored on this device. Runs client-side
// only (called from an effect), matching the old SPA's window/localStorage reads.
function resolveIdentity(
  query: URLSearchParams,
  longKey: string,
  shortKey: string,
  storageKey: string,
): string {
  const fromQuery = (query.get(longKey) ?? query.get(shortKey) ?? "").trim();
  if (fromQuery.length > 0) {
    return fromQuery;
  }

  try {
    const fromStorage = (localStorage.getItem(storageKey) ?? "").trim();
    if (fromStorage.length > 0) {
      return fromStorage;
    }
  } catch {
    // Storage unavailable (privacy mode) — behave like a fresh visitor.
  }

  // No tenant in the link/storage → return empty. NEVER fall back to a hardcoded
  // real restaurant (that would cross-contaminate a live tenant's feedback); the
  // page renders an "invalid link" state and refuses to submit when rid is empty.
  return "";
}

function buildFallbackSecondPrompt(reason: string): string {
  const normalized = reason.toLowerCase();

  if (normalized.includes("slow") || normalized.includes("wait") || normalized.includes("delay")) {
    return "Thanks for sharing. If the timing was better, what one change would have helped most?";
  }
  if (normalized.includes("rude") || normalized.includes("staff") || normalized.includes("service")) {
    return "Understood. What one service improvement would make this feel much better next time?";
  }
  if (normalized.includes("food") || normalized.includes("taste") || normalized.includes("cold") || normalized.includes("quality")) {
    return "Got it. What one change in food quality or taste would improve your experience most?";
  }
  if (normalized.includes("clean") || normalized.includes("dirty") || normalized.includes("restroom")) {
    return "Thanks, that helps. What one cleanliness fix should we prioritize first?";
  }
  if (normalized.includes("noise") || normalized.includes("loud") || normalized.includes("ambience")) {
    return "Noted. What one ambience change would make this experience better for you?";
  }

  return "Thanks for sharing that. What one small change would have improved this for you?";
}

// Near-black page shell with the two floating accent orbs behind everything —
// the same base every guest surface sits on.
function Shell({ themeVars, children }: { themeVars: CSSProperties; children: ReactNode }) {
  return (
    <div className={styles.pageShell} style={themeVars}>
      <style>{GUEST_CSS}</style>
      <div className={`${styles.orb} ${styles.orbTop}`} />
      <div className={`${styles.orb} ${styles.orbBottom}`} />
      {children}
    </div>
  );
}

// The branded hero: accent wash (gradient or flat, per header_style) under a dark
// scrim, with the restaurant's logo/name and the form's title.
function Hero({ logo, name, title, subtitle }: { logo?: string | null; name?: string; title: string; subtitle?: string }) {
  return (
    <section className={styles.introCard}>
      <div className={styles.heroWash} />
      <div className={styles.heroScrim} />
      <div className={styles.heroGlow} />
      <div className={styles.heroInner}>
        {logo ? <img className={styles.brandLogo} src={logo} alt="" /> : null}
        {name ? <p className={styles.eyebrow}>{name}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className={styles.introSub}>{subtitle}</p> : null}
      </div>
    </section>
  );
}

// 1–5 stars, Material Symbols (filled + accent when selected) — same icon family
// as the ordering page. Behaviour unchanged: tapping a star sets that rating.
function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.starGroup} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = value >= star;
        return (
          <button
            type="button"
            key={star}
            className={`${styles.star} ${active ? styles.starOn : ""}`}
            onClick={() => { onChange(star); }}
            aria-label={`Rate ${star} out of 5`}
            aria-pressed={active}
          >
            <Icon name="star" filled={active} />
          </button>
        );
      })}
    </div>
  );
}

function FeedbackForm({
  restaurantId,
  employeeId,
  outletId,
}: {
  restaurantId: string;
  employeeId: string;
  outletId: string;
}) {
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  // The tenant's customer-page branding (accent, body font, hero wash, control
  // shape, panel material). Null until branding resolves — every use falls back to
  // the shipped defaults, so an untouched tenant looks exactly like the order page.
  const [brandConfig, setBrandConfig] = useState<GuestBrandConfig | null>(null);
  // The server-resolved brand_palette (preset scheme + explicit roles, WCAG
  // clamp applied). Defaults to the shipped dark shell until branding lands.
  const [palette, setPalette] = useState<GuestPalette>(() => resolveGuestPalette(null));
  const [theme, setTheme] = useState<ThemeTokens>(fallbackTheme);
  // Until the owner's settings land, the defaults — with valet parking off, the
  // backend default, so a guest never briefly sees a valet question a restaurant
  // without valet does not ask.
  const [categories, setCategories] = useState<CategoryQuestion[]>(() =>
    feedbackFormCategories(DEFAULT_CATEGORIES, DEFAULT_CONFIG.valet_enabled),
  );
  const [config, setConfig] = useState<FeedbackFormConfig | null>(null);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string>("");
  const [numberPlate, setNumberPlate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [visitDate] = useState(() => getTodayDateString());
  const [comments, setComments] = useState("");
  const [nps, setNps] = useState<number | null>(null);
  const [ratings, setRatings] = useState<RatingMap>({});
  const [questions, setQuestions] = useState<QuestionMap>({});
  const [followUpAnswers, setFollowUpAnswers] = useState<FollowUpAnswerMap>({});
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestionMap>({});
  const [followUpCommitted, setFollowUpCommitted] = useState<FollowUpCommittedMap>({});
  const [followUpErrors, setFollowUpErrors] = useState<FollowUpErrorMap>({});
  const [followUpSuggestionCommitted, setFollowUpSuggestionCommitted] =
    useState<FollowUpSuggestionCommittedMap>({});
  const [followUpSuggestionErrors, setFollowUpSuggestionErrors] =
    useState<FollowUpSuggestionErrorMap>({});
  const [followUpDynamicPrompt, setFollowUpDynamicPrompt] =
    useState<FollowUpDynamicPromptMap>({});
  const [followUpDynamicPromptLoading, setFollowUpDynamicPromptLoading] =
    useState<FollowUpDynamicPromptLoadingMap>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [valetGateComplete, setValetGateComplete] = useState(false);
  const [valetGateSubmitting, setValetGateSubmitting] = useState(false);
  const [valetGateMessage, setValetGateMessage] = useState("");
  const [submissionSummary, setSubmissionSummary] = useState<SubmissionSummary | null>(null);

  // The same surface theme the guest ordering page builds: the 6-stop accent ramp
  // plus the panel material / control radius / hero wash the tenant chose. Scoped
  // to this page's root element, so the dashboard's own theme vars stay intact.
  const guestTheme = useMemo(() => resolveGuestTheme(accent, brandConfig, palette), [accent, brandConfig, palette]);
  const themeVars: CSSProperties = {
    ...guestThemeVars(guestTheme),
    // Palette roles + derived shell tones: the CSS module's --fb-* tokens and
    // chrome tints read these (falling back to the shipped literals).
    ...paletteVars(palette),
    // The tenant's brand font drives body text; the Instrument Serif display face
    // and the thin Roboto numerals are design constants (set in the CSS module).
    fontFamily: brandConfig?.font ? fontStack(brandConfig.font) : "Roboto, system-ui, sans-serif",
  };

  // The frosted-glass blur is applied INLINE rather than in the CSS module: Next's
  // CSS minifier drops `backdrop-filter: blur(var(--blur))` (a var() inside the
  // filter function), which would silently kill the glass material — and with it
  // the difference between the frosted / solid / tinted surface styles.
  const panelGlass: CSSProperties = {
    backdropFilter: `blur(${guestTheme.blur})`,
    WebkitBackdropFilter: `blur(${guestTheme.blur})`,
  };

  // Load the tenant's chosen Google Font, plus the design constants (Instrument
  // Serif display, Roboto numerals, Material Symbols icons).
  useEffect(() => { if (brandConfig?.font) {loadBrandFont(brandConfig.font);} }, [brandConfig?.font]);
  useEffect(() => { loadDesignFonts(); }, []);

  // Keep the recorded theme tokens in step with the resolved palette (submitted
  // as `image_theme` metadata) — for an untouched tenant these are the same dark
  // values as before; a preset scheme records its real shell.
  useEffect(() => {
    setTheme({
      background: palette.background,
      surface: palette.surface,
      text: palette.text,
      mutedText: shellTones(palette).inkMuted,
      accent: guestTheme.acc,
      ring: guestTheme.acc,
    });
  }, [guestTheme.acc, palette]);

  // Persist only NON-empty values so we never cache a fallback/blank tenant that a
  // later visitor (without ?rid=) would inherit.
  useEffect(() => {
    if (restaurantId.trim()) {localStorage.setItem("feedbackRestaurantId", restaurantId);}
  }, [restaurantId]);

  useEffect(() => {
    if (employeeId.trim()) {localStorage.setItem("feedbackEmployeeId", employeeId);}
  }, [employeeId]);

  useEffect(() => {
    if (outletId.trim()) {localStorage.setItem("feedbackOutletId", outletId);}
  }, [outletId]);

  // Load the restaurant's branding + feedback config so the form themes itself and
  // honors the owner's settings (valet gate, categories, required image, title).
  useEffect(() => {
    let active = true;
    fetchBranding(restaurantId.trim())
      .then((b) => {
        if (!active) {return;}
        const cfg = b?.feedback_config ?? DEFAULT_CONFIG;
        setConfig(cfg);
        setBrandLogo(b?.logo_url ?? null);
        setBrandName(b?.restaurant_name ?? "");
        // THE VALET SWITCH GOVERNS THE WHOLE VALET PART: the vehicle step below
        // AND the valet rating, which used to stay on the form with valet off.
        //
        // IDS ARE ASSIGNED BEFORE FILTERING, AND THAT ORDER IS LOAD-BEARING. A
        // category's id is its position in the owner's list, and it is what
        // fetchMainQuestion sends: the question service picks the question by that
        // number, and 6 is the valet question. Numbering after the filter shifted
        // every later category down one, so a category added after "Valet Parking"
        // would have been asked the valet question under its own heading. Nothing
        // on this page needs the ids to be gap-free — ratings, questions and
        // follow-ups are maps looked up by category.id.
        const configured = Array.isArray(cfg.categories) && cfg.categories.length > 0 ? cfg.categories : DEFAULT_CATEGORIES;
        setCategories(
          feedbackFormCategories(
            configured.map((c, i) => ({ id: i + 1, key: c.key, label: c.label })),
            cfg.valet_enabled === true,
          ),
        );
        // Skip the valet gate entirely when the restaurant doesn't use valet.
        if (!cfg.valet_enabled) {setValetGateComplete(true);}
        // Theme from the SAME object, with the SAME precedence, as the guest order
        // page: brand_config.color_primary → the logo-derived primary → the
        // admin-set theme_color → the shared default. brand_config also carries the
        // body font, hero wash, control shape and panel material.
        const bcfg = b?.brand_config && typeof b.brand_config === "object" ? b.brand_config : null;
        setBrandConfig(bcfg);
        const themePref = pickHex(bcfg?.color_primary, b?.theme_primary, b?.theme_color);
        if (themePref) {setAccent(themePref);}
        setPalette(resolveGuestPalette(b?.brand_palette, themePref));
      })
      .catch(() => {
        if (active) {
          setConfig(DEFAULT_CONFIG);
          setValetGateComplete(true);
        }
      });
    return () => {
      active = false;
    };
  }, [restaurantId]);


  useEffect(() => {
    let active = true;
    const loadQuestions = async () => {
      if (!restaurantId.trim()) {
        return;
      }
      setLoadingQuestions(true);
      try {
        const entries = await Promise.all(
          categories.map(async (category) => ({
            id: category.id,
            text: await fetchMainQuestion(restaurantId.trim(), category.id, outletId.trim()).catch(() => category.label),
          })),
        );

        if (!active) {
          return;
        }

        const nextQuestions: QuestionMap = {};
        for (const entry of entries) {
          nextQuestions[entry.id] = {
            mainQuestion: entry.text,
            followUpQuestion: null,
          };
        }
        setQuestions(nextQuestions);
      } catch (error) {
        const err = error as Error;
        setMessage(err.message || "Unable to load feedback questions");
      } finally {
        if (active) {
          setLoadingQuestions(false);
        }
      }
    };

    loadQuestions();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, categories]);

  const onRateCategory = async (categoryId: number, rating: number) => {
    setRatings((current) => ({ ...current, [categoryId]: rating }));
    setQuestions((current) => ({
      ...current,
      [categoryId]: {
        mainQuestion: current[categoryId]?.mainQuestion ?? "How was this part of your experience?",
        followUpQuestion: rating <= 3 ? current[categoryId]?.followUpQuestion ?? null : null,
      },
    }));

    if (rating > 3) {
      setFollowUpAnswers((current) => ({ ...current, [categoryId]: "" }));
      setFollowUpSuggestions((current) => ({ ...current, [categoryId]: "" }));
      setFollowUpCommitted((current) => ({ ...current, [categoryId]: false }));
      setFollowUpErrors((current) => ({ ...current, [categoryId]: "" }));
      setFollowUpSuggestionCommitted((current) => ({ ...current, [categoryId]: false }));
      setFollowUpSuggestionErrors((current) => ({ ...current, [categoryId]: "" }));
      setFollowUpDynamicPrompt((current) => ({ ...current, [categoryId]: "" }));
      setFollowUpDynamicPromptLoading((current) => ({ ...current, [categoryId]: false }));
    }

    if (rating > 3 || !restaurantId.trim()) {
      return;
    }

    try {
      const follow = await fetchFollowUpQuestion(restaurantId.trim(), categoryId, rating, outletId.trim());
      setQuestions((current) => ({
        ...current,
        [categoryId]: {
          mainQuestion: current[categoryId]?.mainQuestion ?? "How was this part of your experience?",
          followUpQuestion: follow,
        },
      }));
    } catch {
      setQuestions((current) => ({
        ...current,
        [categoryId]: {
          mainQuestion: current[categoryId]?.mainQuestion ?? "How was this part of your experience?",
          followUpQuestion: "Could you tell us what we can improve here?",
        },
      }));
    }
  };

  const onCommitLowRatingReason = async (categoryId: number) => {
    const reason = (followUpAnswers[categoryId] ?? "").trim();
    if (reason.length < 8) {
      setFollowUpCommitted((current) => ({ ...current, [categoryId]: false }));
      setFollowUpErrors((current) => ({
        ...current,
        [categoryId]: "Please share at least 8 characters so we can understand what went wrong.",
      }));
      return;
    }

    setFollowUpErrors((current) => ({ ...current, [categoryId]: "" }));
    setFollowUpCommitted((current) => ({ ...current, [categoryId]: true }));
    setFollowUpSuggestionCommitted((current) => ({ ...current, [categoryId]: false }));
    setFollowUpSuggestionErrors((current) => ({ ...current, [categoryId]: "" }));

    setFollowUpDynamicPromptLoading((current) => ({ ...current, [categoryId]: true }));
    try {
      const categoryLabel = categories.find((category) => category.id === categoryId)?.label ?? "this question";
      const prompt = await fetchDynamicFollowUpPrompt({
        restaurantId: restaurantId.trim(),
        categoryLabel,
        rating: ratings[categoryId] ?? 0,
        reason,
        mainQuestion: questions[categoryId]?.mainQuestion ?? "",
        firstFollowUpQuestion: questions[categoryId]?.followUpQuestion ?? "",
        outletId: outletId.trim(),
      });
      setFollowUpDynamicPrompt((current) => ({ ...current, [categoryId]: prompt }));
    } catch {
      setFollowUpDynamicPrompt((current) => ({
        ...current,
        [categoryId]: buildFallbackSecondPrompt(reason),
      }));
    } finally {
      setFollowUpDynamicPromptLoading((current) => ({ ...current, [categoryId]: false }));
    }
  };

  const onCommitLowRatingSuggestion = (categoryId: number) => {
    const suggestion = (followUpSuggestions[categoryId] ?? "").trim();
    if (suggestion.length < 3) {
      setFollowUpSuggestionCommitted((current) => ({ ...current, [categoryId]: false }));
      setFollowUpSuggestionErrors((current) => ({
        ...current,
        [categoryId]: "Please share a short suggestion before sending.",
      }));
      return;
    }

    setFollowUpSuggestionErrors((current) => ({ ...current, [categoryId]: "" }));
    setFollowUpSuggestionCommitted((current) => ({ ...current, [categoryId]: true }));
  };

  const onEnterWithValet = async () => {
    setValetGateMessage("");
    if (!restaurantId.trim()) {
      setValetGateMessage("Restaurant is not identified. Please reopen this feedback link.");
      return;
    }

    const normalizedPlate = numberPlate.trim().toUpperCase();
    if (!normalizedPlate) {
      setValetGateMessage("Please enter your vehicle number.");
      return;
    }

    setValetGateSubmitting(true);
    try {
      // Best-effort: if the valet system is connected, this alerts the team to
      // bring the car around. If it isn't running (or the plate isn't found), we
      // still record the vehicle number with the feedback and let the guest
      // continue — the valet step should never block the feedback flow.
      await verifyValetAndAdvanceStage({
        restaurantId: restaurantId.trim(),
        number_plate: normalizedPlate,
        outletId: outletId.trim(),
      });
    } catch {
      // Valet verification is optional; swallow and continue with the plate saved.
    } finally {
      setNumberPlate(normalizedPlate);
      setValetGateComplete(true);
      setMessage("");
      setValetGateSubmitting(false);
    }
  };

  const onContinueWithoutValet = () => {
    setValetGateMessage("");
    setNumberPlate("");
    setValetGateComplete(true);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");

    if (!restaurantId.trim()) {
      setMessage("Restaurant is not identified. Please reopen this feedback link.");
      return;
    }

    if (!visitDate.trim()) {
      setMessage("Visit date is missing. Please refresh and try again.");
      return;
    }

    if (loadingQuestions) {
      setMessage("Please wait for questions to finish loading.");
      return;
    }

    const missingRatings = categories.some((category) => !(ratings[category.id] && ratings[category.id] > 0));
    if (missingRatings) {
      setMessage("Please rate all categories before submitting.");
      return;
    }

    const ratingPayload = categories
      .map((category) => ({
        key: category.key,
        label: category.label,
        rating: ratings[category.id] ?? 0,
        question: questions[category.id]?.mainQuestion ?? "How was your experience?",
        follow_up: questions[category.id]?.followUpQuestion ?? null,
        follow_up_answer: (() => {
          if (!(ratings[category.id] !== undefined && ratings[category.id] <= 3)) {
            return null;
          }
          const reason = (followUpAnswers[category.id] ?? "").trim();
          const suggestion = (followUpSuggestions[category.id] ?? "").trim();
          const suggestionCommitted = !!followUpSuggestionCommitted[category.id];
          if (reason.length < 8 || suggestion.length < 3 || !suggestionCommitted) {
            return null;
          }
          return suggestion ? `${reason} | suggestion:${suggestion}` : reason;
        })(),
      }))
      .filter((entry) => entry.rating > 0);

    if (ratingPayload.length !== categories.length) {
      setMessage("Please rate all categories before submitting.");
      return;
    }

    const missingLowRatingDetails = ratingPayload.some(
      (entry) => entry.rating <= 3 && (!entry.follow_up_answer || entry.follow_up_answer.length === 0),
    );
    if (missingLowRatingDetails) {
      setMessage("For each rating of 3 or below, send both chat replies (reason + suggestion).");
      return;
    }

    setSubmitting(true);
    try {
      const average = Number(
        (
          ratingPayload.reduce((sum, row) => sum + row.rating, 0) /
          Math.max(ratingPayload.length, 1)
        ).toFixed(2),
      );

      await submitFeedback({
        restaurantId: restaurantId.trim(),
        employeeId: employeeId.trim(),
        outletId: outletId.trim(),
        number_plate: numberPlate.trim() || undefined,
        customer_name: customerName,
        visit_date: visitDate,
        comments,
        source: "feedback_form",
        ...(nps !== null ? { nps } : {}),
        image_theme: {
          background: theme.background,
          surface: theme.surface,
          text: theme.text,
          accent: theme.accent,
        },
        category_ratings: ratingPayload,
      });

      setSubmissionSummary({
        submittedAt: new Date().toLocaleString(),
        customerName: customerName.trim() ? customerName.trim() : null,
        ratedCount: ratingPayload.length,
        averageScore: average,
      });
      setMessage("");
      setNumberPlate("");
      setCustomerName("");
      setComments("");
      setNps(null);
      setRatings({});
      setFollowUpAnswers({});
      setFollowUpSuggestions({});
      setFollowUpCommitted({});
      setFollowUpErrors({});
      setFollowUpSuggestionCommitted({});
      setFollowUpSuggestionErrors({});
      setFollowUpDynamicPrompt({});
      setFollowUpDynamicPromptLoading({});
      // Back to the start of the form — which starts at the vehicle step ONLY
      // when the restaurant uses valet. This reset used to reopen the valet step
      // for the next guest on the same device even with valet switched off.
      setValetGateComplete(config?.valet_enabled !== true);
      setValetGateMessage("");
      setQuestions((current) => {
        const cloned: QuestionMap = {};
        for (const category of categories) {
          cloned[category.id] = {
            mainQuestion: current[category.id]?.mainQuestion ?? "How was your experience?",
            followUpQuestion: null,
          };
        }
        return cloned;
      });
    } catch (error) {
      const err = error as Error;
      setMessage(err.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // No tenant resolved from the link → this isn't a valid feedback QR. Refuse to
  // render the form (and never submit) rather than write into some other tenant.
  if (!restaurantId.trim()) {
    return (
      <Shell themeVars={themeVars}>
        <main className={styles.feedbackWrap}>
          <Hero
            title="Invalid feedback link"
            subtitle="This link is missing its restaurant details. Please scan the QR code on your bill again."
          />
        </main>
      </Shell>
    );
  }

  return (
    <Shell themeVars={themeVars}>
      <main className={styles.feedbackWrap}>
        <Hero
          logo={brandLogo}
          name={brandName}
          title={config?.title ?? "How was your visit?"}
          subtitle={config?.subtitle ?? "We'd love to hear about your experience — it only takes a moment."}
        />

        {!config ? (
          <section className={styles.feedbackCard} style={panelGlass} role="status" aria-live="polite">
            <p className={styles.message}>Loading…</p>
          </section>
        ) : submissionSummary ? (
          <section className={`${styles.feedbackCard} ${styles.submissionScreen}`} style={panelGlass} role="status" aria-live="polite">
            <div className={styles.successIcon} aria-hidden="true">
              <Icon name="check" size={40} />
            </div>
            <h2>Feedback Submitted</h2>
            <p className={styles.submissionText}>
              Thank you{submissionSummary.customerName ? `, ${submissionSummary.customerName}` : ""}. Your response has been recorded.
            </p>
            {/* The guest's own average, in the design's thin numeral face. */}
            <div className={styles.scoreRow}>
              <span className={styles.scoreNum}>{submissionSummary.averageScore.toFixed(1)}</span>
              <span className={styles.scoreOf}>/ 5</span>
            </div>
            {submissionSummary.averageScore >= 4 && config?.review_url ? (
              <a
                className={`${styles.anotherFeedbackBtn} ${styles.reviewBtn}`}
                href={config.review_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginBottom: 4 }}
              >
                <Icon name="star" filled size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Loved it? Leave us a review
              </a>
            ) : submissionSummary.averageScore <= 3 ? (
              <p className={styles.submissionText}>
                We&apos;re sorry it wasn&apos;t perfect — the team has been notified and will personally make it right.
              </p>
            ) : null}
            <button
              type="button"
              className={styles.anotherFeedbackBtn}
              onClick={() => {
                setSubmissionSummary(null);
                setMessage("");
              }}
            >
              Send Another Feedback
            </button>
          </section>
        ) : !valetGateComplete ? (
          /* VALET STEP — first screen of the flow when the restaurant uses valet. */
          <section className={styles.feedbackCard} style={panelGlass}>
            <p className={styles.sectionLabel}>
              <Icon name="directions_car" size={14} />
              Valet parking
            </p>
            <h2 className={styles.panelTitle}>Shall we bring your car around?</h2>
            <p className={styles.panelNote}>
              Enter your vehicle number and our team will have it ready as you leave.
            </p>

            <div className={styles.headerGrid}>
              <label className={styles.field}>
                Vehicle Number (if you used valet)
                <input
                  className={styles.plateInput}
                  value={numberPlate}
                  onChange={(e) => { setNumberPlate(e.target.value.toUpperCase()); }}
                  placeholder="KA01AB1234"
                />
              </label>
            </div>

            <div className={styles.footerRow}>
              <button type="button" disabled={valetGateSubmitting} onClick={onEnterWithValet}>
                {valetGateSubmitting ? "Checking..." : "Submit Vehicle Number"}
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={valetGateSubmitting}
                onClick={onContinueWithoutValet}
              >
                Continue Without Valet
              </button>
            </div>

            {valetGateMessage ? <p className={`${styles.message} ${styles.messageWarn}`}>{valetGateMessage}</p> : null}
          </section>
        ) : (
          <form className={styles.feedbackCard} style={panelGlass} onSubmit={onSubmit}>
            <div className={styles.headerGrid}>
              <label className={styles.field}>
                Your Name (optional)
                <input value={customerName} onChange={(e) => { setCustomerName(e.target.value); }} />
              </label>
            </div>

            {numberPlate.trim() ? (
              <p className={styles.statusPill}>
                <Icon name="directions_car" size={14} />
                Valet vehicle verified: {numberPlate.trim()}
              </p>
            ) : (
              <p className={styles.message}>Continuing without valet.</p>
            )}

            <div className={styles.categoryGrid}>
              {categories.map((category) => (
                <section className={styles.categoryCard} key={category.id}>
                  <div className={styles.categoryHead}>
                    <h2>{category.label}</h2>
                    <StarRating
                      value={ratings[category.id] ?? 0}
                      onChange={(value) => onRateCategory(category.id, value)}
                    />
                  </div>
                  <p className={styles.question}>{questions[category.id]?.mainQuestion ?? "Loading question..."}</p>
                  {ratings[category.id] !== undefined && ratings[category.id] <= 3 ? (
                    <div className={styles.followUpWrap}>
                      <p className={styles.botBubble}>{questions[category.id]?.followUpQuestion ?? "Loading follow-up..."}</p>
                      <div className={styles.followUpEntryRow}>
                        <input
                          className={styles.followUpReply}
                          maxLength={120}
                          placeholder="Tell us briefly what went wrong"
                          value={followUpAnswers[category.id] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setFollowUpAnswers((current) => ({
                              ...current,
                              [category.id]: value,
                            }));
                            setFollowUpCommitted((current) => ({
                              ...current,
                              [category.id]: false,
                            }));
                            setFollowUpSuggestionCommitted((current) => ({
                              ...current,
                              [category.id]: false,
                            }));
                            setFollowUpDynamicPrompt((current) => ({
                              ...current,
                              [category.id]: "",
                            }));
                            setFollowUpDynamicPromptLoading((current) => ({
                              ...current,
                              [category.id]: false,
                            }));
                            if ((followUpErrors[category.id] ?? "").length > 0) {
                              setFollowUpErrors((current) => ({
                                ...current,
                                [category.id]: "",
                              }));
                            }
                            if ((followUpSuggestionErrors[category.id] ?? "").length > 0) {
                              setFollowUpSuggestionErrors((current) => ({
                                ...current,
                                [category.id]: "",
                              }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              onCommitLowRatingReason(category.id);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className={styles.followUpSend}
                          onClick={() => onCommitLowRatingReason(category.id)}
                        >
                          Send
                        </button>
                      </div>
                      {(followUpErrors[category.id] ?? "").length > 0 ? (
                        <p className={styles.followUpError}>{followUpErrors[category.id]}</p>
                      ) : null}
                      {followUpCommitted[category.id] ? (
                        <>
                          <p className={styles.botBubble}>
                            {followUpDynamicPromptLoading[category.id]
                              ? "Thanks, give me a second to tailor a follow-up..."
                              : followUpDynamicPrompt[category.id] || buildFallbackSecondPrompt(followUpAnswers[category.id] ?? "")}
                          </p>
                          <input
                            className={styles.followUpReply}
                            maxLength={120}
                            placeholder="One small change that would improve this"
                            disabled={!!followUpDynamicPromptLoading[category.id]}
                            value={followUpSuggestions[category.id] ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFollowUpSuggestions((current) => ({
                                ...current,
                                [category.id]: value,
                              }));
                              setFollowUpSuggestionCommitted((current) => ({
                                ...current,
                                [category.id]: false,
                              }));
                              if ((followUpSuggestionErrors[category.id] ?? "").length > 0) {
                                setFollowUpSuggestionErrors((current) => ({
                                  ...current,
                                  [category.id]: "",
                                }));
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                onCommitLowRatingSuggestion(category.id);
                              }
                            }}
                          />
                          <button
                            type="button"
                            className={styles.followUpSend}
                            disabled={!!followUpDynamicPromptLoading[category.id]}
                            onClick={() => { onCommitLowRatingSuggestion(category.id); }}
                          >
                            Send
                          </button>
                          {(followUpSuggestionErrors[category.id] ?? "").length > 0 ? (
                            <p className={styles.followUpError}>{followUpSuggestionErrors[category.id]}</p>
                          ) : null}
                          {followUpSuggestionCommitted[category.id] ? (
                            <p className={styles.botBubble}>Thanks, your feedback has been noted.</p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>

            {/* NPS 0–10 — a 6-column grid so all eleven chips fit a 375px screen
                without any horizontal scroll. Tapping the selected score clears it,
                exactly as before. */}
            <div className={styles.field}>
              How likely are you to recommend us? (0–10)
              <div className={styles.npsGrid}>
                {Array.from({ length: 11 }, (_, score) => (
                  <button
                    key={score}
                    type="button"
                    aria-pressed={nps === score}
                    className={`${styles.npsBtn} ${nps === score ? styles.npsBtnOn : ""}`}
                    onClick={() => { setNps((current) => (current === score ? null : score)); }}
                  >
                    {score}
                  </button>
                ))}
              </div>
              <p className={styles.npsScale}>
                <span>Not likely</span>
                <span>Very likely</span>
              </p>
            </div>

            <label className={styles.field}>
              Anything else you want to tell us?
              <textarea
                rows={4}
                value={comments}
                onChange={(e) => { setComments(e.target.value); }}
                placeholder="Share details about your meal, staff interaction, or atmosphere."
              />
            </label>

            <button className={styles.submitBtn} disabled={submitting || loadingQuestions} type="submit">
              {submitting ? "Submitting…" : "Submit feedback"}
            </button>

            {message ? <p className={`${styles.message} ${styles.messageWarn}`}>{message}</p> : null}
          </form>
        )}
      </main>
    </Shell>
  );
}

// Resolves the link identity (URL params → localStorage) on the client, exactly
// like the old SPA did at startup, then renders the form with fixed identities.
function FeedbackGate() {
  const search = useSearchParams();
  const [identity, setIdentity] = useState<{ rid: string; eid: string; oid: string } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(search?.toString() ?? "");
    setIdentity({
      rid: resolveIdentity(query, "restaurantId", "rid", "feedbackRestaurantId"),
      eid: resolveIdentity(query, "employeeId", "eid", "feedbackEmployeeId"),
      oid: resolveIdentity(query, "outletId", "oid", "feedbackOutletId"),
    });
  }, [search]);

  if (!identity) {
    return <div className={styles.pageShell} />;
  }

  return <FeedbackForm restaurantId={identity.rid} employeeId={identity.eid} outletId={identity.oid} />;
}

export default function FeedbackPage() {
  // useSearchParams requires a Suspense boundary (same pattern as the queue page).
  return (
    <Suspense fallback={<div className={styles.pageShell} />}>
      <FeedbackGate />
    </Suspense>
  );
}
