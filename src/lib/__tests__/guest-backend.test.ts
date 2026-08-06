import { readGuestJson, readGuestBody, GuestRequestError, GUEST_UNREACHABLE } from "../guest-backend";

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
