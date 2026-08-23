import { guestBackendBase, readGuestJson, readGuestBody, GuestRequestError, GUEST_UNREACHABLE } from "../guest-backend";

/// A guest opened /order/<restaurant> at their table while the backend was
/// unreachable. The Next rewrite in front of /backend-api answered with the
/// plain text "Internal Server Error", the page did `await res.json()` BEFORE
/// checking res.ok, and the parser's own message was rendered on the customer's
/// phone:
///   Unexpected token 'I', "Internal S"... is not valid JSON
/// These tests pin the two things that must never come back: a raw parser error
/// reaching a diner, and a non-JSON body being treated as data.

const resp = (body: string, status = 200, ok = status < 400) =>
  ({
    ok,
    status,
    text: async () => body,
  }) as unknown as Response;

/// The base-URL half of the same story. The error above ("Unexpected token 'I'")
/// was the backend being down; this is the page never reaching the backend at
/// all. A production image built with an EMPTY NEXT_PUBLIC_BACKEND_URL made this
/// function return "", because it composed the value with `??` (which does not
/// fall back on "") and then relied on `new URL(configured)` to spot a localhost
/// backend — but `new URL("")` THROWS, so the catch swallowed it and the
/// "/backend-api" escape hatch was never reached. Guest phones were sent to the
/// dashboard's own origin and got Next's 404 HTML back.
///
/// This matters more than the staff console: table QR codes point at that host.
describe("guestBackendBase", () => {
  const REAL_ENV = process.env;

  const openGuestPageOn = (hostname: string, protocol = "https:"): void => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { hostname, protocol, origin: `${protocol}//${hostname}` },
    };
  };

  beforeEach(() => {
    process.env = { ...REAL_ENV };
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    delete process.env.BACKEND_INTERNAL_URL;
  });

  afterEach(() => {
    process.env = REAL_ENV;
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("sends a scanned table QR to the proxy when the backend URL was built empty", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "";
    openGuestPageOn("experiosolutions.dialdost.com");
    // Measured against production: /qr/csrorganics/menu -> 404 HTML,
    // /backend-api/qr/csrorganics/menu -> 200 JSON.
    expect(`${guestBackendBase()}/qr/csrorganics/menu`).toBe(
      "/backend-api/qr/csrorganics/menu",
    );
  });

  it("keeps using the proxy for a phone on the LAN IP in dev", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";
    openGuestPageOn("172.20.10.2", "http:");
    expect(guestBackendBase()).toBe("/backend-api");
  });

  it("calls a real production backend directly", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com";
    openGuestPageOn("experiosolutions.dialdost.com");
    expect(guestBackendBase()).toBe("https://api.dialdost.com");
  });
});

describe("readGuestJson", () => {
  it("returns parsed JSON on success", async () => {
    const data = await readGuestJson<{ items: number[] }>(
      resp(JSON.stringify({ items: [1, 2] })),
      "fallback",
    );
    expect(data.items).toEqual([1, 2]);
  });

  it("turns the proxy's plain-text 500 into a sentence a diner can read", async () => {
    expect.assertions(4);
    try {
      await readGuestJson(resp("Internal Server Error", 500, false), "Failed to load menu");
    } catch (e) {
      const err = e as GuestRequestError;
      expect(err).toBeInstanceOf(GuestRequestError);
      expect(err.message).toBe(GUEST_UNREACHABLE);
      // The thing the guest must never see again.
      expect(err.message).not.toMatch(/Unexpected token|not valid JSON/i);
      // The raw body is kept for whoever debugs it, not for the guest.
      expect(err.detail).toContain("Internal Server Error");
    }
  });

  it("prefers the backend's own error message when it sent one", async () => {
    expect.assertions(1);
    try {
      await readGuestJson(
        resp(JSON.stringify({ error: "Invalid table code. Please re-scan the QR at your table." }), 403, false),
        "fallback",
      );
    } catch (e) {
      expect((e as Error).message).toBe("Invalid table code. Please re-scan the QR at your table.");
    }
  });

  it("uses the caller's fallback for a 4xx with no usable body", async () => {
    expect.assertions(1);
    try {
      await readGuestJson(resp("<html>404</html>", 404, false), "Failed to load menu");
    } catch (e) {
      expect((e as Error).message).toBe("Failed to load menu");
    }
  });

  it("refuses to treat a non-JSON 200 as data", async () => {
    // A proxy or captive portal answering 200 with HTML must not silently become
    // an empty menu — that reads to the guest as "this restaurant has no food".
    expect.assertions(1);
    try {
      await readGuestJson(resp("<!doctype html><html>...", 200), "Failed to load menu");
    } catch (e) {
      expect((e as Error).message).toBe(GUEST_UNREACHABLE);
    }
  });

  it("accepts an empty body as null rather than throwing", async () => {
    await expect(readGuestJson(resp("", 204), "fallback")).resolves.toBeNull();
  });
});

describe("readGuestBody", () => {
  it("never throws on a plain-text failure, and reports data as null", async () => {
    const r = await readGuestBody(resp("Internal Server Error", 500, false));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.data).toBeNull();
    expect(r.raw).toContain("Internal Server Error");
  });

  it("still surfaces a structured failure body, which the OTP re-prompt needs", async () => {
    const r = await readGuestBody(
      resp(JSON.stringify({ code: "otp_required", error: "Enter the code shown on your table" }), 403, false),
    );
    expect(r.ok).toBe(false);
    expect(r.data.code).toBe("otp_required");
  });
});
