import {
  EMPTY_CREATE_RESTAURANT_FORM,
  archiveConfirmationMatches,
  buildCreateRestaurantBody,
  describePlatformError,
  normalizeRestaurantSlug,
  validateCreateRestaurant,
  type CreateRestaurantForm,
} from "../platform-restaurant-actions";

/// The operator console's two tenant-lifecycle controls (src/app/platform/page.tsx).
/// Neither can be reached by this suite through the component — jest here is
/// `testEnvironment: 'node'` with no DOM renderer — so the parts that must not be
/// wrong live in src/lib and are pinned here:
///
///   * the slug. It is written to "Restaurant".res_username, is UNIQUE, is baked
///     into every printed QR URL, and nothing in the platform renames it. The
///     backend rejects a supplied res_username that changes under its own
///     normalizer, so a client normalizer that drifts turns ordinary restaurant
///     names into a 400 the operator cannot do anything about.
///   * the archive confirmation gate. Archiving is reversible and deletes
///     nothing, but it signs out every staff session and cancels the
///     subscription — on the wrong row, mid-service, that is a restaurant that
///     cannot take an order or settle the bills already on its tables. This gate
///     is the only thing between a stray click and that.

const form = (over: Partial<CreateRestaurantForm> = {}): CreateRestaurantForm => ({
  ...EMPTY_CREATE_RESTAURANT_FORM,
  resName: "The Rustic Fork",
  resUsername: "therusticfork",
  ownerName: "Priya Nair",
  ownerUsername: "priya",
  ...over,
});

describe("normalizeRestaurantSlug — must match the backend's, character for character", () => {
  it("lowercases and strips everything that is not a letter or digit", () => {
    expect(normalizeRestaurantSlug("The Rustic Fork")).toBe("therusticfork");
    expect(normalizeRestaurantSlug("Joe's Pizza #2")).toBe("joespizza2");
    expect(normalizeRestaurantSlug("  Café-Böhme  ")).toBe("cafbhme");
  });

  it("is idempotent, which is what lets the field normalize on every keystroke", () => {
    const once = normalizeRestaurantSlug("Joe's Pizza #2");
    expect(normalizeRestaurantSlug(once)).toBe(once);
  });

  it("collapses two different names onto one slug — the collision this form exists to let the operator fix", () => {
    expect(normalizeRestaurantSlug("Joe's Pizza")).toBe(normalizeRestaurantSlug("Joes Pizza!!"));
  });

  it("returns empty when there is nothing to derive a slug from", () => {
    expect(normalizeRestaurantSlug("!!!")).toBe("");
    expect(normalizeRestaurantSlug("")).toBe("");
  });
});

describe("validateCreateRestaurant", () => {
  it("passes a filled-in form", () => {
    expect(validateCreateRestaurant(form())).toBeNull();
  });

  it("catches each missing required field before the round-trip", () => {
    expect(validateCreateRestaurant(form({ resName: "   " }))).toMatch(/required/);
    expect(validateCreateRestaurant(form({ ownerName: "" }))).toMatch(/required/);
    expect(validateCreateRestaurant(form({ ownerUsername: "  " }))).toMatch(/required/);
  });

  it("enforces the backend's 120-character limit rather than letting it 400", () => {
    expect(validateCreateRestaurant(form({ resName: "a".repeat(121) }))).toMatch(/120/);
    expect(validateCreateRestaurant(form({ ownerName: "b".repeat(121) }))).toMatch(/120/);
    expect(validateCreateRestaurant(form({ ownerUsername: "c".repeat(121) }))).toMatch(/120/);
    expect(validateCreateRestaurant(form({ resName: "a".repeat(120) }))).toBeNull();
  });

  it("rejects a name with no letters or digits, because no slug can come out of it", () => {
    expect(validateCreateRestaurant(form({ resName: "!!!", resUsername: "" }))).toMatch(/letter or number/);
  });

  it("accepts a name with no letters or digits once the operator types an ID themselves", () => {
    expect(validateCreateRestaurant(form({ resName: "!!!", resUsername: "shouty" }))).toBeNull();
  });
});

describe("buildCreateRestaurantBody", () => {
  it("trims, and sends the slug the operator can see", () => {
    expect(buildCreateRestaurantBody(form({ resName: "  The Rustic Fork  ", ownerUsername: " priya " }))).toEqual({
      res_name: "The Rustic Fork",
      res_username: "therusticfork",
      owner_name: "Priya Nair",
      owner_username: "priya",
    });
  });

  it("falls back to the name when the ID field was never touched", () => {
    expect(buildCreateRestaurantBody(form({ resUsername: "" })).res_username).toBe("therusticfork");
  });

  it("normalizes the slug one last time, so the backend's 400 on a changed value is unreachable", () => {
    const body = buildCreateRestaurantBody(form({ resUsername: "Rustic Fork!" }));
    expect(body.res_username).toBe("rusticfork");
    expect(normalizeRestaurantSlug(body.res_username ?? "")).toBe(body.res_username);
  });

  it("omits every optional field left blank instead of sending empty strings", () => {
    const body = buildCreateRestaurantBody(form({ planId: "  ", address: "", phone: "   ", email: "" }));
    expect(Object.keys(body).sort()).toEqual(["owner_name", "owner_username", "res_name", "res_username"]);
  });

  it("carries the plan and contact details through when they are filled in", () => {
    const body = buildCreateRestaurantBody(
      form({ planId: " plan-uuid ", address: " 12 Main St ", phone: " 9876543210 ", email: " owner@example.com " }),
    );
    expect(body).toMatchObject({
      plan_id: "plan-uuid",
      address: "12 Main St",
      phone: "9876543210",
      email: "owner@example.com",
    });
  });
});

describe("archiveConfirmationMatches — the gate on taking a restaurant offline", () => {
  it("unlocks only on the name of the row that was clicked", () => {
    expect(archiveConfirmationMatches("The Rustic Fork", "The Rustic Fork")).toBe(true);
  });

  it("stays locked for an empty box", () => {
    expect(archiveConfirmationMatches("", "The Rustic Fork")).toBe(false);
    expect(archiveConfirmationMatches("   ", "The Rustic Fork")).toBe(false);
  });

  it("stays locked for a different restaurant's name, including a prefix of this one", () => {
    expect(archiveConfirmationMatches("The Rustic Fork Two", "The Rustic Fork")).toBe(false);
    expect(archiveConfirmationMatches("The Rustic", "The Rustic Fork")).toBe(false);
    expect(archiveConfirmationMatches("Joe's Pizza", "The Rustic Fork")).toBe(false);
  });

  it("stays locked for a near-miss — one wrong character is still a wrong restaurant", () => {
    expect(archiveConfirmationMatches("The Rustic Fokr", "The Rustic Fork")).toBe(false);
  });

  it("forgives capitalisation and stray whitespace — the operator is proving they read the row, not retyping a password", () => {
    expect(archiveConfirmationMatches("  the RUSTIC   fork ", "The Rustic Fork")).toBe(true);
  });

  it("can never be satisfied when the restaurant has no name, so an untouched box unlocks nothing", () => {
    expect(archiveConfirmationMatches("", "")).toBe(false);
    expect(archiveConfirmationMatches("   ", "  ")).toBe(false);
  });
});

describe("describePlatformError — the backend's sentence, not a generic one", () => {
  it("passes a slug collision straight through, because it names the operator's next move", () => {
    const err = new Error('The slug "joespizza" is already taken. Choose a different res_username.');
    expect(describePlatformError(err, "Failed to create restaurant")).toBe(
      'The slug "joespizza" is already taken. Choose a different res_username.',
    );
  });

  it("passes the archived/activate conflict through too", () => {
    const err = new Error("This restaurant is archived. Use Restore to bring it back.");
    expect(describePlatformError(err, "Action failed")).toBe("This restaurant is archived. Use Restore to bring it back.");
  });

  it("falls back only when there is genuinely nothing to say", () => {
    expect(describePlatformError(new Error(""), "Failed to create restaurant")).toBe("Failed to create restaurant");
    expect(describePlatformError(new Error("   "), "Failed to create restaurant")).toBe("Failed to create restaurant");
    expect(describePlatformError(null, "Failed to create restaurant")).toBe("Failed to create restaurant");
    expect(describePlatformError(undefined, "Failed to create restaurant")).toBe("Failed to create restaurant");
    expect(describePlatformError({ message: 500 }, "Failed to create restaurant")).toBe("Failed to create restaurant");
  });
});
