// THE RECIPIENT LIST, AND THE TWO COPIES OF THE RULE THAT CLEANS IT.
//
// The form cleans the addresses so the owner sees exactly what will be saved;
// the server cleans them again because a form is not a gate. That is two
// implementations of one rule, which is a duplication worth having (this module
// is deliberately free of the server graph) and worth PINNING, because the way
// it fails is silent: the form shows a list, the server stores a different one,
// and the report goes somewhere nobody chose.
//
// So the fixtures below are the same inputs used in the backend's own
// mailer suite, and the expectations are the same expectations. If either side
// drifts, one of these fails.

import { buildSchedulePatch, parseRecipients, isPlausibleEmail, type ScheduleFormState } from "../report-schedule-actions";

const form = (over: Partial<ScheduleFormState> = {}): ScheduleFormState => ({
  name: "Morning sales",
  report_key: "sales",
  frequency: "daily",
  time: "08:00",
  weekday: "1",
  day_of_month: "1",
  channel: "inbox",
  recipients: "",
  ...over,
});

describe("what can be an address", () => {
  it("accepts the shapes real people actually have", () => {
    for (const ok of ["a@b.co", "owner+gst@gaia.test", "first.last@sub.domain.example", "accounts+2026@restaurant.technology"]) {
      expect(isPlausibleEmail(ok)).toBe(true);
    }
  });

  it("refuses only what CANNOT be an address", () => {
    for (const bad of ["", "   ", "no-at-sign", "a@b", "a@@b.co", "a b@c.co", "a@.co", "a@b..co", "a@b."]) {
      expect(isPlausibleEmail(bad)).toBe(false);
    }
  });
});

describe("parseRecipients matches the server's normalizeRecipients", () => {
  it("splits on commas, semicolons and newlines", () => {
    expect(parseRecipients("a@x.test, b@x.test; c@x.test\nd@x.test"))
      .toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test"]);
  });

  it("trims, de-duplicates case-insensitively, and keeps the order typed", () => {
    expect(parseRecipients(" Owner@Gaia.test , owner@gaia.test, accounts@gaia.test "))
      .toEqual(["Owner@Gaia.test", "accounts@gaia.test"]);
  });

  it("drops rubbish entries rather than failing the whole list", () => {
    expect(parseRecipients("a@x.test, oops, , b@x.test")).toEqual(["a@x.test", "b@x.test"]);
  });

  it("caps at ten — a report of a restaurant's takings is not a mailing list", () => {
    expect(parseRecipients(Array.from({ length: 25 }, (_v, i) => `p${i}@x.test`).join(",")))
      .toHaveLength(10);
  });

  it("an empty or whitespace-only field is an empty list, never a throw", () => {
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   \n  ")).toEqual([]);
  });
});

describe("an email schedule is refused before it is saved", () => {
  it("refuses with nothing typed, and says what to do instead", () => {
    const r = buildSchedulePatch(form({ channel: "email" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/in-app inbox/i);
  });

  it("says something DIFFERENT when addresses were typed but none are usable", () => {
    // "Add an address" is unhelpful and slightly insulting to somebody who has
    // clearly typed three. The useful information is that none of them parsed.
    const r = buildSchedulePatch(form({ channel: "email", recipients: "owner, accounts, me" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/missing @|typo/i);
  });

  it("accepts one good address even when it is typed beside bad ones", () => {
    const r = buildSchedulePatch(form({ channel: "email", recipients: "oops, owner@gaia.test" }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.patch.recipients).toEqual(["owner@gaia.test"]);
  });

  it("sends the CLEANED list, not the raw text", () => {
    const r = buildSchedulePatch(form({ channel: "email", recipients: " A@x.test ,a@X.test, b@x.test" }));
    expect(r.ok && r.patch.recipients).toEqual(["A@x.test", "b@x.test"]);
  });
});

describe("an inbox schedule is unaffected", () => {
  it("saves with no recipients at all, as it always could", () => {
    const r = buildSchedulePatch(form());
    expect(r.ok).toBe(true);
    expect(r.ok && r.patch.channel).toBe("inbox");
  });

  it("sends an EMPTY list even if the field still holds text from an earlier edit", () => {
    // Storing addresses against a schedule that does not email is a surprise
    // waiting for whoever switches it to email later and finds it already
    // addressed to somebody they never chose.
    const r = buildSchedulePatch(form({ channel: "inbox", recipients: "someone@old.test" }));
    expect(r.ok && r.patch.recipients).toEqual([]);
  });

  it("still refuses a nameless schedule first — the older rules survive", () => {
    const r = buildSchedulePatch(form({ name: "  ", channel: "email", recipients: "a@x.test" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/name/i);
  });
});
