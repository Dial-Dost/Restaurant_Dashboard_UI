// THE VALET SWITCH GOVERNS THE WHOLE VALET PART OF THE FEEDBACK FORM.
//
// "Add a toggle in the settings for the valet part of the feedback form."
//
// Before: the only valet control lived in the owner app, and it only skipped the
// vehicle-number step — the "Valet Parking" rating stayed on the form, so a
// restaurant without valet (live Gaia) still asked every guest to rate it. And
// after one guest submitted, the form reset straight back into the valet step.
//
// Pinned: the pure rule (feedback-form.ts), and — by source, because page.tsx and
// the settings card are client components jest does not render — that the form,
// the reset and the new Settings card are all wired to it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { feedbackFormCategories, isValetCategory } from "../feedback-form";

const read = (rel: string): string => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8");

const DEFAULTS = [
  { key: "initial_greeting", label: "Initial Greeting" },
  { key: "waiter_serving", label: "Waiter Service" },
  { key: "food", label: "Food Quality" },
  { key: "ambience", label: "Ambience" },
  { key: "restroom", label: "Restroom" },
  { key: "valet_parking", label: "Valet Parking" },
];

describe("which rating questions the form asks", () => {
  test("valet ON: every configured question, valet parking included", () => {
    expect(feedbackFormCategories(DEFAULTS, true)).toEqual(DEFAULTS);
  });

  test("valet OFF: the valet parking rating is gone, everything else stays in order", () => {
    expect(feedbackFormCategories(DEFAULTS, false).map((c) => c.key)).toEqual([
      "initial_greeting", "waiter_serving", "food", "ambience", "restroom",
    ]);
  });

  test("an owner-renamed valet question is still recognised (the app derives keys from labels)", () => {
    expect(isValetCategory({ key: "parking_valet", label: "Parking & Valet" })).toBe(true);
    expect(isValetCategory({ key: "parking", label: "Valet" })).toBe(true);
    expect(isValetCategory({ key: "parking", label: "Parking" })).toBe(false);
  });

  test("valet OFF never empties the form — a form with no questions cannot be submitted", () => {
    const onlyValet = [{ key: "valet_parking", label: "Valet Parking" }];
    expect(feedbackFormCategories(onlyValet, false)).toEqual(onlyValet);
  });

  test("the input list is not mutated", () => {
    const list = [...DEFAULTS];
    feedbackFormCategories(list, false);
    expect(list).toEqual(DEFAULTS);
  });
});

describe("the form, its reset and Settings are wired to the switch", () => {
  const page = read("src/app/feedback/page.tsx");
  const db = read("src/lib/db.ts");
  const settingsForm = read("src/app/dashboard/settings/settings-form.tsx");
  const card = read("src/app/dashboard/settings/feedback-valet-settings.tsx");

  test("the loaded config's categories go through the rule, numbered BEFORE the filter", () => {
    // The id is what picks each question on the server (6 is the valet one), so
    // a category after "Valet Parking" must keep its own number when valet is off.
    expect(page).toMatch(/feedbackFormCategories\(\s*configured\.map\(\(c, i\) => \(\{ id: i \+ 1, key: c\.key, label: c\.label \}\)\),\s*cfg\.valet_enabled === true,\s*\)/);
  });

  test("filtering keeps each remaining question's own number", () => {
    const numbered = [...DEFAULTS, { key: "cleanliness", label: "Cleanliness" }].map((c, i) => ({ id: i + 1, ...c }));
    const shown = feedbackFormCategories(numbered, false);
    expect(shown.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(shown.find((c) => c.key === "cleanliness")?.id).toBe(7);
  });

  test("the pre-load defaults do not flash a valet question", () => {
    expect(page).toContain("feedbackFormCategories(DEFAULT_CATEGORIES, DEFAULT_CONFIG.valet_enabled)");
  });

  test("after a submit, the next guest starts at the valet step ONLY when valet is on", () => {
    expect(page).toContain("setValetGateComplete(config?.valet_enabled !== true);");
    expect(page).not.toMatch(/setValetGateComplete\(false\);\s*setValetGateMessage\(""\);\s*setQuestions/);
  });

  test("Settings renders the valet card, editable with the permission the save needs", () => {
    expect(settingsForm).toMatch(/<FeedbackValetCard\s+restaurantId=\{user\.restaurantUsername\}\s+canEdit=\{hasPermission\(user\.actions_set, PERM_SETTINGS\)\}/);
    expect(card).toContain("setFeedbackValetEnabled(restaurantId, next)");
  });

  test("the save sends the freshly-read whole form with only valet changed — safe on an old backend too", () => {
    const at = db.indexOf("export const setFeedbackValetEnabled");
    const body = db.slice(at, db.indexOf("\n};", at));
    // Read first...
    expect(body.indexOf("method: 'GET'")).toBeGreaterThan(-1);
    expect(body.indexOf("method: 'GET'")).toBeLessThan(body.indexOf("method: 'POST'"));
    // ...and never write defaults off an unreadable read.
    expect(body).toContain("throw new Error('Unable to read the feedback form settings');");
    expect(body).toContain("body: JSON.stringify({ feedback_config: { ...form, valet_enabled: enabled } }),");
  });
});
