// The client half of the badge contract.
//
// The server decides what a diner is told; this module decides how it looks and
// what a staff editor previews. Three things are worth pinning here because
// getting them wrong is invisible until it is on a real menu:
//
//  1. ABSENT = NOTHING. Every existing tenant has no catalogue. If any function
//     here fell back to a default set, dishes would sprout claims nobody made.
//  2. CAPPING MAY ONLY EVER DROP MARKETING. A card that trims "Contains nuts"
//     to fit a "Bestseller" is the failure this whole design exists to prevent.
//  3. A WARNING IS NOT PAINTED IN THE BRAND ACCENT. A restaurant's accent can be
//     a cheerful green, and a cheerful green nut warning reads as a feature.

import {
  BADGE_KIND_ORDER,
  badgesById,
  capBadges,
  coveredAllergens,
  guestBadgeStyle,
  isDerivedBadge,
  isProtectedBadge,
  parseBadgeCatalogue,
  resolveBadges,
  staffBadgeClass,
  type MenuBadge,
} from '../menu-badges';

const CATALOGUE: MenuBadge[] = [
  { id: 'must_try', label: 'Must Try', kind: 'promo', enabled: true },
  { id: 'bestseller', label: 'Bestseller', kind: 'promo', enabled: true },
  { id: 'jain', label: 'Jain', kind: 'diet', enabled: true },
  { id: 'spicy', label: 'Spicy', kind: 'alert', enabled: true },
  { id: 'contains_nuts', label: 'Contains nuts', kind: 'alert', enabled: true, allergen: 'nuts' },
  { id: 'retired', label: 'Retired', kind: 'promo', enabled: false },
];

describe('parseBadgeCatalogue', () => {
  it('returns [] for anything that is not a usable catalogue', () => {
    expect(parseBadgeCatalogue(undefined)).toEqual([]);
    expect(parseBadgeCatalogue(null)).toEqual([]);
    expect(parseBadgeCatalogue({})).toEqual([]);
    expect(parseBadgeCatalogue([null, 3, 'x', {}, { label: 'no id' }])).toEqual([]);
  });

  it('round-trips a catalogue and keeps server order', () => {
    expect(parseBadgeCatalogue(CATALOGUE)).toEqual(CATALOGUE);
  });

  it('defaults an unknown kind to promo, never into the safety lane', () => {
    expect(parseBadgeCatalogue([{ id: 'x', label: 'X', kind: 'danger' }])[0].kind).toBe('promo');
    // ...and a non-alert badge cannot claim to be allergen-derived, which would
    // wrongly suppress the plain allergen chip.
    expect(parseBadgeCatalogue([{ id: 'v', label: 'Vegan', kind: 'diet', allergen: 'dairy' }])[0].allergen).toBeUndefined();
  });

  it('falls back to the id when a label is missing, so no chip renders blank', () => {
    expect(parseBadgeCatalogue([{ id: 'must_try', label: '   ' }])[0].label).toBe('must_try');
  });
});

describe('badgesById — what the GUEST pages use', () => {
  it('maps resolved ids in the order the server sent them', () => {
    expect(badgesById(CATALOGUE, ['spicy', 'must_try']).map((b) => b.id)).toEqual(['spicy', 'must_try']);
    // The server ordered them; the client must not re-sort and disagree.
    expect(badgesById(CATALOGUE, ['must_try', 'spicy']).map((b) => b.id)).toEqual(['must_try', 'spicy']);
  });

  it('drops unknown and disabled ids, and returns [] with no catalogue', () => {
    expect(badgesById(CATALOGUE, ['ghost', 'retired', 'jain']).map((b) => b.id)).toEqual(['jain']);
    expect(badgesById([], ['jain'])).toEqual([]);
    expect(badgesById(CATALOGUE, undefined)).toEqual([]);
  });
});

describe('resolveBadges — the STAFF preview', () => {
  it('is empty when nothing is configured or nothing is tagged', () => {
    expect(resolveBadges([], ['must_try'], ['nuts'])).toEqual([]);
    expect(resolveBadges(CATALOGUE, [], [])).toEqual([]);
    expect(resolveBadges(CATALOGUE, undefined, undefined)).toEqual([]);
  });

  it('orders alert -> diet -> promo, then by catalogue position', () => {
    expect(resolveBadges(CATALOGUE, ['bestseller', 'must_try', 'jain', 'spicy'], []).map((b) => b.id))
      .toEqual(['spicy', 'jain', 'must_try', 'bestseller']);
  });

  it('derives an allergen badge from the dish, not from a tag', () => {
    expect(resolveBadges(CATALOGUE, [], ['Nuts']).map((b) => b.id)).toEqual(['contains_nuts']);
    // Tagging it by hand does nothing: there is one store of this fact and the
    // tag is not it, so a nut warning cannot be switched off from the tagger.
    expect(resolveBadges(CATALOGUE, ['contains_nuts'], [])).toEqual([]);
  });

  it('agrees with badgesById for a dish whose tags are already resolved', () => {
    // The staff preview and the guest render must not diverge, or the owner is
    // editing a menu they cannot see.
    const staffView = resolveBadges(CATALOGUE, ['must_try', 'jain'], ['nuts']).map((b) => b.id);
    expect(badgesById(CATALOGUE, staffView).map((b) => b.id)).toEqual(staffView);
    expect(staffView).toEqual(['contains_nuts', 'jain', 'must_try']);
  });
});

describe('capBadges', () => {
  const resolved = resolveBadges(CATALOGUE, ['must_try', 'bestseller', 'jain', 'spicy'], ['nuts']);

  it('never drops an alert or a dietary badge, however tight the limit', () => {
    for (const limit of [0, 1, 2, 5]) {
      const { shown } = capBadges(resolved, limit);
      expect(shown.filter((b) => b.kind === 'alert').map((b) => b.id)).toEqual(['spicy', 'contains_nuts']);
      expect(shown.filter((b) => b.kind === 'diet').map((b) => b.id)).toEqual(['jain']);
    }
  });

  it('trims marketing and counts what it trimmed', () => {
    expect(capBadges(resolved, 1).shown.map((b) => b.id)).toEqual(['spicy', 'contains_nuts', 'jain', 'must_try']);
    expect(capBadges(resolved, 1).hidden).toBe(1);
    expect(capBadges(resolved, 0).hidden).toBe(2);
    expect(capBadges(resolved, 9).hidden).toBe(0);
  });

  it('treats a nonsense limit as zero rather than as unlimited', () => {
    expect(capBadges(resolved, Number.NaN).shown.every((b) => b.kind !== 'promo')).toBe(true);
    expect(capBadges(resolved, -3).shown.every((b) => b.kind !== 'promo')).toBe(true);
  });
});

describe('coveredAllergens', () => {
  it('names the chips a derived badge already speaks for', () => {
    expect([...coveredAllergens(CATALOGUE)]).toEqual(['nuts']);
  });

  it('covers nothing when the derived badge is off, so the chip comes back', () => {
    const off = CATALOGUE.map((b) => (b.id === 'contains_nuts' ? { ...b, enabled: false } : b));
    expect([...coveredAllergens(off)]).toEqual([]);
    expect([...coveredAllergens([])]).toEqual([]);
  });
});

describe('kind classification and styling', () => {
  it('protects everything except marketing', () => {
    expect(CATALOGUE.filter(isProtectedBadge).map((b) => b.id)).toEqual(['jain', 'spicy', 'contains_nuts']);
    expect(CATALOGUE.filter(isDerivedBadge).map((b) => b.id)).toEqual(['contains_nuts']);
  });

  it('paints ONLY marketing in the brand accent', () => {
    // A brand accent can be any colour a restaurant likes, including a cheerful
    // green. A warning wearing it reads as a feature, so alerts and dietary
    // badges take the palette's warning/success roles instead.
    expect(guestBadgeStyle('promo').color).toContain('acc');
    expect(guestBadgeStyle('alert').color).not.toContain('acc');
    expect(guestBadgeStyle('diet').color).not.toContain('acc');
    expect(guestBadgeStyle('alert')).not.toEqual(guestBadgeStyle('diet'));
  });

  it('gives every kind a distinct staff style too', () => {
    const classes = BADGE_KIND_ORDER.map(staffBadgeClass);
    expect(new Set(classes).size).toBe(BADGE_KIND_ORDER.length);
  });
});
