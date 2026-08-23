import {
  SAME_ORIGIN_BACKEND_PREFIX,
  browserBackendBase,
  publicBackendOrigin,
  serverBackendBase,
  serverBaseUrlFrom,
  socketBackendBase,
} from "../backend-url";

/// These tests exist because of a live production outage, and the first of them
/// is the one that would have caught it.
///
/// The dashboard image was built with the build-arg NEXT_PUBLIC_BACKEND_URL set
/// to the EMPTY STRING (`ARG NEXT_PUBLIC_BACKEND_URL` had no default, so
/// `ENV X=$ARG` produced ""). Nine call sites read it as
///     process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"
/// and `??` only falls back on null/undefined — so "" passed straight through
/// and every base URL in the browser bundle became "". The platform console
/// called POST /platform/auth/login on its own origin, Next answered with its
/// 404 HTML page, and JSON.parse produced
///     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
/// with every counter reading 0. Guest ordering broke on the same host, which
/// mattered more: 27 freshly printed table QR codes point at it.
///
/// Every test below therefore pins a CONDITION, not an implementation: blank
/// means unconfigured, a browser never gets a URL it cannot resolve, and the
/// server never gets a relative one.

const REAL_ENV = process.env;

/** Pretend to be a browser on `hostname`. The jest env is `node`, so there is
 *  no window unless a test installs one. */
function withWindow(hostname: string, protocol = "https:"): void {
  (globalThis as unknown as { window?: unknown }).window = {
    location: { hostname, protocol, origin: `${protocol}//${hostname}` },
  };
}

function withoutWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

beforeEach(() => {
  process.env = { ...REAL_ENV };
  // Start every case from "nothing configured" so a stray value in the
  // developer's own shell cannot make a failing case pass.
  delete process.env.NEXT_PUBLIC_BACKEND_URL;
  delete process.env.BACKEND_INTERNAL_URL;
  delete process.env.NEXT_PUBLIC_RECEPTION_API_URL;
  delete process.env.NEXT_BACKEND_URL;
  withoutWindow();
});

afterEach(() => {
  process.env = REAL_ENV;
  withoutWindow();
});

describe("the exact production condition: NEXT_PUBLIC_BACKEND_URL is the empty string", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "";
    withWindow("experiosolutions.dialdost.com");
  });

  it("resolves the browser base to the same-origin proxy prefix, never to ''", () => {
    // The whole bug in one assertion.
    expect(browserBackendBase()).toBe(SAME_ORIGIN_BACKEND_PREFIX);
    expect(browserBackendBase()).not.toBe("");
  });

  it("builds a proxied request path, not the bare path that returned Next's 404 HTML", () => {
    // "" + "/platform/auth/login" was "/platform/auth/login" — the dashboard's
    // own origin, which answers 404 text/html. Measured against production:
    //   POST /platform/auth/login             -> 404 HTML
    //   POST /backend-api/platform/auth/login -> 400 JSON (reached the backend)
    expect(`${browserBackendBase()}/platform/auth/login`).toBe(
      "/backend-api/platform/auth/login",
    );
  });

  it("reports no public origin at all rather than an empty one", () => {
    expect(publicBackendOrigin()).toBeNull();
  });

  it("still hands server-side code an ABSOLUTE url", () => {
    // A server-side fetch("/backend-api/x") throws `Failed to parse URL`, so the
    // browser answer above must never leak into a "use server" module.
    const base = serverBackendBase();
    expect(base.startsWith("/")).toBe(false);
    expect(() => new URL(base)).not.toThrow();
  });

  it("never hands socket.io an empty host", () => {
    // io("") resolves to `https://:443` — host "" — so realtime could not
    // connect at all. Whatever we return must have a real hostname.
    const base = socketBackendBase();
    expect(base).not.toBe("");
    expect(new URL(base).hostname).not.toBe("");
  });
});

describe("blank is treated as unconfigured, in every shape it arrives", () => {
  it.each([
    ["empty string", ""],
    ["single space", " "],
    ["spaces and a tab", "  \t "],
  ])("%s", (_label, value) => {
    process.env.NEXT_PUBLIC_BACKEND_URL = value;
    withWindow("experiosolutions.dialdost.com");
    expect(browserBackendBase()).toBe(SAME_ORIGIN_BACKEND_PREFIX);
    expect(publicBackendOrigin()).toBeNull();
  });
});

describe("browserBackendBase", () => {
  it("uses the configured public origin in production", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com";
    withWindow("experiosolutions.dialdost.com");
    expect(browserBackendBase()).toBe("https://api.dialdost.com");
  });

  it("strips a trailing slash so callers can concatenate a rooted path", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com/";
    withWindow("experiosolutions.dialdost.com");
    expect(`${browserBackendBase()}/qr/csrorganics/menu`).toBe(
      "https://api.dialdost.com/qr/csrorganics/menu",
    );
  });

  it("falls back to the proxy when the configured backend is localhost but the page is not", () => {
    // A guest's phone on the LAN IP, or anyone through a Cloudflare tunnel:
    // "localhost" there names the visitor's own device. This is the behaviour
    // the old guest-backend.ts had and that local dev depends on.
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";
    withWindow("172.20.10.2", "http:");
    expect(browserBackendBase()).toBe(SAME_ORIGIN_BACKEND_PREFIX);
  });

  it("keeps a localhost backend when the page really is on localhost (dev laptop)", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";
    withWindow("localhost", "http:");
    expect(browserBackendBase()).toBe("http://localhost:3001");
  });

  it("works in dev with the var unset: the proxy reaches the backend", () => {
    withWindow("localhost", "http:");
    expect(browserBackendBase()).toBe(SAME_ORIGIN_BACKEND_PREFIX);
  });

  it("rejects a value with no scheme rather than emitting a hostname as a base", () => {
    // "api.dialdost.com" would become the relative path "api.dialdost.com/..."
    process.env.NEXT_PUBLIC_BACKEND_URL = "api.dialdost.com";
    withWindow("experiosolutions.dialdost.com");
    expect(browserBackendBase()).toBe(SAME_ORIGIN_BACKEND_PREFIX);
  });

  it("defers to the server resolver when there is no window", () => {
    // SSR and Server Actions: a relative prefix cannot be resolved without a
    // browser, so it must never be returned here.
    process.env.BACKEND_INTERNAL_URL = "http://backend:3001";
    expect(browserBackendBase()).toBe("http://backend:3001");
  });
});

describe("serverBackendBase", () => {
  it("prefers the internal docker address over the public one", () => {
    // Staying on the docker network avoids a pointless hairpin out through
    // Cloudflare and back for every server-side call.
    process.env.BACKEND_INTERNAL_URL = "http://backend:3001";
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com";
    expect(serverBackendBase()).toBe("http://backend:3001");
  });

  it("falls back to the public origin when the internal one is missing at runtime", () => {
    // The Dockerfile sets BACKEND_INTERNAL_URL in the builder stage; if it is
    // ever absent from the runtime container this keeps the server reachable.
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com";
    expect(serverBackendBase()).toBe("https://api.dialdost.com");
  });

  it("falls back to the dev backend port, not the dashboard's own port", () => {
    // authService.ts and the feedback/print pages used to default to :3000,
    // which is the dashboard. The backend is :3001.
    expect(serverBackendBase()).toBe("http://localhost:3001");
  });

  it("still honours the legacy reception alias rather than dropping it", () => {
    // Commented out in .env.example, but kept working. It now ranks BELOW
    // NEXT_PUBLIC_BACKEND_URL everywhere; db.ts and authService.ts used to
    // disagree about which of the two won.
    process.env.NEXT_PUBLIC_RECEPTION_API_URL = "https://reception.example.com";
    expect(serverBackendBase()).toBe("https://reception.example.com");

    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com";
    expect(serverBackendBase()).toBe("https://api.dialdost.com");
  });

  it("skips a blank candidate and keeps walking the chain", () => {
    process.env.BACKEND_INTERNAL_URL = "";
    process.env.NEXT_PUBLIC_BACKEND_URL = "   ";
    process.env.NEXT_PUBLIC_RECEPTION_API_URL = "https://reception.example.com";
    expect(serverBackendBase()).toBe("https://reception.example.com");
  });

  it.each([
    ["both blank", "", ""],
    ["internal blank, public blank", "   ", "  "],
  ])("is absolute even when %s", (_label, internal, publicUrl) => {
    process.env.BACKEND_INTERNAL_URL = internal;
    process.env.NEXT_PUBLIC_BACKEND_URL = publicUrl;
    expect(() => new URL(serverBackendBase())).not.toThrow();
  });
});

describe("serverBaseUrlFrom", () => {
  // requestBackend is a Server Action, but client components used to compute a
  // baseUrl in the BROWSER and pass it in. These are the values that used to
  // arrive and would throw `Failed to parse URL` on a server-side fetch.
  it.each([
    ["the empty string", ""],
    ["whitespace", "   "],
    ["the same-origin proxy prefix", "/backend-api"],
    ["a bare hostname", "api.dialdost.com"],
    ["undefined", undefined],
  ])("ignores %s and returns an absolute base", (_label, candidate) => {
    const base = serverBaseUrlFrom(candidate);
    expect(base.startsWith("/")).toBe(false);
    expect(() => new URL(base)).not.toThrow();
  });

  it("honours a genuine absolute override", () => {
    expect(serverBaseUrlFrom("https://reception.example.com/")).toBe(
      "https://reception.example.com",
    );
  });
});

describe("socketBackendBase", () => {
  it("returns the backend's own public origin in production", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.dialdost.com";
    withWindow("experiosolutions.dialdost.com");
    expect(socketBackendBase()).toBe("https://api.dialdost.com");
  });

  it("NEVER returns the same-origin proxy prefix", () => {
    // Two reasons: a Next rewrite does not proxy websockets, and
    // socket.io-client discards the path of the URL it is given (it uses its
    // own `path` option), so "/backend-api" would resolve to
    // <dashboard-origin>/socket.io — which Next does not serve.
    for (const value of ["", "   ", "api.dialdost.com", "http://localhost:3001"]) {
      process.env.NEXT_PUBLIC_BACKEND_URL = value;
      withWindow("experiosolutions.dialdost.com");
      expect(socketBackendBase()).not.toBe(SAME_ORIGIN_BACKEND_PREFIX);
      expect(socketBackendBase().startsWith("/")).toBe(false);
    }
  });

  it("always yields a parseable url with a non-empty host", () => {
    for (const value of ["", "   ", "https://api.dialdost.com"]) {
      process.env.NEXT_PUBLIC_BACKEND_URL = value;
      withWindow("experiosolutions.dialdost.com");
      expect(new URL(socketBackendBase()).hostname).not.toBe("");
    }
  });

  it("points at the page host on :3001 in dev, where the backend really is", () => {
    withWindow("172.20.10.2", "http:");
    expect(socketBackendBase()).toBe("http://172.20.10.2:3001");
  });
});
