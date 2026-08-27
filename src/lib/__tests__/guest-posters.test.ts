// The guest pages' half of the poster contract: parsing the `posters` key of
// /qr/:slug/menu.
//
// The point of this suite is the ABSENT case. Every restaurant on the platform
// has no posters, so the payload they get has no `posters` key at all — and the
// two guest pages must render exactly as they did before this feature existed.
// A parser that threw, or that produced one bad entry, on a missing or partial
// key would break the QR ordering page for real diners mid-service.
//
// It also pins what is deliberately NOT here: no date filtering. The schedule is
// resolved on the server against the RESTAURANT's timezone; a second copy on the
// client would be a second answer, and the day the two disagree is the day an
// expired poster is on a diner's phone.

import {
    POSTER_FALLBACK_RATIO,
    posterAspectRatio,
    postersForSlot,
    readGuestPosters,
} from "../guest-posters";

const poster = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    image_url: "https://cdn.example.test/p1.webp",
    title: "Sunday Brunch",
    placement: "menu",
    width: 1200,
    height: 675,
    ...over,
});

describe("readGuestPosters — the absent case is the normal case", () => {
    it("returns nothing for a payload with no posters key", () => {
        expect(readGuestPosters(undefined)).toEqual([]);
        expect(readGuestPosters(null)).toEqual([]);
    });

    it("returns nothing for shapes that are not a list of posters", () => {
        // A server that answered with something unexpected must not be able to
        // take the menu page down.
        expect(readGuestPosters({})).toEqual([]);
        expect(readGuestPosters("posters")).toEqual([]);
        expect(readGuestPosters(42)).toEqual([]);
        expect(readGuestPosters([null, undefined, 7, "x", []])).toEqual([]);
    });

    it("drops entries that could only render as a broken image", () => {
        // An <img> with an empty src is a broken-image icon on a customer's
        // phone — strictly worse than showing nothing.
        expect(readGuestPosters([poster({ image_url: "" })])).toEqual([]);
        expect(readGuestPosters([poster({ id: "" })])).toEqual([]);
        expect(readGuestPosters([poster({ image_url: 42 })])).toEqual([]);
        // …while a good entry alongside a bad one still arrives.
        expect(readGuestPosters([poster({ id: "" }), poster({ id: "ok" })]).map((p) => p.id)).toEqual(["ok"]);
    });
});

describe("readGuestPosters — normalisation", () => {
    it("keeps a well-formed poster intact", () => {
        expect(readGuestPosters([poster()])).toEqual([{
            id: "p1",
            image_url: "https://cdn.example.test/p1.webp",
            title: "Sunday Brunch",
            placement: "menu",
            width: 1200,
            height: 675,
        }]);
    });

    it("treats a missing caption as an empty one, not as missing data", () => {
        // "" is a real value here: it means the owner gave no caption, and the
        // renderer turns it into alt="" so a screen reader skips the image
        // rather than reading out a URL.
        expect(readGuestPosters([poster({ title: undefined })])[0].title).toBe("");
        expect(readGuestPosters([poster({ title: 12 })])[0].title).toBe("");
    });

    it("falls back to the menu slot for an unknown placement", () => {
        // A newer server that adds a third slot should still get its poster
        // shown somewhere sensible instead of having it vanish.
        expect(readGuestPosters([poster({ placement: "sidebar" })])[0].placement).toBe("menu");
        expect(readGuestPosters([poster({ placement: undefined })])[0].placement).toBe("menu");
        expect(readGuestPosters([poster({ placement: "top" })])[0].placement).toBe("top");
    });

    it("normalises unusable dimensions to 0 so the renderer uses its fallback", () => {
        expect(readGuestPosters([poster({ width: "1200", height: null })])[0]).toMatchObject({ width: 0, height: 0 });
        expect(readGuestPosters([poster({ width: -5 })])[0].width).toBe(0);
        expect(readGuestPosters([poster({ width: Number.NaN })])[0].width).toBe(0);
    });

    it("preserves the server's order and never re-sorts", () => {
        // The server sorts by the owner's (sort_order, created_at, id). Re-sorting
        // here would mean two different orders for one owner's choice.
        const ids = readGuestPosters([poster({ id: "c" }), poster({ id: "a" }), poster({ id: "b" })]).map((p) => p.id);
        expect(ids).toEqual(["c", "a", "b"]);
    });
});

describe("slots and layout", () => {
    it("splits posters by slot, keeping order within each", () => {
        const list = readGuestPosters([
            poster({ id: "t1", placement: "top" }),
            poster({ id: "m1", placement: "menu" }),
            poster({ id: "t2", placement: "top" }),
        ]);
        expect(postersForSlot(list, "top").map((p) => p.id)).toEqual(["t1", "t2"]);
        expect(postersForSlot(list, "menu").map((p) => p.id)).toEqual(["m1"]);
    });

    it("reserves the poster's real box, and a ratio (not a crop) when unmeasured", () => {
        // Reserving the box is what stops a poster loading over a phone
        // connection from shoving the menu down the page under the guest's thumb.
        expect(posterAspectRatio({ width: 1200, height: 400 })).toBe("1200 / 400");
        expect(posterAspectRatio({ width: 0, height: 0 })).toBe(POSTER_FALLBACK_RATIO);
        expect(posterAspectRatio({ width: 1200, height: 0 })).toBe(POSTER_FALLBACK_RATIO);
    });
});
