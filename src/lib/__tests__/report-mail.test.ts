// Emailing reports from this web app: which report a key names, what the file
// is called, what the message says, and what may not be sent at all.

import {
  CALENDAR_ONLY_MAIL_KEYS,
  WEB_SEND_MAX_RECIPIENTS,
  buildReportsMessage,
  csvOf,
  dayLabel,
  humanBytes,
  misCsv,
  periodLabel,
  pnlCsv,
  refusedWebSend,
  reportFileBase,
  reportMailTitle,
  reportSource,
  sheetNameFor,
  webMailUnknown,
  webSendOutcome,
  webSendProblem,
  type WebSendRequest,
} from "@/lib/report-mail";
import type { MisColumn, MisReportPayload } from "@/lib/mis-reports";

const request = (over: Partial<WebSendRequest> = {}): WebSendRequest => ({
  reportKeys: ["sales_summary"],
  formats: ["xlsx"],
  from: "2026-09-01",
  to: "2026-09-02",
  dayClose: "",
  allOutlets: false,
  recipientIds: ["r1"],
  ...over,
});

describe("where a report's file comes from", () => {
  it("reads the fifteen MIS reports off the shared catalogue", () => {
    const src = reportSource("settlement_summary");
    expect(src).toMatchObject({ kind: "mis", path: "/reports/mis/settlement-summary", tradingDay: true });
    expect(src?.def?.key).toBe("settlement_summary");
  });

  it("knows the three accounting reports, and that P&L has no CSV route", () => {
    expect(reportSource("sales")).toMatchObject({ kind: "csv", path: "/reports/sales.csv" });
    expect(reportSource("gst")).toMatchObject({ kind: "csv", path: "/reports/gst.csv" });
    expect(reportSource("pnl")).toMatchObject({ kind: "pnl", path: "/reports/pnl" });
  });

  it("refuses a key it cannot build rather than emailing an empty file", () => {
    expect(reportSource("made_up")).toBeNull();
    expect(reportMailTitle("made_up")).toBe("made_up");
    expect(reportMailTitle("gst")).toBe("GST");
  });
});

describe("file and sheet names", () => {
  it("names a file after the report, the scope and the window", () => {
    expect(reportFileBase("sales_summary", "2026-09-01", "2026-09-02", false)).toBe("sales-summary_outlet_2026-09-01_to_2026-09-02");
    expect(reportFileBase("gst", "2026-09-01", "2026-09-01", true)).toBe("gst_all-outlets_2026-09-01");
  });

  it("keeps sheet names inside Excel's rules and never repeats one", () => {
    expect(sheetNameFor("Sales/Summary: [main]", [])).toBe("Sales Summary main");
    const long = sheetNameFor("A very long report title that Excel will not accept", []);
    expect(long).toHaveLength(31);
    const second = sheetNameFor("Sales Summary", ["Sales Summary"]);
    expect(second).toBe("Sales Summary (2)");
    expect(sheetNameFor("", [])).toBe("Report");
  });
});

describe("the sheets themselves", () => {
  it("escapes a CSV and carries the mark Excel opens it by", () => {
    const csv = csvOf(["Line", "Amount"], [['He said "hi", loudly', 12.5], ["Plain", null]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"He said ""hi"", loudly",12.5');
    expect(csv.trimEnd().endsWith("Plain,")).toBe(true);
  });

  it("renders the P&L in the same lines the restaurant server emails", () => {
    const csv = pnlCsv({
      gross_sales: 1000, refunds: 50, tax_collected: 90, service_charge: 30,
      net_revenue: 860, total_expenses: 400, net_profit: 460,
      expenses_by_category: [{ category: "Rent", amount: 300 }, { category: "Gas", amount: 100 }],
    });
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Line,Amount");
    expect(lines[1]).toBe("Gross sales,1000");
    expect(lines[7]).toBe("Net profit,460");
    expect(lines[8]).toBe("Expense — Rent,300");
    expect(lines).toHaveLength(10);
  });

  it("answers a P&L with nothing in it with zeros, not a crash", () => {
    expect(pnlCsv(null)).toContain("Net profit,0");
    expect(pnlCsv({ net_profit: "not a number" })).toContain("Net profit,0");
  });

  it("says on the totals row when a paged report was cut short", () => {
    const columns: MisColumn[] = [
      { key: "item", label: "Item", type: "text" },
      { key: "qty", label: "Qty", type: "int", total: true },
    ] as unknown as MisColumn[];
    const payload = { meta: {}, columns, totals: { qty: 900 } } as unknown as MisReportPayload;
    const rows = [{ item: "Dosa", qty: 3 }];
    expect(misCsv(payload, rows, false)).toContain("Total,900");
    expect(misCsv(payload, rows, true)).toContain("Total (whole window; first 1 rows attached),900");
  });
});

describe("what may be sent", () => {
  it("passes a well-formed send", () => {
    expect(webSendProblem(request(), 1)).toBeNull();
  });

  it("needs a report, a format, days and an address", () => {
    expect(webSendProblem(request({ reportKeys: [] }), 1)).toMatch(/Pick at least one report/);
    expect(webSendProblem(request({ reportKeys: ["made_up"] }), 1)).toMatch(/Pick at least one report/);
    expect(webSendProblem(request({ formats: ["pdf"] }), 1)).toMatch(/Excel, CSV or both/);
    expect(webSendProblem(request({ from: "2026-09-03" }), 1)).toMatch(/Pick the days/);
    expect(webSendProblem(request({ to: "not-a-day" }), 1)).toMatch(/Pick the days/);
    expect(webSendProblem(request(), 0)).toMatch(/at least one address/);
  });

  it("holds the server's own limit of ten addresses", () => {
    expect(WEB_SEND_MAX_RECIPIENTS).toBe(10);
    expect(webSendProblem(request(), 11)).toMatch(/at most 10 addresses/);
  });

  it("keeps GST and P&L on calendar days, as the app does", () => {
    expect(CALENDAR_ONLY_MAIL_KEYS).toEqual(["gst", "pnl"]);
    expect(webSendProblem(request({ reportKeys: ["gst"], dayClose: "02:00" }), 1))
      .toMatch(/GST can only be sent for calendar days/);
    expect(webSendProblem(request({ reportKeys: ["gst", "pnl"], dayClose: "02:00" }), 1)).toMatch(/leave them out/);
    expect(webSendProblem(request({ dayClose: "2am" }), 1)).toMatch(/HH:mm/);
    expect(webSendProblem(request({ reportKeys: ["gst"] }), 1)).toBeNull();
  });
});

describe("what the message says", () => {
  const message = (over: Partial<Parameters<typeof buildReportsMessage>[0]> = {}): { subject: string; text: string } =>
    buildReportsMessage({
      restaurantName: "Parity Test Kitchen",
      byName: "Test Owner",
      reportKeys: ["sales_summary"],
      from: "2026-09-17",
      to: "2026-09-17",
      dayClose: "",
      allOutlets: false,
      files: [{ filename: "sales-summary_outlet_2026-09-17.csv", description: "Sales Summary, 12 rows", bytes: 2048 }],
      sentAt: "2026-09-17T15:35:00.000Z",
      timezone: "Asia/Kolkata",
      ...over,
    });

  it("puts who, what and when in the subject, and no figures", () => {
    expect(message().subject).toBe("Parity Test Kitchen — Sales Summary — Thu 17 Sep 2026");
    expect(message({ allOutlets: true }).subject).toContain("· All outlets");
    expect(message({ reportKeys: ["sales_summary", "gst"] }).subject).toContain("— Daily reports —");
    expect(message({ reportKeys: ["sales_summary", "gst"], from: "2026-09-01", to: "2026-09-17" }).subject)
      .toContain("— Reports — 1 Sep – 17 Sep 2026");
  });

  it("names the window, the files and who sent it — and that it was not the server", () => {
    const text = message().text;
    expect(text).toContain("Calendar day, midnight to midnight (Asia/Kolkata).");
    expect(text).toContain("Attached: 1 file.");
    expect(text).toContain("sales-summary_outlet_2026-09-17.csv — Sales Summary, 12 rows, 2 KB");
    expect(text).toContain("Sent from the dashboard by Test Owner on 17 Sep 2026, 21:05.");
    expect(text).toContain("will not appear in History");
  });

  it("says when the days are trading days", () => {
    expect(message({ dayClose: "02:00" }).text).toContain("Trading day closing at 02:00 (Asia/Kolkata).");
  });

  it("does not let a restaurant's own name break the header", () => {
    expect(message({ restaurantName: "Bad\r\nSubject: spoofed" }).subject).not.toContain("\n");
    expect(message({ restaurantName: "   " }).subject).toContain("Your restaurant");
  });

  it("writes days and periods the way the app's emails do", () => {
    expect(dayLabel("2026-09-17")).toBe("Thu 17 Sep 2026");
    expect(dayLabel("nonsense")).toBe("nonsense");
    expect(periodLabel("2026-09-01", "2026-09-01")).toBe("Tue 1 Sep 2026");
    expect(periodLabel("2026-09-01", "2026-09-17")).toBe("1 Sep – 17 Sep 2026");
    expect(periodLabel("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 – 2 Jan 2026");
    expect(humanBytes(900)).toBe("1 KB");
    expect(humanBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("what came of it", () => {
  it("counts a clean send, and says where it will not be listed", () => {
    const out = webSendOutcome(["a@example.com", "b@example.com"], []);
    expect(out.ok).toBe(true);
    expect(out.title).toBe("Sent to 2 addresses");
    expect(out.description).toContain("will not appear in History");
  });

  it("names the addresses that failed instead of claiming a send", () => {
    const partial = webSendOutcome(["a@example.com"], [{ email: "b@example.com", message: "Mailbox full." }]);
    expect(partial.ok).toBe(true);
    expect(partial.title).toBe("Sent to 1 of 2 addresses");
    expect(partial.description).toBe("b@example.com: Mailbox full.");

    const none = webSendOutcome([], [{ email: "b@example.com", message: "Mailbox full." }]);
    expect(none.ok).toBe(false);
    expect(none.title).toBe("Couldn't send");
  });

  it("carries a refusal as the one sentence to fix", () => {
    const refused = refusedWebSend("The mail server refused the sign-in.");
    expect(refused).toMatchObject({ ok: false, sent: [], failed: [], refusal: "The mail server refused the sign-in." });
    expect(webMailUnknown()).toEqual({ ready: false, from: "", reason: "" });
  });
});
