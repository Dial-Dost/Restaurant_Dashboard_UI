// WHAT THE GUEST FEEDBACK FORM ASKS, GIVEN THE OWNER'S VALET SWITCH.
//
// The valet part of the feedback form is two things, and the owner's one switch
// (Settings > Feedback form > Valet parking, i.e. `feedback_config.valet_enabled`)
// governs both:
//
//   * the VEHICLE-NUMBER STEP before the ratings — page.tsx already skipped it
//     when valet is off;
//   * the "Valet Parking" RATING. It did not: it sits in the default category
//     list, so a restaurant with valet switched off still asked every guest to
//     rate a valet service it does not run — live Gaia's form did exactly that.
//
// Pure, so the rule is tested rather than trusted (page.tsx is a client
// component jest does not load).

/** The minimum shape of a rating question. */
export interface FeedbackCategoryLike {
  key: string;
  label: string;
}

/**
 * A rating question about valet parking. Matched on the key OR the label, because
 * owners rename and re-add categories in the app ("Valet", "Parking & Valet"),
 * and the app derives the key from the label they typed.
 */
export function isValetCategory(category: FeedbackCategoryLike): boolean {
  return /valet/i.test(category.key) || /valet/i.test(category.label);
}

/**
 * The rating questions the form shows.
 *
 * Valet on: every configured question. Valet off: every question that is not
 * about valet — UNLESS that would leave none, in which case the list is shown as
 * configured. A form with no questions cannot be submitted ("Please rate all
 * categories" over an empty list), and an owner whose only question is about
 * valet has told us something the switch should not silently undo.
 */
export function feedbackFormCategories<T extends FeedbackCategoryLike>(categories: readonly T[], valetEnabled: boolean): T[] {
  if (valetEnabled) {return [...categories];}
  const withoutValet = categories.filter((c) => !isValetCategory(c));
  return withoutValet.length > 0 ? withoutValet : [...categories];
}
