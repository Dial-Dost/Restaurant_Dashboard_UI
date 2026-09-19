// Accounting module fetchers — the web half of Flutter's `_AccountingView`
// (restaurant_owner_app/lib/screens/modules.dart ~22169).
//
// These deliberately bypass db.ts's null-on-failure getters for the report
// reads: `useCachedFetch` owns caching and staleness on this page, so a failure
// must THROW (offline throws a TypeError, a refusal throws the server's own
// sentence) instead of quietly rendering an outage as an empty ledger — which
// is exactly what the old page did (`Promise.all` with no catch left every
// figure at ₹0).
//
// The batched bundle mirrors Flutter's `_fetch()`: sales + gst + pnl + expenses
// are load-bearing (any failure fails the page), while payroll and discounts
// carry their own `.catchError` in the app and degrade to null here.

import { requestBackend } from "@/lib/db";
import type {
  BalanceSheet,
  DiscountsReport,
  ExpenseRow,
  GstReport,
  OpenBillPage,
  PayrollData,
  ProfitAndLoss,
  ReconciliationRow,
  SalesReport,
} from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

/* ── Report shapes beyond db.ts ─────────────────────────────────────────
 * The backend has carried these keys since the gross/net rename (they are
 * what src/lib/gross-net.ts reads); db.ts's older interfaces simply never
 * declared them. All optional: an older backend omits them and the page
 * says what it actually has. */

export interface AccountingSales extends SalesReport {
  /** NET in the client's word — item total less discounts. Absent on old backends. */
  total_net?: number | string | null;
  /** The restaurant's own income, never part of total_tax. */
  total_service_charge?: number | string | null;
  total_round_off?: number | string | null;
  /** The share of total_tax sitting inside refunded bills. */
  total_refunded_tax?: number | string | null;
}

export interface AccountingGst extends GstReport {
  /** Kept out of by_rate on purpose — income, not a levy. */
  total_service_charge?: number | string | null;
}

export interface AccountingPnl extends ProfitAndLoss {
  /** Stays inside net_revenue; reported so the sheet can name it. */
  service_charge?: number | string | null;
}

/** Everything the page paints, fetched as one replayable batch. */
export interface AccountingBundle {
  sales: AccountingSales;
  gst: AccountingGst;
  pnl: AccountingPnl;
  expenses: ExpenseRow[];
  /** Null when /payroll failed — the section hides, the page still stands. */
  payroll: PayrollData | null;
  /** Null when /reports/discounts failed — the card hides. */
  discounts: DiscountsReport | null;
}

/* ── Throwing plumbing (same shape as src/lib/api/bookings.ts) ─────────── */

const throwBackendError = (status: number, text: string, fallback: string): never => {
  if (status === 0) {
    throw new TypeError("Failed to fetch");
  }
  let message = "";
  try {
    message = refusalSentence(JSON.parse(text)) ?? "";
  } catch {
    /* not JSON — the raw body is the best we have */
  }
  if (!message) {
    message = text.trim() || fallback;
  }
  throw Object.assign(new Error(message), { status });
};

const getJson = async <T>(rid: string, path: string, fallback: string): Promise<T> => {
  const response = await requestBackend<T>({ path, method: "GET", restaurantId: rid });
  if (!response.ok || response.data == null) {
    throwBackendError(response.status, response.text, fallback);
  }
  return response.data as T;
};

const fromTo = (from: string, to: string): string =>
  `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/* ── The batch ─────────────────────────────────────────────────────────── */

export const fetchAccountingBundle = async (
  rid: string,
  from: string,
  to: string,
  payrollMonth: string,
): Promise<AccountingBundle> => {
  const ridQ = encodeURIComponent(rid);
  const [sales, gst, pnl, expenses, payroll, discounts] = await Promise.all([
    getJson<AccountingSales>(rid, `/reports/sales?restaurantId=${ridQ}${fromTo(from, to)}`, "Could not load reports"),
    getJson<AccountingGst>(rid, `/reports/gst?restaurantId=${ridQ}${fromTo(from, to)}`, "Could not load reports"),
    getJson<AccountingPnl>(rid, `/reports/pnl?restaurantId=${ridQ}${fromTo(from, to)}`, "Could not load reports"),
    getJson<{ expenses?: ExpenseRow[] }>(rid, `/expenses?restaurantId=${ridQ}${fromTo(from, to)}`, "Could not load reports"),
    getJson<PayrollData>(
      rid,
      `/payroll?restaurantId=${ridQ}&month=${encodeURIComponent(payrollMonth)}`,
      "Could not load payroll",
    ).catch(() => null),
    getJson<DiscountsReport>(
      rid,
      `/reports/discounts?restaurantId=${ridQ}${fromTo(from, to)}`,
      "Could not load discounts",
    ).catch(() => null),
  ]);
  return {
    sales,
    gst,
    pnl,
    expenses: Array.isArray(expenses.expenses) ? expenses.expenses : [],
    payroll,
    discounts,
  };
};

/* ── Web-extra sections (kept per audit area 12 — throwing reads) ──────── */

export const fetchOpenBillsPage = async (
  rid: string,
  opts: { limit: number; offset: number },
): Promise<OpenBillPage> => {
  const qs = new URLSearchParams({ restaurantId: rid });
  qs.set("limit", String(Math.max(1, Math.min(opts.limit, 200))));
  qs.set("offset", String(Math.max(0, opts.offset)));
  const page = await getJson<Partial<OpenBillPage>>(rid, `/bills/open?${qs.toString()}`, "Couldn't load open bills.");
  const bills = Array.isArray(page.bills) ? page.bills : [];
  return {
    bills,
    total: page.total ?? bills.length,
    limit: page.limit ?? opts.limit,
    offset: page.offset ?? opts.offset,
    has_more: page.has_more === true,
    outstanding_total: page.outstanding_total ?? 0,
    running_tables: page.running_tables ?? null,
    running_total: page.running_total ?? null,
    timezone: typeof page.timezone === "string" ? page.timezone : "",
  };
};

export const fetchBalanceSheet = async (rid: string, asOf: string): Promise<BalanceSheet> =>
  getJson<BalanceSheet>(
    rid,
    `/reports/balance-sheet?restaurantId=${encodeURIComponent(rid)}&as_of=${encodeURIComponent(asOf)}`,
    "Couldn't load the balance sheet.",
  );

export const fetchReconciliation = async (
  rid: string,
  date: string,
): Promise<{ date: string; rows: ReconciliationRow[] }> => {
  const data = await getJson<{ date?: string; rows?: ReconciliationRow[] }>(
    rid,
    `/reconciliation?restaurantId=${encodeURIComponent(rid)}&date=${encodeURIComponent(date)}`,
    "Couldn't load reconciliation.",
  );
  return { date: typeof data.date === "string" ? data.date : date, rows: Array.isArray(data.rows) ? data.rows : [] };
};
