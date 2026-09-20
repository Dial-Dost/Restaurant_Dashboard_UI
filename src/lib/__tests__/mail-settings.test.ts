// The rules behind Settings → Email: what may be saved, what is never read
// back, and what the restaurant server still needs in its own environment.

import {
  addressOf,
  buildTestMessage,
  effectiveFrom,
  emptyMailView,
  looksLikeEmail,
  mailConfigured,
  mailEnvLines,
  mailSettingsProblem,
  mergeMailEdit,
  normalizeMailSettings,
  redactMailSettings,
  type MailSettings,
  type StoredMailSettings,
} from "@/lib/mail-settings";

const smtp = (over: Partial<MailSettings> = {}): MailSettings =>
  normalizeMailSettings({
    transport: "smtp",
    host: "smtp.example.com",
    port: 587,
    user: "reports@example.com",
    pass: "hunter2",
    from: "Reports <reports@example.com>",
    ...over,
  });

describe("normalizeMailSettings", () => {
  it("falls back to off, and keeps a usable port", () => {
    const s = normalizeMailSettings({ transport: "carrier-pigeon", port: "0" });
    expect(s.transport).toBe("off");
    expect(s.port).toBe(587);
  });

  it("forces implicit TLS on 465 however the flag was stored", () => {
    expect(normalizeMailSettings({ transport: "smtp", port: 465, secure: false }).secure).toBe(true);
    expect(normalizeMailSettings({ transport: "smtp", port: 587, secure: false }).secure).toBe(false);
  });

  it("refuses a timeout that would make a healthy server look dead", () => {
    expect(normalizeMailSettings({ timeoutMs: 0 }).timeoutMs).toBe(20_000);
    expect(normalizeMailSettings({ timeoutMs: 8000 }).timeoutMs).toBe(8000);
  });
});

describe("addresses", () => {
  it("reads the bare address out of a display name", () => {
    expect(addressOf("Reports <reports@example.com>")).toBe("reports@example.com");
    expect(addressOf(" plain@example.com ")).toBe("plain@example.com");
  });

  it("knows an address from a word", () => {
    expect(looksLikeEmail("Reports <reports@example.com>")).toBe(true);
    expect(looksLikeEmail("reports@localhost")).toBe(false);
    expect(looksLikeEmail("nobody")).toBe(false);
  });

  it("lets SMTP fall back to the username, and never invents one elsewhere", () => {
    expect(effectiveFrom(smtp({ from: "" }))).toBe("reports@example.com");
    expect(effectiveFrom(normalizeMailSettings({ transport: "resend", user: "a@b.com" }))).toBe("");
  });
});

describe("mailSettingsProblem", () => {
  it("passes complete SMTP settings", () => {
    expect(mailSettingsProblem(smtp())).toBeNull();
    expect(mailConfigured(smtp())).toBe(true);
  });

  it("names the missing field, one at a time", () => {
    expect(mailSettingsProblem(smtp({ host: "" }))).toMatch(/mail server's address/);
    expect(mailSettingsProblem(smtp({ from: "", user: "" }))).toMatch(/From address/);
    expect(mailSettingsProblem(smtp({ pass: "" }))).toMatch(/password/);
  });

  it("wants a key and a real From for Resend", () => {
    const base = { transport: "resend", from: "Reports <reports@example.com>" };
    expect(mailSettingsProblem(normalizeMailSettings(base))).toMatch(/Resend API key/);
    expect(mailSettingsProblem(normalizeMailSettings({ ...base, resendApiKey: "re_x" }))).toBeNull();
    expect(mailSettingsProblem(normalizeMailSettings({ ...base, resendApiKey: "re_x", from: "reports" }))).toMatch(/email address/);
  });

  it("refuses log-only in production, and allows it anywhere else", () => {
    const log = normalizeMailSettings({ transport: "log" });
    expect(mailSettingsProblem(log, { production: true })).toMatch(/refused in production/);
    expect(mailSettingsProblem(log, { production: false })).toBeNull();
  });

  it("has nothing to say about off", () => {
    expect(mailSettingsProblem(normalizeMailSettings({}))).toBeNull();
    expect(mailConfigured(normalizeMailSettings({}))).toBe(false);
  });
});

describe("what a browser is allowed to see", () => {
  it("answers whether a secret is there, never the secret", () => {
    const stored: StoredMailSettings = { ...smtp(), updatedAt: "2026-09-20T10:00:00.000Z", updatedBy: "Owner" };
    const view = redactMailSettings(stored);
    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain("hunter2");
    expect(view.updatedBy).toBe("Owner");
  });

  it("starts empty and off", () => {
    expect(emptyMailView().transport).toBe("off");
    expect(emptyMailView().hasPassword).toBe(false);
  });
});

describe("mergeMailEdit", () => {
  const current = smtp();

  it("keeps an untouched secret", () => {
    const next = mergeMailEdit(current, {
      transport: "smtp", host: "smtp2.example.com", port: 587, secure: false,
      user: current.user, from: current.from, pass: null, resendApiKey: null,
    });
    expect(next.host).toBe("smtp2.example.com");
    expect(next.pass).toBe("hunter2");
  });

  it("erases one that was deliberately blanked", () => {
    const next = mergeMailEdit(current, {
      transport: "smtp", host: current.host, port: 587, secure: false,
      user: current.user, from: current.from, pass: "", resendApiKey: null,
    });
    expect(next.pass).toBe("");
    expect(mailSettingsProblem(next)).toMatch(/password/);
  });
});

describe("mailEnvLines", () => {
  it("names the secret instead of printing it", () => {
    const lines = mailEnvLines(smtp());
    expect(lines).toContain("MAIL_TRANSPORT=smtp");
    expect(lines).toContain("SMTP_HOST=smtp.example.com");
    expect(lines).toContain("SMTP_FROM=Reports <reports@example.com>");
    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).toMatch(/SMTP_PASS=<the password you entered above>/);
  });

  it("only says SMTP_SECURE where the port does not already", () => {
    expect(mailEnvLines(smtp({ port: 465 })).join("\n")).not.toContain("SMTP_SECURE");
    expect(mailEnvLines(smtp({ port: 2525, secure: true }))).toContain("SMTP_SECURE=true");
  });

  it("switches the server off or over", () => {
    expect(mailEnvLines(normalizeMailSettings({}))).toEqual(["MAIL_TRANSPORT=off"]);
    expect(mailEnvLines(normalizeMailSettings({ transport: "resend", resendApiKey: "re_x", from: "r@e.com" })))
      .toEqual(["MAIL_TRANSPORT=resend", "RESEND_API_KEY=<the API key you entered above>", "MAIL_FROM=r@e.com"]);
  });
});

describe("buildTestMessage", () => {
  it("says which restaurant it came from and who asked for it", () => {
    const msg = buildTestMessage({ restaurantName: "Parity Test Kitchen", byName: "Owner", now: new Date("2026-09-20T10:00:00.000Z") });
    expect(msg.subject).toBe("Test email from Parity Test Kitchen");
    expect(msg.text).toContain("Sent by Owner at 2026-09-20T10:00:00.000Z");
  });

  it("still reads as a sentence with nothing to go on", () => {
    const msg = buildTestMessage({ restaurantName: "  ", byName: "", now: new Date("2026-09-20T10:00:00.000Z") });
    expect(msg.subject).toBe("Test email from your restaurant");
    expect(msg.text).toContain("Sent at 2026-09-20T10:00:00.000Z");
  });
});
