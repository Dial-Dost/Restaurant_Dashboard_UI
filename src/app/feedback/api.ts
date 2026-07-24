// Customer feedback form API client — ported verbatim from the standalone
// Restaurant_Feedback_UI Vite app (src/api.ts) when the form was folded into
// the dashboard as the public /feedback route. Same endpoints, same payloads.
// Base URL follows the dashboard-wide pattern (see the queue page).
import { guestBackendBase } from "@/lib/guest-backend";

const BACKEND_URL = guestBackendBase();

// Theme token shape shared with the old app (themeFromImage.ts) — only the type
// was used by the form; the image-extraction code itself was never invoked.
export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  accent: string;
  mutedText: string;
  ring: string;
}

export interface CategoryQuestion {
  id: number;
  key: string;
  label: string;
}

export interface QuestionState {
  mainQuestion: string;
  followUpQuestion: string | null;
}

export async function fetchMainQuestion(restaurantId: string, category: number, outletId: string): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/get_main_feedback_question`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Restaurant-Id": restaurantId,
      "X-Outlet-Id": outletId,
    },
    body: JSON.stringify({ category, restaurantId }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to fetch feedback question");
  }
  return String(data.feedback ?? "How was your experience?");
}

export async function fetchFollowUpQuestion(
  restaurantId: string,
  category: number,
  rate: number,
  outletId: string
): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/get_follow_up_question`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Restaurant-Id": restaurantId,
      "X-Outlet-Id": outletId,
    },
    body: JSON.stringify({ category, rate, restaurantId }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to fetch follow-up question");
  }
  return String(data.feedback ?? "Can you tell us a little more?");
}

export async function fetchDynamicFollowUpPrompt(payload: {
  restaurantId: string;
  categoryLabel: string;
  rating: number;
  reason: string;
  mainQuestion: string;
  firstFollowUpQuestion: string;
  outletId: string;
}): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/feedback/dynamic-follow-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Restaurant-Id": payload.restaurantId,
      "X-Outlet-Id": payload.outletId,
    },
    body: JSON.stringify({
      restaurantId: payload.restaurantId,
      category_label: payload.categoryLabel,
      rating: payload.rating,
      reason: payload.reason,
      main_question: payload.mainQuestion,
      first_follow_up_question: payload.firstFollowUpQuestion,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to generate dynamic follow-up");
  }

  return String(data.follow_up_prompt ?? "What one small change would have improved this for you?");
}

export async function verifyValetAndAdvanceStage(payload: {
  restaurantId: string;
  number_plate: string;
  outletId: string;
}): Promise<{ action: string; current_state?: number | null }> {
  const response = await fetch(`${BACKEND_URL}/feedback/valet-checkin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Restaurant-Id": payload.restaurantId,
      "X-Outlet-Id": payload.outletId,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to verify valet vehicle number");
  }

  return {
    action: String(data?.action ?? "none"),
    current_state:
      typeof data?.current_state === "number" ? data.current_state : null,
  };
}

export interface SubmitFeedbackPayload {
  restaurantId: string;
  employeeId: string;
  outletId: string;
  number_plate?: string;
  customer_name: string;
  visit_date: string;
  comments: string;
  source: string;
  nps?: number;
  image_theme: {
    background: string;
    surface: string;
    text: string;
    accent: string;
  };
  category_ratings: {
    key: string;
    label: string;
    rating: number;
    question: string;
    follow_up: string | null;
    follow_up_answer?: string | null;
  }[];
}

export async function submitFeedback(payload: SubmitFeedbackPayload): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/feedback/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Restaurant-Id": payload.restaurantId,
      "X-Employee-Id": payload.employeeId,
      "X-Outlet-Id": payload.outletId,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to submit feedback");
  }
}

export interface FeedbackFormConfig {
  title: string;
  subtitle: string;
  valet_enabled: boolean;
  require_image: boolean;
  review_url: string;
  categories: { key: string; label: string }[];
}

export interface RestaurantBranding {
  logo_url: string | null;
  theme_color: string | null;
  theme_primary: string | null;
  theme_secondary: string | null;
  restaurant_name: string;
  feedback_config: FeedbackFormConfig;
}

// Public, no-auth: the restaurant's branding + feedback form configuration, so
// the form themes itself and honors the owner's settings (valet gate, categories…).
export async function fetchBranding(restaurantId: string): Promise<RestaurantBranding | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/qr/${encodeURIComponent(restaurantId)}/branding`, { cache: "no-store" });
    if (!res.ok) {return null;}
    return (await res.json()) as RestaurantBranding;
  } catch {
    return null;
  }
}
