"use server";

// When executing in a server context we can read incoming request cookies
// via Next.js helpers so the server-side request helpers can pick up
// the `authUser` cookie set by the client after login.
import { cookies as nextCookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { type Booking } from '@/app/dashboard/bookings/data';
import { type Customer } from '@/app/dashboard/customers/page';
import { type InventoryItem } from '@/app/dashboard/inventory/page';
import { type MenuItem } from '@/app/dashboard/menu/data';
import { MenuBadgeInUseError, parseBadgeCatalogue, type MenuBadge } from '@/lib/menu-badges';
import { type MovedItem, type Order } from '@/app/dashboard/orders/page';
import { type Table } from '@/app/dashboard/tables/data';
import { type AuditLog } from '@/app/dashboard/audit-logs/page';
import { serverBackendBase, serverBaseUrlFrom } from '@/lib/backend-url';
import { readErrorMessage, refusalSentence, type RefusedAction } from '@/lib/error-message';
// C3. The two readers are pure and live beside the rule they implement, so this
// module holds no second opinion about what "already printed" means — it only
// carries the bytes between the route and the screens.
import { billPaperJobIdOf, billPrintRefusal, billPrintStateFields, billRevisedNoteOf, type BillPrintState } from '@/lib/bill-print-state';
// Client item 6. Pure, like the C3 readers above: this module only carries the
// next party's seat and the 409 between the routes and the screens.
import { ADD_TO_PRINTED_BILL_KEY, nextPartyAfterPrint, nextPartyRowFields, readBillPrintedRefusal, type BillPrintedRefusal } from '@/lib/next-party';
import { hasOrderField } from '@/lib/floor-state';
import { ncSettleWasRefused } from '@/lib/nc-settle';
import { UNREACHABLE_MESSAGE, billCustomerPayload, billCustomerSaveOutcome, type BillCustomerRequest, type BillCustomerSaveOutcome } from '@/lib/bill-customer';
import { SELECTED_OUTLET_KEY } from '@/lib/outlet';
import {
    KOT_PRINT_STYLE_DEFAULT,
    KOT_TEXT_SIZE_DEFAULT,
    readKotDocketSettings,
    savedKotPrintStyle,
    savedKotTextSize,
    type KotPrintStyle,
    type KotTextSize,
} from '@/lib/kot-print-style';
import { readPaymentMethods, type PaymentMethodConfig } from '@/lib/payment-methods';
import type { BrandConfig } from '@/lib/brand-fonts';
import type { RolePermission } from '@/lib/role-permissions';
import type { ServiceClock } from '@/lib/service-clock';
import type { SessionScope } from '@/lib/session-scope';
import type { SettlementMode } from '@/lib/settlement-breakdown';
import type {
    BillTenderState,
    BillingCounterRecord,
    MenuGroupAssignments,
    MenuGroupRecord,
    MenuVariationRecord,
    NonChargeableRecord,
    OrderVoidRecord,
    RemoveServiceChargeAndPrintResult,
    ServiceChargeWaiverRecord,
    TenderWire,
} from '@/lib/mis-capture';
import type { MisReportPayload } from '@/lib/mis-reports';
import { misSlotParams, readTimeSlots, slotDraftsBody, type MisBucket, type ReportTimeSlots, type TimeSlotDraft } from '@/lib/report-time-slots';

export interface User {
    id: string;
    res_id: string;
    outlet_id: string;
    employee_id: string;
    employee_Username: string;
    emp_Fname: string;
    emp_Lname?: string | null;
    password: string;
    role: string;
    role_all?: string[];
    action_list: string[];
    is_superadmin?: boolean;
}

export interface PasswordResetRequest {
    id: string;
    employee_id: string;
    username: string;
    name: string;
    created_at: string;
}

export interface RestaurantProfile {
    restaurant_name: string;
    outlet_add: string;
    outlet_phone: string;
    email: string;
    outlet_hours: string;

    res_id: string;
    restaurant_username: string;
    restaurant_main_office_add: string | null;
    restaurant_logo_url: string | null;

    outlet_id: string;
    outlet_name: string;
}

export interface RoleDefinition {
    id: string;
    role_name: string;
    actions_performable: string[];
    /*
      C6 — THE SAME IDS, ALREADY READABLE. GET /roles projects each id's name,
      description and group beside `actions_performable`, in the SAME ORDER and
      the SAME LENGTH, so a role screen renders without a second call to
      GET /actions — which carries a DIFFERENT permission, and whose absence is
      what made a role open to a column of raw uuids.

      OPTIONAL because a backend older than the projection sends none;
      `src/lib/role-permissions.ts` owns the fallback and is the only thing that
      should read either field.
    */
    permissions?: RolePermission[];
    /** The server's answer to "may this role be written". Custom roles: true. */
    editable?: boolean;
}

export interface TableAssignmentDefinition {
    id: string;
    table_name: string;
    employee_id: string;
    employee_name: string;
    employee_role: string;
}

export type ApcZone = 'red' | 'yellow' | 'green';

export interface OrderApcInsight {
    order_id: string;
    table_name: string;
    /**
     * What a table-wise view calls this seating: the ROOT's name for a
     * next-party seating ("12" for "12 #2", client item 6), else table_name.
     * A label only; the row is still its own seating. Absent on older backends.
     */
    table_label?: string;
    created_at: string;
    total: number;
    people_count: number;
    target_total: number;
    zone: ApcZone;
    assigned_employee_id: string | null;
    assigned_employee_name: string | null;
}

export interface EmployeeApcIncentive {
    employee_id: string;
    employee_name: string;
    employee_role: string;
    assigned_tables: string[];
    orders_count: number;
    covers_count: number;
    mean_apc: number;
    zone: ApcZone;
}

export interface MonthlyApcInsight {
    month: string;
    period?: 'day' | 'week' | 'month';
    period_start?: string;
    period_end?: string;
    monthly_apc: number;
    total_revenue: number;
    total_covers: number;
    yellow_band_percent: number;
    orders: OrderApcInsight[];
    employee_incentives: EmployeeApcIncentive[];
}

// A built-in id ('Upi', 'Cash', …), 'Split', or a mode the owner added. The set
// is the restaurant's own (GET /restaurant/settings payment_methods — see
// src/lib/payment-methods.ts), so it cannot be a union compiled in here: the old
// one offered 'Swiggy' and 'Online Transfer', which the server always refused.
export type PaymentMethod = string;

// One row of a split-tender payment ({method, amount}); the rows must sum to
// the bill's grand total (backend-validated).
export interface PaymentSplit { method: string; amount: number }

interface OutletData {
    outlet_add: string;
    outlet_phone: string;
    email: string;
    outlet_hours: string;
    outlet_id: string;
    outlet_name: string;
}

interface RestaurantData {
    profile: RestaurantProfile;
    outlet: OutletData;
    bookings: Booking[];
    customers: Customer[];
    inventory: InventoryItem[];
    menuItems: MenuItem[];
    menuCategories: string[];
    orders: Order[];
    tables: Table[];
    auditLogs: AuditLog[]
}

interface RestaurantRecord {
    res_id: string;
    res_username: string;
    Restaurant_name: string;
    users: User[];
    data: RestaurantData;
}

// This module is "use server": every export is a Server Action, so these
// fetches run INSIDE the Next container, never in the browser — even when a
// client component calls them. The address must therefore be absolute and
// should be the internal docker one; `serverBackendBase()` handles both.
//
// Resolved per call rather than in a module constant, because the old constant
// used `??` and an empty NEXT_PUBLIC_BACKEND_URL is not null: it won the
// fallback chain and every server-side fetch was issued against a bare path.
const apiBaseUrl = (): string => serverBackendBase();

// A separate reception server is opt-in; when unset (or blank) it is the same
// backend. `.trim()` matters here for the same reason as everywhere else in
// this change — an empty env var must read as "not configured".
const receptionServerBaseUrl = (): string => {
    const configured = process.env.NEXT_PUBLIC_RECEPTION_SERVER_URL?.trim().replace(/\/+$/, '');
    return configured && configured.length > 0 ? configured : apiBaseUrl();
};

export interface BackendRequestParams {
    path: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    restaurantId?: string;
    employeeId?: string;
    outletId?: string;
    actionList?: string[];
    headers?: HeadersInit;
    body?: unknown;
    baseUrl?: string;
    parseJson?: boolean;
}

export interface BackendRequestResult<T = unknown> {
    ok: boolean;
    status: number;
    data: T | null;
    text: string;
}

const restaurantStore = new Map<string, RestaurantRecord>();

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const getRestaurantUsernameFromName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const defaultRestaurantData = (restaurantName: string): RestaurantData => ({
    profile: {
        res_id: 'test-res-id',
        restaurant_name: restaurantName,
        restaurant_username: restaurantName.toLowerCase().replace(/\s+/g, '_'),
        restaurant_main_office_add: null,
        restaurant_logo_url: null,
        outlet_id: 'test-outlet-id',
        outlet_name: 'Main Outlet',
        outlet_add: '',
        outlet_phone: '',
        email: '',
        outlet_hours: ''
    },
    outlet: {
        outlet_add: "",
        outlet_phone: "",
        email: "",
        outlet_hours: "",
        outlet_id: "test-outlet-id",
        outlet_name: "test-outlet"
    },
    bookings: [],
    customers: [],
    inventory: [],
    menuItems: [],
    // Empty, like every other collection here. This used to hold a demo list
    // ('Appetizers', 'Main Courses', …) which a failed GET /menu/categories then
    // served as if it were the restaurant's own menu — categories that exist
    // nowhere, offered in the Add Item dropdown to file real dishes into.
    menuCategories: [],
    orders: [],
    tables: [],
    auditLogs: [],
});

// The store is an offline snapshot cache keyed by restaurant username, nothing
// more — the backend is the source of truth. A missing key therefore means
// "nothing cached for this tenant yet", not "unknown tenant", so it is created on
// demand. Throwing here made every getter fail for any tenant the process had not
// already seen (this file is "use server", so the map is one per server process),
// which meant a successful backend response was discarded on the way to being
// cached. Name and id are filled in when the caller knows them.
const ensureLocalRestaurant = (restaurant_username: string, restaurantName?: string, restaurantId?: string): RestaurantRecord => {
    const existing = restaurantStore.get(restaurant_username);
    if (existing) {
        return existing;
    }

    const name = restaurantName ?? restaurant_username;
    const created: RestaurantRecord = {
        res_id: restaurantId ?? '',
        res_username: restaurant_username,
        Restaurant_name: name,
        users: [],
        data: defaultRestaurantData(name),
    };
    restaurantStore.set(restaurant_username, created);
    return created;
};

const stableTableId = (tableName: string, fallback = 1): number => {
    if (!tableName) {return fallback;}
    let hash = 0;
    for (let i = 0; i < tableName.length; i += 1) {
        hash = ((hash << 5) - hash + tableName.charCodeAt(i)) | 0;
    }
    const normalized = Math.abs(hash % 100000);
    return normalized > 0 ? normalized : fallback;
};

// "Jul 28, 07:30 PM" for a reservation. This runs on the SERVER (db.ts is
// "use server"), so the old zone-less toLocaleString rendered in the Node
// process's zone — usually UTC in a container — and a 7:30 PM table showed as
// 2:00 PM. The tenant zone is passed in explicitly instead.
const formatBookingTime = (isoString: string, timeZone: string): string => {
    const value = new Date(isoString);
    if (Number.isNaN(value.getTime())) {
        return isoString;
    }
    try {
        return value.toLocaleString('en-US', {
            timeZone,
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    } catch {
        return isoString;
    }
};

const toCustomerStatus = (hasBooking: unknown): Customer['status'] =>
    hasBooking ? 'In-house' : 'Departed';

const toTableStatus = (booked: unknown, reserved: unknown, occupied?: unknown, paymentPending?: unknown): Table['status'] => {
    // A table physically occupied by walk-ins (e.g. seated from the waitlist) has
    // no Booking row, so it must be read from is_occupied / payment_pending too —
    // otherwise it would wrongly show as free and could be double-seated.
    if (Boolean(occupied) || Boolean(paymentPending)) {return 'Occupied';}
    // A table inside an ACTIVE booking window (get-tables booked=true) is NOT
    // physically occupied — it is "Booked" (an in-progress reservation). It must
    // stay visually distinct from Occupied and remain orderable/occupiable.
    if (Boolean(booked)) {return 'Booked';}
    // An upcoming (future-window) booking marks the table "Reserved".
    if (Boolean(reserved)) {return 'Reserved';}
    return 'Available';
};

interface FrontendAuthContext {
    outletId: string | null;
    actionList: string[];
    employeeId: string | null;
    token: string | null;
}

// The outlet switcher's choice, read from the cookie that setSelectedOutlet()
// writes via /api/session. Server-only: these accessors run as Server Actions,
// so localStorage is not reachable from here and the cookie is the only channel.
const getSelectedOutletFromCookie = async (): Promise<string | null> => {
    if (typeof window !== 'undefined') {return null;}
    try {
        const ckAny: any = await nextCookies();
        const raw = (typeof ckAny.get === 'function' ? ckAny.get(SELECTED_OUTLET_KEY) : ckAny?.cookies?.get?.(SELECTED_OUTLET_KEY))?.value ?? null;
        return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
    } catch {
        return null;
    }
};

const getPathWithoutQuery = (path: string): string => {
    const index = path.indexOf('?');
    return index >= 0 ? path.slice(0, index) : path;
};

const isRestaurantLoginPath = (path: string): boolean => {
    const normalized = getPathWithoutQuery(path).toLowerCase();
    return (
        normalized === '/auth/restaurant-login' ||
        normalized === '/auth/login-restaurant' ||
        normalized === '/auth/signin-restaurant'
    );
};

const isEmployeeLoginPath = (path: string): boolean => {
    const normalized = getPathWithoutQuery(path).toLowerCase();
    return normalized === '/auth/employee-login';
};

// --- Expired-session global gate (BUG A) -------------------------------------
// The backend keeps sessions in memory, so a backend restart invalidates every
// token and previously-authenticated data calls come back HTTP 401
// {"error":"Unauthorized","details":"Invalid or expired session"}. These
// accessors are Server Actions and cannot clear localStorage or navigate on
// their own, so before this gate a 401 was silently swallowed into an empty tab
// ("my orders vanished"). Funnelling every fetch below through enforceSessionAlive
// turns any 401 into a NEXT_REDIRECT that escapes the action to Next's router,
// forcing the user to the login screen (which clears the stored auth and shows a
// "session expired" message) instead of rendering empty — global, so every
// screen that reads through the shared wrappers is covered at once.
const SESSION_EXPIRED_REDIRECT = '/login?session=expired';

// A 401 on a public /auth/* call (a wrong password on employee-login, or a probe
// for an unknown restaurant) is a normal auth outcome, NOT an expired session —
// those must never be bounced to the "session expired" screen.
const isAuthPath = (path: string): boolean =>
    getPathWithoutQuery(path).toLowerCase().startsWith('/auth/');

// MUST be called OUTSIDE any try/catch: redirect() signals via a thrown
// NEXT_REDIRECT that has to escape the action untouched to actually navigate.
// A 401 is the session itself failing to resolve (expired/invalid/missing token);
// a 403 is an authenticated-but-unpermitted call and deliberately does NOT log
// the user out (it flows through as a normal !ok response).
const enforceSessionAlive = (path: string, status: number): void => {
    if (status === 401 && !isAuthPath(path)) {
        redirect(SESSION_EXPIRED_REDIRECT);
    }
};

const getFrontendAuthContext = async (): Promise<FrontendAuthContext> => {
    // If running on server, attempt to read cookie set by client.
    if (typeof window === 'undefined') {
        try {
            // nextCookies() may be a Promise; await it just in case.
            const ckAny: any = await nextCookies();
            const cookie = (typeof ckAny.get === 'function' ? ckAny.get('authUser') : ckAny?.cookies?.get?.('authUser'))?.value ?? null;
            if (!cookie) {return { outletId: null, actionList: [], employeeId: null, token: null };}
            const parsed = JSON.parse(decodeURIComponent(cookie)) as {
                outlet_id?: unknown;
                outletId?: unknown;
                actions_set?: unknown;
                action_list?: unknown;
                employeeId?: unknown;
                token?: unknown;
            };

            const empId = typeof parsed?.employeeId === 'string' ? parsed.employeeId : null;

            const outletFromCookie =
                typeof parsed?.outlet_id === 'string'
                    ? parsed.outlet_id
                    : typeof parsed?.outletId === 'string'
                        ? parsed.outletId
                        : null;

            const rawActions = Array.isArray(parsed?.actions_set)
                ? parsed.actions_set
                : Array.isArray(parsed?.action_list)
                    ? parsed.action_list
                    : [];

            const actionList = rawActions
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0);

            return {
                outletId: outletFromCookie && outletFromCookie.trim().length > 0 ? outletFromCookie.trim() : null,
                actionList,
                employeeId: empId,
                token: typeof parsed?.token === 'string' && parsed.token.trim().length > 0 ? parsed.token : null,
            };
        } catch {
            return { outletId: null, actionList: [], employeeId: null, token: null };
        }
    }

    // Fallback to reading from localStorage in client context.
    try {
        const raw = window.localStorage.getItem('authUser');
        if (!raw) {
            return { outletId: null, actionList: [], employeeId: null, token: null };
        }

        const parsed = JSON.parse(raw) as {
            outlet_id?: unknown;
            outletId?: unknown;
            actions_set?: unknown;
            action_list?: unknown;
            employeeId?: unknown;
            token?: unknown;
        };

        const empId = typeof parsed?.employeeId === 'string' ? parsed.employeeId : null;

        const outletFromStorage =
            typeof parsed?.outlet_id === 'string'
                ? parsed.outlet_id
                : typeof parsed?.outletId === 'string'
                    ? parsed.outletId
                    : null;

        const rawActions = Array.isArray(parsed?.actions_set)
            ? parsed.actions_set
            : Array.isArray(parsed?.action_list)
                ? parsed.action_list
                : [];

        const actionList = rawActions
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);

        return {
            outletId: outletFromStorage && outletFromStorage.trim().length > 0 ? outletFromStorage.trim() : null,
            actionList,
            employeeId: empId,
            token: typeof parsed?.token === 'string' && parsed.token.trim().length > 0 ? parsed.token : null,
        };
    } catch {
        return { outletId: null, actionList: [], employeeId: null, token: null };
    }
};

// The admin-selected active outlet (web outlet switcher), persisted in
// localStorage. Null on the server or when unset. The exported KEY lives in
// '@/lib/outlet' (this is a "use server" file and may only export async fns).
const getSelectedOutletId = (): string | null => {
    try {
        if (typeof window === 'undefined') {return null;}
        const v = window.localStorage.getItem(SELECTED_OUTLET_KEY);
        return v && v.trim().length > 0 ? v.trim() : null;
    } catch {
        return null;
    }
};

const applyEmployeeContextHeaders = async (
    path: string,
    headers: Headers,
    explicitOutletId?: string,
    explicitActionList?: string[],
): Promise<Headers> => {
    if (isRestaurantLoginPath(path)) {
        return headers;
    }

    const fromFrontend = await getFrontendAuthContext();

    // Verified session token: the backend derives tenant/employee/role/actions
    // from this, never from client-supplied identity headers.
    if (fromFrontend.token) {
        headers.set('Authorization', `Bearer ${fromFrontend.token}`);
    }

    // Outlet selection stays a header (admins/managers may target an outlet
    // within their own restaurant); the server authorizes it against the session.
    // Precedence: a per-call override > the admin's outlet switcher choice
    // (localStorage when this runs in the browser, the mirrored cookie when it
    // runs as a Server Action) > the session's home outlet.
    const switcherChoice = getSelectedOutletId() ?? (await getSelectedOutletFromCookie());
    const finalOutletId =
        (typeof explicitOutletId === 'string' && explicitOutletId.trim().length > 0
            ? explicitOutletId.trim()
            : switcherChoice ?? fromFrontend.outletId) ?? null;
    if (finalOutletId) {
        headers.set('X-Outlet-Id', finalOutletId);
    }

    return headers;
};

const headersForRestaurant = async (
    path: string,
    restaurantId: string,
    headers?: HeadersInit,
    outletId?: string,
    actionList?: string[],
): Promise<Headers> => {
    const merged = new Headers(headers);
    // Tenant is derived from the session token, not X-Restaurant-Id.
    return applyEmployeeContextHeaders(path, merged, outletId, actionList);
};

const backendJson = async <T>(
    path: string,
    restaurantId: string,
    init?: RequestInit,
): Promise<T | null> => {
    let status = 0;
    try {
        const hdrs = await headersForRestaurant(path, restaurantId, init?.headers);
        const response = await fetch(`${apiBaseUrl()}${path}`, {
            ...init,
            cache: 'no-store',
            headers: hdrs,
        });

        status = response.status;
        if (!response.ok) {
            // A 401 falls through to the expired-session gate below (outside this
            // try/catch) so redirect()'s NEXT_REDIRECT is never swallowed here.
            if (status !== 401) {
                return null;
            }
        } else {
            return (await response.json()) as T;
        }
    } catch (error) {
        console.warn(`Backend request failed for ${path}`, error);
        return null;
    }
    enforceSessionAlive(path, status);
    return null;
};

const backendCall = async (
    path: string,
    restaurantId: string,
    init?: RequestInit,
): Promise<Response | null> => {
    let response: Response;
    try {
        const hdrs = await headersForRestaurant(path, restaurantId, init?.headers);
        response = await fetch(`${apiBaseUrl()}${path}`, {
            ...init,
            headers: hdrs,
        });
    } catch (error) {
        console.warn(`Backend request failed for ${path}`, error);
        return null;
    }
    // Outside the catch so an expired-session redirect isn't swallowed.
    enforceSessionAlive(path, response.status);
    return response;
};

const parseBodyText = async (response: Response): Promise<string> => {
    try {
        return await response.text();
    } catch {
        return '';
    }
};

export const requestBackend = async <T = unknown>(
    params: BackendRequestParams,
): Promise<BackendRequestResult<T>> => {
    const {
        path,
        method,
        restaurantId,
        employeeId,
        outletId,
        actionList,
        headers,
        body,
        baseUrl,
        parseJson = true,
    } = params;

    const finalBaseUrl = serverBaseUrlFrom(baseUrl);
    const mergedHeaders = new Headers(headers);

    // Identity (tenant/employee/role/actions) is carried by the session bearer
    // token attached in applyEmployeeContextHeaders, not by these headers.
    await applyEmployeeContextHeaders(path, mergedHeaders, outletId, actionList);

    const hasBody = body !== undefined;
    if (hasBody && !mergedHeaders.has('Content-Type')) {
        mergedHeaders.set('Content-Type', 'application/json');
    }

    const finalMethod = method ?? (hasBody ? 'POST' : 'GET');
    const requestInit: RequestInit = {
        method: finalMethod,
        headers: mergedHeaders,
    };

    if (hasBody) {
        requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    let response: Response;
    try {
        response = await fetch(`${finalBaseUrl}${path}`, requestInit);
    } catch {
        return {
            ok: false,
            status: 0,
            data: null,
            text: '',
        };
    }

    // Outside the fetch try/catch so an expired-session (401) redirect's
    // NEXT_REDIRECT escapes to Next's router instead of being swallowed. A 403
    // (authenticated but unpermitted) is left to flow through as a normal !ok
    // result so callers can surface the message without logging the user out.
    enforceSessionAlive(path, response.status);

    const text = await parseBodyText(response);

    if (!parseJson) {
        return {
            ok: response.ok,
            status: response.status,
            data: null,
            text,
        };
    }

    if (!text.trim()) {
        return {
            ok: response.ok,
            status: response.status,
            data: null,
            text,
        };
    }

    try {
        return {
            ok: response.ok,
            status: response.status,
            data: JSON.parse(text) as T,
            text,
        };
    } catch {
        return {
            ok: response.ok,
            status: response.status,
            data: null,
            text,
        };
    }
};

export const requestReceptionBackend = async <T = unknown>(
    params: Omit<BackendRequestParams, 'baseUrl'>,
): Promise<BackendRequestResult<T>> => {
    return requestBackend<T>({
        ...params,
        baseUrl: receptionServerBaseUrl(),
    });
};

// The shared refusal reader now lives in `@/lib/error-message` — it READS THE
// BODY instead of answering "Action forbidden" before looking, so the server's
// `details` sentence (the write-off value, who may reprint, which permission is
// missing) reaches the person who was refused. A 403 with no body still reads
// "Action forbidden", which is what this file used to say for all of them.

const mapBooking = (timeZone: string) => (item: any): Booking => ({
    id: String(item.booking_id ?? item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    customer: item.customer_name ?? 'Guest',
    // The booking rows carry no phone number; the id is what lets a screen join
    // against /get-customers to show (and search by) the guest's contact.
    customer_id: typeof item.customer_id === 'string' && item.customer_id ? item.customer_id : null,
    time: formatBookingTime(String(item.booking_date_time ?? ''), timeZone),
    // Raw ISO start — the display `time` is localized text, so keep the machine
    // value for anything that needs the actual window (seating suggestions).
    date_time: typeof item.booking_date_time === 'string' ? item.booking_date_time : null,
    guests: Number(item.number_of_people ?? 0),
    table: item.table_name ?? '',
    // Clubbed reservations hold more than one table; `table_name` stays the
    // primary so older clients keep working. Fall back to the primary alone.
    table_names: Array.isArray(item.table_names)
        ? (item.table_names as unknown[]).filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        : (item.table_name ? [String(item.table_name)] : []),
    source: item.source ?? 'Unknown',
    // Which surface created the booking ("qr", "dashboard", …) — distinct from
    // `source`, which is the channel the guest came through.
    booked_from: typeof item.from === 'string' && item.from ? item.from : null,
    duration_mins: Number(item.duration_mins) > 0 ? Number(item.duration_mins) : null,
    status: item.status ?? (item.active ? 'Arrived' : 'Confirmed'),
    notes: item.notes ?? item.additional_information ?? '',
    deposit: item.deposit && typeof item.deposit === 'object' ? item.deposit : null,
    min_spend: Number(item.min_spend) > 0 ? Number(item.min_spend) : null,
});

const mapCustomer = (item: any): Customer => ({
    customerId: String(item.customer_id ?? item.id ?? ''),
    name: item.name ?? 'Unknown',
    email: item.email ?? '',
    phone: item.phone_number ?? item.phone ?? '',
    totalBookings: Number(item.booking_count ?? 0),
    status: toCustomerStatus(item.has_booking),
    billAmount: Number(item.bill_amount ?? 0),
});

const mapTable = (item: any, index: number): Table => {
    const name = item.table_name ?? `Table-${index + 1}`;
    const capacity = Number(item.capacity ?? 0);
    const safeCapacity = Number.isFinite(capacity) ? capacity : 0;
    // `max_capacity` is the most the table can take with extra chairs. The backend
    // always sends it (coalescing to capacity), but older snapshots/caches may not.
    const maxCapacity = Number(item.max_capacity ?? safeCapacity);
    return {
        id: stableTableId(name, index + 1),
        name,
        capacity: safeCapacity,
        max_capacity: Number.isFinite(maxCapacity) && maxCapacity > 0 ? maxCapacity : safeCapacity,
        status: toTableStatus(item.booked, item.reserved, item.occupied, item.payment_pending),
        qr_token: typeof item.qr_token === 'string' && item.qr_token ? item.qr_token : null,
        order_otp: typeof item.order_otp === 'string' && item.order_otp ? item.order_otp : null,
        // Restaurant-level OTP gate (`require_table_otp`). Older cached snapshots
        // predate the flag, so absent means "off" and the chip stays hidden.
        otp_required: item.otp_required === true,
        // C3 — the SERVER's print ledger for this seating, carried through
        // VERBATIM. `billPrintStateFields` answers null when the row carried
        // none of the keys, which is "this backend was never asked" and is NOT
        // the same as "not printed"; every reader downstream depends on being
        // able to tell those two apart, so nothing is defaulted here.
        bill_print: billPrintStateFields(item),
        // CLIENT ITEM 6 — the next party at a printed table. A backend older than
        // migration 053 maps exactly as before: every row a room table. See
        // src/lib/next-party.ts for who reads these and why the handle, never
        // the display name, is what every request sends.
        ...nextPartyRowFields(item, String(name)),
        // CLIENT ITEMS 1 AND 2 — "a party is seated but has not ordered" and "food
        // is on its way" are different colours on the floor (src/lib/floor-state.ts).
        // Absent on an older server, which reads as "not known" rather than false.
        ...hasOrderField(item),
    };
};

const mapAuditLog = (item: any): AuditLog => ({
    id: String(item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    employee: item.employee ?? 'Unknown',
    action: item.action ?? 'Unknown',
    category: item.category ?? 'General',
    details: item.details ?? '',
    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    // Additive undo metadata from the backend; older payloads simply omit these.
    undoable: item.undoable === true,
    undo_block_reason: typeof item.undo_block_reason === 'string' ? item.undo_block_reason : null,
    undone: item.undone === true,
    undo_log_id: typeof item.undo_log_id === 'string' ? item.undo_log_id : null,
    undo_of: typeof item.undo_of === 'string' ? item.undo_of : null,
});

const mapInventoryItem = (item: any): InventoryItem => ({
    id: String(item.id ?? item.barcode ?? `${Date.now()}`),
    name: String(item.name ?? 'Unnamed Item'),
    category: String(item.category ?? 'General'),
    stock: Math.max(0, Number(item.stock ?? 0)),
    unit: String(item.unit ?? 'pcs'),
    // Rendered as given. The server decides In/Low/Out from the quantity, the
    // unit AND the reorder level; this client deliberately holds no copy of that
    // rule (see the note on InventoryItem).
    status: (item.status as InventoryItem['status']) ?? 'In Stock',
    expiry_date: typeof item.expiry_date === 'string' ? item.expiry_date : null,
    reorder_level: item.reorder_level == null ? null : Number(item.reorder_level),
    reorder_unit: typeof item.reorder_unit === 'string' ? item.reorder_unit : null,
    // Older backends send neither; fall back to "no threshold to explain".
    reorder_applied: item.reorder_applied == null ? null : Number(item.reorder_applied),
    reorder_basis: typeof item.reorder_basis === 'string' ? (item.reorder_basis as InventoryItem['reorder_basis']) : null,
});

const mapMenuItem = (item: any): MenuItem => ({
    id: String(item.id ?? `${Date.now()}`),
    name: String(item.name ?? 'Unnamed Item'),
    price: Number(item.price ?? 0),
    category: String(item.category ?? 'General'),
    // Carry the description-JSON extras through so client-side bulk saves
    // (drag-reorder etc.) round-trip them instead of dropping them.
    image_url: typeof item.image_url === 'string' ? item.image_url : null,
    available: item.available !== false,
    station: typeof item.station === 'string' && item.station ? item.station : null,
    allergens: Array.isArray(item.allergens) ? item.allergens.filter((a: unknown) => typeof a === 'string' && a).map(String) : [],
    // Configurable badge TAGS (ids into the restaurant's badge catalogue). The
    // key is only carried when the dish HAS tags — same discipline as `blurb`
    // above, and for a sharper reason: the backend reads an absent `badges` as
    // "keep the stored tags", so a bulk save (drag-reorder, delete-an-item) made
    // from a snapshot taken before someone tagged dishes elsewhere cannot send
    // [] and wipe them. Untagged items simply omit the key.
    ...(Array.isArray(item.badges) && item.badges.length > 0
        ? { badges: item.badges.filter((b: unknown) => typeof b === 'string' && b).map(String) }
        : {}),
    // Guest-facing description. The key is only carried when there IS one: the
    // backend treats an omitted `blurb` as "keep the stored text", so a bulk save
    // of items that never had a description can't accidentally clear anything.
    ...(typeof item.blurb === 'string' && item.blurb.trim() ? { blurb: item.blurb } : {}),
    recipe: Array.isArray(item.recipe)
        ? item.recipe.map((r: any) => ({
            inventory_id: String(r.inventory_id ?? ''),
            qty: Number(r.qty ?? 0),
            ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}),
        }))
        : [],
});

const mapOrderItem = (item: any) => ({
    id: String(item.id ?? `${Date.now()}`),
    name: String(item.name ?? 'Unnamed'),
    quantity: Math.max(1, Number(item.quantity ?? 1)),
    price: Number(item.price ?? 0),
    orderedAt: String(item.orderedAt ?? new Date().toISOString()),
    note: typeof item.note === 'string' ? item.note : null,
    // KOT station routing + course hold-and-fire (enriched by the backend).
    station: typeof item.station === 'string' && item.station ? item.station : null,
    course_hold: item.course_hold === true,
    fired_at: typeof item.fired_at === 'string' && item.fired_at ? item.fired_at : null,
    // MIGRATION 034 — SERVER-OWNED, READ-ONLY HERE. `nc` decides whether a guest
    // is charged for this line, and it is written by exactly one path
    // (MarkOrderItemNonChargeable), which also writes the ledger row naming the
    // authoriser. The backend strips these three keys off anything a client
    // POSTs, so carrying them through the mapper cannot become a way to comp
    // something — it is the only way a screen can SHOW that a line is already
    // comped, which without it looked identical to a line that was not.
    nc: item.nc === true,
    nc_id: typeof item.nc_id === 'string' && item.nc_id ? item.nc_id : null,
    nc_kind: typeof item.nc_kind === 'string' && item.nc_kind ? item.nc_kind : null,
    // MIGRATION 039 — the price point this line named, stamped server-side by
    // applyMenuPriceFloor. `variation_name` is the label SNAPSHOTTED at order
    // time so a re-printed historical bill still says what the guest saw.
    menu_id: typeof item.menu_id === 'string' && item.menu_id ? item.menu_id : null,
    variation_id: typeof item.variation_id === 'string' && item.variation_id ? item.variation_id : null,
    variation_name: typeof item.variation_name === 'string' && item.variation_name ? item.variation_name : null,
});

/*
  THREE READERS FOR THE FIELDS ADDED BELOW, TAKING `unknown` RATHER THAN `any`.

  The wire row arrives untyped, and the rest of this mapper reads it straight off
  an `any`. These take a typed VIEW of the same object instead, so the new fields
  carry a declared shape and a declared "absent" case rather than whatever the
  server happened to send. Nothing existing changes.
*/

/**
 * The service-clock block, passed through WITHOUT interpretation.
 *
 * Deliberately not validated here: `src/lib/service-clock.ts` is the ONE place
 * allowed to read this shape, and a second validator is the drift the clock
 * exists to end. Absent or null becomes null, and every screen then draws no
 * clock rather than a zero.
 */
const wireServiceClock = (value: unknown): ServiceClock | null =>
    (value === undefined || value === null ? null : (value as ServiceClock));

/**
 * An optional timestamp where ABSENT and NULL mean different things.
 *
 * `undefined` = the backend never sent the field (an older server); `null` = it
 * sent one and there is no instant. `barked_at` needs exactly that distinction:
 * absent means "this server cannot tell us, assume barked", null means "waiting
 * to be barked", and collapsing the two greys out every live ticket on a tenant
 * running an older build.
 */
const wireTimestamp = (value: unknown): string | null | undefined =>
    value === undefined ? undefined : (typeof value === 'string' ? value : null);

/** An optional list of numbers; `undefined` for "the backend sent none". */
const wireNumbers = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value)) { return undefined; }
    const out: number[] = [];
    for (const entry of value as unknown[]) {
        const n = Number(entry);
        if (Number.isFinite(n)) { out.push(n); }
    }
    return out;
};

const mapOrder = (item: any): Order => {
  // A typed view of the SAME object, used only by the fields below.
  const wire = item as Record<string, unknown>;
  return ({
    id: String(item.id ?? `${Date.now()}`),
    table: String(item.table ?? ''),
    customer: String(item.customer ?? 'Guest'),
    order_type: typeof item.order_type === 'string' && item.order_type ? item.order_type : null,
    taken_by_employee_id:
        typeof item.taken_by_employee_id === 'string' ? item.taken_by_employee_id : null,
    taken_by_employee_name:
        typeof item.taken_by_employee_name === 'string' ? item.taken_by_employee_name : null,
    taken_by_employee_role:
        typeof item.taken_by_employee_role === 'string' ? item.taken_by_employee_role : null,
    // prefer flattened payload if provided by backend
    items: Array.isArray(item.items_flattened) ? item.items_flattened.map(mapOrderItem) : Array.isArray(item.items) ? item.items.map(mapOrderItem) : [],
    // flattened list for printing/APC (prefer explicit field)
    items_flattened: Array.isArray(item.items_flattened) ? item.items_flattened.map(mapOrderItem) : Array.isArray(item.items) ? item.items.map(mapOrderItem) : [],
    // split items: prefer explicit items_split from backend; otherwise derive from flattened + status
    items_split: (() => {
        if (Array.isArray(item.items_split)) {
            return item.items_split.map((t: any) => [String(t[0]), Array.isArray(t[1]) ? t[1].map(mapOrderItem) : []]);
        }
        const mapped = Array.isArray(item.items) ? item.items.map(mapOrderItem) : Array.isArray(item.items_flattened) ? item.items_flattened.map(mapOrderItem) : [];
        const status = String(item.status ?? 'Preparing');
        if (status === 'Preparing') {
            return [['Served', []], ['Preparing', mapped]] as [string, any][];
        }
        return [['Served', mapped], ['Preparing', []]] as [string, any][];
    })(),
    subtotal: Number(item.subtotal ?? 0),
    serviceChargePercentage:
        item.serviceChargePercentage === undefined ? undefined : Number(item.serviceChargePercentage),
    taxes: Array.isArray(item.taxes)
        ? item.taxes.map((tax: any) => ({
            id: String(tax.id ?? `${Date.now()}`),
            name: String(tax.name ?? 'Tax'),
            percentage: Number(tax.percentage ?? 0),
        }))
        : undefined,
    applyServiceCharge: Boolean(item.applyServiceCharge),
    total: Number(item.total ?? 0),
    status: (item.status as Order['status']) ?? 'Preparing',
    payment_method: (item.payment_method as PaymentMethod | null | undefined) ?? null,
    payment_proof_screenshot_url:
        typeof item.payment_proof_screenshot_url === 'string' ? item.payment_proof_screenshot_url : null,
    payment_waiter_confirmed_at:
        typeof item.payment_waiter_confirmed_at === 'string' ? item.payment_waiter_confirmed_at : null,
    payment_waiter_confirmed_by:
        typeof item.payment_waiter_confirmed_by === 'string' ? item.payment_waiter_confirmed_by : null,
    payment_admin_approved_at:
        typeof item.payment_admin_approved_at === 'string' ? item.payment_admin_approved_at : null,
    payment_admin_approved_by:
        typeof item.payment_admin_approved_by === 'string' ? item.payment_admin_approved_by : null,
    bill_closed_at: typeof item.bill_closed_at === 'string' ? item.bill_closed_at : null,
    bill_closed_by: typeof item.bill_closed_by === 'string' ? item.bill_closed_by : null,
    bill_id: typeof item.bill_id === 'string' ? item.bill_id : null,
    // Per-order/per-item prep timers (KDS ageing) — passed through verbatim.
    timing: item.timing && typeof item.timing === 'object' ? item.timing : null,
    // When the ticket was placed, and when it last changed. GET /orders returns
    // both; the mapper used to drop them, so no screen could show "ordered at".
    // Pre-existing rows predate the columns and read null — hence the guards.
    created_at: typeof item.created_at === 'string' ? item.created_at : null,
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : null,
    /*
      THE "BARKED" STEP AND THE KOT NUMBERS, WHICH THIS MAPPER USED TO DROP ON
      THE FLOOR.

      GET /orders returns both. Neither was copied out here, so `barked_at`
      arrived as `undefined` — which `isOrderBarked` reads as "already barked" —
      and `kot_nos` as absent, which `kotLabel` reads as "this backend cannot
      tell us". The result: the orders grid's "Not barked" badge could never
      appear and the KOT chip beside a table name never drew, on a screen whose
      code renders both. Two more server fields with no consumer, in the mapper
      every consumer goes through.

      The guards keep the two ABSENT meanings intact: a backend that genuinely
      does not send `barked_at` still yields `undefined` (barked), and one that
      cannot number KOTs still yields `undefined` (draw nothing) rather than an
      empty chip.
    */
    barked_at: wireTimestamp(wire.barked_at),
    kot_nos: wireNumbers(wire.kot_nos),
    /*
      CLIENT ITEM 4 — WHERE A TICKET CAME FROM, AND WHAT A MOVE TOOK OFF IT.
      Passed through as the server shaped them (order_moves.ts
      orderMoveProvenance) — names and quantities only, never a price — and
      ABSENT on an order that never moved, which every screen reads as "draw
      nothing new".
    */
    ...(typeof wire.moved_from === 'string' && wire.moved_from.trim() !== '' ? { moved_from: wire.moved_from.trim() } : {}),
    ...(typeof wire.moved_at === 'string' ? { moved_at: wire.moved_at } : {}),
    ...(typeof wire.emptied_by === 'string' ? { emptied_by: wire.emptied_by } : {}),
    ...(Array.isArray(wire.moved_items) ? { moved_items: wire.moved_items as MovedItem[] } : {}),
    /*
      D2 — THE SERVER'S SERVICE CLOCK, CARRIED VERBATIM.

      `service_clock.ts` on the backend computes "how long has this table been in
      service" ONCE, against the SERVER's clock, and ships it as a number of
      milliseconds plus the instant it was measured at. It exists so the
      dashboard and the owner app cannot report two different durations for the
      same table, and so that a till whose own clock is ten minutes fast does not
      turn a fresh ticket into a ten-minute wait.

      PASSED THROUGH UNVALIDATED ON PURPOSE: `src/lib/service-clock.ts` is the
      one place allowed to interpret this block, and validating it in two places
      is the drift this whole exercise is about. Absent on an older backend, and
      every screen then draws no clock — never a zero.
    */
    service: wireServiceClock(wire.service),
  });
};

const readLocalField = async <T>(restaurantId: string, field: keyof RestaurantData): Promise<T> => {
    const restaurant = ensureLocalRestaurant(restaurantId);
    return deepClone(restaurant.data[field]) as T;
};

const writeLocalField = async (
    restaurantId: string,
    field: keyof RestaurantData,
    value: RestaurantData[keyof RestaurantData],
) => {
    const restaurant = ensureLocalRestaurant(restaurantId);
    restaurant.data[field] = deepClone(value) as never;
};

const addToLocalField = async (
    restaurantId: string,
    field: keyof RestaurantData,
    item: unknown,
) => {
    const restaurant = ensureLocalRestaurant(restaurantId);
    const current = Array.isArray(restaurant.data[field])
        ? (restaurant.data[field] as unknown[])
        : [];
    current.push(item);
    restaurant.data[field] = current as never;
};

// --- User and Restaurant Management ---
export const findRestaurantByName = async (name: string) => {
    const normalized = getRestaurantUsernameFromName(name);
    const direct = name.trim().toLowerCase();

    const local = restaurantStore.get(normalized) ?? restaurantStore.get(direct);
    if (local) {
        const verify = await backendCall(
            "/auth/restaurant-login",
            "",
            { method: 'GET', headers: { 'X-Restaurant-Username': local.data.profile.restaurant_username } },
        );
        if (verify?.ok) {
            return deepClone(local);
        }

        // Remove stale local-only entries that do not exist in backend.
        restaurantStore.delete(normalized);
    }

    const probe = await backendCall("/auth/restaurant-login", normalized, {
        method: 'GET',
        headers: { "X-Restaurant-Username": normalized, "content-type": "application/json" },
    });

    if (!probe?.ok) {
        return null;
    }

    const resp = await probe.json().catch(() => null);

    const created = ensureLocalRestaurant(normalized, name, resp.res_id);
    return deepClone(created);
};

export const findUserInRestaurant = async (restaurantId: string, employeeId: string) => {
    const local = ensureLocalRestaurant(restaurantId);
    const matchedLocal =
        local.users.find((u) => u.employee_id.toLowerCase() === employeeId.toLowerCase()) ?? null;
    if (matchedLocal) {
        return deepClone(matchedLocal);
    }

    const usersResponse = await backendJson<{ users: User[] }>(
        `/restaurant/users?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        {
            method: 'GET',
        },
    );

    if (!usersResponse?.users) {
        return null;
    }

    local.users = usersResponse.users.map((user) => ({ ...user }));
    const matched =
        local.users.find((u) => u.employee_id.toLowerCase() === employeeId.toLowerCase()) ?? null;
    return matched ? deepClone(matched) : null;
};

// Important: This function is not updated to latest changes
export const createRestaurant = async (restaurantName: string, admin: User) => {
    const id = getRestaurantUsernameFromName(restaurantName);
    if (!admin.password) {
        throw new Error('Admin password is required.');
    }

    const response = await backendCall('/auth/register-restaurant', id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            restaurantName,
            adminName: `${admin.emp_Fname ?? ''}${admin.emp_Lname ? ` ${admin.emp_Lname}` : ''}`.trim() || admin.employee_id,
            adminEmployeeId: admin.employee_id,
            password: admin.password,
        }),
    });

    if (!response) {
        throw new Error('Unable to connect to backend while creating restaurant.');
    }

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    const payload = (await response.json().catch(() => null)) as
        | {
            restaurantId?: string;
            restaurantName?: string;
            restaurantUsername?: string;
        }
        | null;

    const persistedId =
        typeof payload?.restaurantId === 'string' && payload.restaurantId.trim().length > 0
            ? payload.restaurantId
            : id;
    const persistedName =
        typeof payload?.restaurantName === 'string' && payload.restaurantName.trim().length > 0
            ? payload.restaurantName
            : restaurantName;

    const persistedUsername =
        typeof payload?.restaurantUsername === 'string' && payload.restaurantUsername.trim().length > 0
            ? payload.restaurantUsername
            : getRestaurantUsernameFromName(persistedName);

    const restaurant: RestaurantRecord = {
        res_id: persistedId,
        res_username: persistedUsername,
        Restaurant_name: persistedName,
        users: [admin],
        data: defaultRestaurantData(persistedName),
    };

    restaurantStore.delete(id);
    restaurantStore.set(persistedId, restaurant);
    return deepClone(restaurant);
};

export const addEmployee = async (restaurantId: string, employee: User, outletId: string, sendee_emp_id: string) => {
    const resp = await backendCall('/restaurant/users', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Outlet-Id': outletId, 'X-Employee-Id': sendee_emp_id },
        body: JSON.stringify(employee),
    });

    // If backend is unreachable, preserve prior offline behavior.
    if (!resp) {
        const restaurant = ensureLocalRestaurant(restaurantId);
        restaurant.users.push(deepClone(employee));
        return { acknowledged: true };
    }

    if (!resp.ok) {
        throw new Error(await readErrorMessage(resp));
    }

    const payload = await resp.json().catch(() => null);
    const created = payload?.user ?? null;
    if (created) {
        const restaurant = ensureLocalRestaurant(restaurantId);
        restaurant.users.push(deepClone(created));
    }

    return { acknowledged: true };
};

export const removeEmployee = async (restaurantUsername: string, restaurantId: string, employeeIdToremove: string, requestingEmployeeID: string, outletID: string) => {
    // Ask backend to remove the employee. Backend expects the restaurant id via header
    const resp = await backendCall('/restaurant/users', restaurantId, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Employee-Id': requestingEmployeeID, 'X-Outlet-Id': outletID },
        body: JSON.stringify({ employeeId: employeeIdToremove }),
    });

    // If backend unreachable, fall back to local-only removal so UI remains consistent offline.
    const restaurant = ensureLocalRestaurant(restaurantUsername, restaurantUsername);
    const removeLocal = () => {
        restaurant.users = restaurant.users.filter((u) => u.employee_id !== employeeIdToremove);

        // Remove references in local orders (taken_by_employee_id/name)
        if (Array.isArray(restaurant.data.orders)) {
            restaurant.data.orders = restaurant.data.orders.map((o) => {
                if ((o as any).taken_by_employee_id === employeeIdToremove) {
                    return {
                        ...o,
                        taken_by_employee_id: null,
                        taken_by_employee_name: null,
                        taken_by_employee_role: null,
                    } as any;
                }
                return o;
            });
        }
    };

    if (!resp) {
        removeLocal();
        return { acknowledged: true };
    }

    if (!resp.ok) {
        throw new Error(await readErrorMessage(resp));
    }

    // On success, update local store to reflect deletion
    try {
        removeLocal();
    } catch (e) {
        // ignore local-update errors
    }

    return { acknowledged: true };
};

// --- Specific Data Accessors ---
// `windowView` maps straight to GET /get-bookings?window= (backend contract):
// "upcoming" (default) = slots still in the future, "past" = ended slots
// (most-recent first), "all" = upcoming then past. Absent/unknown => upcoming,
// so the default call stays byte-identical to the old one.
export const getBookings = async (
    restaurantId: string,
    windowView?: 'upcoming' | 'past' | 'all',
): Promise<Booking[]> => {
    const windowParam = windowView ? `&window=${encodeURIComponent(windowView)}` : '';
    // The display string is a wall clock, so it needs the restaurant's zone.
    // Fetched alongside rather than per-row; a failure just falls back to the
    // default, which is what the backend would have applied anyway.
    const [data, timeZone] = await Promise.all([
        backendJson<any[]>(
            `/get-bookings?restaurantId=${encodeURIComponent(restaurantId)}${windowParam}`,
            restaurantId,
            { method: 'GET' },
        ),
        getRestaurantTimezone(restaurantId).then((tz) => tz || 'Asia/Kolkata').catch(() => 'Asia/Kolkata'),
    ]);

    if (Array.isArray(data)) {
        const mapped = data.map(mapBooking(timeZone));
        // Only the default (upcoming) view is the canonical live set; a past/all
        // snapshot must not overwrite the fallback cache other screens read.
        if (!windowView || windowView === 'upcoming') {
            await writeLocalField(restaurantId, 'bookings', mapped);
        }
        return mapped;
    }

    return readLocalField<Booking[]>(restaurantId, 'bookings');
};

export const getCustomers = async (restaurantId: string): Promise<Customer[]> => {
    const data = await backendJson<any[]>(
        `/get-customers?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapCustomer);
        await writeLocalField(restaurantId, 'customers', mapped);
        return mapped;
    }

    return readLocalField<Customer[]>(restaurantId, 'customers');
};

export const getInventory = async (restaurantId: string): Promise<InventoryItem[]> => {
    const data = await backendJson<any[]>(
        `/inventory?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapInventoryItem);
        await writeLocalField(restaurantId, 'inventory', mapped);
        return mapped;
    }

    return readLocalField<InventoryItem[]>(restaurantId, 'inventory');
};

export const getMenuItems = async (restaurantId: string): Promise<MenuItem[]> => {
    const data = await backendJson<any[]>(
        `/menu?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapMenuItem);
        await writeLocalField(restaurantId, 'menuItems', mapped);
        return mapped;
    }

    return readLocalField<MenuItem[]>(restaurantId, 'menuItems');
};

export const getMenuCategories = async (restaurantId: string): Promise<string[]> => {
    const data = await backendJson<string[]>(
        `/menu/categories?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        await writeLocalField(restaurantId, 'menuCategories', data);
        return data;
    }

    // backendJson answers null for a 500, a 403 and an unreachable backend alike.
    // The only honest fallback is a copy the backend actually returned earlier for
    // this tenant; with none, the answer is "none" and it is said out loud, because
    // a read that failed must never come back looking like the menu.
    const cached = await readLocalField<string[]>(restaurantId, 'menuCategories');
    console.warn(
        `GET /menu/categories failed for ${restaurantId}; serving ${cached.length} cached categor${cached.length === 1 ? 'y' : 'ies'}`,
    );
    return cached;
};

export const getOrders = async (restaurantId: string, station?: string): Promise<Order[]> => {
    // Optional per-zone filter: a locked kitchen display fetches only its own
    // section server-side (the backend trims each order's items to that station).
    // Empty/absent => full set, unchanged. A station-filtered result is a subset,
    // so we deliberately DON'T let it overwrite the full local snapshot cache.
    const stationParam = typeof station === 'string' ? station.trim() : '';
    const query = stationParam
        ? `/orders?restaurantId=${encodeURIComponent(restaurantId)}&station=${encodeURIComponent(stationParam)}`
        : `/orders?restaurantId=${encodeURIComponent(restaurantId)}`;
    const data = await backendJson<any[]>(
        query,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapOrder);
        if (!stationParam) {
            await writeLocalField(restaurantId, 'orders', mapped);
        }
        return mapped;
    }

    return readLocalField<Order[]>(restaurantId, 'orders');
};

// --- Orders scope (why is this grid empty?) ---------------------------------
// GET /orders is deliberately scoped to ONE outlet, and old settled orders drop
// out of the live grid after `live_window_days`. Both are correct, and both made
// an empty grid look like data loss. This companion endpoint reports what the
// current scope is and how many live orders sit on the OTHER outlets, so the UI
// can explain itself and offer a one-click switch instead of a blank table.
export interface OrdersScopeOutlet {
    outlet_id: string;
    outlet_name: string;
    live_orders: number;
    tables: number;
    is_current: boolean;
}
export interface OrdersScope {
    outlet: { id: string; name: string };
    is_all_outlets: boolean;
    /** Count for the CURRENT scope — always equals getOrders()'s length. */
    live_orders: number;
    /** Live orders on OTHER outlets of this restaurant. 0 in all-outlets mode. */
    other_outlet_orders: number;
    outlets: OrdersScopeOutlet[];
    /** Settled orders older than this many days leave the live grid (History keeps them). */
    live_window_days: number;
    /** A guest/QR order lands on the TABLE's outlet — false means it can never arrive here. */
    current_outlet_has_tables: boolean;
}

export const getOrdersScope = async (restaurantId: string): Promise<OrdersScope | null> =>
    backendJson<OrdersScope>(
        `/orders/scope?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

export const getTables = async (restaurantId: string): Promise<Table[]> => {
    const data = await backendJson<any[]>(
        `/get-tables?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map((row, index) => mapTable(row, index));
        await writeLocalField(restaurantId, 'tables', mapped);
        return mapped;
    }

    return readLocalField<Table[]>(restaurantId, 'tables');
};

/** Mirrors the backend's TableAssignmentOutcome (database_supabase.ts): what a
 *  seating did about the table's waiter, and — when it assigned nobody — why.
 *  `assigned: false` with an `employee_id` means someone else already had the
 *  table and was kept; `assigned: false` with a null `employee_id` means the
 *  table has NO waiter, which is the case a human needs to be told about.
 *
 *  The TYPE stays here (types are erased before Next inspects this "use server"
 *  module, so they are legal); the synchronous `seatingLeftTableUnattended`
 *  predicate that reads it lives in ./table-assignment, because a Server Actions
 *  file may export only async functions and a plain `export const` there fails
 *  the BUILD — invisibly to tsc and jest, while every page that imports db.ts
 *  goes down with it. */
export interface TableAssignmentOutcome {
    assigned: boolean;
    reason: 'assigned' | 'already_assigned' | 'unknown_employee' | 'not_clocked_in' | 'no_actor' | 'error';
    employee_id: string | null;
    employee_name: string | null;
    message: string;
}

export interface OccupyTableResult {
    acknowledged: true;
    table_id?: string;
    is_occupied?: boolean;
    num_covers?: number;
    linked_order_id?: string | null;
    /** null when the call was not a seating at all — the order flow re-occupies
     *  an already-occupied table around every save, and that has no opinion
     *  about the waiter. */
    assignment: TableAssignmentOutcome | null;
}

export const occupyTable = async (restaurantId: string, tableName: string, numCovers?: number | null, linkedOrderId?: string | null): Promise<OccupyTableResult> => {
    const payload: any = { table_name: tableName };
    if (typeof numCovers === 'number' && numCovers >= 1) {payload.num_covers = numCovers;}
    if (typeof linkedOrderId === 'string' && linkedOrderId.trim().length > 0) {payload.order_id = linkedOrderId;}

    const response = await backendCall('/occupy-table', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (response?.ok) {
        // The body was being thrown away in favour of `{acknowledged:true}`. It
        // carries `assignment` — who this seating credited, or why nobody — which
        // the host has to see at the moment of seating; it also carries
        // linked_order_id, which the orders page has been "sanity checking" for
        // on an object that could never contain it.
        let body: Partial<OccupyTableResult> | null = null;
        try { body = (await response.json()) as Partial<OccupyTableResult>; } catch { body = null; }

        await getTables(restaurantId);
        // notify other UI parts (Tables page) that table data changed
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('tables:changed'));
            }
        } catch {
            // ignore
        }
        return {
            acknowledged: true,
            table_id: body?.table_id,
            is_occupied: body?.is_occupied,
            num_covers: body?.num_covers,
            linked_order_id: body?.linked_order_id ?? null,
            assignment: body?.assignment ?? null,
        };
    }

    throw new Error(response ? await readErrorMessage(response) : 'Unable to occupy table');
};

export const updateTableCovers = async (restaurantId: string, tableName: string, numCovers: number) => {
    const response = await backendCall('/table-covers', restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableName, num_covers: numCovers }),
    });

    if (response?.ok) {
        await getTables(restaurantId);
        return { acknowledged: true };
    }

    throw new Error(response ? await readErrorMessage(response) : 'Unable to update table covers');
};

/**
 * A REFUSAL THAT SURVIVES THE SERVER-ACTION BOUNDARY.
 *
 * This module is "use server", and Next REDACTS the message of an Error thrown
 * across that boundary in production — the same fact that made `signInEmployee`
 * return its failure instead of throwing it (see services/authService.ts). So a
 * refusal reaching this file as a carefully worded sentence still arrives at the
 * browser as "An unexpected response was received from the server."
 *
 * Reading the body in `readErrorMessage` is therefore only HALF of getting the
 * sentence to a human: the route that can be refused has to RETURN it. These
 * two acts are the ones a refusal can currently land on in this app — releasing
 * a table that still owes money, and discounting an open bill — and they are
 * the ones whose 403 bodies carry a figure or a permission name worth reading.
 *
 * The SHAPE and its type guard live in `@/lib/error-message` — a "use server"
 * module may only export async functions, so a type guard cannot live here.
 */
export type ReleaseTableResult = { acknowledged: true } | RefusedAction;

/**
 * Release a table. A 403 comes back as a RefusedAction carrying the server's
 * sentence (which names the rupee value the release would have written off),
 * NOT as a thrown Error whose message production would strip.
 */
export const releaseTable = async (restaurantId: string, tableName: string): Promise<ReleaseTableResult> => {
    const response = await backendCall('/release-table', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableName }),
    });

    if (response?.ok) {
        await getTables(restaurantId);
        return { acknowledged: true };
    }

    if (response && (response.status === 403 || response.status === 409)) {
        return { refused: true, status: response.status, error: await readErrorMessage(response) };
    }

    throw new Error(response ? await readErrorMessage(response) : 'Unable to release table');
};

// --- C3: claiming the ONE print a waiter gets -------------------------------
//
// THE HOLE THIS CLOSES. The dashboard's Print Bill stored a payload in
// localStorage and opened /dashboard/orders/print, which calls window.print().
// It told the SERVER NOTHING. So C3 — "a waiter may print the bill once" — was
// enforced on the thermal path (POST /print/bill 403s a waiter's second print)
// and completely unenforced here: the same waiter, on the same floor, printed
// unlimited copies from the laptop. A rule with a hole this size in it is worse
// than no rule, because the restriction is visible and is therefore trusted.
//
// So the print is CLAIMED SERVER-SIDE FIRST and the print page is opened only if
// the claim succeeded. The claim is the control; hiding the button is the
// courtesy in front of it.
//
// IT IS CLAIMED FOR EVERY ROLE, NOT ONLY FOR WAITERS. POST /print/bill counts
// every print regardless of who made it, and the count is what the whole rule
// reads; claiming only for waiters would mean a manager's print left no trace
// and the next waiter's first copy was treated as the first copy of the bill. A
// senior identity is not REFUSED by the claim — that is the backend's job and it
// refuses nobody but a waiter-only session with a printed bill — so "non-waiter
// roles are completely unaffected" still holds: same control, same presses, no
// new failure mode.

/** What POST /print/bill/claim answered. `unavailable` is not a refusal — see below. */
export type BillPrintClaimResult =
    // `printableBill` is the SERVER'S PRICED BILL for this seating. A waiter's own
    // read of /bill-for-table is redacted by C4, so without this the print page has
    // no amounts and refuses — which is how no waiter on the web could ever print.
    // `nextParty` (client item 6): the seat the server opened, or found, for the
    // next guests at this number — both null when there is none.
    // `revisedNote` (client items 1 and 2): this print replaces out-of-date
    // paper — the line under "** UPDATED BILL **", in the server's words — or
    // null when it replaces nothing. `paperJobId`: the claim's own ledger row, which
    // the print page names if it also sends this paper to a thermal printer.
    | { outcome: 'claimed'; state: BillPrintState | null; printableBill: Record<string, unknown> | null; nextParty: { table: string | null; message: string | null }; revisedNote: string | null; paperJobId: string | null }
    | { outcome: 'unavailable'; reason: string }
    | { outcome: 'refused'; status: number; message: string; reprintNeedsSenior: boolean; state: BillPrintState | null };

/**
 * Claim this table's one bill print.
 *
 * WHY THE RESULT IS RETURNED AND NOT THROWN: this module is "use server", and
 * Next REDACTS the message of an Error thrown across that boundary in a
 * production build. The refusal's whole value is its sentence — the backend's
 * `details` already names who may reprint instead — so it has to come back as a
 * value, exactly as `releaseTable`'s does.
 *
 * WHICH WAY IT FAILS, AND WHY THAT IS THE SAFE WAY.
 *
 *   * 403 with `reprint_needs_senior` → REFUSED. The print page is not opened
 *     and the server's sentence goes in front of the person who pressed it.
 *   * 404, or the backend unreachable → `unavailable`, and the caller PRINTS
 *     ANYWAY. The dashboard and the API deploy on separate pipelines and the
 *     API's can be held back (its deploy gate refuses to ship any commit while a
 *     migration is pending, which is correct but means the WEB can be a release
 *     ahead of the route). Refusing every print on a backend that has not got
 *     the route yet would take billing away from an entire restaurant to enforce
 *     a rule that backend does not have; and the button-hiding half still works
 *     there, because it reads `print_count` off /get-tables, which that backend
 *     does send.
 *   * 400 "Nothing to print for this table" → `unavailable` as well, and this
 *     is the SETTLED-BILL path rather than an error. The route reads the table's
 *     OPEN bill; once a sitting is settled there is none, so a senior reprinting
 *     a closed bill from the orders list gets this 400 every time. The print
 *     page resolves that document from GetClosedBill by the order's own bill id
 *     and prints it, which is what should happen — a settled bill is a tax
 *     document that is reprinted from what was recorded, not re-claimed.
 *   * any other failure → `unavailable` for the same reason. ONLY AN EXPLICIT
 *     403 REFUSES. This mirrors the backend's own stated direction in
 *     bill_print_state.ts: a guest waiting with no way to get a bill is a worse
 *     outage than a second copy of one.
 *
 * MIGRATION 027 MAY NOT BE APPLIED, and the route says so itself: it answers
 * `recorded: false` with the counts UNCHANGED rather than optimistically
 * incremented. That arrives here as a perfectly ordinary `claimed`, with a state
 * whose `print_count` has not moved — so the button stays, which is exactly
 * right: reporting a count the ledger does not hold is how a client disables a
 * control the server would still allow.
 */
export const claimBillPrint = async (
    restaurantId: string,
    tableName: string,
    orderId?: string | null,
): Promise<BillPrintClaimResult> => {
    const payload: Record<string, unknown> = { table_name: tableName, kind: 'bill' };
    if (typeof orderId === 'string' && orderId.trim().length > 0) { payload.order_id = orderId.trim(); }

    const response = await backendCall('/print/bill/claim', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response) {
        return { outcome: 'unavailable', reason: 'The backend could not be reached to record the print.' };
    }

    // Read the body ONCE — a Response body can only be consumed once, and the
    // refusal needs both the sentence and the print-state fields off the same
    // object (see error-message.ts for the "body stream already read" bug this
    // avoids repeating).
    let text = '';
    try { text = await response.text(); } catch { text = ''; }
    let body: unknown = null;
    try { body = text.trim() ? JSON.parse(text) : null; } catch { body = null; }

    if (response.ok) {
        const printable = (body as { printable_bill?: unknown } | null)?.printable_bill;
        return {
            outcome: 'claimed',
            state: billPrintStateFields(body),
            // Only an object is a bill. A backend older than this change sends
            // nothing, which lands as null and the print page falls back to its
            // own read exactly as before — correct for a senior, and for a waiter
            // no worse than the refusal they already got.
            printableBill: printable && typeof printable === 'object' && !Array.isArray(printable)
                ? (printable as Record<string, unknown>)
                : null,
            nextParty: nextPartyAfterPrint(body),
            revisedNote: billRevisedNoteOf(body),
            paperJobId: billPaperJobIdOf(body),
        };
    }

    const refusal = billPrintRefusal(body);
    if (refusal) {
        return {
            outcome: 'refused',
            status: response.status,
            message: refusal.message,
            reprintNeedsSenior: true,
            state: refusal.state,
        };
    }

    // A 403 that is NOT the print-once refusal is still a refusal — an identity
    // without the print action at all. Surfaced with the server's own sentence.
    if (response.status === 403) {
        return {
            outcome: 'refused',
            status: 403,
            message: refusalSentence(body) ?? 'Action forbidden',
            reprintNeedsSenior: false,
            state: null,
        };
    }

    // 404 (route not deployed yet), 5xx, or anything else: see the docblock.
    return {
        outcome: 'unavailable',
        reason: refusalSentence(body) ?? `The print could not be recorded (status ${String(response.status)}).`,
    };
};

// --- D3 / D4: moving a live party, and moving one mis-keyed ticket ----------
//
// Both routes are atomic, permission-gated and tested server-side; the whole of
// what was missing was a way to reach them from the web. Neither is idempotent()
// and neither is queueable offline, deliberately — routes/tables.ts argues both
// at length — so these are plain online calls with no retry of their own. A
// replay would bounce off "T1 is not seated" having changed nothing, which is
// the safety property that makes a dedup key unnecessary rather than a nicety
// worth adding.

/** What POST /tables/move answered. Shapes quoted from MoveTableParty. */
export interface MoveTablePartyResult {
    from_table: string;
    to_table: string;
    covers: number;
    moved_orders: number;
    moved_bill: boolean;
    /** Client items 1 and 2: the party's bill had been printed; its paper came with them. Absent on an older server. */
    printed?: boolean;
    /** The table name on that paper ("12"), when known. */
    printed_as?: string | null;
    /** The green seat the server opened for the next guests at the destination. */
    next_party_table?: string | null;
    next_party_message?: string | null;
}

/**
 * Move the WHOLE party — guests, covers, every order, the running bill, the
 * waiter and the booking — from one table to another, in one server
 * transaction.
 *
 * ONE CALL, NEVER A SEQUENCE. A party half-moved is worse than a party not
 * moved: their orders on one table and their seating on another means the bill
 * splits, the floor lies about who is sitting where, and the covers behind APC
 * are counted against a table nobody is at. The server does the whole thing
 * atomically and this client never issues a partial sequence of its own.
 *
 * A REFUSAL COMES BACK AS A VALUE for the Server-Action redaction reason
 * `releaseTable` documents. The server answers 400 with a sentence naming what
 * stopped it ("T7 is occupied — use Merge to put two parties on one bill"), and
 * that sentence is the entire value of the response.
 */
export const moveTableParty = async (
    restaurantId: string,
    fromTable: string,
    toTable: string,
): Promise<MoveTablePartyResult | RefusedAction> => {
    const response = await backendCall('/tables/move', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_table: fromTable, to_table: toTable }),
    });

    if (response?.ok) {
        const moved = (await response.json()) as MoveTablePartyResult;
        // BOTH tables changed, so the cached roster has to. No `tables:changed`
        // event from here: the only caller is a client component that reloads
        // the floor AND the orders behind the service clocks itself, which is
        // more direct than a DOM event fired out of a "use server" module.
        await getTables(restaurantId);
        return moved;
    }

    if (response) {
        return { refused: true, status: response.status, error: await readErrorMessage(response, 'Unable to move the party.') };
    }
    throw new Error('Unable to move the party');
};

/** What POST /tables/move-order answered, including what the KITCHEN was told. */
export interface MoveOrderToTableResult {
    order_id: string;
    from_table: string;
    to_table: string;
    /** Client item 4: every dish on the moved ticket (name, size, quantity — never a price). */
    items?: { name: string; variation: string | null; quantity: number }[];
    /** The KOT the pass calls it by, when there is one. */
    kot_no?: number | null;
    /** A move changes two bills: the reprint(s) a senior role is asked for. */
    reprint_needed?: boolean;
    reprint_table?: string;
    reprint_message?: string;
    also_reprint_needed?: boolean;
    also_reprint_table?: string;
    also_reprint_message?: string;
    /**
     * The correction docket. `printed: false` is NOT a failure — it means the
     * kitchen never had a ticket for this order, so there is no paper on the
     * pass to correct and the ordinary trigger will print it at the right table
     * later. The distinction has to reach the screen: "KOT-26 reprinted for T7"
     * and "nothing was printed" are different things to go and tell the pass.
     */
    print?: { printed?: boolean; kot_no?: number | string | null } | null;
}

/**
 * Move ONE order (and its KOT) to the table it should have been rung in on.
 *
 * THIS IS NOT A PARTY MOVE. The party at the source table stays exactly where
 * they are; only the ticket leaves. The server preserves the KOT NUMBER and
 * reprints a table-change docket carrying it, so the pass can pair the
 * correction with the paper it replaces — the half that cannot be skipped,
 * because a move that leaves stale paper on the pass makes the system and the
 * paper disagree about where food is going, and now nobody is looking for it.
 */
export const moveOrderToTable = async (
    restaurantId: string,
    orderId: string,
    toTable: string,
): Promise<MoveOrderToTableResult | RefusedAction> => {
    const response = await backendCall('/tables/move-order', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, to_table: toTable }),
    });

    if (response?.ok) {
        const moved = (await response.json()) as MoveOrderToTableResult;
        await getTables(restaurantId);
        return moved;
    }

    if (response) {
        return { refused: true, status: response.status, error: await readErrorMessage(response, 'Unable to move that order.') };
    }
    throw new Error('Unable to move that order');
};

// --- Seating: per-table max, and the club-two-tables suggester ---------------
// PATCH /table/:name — edit an existing table's seat counts. Both fields are
// optional; the backend clamps max_capacity UP to capacity and returns what it
// actually stored.
export const updateTableSeating = async (
    restaurantId: string,
    tableName: string,
    seats: { capacity?: number; max_capacity?: number },
): Promise<{ table_name: string; capacity: number; max_capacity: number }> => {
    const response = await backendCall(`/table/${encodeURIComponent(tableName)}`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seats),
    });

    if (!response?.ok) {
        throw new Error(response ? await readErrorMessage(response) : 'Unable to update table');
    }

    const updated = (await response.json()) as { table_name: string; capacity: number; max_capacity: number };
    await getTables(restaurantId);
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tables:changed'));
        }
    } catch {
        // ignore
    }
    return updated;
};

export interface SeatingSuggestionTable {
    table_id: string;
    table_name: string;
    capacity: number;
    max_capacity: number;
}

export interface SeatingCombination {
    table_ids: string[];
    table_names: string[];
    total_capacity: number;
    adjacent: boolean;
}

export interface SeatingSuggestion {
    party: number;
    at: string;
    duration_mins: number;
    /** Free tables that seat the party on their own, smallest-first. */
    single: SeatingSuggestionTable[];
    /** Consecutively-numbered free tables that together seat the party. */
    combinations: SeatingCombination[];
    /** Every free table — for a manual staff override. */
    free_tables: SeatingSuggestionTable[];
    /** Free but un-clubbable (no number in the name). */
    unnumbered_free_tables: string[];
    /** Set only when nothing fits; show it verbatim. */
    none_reason: string | null;
}

// GET /tables/seating-suggestion — SUGGESTS ONLY, never assigns. Returns null
// when the backend refuses (e.g. the employee lacks the assign-tables action).
export const getSeatingSuggestion = async (
    restaurantId: string,
    opts: { party: number; at?: string | null; durationMins?: number },
): Promise<SeatingSuggestion | null> => {
    const qs = new URLSearchParams({ restaurantId });
    qs.set('party', String(Math.max(1, Math.round(opts.party))));
    if (opts.at) {qs.set('at', opts.at);}
    if (typeof opts.durationMins === 'number' && opts.durationMins > 0) {
        qs.set('duration', String(Math.round(opts.durationMins)));
    }

    return backendJson<SeatingSuggestion>(
        `/tables/seating-suggestion?${qs.toString()}`,
        restaurantId,
        { method: 'GET' },
    );
};

// PATCH /booking/:id/table — set the primary table and, optionally, the clubbed
// extras. Passing [] un-clubs; omitting the key leaves the existing set alone.
export const assignBookingTables = async (
    restaurantId: string,
    bookingId: string,
    tableName: string,
    combinedTableNames?: string[],
) => {
    const payload: Record<string, unknown> = { table_name: tableName };
    if (Array.isArray(combinedTableNames)) {payload.combined_table_names = combinedTableNames;}

    const response = await backendCall(`/booking/${encodeURIComponent(bookingId)}/table`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response?.ok) {
        throw new Error(response ? await readErrorMessage(response) : 'Unable to assign tables');
    }

    return { acknowledged: true };
};

export const getTableStatus = async (restaurantId: string, tableName: string) => {
    return backendJson<any>(
        `/table-status?table_name=${encodeURIComponent(tableName)}`,
        restaurantId,
        { method: 'GET' },
    );
};

export const getBillForTable = async (restaurantId: string, tableName: string) => {
    const response = await backendCall(`/bill-for-table?table_name=${encodeURIComponent(tableName)}`, restaurantId, {
        method: 'GET',
    });
    if (!response?.ok) {return null;}
    try { return await response.json(); } catch { return null; }
};

// --- Closed bills -----------------------------------------------------------
// GET /bills/closed and /bills/closed/:id, both gated by the existing "View Bill"
// action. `/bill-for-table` only ever returns the OPEN bill, so these two reads
// are the only way to browse or re-open a settled one.

export interface ClosedBillItem {
    name: string; price: number; quantity: number; note: string | null;
    /** 0 on a comped line — what the guest was charged for it. */
    line_total: number;
    /**
     * Backend migration 034: this line was comped. Its own line (the server
     * keys the merge on it), printed "<name> (NC)" at 0.00. Absent otherwise.
     */
    nc?: boolean;
}
export interface BillTaxLine { name: string; percentage: number; amount: number }

export interface ClosedBillSummary {
    id: string;
    bill_no: string | null;
    status: number;
    table_id: string | null;
    table_name: string | null;
    covers: number | null;
    grand_total: number;
    // Genuine tax only — a "Service Charge" line stored inside the tax breakdown
    // is lifted out into service_charge by the backend, so it is never counted
    // twice. INVARIANT: taxable_base + service_charge + tax_total + round_off
    // === grand_total.
    tax_total: number;
    taxable_base: number;
    service_charge: number;
    service_charge_percent: number;
    /**
     * Backend migration 048: what rounded the settled total to the rupee. 0 on a
     * bill settled before rounding; optional because an older backend sends no
     * key. Read it through roundOffOf (lib/bill-round-off.ts).
     */
    round_off?: number;
    payment_method: string | null;
    payment_splits: PaymentSplit[];
    discount_type: 'percent' | 'flat' | null;
    discount_value: number;
    // null in the LIST read (it cannot size a percent discount without the
    // pre-discount subtotal); always a number in the detail read.
    discount_amount: number | null;
    coupon_code: string | null;
    refunded: boolean;
    refund_amount: number;
    apc: number | null;
    created_at: string;
    closed_at: string | null;
    admin_approved_at: string | null;
    settled_at: string | null;
    closed_by: string | null;
    admin_approved_by: string | null;
    waiter_confirmed_by: string | null;
}

export interface ClosedBillDetail extends ClosedBillSummary {
    items: ClosedBillItem[];
    order_ids: string[];
    orders: { id: string; created_at: string; status: string; subtotal: number; item_count: number }[];
    items_subtotal: number;
    discount_amount: number;
    discounted_subtotal: number;
    taxes: BillTaxLine[];
    target_apc: number;
    customer: string | null;
    /**
     * R2 item 1 — the corporate party's GSTIN. Optional because a backend older
     * than the field sends no key at all, which the UI reads as "not supported
     * here" rather than as "no GSTIN".
     */
    customer_gstin?: string | null;
    seated_at: string | null;
    left_at: string | null;
    waiter_confirmed_at: string | null;
    refunded_at: string | null;
    refunded_by: string | null;
    refund_reason: string | null;
    refund_ref: string | null;
    payment_proof_screenshot_url: string | null;
    reason: string | null;
    created_by: string | null;
    // false when the reconstructed line items don't add up to the stored total
    // (an item was edited after settlement, say) — the UI warns instead of lying.
    totals_reconciled: boolean;
    /*
      D2 ON A FINISHED SERVICE — the same clock the live table showed, frozen at
      the settle and measured by the SERVER, so History and the floor report one
      duration for one table instead of two. Optional: a backend older than
      `service_clock.ts` sends none, and the fact is simply not drawn.
    */
    service?: ServiceClock | null;
    /** Backend migration 034: the menu value of the comped lines. Beside the ladder, never in it. Optional: older backends. */
    nc_total?: number;
    /** Set on a bill SETTLED AS NC (payment_method 'NC', migration 052): how, why and on whose say-so. */
    nc_settlement?: ClosedBillNcSettlement | null;
}

/** How a closed NC bill was settled — GetClosedBill's `nc_settlement`. */
export interface ClosedBillNcSettlement {
    kind: string;
    kind_label: string;
    authorised_by: string;
    marked_by: string;
    reason: string;
    lines: number;
    value: number;
    /** What the guest would have paid. Information only, and null when unknown. */
    would_have_charged: number | null;
}

export interface ClosedBillPage {
    bills: ClosedBillSummary[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export interface ClosedBillFilter {
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
    table?: string;
    payment_method?: string;
    search?: string;
}

// Paged, newest settled first. Returns null when the backend is unreachable or
// refuses — an empty page is a real "no bills", so the two must stay separable
// or the UI would report an outage as "no results".
export const getClosedBills = async (restaurantId: string, opts: ClosedBillFilter = {}): Promise<ClosedBillPage | null> => {
    const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const qs = new URLSearchParams({ restaurantId });
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (opts.from) {qs.set('from', opts.from);}
    if (opts.to) {qs.set('to', opts.to);}
    if (opts.table) {qs.set('table', opts.table);}
    if (opts.payment_method) {qs.set('payment_method', opts.payment_method);}
    if (opts.search) {qs.set('search', opts.search);}

    const data = await backendJson<Partial<ClosedBillPage>>(`/bills/closed?${qs.toString()}`, restaurantId, { method: 'GET' });
    if (!data || !Array.isArray(data.bills)) {return null;}
    return {
        bills: data.bills,
        total: Number(data.total ?? data.bills.length),
        limit,
        offset,
        has_more: data.has_more === true,
    };
};

// null on 404 / unreachable backend — the caller shows "couldn't load" rather
// than a half-empty bill.
export const getClosedBill = async (restaurantId: string, billId: string): Promise<ClosedBillDetail | null> => {
    if (!billId) {return null;}
    return backendJson<ClosedBillDetail>(
        `/bills/closed/${encodeURIComponent(billId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
};

// --- Open (unsettled) bills --------------------------------------------------
// GET /bills/open, the complement of /bills/closed and behind the same "View
// Bill" action. Everything else in accounting reads SETTLED bills, so this is the
// only place "who owes me money right now" is answerable.
//
// The money is fully computed server-side and obeys the same invariant as a
// settled bill — taxable_base + service_charge + tax_total + round_off === grand_total, with
// a "Service Charge" entry lifted out of the tax breakdown. Do not recompute it
// here: an un-confirmed bill's stored total_amt is the PRE-TAX subtotal, and the
// backend is what knows the difference.

export interface OpenBillSummary {
    id: string;
    bill_no: string | null;
    status: number;
    table_id: string | null;
    table_name: string | null;
    covers: number | null;
    order_count: number;
    grand_total: number;
    taxable_base: number;
    service_charge: number;
    service_charge_percent: number;
    taxes: BillTaxLine[];
    tax_total: number;
    /** Backend migration 048 — the fourth rung of the invariant above. */
    round_off?: number;
    discount_type: 'percent' | 'flat' | null;
    discount_value: number;
    coupon_code: string | null;
    apc: number | null;
    // 'running' = still being added to; 'awaiting_approval' = the waiter has taken
    // payment and an admin must approve it; 'approved' = momentary, approval
    // closes the bill in the same transaction.
    stage: 'running' | 'awaiting_approval' | 'approved';
    totals_snapshotted: boolean;
    payment_method: string | null;
    opened_by: string | null;
    opened_at: string;
    opened_at_local: string;
    age_minutes: number;
}

export interface OpenBillPage {
    bills: OpenBillSummary[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    // Across EVERY open bill, not just this page — the figure an owner reacts to.
    outstanding_total: number;
    // 6.4 — tables with an open bill OR still-owing orders (a table with sent
    // KOTs and no bill yet is running), and what they owe. NULL when the server
    // did not send it: a backend older than the field, or `running_total` for a
    // waiter-only session, whose money the server withholds. Never coerced to 0 —
    // see live-gross.ts.
    running_tables: number | null;
    running_total: number | null;
    timezone: string;
}

// null on an unreachable/refusing backend, so the UI can tell an outage apart
// from a genuinely empty floor (same contract as getClosedBills).
export const getOpenBills = async (
    restaurantId: string,
    opts: { limit?: number; offset?: number } = {},
): Promise<OpenBillPage | null> => {
    const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const qs = new URLSearchParams({ restaurantId });
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));

    const data = await backendJson<Partial<OpenBillPage>>(`/bills/open?${qs.toString()}`, restaurantId, { method: 'GET' });
    if (!data || !Array.isArray(data.bills)) {return null;}
    return {
        bills: data.bills,
        total: Number(data.total ?? data.bills.length),
        limit,
        offset,
        has_more: data.has_more === true,
        outstanding_total: Number(data.outstanding_total ?? 0),
        running_tables: typeof data.running_tables === 'number' ? data.running_tables : null,
        running_total: typeof data.running_total === 'number' ? data.running_total : null,
        timezone: String(data.timezone ?? ''),
    };
};

export const getAuditLogs = async (
    restaurantId: string,
    opts: { limit?: number; offset?: number; category?: string; search?: string; from?: string; to?: string } = {},
): Promise<AuditLog[]> => {
    const qs = new URLSearchParams({ restaurantId });
    qs.set('limit', String(Math.max(1, opts.limit ?? 100)));
    if (opts.offset) {qs.set('offset', String(opts.offset));}
    if (opts.category && opts.category !== 'All') {qs.set('category', opts.category);}
    if (opts.search) {qs.set('search', opts.search);}
    if (opts.from) {qs.set('from', opts.from);}
    if (opts.to) {qs.set('to', opts.to);}
    const filtered = Boolean((opts.category && opts.category !== 'All') || opts.search || opts.from || opts.to || opts.offset);

    const data = await backendJson<any[]>(`/audit-logs?${qs.toString()}`, restaurantId, { method: 'GET' });

    if (Array.isArray(data)) {
        const mapped = data.map(mapAuditLog);
        // Only cache the full (unfiltered) list so a filtered fetch never clobbers it.
        if (!filtered) {await writeLocalField(restaurantId, 'auditLogs', mapped);}
        return mapped;
    }

    return filtered ? [] : readLocalField<AuditLog[]>(restaurantId, 'auditLogs');
};

export interface AuditLogPage {
    logs: AuditLog[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

// ONE page of audit entries plus the total matching the same filters, so an
// infinite scroller knows when to stop. Asks for `meta=1` (the enveloped body);
// the bare-array default that getAuditLogs and the owner app rely on is untouched.
// Ordering on the server is (created_at desc, id desc) — a total order — so
// offset paging can neither duplicate nor skip a row.
// Returns null when the request fails, so the scroller can say "couldn't load"
// instead of silently rendering an outage as the end of the list.
export const getAuditLogPage = async (
    restaurantId: string,
    opts: { limit?: number; offset?: number; category?: string; search?: string; from?: string; to?: string } = {},
): Promise<AuditLogPage | null> => {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const offset = Math.max(0, opts.offset ?? 0);
    const qs = new URLSearchParams({ restaurantId, meta: '1' });
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (opts.category && opts.category !== 'All') {qs.set('category', opts.category);}
    if (opts.search) {qs.set('search', opts.search);}
    if (opts.from) {qs.set('from', opts.from);}
    if (opts.to) {qs.set('to', opts.to);}

    const data = await backendJson<{ logs?: unknown[]; total?: number; has_more?: boolean }>(
        `/audit-logs?${qs.toString()}`,
        restaurantId,
        { method: 'GET' },
    );
    if (!data || !Array.isArray(data.logs)) {return null;}
    const logs = data.logs.map(mapAuditLog);
    return {
        logs,
        total: Number(data.total ?? logs.length),
        limit,
        offset,
        has_more: data.has_more === true,
    };
};

export type UndoAuditLogResult =
    | { ok: true; data: { success: true; undo_log_id: string; restored?: unknown } }
    | { ok: false; error: string; reason?: string };

// Reverses a single audited action. The backend is the security boundary and
// always returns a human-readable `error` string on failure — surface it verbatim.
export const undoAuditLog = async (restaurantId: string, logId: string): Promise<UndoAuditLogResult> => {
    const response = await backendCall(
        `/audit-logs/${encodeURIComponent(logId)}/undo?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    );

    if (!response) {return { ok: false, error: 'Could not reach the server. Please try again.' };}

    let parsed: any = null;
    try {
        parsed = await response.json();
    } catch {
        parsed = null;
    }

    if (response.ok && parsed?.success) {
        return { ok: true, data: parsed };
    }

    return {
        ok: false,
        error: typeof parsed?.error === 'string' && parsed.error ? parsed.error : `Undo failed (${response.status}).`,
        reason: typeof parsed?.reason === 'string' ? parsed.reason : undefined,
    };
};

export const getRestaurantProfile = async (restaurantId: string, employeeId: string): Promise<RestaurantProfile> => {
    const data = await backendJson<RestaurantProfile>(
        `/restaurant/profile?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Employee-Id': employeeId } },
    );

    if (data) {
        await writeLocalField(restaurantId, 'profile', data);
        return data;
    }

    return readLocalField<RestaurantProfile>(restaurantId, 'profile');
};

export const addBooking = async (restaurantId: string, booking: Booking) => {
    await addToLocalField(restaurantId, 'bookings', booking);
    return { acknowledged: true };
};

export const addCustomer = async (restaurantId: string, customer: Customer) => {
    const response = await backendCall('/add-customer', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customer: {
                name: customer.name,
                number: customer.phone,
                email: customer.email || undefined,
                gender: customer.gender || undefined,
                age_group: customer.ageGroup || undefined,
                pincode: customer.pincode || undefined,
            },
        }),
    });

    if (response?.ok) {
        await getCustomers(restaurantId);
        return { acknowledged: true };
    }

    await addToLocalField(restaurantId, 'customers', customer);
    return { acknowledged: true };
};

/** What the add/edit form actually submits. NOT an InventoryItem: `status` is
 *  the server's answer, never the client's input. */
export interface InventoryItemInput {
    id?: string;
    name: string;
    category: string;
    stock: number;
    unit: string;
    /** Reorder level in the item's own unit. Omit to leave a stored one alone. */
    reorder_level?: number | null;
}

export const addInventoryItem = async (restaurantId: string, item: InventoryItemInput) => {
    const response = await backendCall('/inventory', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
    });

    if (response?.ok) {
        await getInventory(restaurantId);
        return { acknowledged: true };
    }

    // OFFLINE ONLY. The status rule (quantity + unit + reorder level) lives on
    // the server and is not duplicated here — that duplication is precisely what
    // let the two copies drift apart. The local stand-in states only the part
    // that needs no unit knowledge, and the real badge arrives with the next
    // successful load.
    await addToLocalField(restaurantId, 'inventory', {
        ...item,
        id: item.id ?? `${Date.now()}`,
        status: item.stock <= 0 ? 'Out of Stock' : 'In Stock',
        expiry_date: null,
        reorder_level: item.reorder_level ?? null,
        reorder_unit: item.reorder_level == null ? null : item.unit,
        reorder_applied: null,
        reorder_basis: null,
    } satisfies InventoryItem);
    return { acknowledged: true };
};

export const addMenuItem = async (restaurantId: string, item: MenuItem) => {
    const response = await backendCall('/menu', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
    });

    if (response?.ok) {
        await getMenuItems(restaurantId);
        return { acknowledged: true };
    }

    await addToLocalField(restaurantId, 'menuItems', item);
    return { acknowledged: true };
};

// `idempotencyKey` — one per logical send (the Add New Order dialog mints it per
// draft). POST /orders honours it: the same key is never applied twice. Callers
// that use this route as a status upsert pass none and are unchanged.
//
// CLIENT ITEM 6 — A PRINTED BILL TAKES NO MORE FROM A WAITER. The server answers
// `bill_printed` (and writes nothing) when a waiter-only login adds to a table
// whose bill has been printed — as 423, never 409 (see BILL_PRINTED_STATUS), and
// an older server as 409, so any 4xx is read for the code. That refusal comes back as a VALUE,
// `{ bill_printed }`, never as the silent local "acknowledged" below — which
// would tell a waiter the order was placed when the kitchen never saw it — and
// never as a throw, whose message Next redacts across this "use server"
// boundary. The caller shows the sentence and the "Take it on 12 (next party)"
// action.
//
// CLIENT ITEMS 1 AND 2 (2.0.2) — `addToPrintedBill`: the operator confirmed these
// items go on the table's PRINTED bill ("Add to printed bill"). Sent as
// `add_to_printed_bill: true`, which is the only thing that lets a waiter-only
// login add to printed paper; never sent without that confirm.
export const addOrder = async (restaurantId: string, order: Order, opts?: { idempotencyKey?: string; addToPrintedBill?: boolean }) => {
    const response = await backendCall('/orders', restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: JSON.stringify(opts?.addToPrintedBill === true ? { ...order, [ADD_TO_PRINTED_BILL_KEY]: true } : order),
    });

    if (response && !response.ok && response.status >= 400 && response.status < 500) {
        let body: unknown = null;
        try { body = await response.json(); } catch { body = null; }
        const refusal = readBillPrintedRefusal(body);
        if (refusal) {
            const refused: { bill_printed: BillPrintedRefusal } = { bill_printed: refusal };
            return refused;
        }
    }

    if (response?.ok) {
        try {
            const payload = await response.json();
            await getOrders(restaurantId);
            return payload;
        } catch {
            await getOrders(restaurantId);
            return { acknowledged: true } as any;
        }
    }

    await addToLocalField(restaurantId, 'orders', order);
    return { acknowledged: true } as any;
};

export const deleteOrder = async (restaurantId: string, orderId: string) => {
    const response = await backendCall(`/orders/${encodeURIComponent(orderId)}`, restaurantId, {
        method: 'DELETE',
    });

    if (response?.ok || response?.status === 204) {
        await getOrders(restaurantId);
        return { acknowledged: true };
    }

    const orders = await readLocalField<Order[]>(restaurantId, 'orders');
    const updated = orders.filter((o) => o.id !== orderId);
    await writeLocalField(restaurantId, 'orders', updated);
    return { acknowledged: true };
};

export const createBill = async (
    restaurantId: string,
    bill: {
        order_id: string;
        total_amt: number;
        emp_id?: string | null;
        status?: number;
        reason?: string | null;
        tax_breakdown?: any;
    },
) => {
    const response = await backendCall('/bills', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bill),
    });

    if (!response) {return null;}
    if (!response.ok) {return null;}
    try {
        return await response.json();
    } catch {
        return null;
    }
};

export const replaceBill = async (
    restaurantId: string,
    payload: {
        old_order_id: string;
        reason?: string | null;
        new_order: any;
        new_bill: any;
    },
) => {
    const response = await backendCall('/bills/replace', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response) {return null;}
    if (!response.ok) {
        const msg = await readErrorMessage(response);
        throw new Error(msg);
    }

    try { return await response.json(); } catch { return null; }
};

export const updateBillStatusByOrder = async (restaurantId: string, orderId: string, status: number) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/status`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    return response?.ok ?? false;
};

export const confirmBillPaymentByWaiter = async (
    restaurantId: string,
    employeeId: string,
    orderId: string,
    payment_method: PaymentMethod,
    payment_proof_screenshot_url?: string | null,
    splits?: PaymentSplit[],
    /**
     * Client items 1 and 2: the cashier was warned the printed bill is out of
     * date and pressed "Settle anyway". Recorded in the audit log; the settle
     * itself is unchanged.
     */
    opts?: { settledWithStalePaper?: boolean },
) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/waiter-confirm-payment`, restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Employee-Id': employeeId,
        },
        body: JSON.stringify({
            payment_method,
            payment_proof_screenshot_url: payment_proof_screenshot_url ?? null,
            ...(splits && splits.length > 0 ? { splits } : {}),
            ...(opts?.settledWithStalePaper === true ? { settled_with_stale_paper: true } : {}),
        }),
    });

    if (!response) {
        throw new Error('Unable to connect to backend.');
    }
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    try {
        return await response.json();
    } catch {
        return { success: true };
    }
};

export const approveBillPaymentByAdmin = async (
    restaurantId: string,
    employeeId: string,
    orderId: string,
    /** "Settle anyway" against out-of-date paper — see confirmBillPaymentByWaiter. */
    opts?: { settledWithStalePaper?: boolean },
) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/admin-approve-payment`, restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Employee-Id': employeeId,
        },
        ...(opts?.settledWithStalePaper === true ? { body: JSON.stringify({ settled_with_stale_paper: true }) } : {}),
    });

    if (!response) {
        throw new Error('Unable to connect to backend.');
    }
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    try {
        return await response.json();
    } catch {
        return { success: true };
    }
};

export const closeBillByOrder = async (
    restaurantId: string,
    employeeId: string,
    orderId: string,
) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/close`, restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Employee-Id': employeeId,
        },
    });

    if (!response) {
        throw new Error('Unable to connect to backend.');
    }
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    try {
        return await response.json();
    } catch {
        return { success: true };
    }
};

export const getBillByOrder = async (restaurantId: string, orderId: string) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}`, restaurantId, { method: 'GET' });
    if (!response?.ok) {return null;}
    try { return await response.json(); } catch { return null; }
};

export const getRestaurantLogo = async (restaurantId: string): Promise<string | null> => {
    const response = await backendCall('/restaurant/logo', restaurantId, { method: 'GET' });
    if (!response?.ok) {return null;}
    try { const data = await response.json(); return data?.logo_base64 ?? null; } catch { return null; }
};

// 5.1 — the logo the BILL prints, not the branding logo. The thermal renderer
// prefers the tenant's SVG bill logo and fits + thresholds it to the roll; this
// is a PNG of exactly that raster (GET /restaurant/logo/bill), so the print
// preview shows the paper's own logo. null when the tenant has none, or on a
// backend that predates the route — callers fall back to getRestaurantLogo.
export const getBillLogo = async (restaurantId: string): Promise<string | null> => {
    const response = await backendCall('/restaurant/logo/bill', restaurantId, { method: 'GET' });
    if (!response?.ok) {return null;}
    try {
        const data = (await response.json()) as { logo_base64?: unknown } | null;
        return typeof data?.logo_base64 === 'string' && data.logo_base64 ? data.logo_base64 : null;
    } catch { return null; }
};

export const getOutletDefaultTax = async (restaurantId: string): Promise<Record<string, number> | null> => {
    const response = await backendCall('/outlets/default-tax', restaurantId, { method: 'GET' });
    if (!response?.ok) {return null;}
    try {
        const data = await response.json();
        return data?.default_tax ?? null;
    } catch {
        return null;
    }
};

export const setOutletDefaultTax = async (restaurantId: string, defaultTax: Record<string, number>) => {
    const response = await backendCall('/outlets/default-tax', restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_tax: defaultTax }),
    });
    return response?.ok ?? false;
};

export const addTable = async (restaurantId: string, table: Omit<Table, 'id'>) => {
    const response = await backendCall('/add-table', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table: {
                name: table.name,
                capacity: table.capacity,
            },
        }),
    });

    if (response?.ok) {
        await getTables(restaurantId);
        return { acknowledged: true };
    }

    const tables = await getTables(restaurantId);
    tables.push({ ...table, id: stableTableId(table.name, tables.length + 1) });
    await writeLocalField(restaurantId, 'tables', tables);
    return { acknowledged: true };
};

export const addMenuCategory = async (restaurantId: string, category: string) => {
    const response = await backendCall('/menu/categories', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
    });

    if (response?.ok) {
        await getMenuCategories(restaurantId);
        return { acknowledged: true };
    }

    const categories = await getMenuCategories(restaurantId);
    if (!categories.includes(category)) {
        categories.push(category);
        await writeLocalField(restaurantId, 'menuCategories', categories);
    }
    return { acknowledged: true };
};

export const removeMenuCategory = async (restaurantId: string, category: string) => {
    const encodedCategory = encodeURIComponent(category);
    const response = await backendCall(`/menu/categories?category=${encodedCategory}`, restaurantId, {
        method: 'DELETE',
    });

    if (response?.ok) {
        await Promise.all([
            getMenuCategories(restaurantId),
            getMenuItems(restaurantId),
        ]);
        return { acknowledged: true };
    }

    const categories = await getMenuCategories(restaurantId);
    const items = await getMenuItems(restaurantId);
    const updatedCategories = categories.filter((existing) => existing.toLowerCase() !== category.toLowerCase());
    const updatedItems = items.filter((item) => item.category.toLowerCase() !== category.toLowerCase());
    await Promise.all([
        writeLocalField(restaurantId, 'menuCategories', updatedCategories),
        writeLocalField(restaurantId, 'menuItems', updatedItems),
    ]);
    return { acknowledged: true };
};

// export const addAuditLogEntry = async (
//     restaurantId: string,
//     log: Omit<AuditLog, 'id' | 'timestamp'> & { employeeId?: string },
// ): Promise<void> => {
//     const response = await backendCall('/audit-logs', restaurantId, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//             ...(log.employeeId ? { 'X-Employee-Id': log.employeeId } : {}),
//         },
//         body: JSON.stringify({
//             employee: log.employeeId ?? log.employee,
//             employee_id: log.employeeId ?? null,
//             action: log.action,
//             details: log.details ?? null,
//         }),
//     });

//     if (response?.ok) {
//         await getAuditLogs(restaurantId);
//         return;
//     }

//     const logs = await getAuditLogs(restaurantId);
//     logs.unshift({
//         id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
//         employee: log.employee,
//         action: log.action,
//         details: log.details ?? '',
//         timestamp: new Date().toISOString(),
//     });
//     await writeLocalField(restaurantId, 'auditLogs', logs);
// };

export const updateTableStatus = async (
    restaurantId: string,
    tableName: string,
    status: 'Available' | 'Reserved' | 'Booked' | 'Occupied',
) => {
    const tables = await getTables(restaurantId);
    const updated = tables.map((table) =>
        table.name === tableName ? { ...table, status } : table,
    );
    await writeLocalField(restaurantId, 'tables', updated);
    return { acknowledged: true };
};

//important: need to update this function based on the updated RestaurantProfile class
export const updateRestaurantProfile = async (restaurantId: string, employeeId: string, profile: RestaurantProfile) => {
    const response = await backendCall('/restaurant/profile', restaurantId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Employee-Id': employeeId },
        // Send the short keys the endpoint expects (it also accepts the long shape,
        // but this keeps the contract explicit).
        body: JSON.stringify({
            name: profile.restaurant_name,
            address: profile.outlet_add,
            phone: profile.outlet_phone,
            email: profile.email,
            hours: profile.outlet_hours,
        }),
    });

    if (response?.ok) {
        await getRestaurantProfile(restaurantId, employeeId);
        return { acknowledged: true };
    }

    // Reachable backend that returned an error → surface it so the user sees the
    // real reason instead of a silent "saved" that didn't persist.
    if (response) {
        throw new Error(await readErrorMessage(response));
    }

    // Only fall back to local when the backend is unreachable (offline).
    const restaurant = ensureLocalRestaurant(restaurantId);
    restaurant.Restaurant_name = profile.restaurant_name;
    restaurant.data.profile = deepClone(profile);
    return { acknowledged: true };
};

export const removeInventoryItem = async (restaurantId: string, itemId: string) => {
    const response = await backendCall(`/inventory/${encodeURIComponent(itemId)}`, restaurantId, {
        method: 'DELETE',
    });

    if (response?.ok || response?.status === 204) {
        await getInventory(restaurantId);
        return { acknowledged: true };
    }

    const inventory = await getInventory(restaurantId);
    const updated = inventory.filter((item) => item.id !== itemId);
    await writeLocalField(restaurantId, 'inventory', updated);
    return { acknowledged: true };
};

export const removeTable = async (restaurantId: string, tableId: number) => {
    const tables = await getTables(restaurantId);
    const table = tables.find((t) => t.id === tableId);

    if (table) {
        await backendCall(`/table/${encodeURIComponent(table.name)}`, restaurantId, {
            method: 'DELETE',
        });
    }

    const updated = tables.filter((t) => t.id !== tableId);
    await writeLocalField(restaurantId, 'tables', updated);
    return { acknowledged: true };
};

export const saveTables = async (restaurantId: string, tables: Table[]) => {
    await writeLocalField(restaurantId, 'tables', tables);
    return { acknowledged: true };
};

export const cancelBooking = async (restaurantId: string, bookingId: string) => {
    await backendCall(`/booking/${encodeURIComponent(bookingId)}`, restaurantId, {
        method: 'DELETE',
    });

    const bookings = await getBookings(restaurantId);
    const updated = bookings.filter((booking) => booking.id !== bookingId);
    await writeLocalField(restaurantId, 'bookings', updated);
    return { acknowledged: true };
};

export const updateBookingStatus = async (
    restaurantId: string,
    bookingId: string,
    status: Booking['status'],
) => {
    await backendCall(`/booking/${encodeURIComponent(bookingId)}/status`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });

    const bookings = await getBookings(restaurantId);
    const updated = bookings.map((booking) =>
        booking.id === bookingId ? { ...booking, status } : booking,
    );
    await writeLocalField(restaurantId, 'bookings', updated);
    return { acknowledged: true };
};

export const saveMenuItems = async (restaurantId: string, items: MenuItem[]) => {
    const response = await backendCall('/menu', restaurantId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
    });

    if (response?.ok) {
        await getMenuItems(restaurantId);
        return { acknowledged: true };
    }

    await writeLocalField(restaurantId, 'menuItems', items);
    return { acknowledged: true };
};

/** What GET /auth/me answers with, in the fields this app re-hydrates from. */
export interface RefreshedSession {
    role?: string;
    role_all?: string[];
    actions_set?: string[];
    action_names?: string[];
    /*
      The server's floor-scoping answer. See src/lib/session-scope.ts: it is
      RECOMPUTED on every /auth/me rather than stored on the session, so a role
      change takes effect on the next launch instead of the next login.
    */
    scope?: SessionScope;
}

/**
 * Re-read what this session may do, from the verified session on the server.
 *
 * WHY: the action set, the role list and the `scope` block were frozen into
 * localStorage at login, so a permission granted or revoked since then never
 * reached the browser, and a session stored before `scope` existed carried none
 * at all. The backend recomputes all of it on every call for exactly this
 * reason.
 *
 * RETURNS NULL ON ANY FAILURE, AND THAT IS NOT A SIGN-OUT. /auth/ paths are
 * exempt from the 401 redirect (`isAuthPath`), so an expired token, a 403, an
 * outage or a laptop on a bad wifi all land here as null and the caller keeps
 * the session it already had. A genuinely dead session is caught by the next
 * real request, which is `enforceSessionAlive`'s job and should stay its alone —
 * logging the floor out because a refresh call timed out is a worse outage than
 * a stale permission list.
 *
 * The empty restaurantId is deliberate: the tenant is derived from the bearer
 * token, and this call is made before any restaurant-scoped read.
 */
export const refreshSession = async (): Promise<RefreshedSession | null> => {
    const data = await backendJson<RefreshedSession>('/auth/me', '', { method: 'GET' });
    return data && typeof data === 'object' ? data : null;
};

export const getRoles = async (restaurantId: string): Promise<RoleDefinition[]> => {
    const data = await backendJson<RoleDefinition[]>(
        `/roles?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    return Array.isArray(data) ? data : [];
};

export interface ActionRow {
    id: string;
    action_name: string;
    action_desc?: string | null;
    group?: string | null;
}

export interface CoreRoleRow {
    role: string;
    actions: string[]; // '*' indicates all actions
    /** C6's projection — see RoleDefinition.permissions. */
    permissions?: RolePermission[];
    /** false for every core role: they are defined in code and have no write route. */
    editable?: boolean;
}

export const getActions = async (
    restaurantId: string,
    actionList: string[]
): Promise<{ group: string; actions: { id: string; name: string; desc?: string | null }[] }[]> => {
    const data = await backendJson<ActionRow[]>(
        `/actions?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Action-List': actionList.join(',') } },
    );

    if (!Array.isArray(data)) {return [];}

    const map: Record<string, { id: string; name: string; desc?: string | null }[]> = {};
    for (const a of data) {
        const g = (a.group ?? 'General').trim() || 'General';
        map[g] = map[g] ?? [];
        map[g].push({ id: a.id, name: a.action_name, desc: a.action_desc ?? null });
    }

    return Object.keys(map)
        .sort()
        .map((g) => ({ group: g, actions: map[g] }));
};

export const getCoreRoles = async (restaurantId: string, actionList: string[]): Promise<CoreRoleRow[]> => {
    const data = await backendJson<CoreRoleRow[]>(
        `/core-roles?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Action-List': actionList.join(',') } },
    );

    return Array.isArray(data) ? data : [];
};

export const getRestaurantUsers = async (
    restaurantId: string,
    employeeId: string,
): Promise<User[]> => {
    const data = await backendJson<{ users: User[] }>(
        `/restaurant/users?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        {
            method: 'GET',
            headers: {
                'X-Employee-Id': employeeId,
            },
        },
    );

    if (Array.isArray(data?.users)) {
        const local = ensureLocalRestaurant(restaurantId);
        const normalized = data.users.map((entry, idx) => {
            const e: any = { ...entry } as any;
            e.employeeId = e.employeeId ?? e.employee_id ?? e.id ?? String(Date.now()) + '-' + idx;
            return e as User;
        });
        local.users = normalized.map((entry) => ({ ...entry }));
        return normalized;
    }

    const local = ensureLocalRestaurant(restaurantId);
    return deepClone(local.users);
};

export const createRole = async (
    restaurantId: string,
    roleName: string,
    actions: string[] = [],
): Promise<RoleDefinition | null> => {
    const response = await backendCall('/roles', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_name: roleName, actions_performable: actions }),
    });

    if (!response) {
        return null;
    }

    if (!response.ok) {
        // Try to surface structured errors from backend (e.g. invalidActionIds)
        const body = await (async () => {
            try {
                return await response.json();
            } catch {
                return null;
            }
        })();

        const errMsg = (body && typeof body.error === 'string') ? body.error : await readErrorMessage(response);
        const e: any = new Error(errMsg);
        if (body && Array.isArray(body.invalidActionIds)) {
            e.invalidActionIds = body.invalidActionIds;
        }
        throw e;
    }

    return (await response.json()) as RoleDefinition;
};

export const deleteRole = async (restaurantId: string, roleId: string): Promise<boolean> => {
    const response = await backendCall(`/roles/${encodeURIComponent(roleId)}`, restaurantId, {
        method: 'DELETE',
    });

    return Boolean(response?.ok || response?.status === 204);
};

export const assignRoleToEmployee = async (
    restaurantId: string,
    employeeId: string,
    roleName: string,
): Promise<boolean> => {
    const response = await backendCall('/roles/assign', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, role_name: roleName }),
    });

    return Boolean(response?.ok);
};

export const removeRoleFromEmployee = async (
    restaurantId: string,
    employeeId: string,
    roleName: string,
): Promise<boolean> => {
    const response = await backendCall('/roles/remove', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, role_name: roleName }),
    });

    return Boolean(response?.ok);
};

// Admin: set/reset a user's login password.
export const setUserPassword = async (
    restaurantId: string,
    employeeId: string,
    password: string,
): Promise<void> => {
    const response = await backendCall('/restaurant/users/password', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, password }),
    });
    if (!response?.ok) {throw new Error(response ? await readErrorMessage(response) : 'Unable to set password');}
};

// Admin: pending forgot-password requests for the restaurant.
export const getPasswordRequests = async (restaurantId: string): Promise<PasswordResetRequest[]> => {
    const data = await backendJson<{ requests: PasswordResetRequest[] }>('/restaurant/password-requests', restaurantId, { method: 'GET' });
    return Array.isArray(data?.requests) ? data.requests : [];
};

// Admin: dismiss a pending password request without resetting.
export const dismissPasswordRequest = async (restaurantId: string, requestId: string): Promise<boolean> => {
    const response = await backendCall(`/restaurant/password-requests/${encodeURIComponent(requestId)}/dismiss`, restaurantId, { method: 'POST' });
    return Boolean(response?.ok);
};

// --- Attendance / working hours --------------------------------------------
export interface MyAttendance { clocked_in: boolean; since: string | null; today_minutes: number; pending_approval?: boolean }
export interface AttendanceSummaryRow { emp_id: string; name: string; minutes: number; shifts: number; open: boolean }
export interface PendingClockIn { id: string; emp_id: string; name: string; clock_in: string; clock_out: string | null }

export const getMyAttendance = async (restaurantId: string): Promise<MyAttendance> => {
    const d = await backendJson<MyAttendance>('/attendance/me', restaurantId, { method: 'GET' });
    return d ?? { clocked_in: false, since: null, today_minutes: 0 };
};

export const reviewClockIn = async (restaurantId: string, attendanceId: string, approve: boolean): Promise<void> => {
    const r = await backendCall(`/attendance/${encodeURIComponent(attendanceId)}/${approve ? 'approve' : 'reject'}`, restaurantId, { method: 'POST' });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to review clock-in');}
};

export const clockIn = async (restaurantId: string): Promise<boolean> => {
    const r = await backendCall('/attendance/clock-in', restaurantId, { method: 'POST' });
    return Boolean(r?.ok);
};

export const clockOut = async (restaurantId: string): Promise<boolean> => {
    const r = await backendCall('/attendance/clock-out', restaurantId, { method: 'POST' });
    return Boolean(r?.ok);
};

export const getAttendanceSummary = async (
    restaurantId: string,
    from: string,
    to: string,
): Promise<{ from: string; to: string; rows: AttendanceSummaryRow[]; pending: PendingClockIn[] }> => {
    const d = await backendJson<{ from: string; to: string; rows: AttendanceSummaryRow[]; pending: PendingClockIn[] }>(
        `/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        restaurantId,
        { method: 'GET' },
    );
    return d ?? { from, to, rows: [], pending: [] };
};

// --- Inventory ops: vendors, receive, wastage, movements -------------------
export interface Vendor { id: string; name: string; phone?: string | null; email?: string | null; notes?: string | null }
export interface StockMovement {
    id: string;
    inventory_id: string;
    item_name: string | null;
    delta: number;
    kind: string;
    reason: string | null;
    vendor_id: string | null;
    unit_cost: number | null;
    created_at: string;
}

export const getVendors = async (restaurantId: string): Promise<Vendor[]> => {
    const d = await backendJson<{ vendors: Vendor[] }>('/vendors', restaurantId, { method: 'GET' });
    return Array.isArray(d?.vendors) ? d.vendors : [];
};

export const addVendor = async (restaurantId: string, vendor: { name: string; phone?: string; email?: string; notes?: string }): Promise<void> => {
    const r = await backendCall('/vendors', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vendor) });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to add vendor');}
};

export const deleteVendor = async (restaurantId: string, id: string): Promise<void> => {
    const r = await backendCall(`/vendors/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to delete vendor');}
};

export const receiveStock = async (
    restaurantId: string,
    body: { inventory_id: string; qty: number; vendor_id?: string; unit_cost?: number; note?: string },
): Promise<void> => {
    const r = await backendCall('/inventory/receive', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to receive stock');}
};

export const recordWastage = async (
    restaurantId: string,
    body: { inventory_id: string; qty: number; reason?: string },
): Promise<void> => {
    const r = await backendCall('/inventory/wastage', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to record wastage');}
};

export const getStockMovements = async (restaurantId: string, from?: string, to?: string): Promise<StockMovement[]> => {
    const qs = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : '';
    const d = await backendJson<{ movements: StockMovement[] }>(`/inventory/movements${qs}`, restaurantId, { method: 'GET' });
    return Array.isArray(d?.movements) ? d.movements : [];
};

// Issue stock from the store to the kitchen (logged as a kind='issue' movement;
// feeds the food-cost % KPI).
export const issueStock = async (
    restaurantId: string,
    body: { inventory_id: string; qty: number; note?: string },
): Promise<void> => {
    const r = await backendCall('/inventory/issue', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to issue stock');}
};

// Set (or clear, with null) an inventory item's expiry date.
export const setInventoryExpiry = async (
    restaurantId: string,
    inventoryId: string,
    expiryDate: string | null,
): Promise<void> => {
    const r = await backendCall('/inventory/expiry', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: inventoryId, expiry_date: expiryDate }),
    });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to set expiry');}
};

// Set (or clear, with null) an inventory item's reorder level, in the item's own
// unit. Deliberately NOT routed through addInventoryItem: that endpoint writes
// "Quantity" from the form, so using it to change a threshold would stamp a
// stale stock figure over any receive/wastage/issue that landed meanwhile.
export const setInventoryReorderLevel = async (
    restaurantId: string,
    inventoryId: string,
    reorderLevel: number | null,
): Promise<void> => {
    const r = await backendCall('/inventory/reorder-level', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: inventoryId, reorder_level: reorderLevel }),
    });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to set reorder level');}
};

// Vendor price history for one ingredient (costed purchases, oldest first).
export interface PricePoint { date: string; qty: number; unit_cost: number; vendor: string | null }
export const getPriceHistory = async (restaurantId: string, inventoryId: string): Promise<PricePoint[]> => {
    const d = await backendJson<{ points: PricePoint[] }>(
        `/inventory/price-history?inventory_id=${encodeURIComponent(inventoryId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(d?.points) ? d.points : [];
};

// --- Recipe/BOM costing -------------------------------------------------------
export interface MenuCostingIngredient { inventory_id: string; name: string; unit: string; qty: number; note: string | null; unit_cost: number | null; line_cost: number | null }
export interface MenuCostingItem {
    id: string;
    name: string;
    category: string;
    price: number;
    cost: number | null;
    margin_pct: number | null;
    missing_costs: number;
    ingredients: MenuCostingIngredient[];
}
export interface MenuCosting {
    items: MenuCostingItem[];
    ingredients: { id: string; name: string; unit: string; unit_cost: number | null }[];
}
export const getMenuCosting = async (restaurantId: string): Promise<MenuCosting> => {
    const d = await backendJson<MenuCosting>('/menu/costing', restaurantId, { method: 'GET' });
    return d ?? { items: [], ingredients: [] };
};

// --- Purchase orders --------------------------------------------------------
export interface PurchaseOrderItem { inventory_id: string; name: string; qty_ordered: number; unit_cost: number; qty_received: number }
export interface PurchaseOrder {
    id: string;
    vendor_id: string | null;
    vendor_name: string | null;
    status: 'draft' | 'ordered' | 'received' | 'cancelled';
    items: PurchaseOrderItem[];
    total_cost: number;
    notes: string | null;
    expected_date: string | null;
    created_at: string;
    created_by: string | null;
    ordered_at: string | null;
    received_at: string | null;
}

export const getPurchaseOrders = async (restaurantId: string, opts?: { status?: string; from?: string; to?: string }): Promise<PurchaseOrder[]> => {
    const params = new URLSearchParams({ restaurantId });
    if (opts?.status) {params.set('status', opts.status);}
    if (opts?.from) {params.set('from', opts.from);}
    if (opts?.to) {params.set('to', opts.to);}
    const d = await backendJson<{ orders: PurchaseOrder[] }>(`/purchase-orders?${params.toString()}`, restaurantId, { method: 'GET' });
    return Array.isArray(d?.orders) ? d.orders : [];
};

export const createPurchaseOrder = async (
    restaurantId: string,
    body: {
        vendor_id?: string;
        vendor_name?: string;
        items: { inventory_id: string; name: string; qty_ordered: number; unit_cost: number }[];
        notes?: string;
        expected_date?: string;
        status?: 'draft' | 'ordered';
    },
): Promise<PurchaseOrder> => {
    const res = await backendCall('/purchase-orders', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to create purchase order');}
    return res.json() as Promise<PurchaseOrder>;
};

export const setPurchaseOrderStatus = async (restaurantId: string, id: string, status: 'draft' | 'ordered' | 'cancelled'): Promise<PurchaseOrder> => {
    const res = await backendCall(`/purchase-orders/${encodeURIComponent(id)}/status`, restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to update purchase order');}
    return res.json() as Promise<PurchaseOrder>;
};

export const receivePurchaseOrder = async (restaurantId: string, id: string, lines: { inventory_id: string; qty_received: number }[], qualityRating?: number | null): Promise<PurchaseOrder> => {
    const body: Record<string, unknown> = { lines };
    if (typeof qualityRating === 'number' && qualityRating >= 1 && qualityRating <= 5) {body.quality_rating = qualityRating;}
    const res = await backendCall(`/purchase-orders/${encodeURIComponent(id)}/receive`, restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to receive purchase order');}
    return res.json() as Promise<PurchaseOrder>;
};

// --- Marketing campaigns ------------------------------------------------------
export interface Campaign { id: string; name: string; cost: number; starts_at: string; ends_at: string; notes: string | null; created_at: string }

export const createCampaign = async (restaurantId: string, input: { name: string; cost: number; starts_at: string; ends_at: string; notes?: string }): Promise<Campaign> => {
    const res = await backendCall('/campaigns', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to create campaign');}
    return res.json() as Promise<Campaign>;
};

export const deleteCampaign = async (restaurantId: string, id: string): Promise<void> => {
    const res = await backendCall(`/campaigns/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to delete campaign');}
};

export const deletePurchaseOrder = async (restaurantId: string, id: string): Promise<void> => {
    const res = await backendCall(`/purchase-orders/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to delete purchase order');}
};

// --- Coupons ----------------------------------------------------------------
export interface Coupon {
    id: string;
    code: string;
    description: string | null;
    type: 'percent' | 'flat';
    value: number;
    min_order: number;
    max_discount: number | null;
    usage_limit: number | null;
    used_count: number;
    per_customer_limit: number | null;
    valid_from: string | null;
    valid_to: string | null;
    active: boolean;
    // 'promo' (default) or 'gift' — gift vouchers carry a spendable balance.
    kind?: 'promo' | 'gift';
    balance?: number | null;
}

export interface CouponInput {
    id?: string;
    code: string;
    description?: string | null;
    type: 'percent' | 'flat';
    value: number;
    min_order?: number | null;
    max_discount?: number | null;
    usage_limit?: number | null;
    per_customer_limit?: number | null;
    valid_from?: string | null;
    valid_to?: string | null;
    active?: boolean;
}

export const getCoupons = async (restaurantId: string): Promise<Coupon[]> => {
    const d = await backendJson<{ coupons: Coupon[] }>('/coupons', restaurantId, { method: 'GET' });
    return Array.isArray(d?.coupons) ? d.coupons : [];
};

export const saveCoupon = async (restaurantId: string, coupon: CouponInput): Promise<Coupon> => {
    const r = await backendCall('/coupons', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(coupon) });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to save coupon');}
    const data = await r.json().catch(() => null) as { coupon?: Coupon } | null;
    return data?.coupon!;
};

export const deleteCoupon = async (restaurantId: string, id: string): Promise<void> => {
    const r = await backendCall(`/coupons/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to delete coupon');}
};

// Issue a gift voucher (admin) — a kind='gift' coupon with a spendable balance.
export const createGiftVoucher = async (restaurantId: string, input: { amount: number; code?: string }): Promise<Coupon> => {
    const r = await backendCall('/vouchers', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to issue voucher');}
    const data = await r.json().catch(() => null) as { coupon?: Coupon } | null;
    return data?.coupon!;
};

// --- Loyalty points ----------------------------------------------------------
export interface LoyaltyAccount {
    phone: string;
    balance: number;
    point_value: number;
    earn_per_100: number;
    history: { points: number; kind: string; note: string | null; bill_id: string | null; created_at: string }[];
}

export const getLoyalty = async (restaurantId: string, phone: string): Promise<LoyaltyAccount> => {
    const r = await backendCall(`/loyalty/${encodeURIComponent(phone)}`, restaurantId, { method: 'GET' });
    if (!r?.ok) {throw new Error(r ? await readErrorMessage(r) : 'Unable to load loyalty account');}
    return await r.json() as LoyaltyAccount;
};

export const redeemLoyalty = async (
    restaurantId: string,
    opts: { phone: string; points: number; table_name: string },
): Promise<{ success: boolean; points: number; discount: number; balance: number }> =>
    postJson('/loyalty/redeem', restaurantId, opts) as Promise<{ success: boolean; points: number; discount: number; balance: number }>;

export const getTableAssignments = async (
    restaurantId: string,
    outletId: string,
    employeeId: string,
): Promise<TableAssignmentDefinition[]> => {
    const data = await backendJson<TableAssignmentDefinition[]>(
        `/table-assignments?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        {
            method: 'GET',
            headers: {
                'X-Employee-Id': employeeId,
                'X-Outlet-Id': outletId,
            },
        },
    );

    return Array.isArray(data) ? data : [];
};

export const assignTableToEmployee = async (
    restaurantId: string,
    employeeId: string,
    outletId: string,
    tableName: string,
    assigneeEmployeeId: string,
): Promise<boolean> => {
    const response = await backendCall('/table-assignments/assign', restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Employee-Id': employeeId,
            'X-Outlet-Id': outletId,
        },
        body: JSON.stringify({
            table_name: tableName,
            employeeId: assigneeEmployeeId,
        }),
    });

    return Boolean(response?.ok);
};

export const unassignTableEmployee = async (
    restaurantId: string,
    employeeId: string,
    outletId: string,
    tableName: string,
): Promise<boolean> => {
    const response = await backendCall('/table-assignments/unassign', restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Employee-Id': employeeId,
            'X-Outlet-Id': outletId,
        },
        body: JSON.stringify({ table_name: tableName }),
    });

    return Boolean(response?.ok);
};

export const getMonthlyApcInsight = async (
    restaurantId: string,
    options?: {
        month?: string;
        period?: 'day' | 'week' | 'month';
        employeeId?: string;
    },
): Promise<MonthlyApcInsight | null> => {
    const params = new URLSearchParams();
    if (options?.month) {
        params.set('month', options.month);
    }
    if (options?.period) {
        params.set('period', options.period);
    }
    if (options?.employeeId) {
        params.set('employeeId', options.employeeId);
    }
    const query = params.toString();

    const data = await backendJson<MonthlyApcInsight>(
        `/orders/apc?restaurantId=${encodeURIComponent(restaurantId)}${query ? `&${query}` : ''}`,
        restaurantId,
        { method: 'GET' },
    );

    return data ?? null;
};

// --- The reporting window ---------------------------------------------------
// One shape for "which days am I asking about", shared by every analytics and
// reporting read below. It is what `useDateRange` hands over, unchanged.
//
// WHY ALL THREE PARAMETERS GO ON THE WIRE
// ---------------------------------------
// /reports/* has always taken explicit `from`/`to`; the /analytics/* routes were
// built around a ROLLING `days` count ending today, which cannot express "1-15
// August" at all. Sending `from`, `to` AND `days` together means one control
// drives both families: a route that understands the range uses it, and a route
// that only knows `days` still receives a window of the RIGHT LENGTH rather than
// silently answering for its own 30-day default. `days` is the INCLUSIVE span of
// the same range, so the two readings can never differ in length.
export interface AnalyticsWindow { from?: string; to?: string; days?: number }

// Accepts the legacy bare day count so a caller that genuinely wants a rolling
// window (nothing does today) is still expressible and still typechecks.
const qWindow = (window: AnalyticsWindow | number | undefined, fallbackDays: number): string => {
    const w = typeof window === 'number' ? { days: window } : (window ?? {});
    const days = Math.max(1, Math.round(Number(w.days) || fallbackDays));
    return `&days=${days}`
        + (w.from ? `&from=${encodeURIComponent(w.from)}` : '')
        + (w.to ? `&to=${encodeURIComponent(w.to)}` : '');
};

/** The day count a window covers, for the captions that still say "N days". */
const windowDays = (window: AnalyticsWindow | number | undefined, fallbackDays: number): number => {
    const w = typeof window === 'number' ? { days: window } : (window ?? {});
    return Math.max(1, Math.round(Number(w.days) || fallbackDays));
};

export interface ApcTrendPoint { month: string; period_start: string; total_revenue: number; total_covers: number; monthly_apc: number; bills: number }

export const getApcTrends = async (restaurantId: string, months = 12): Promise<ApcTrendPoint[]> => {
    const data = await backendJson<{ series: ApcTrendPoint[] }>(
        `/orders/apc-trends?restaurantId=${encodeURIComponent(restaurantId)}&months=${Math.max(1, months)}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.series) ? data.series : [];
};

export interface KpiCard { key: string; label: string; value: number | null; unit: string; status: 'blue' | 'green' | 'amber' | 'red' | 'grey' }
export interface AdvancedAnalytics {
    window_days: number;
    discounts: { total_bills: number; discount_bills: number; utilization_pct: number; total_discount: number; redemptions: number };
    staff: { name: string; feedbacks: number; avg_rating: number | null; complaint_pct: number }[];
    overall_avg_rating: number | null;
    overall_complaint_pct: number;
    total_feedbacks: number;
    processing_time_min: number | null;
    processing_time_n: number;
    suppliers: { vendor: string; pos: number; on_time_pct: number; spend: number; quality: number | null; score: number | null }[];
    overall_on_time_pct: number | null;
    overall_supplier_score: number | null;
    demographics: { total_customers: number; tagged: number; coverage_pct: number | null; by_gender: { label: string; n: number }[]; by_age: { label: string; n: number }[]; top_pincodes: { label: string; n: number }[] };
    campaigns: { id: string; name: string; cost: number; starts_at: string; ends_at: string; sales_during: number; sales_before: number; uplift_pct: number | null; roi_pct: number | null }[];
    overall_campaign_roi_pct: number | null;
    // `unit` rides along so a mixed-unit alert list can be read: 5000 of one
    // thing and 5 of another are not comparable without it.
    stock_alerts: { name: string; qty: number; unit?: string; expiring?: boolean; expiry_date?: string | null }[];
    seasonal: { month: string; revenue: number; bills: number; index: number }[];
    menu_classes: { name: string; qty: number; revenue: number; popularity_pct: number; class: 'STAR' | 'GREAT' | 'MID' | 'BAD' }[];
    bad_share_pct: number | null;
    churn: { rate_pct: number | null; cohort: number; at_risk: { customer: string; orders: number; spend: number; days_since_visit: number }[] };
    wait_time_min: number | null;
    wait_time_n: number;
    tat: { avg_min: number | null; median_min: number | null; sessions: number; by_table: { table_name: string; visits: number; avg_min: number }[] };
    happiness_corr: number | null;
    happiness_pairs: number;
    offers: { code: string; used: number; limit: number | null; redemption_pct: number | null }[];
    overall_redemption_pct: number | null;
    demand_forecast: { name: string; total_qty: number; forecast_next_week: number; trend: 'up' | 'down' | 'flat' }[];
    forecast_mape_pct: number | null;
    food_cost?: {
        actual_cost: number;
        food_cost_pct: number | null;
        theoretical_cost: number;
        variance_pct: number | null;
        issue_events: number;
        uncosted_issues: number;
        recipes_missing: number;
        note: string | null;
    };
    profit?: { revenue: number; expenses: number; margin_pct: number | null };
    kpis: KpiCard[];
}

export const getAdvancedAnalytics = async (
    restaurantId: string,
    window?: AnalyticsWindow | number,
): Promise<AdvancedAnalytics | null> => {
    const data = await backendJson<AdvancedAnalytics>(
        `/analytics/advanced?restaurantId=${encodeURIComponent(restaurantId)}${qWindow(window, 90)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? null;
};

// --- Multi-outlet comparison ---------------------------------------------------
export interface OutletComparison {
    days: number;
    outlets: { outlet_id: string; name: string; revenue: number; bills: number; orders: number; avg_rating: number | null }[];
}

export const getOutletsComparison = async (
    restaurantId: string,
    window?: AnalyticsWindow | number,
): Promise<OutletComparison | null> => {
    const data = await backendJson<OutletComparison>(
        `/analytics/outlets?restaurantId=${encodeURIComponent(restaurantId)}${qWindow(window, 30)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? null;
};

// --- Guest CRM insights ----------------------------------------------------------
export type CustomerSegment = 'new' | 'regular' | 'high-spend' | 'dormant';
export interface CustomerInsight {
    customer_id: string;
    name: string;
    phone: string;
    visits: number;
    total_spend: number;
    last_visit: string | null;
    avg_rating: number | null;
    feedbacks: number;
    segment: CustomerSegment;
    history: { day: string; orders: number; spend: number }[];
}

export const getCustomerInsights = async (restaurantId: string): Promise<CustomerInsight[]> => {
    const data = await backendJson<{ customers: CustomerInsight[] }>(
        `/customers/insights?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.customers) ? data.customers : [];
};

// --- Payroll ------------------------------------------------------------------
export interface PayrollProfile { emp_id: string; pay_type: 'monthly' | 'hourly'; base_salary: number; hourly_rate: number; allowances: number; deductions: number; pf_pct: number; esi_pct: number }
export interface PayrollRow {
    emp_id: string;
    name: string;
    role: string;
    profile: PayrollProfile | null;
    hours_worked: number;
    computed_pay: number | null;
    pf_amount: number | null;
    esi_amount: number | null;
    paid: boolean;
    paid_amount: number | null;
    paid_at: string | null;
}
export interface PayrollData { period: string; rows: PayrollRow[]; total_due: number; total_paid: number }

export const getPayroll = async (restaurantId: string, month: string): Promise<PayrollData | null> => {
    const data = await backendJson<PayrollData>(
        `/payroll?restaurantId=${encodeURIComponent(restaurantId)}&month=${encodeURIComponent(month)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? null;
};

export const setPayrollProfile = async (restaurantId: string, input: { emp_id: string; pay_type: string; base_salary: number; hourly_rate: number; allowances: number; deductions: number; pf_pct: number; esi_pct: number }): Promise<void> => {
    const res = await backendCall('/payroll/profile', restaurantId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save payroll profile');}
};

// Payroll register CSV (string) for the month — gross + PF/ESI statutory split.
export const getPayrollCsv = async (restaurantId: string, month: string): Promise<string> => {
    const res = await backendCall(`/payroll.csv?restaurantId=${encodeURIComponent(restaurantId)}&month=${encodeURIComponent(month)}`, restaurantId, { method: 'GET' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to export payroll');}
    return res.text();
};

export const payPayroll = async (restaurantId: string, input: { emp_id: string; period: string; amount: number; note?: string }): Promise<void> => {
    const res = await backendCall('/payroll/pay', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to record payment');}
};

export interface MonthlyHistoryRow {
    month: string;
    revenue: number;
    bills: number;
    orders: number;
    avg_bill: number | null;
    discounts: number;
    feedback_count: number;
    avg_rating: number | null;
    new_customers: number;
    avg_tat_min: number | null;
}

export const getMonthlyHistory = async (restaurantId: string, months = 36): Promise<MonthlyHistoryRow[]> => {
    const data = await backendJson<{ series: MonthlyHistoryRow[] }>(
        `/analytics/history?restaurantId=${encodeURIComponent(restaurantId)}&months=${Math.max(3, months)}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.series) ? data.series : [];
};

export interface DishStat { name: string; category: string; quantity: number; revenue: number; orders: number; current_price: number | null }
// `id` is the Menu row UUID the suggestion applies to — null only when the sold
// dish name no longer matches a live menu item (nothing to apply then).
export interface PriceSuggestion {
    id: string | null;
    name: string;
    category: string;
    current_price: number;
    suggested_price: number;
    direction: 'increase' | 'decrease';
    // Legacy one-liner, now 2-3 sentences. Kept as the fallback for the
    // structured fields below (all additive — older backends omit them, so the
    // UI must degrade to `reason` rather than render blanks).
    reason: string;
    why?: string;
    expected_effect?: string;
    confidence?: 'high' | 'medium' | 'low';
    confidence_note?: string;
    // suggested_price - current_price, and the same as a % of current_price.
    // NOT always the nominal ±8/±10 — a margin-clamped cut is smaller, so
    // always render the field instead of re-deriving the step.
    delta_amount?: number;
    delta_percent?: number;
    // Only when the dish has a recipe AND a recorded purchase unit cost.
    margin_note?: string;
    // Only when something genuinely warrants a warning.
    caution?: string;
}
export interface WaiterStat { employee_id: string; employee_name: string; orders: number; revenue: number }
// Items the backend deliberately withheld a suggestion for, so the UI can say
// WHY nothing is being suggested instead of looking like there is no signal.
// `retry_after` is an ISO date and is only set for the cooldown reason.
// `reason` stays a machine code (the UI branches on it); `explanation` is the
// owner-facing sentence and is what should be rendered.
export interface SuppressedSuggestion { id: string | null; name: string; reason: 'cooldown' | 'drift_cap' | 'margin_floor'; retry_after?: string; explanation?: string }
export interface MenuInsights {
    period_days: number;
    total_revenue: number;
    total_items_sold: number;
    top_dishes: DishStat[];
    slow_movers: DishStat[];
    price_suggestions: PriceSuggestion[];
    // Additive field — older backends omit it, so treat it as optional.
    suppressed_suggestions?: { count: number; items: SuppressedSuggestion[] };
    top_waiters: WaiterStat[];
}

export const getMenuInsights = async (
    restaurantId: string,
    window?: AnalyticsWindow | number,
): Promise<MenuInsights | null> => {
    const data = await backendJson<MenuInsights>(
        `/analytics/menu-insights?restaurantId=${encodeURIComponent(restaurantId)}${qWindow(window, 30)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? null;
};

// Apply ONE price suggestion to the live menu. Deliberately not PUT /menu —
// that route replaces the whole menu and drops any item missing from the
// payload; this one re-encodes only the price of the given item.
export const applyMenuItemPrice = async (
    restaurantId: string,
    menuItemId: string,
    price: number,
): Promise<{ success: boolean; id: string; name: string; price: number }> => {
    const response = await backendCall(`/menu/${encodeURIComponent(menuItemId)}/price`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price }),
    });
    if (!response?.ok) {
        throw new Error(response ? await readErrorMessage(response) : 'Unable to update the price');
    }
    return (await response.json()) as { success: boolean; id: string; name: string; price: number };
};

/**
 * H4 — mark ONE dish available or unavailable, and change nothing else.
 *
 * Deliberately not `POST /menu`: that is a full upsert requiring name, category
 * and a positive price, and it writes every field it is given. A control tapped
 * forty times during a rush must be incapable of touching a recipe or an image —
 * this codebase has already lost 56 items' images, sections and recipes to a
 * bulk save that sent what the client happened to be holding.
 */
export const setMenuItemAvailability = async (
    restaurantId: string,
    menuItemId: string,
    available: boolean,
): Promise<{ success: boolean; id: string; name: string; available: boolean }> => {
    const response = await backendCall(`/menu/${encodeURIComponent(menuItemId)}/availability`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available }),
    });
    if (!response?.ok) {
        throw new Error(response ? await readErrorMessage(response) : 'Unable to change availability');
    }
    return (await response.json()) as { success: boolean; id: string; name: string; available: boolean };
};

// Not exported: a "use server" module's exports are Server Actions.
async function sendBillCustomer(restaurantId: string, request: BillCustomerRequest): Promise<BillCustomerSaveOutcome> {
    const response = await backendCall(request.path, restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
    });
    if (!response) {
        return { ok: false, outdated: false, message: UNREACHABLE_MESSAGE, status: 0 };
    }
    const text = await response.text().catch(() => '');
    return billCustomerSaveOutcome(response.status, text, 'customer_gstin' in request.body);
}

/**
 * H6 — change the name on a running table's bill.
 *
 * Writes EVERY still-owing order on the table, because there is no `customer`
 * column: the name lives in each order's food blob and the bill takes the first
 * non-placeholder one it finds. Correcting only the round you are looking at
 * would appear to do nothing whenever an earlier round already carries a name.
 * An empty string clears it.
 *
 * R2 item 1 — and the customer's GSTIN, for a corporate party. `customerGstin`
 * `undefined` leaves it off the body, which the route reads as "unchanged"; see
 * billCustomerPayload for why a dialog that does not know the current GSTIN must
 * not send `null`.
 *
 * RETURNS its failure rather than throwing it: Next redacts the message of an
 * Error thrown out of a Server Action in production, so the server's sentence
 * ("GSTIN must be 15 characters…") would never reach the person who typed it,
 * and the old /404/ test on that message could never match either.
 */
export const setBillCustomerName = async (
    restaurantId: string,
    tableName: string,
    customer: string,
    customerGstin?: string,
): Promise<BillCustomerSaveOutcome> =>
    sendBillCustomer(restaurantId, billCustomerPayload({ kind: 'table', tableName }, customer, customerGstin));

/**
 * R2 item 1 — change the name and GSTIN on a SETTLED bill, from Accounting's
 * past bills. Addressed by bill id, never by table name: the table name answers
 * with whoever is sitting there now. The route changes only those two fields —
 * no money, no status, no timestamps — and is gated on the permission the E5
 * settled reprint uses.
 */
export const setSettledBillCustomerDetails = async (
    restaurantId: string,
    billId: string,
    customer: string,
    customerGstin?: string,
): Promise<BillCustomerSaveOutcome> =>
    sendBillCustomer(restaurantId, billCustomerPayload({ kind: 'bill', billId }, customer, customerGstin));


export interface OperationsAnalytics {
    days: number;
    by_hour: { hour: number; orders: number; revenue: number }[];
    by_weekday: { weekday: number; label: string; orders: number; revenue: number }[];
}

export const getOperationsAnalytics = async (
    restaurantId: string,
    window?: AnalyticsWindow | number,
): Promise<OperationsAnalytics | null> => {
    const data = await backendJson<OperationsAnalytics>(
        `/analytics/operations?restaurantId=${encodeURIComponent(restaurantId)}${qWindow(window, 30)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? null;
};

// --- What-if simulation -----------------------------------------------------
// GET /simulation/baseline + POST /simulation/run. All ₹ figures are PRE-TAX
// (bill-subtotal basis — the same basis as APC), per day, over a 30-day window.
// The backend guarantees every number is finite: an empty tenant gets zeros
// with sources.<field> === 'default' so the UI can tag them "estimated".
export type SimulationSource = 'measured' | 'default';
export interface SimulationBaseline {
    window_days: number;
    covers_per_day: number;
    apc: number;
    revenue_per_day: number;
    food_cost_pct: number;
    labour_cost_per_day: number;
    staff_count: number;
    avg_tat_min: number;
    table_count: number;
    fixed_costs_per_day: number;
    net_profit_per_day: number;
    sources: Record<string, SimulationSource>;
}

// Slider payload for POST /simulation/run. Every field is optional — a missing
// slider means "unchanged from the baseline" — and out-of-range values are
// clamped into their legal ranges server-side, never rejected.
export interface SimulationRunParams {
    price_adjust_pct?: number;
    elasticity?: number;
    staff_count?: number;
    avg_wage_per_shift?: number;
    tat_target_min?: number;
    extra_expediters?: number;
    marketing_spend?: number;
    food_cost_pct?: number;
}

// One column of the results table. current/simulated/delta share this shape;
// delta = simulated − current, computed server-side AFTER rounding so the
// rendered CURRENT + DELTA always equals SIMULATED.
export interface SimulationLine {
    covers: number;
    apc: number;
    revenue: number;
    labour_cost: number;
    food_cost: number;
    marketing_per_day: number;
    net_profit: number;
    tat_min: number;
}
export interface SimulationResult {
    current: SimulationLine;
    simulated: SimulationLine;
    delta: SimulationLine;
    notes: string[];
    // Days for the one-time marketing spend to pay back out of the daily
    // profit uplift; null when there is no uplift (or no spend).
    breakeven_days: number | null;
}

export const getSimulationBaseline = async (
    restaurantId: string,
): Promise<SimulationBaseline | null> => {
    const data = await backendJson<SimulationBaseline>(
        `/simulation/baseline?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? null;
};

export const runWhatIfSimulation = async (
    restaurantId: string,
    params: SimulationRunParams,
): Promise<SimulationResult | null> => {
    const data = await backendJson<SimulationResult>(
        `/simulation/run?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        },
    );
    return data ?? null;
};

// --- Kitchen analytics ------------------------------------------------------
// Per-dish prep time, per-kitchen-section (station) averages, and an order-level
// prep summary — all derived server-side from Orders.timing (pause-excluded).
export interface KitchenOrderSummary {
    orders_timed: number;
    avg_prep_ms: number;
    median_prep_ms: number;
    p90_prep_ms: number;
    avg_bark_to_served_ms: number;
    max_prep_ms: number;
}
export interface KitchenDishStat {
    id: string | null;
    name: string;
    station: string;
    count: number;
    avg_prep_ms: number;
    max_prep_ms: number;
    // Additive — older backends omit these two.
    p90_prep_ms?: number;
    min_prep_ms?: number;
}
export interface KitchenSectionStat {
    section: string;
    dishes: number;
    items_timed: number;
    avg_prep_ms: number;
    max_prep_ms: number;
    // Additive. `slowest_dish` is picked from the FULL dish aggregate, so it is
    // not guaranteed to appear in the (capped) `by_dish` array.
    p90_prep_ms?: number;
    slowest_dish?: { name: string; avg_prep_ms: number } | null;
}
export interface KitchenAnalytics {
    order_summary: KitchenOrderSummary;
    by_dish: KitchenDishStat[];
    by_section: KitchenSectionStat[];
    period_days: number;
    generated_at: string;
}

const emptyKitchenAnalytics = (days: number): KitchenAnalytics => ({
    order_summary: { orders_timed: 0, avg_prep_ms: 0, median_prep_ms: 0, p90_prep_ms: 0, avg_bark_to_served_ms: 0, max_prep_ms: 0 },
    by_dish: [],
    by_section: [],
    period_days: days,
    generated_at: new Date().toISOString(),
});

export const getKitchenAnalytics = async (
    restaurantId: string,
    window?: AnalyticsWindow | number,
): Promise<KitchenAnalytics> => {
    const data = await backendJson<KitchenAnalytics>(
        `/analytics/kitchen?${qWindow(window, 30).slice(1)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? emptyKitchenAnalytics(windowDays(window, 30));
};


// --- Overview quick insights ------------------------------------------------
// ONE read behind the Overview tab. Composed server-side from the same helpers
// the detail panels use, so an Overview figure can never disagree with the
// screen it drills into. Arrays are always present (never null) so the UI does
// not need null-guards on a brand-new tenant.
export interface OverviewMetric {
    value: number;
    previous: number;
    /** null when there is no baseline — a change against zero is not a percentage. */
    pct_change: number | null;
    direction: 'up' | 'down' | 'flat';
    compared_to: string;
}
/**
 * The period the headline figures are measured against.
 *
 * Explicit dates, not a span, because the period is no longer derivable from the
 * window's length: a window lying inside one calendar month compares against the
 * SAME DATES of the previous month (V3), so 1-9 September is measured against
 * 1-9 August rather than 23-31 August. `label` is the sentence the cards print;
 * the from/to are here so an export can carry the period as data.
 */
export interface OverviewPreviousWindow {
    from: string;
    to: string;
    days: number;
    basis: 'months' | 'same_dates_prev_month' | 'days';
    /** The previous month was shorter, so the two periods differ in length. */
    short: boolean;
    label: string;
}
/** One headline figure, with the sentence that says what it counts. */
export interface HeadlineFigure {
    value: number;
    label: string;
    /**
     * The definition, written by the code that computes it.
     *
     * Rendered verbatim rather than restated here: "net" and "online" mean
     * different things in different restaurants, and a card whose numbers the
     * owner cannot reconcile with their own reports is worse than no card. One
     * place to change a definition, and it is the place that computes it.
     */
    hint: string;
}

/** H1 — the six figures in the box at the top of the overview. */
export interface OverviewHeadline {
    /** The restaurant's own calendar day. */
    today: string;
    /** The 1st of the current month, in the restaurant's zone. */
    month_from: string;
    timezone: string;
    today_net: HeadlineFigure;
    today_gross: HeadlineFigure;
    online_net: HeadlineFigure;
    online_gross: HeadlineFigure;
    cash_collection: HeadlineFigure;
    month_to_date: HeadlineFigure;
    /** Zero means NOTHING SETTLED YET, which is not the same as zero takings. */
    today_bills: number;
    month_bills: number;
    /**
     * Today's takings by payment mode — the Settlement Summary's rows for today,
     * adding up to `today_gross`, with a released ₹0 table left out. OPTIONAL:
     * an older backend does not send it, and then the block renders nothing.
     * Read through readHeadlineByMethod (settlement-breakdown.ts), never raw.
     */
    today_by_method?: SettlementMode[];
    /**
     * Today's bills paid by more than one REAL mode. Not the Settlement Summary's
     * split_bills: a split whose only other part is the Unallocated residual was
     * paid one way, and the server leaves it out of this count.
     */
    today_split_bills?: number;
    /** Today's money whose split parts did not add back to the bill. Should be 0. */
    today_unallocated?: number;
    /** The block's label and definition, written by the code that computes it. */
    by_method?: { label: string; hint: string };
    /**
     * NOT COLLECTED, and shown BESIDE the by-method block, never inside it: the
     * bills settled as NC today (already in `today_bills`, adding 0.00 to every
     * figure) and what was given away today, pre-tax. OPTIONAL — an older
     * backend sends none. Read through readHeadlineNc (lib/nc-settle.ts).
     */
    today_nc?: { label: string; hint: string; bills: number; value: number };
}

/** null on an unreachable backend — never zeroes, which an owner would act on. */
export const getOverviewHeadline = async (restaurantId: string): Promise<OverviewHeadline | null> => {
    if (!restaurantId) {return null;}
    const data = await backendJson<OverviewHeadline>(
        `/analytics/headline?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data && typeof data.today === 'string' ? data : null;
};

export interface OverviewDish { name: string; category: string; quantity: number; revenue: number; share_pct: number }
export interface OverviewStaff {
    employee_id: string; employee_name: string; orders: number; revenue: number;
    avg_rating: number | null; hours_worked: number | null; ranked_by: string;
}
/** One named offender behind an attention row. */
export interface AttentionItem {
    /** The thing itself — "T4", "Paneer Tikka", "Tomatoes". */
    label: string;
    /** What is wrong with it, already humanised — "2 kg left", "open 2 days". */
    sub?: string;
    /** Money or quantity as a RAW number; format it with the restaurant's currency. */
    value?: number;
    /** Real record id, for focusing exactly this row. */
    id?: string;
}
/** Where an attention row should take you. `module`/`params` are the Flutter
 *  app's routing; `href` is ours and is the only field this dashboard should
 *  navigate with — it already includes any query string the destination page
 *  actually parses. */
export interface AttentionDeepLink {
    module: string;
    params?: Record<string, string>;
    href?: string;
}
export interface AttentionRow {
    key: string;
    label: string;
    count: number;
    severity: 'high' | 'medium' | 'low';
    /** Legacy single-label route kept for older clients. Prefer deep_link.href —
     *  for pending_discounts this is still the dead 'Bills' label. */
    module: string;
    /** One line naming the real offenders — "Tomatoes (2 kg left) and 4 more". */
    detail: string;
    /** Up to 4 entries; the row's `count` is the true total. */
    items: AttentionItem[];
    /** Money at stake, when the row is about money. */
    amount?: number;
    deep_link: AttentionDeepLink;
}
export interface OverviewInsights {
    window_days: number;
    timezone: string;
    generated_at: string;
    /** What every headline figure is compared against. See the interface. */
    previous_window?: OverviewPreviousWindow;
    headline: {
        revenue: OverviewMetric; bills: OverviewMetric; covers: OverviewMetric; apc: OverviewMetric;
        today_revenue: number; yesterday_revenue: number;
    };
    top_dishes_by_revenue: OverviewDish[];
    top_dishes_by_quantity: OverviewDish[];
    slow_movers: { name: string; category: string; quantity: number; current_price: number }[];
    top_staff: OverviewStaff[];
    kitchen: {
        avg_prep_ms: number; p90_prep_ms: number; slowest_section: string | null;
        slowest_section_avg_ms: number; slowest_dish: string | null; slowest_dish_avg_ms: number; orders_timed: number;
    };
    peak: {
        hour: number | null; hour_orders: number; hour_revenue: number;
        weekday: string | null; weekday_orders: number; weekday_revenue: number;
    };
    needs_attention: AttentionRow[];
}

export const getOverviewInsights = async (
    restaurantId: string,
    window?: AnalyticsWindow | number,
): Promise<OverviewInsights | null> => {
    // A failed insight read must never blank the whole Overview tab — the caller
    // renders its existing sections when this is null.
    return await backendJson<OverviewInsights>(
        `/analytics/overview?${qWindow(window, 30).slice(1)}`,
        restaurantId,
        { method: 'GET' },
    );
};

// --- Metric explainers ------------------------------------------------------
// "What does this number mean?" copy for the analytics cards. Static text with
// no tenant data, so it is fetched once per tab and cached in module scope —
// every clickable metric card reads from the same object instead of refetching.
// Keys are metric ids chosen by the backend; a missing key simply means "no
// explainer for this tile", never an error.
export interface MetricExplainer { title: string; what: string; how: string; tip?: string }
export type MetricExplainers = Record<string, MetricExplainer>;

let metricExplainersCache: Promise<MetricExplainers> | null = null;

export const getMetricExplainers = async (restaurantId: string): Promise<MetricExplainers> => {
    if (metricExplainersCache) { return metricExplainersCache; }
    const pending = backendJson<{ explainers: MetricExplainers }>(
        '/analytics/metric-explainers',
        restaurantId,
        { method: 'GET' },
    ).then((data) => {
        const explainers = data?.explainers;
        // Don't cache a failure (older backend / transient 5xx) — let the next
        // card that asks try again.
        if (!explainers || Object.keys(explainers).length === 0) {
            metricExplainersCache = null;
            return {};
        }
        return explainers;
    });
    metricExplainersCache = pending;
    return pending;
};

// --- Accounting & reporting -------------------------------------------------
export interface SalesReport {
    from: string; to: string;
    total_sales: number; total_tax: number; total_refund: number; net_sales: number; bill_count: number;
    // Gross is total_sales; Net is total_net (optional: absent from an older
    // backend). net_sales is Gross less refunds — read all three through
    // lib/gross-net.ts, which is where the words are decided.
    total_net?: number; total_round_off?: number;
    by_day: { date: string; sales: number; net?: number; tax: number; refund: number; bills: number }[];
    // `label` is the owner's name for the mode (display only; rows group by `method`).
    by_method: { method: string; label?: string; sales: number; bills: number }[];
}
export interface GstReport {
    from: string; to: string; total_taxable: number; total_tax: number;
    by_rate: { name: string; percentage: number; taxable: number; tax: number }[];
}
export interface ProfitAndLoss {
    from: string; to: string;
    gross_sales: number; refunds: number; tax_collected: number; net_revenue: number; total_expenses: number; net_profit: number;
    expenses_by_category: { category: string; amount: number }[];
}
export interface ExpenseRow { id: string; spent_on: string; category: string; vendor: string | null; amount: number; note: string | null; created_at: string }

const qFromTo = (from?: string, to?: string) => `${from ? `&from=${encodeURIComponent(from)}` : ''}${to ? `&to=${encodeURIComponent(to)}` : ''}`;

export const getSalesReport = async (restaurantId: string, from?: string, to?: string) =>
    backendJson<SalesReport>(`/reports/sales?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });
export const getGstReport = async (restaurantId: string, from?: string, to?: string) =>
    backendJson<GstReport>(`/reports/gst?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });
export const getProfitAndLoss = async (restaurantId: string, from?: string, to?: string) =>
    backendJson<ProfitAndLoss>(`/reports/pnl?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });
// Money given away as discounts/coupons/vouchers. Bill totals are stored net of
// discount, so these figures are context — never subtract them from sales again.
export interface DiscountsReport {
    from: string; to: string;
    bill_count: number; discounted_bills: number;
    total_discount: number; manual_discount: number; coupon_discount: number;
    estimated_bills: number; total_sales: number; gift_redemption_total: number;
    by_coupon: { code: string; kind: 'promo' | 'gift'; uses: number; amount: number }[];
    notes: string[];
}
export const getDiscountsReport = async (restaurantId: string, from?: string, to?: string) =>
    backendJson<DiscountsReport>(`/reports/discounts?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });
export const getExpenses = async (restaurantId: string, from?: string, to?: string) =>
    backendJson<{ expenses: ExpenseRow[] }>(`/expenses?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });

// --- Balance sheet (pragmatic snapshot) ---------------------------------------
export interface BalanceSheet {
    as_of: string;
    assets: { cash_in_hand: number; receivables: number; inventory_value: number; total: number };
    liabilities: { payables: number; unpaid_payroll: number; total: number };
    equity: number;
    notes: string[];
}
export const getBalanceSheet = async (restaurantId: string, asOf?: string) =>
    backendJson<BalanceSheet>(`/reports/balance-sheet?restaurantId=${encodeURIComponent(restaurantId)}${asOf ? `&as_of=${encodeURIComponent(asOf)}` : ''}`, restaurantId, { method: 'GET' });

/**
 * E5 — REPRINT A SETTLED BILL from the accounting module.
 *
 * The server prints WHAT WAS RECORDED and recomputes nothing: between the
 * settlement and the reprint an owner may have changed the tax lines or the
 * service-charge percentage, and a second copy of a tax document with a
 * different total from the one the guest paid is worse than no reprint at all.
 * See POST /print/bill/settled for the whole argument.
 *
 * Returns a message on failure rather than throwing, because the caller is a
 * button in a dialog and "Couldn't reprint" with no reason is the thing this
 * product keeps getting wrong.
 */
export const reprintSettledBill = async (
    restaurantId: string,
    billId: string,
): Promise<{ ok: true; jobId: string | null; destination: string | null } | { ok: false; message: string }> => {
    try {
        const data = await backendJson<{ success?: boolean; jobId?: string; destination?: string; error?: string }>(
            `/print/bill/settled?restaurantId=${encodeURIComponent(restaurantId)}`,
            restaurantId,
            { method: 'POST', body: JSON.stringify({ bill_id: billId }) },
        );
        if (data?.success) {
            return { ok: true, jobId: data.jobId ?? null, destination: data.destination ?? null };
        }
        return { ok: false, message: data?.error ?? 'The bill could not be sent to a printer.' };
    } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'The bill could not be sent to a printer.' };
    }
};

// --- Bank / settlement reconciliation -----------------------------------------
export interface ReconciliationRow {
    method: string;
    /** The owner's name for the mode. Display only — saves key on `method`. */
    label?: string;
    expected: number;
    actual: number | null;
    status: 'matched' | 'variance' | null;
    note: string | null;
}
export const getReconciliation = async (restaurantId: string, date?: string) =>
    backendJson<{ date: string; rows: ReconciliationRow[] }>(`/reconciliation?restaurantId=${encodeURIComponent(restaurantId)}${date ? `&date=${encodeURIComponent(date)}` : ''}`, restaurantId, { method: 'GET' });

export const saveReconciliation = async (
    restaurantId: string,
    input: { date: string; method: string; actual: number; note?: string },
): Promise<ReconciliationRow & { date: string }> => {
    const res = await backendCall('/reconciliation', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save reconciliation');}
    return res.json();
};

// The interactive Sales CSV, FETCHED rather than assembled here.
//
// The backend renders this file with renderSalesCsv (Restaurant_Backend's
// report_render.ts:23, served by index.ts:7361) and the scheduled delivery
// renders it through that same function, so the file an owner clicks and the
// file a schedule delivers are byte-identical by construction. The page used to
// build its own third version in the browser, which quoted nothing (a comma in
// any field split it into two columns) and omitted the Service Charge column
// that SalesReport.by_day already carries — the owner's own income missing from
// the sheet they reconcile with.
export const getSalesCsv = async (restaurantId: string, from?: string, to?: string): Promise<string> => {
    const res = await backendCall(`/reports/sales.csv?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to export sales');}
    return res.text();
};

// Tally-compatible voucher XML (string) for import into Tally.
export const getTallyXml = async (restaurantId: string, from?: string, to?: string): Promise<string> => {
    const res = await backendCall(`/reports/tally.xml?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to build Tally export');}
    return res.text();
};

export const addExpense = async (
    restaurantId: string,
    body: { amount: number; category?: string; vendor?: string; note?: string; spent_on?: string },
) => {
    const res = await backendCall('/expenses', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to add expense');}
    return res.json();
};

export const deleteExpense = async (restaurantId: string, id: string) => {
    const res = await backendCall(`/expenses/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!res?.ok) {throw new Error('Unable to delete expense');}
    return { acknowledged: true };
};

// --- Scheduled report delivery ----------------------------------------------
// A schedule is a ROW, not a scalar setting, so these are CRUD wrappers rather
// than the merge-on-omit POST /restaurant/settings shape — there is no single
// document to merge into. They sit under /reports/ deliberately: that prefix is
// already gated by the accounting plan feature and by the same permission that
// guards the interactive reports, so a 403 here is a plan or a role, not a bug.
//
// Every timestamp crosses the wire as an ISO string, and every `hour_local` is
// the RESTAURANT's wall clock — never the viewer's.

export interface ReportSchedule {
    id: string;
    outlet_id: string;
    name: string;
    /** 'sales' | 'pnl' | 'gst'. Typed wide on purpose: the backend CHECK is the authority. */
    report_key: string;
    /** 'daily' | 'weekly' | 'monthly' */
    frequency: string;
    hour_local: number;
    minute_local: number;
    /** Weekly only. 0 = Sunday. */
    weekday: number | null;
    /** Monthly only, 1–28 so "the 31st" can never silently skip February. */
    day_of_month: number | null;
    /** 'inbox' | 'email' */
    channel: string;
    /** Email only. Empty on an inbox schedule. */
    recipients: string[];
    format: string;
    enabled: boolean;
    last_occurrence_key: string | null;
    /** The last occurrence's outcome — 'delivered' or 'failed', null before the first run. */
    last_status: string | null;
    last_error: string | null;
    last_run_at: string | null;
    /** The schedule disables itself once this reaches the backend's limit. */
    consecutive_failures: number;
    created_at: string;
    updated_at: string;
}

export interface ReportDelivery {
    id: string;
    schedule_id: string;
    outlet_id: string;
    /** The tenant-local day the occurrence was due; null for a manual "run now". */
    occurrence_key: string | null;
    fire_at: string;
    period_from: string;
    period_to: string;
    timezone: string;
    /** 'claimed' | 'rendered' | 'delivered' | 'failed' | 'abandoned' */
    status: string;
    attempts: number;
    channel: string | null;
    /** Where an email delivery actually went — the addresses the server accepted. */
    delivered_to: string[] | null;
    artifact_name: string | null;
    artifact_bytes: number | null;
    artifact_truncated: boolean;
    error: string | null;
    delivered_at: string | null;
    created_at: string;
}

/** Create and edit share one shape — the backend fills every omitted key from
 *  the existing row on PATCH and from its own defaults on POST, so a one-key
 *  patch (`{ enabled: false }`) is safe and does not stamp stale values. */
export interface ReportSchedulePatch {
    name?: string;
    report_key?: string;
    frequency?: string;
    hour_local?: number;
    minute_local?: number;
    weekday?: number | null;
    day_of_month?: number | null;
    channel?: string;
    /** Required when channel is 'email'; the backend refuses an empty list. */
    recipients?: string[];
    format?: string;
    enabled?: boolean;
}

// null on an unreachable/refusing backend, so the UI can tell an outage apart
// from a tenant that simply has no schedules yet (same contract as getOpenBills).
export const getReportSchedules = async (restaurantId: string): Promise<ReportSchedule[] | null> => {
    const data = await backendJson<{ schedules: ReportSchedule[] }>(
        `/reports/schedules?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.schedules) ? data.schedules : null;
};

/**
 * Can THIS deployment send email at all?
 *
 * The server decides and says so on the same response as the list; the form
 * obeys rather than assuming. A capability a client has to guess at is the
 * recurring shape of this project's bugs — and the specific cost of guessing
 * wrong here is an owner saving a daily 8am email schedule that renders a report
 * every morning, fails to deliver it, and disables itself after five days.
 *
 * `null` on an unreachable backend, so "we could not ask" stays distinguishable
 * from "the answer is no" — the same contract getReportSchedules uses.
 */
export const getReportEmailAvailable = async (restaurantId: string): Promise<boolean | null> => {
    const data = await backendJson<{ email_available?: boolean }>(
        `/reports/schedules?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return typeof data?.email_available === 'boolean' ? data.email_available : null;
};

export const getReportDeliveries = async (
    restaurantId: string,
    opts: { scheduleId?: string; limit?: number } = {},
): Promise<ReportDelivery[] | null> => {
    const qs = new URLSearchParams({ restaurantId });
    if (opts.scheduleId) {qs.set('schedule_id', opts.scheduleId);}
    if (opts.limit) {qs.set('limit', String(opts.limit));}
    const data = await backendJson<{ deliveries: ReportDelivery[] }>(
        `/reports/deliveries?${qs.toString()}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.deliveries) ? data.deliveries : null;
};

export const createReportSchedule = async (restaurantId: string, input: ReportSchedulePatch): Promise<ReportSchedule> => {
    const res = await backendCall('/reports/schedules', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to create the scheduled report');}
    return res.json();
};

export const updateReportSchedule = async (restaurantId: string, id: string, input: ReportSchedulePatch): Promise<ReportSchedule> => {
    const res = await backendCall(`/reports/schedules/${encodeURIComponent(id)}`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to update the scheduled report');}
    return res.json();
};

// Archives rather than destroys — the delivery history and the at-most-once
// guard outlive the schedule, so the row stops firing but never disappears from
// the record. The endpoint is DELETE for REST's sake; the effect is an archive.
export const deleteReportSchedule = async (restaurantId: string, id: string): Promise<void> => {
    const res = await backendCall(`/reports/schedules/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to remove the scheduled report');}
};

/** QUEUES an extra occurrence — it is rendered by the next sweep tick, not
 *  inline — and returns its delivery id so the caller can point at the row. */
export const runReportScheduleNow = async (
    restaurantId: string,
    id: string,
): Promise<{ queued: boolean; delivery_id: string | null; note: string | null }> => {
    const res = await backendCall(`/reports/schedules/${encodeURIComponent(id)}/run-now`, restaurantId, { method: 'POST' });
    // 409 is the per-minute dedup working, not a failure: the same manual run is
    // already queued. Returned as an outcome rather than thrown so the caller can
    // say so plainly — throwing made the dashboard shout "Couldn't queue this
    // report" at a success the owner app was reporting as one.
    if (res?.status === 409) {return { queued: false, delivery_id: null, note: await readErrorMessage(res) };}
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to queue this report');}
    try {
        const j = await res.json();
        return { queued: true, delivery_id: typeof j?.delivery_id === 'string' ? j.delivery_id : null, note: null };
    } catch { return { queued: true, delivery_id: null, note: null }; }
};

// The rendered artifact. This is the ONLY place a scheduled report's figures are
// readable — the notification that announces one carries no money, because the
// bell is readable by every authenticated employee.
export const getReportDeliveryCsv = async (restaurantId: string, deliveryId: string): Promise<string> => {
    const res = await backendCall(
        `/reports/deliveries/${encodeURIComponent(deliveryId)}/download?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to download this report');}
    return res.text();
};

// --- Cash register / day-close ----------------------------------------------
export interface CashSession {
    id: string;
    opened_at: string;
    opened_by: string | null;
    opening_float: number;
    closed_at: string | null;
    closed_by: string | null;
    cash_sales: number | null;
    cash_refunds: number | null;
    cash_payouts: number | null;
    expected_cash: number | null;
    counted_cash: number | null;
    variance: number | null;
    notes: string | null;
    status: 'open' | 'closed';
}
export type CurrentCashSession = CashSession & { live_cash_sales: number; live_cash_refunds: number; live_expected: number };

export const getCurrentCashSession = async (restaurantId: string) =>
    backendJson<{ session: CurrentCashSession | null }>(`/cash/current?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId, { method: 'GET' });

export const getCashSessions = async (restaurantId: string, from?: string, to?: string) =>
    backendJson<{ sessions: CashSession[] }>(`/cash/sessions?restaurantId=${encodeURIComponent(restaurantId)}${qFromTo(from, to)}`, restaurantId, { method: 'GET' });

export const openCashSession = async (restaurantId: string, openingFloat: number) => {
    const res = await backendCall('/cash/open', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opening_float: openingFloat }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to open cash session');}
    return res.json() as Promise<CashSession>;
};

export const closeCashSession = async (
    restaurantId: string,
    body: { counted_cash: number; cash_payouts?: number; notes?: string },
) => {
    const res = await backendCall('/cash/close', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to close cash session');}
    return res.json() as Promise<CashSession>;
};

// --- Subscription & billing (tenant self-serve) -----------------------------
export interface BillingPlan { id: string; code: string; name: string; price_cents: number; features: Record<string, unknown>; limits: Record<string, unknown>; active: boolean }
export interface BillingSubscription { res_id: string; plan_id: string | null; status: string; trial_ends_at: string | null; current_period_end: string | null; pending_plan_id: string | null }
export interface BillingInvoice { id: string; plan_id: string | null; amount_cents: number; status: string; period_start: string | null; period_end: string | null; note: string | null; created_at: string }
export interface BillingInfo {
    configured: boolean;
    online_pay: boolean;
    subscription: BillingSubscription | null;
    plan: BillingPlan | null;
    pending_plan: BillingPlan | null;
    plans: BillingPlan[];
    invoices: BillingInvoice[];
}

export const getBilling = async (restaurantId: string): Promise<BillingInfo> => {
    const data = await backendJson<BillingInfo>(`/billing?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId, { method: 'GET' });
    if (!data) {throw new Error('Unable to load billing');}
    return data;
};

export const changePlan = async (restaurantId: string, planId: string): Promise<{ mode: 'upgrade' | 'downgrade_scheduled' | 'noop'; invoice?: BillingInvoice; plan: BillingPlan }> => {
    const res = await backendCall('/billing/change-plan', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: planId }) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to change plan');}
    return res.json();
};

export const billingPayCreate = async (restaurantId: string, invoiceId: string): Promise<{ order_id: string; amount: number; currency: string; key_id: string; invoice_id: string }> => {
    const res = await backendCall('/billing/pay/create', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: invoiceId }) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to start payment');}
    return res.json();
};

export const billingPayVerify = async (
    restaurantId: string,
    body: { invoice_id: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
): Promise<{ ok: boolean }> => {
    const res = await backendCall('/billing/pay/verify', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Payment verification failed');}
    return res.json();
};

// --- Waitlist / queue (staff) -----------------------------------------------
export interface WaitlistEntry {
    id: string;
    name: string;
    phone: string | null;
    party_size: number;
    status: 'waiting' | 'called' | 'seated' | 'cancelled' | 'no_show';
    position: number;
    minutes_waiting: number;
    pre_order: { id: string; name: string; price: number; quantity: number; note?: string }[];
    /** Confirmation state of the held pre_order — 'pending' means someone still
     *  has to send it to (or keep it from) the kitchen. */
    pre_order_status?: 'none' | 'pending' | 'confirmed' | 'declined' | 'claimed';
    party_members?: { name: string; phone: string; joined_at: string }[];
    table_name: string | null;
    created_at: string;
    called_at: string | null;
}

export const getWaitlist = async (restaurantId: string): Promise<WaitlistEntry[]> => {
    const d = await backendJson<{ entries: WaitlistEntry[] }>(`/waitlist?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId, { method: 'GET' });
    return Array.isArray(d?.entries) ? d.entries : [];
};

export const callWaitlistEntry = async (restaurantId: string, id: string) => {
    const res = await backendCall(`/waitlist/${encodeURIComponent(id)}/call`, restaurantId, { method: 'POST' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to call this party');}
    return res.json();
};

// Seating HOLDS the party's pre-order instead of placing it (backend contract:
// SeatWaitlistEntry marks it 'pending'). The seat response carries the held
// items as `pending_preorder`; confirmWaitlistPreorder / declineWaitlistPreorder
// below are how it reaches (or deliberately skips) the kitchen.
export interface PendingPreorder {
    items: { id: string; name: string; price: number; quantity: number; note?: string }[];
    subtotal: number;
    count: number;
}

export interface SeatWaitlistResult {
    success: boolean;
    placed_order_id: string | null;
    table_name: string;
    waitlist_id: string;
    pre_order_status: 'none' | 'pending' | 'confirmed' | 'declined' | 'claimed';
    pending_preorder: PendingPreorder | null;
    /** Who this seating put on the table, or why nobody. */
    assignment: TableAssignmentOutcome | null;
}

export const seatWaitlistEntry = async (restaurantId: string, id: string, tableName: string): Promise<SeatWaitlistResult> => {
    const res = await backendCall(`/waitlist/${encodeURIComponent(id)}/seat`, restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table_name: tableName }) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to seat this party');}
    return res.json() as Promise<SeatWaitlistResult>;
};

/** Seated parties whose held pre-order is still waiting on confirm/decline —
 *  the durable "confirm the pre-order for T4" queue behind the seat pop-up. */
export interface PendingPreorderEntry extends WaitlistEntry { minutes_since_seated: number }

export const getPendingPreorders = async (restaurantId: string): Promise<PendingPreorderEntry[]> => {
    const d = await backendJson<{ entries: PendingPreorderEntry[] }>(`/waitlist/pending-preorders?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId, { method: 'GET' });
    return Array.isArray(d?.entries) ? d.entries : [];
};

export const confirmWaitlistPreorder = async (restaurantId: string, id: string): Promise<{ success: boolean; placed_order_id: string | null; table_name: string; already: boolean }> => {
    const res = await backendCall(`/waitlist/${encodeURIComponent(id)}/preorder/confirm`, restaurantId, { method: 'POST' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to confirm the pre-order');}
    return res.json();
};

export const declineWaitlistPreorder = async (restaurantId: string, id: string): Promise<{ success: boolean }> => {
    const res = await backendCall(`/waitlist/${encodeURIComponent(id)}/preorder/decline`, restaurantId, { method: 'POST' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to update the pre-order');}
    return res.json();
};

export const cancelWaitlistEntry = async (restaurantId: string, id: string, status: 'cancelled' | 'no_show' = 'cancelled') => {
    const res = await backendCall(`/waitlist/${encodeURIComponent(id)}/cancel`, restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (!res?.ok) {throw new Error('Unable to update the queue');}
    return { ok: true };
};

// --- Staff notifications (bell) ---------------------------------------------
export interface NotificationRow {
    id: string;
    type: string;
    title: string;
    body: string | null;
    meta: Record<string, unknown> | null;
    /** The outlet the notification was raised on (may differ from the one being viewed). */
    outlet_id: string | null;
    read_at: string | null;
    created_at: string;
}

/**
 * Where a tapped notification should go, and whether the record is actually
 * reachable from the caller's CURRENT scope.
 *
 * `visible_here` — not `still_exists` — is the flag to gate navigation on: a
 * record can exist and still be unreachable (another outlet, aged out of the
 * live orders window, already seated, already decided). `message` is
 * ready-to-display copy for exactly those cases.
 */
export interface NotificationTarget {
    notification_id: string;
    type: string;
    /** Owner-app sidebar label ("Orders", "Bookings", …) or null when there is nothing to open. */
    module: string | null;
    entity: { type: string; id: string } | null;
    outlet_id: string | null;
    outlet_name: string | null;
    still_exists: boolean;
    visible_here: boolean;
    /** 'deleted' | 'other_outlet' | 'outside_live_window' | 'no_longer_in_queue' | 'already_resolved' | 'no_target' | 'unknown_entity' */
    reason_gone?: string;
    message?: string;
    /** Set only for 'other_outlet' — pass as the switcher's outlet id to reach the record. */
    switch_outlet_id: string | null;
    meta: Record<string, unknown>;
}

export const getNotifications = async (restaurantId: string): Promise<{ notifications: NotificationRow[]; unread: number }> => {
    const data = await backendJson<{ notifications: NotificationRow[]; unread: number }>(
        `/notifications?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? { notifications: [], unread: 0 };
};

export const getNotificationTarget = async (restaurantId: string, id: string): Promise<NotificationTarget | null> =>
    backendJson<NotificationTarget>(
        `/notifications/${encodeURIComponent(id)}/target?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

export const markNotificationRead = async (restaurantId: string, id: string): Promise<void> => {
    await backendCall(`/notifications/${encodeURIComponent(id)}/read`, restaurantId, { method: 'POST' });
};

export const markAllNotificationsRead = async (restaurantId: string): Promise<void> => {
    await backendCall('/notifications/read-all', restaurantId, { method: 'POST' });
};

export const deleteNotification = async (restaurantId: string, id: string): Promise<void> => {
    await backendCall(`/notifications/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
};

// --- Multi-outlet -----------------------------------------------------------
export interface OutletRow { id: string; outlet_name: string; outlet_add: string | null; outlet_phone: string | null; outlet_hours: string | null; is_active: boolean; is_default: boolean }
export interface OutletsRollup {
    days: number;
    outlets: { outlet_id: string; name: string; revenue: number; orders: number }[];
    totals: { revenue: number; orders: number; outlets: number };
}

export const getOutlets = async (restaurantId: string) =>
    backendJson<{ outlets: OutletRow[] }>(`/outlets?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId, { method: 'GET' });
export const getOutletsRollup = async (restaurantId: string, days = 30) =>
    backendJson<OutletsRollup>(`/outlets/rollup?restaurantId=${encodeURIComponent(restaurantId)}&days=${days}`, restaurantId, { method: 'GET' });

export const addOutlet = async (restaurantId: string, body: { name: string; address?: string; phone?: string; hours?: string }) => {
    const res = await backendCall('/outlets', restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to add outlet');}
    return res.json();
};
export const updateOutlet = async (restaurantId: string, id: string, body: { name?: string; address?: string; phone?: string; hours?: string }) => {
    const res = await backendCall(`/outlets/${encodeURIComponent(id)}`, restaurantId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to update outlet');}
    return { acknowledged: true };
};
export const setOutletActive = async (restaurantId: string, id: string, active: boolean) => {
    const res = await backendCall(`/outlets/${encodeURIComponent(id)}/active`, restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to update outlet');}
    return { acknowledged: true };
};
export const deleteOutlet = async (restaurantId: string, id: string) => {
    const res = await backendCall(`/outlets/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to delete outlet');}
    return { acknowledged: true };
};

// --- POS everyday ops (discount / split / merge / refund) -------------------
const postJson = async (path: string, restaurantId: string, body: unknown) => {
    const res = await backendCall(path, restaurantId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Request failed');}
    try { return await res.json(); } catch { return {}; }
};

// May come back applied ({applied: true}) or parked for manager approval
// ({pending: true, request_id}) when the restaurant's threshold is exceeded.
export interface BillDiscountResult {
    success?: boolean;
    applied?: boolean;
    discount_type?: 'percent' | 'flat' | null;
    discount_value?: number;
    pending?: boolean;
    request_id?: string;
    amount?: number;
    threshold?: number;
}
/**
 * Apply (or clear, with 0) a discount on a table's open bill.
 *
 * A 403 is RETURNED, not thrown, for the reason spelled out at `RefusedAction`:
 * the server's refusal here names the permission a discount of this size needs,
 * and a thrown message would be redacted in production before anyone read it.
 */
export const setBillDiscount = async (
    restaurantId: string,
    tableName: string,
    type: 'percent' | 'flat',
    value: number,
): Promise<BillDiscountResult | RefusedAction> => {
    const res = await backendCall('/bills/discount', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableName, type, value }),
    });
    if (!res) {throw new Error('Could not reach the server. The discount was not applied.');}
    if (res.status === 403) {
        return { refused: true, status: 403, error: await readErrorMessage(res) };
    }
    if (!res.ok) {throw new Error(await readErrorMessage(res));}
    try { return (await res.json()) as BillDiscountResult; } catch { return {}; }
};

export interface DiscountRequest {
    id: string;
    bill_id: string;
    table_name: string | null;
    requested_by: string | null;
    discount_type: 'percent' | 'flat';
    discount_value: number;
    amount: number;
    reason: string | null;
    status: 'pending' | 'approved' | 'rejected';
    decided_by: string | null;
    decided_at: string | null;
    created_at: string;
}
export const getDiscountRequests = async (restaurantId: string, status = 'pending'): Promise<DiscountRequest[]> => {
    const res = await backendCall(`/discount-requests?status=${encodeURIComponent(status)}`, restaurantId, { method: 'GET' });
    if (!res?.ok) {return [];}
    try { const j = await res.json(); return Array.isArray(j?.requests) ? j.requests : []; } catch { return []; }
};
export const decideDiscountRequest = async (restaurantId: string, requestId: string, approve: boolean): Promise<{ success: boolean; request?: DiscountRequest }> =>
    postJson(`/discount-requests/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'reject'}`, restaurantId, {});

// Re-open a closed bill (admin only, within the configured window).
export const reopenBill = async (restaurantId: string, billId: string): Promise<{ success: boolean; restored_orders?: number; window_min?: number }> =>
    postJson(`/bills/${encodeURIComponent(billId)}/reopen`, restaurantId, {});

// --- Kitchen: hold-and-fire + expo/pass screen ------------------------------
// Fire held course items: stamps fired_at, clears course_hold, starts timers.
export const fireOrderItems = async (restaurantId: string, orderId: string, itemIds: string[]): Promise<{ success: boolean; fired: string[] }> =>
    postJson(`/orders/${encodeURIComponent(orderId)}/fire`, restaurantId, { item_ids: itemIds });

// Bark an order: the expo announces it to the kitchen — stamps barked_at and
// starts the order/dish prep timers (they stay idle until the bark).
export const barkOrder = async (restaurantId: string, orderId: string): Promise<{ success: boolean; barked_at?: string; already_barked?: boolean }> =>
    postJson(`/orders/${encodeURIComponent(orderId)}/bark`, restaurantId, {});

export interface ExpoItem { name: string; qty: number; station: string | null; status: 'served' | 'preparing' | 'held' | 'unbarked' }
export interface ExpoTable { table: string; items: ExpoItem[]; ready_count: number; pending_count: number; source?: string | null }
export const getKdsExpo = async (restaurantId: string): Promise<{ tables: ExpoTable[] }> => {
    const res = await backendCall('/kds/expo', restaurantId, { method: 'GET' });
    if (!res?.ok) {return { tables: [] };}
    try { const j = await res.json(); return { tables: Array.isArray(j?.tables) ? j.tables : [] }; } catch { return { tables: [] }; }
};
// --- Payment modes (payment_methods in /restaurant/settings) ----------------
// READ by every settle picker, so it is readable by any signed-in staff (not a
// privileged settings field). THROWS on failure rather than inventing defaults:
// the Settings editor must not show an owner a list that is not theirs. Pickers
// that must never block a settle use usePaymentMethods, which falls back.
export const getPaymentMethods = async (restaurantId: string): Promise<PaymentMethodConfig[]> => {
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to read the payment modes');}
    const j = await res.json();
    return readPaymentMethods(j?.payment_methods);
};
// POSTs ONLY `payment_methods`: the settings POST is merge-on-omit, and on the
// server a payment-modes save is itself a merge that keeps stored modes this
// list leaves out (removal is enabled:false). A refused save is a 400 whose
// `details` names every problem, shown to the owner as-is.
export const savePaymentMethods = async (restaurantId: string, methods: PaymentMethodConfig[]): Promise<PaymentMethodConfig[]> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_methods: methods }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the payment modes');}
    try { const j = await res.json(); return readPaymentMethods(j?.payment_methods); } catch { return methods; }
};

// --- Kitchen sections (managed list in /restaurant/settings) ----------------
// Ordered list of kitchen sections (e.g. Tandoor/Curry/Bar); menu items point
// at one via their `station` and the KDS offers one display per section.
export const getKitchenSections = async (restaurantId: string): Promise<string[]> => {
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return [];}
    try { const j = await res.json(); return Array.isArray(j?.kitchen_sections) ? j.kitchen_sections.map((s: unknown) => String(s)) : []; } catch { return []; }
};
export const saveKitchenSections = async (restaurantId: string, sections: string[]): Promise<string[]> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kitchen_sections: sections }),
    });
    if (!res?.ok) {throw new Error('Unable to save kitchen sections');}
    try { const j = await res.json(); return Array.isArray(j?.kitchen_sections) ? j.kitchen_sections.map((s: unknown) => String(s)) : sections; } catch { return sections; }
};
// Rename a section — the backend also cascades the new name onto every menu
// item that pointed at the old one.
export const renameKitchenSection = async (restaurantId: string, from: string, to: string): Promise<{ success: boolean; updated_items?: number; kitchen_sections?: string[] }> =>
    postJson('/kitchen-sections/rename', restaurantId, { from, to });

// --- Configurable menu badges -----------------------------------------------
// The CATALOGUE is restaurant-wide; the TAGS live on each item. Both are the
// tenant's, and an absent catalogue means no badge renders anywhere — so these
// calls never invent a default set, they only ever return what was configured.

export interface MenuBadgeCatalogue {
    badges: MenuBadge[];
    /** The starter set the server offers; NOT applied until the owner says so. */
    presets: MenuBadge[];
    per_item_max: number;
    label_max: number;
}

export const getMenuBadges = async (restaurantId: string): Promise<MenuBadgeCatalogue> => {
    const res = await backendCall('/menu/badges', restaurantId, { method: 'GET' });
    const empty: MenuBadgeCatalogue = { badges: [], presets: [], per_item_max: 8, label_max: 24 };
    if (!res?.ok) {return empty;}
    try {
        const j = await res.json();
        return {
            badges: parseBadgeCatalogue(j?.badges),
            presets: parseBadgeCatalogue(j?.presets),
            per_item_max: Number(j?.per_item_max) > 0 ? Number(j.per_item_max) : 8,
            label_max: Number(j?.label_max) > 0 ? Number(j.label_max) : 24,
        };
    } catch { return empty; }
};

/**
 * Replace the catalogue. `releaseTagged` confirms untagging the dishes that
 * still carry a dietary/safety badge being removed — without it the server
 * answers 409 and changes nothing, which is what MenuBadgeInUseError carries
 * back so the editor can ask rather than just failing.
 */
export const saveMenuBadges = async (
    restaurantId: string,
    badges: MenuBadge[],
    opts?: { releaseTagged?: boolean },
): Promise<{ badges: MenuBadge[]; released: number }> => {
    const res = await backendCall('/menu/badges', restaurantId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badges, ...(opts?.releaseTagged ? { release_tagged: true } : {}) }),
    });
    if (!res) {throw new Error('Request failed');}
    if (res.status === 409) {
        const payload = await res.json().catch(() => null);
        throw new MenuBadgeInUseError(
            typeof payload?.error === 'string' ? payload.error : 'Some dishes still carry that badge.',
            Array.isArray(payload?.badges) ? payload.badges : [],
        );
    }
    if (!res.ok) {throw new Error(await readErrorMessage(res));}
    const j = await res.json().catch(() => ({}));
    return { badges: parseBadgeCatalogue(j?.badges), released: Number(j?.released ?? 0) };
};

/**
 * Bulk-tag dishes. Sends ONLY ids and tags — never whole items — so a stale menu
 * snapshot in the browser cannot overwrite an image, a recipe or a price. That
 * is deliberate: the full-menu replace is what once wiped 56 dishes.
 */
export const tagMenuBadges = async (
    restaurantId: string,
    items: { id: string; badges: string[] }[],
): Promise<{ updated: number }> => {
    const j = await postJson('/menu/badges/tag', restaurantId, { items });
    return { updated: Number(j?.updated ?? 0) };
};

// --- Queue pre-order menu (what a QUEUING walk-in may order) -----------------
// Which dishes the waitlist pre-order list offers and how it presents itself.
// The rule is enforced server-side (GET /qr/:slug/queue-menu serves only the
// allowed dishes, and the pre-order write refuses the rest) — this is only the
// editor's read/write. An ABSENT config means the whole menu, exactly as before
// the feature existed, which is why `reset` is its own call rather than a
// payload of empty values.
export type QueueMenuMode = 'all' | 'include' | 'exclude';
export interface QueueMenuConfig {
    /** 'all' = the whole menu; 'include' = only what is listed; 'exclude' = all but. */
    mode: QueueMenuMode;
    /** Menu item ids the mode applies to. */
    items: string[];
    /** Category names the mode applies to (case-insensitive). */
    categories: string[];
    /** Categories floated to the front, in this order; the rest stay alphabetical. */
    category_order: string[];
    /** '' means "keep the queue page's own localised copy". */
    headline: string;
    intro: string;
    show_prices: boolean;
}
export interface QueueMenuItem {
    id: string;
    name: string;
    price: number;
    category: string;
    available?: boolean;
    /** Whether the CURRENT rule lets this dish onto the queue menu. Computed by
     *  the same function the guest endpoint uses, so the editor cannot disagree
     *  with what a queuing guest is actually served. */
    queue_included: boolean;
}
export interface QueueMenuConfigPayload {
    config: QueueMenuConfig;
    /** False when the tenant never customized anything (the whole menu). */
    configured: boolean;
    /** The master on/off — a queue page with no pre-order section at all. */
    queue_show_menu: boolean;
    items: QueueMenuItem[];
    /** Categories in the order the queue page will render them. */
    categories: string[];
}

const QUEUE_MENU_FALLBACK: QueueMenuConfigPayload = {
    config: { mode: 'all', items: [], categories: [], category_order: [], headline: '', intro: '', show_prices: true },
    configured: false,
    queue_show_menu: true,
    items: [],
    categories: [],
};

export const getQueueMenuConfig = async (restaurantId: string): Promise<QueueMenuConfigPayload> => {
    const res = await backendCall('/queue-menu-config', restaurantId, { method: 'GET' });
    if (!res?.ok) {return QUEUE_MENU_FALLBACK;}
    try { return (await res.json()) as QueueMenuConfigPayload; } catch { return QUEUE_MENU_FALLBACK; }
};

/** Partial saves are fine: keys omitted keep their stored value, and a key sent
 *  as null is cleared back to its default (that is the server's merge rule). */
export const saveQueueMenuConfig = async (
    restaurantId: string,
    patch: Partial<Record<keyof QueueMenuConfig, unknown>>,
): Promise<{ config: QueueMenuConfig; configured: boolean }> =>
    postJson('/queue-menu-config', restaurantId, patch);

/** Back to the whole menu, bit-for-bit — the only way to un-configure. */
export const resetQueueMenuConfig = async (restaurantId: string): Promise<{ config: QueueMenuConfig; configured: boolean }> =>
    postJson('/queue-menu-config', restaurantId, { reset: true });

// --- Require-table-OTP toggle (boolean in /restaurant/settings) --------------
// When enabled, guests must enter the 4-digit per-table code shown by staff
// before the QR order page lets them order. Mirrors kitchen_sections: an unset
// column reads back as false.
export const getRequireTableOtp = async (restaurantId: string): Promise<boolean> => {
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return false;}
    try { const j = await res.json(); return j?.require_table_otp === true; } catch { return false; }
};
export const setRequireTableOtp = async (restaurantId: string, enabled: boolean): Promise<boolean> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ require_table_otp: enabled }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the table OTP setting');}
    try { const j = await res.json(); return j?.require_table_otp === true; } catch { return enabled; }
};

// --- Valet parking on the guest feedback form (feedback_config.valet_enabled) --
// One switch for the whole valet part of the form: the vehicle-number step AND
// the "Valet Parking" rating (see src/lib/feedback-form.ts). Unset reads as off,
// the backend default.
//
// THE SETTER SENDS THE WHOLE FORM, FRESHLY READ, WITH ONLY valet_enabled CHANGED.
// The backend now writes feedback settings as a patch, so a one-key body would be
// enough there — but a backend from before that change REPLACES the form with
// defaults for every key a body leaves out, and backend and dashboard deploy
// separately (and roll back separately). Read-then-write is correct against both:
// the owner's title, welcome text, review link and categories go back exactly as
// the server just returned them.
export const getFeedbackValetEnabled = async (restaurantId: string): Promise<boolean> => {
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return false;}
    try { const j = await res.json(); return j?.feedback_config?.valet_enabled === true; } catch { return false; }
};
export const setFeedbackValetEnabled = async (restaurantId: string, enabled: boolean): Promise<boolean> => {
    const current = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!current?.ok) {throw new Error(current ? await readErrorMessage(current) : 'Unable to read the feedback form settings');}
    let form: Record<string, unknown> = {};
    try {
        const j = await current.json();
        if (j?.feedback_config && typeof j.feedback_config === 'object') {form = j.feedback_config as Record<string, unknown>;}
    } catch {
        // An unreadable settings document must not become a write of defaults.
        throw new Error('Unable to read the feedback form settings');
    }
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback_config: { ...form, valet_enabled: enabled } }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the valet setting');}
    try { const j = await res.json(); return j?.feedback_config?.valet_enabled === true; } catch { return enabled; }
};

// --- Which kitchen docket this restaurant prints (kot_print_style) -----------
// The reference docket is drawn as a raster image; a thermal printer that cannot
// draw one answers it with BLANK PAPER rather than an error, and on a kitchen
// printer that is an order nobody cooks. This is the owner's switch back to the
// plain text docket, and it travels in the same /restaurant/settings document as
// the bill printing fields below.
//
// ONE KEY IN, ONE KEY OUT. Unlike the feedback form beside it, this is a scalar
// the backend writes only when it is present, so there is nothing to read first
// and nothing a one-key body can clobber.
//
// READABLE BY ANY SIGNED-IN STAFF (it is not in SETTINGS_PRIVILEGED_FIELDS), so
// the card renders the real value for whoever can open Settings; WRITING is
// gated on "Manage Restaurant Settings" server-side, which is what canEdit
// mirrors on the card.
//
// BOTH DOCKET SETTINGS COME FROM ONE READ — the style and, since the client
// asked for smaller type, the reference docket's text size (kot_text_size).
//
// `supported` is false only for a settings document that lacks the keys — a
// backend from before these settings, which prints only the classic docket and
// ignores a save of them; the card is not shown against it. A read that FAILED
// cannot tell, and this card is the recovery control somebody may be reaching
// for while the backend is having a bad minute, so it stays on screen with the
// defaults; a save to a backend without the setting still raises (below).
export const getKotDocketSettings = async (restaurantId: string): Promise<{ style: KotPrintStyle; textSize: KotTextSize; supported: boolean }> => {
    const fallback = { style: KOT_PRINT_STYLE_DEFAULT, textSize: KOT_TEXT_SIZE_DEFAULT, supported: true };
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return fallback;}
    let settings: unknown;
    try { settings = await res.json(); } catch { return fallback; }
    return readKotDocketSettings(settings);
};

export const setKotPrintStyle = async (restaurantId: string, style: KotPrintStyle): Promise<KotPrintStyle> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kot_print_style: style }),
    });
    // THE FAILURE IS RAISED, never swallowed into a "saved" state. The person
    // clicking this is usually trying to stop a kitchen printer producing blank
    // tickets; a card that showed the new choice after a failed save would tell
    // them the problem is elsewhere. The backend 400s a value it does not know
    // rather than coercing it, and readErrorMessage carries that sentence up.
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the KOT print style');}
    // Echo what the server stored, not what was asked for — the two can differ
    // only if something is wrong, and that is worth seeing. A settings document
    // WITHOUT the key is a backend that ignored it: savedKotPrintStyle raises.
    let reply: unknown;
    try { reply = await res.json(); } catch { return style; }
    return savedKotPrintStyle(reply, style);
};

// The reference docket's type size — one key in, one key out, on exactly the
// terms of setKotPrintStyle above: a refused save RAISES (the backend 400s a
// size it does not know), so does a reply that shows nothing was stored, and
// the card shows what the server stored.
export const setKotTextSize = async (restaurantId: string, size: KotTextSize): Promise<KotTextSize> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kot_text_size: size }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the KOT text size');}
    let reply: unknown;
    try { reply = await res.json(); } catch { return size; }
    return savedKotTextSize(reply, size);
};

// --- Printed-bill identity + the sentence above the bill QR ------------------
// The registered entity and GST number printed under the restaurant name, and
// the tenant's own line above the feedback/valet QR. All three live on
// "Restaurant" and travel in the same /restaurant/settings document as the OTP
// toggle above.
//
// READABLE BY ANY SIGNED-IN STAFF, deliberately: these are the fields the PRINT
// PAGE needs, and the cashier who prints a bill is usually not an admin. They
// are not in SETTINGS_PRIVILEGED_FIELDS on the backend, so the redacted
// (non-admin) settings document still carries them. WRITING them still requires
// the settings permission — the POST is admin-gated server-side.
export interface BillPrintSettings {
    // '' means "not set" for all three, and an unset field prints NOTHING on the
    // bill rather than an empty label. Never coerce these to a placeholder.
    legalName: string;
    gstin: string;
    qrNote: string;
    // What the printer falls back to when qrNote is '' — supplied by the backend
    // so neither the editor nor the print page hardcodes the valet sentence.
    qrNoteDefault: string;
    qrNoteMax: number;
    // Whether the customer bill prints the feedback/valet QR at all (migration
    // 047). The backend reads an unset column as ON, and so does this: a server
    // that predates the key has only ever printed the QR, so a missing key is
    // `true`, never `false`.
    showQr: boolean;
}

const BILL_QR_NOTE_MAX_FALLBACK = 120;

export const getBillPrintSettings = async (restaurantId: string): Promise<BillPrintSettings> => {
    const empty: BillPrintSettings = { legalName: '', gstin: '', qrNote: '', qrNoteDefault: '', qrNoteMax: BILL_QR_NOTE_MAX_FALLBACK, showQr: true };
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return empty;}
    try {
        const j = await res.json();
        return {
            legalName: typeof j?.bill_legal_name === 'string' ? j.bill_legal_name : '',
            gstin: typeof j?.bill_gstin === 'string' ? j.bill_gstin : '',
            qrNote: typeof j?.bill_qr_note === 'string' ? j.bill_qr_note : '',
            qrNoteDefault: typeof j?.bill_qr_note_default === 'string' ? j.bill_qr_note_default : '',
            qrNoteMax: typeof j?.bill_qr_note_max === 'number' ? j.bill_qr_note_max : BILL_QR_NOTE_MAX_FALLBACK,
            showQr: j?.bill_show_qr !== false,
        };
    } catch { return empty; }
};

// Sends only the keys the caller actually passed. Sending '' is how an owner
// CLEARS a field (and clearing the note restores the built-in valet line), so an
// empty string must reach the backend — presence, not truthiness, decides.
export const setBillPrintSettings = async (
    restaurantId: string,
    patch: { legalName?: string; gstin?: string; qrNote?: string; showQr?: boolean },
): Promise<BillPrintSettings> => {
    const body: Record<string, string | boolean> = {};
    if (patch.legalName !== undefined) {body.bill_legal_name = patch.legalName;}
    if (patch.gstin !== undefined) {body.bill_gstin = patch.gstin;}
    if (patch.qrNote !== undefined) {body.bill_qr_note = patch.qrNote;}
    // A real boolean or nothing: the backend writes only an explicit boolean.
    if (typeof patch.showQr === 'boolean') {body.bill_show_qr = patch.showQr;}
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the bill printing settings');}
    try {
        const j = await res.json();
        return {
            legalName: typeof j?.bill_legal_name === 'string' ? j.bill_legal_name : '',
            gstin: typeof j?.bill_gstin === 'string' ? j.bill_gstin : '',
            qrNote: typeof j?.bill_qr_note === 'string' ? j.bill_qr_note : '',
            qrNoteDefault: typeof j?.bill_qr_note_default === 'string' ? j.bill_qr_note_default : '',
            qrNoteMax: typeof j?.bill_qr_note_max === 'number' ? j.bill_qr_note_max : BILL_QR_NOTE_MAX_FALLBACK,
            showQr: j?.bill_show_qr !== false,
        };
    } catch {
        return { legalName: patch.legalName ?? '', gstin: patch.gstin ?? '', qrNote: patch.qrNote ?? '', qrNoteDefault: '', qrNoteMax: BILL_QR_NOTE_MAX_FALLBACK, showQr: patch.showQr ?? true };
    }
};

// --- Restaurant timezone (IANA id in /restaurant/settings) ------------------
// The zone every timestamp in the dashboard is rendered in, and the zone a
// "day" means for tally. Read with the rest of the settings document; the
// selectable list comes from its own endpoint because it is derived from the
// runtime's ICU data rather than stored per tenant.
//
// The backend 400s an unknown zone rather than silently coercing it, so a failed
// save must surface — `sanitizeTimezone` on this side is only for RENDERING a
// value that is already stored, never for deciding what to send.
export const getRestaurantTimezone = async (restaurantId: string): Promise<string> => {
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return '';}
    try { const j = await res.json(); return typeof j?.timezone === 'string' ? j.timezone : ''; } catch { return ''; }
};

export interface TimezoneOptions {
    /** Every zone the backend will accept, already unioned with UTC/default/current. */
    timezones: string[];
    /** The zone in force for this restaurant right now. */
    current: string;
    /** What a tenant that never chose one gets. */
    default: string;
}
export const getTimezoneOptions = async (restaurantId: string): Promise<TimezoneOptions> => {
    const fallback: TimezoneOptions = { timezones: [], current: '', default: 'Asia/Kolkata' };
    const res = await backendCall('/restaurant/timezones', restaurantId, { method: 'GET' });
    if (!res?.ok) {return fallback;}
    try {
        const j = await res.json();
        return {
            timezones: Array.isArray(j?.timezones) ? j.timezones.map((s: unknown) => String(s)) : [],
            current: typeof j?.current === 'string' ? j.current : '',
            default: typeof j?.default === 'string' ? j.default : 'Asia/Kolkata',
        };
    } catch {
        return fallback;
    }
};

export const setRestaurantTimezone = async (restaurantId: string, timezone: string): Promise<string> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the key being changed — /restaurant/settings merges on omit, so
        // sending the whole document would risk stamping stale values (taxes,
        // payment keys) that this form never loaded.
        body: JSON.stringify({ timezone }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save the restaurant timezone');}
    try { const j = await res.json(); return typeof j?.timezone === 'string' ? j.timezone : timezone; } catch { return timezone; }
};

// --- Customer-page branding (brand_config) ----------------------------------
// The guest-page customization shown on every customer surface (QR order page,
// feedback form, valet step). Read the resolved config, the curated font
// allowlist and the live/legacy field split from /restaurant/settings (admin),
// and save via POST /restaurant/branding (merge-on-omit: only the keys sent are
// overwritten). Mirrors the OTP helpers.
//
// The backend is the authority on which keys still DO something: brand_fields
// splits them into `live` (render a control) and `legacy` (stored for tenants who
// set them once, but the dark guest design derives everything from the accent, so
// they paint nothing). brand_field_options carries the accepted enum values.
export interface BrandFieldSplit { live: string[]; legacy: string[] }
export interface BrandFieldOptions {
    font?: string[];
    header_style?: string[];
    button_shape?: string[];
    surface_style?: string[];
    scheme?: string[];
    font_scale?: string[];
    card_shape?: string[];
}
// One preset scheme as the backend advertises it: id/label/hint plus the shell
// swatches (background/surface/text + semantic states) the picker previews.
export interface BrandSchemeMeta {
    id: string;
    label: string;
    hint?: string;
    preview: Record<string, string>;
}
// A WCAG clamp the server applied to keep guest text readable — surfaced so the
// editor can tell the owner why the served colour differs from the picked one.
export interface BrandContrastNote {
    role: string;
    requested: string;
    applied: string;
    against: string;
    ratio: number;
    minimum: number;
}
// brand_config as the editor writes it — `surface_style` (panel material) is the
// newer live key; the guest pages read the same shape via GuestBrandConfig.
// The revived palette roles the guest surfaces now consume. BrandConfig (shared
// with the guest theme helper) predates them, so they are declared here until it
// catches up — every one is optional and blank means "derive from the accent".
// Colour roles are nullable on WRITE: null clears the stored override so
// "Auto" genuinely resets a role (merge-on-omit keeps whatever is stored).
export type BrandConfigPatch = Omit<BrandConfig, "color_secondary" | "color_bg" | "color_card" | "color_text"> & {
    surface_style?: string;
    color_secondary?: string | null;
    color_bg?: string | null;
    color_card?: string | null;
    color_text?: string | null;
    color_accent?: string | null;
    color_success?: string | null;
    color_warning?: string | null;
    color_error?: string | null;
    // Preset scheme + the two geometry/scale knobs. null on write = clear the
    // stored key (back to default); the colour roles clear the same way.
    scheme?: string | null;
    font_scale?: string | null;
    card_shape?: string | null;
    // Gradient washes (hero / buttons / page background): two hex stops + an
    // angle in degrees per surface. null on write DELETES the stored key —
    // absent is the contract for "render the shipped derived wash".
    header_grad_from?: string | null;
    header_grad_to?: string | null;
    header_grad_angle?: number | null;
    button_grad_from?: string | null;
    button_grad_to?: string | null;
    button_grad_angle?: number | null;
    bg_grad_from?: string | null;
    bg_grad_to?: string | null;
    bg_grad_angle?: number | null;
};
export interface BrandConfigSettings {
    brand_config: BrandConfigPatch;
    brand_fonts: string[];
    brand_fields?: BrandFieldSplit;
    brand_field_options?: BrandFieldOptions;
    brand_schemes?: BrandSchemeMeta[];
    brand_contrast?: BrandContrastNote[];
}
export const getBrandConfig = async (restaurantId: string): Promise<BrandConfigSettings> => {
    const fallback: BrandConfigSettings = {
        brand_config: { font: 'Inter', header_style: 'gradient', button_shape: 'rounded', surface_style: 'frosted' },
        brand_fonts: [],
    };
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return fallback;}
    try {
        const j = await res.json();
        const strings = (v: unknown): string[] | undefined =>
            Array.isArray(v) ? v.map((s: unknown) => String(s)) : undefined;
        const split = j?.brand_fields && typeof j.brand_fields === 'object'
            ? { live: strings(j.brand_fields.live) ?? [], legacy: strings(j.brand_fields.legacy) ?? [] }
            : undefined;
        const opts = j?.brand_field_options && typeof j.brand_field_options === 'object'
            ? {
                font: strings(j.brand_field_options.font),
                header_style: strings(j.brand_field_options.header_style),
                button_shape: strings(j.brand_field_options.button_shape),
                surface_style: strings(j.brand_field_options.surface_style),
                scheme: strings(j.brand_field_options.scheme),
                font_scale: strings(j.brand_field_options.font_scale),
                card_shape: strings(j.brand_field_options.card_shape),
            }
            : undefined;
        return {
            brand_config: (j?.brand_config && typeof j.brand_config === 'object') ? (j.brand_config as BrandConfigPatch) : fallback.brand_config,
            brand_fonts: strings(j?.brand_fonts) ?? [],
            ...(split ? { brand_fields: split } : {}),
            ...(opts ? { brand_field_options: opts } : {}),
            ...(Array.isArray(j?.brand_schemes) ? { brand_schemes: j.brand_schemes as BrandSchemeMeta[] } : {}),
            ...(Array.isArray(j?.brand_contrast) ? { brand_contrast: j.brand_contrast as BrandContrastNote[] } : {}),
        };
    } catch {
        return fallback;
    }
};
export const saveBrandConfig = async (
    restaurantId: string,
    brandConfig: BrandConfigPatch,
): Promise<{ brand_config: BrandConfigPatch; brand_contrast: BrandContrastNote[] }> => {
    const res = await backendCall('/restaurant/branding', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_config: brandConfig }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save customer-page branding');}
    try {
        const j = await res.json();
        return {
            brand_config: (j?.brand_config && typeof j.brand_config === 'object') ? (j.brand_config as BrandConfigPatch) : brandConfig,
            // The server's WCAG clamp note (empty when the palette is readable
            // as-is) — the editor repeats it to the owner.
            brand_contrast: Array.isArray(j?.brand_contrast) ? (j.brand_contrast as BrandContrastNote[]) : [],
        };
    } catch { return { brand_config: brandConfig, brand_contrast: [] }; }
};

// --- Guest-menu posters -----------------------------------------------------
// Promotional images shown with the guest menu (/order and the queue page).
// Backed by the "Posters" table, gated by Manage Branding, and scheduled by
// CALENDAR KEY in the restaurant's own timezone — see the backend's posters.ts.
export type PosterPlacement = 'top' | 'menu';
export interface PosterRecord {
    id: string;
    image_url: string;
    title: string;
    placement: PosterPlacement;
    sort_order: number;
    /** Inclusive YYYY-MM-DD bounds in the RESTAURANT's zone; null = open-ended. */
    start_on: string | null;
    end_on: string | null;
    active: boolean;
    /** Intrinsic size of the stored image, so a preview can reserve its box. */
    width: number;
    height: number;
    created_at: string;
}
export interface PosterLibrary {
    posters: PosterRecord[];
    /** TODAY as the restaurant sees it. The editor's "showing now" badge is
     *  computed against THIS and never against the browser's clock — an owner
     *  administering from a different country would otherwise be told a poster is
     *  live when their diners cannot see it. */
    today: string;
    timezone: string;
    placements: { value: PosterPlacement; label: string; hint: string }[];
    max_posters: number;
    max_upload_bytes: number;
}
/** A poster create, as the editor sends it: the image plus its metadata in ONE
 *  request, so a picked-then-abandoned file never becomes an orphan in storage. */
export interface PosterCreate {
    image_base64: string;
    content_type: string;
    title?: string;
    placement?: PosterPlacement;
    sort_order?: number;
    start_on?: string | null;
    end_on?: string | null;
    active?: boolean;
}
/** Merge-on-omit: a key left out keeps its stored value; a date sent as null
 *  clears that bound (which is how "remove the end date" is expressed). */
export type PosterPatch = Partial<Omit<PosterRecord, 'id' | 'image_url' | 'width' | 'height' | 'created_at'>>;

const EMPTY_POSTER_LIBRARY: PosterLibrary = {
    posters: [],
    today: '',
    timezone: 'Asia/Kolkata',
    placements: [
        { value: 'top', label: 'Banner', hint: 'Full-width strip under the header.' },
        { value: 'menu', label: 'With the menu', hint: 'A card above the dishes.' },
    ],
    max_posters: 24,
    max_upload_bytes: 3 * 1024 * 1024,
};

export const getPosters = async (restaurantId: string): Promise<PosterLibrary> => {
    const res = await backendCall('/posters', restaurantId, { method: 'GET' });
    // A tenant whose backend predates this feature (or a caller without Manage
    // Branding) gets an empty library rather than an error card — the editor then
    // renders its own "no posters yet" state, which is the truth either way.
    if (!res?.ok) {return EMPTY_POSTER_LIBRARY;}
    try {
        const j = await res.json();
        return {
            posters: Array.isArray(j?.posters) ? (j.posters as PosterRecord[]) : [],
            today: typeof j?.today === 'string' ? j.today : '',
            timezone: typeof j?.timezone === 'string' ? j.timezone : EMPTY_POSTER_LIBRARY.timezone,
            placements: Array.isArray(j?.placements) && j.placements.length > 0
                ? (j.placements as PosterLibrary['placements'])
                : EMPTY_POSTER_LIBRARY.placements,
            max_posters: Number(j?.max_posters) || EMPTY_POSTER_LIBRARY.max_posters,
            max_upload_bytes: Number(j?.max_upload_bytes) || EMPTY_POSTER_LIBRARY.max_upload_bytes,
        };
    } catch {
        return EMPTY_POSTER_LIBRARY;
    }
};

export const createPoster = async (restaurantId: string, poster: PosterCreate): Promise<PosterRecord> => {
    const res = await backendCall('/posters', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poster),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save poster');}
    return await res.json() as PosterRecord;
};

export const updatePoster = async (restaurantId: string, id: string, patch: PosterPatch): Promise<PosterRecord> => {
    const res = await backendCall(`/posters/${encodeURIComponent(id)}`, restaurantId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save poster');}
    return await res.json() as PosterRecord;
};

export const deletePoster = async (restaurantId: string, id: string): Promise<void> => {
    const res = await backendCall(`/posters/${encodeURIComponent(id)}`, restaurantId, { method: 'DELETE' });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to delete poster');}
};

// --- Inventory categories (managed list in /restaurant/settings) ------------
// Ordered list of ingredient categories (Vegetable/Meat/Dairy/...); inventory
// items carry one via their `category` field. Mirrors kitchen_sections: an
// unset column reads back as the defaults, an explicit [] clears it.
export const getInventoryCategories = async (restaurantId: string): Promise<string[]> => {
    const res = await backendCall('/restaurant/settings', restaurantId, { method: 'GET' });
    if (!res?.ok) {return [];}
    try { const j = await res.json(); return Array.isArray(j?.inventory_categories) ? j.inventory_categories.map((s: unknown) => String(s)) : []; } catch { return []; }
};
export const saveInventoryCategories = async (restaurantId: string, categories: string[]): Promise<string[]> => {
    const res = await backendCall('/restaurant/settings', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_categories: categories }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save inventory categories');}
    try { const j = await res.json(); return Array.isArray(j?.inventory_categories) ? j.inventory_categories.map((s: unknown) => String(s)) : categories; } catch { return categories; }
};
// Rename a category — the backend also cascades the new name onto every
// inventory item that pointed at the old one.
export const renameInventoryCategory = async (restaurantId: string, from: string, to: string): Promise<{ success: boolean; updated_items?: number; inventory_categories?: string[] }> =>
    postJson('/inventory-categories/rename', restaurantId, { from, to });

export interface SplitPart { label: string; subtotal: number; total: number }
/** POST /print/bill/split's answer. */
export interface PrintSplitBillsResult {
    success: boolean;
    parts: number;
    jobs: { index: number; of: number; label: string; grandTotal: number; destination: string | null }[];
    /**
     * CLIENT ITEM 6 — a split print is a print of the bill, so the server opens
     * (or finds) the next party's seat and names it, with its sentence. Absent
     * on a backend older than migration 053. Read with nextPartyAfterPrint.
     */
    next_party_table?: string | null;
    next_party_message?: string | null;
}
/**
 * F3 — print the split, one document per part.
 *
 * The parts are NOT sent: the server recomputes them from the bill as it stands
 * at print time. Between the preview and the print somebody adds a round or a
 * coupon lands, and printing the parts this screen is holding would hand a guest
 * a bill that sums to a total nobody owes. So this posts the same INPUTS the
 * preview used and the server derives the paper itself.
 */
export const printSplitBills = async (
    restaurantId: string,
    tableName: string,
    input: { mode?: 'even' | 'item' | 'section'; parts?: number; groups?: unknown[]; axis?: string },
): Promise<PrintSplitBillsResult> => {
    const response = await backendCall('/print/bill/split', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableName, ...input }),
    });
    if (!response?.ok) {
        throw new Error(response ? await readErrorMessage(response) : 'Unable to print the split bills');
    }
    return (await response.json()) as PrintSplitBillsResult;
};

export const splitBill = async (restaurantId: string, tableName: string, parts: number): Promise<{ grand_total: number; parts: SplitPart[] }> =>
    postJson('/bills/split', restaurantId, { table_name: tableName, mode: 'even', parts });
/** POST /bills/merge's answer. */
export interface MergeTablesResult {
    success?: boolean;
    total_amt?: number;
    moved_orders?: number;
    /**
     * CLIENT ITEM 6 — the orders went onto a bill the guest is already holding
     * (a manager merging "12 #2" into a printed 12): the paper is short. Read
     * with readReprintNeeded, which also takes reprint_message / reprint_table.
     */
    reprint_needed?: boolean;
    reprint_message?: string;
    reprint_table?: string;
}
/**
 * Merge one table's open orders into another's bill.
 *
 * A 4xx comes back as a RefusedAction carrying the server's sentence — a
 * printed bill a waiter may not merge into (423), a locked bill, a table that
 * cannot take the party — because this module is "use server" and a thrown
 * Error's message is redacted in production. The merge route refuses before it
 * writes. No answer and a 5xx still throw: a merge may have landed behind them.
 */
export const mergeTables = async (restaurantId: string, fromTable: string, toTable: string): Promise<MergeTablesResult | RefusedAction> => {
    const response = await backendCall('/bills/merge', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_table: fromTable, to_table: toTable }),
    });
    if (!response) {throw new Error('Could not reach the server. Check the bill before merging again.');}
    if (response.status >= 400 && response.status < 500) {
        return { refused: true, status: response.status, error: await readErrorMessage(response, 'Unable to merge the bills') };
    }
    if (!response.ok) {throw new Error(await readErrorMessage(response, 'Unable to merge the bills'));}
    try { return (await response.json()) as MergeTablesResult; } catch { return {}; }
};
export const refundBill = async (restaurantId: string, opts: { table_name?: string; bill_id?: string; amount?: number; reason?: string }): Promise<{ amount: number; gateway: string }> =>
    postJson('/bills/refund', restaurantId, opts);

// --- MIS / control reports (Insights → Reports) ------------------------------
//
// The fifteen documents an owner or an auditor reads, served under
// /reports/mis/* and gated on the SAME accounting permission as every other
// /reports/* route.
// READ-ONLY, all of it.
//
// EVERY EXPORT HERE IS `async`. db.ts carries "use server", so a plain
// `export const X = {...}` is a build error that tsc and jest both pass while
// each page 500s at runtime — the report types, the catalogue and all the pure
// helpers therefore live in `@/lib/mis-reports`, which is a plain module.
//
// WHY THESE DO NOT GO THROUGH `backendJson`: the Reports workspace has its own
// outlet selector, so a report must be able to target one outlet (or the "all"
// sentinel) WITHOUT the global switcher's full page reload. `backendJson`
// resolves the outlet itself and overwrites any `X-Outlet-Id` handed to it, so
// these call `headersForRestaurant` with an explicit outlet instead — the same
// per-call override the header helper has always supported. An omitted
// `outletId` falls through to the app-wide scope, which is what makes Reports
// open on whatever outlet the rest of the dashboard is showing.


/** The window/scope/search/paging query, exactly as /reports/mis/* takes it. */
export interface MisQuery {
    from?: string;
    to?: string;
    days?: number;
    /** An outlet id, or 'all'. Omitted means "whatever scope the app is in". */
    outletId?: string;
    /** Bill No. / KOT / table / payment mode — free text, matched per report. */
    search?: string;
    limit?: number;
    offset?: number;
    /** The time-wise toggle. Only Sales Summary changes shape for it. */
    bucket?: MisBucket;
    /** A saved session's id (`lunch`). Every report honours it. */
    slot?: string;
    /** Custom `HH:mm` pair; wins over `slot`. `timeTo` may be `24:00`. */
    timeFrom?: string;
    timeTo?: string;
}

const misSearchParams = (restaurantId: string, q: MisQuery): string => {
    const qs = new URLSearchParams({ restaurantId });
    if (q.from) {qs.set('from', q.from);}
    if (q.to) {qs.set('to', q.to);}
    if (typeof q.days === 'number' && Number.isFinite(q.days)) {qs.set('days', String(Math.max(1, Math.round(q.days))));}
    if (q.search && q.search.trim().length > 0) {qs.set('search', q.search.trim().slice(0, 120));}
    if (typeof q.limit === 'number' && Number.isFinite(q.limit)) {qs.set('limit', String(Math.max(1, Math.round(q.limit))));}
    if (typeof q.offset === 'number' && Number.isFinite(q.offset)) {qs.set('offset', String(Math.max(0, Math.round(q.offset))));}
    if (q.bucket) {qs.set('bucket', q.bucket);}
    // Nothing at all for all day, so an unsliced request is the URL it always was.
    for (const [key, value] of misSlotParams(q)) {qs.set(key, value);}
    return qs.toString();
};

/**
 * GET a MIS endpoint with an explicit outlet scope.
 *
 * Returns null for anything that is not a 200 — an unreachable backend, a 403
 * from a plan without the accounting feature, a 500. The screen distinguishes
 * that null from a legitimately EMPTY report (a restaurant that was shut all
 * week is a 200 with zeros) and says "couldn't load" rather than "no trade",
 * because those two read identically as a blank grid and mean opposite things.
 */
const misFetch = async <T>(path: string, restaurantId: string, outletId?: string): Promise<T | null> => {
    let status = 0;
    try {
        const hdrs = await headersForRestaurant(path, restaurantId, undefined, outletId);
        const response = await fetch(`${apiBaseUrl()}${path}`, { method: 'GET', cache: 'no-store', headers: hdrs });
        status = response.status;
        if (response.ok) {return (await response.json()) as T;}
        if (status !== 401) {return null;}
    } catch (error) {
        console.warn(`MIS report request failed for ${path}`, error);
        return null;
    }
    // A 401 means the session died under us; fall through to the shared gate so
    // redirect()'s NEXT_REDIRECT is never swallowed by the catch above.
    enforceSessionAlive(path, status);
    return null;
};

/** One entry of the backend's report catalogue. */
export interface MisCatalogueEntry {
    key: string;
    title: string;
    path: string;
    rows: string;
    paged: boolean;
}

/**
 * The shell every report speaks — which query keys it takes, and (the part this
 * client reads) which CLOCK each one buckets on.
 *
 * `basis` maps a clock to the reports on it. It is served rather than hardcoded
 * so a report whose basis the backend changes relabels itself without a client
 * release, which matters because that label is what stops two reports over the
 * same dates being read as disagreeing with each other.
 */
export interface MisCatalogueShell {
    basis?: Record<string, string[]>;
}

/**
 * The server's own list of the fifteen, so the tab strip is not a second copy
 * that can drift. The screen falls back to `MIS_REPORTS` in @/lib/mis-reports
 * when this is null, so a catalogue outage costs the tab titles, never the
 * reports.
 */
export const getMisCatalogue = async (
    restaurantId: string,
    outletId?: string,
): Promise<{ reports: MisCatalogueEntry[]; shell?: MisCatalogueShell } | null> =>
    misFetch<{ reports: MisCatalogueEntry[]; shell?: MisCatalogueShell }>(
        `/reports/mis?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        outletId,
    );

/**
 * One of the nine. `path` comes from the catalogue (or its fallback) and is
 * always a literal /reports/mis/* route — never user input.
 */
export const getMisReport = async (
    restaurantId: string,
    path: string,
    q: MisQuery = {},
): Promise<MisReportPayload | null> => {
    if (!restaurantId || !path.startsWith('/reports/mis/')) {return null;}
    return misFetch<MisReportPayload>(`${path}?${misSearchParams(restaurantId, q)}`, restaurantId, q.outletId);
};

/**
 * The restaurant's saved sessions (Lunch, Dinner, …) and whether this caller may
 * change them. Null when the route does not answer — an older backend, or a plan
 * without the accounting reports — and the screen then offers no session picker
 * rather than a filter the server would ignore.
 */
export const getReportTimeSlots = async (restaurantId: string): Promise<ReportTimeSlots | null> => {
    if (!restaurantId) {return null;}
    const raw = await misFetch<unknown>(
        `/reports/mis/time-slots?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
    );
    return readTimeSlots(raw);
};

/**
 * Replace the whole list (an empty list restores Lunch and Dinner). Gated on the
 * settings permission server-side.
 *
 * RETURNS its failure rather than throwing it: Next redacts the message of an
 * Error thrown out of a Server Action in production, and the server's 400
 * sentence ("Lunch and Brunch overlap between 12:00 and 13:00") is the whole
 * point of the editor showing an error at all.
 */
export const saveReportTimeSlots = async (
    restaurantId: string,
    drafts: TimeSlotDraft[],
): Promise<{ ok: true; data: ReportTimeSlots } | { ok: false; error: string }> => {
    const res = await backendCall(`/reports/mis/time-slots?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slotDraftsBody(drafts)),
    });
    if (!res) {return { ok: false, error: 'Could not reach the server — check the connection and try again.' };}
    if (!res.ok) {return { ok: false, error: await readErrorMessage(res, 'Unable to save the sessions') };}
    const data = readTimeSlots(await res.json().catch(() => null));
    return data ? { ok: true, data } : { ok: false, error: 'The server saved the sessions but sent back a list this screen cannot read — reload to see them.' };
};

/**
 * The full bill behind a drilled-down row. Deliberately the same
 * `ClosedBillDetail` the History screen renders, via the backend reader both
 * share — a drill-down that showed a different bill from the rest of the
 * product would be the worst possible bug in a fraud-control document.
 */
export const getMisBillDetail = async (
    restaurantId: string,
    billId: string,
    outletId?: string,
): Promise<ClosedBillDetail | null> => {
    if (!billId) {return null;}
    return misFetch<ClosedBillDetail>(
        `/reports/mis/bill/${encodeURIComponent(billId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        outletId,
    );
};

/** One line of a KOT, as the ticket recorded it. */
export interface MisOrderItem {
    name: string;
    quantity: number;
    price: number;
    line_total: number;
    note: string | null;
    station: string | null;
    /** Backend migration 034: a comped line. Labelled "(NC)"; its value is still the ticket's. Absent otherwise. */
    nc?: boolean;
}

/**
 * The full KOT behind a Void KOT row, or a Bill Edit row that names an order.
 * Carries the ticket's own audit trail, which is the thing a void is actually
 * being read for.
 */
export interface MisOrderDetail {
    id: string;
    created_at: string;
    updated_at: string | null;
    status: string | number;
    order_type: string;
    table_name: string | null;
    customer: string | null;
    taken_by: string | null;
    items: MisOrderItem[];
    item_count: number;
    qty: number;
    value: number;
    bill_id: string | null;
    bill_no: string | null;
    trail: { at: string; action: string; description: string | null; by: string | null }[];
}

export const getMisKotDetail = async (
    restaurantId: string,
    orderId: string,
    outletId?: string,
): Promise<MisOrderDetail | null> => {
    if (!orderId) {return null;}
    return misFetch<MisOrderDetail>(
        `/reports/mis/kot/${encodeURIComponent(orderId)}?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        outletId,
    );
};

// --- MIS DATA CAPTURE (migrations 034-039) ----------------------------------
//
// The six things a restaurant could not record before this release: a comp, a
// void reason, a service-charge waiver, a split tender with a tip, the till a
// bill was rung on, and the menu group / price-point taxonomy. Every one of them
// is what makes the last six reports something other than an empty grid.
//
// EVERY EXPORT HERE IS `async`. db.ts carries "use server", so a plain
// `export const NC_KINDS = [...]` is a build error that tsc and jest both pass
// while every page 500s at runtime. The vocabularies, the permission ids and all
// the pure helpers live in `@/lib/mis-capture`, which is a plain module.
//
// THE ACTOR IS NEVER IN A BODY. `marked_by` / `voided_by` / `waived_by` /
// `settled_by` are taken from the verified session server-side and there is no
// parameter below that can set one. What IS in the body is `authorised_by` — the
// SECOND name, resolved server-side against the staff list and checked for the
// same permission that gates the route — and `tip_credited_to_username`, which
// is a destination rather than an actor (a tip is routinely owed to the kitchen
// or to a pool, i.e. to people who hold no POS permission at all).
//
// NOTHING HERE IS IDEMPOTENT, and that is deliberate: the server opted none of
// these routes into idempotency.ts (a waiver can mint a bill, and with it an
// invoice number; a queued comp means the printed bill and the server disagree),
// so the Flutter outbox allowlist is untouched and still mirrors the server's
// opt-in exactly. Do not add a retry wrapper to any of them.

/**
 * The error sentence a capture write should show the person at the till.
 *
 * Distinct from the shared `readErrorMessage` in one place that matters: a 403
 * here is not "Action forbidden", it is the server naming WHY — "'ravi' is not
 * permitted to authorise a void." That sentence is the whole point of the
 * second-name control, and flattening it to a generic refusal would leave a
 * manager re-typing a username that can never work.
 */
const captureErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    try {
        const payload: unknown = await response.json();
        // Same picker the shared reader uses, so a capture route that answers in
        // the `{ error: "Forbidden", details: "…" }` shape every other gate uses
        // surfaces its sentence here too instead of the generic fallback.
        const sentence = refusalSentence(payload);
        if (sentence) {return sentence;}
    } catch { /* fall through to the generic sentence */ }
    return `${fallback} (${String(response.status)})`;
};

/** POST/PATCH a capture route and surface the server's own refusal verbatim. */
const captureWrite = async <T>(
    path: string,
    restaurantId: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    fallback: string,
): Promise<T> => {
    const response = await backendCall(path, restaurantId, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    if (!response) {throw new Error('Could not reach the server. This change was not recorded.');}
    if (!response.ok) {throw new Error(await captureErrorMessage(response, fallback));}
    try { return (await response.json()) as T; } catch { return {} as T; }
};

/** Identify a bill the three ways every bill route accepts. At least one is required. */
export interface BillTarget {
    bill_id?: string;
    table_name?: string;
    order_id?: string;
}

const billTargetBody = (target: BillTarget): Record<string, string> => {
    const out: Record<string, string> = {};
    if (target.bill_id?.trim()) {out.bill_id = target.bill_id.trim();}
    if (target.table_name?.trim()) {out.table_name = target.table_name.trim();}
    if (target.order_id?.trim()) {out.order_id = target.order_id.trim();}
    return out;
};

// --- 034: NON-CHARGEABLE -----------------------------------------------------

export interface MarkNonChargeableResult {
    non_chargeable: NonChargeableRecord;
    /** The order's chargeable subtotal AFTER the comp — the server's own figure. */
    order_subtotal: number;
    order_nc_total: number;
    /** The whole table's chargeable subtotal after the comp. */
    table_subtotal: number;
}

/**
 * Comp one order line — take it OUT of what the guest pays while still counting
 * it as revenue given away.
 *
 * `quantity` comps part of a line ("one of the three desserts was on the
 * house"); omitted, the whole line goes. The money that comes back is the
 * SERVER's: `value` on the record is computed by Postgres (034: GENERATED
 * ALWAYS) and the two subtotals are recomputed inside the same transaction, so
 * the screen never has to work out what the comp did to the bill.
 */
export const markOrderItemNonChargeable = async (
    restaurantId: string,
    orderId: string,
    itemId: string,
    body: { nc_kind: string; reason: string; authorised_by: string; quantity?: number },
): Promise<MarkNonChargeableResult> =>
    captureWrite<MarkNonChargeableResult>(
        `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/non-chargeable`,
        restaurantId,
        'POST',
        body,
        'Unable to make that item non-chargeable',
    );

/**
 * Put a comped dish back on the bill.
 *
 * SUPERSESSION, NOT DELETION — the ledger row stays and is stamped, so the NC
 * Summary shows "12 comps, 2 of them reversed" instead of showing 10 and hiding
 * the argument. No authoriser: putting a charge BACK on a guest's bill is not
 * the act the second-name control exists to catch.
 */
export const reverseNonChargeable = async (
    restaurantId: string,
    ncId: string,
    reason: string,
): Promise<{ non_chargeable: NonChargeableRecord }> =>
    captureWrite<{ non_chargeable: NonChargeableRecord }>(
        `/non-chargeables/${encodeURIComponent(ncId)}/reverse`,
        restaurantId,
        'POST',
        { reason },
        'Unable to reverse that non-chargeable',
    );

/**
 * The comps on one order, with reason, value, both names and the id needed to
 * reverse one. Gated on the comp permission — the bill view already shows a
 * waiter WHICH lines are comped; this is the control data behind them.
 */
export const getOrderNonChargeables = async (
    restaurantId: string,
    orderId: string,
): Promise<NonChargeableRecord[]> => {
    const data = await backendJson<{ non_chargeables?: NonChargeableRecord[] }>(
        `/orders/${encodeURIComponent(orderId)}/non-chargeables?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.non_chargeables) ? data.non_chargeables : [];
};

/** What POST /bills/order/:orderId/settle-nc answers. Every figure is the server's. */
export interface SettleBillNonChargeableResult {
    success: true;
    bill_id: string;
    bill_no: string | null;
    table_name: string | null;
    payment_method: string;
    total_amt: number;
    /** Everything given away on the bill, pre-tax, dishes comped earlier included. */
    nc_value: number;
    /** The dishes THIS settle comped. */
    nc_lines: number;
    /** What the guest would have paid. Information only — in no report. */
    would_have_charged: number;
    non_chargeables: NonChargeableRecord[];
    printed: boolean;
    print_error?: string;
    /** The bill was already settled as NC — a double click, or a lost answer. */
    already?: true;
}

/**
 * SETTLE AS NC (backend migration 052): close the table's bill as
 * non-chargeable, in one step. Every remaining dish is comped into the NC ledger
 * with this kind, reason and authoriser, the bill closes at 0.00 as 'NC' and the
 * table is freed; the NC bill prints unless `print` is false.
 *
 * NOT a payment: there is no approve or close call after it. `expected_value`
 * is the chargeable subtotal the form showed, so a bill that changed while the
 * manager was deciding is refused rather than given away at a different size.
 * The route refuses an amount — whole bills only (lib/nc-settle.ts).
 *
 * RETURNED, NOT THROWN, for the reason removeServiceChargeAndPrint gives: this
 * module is "use server", Next redacts a thrown Error's message in a production
 * build, and the refusal's sentence — a moved quote, a payment already taken,
 * an authoriser who may not approve this — is what the manager needs.
 *
 * `refused` says the server turned the settle down BEFORE writing anything
 * (ncSettleWasRefused). No answer, an unreadable 2xx and any other 5xx are not
 * refusals — a proxy's 504 can arrive after the bill closed — so the dialog
 * (ncSettleTrouble) says to check the bill rather than "Not settled".
 */
export const settleBillAsNonChargeable = async (
    restaurantId: string,
    orderId: string,
    body: { nc_kind: string; reason: string; authorised_by: string; expected_value: number; print: boolean },
): Promise<{ ok: true; result: SettleBillNonChargeableResult } | { ok: false; status: number; refused: boolean; message: string }> => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/settle-nc`, restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response) {
        // Not "nothing was recorded": fetch throws for a reset AFTER the request
        // was sent as readily as for a server that was never reached.
        return { ok: false, status: 0, refused: false, message: 'The server could not be reached, or its answer was lost on the way back.' };
    }
    if (!response.ok) {
        let payload: unknown = null;
        try { payload = await response.json(); } catch { payload = null; }
        return {
            ok: false,
            status: response.status,
            refused: ncSettleWasRefused(response.status, payload),
            message: refusalSentence(payload) ?? `Unable to settle this bill as non-chargeable (${String(response.status)})`,
        };
    }
    try {
        return { ok: true, result: (await response.json()) as SettleBillNonChargeableResult };
    } catch {
        // A 2xx whose body could not be read: the bill most likely closed, but
        // nothing here can say which bill or what was given away.
        return { ok: false, status: response.status, refused: false, message: 'The answer from the server could not be read.' };
    }
};

// --- 035: VOID REASON + STAGE ------------------------------------------------

/**
 * Cancel an order AND record why, in one transaction.
 *
 * THE STAGE IS NOT A PARAMETER AND NEVER WILL BE. before_print / after_print /
 * after_bill is derived server-side from facts the client cannot reach — whether
 * a bill exists for the table, whether the order was barked, whether a KOT print
 * job went out — because the person whose void it is has an obvious interest in
 * it reading "before_print". It comes back on the record so the screen can show
 * what the server decided.
 */
export const voidOrderWithReason = async (
    restaurantId: string,
    orderId: string,
    body: { void_kind: string; reason: string; authorised_by: string },
): Promise<{ void: OrderVoidRecord; previous_status: string | number }> =>
    captureWrite<{ void: OrderVoidRecord; previous_status: string | number }>(
        `/orders/${encodeURIComponent(orderId)}/void`,
        restaurantId,
        'POST',
        body,
        'Unable to void that order',
    );

/**
 * 1.3 — THE EVERYDAY CANCEL, WITH ITS REASON.
 *
 * PATCH /orders/:id/status {status: 'Cancelled', reason}, gated on "Add Orders".
 * The route records the reason self-authorised in the same "OrderVoids" ledger
 * the void report reads and prints the CANCELLED slip (1.1). The route does not
 * refuse a missing reason (shipped tills), so the prompt in front of this call
 * is what makes it mandatory (1.2) — never call this with an empty one.
 *
 * The response's `cancel_kot_*` fields say whether the slip printed; they are
 * passed through untouched.
 */
export const cancelOrderWithReason = async (
    restaurantId: string,
    orderId: string,
    reason: string,
): Promise<{ success?: boolean; unchanged?: boolean; cancel_kot_printed?: boolean; cancel_kot_no?: number | null }> =>
    captureWrite<{ success?: boolean; unchanged?: boolean; cancel_kot_printed?: boolean; cancel_kot_no?: number | null }>(
        `/orders/${encodeURIComponent(orderId)}/status`,
        restaurantId,
        'PATCH',
        { status: 'Cancelled', reason },
        'Unable to cancel that order',
    );

// --- 036: SERVICE CHARGE WAIVER ----------------------------------------------

export interface WaiveServiceChargeResult {
    waiver: ServiceChargeWaiverRecord;
    /** The bill's grand total BEFORE the waiver, as the server computed it. */
    grand_total_before: number;
    grand_total_after: number;
}

/**
 * Take the service charge off a table's OPEN bill.
 *
 * THE REDUCTION IS THE SERVER'S, AND IT HAS TO BE. This fleet runs two tax
 * shapes: with `Restaurant.service_charge` the GST sits ON the charge, so the
 * grand total falls by MORE than the charge itself; with a "Service Charge" line
 * inside `Outlets.default_tax` it does not. The server measures the saving by
 * running the real charge computation twice and differencing, and hands back
 * both totals. A browser that multiplied a percentage would be right for one
 * tenant and wrong for the other, and would look right in both.
 *
 * The reason is optional (app 2.0.1): a blank one is left out of the body, as
 * removeServiceChargeAndPrint does, and the server records none.
 */
export const waiveServiceCharge = async (
    restaurantId: string,
    body: BillTarget & { waiver_kind: string; reason?: string | null; authorised_by: string },
): Promise<WaiveServiceChargeResult> =>
    captureWrite<WaiveServiceChargeResult>(
        '/bills/service-charge-waiver',
        restaurantId,
        'POST',
        {
            ...billTargetBody(body),
            waiver_kind: body.waiver_kind,
            ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),
            authorised_by: body.authorised_by,
        },
        'Unable to waive the service charge',
    );

/** Put the service charge back. Supersession, like the comp reversal. */
export const reverseServiceChargeWaiver = async (
    restaurantId: string,
    waiverId: string,
    reason: string,
): Promise<{ waiver: ServiceChargeWaiverRecord }> =>
    captureWrite<{ waiver: ServiceChargeWaiverRecord }>(
        `/bills/service-charge-waiver/${encodeURIComponent(waiverId)}/reverse`,
        restaurantId,
        'POST',
        { reason },
        'Unable to reverse that waiver',
    );

/**
 * "Remove service charge & print" — the waiver and the print in ONE request.
 *
 * POST /bills/service-charge-waiver/print with `render: "client"`: the server
 * answers every refusal (C3's reprint rule, no charge to remove, no waive
 * permission, a missing kind or authoriser) BEFORE it writes anything, records
 * the waiver exactly as POST /bills/service-charge-waiver does, then CLAIMS the
 * print the way POST /print/bill/claim does and hands back `printable_bill`
 * priced after the waiver. A bill that already carries a waiver is only
 * reprinted, so the live-waiver panel calls this with no kind and no reason.
 *
 * RETURNED, NOT THROWN, for the reason claimBillPrint gives: this module is "use
 * server", Next redacts an Error's message across that boundary in a production
 * build, and the refusal's sentence is what the person at the till needs —
 * "'ravi' is not permitted to authorise a service-charge waiver" is actionable;
 * a redacted error is not. The caller opened the print tab before calling, and
 * closes it on `ok: false`.
 *
 * `ok: false` IS NOT "NOTHING HAPPENED". A 4xx is: the route refuses before it
 * writes. No answer (`status: 0`) and a 5xx are not — a connection reset or a
 * proxy's 504 can arrive after the waiver committed and the print was claimed —
 * so the sentence for those says only what is known, and the dialog
 * (serviceChargeRemovalTrouble) re-reads the bill before anybody tries again.
 *
 * No retry and no idempotency key, like every capture write here: the route can
 * mint a bill number, and a repeated request for paper is a second copy.
 */
export const removeServiceChargeAndPrint = async (
    restaurantId: string,
    body: { table_name: string; waiver_kind?: string; reason?: string; authorised_by?: string },
): Promise<{ ok: true; result: RemoveServiceChargeAndPrintResult } | { ok: false; status: number; message: string }> => {
    const payload: Record<string, string> = { table_name: body.table_name.trim(), render: 'client' };
    if (body.waiver_kind?.trim()) {payload.waiver_kind = body.waiver_kind.trim();}
    // Optional (app 2.0.1). Blank is ABSENT, never "": a server before the
    // change refused "" in its schema, and absent gets its clean refusal.
    if (body.reason?.trim()) {payload.reason = body.reason.trim();}
    if (body.authorised_by?.trim()) {payload.authorised_by = body.authorised_by.trim();}
    const response = await backendCall('/bills/service-charge-waiver/print', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response) {
        // Not "nothing was recorded": fetch throws for a reset AFTER the request
        // was sent as readily as for a server that was never reached.
        return { ok: false, status: 0, message: 'The server could not be reached, or its answer was lost on the way back.' };
    }
    if (!response.ok) {
        return { ok: false, status: response.status, message: await captureErrorMessage(response, 'Unable to remove the service charge') };
    }
    try {
        return { ok: true, result: (await response.json()) as RemoveServiceChargeAndPrintResult };
    } catch {
        // A 2xx with an unreadable body: the waiver may well have landed. Say
        // what is known — the paper did not come from this answer.
        return { ok: true, result: { success: true, waiver: null, waiver_created: false, grand_total_before: null, grand_total_after: null, service_charge_removed: false, printed: false, print_error: 'The answer from the server could not be read' } };
    }
};

// --- 037: TENDERS AND TIPS ---------------------------------------------------

/**
 * What this bill is worth and what has been paid against it.
 *
 * READ-ONLY EVEN WHEN THERE IS NO BILL ROW YET — a table that has ordered and
 * not asked for the bill has none, and this must not create one: a GET that
 * allocated an invoice number is how a polling payment screen mints phantom
 * bills. It answers with the grand total the guest currently owes and nothing
 * tendered, which is the true state and the one a payment screen needs.
 *
 * `outstanding` from here is THE figure the settle screen shows. It is never
 * recomputed in the browser.
 */
export const getBillTenderState = async (
    restaurantId: string,
    target: BillTarget,
): Promise<BillTenderState | null> => {
    const qs = new URLSearchParams({ restaurantId });
    for (const [k, v] of Object.entries(billTargetBody(target))) {qs.set(k, v);}
    if (!qs.has('bill_id') && !qs.has('table_name') && !qs.has('order_id')) {return null;}
    return backendJson<BillTenderState>(`/bills/tenders?${qs.toString()}`, restaurantId, { method: 'GET' });
};

/**
 * Record one or more payments against an OPEN bill.
 *
 * THE PART-PAYMENT ROUTE. The amounts may come to less than the bill and the
 * bill stays open, with `outstanding` saying what is left. A tender's `amount`
 * is the portion of the BILL it settles and never includes the tip — the tip
 * rides on the same row because that is how it is physically taken, and is
 * excluded from every sum that reconciles against the grand total.
 */
export const recordBillTenders = async (
    restaurantId: string,
    body: BillTarget & { tenders: TenderWire[] },
): Promise<BillTenderState> =>
    captureWrite<BillTenderState>(
        '/bills/tenders',
        restaurantId,
        'POST',
        { ...billTargetBody(body), tenders: body.tenders },
        'Unable to record that payment',
    );

/**
 * Void one recorded payment.
 *
 * SUPERSEDED, NEVER DELETED: the row stays, stamped with who voided it and why,
 * and drops out of every sum. That is what closes the double-count — a card
 * payment keyed twice leaves two rows and one live amount, and the evidence
 * survives for the day the acquirer's statement shows two authorisations.
 */
export const voidBillTender = async (
    restaurantId: string,
    tenderId: string,
    reason: string,
): Promise<BillTenderState> =>
    captureWrite<BillTenderState>(
        `/bills/tenders/${encodeURIComponent(tenderId)}/void`,
        restaurantId,
        'POST',
        { reason },
        'Unable to void that payment',
    );

export interface TipLedgerEntry {
    credited_to: string;
    tips: number;
    tender_count: number;
    by_mode?: { mode: string; tips: number }[];
}

export interface TipLedger {
    from: string;
    to: string;
    /** NOT REVENUE. Reaches no sales figure, no APC and no ABV. */
    total_tips: number;
    by_credited_to: TipLedgerEntry[];
    rows: unknown[];
}

/** Who is owed what, over a window. A PAYROLL read — it reports tips and nothing else. */
export const getTipLedger = async (
    restaurantId: string,
    from?: string,
    to?: string,
): Promise<TipLedger | null> => {
    const qs = new URLSearchParams({ restaurantId });
    if (from) {qs.set('from', from);}
    if (to) {qs.set('to', to);}
    return backendJson<TipLedger>(`/tips?${qs.toString()}`, restaurantId, { method: 'GET' });
};

// --- 038: BILLING COUNTERS ---------------------------------------------------

/**
 * The outlet's tills.
 *
 * EMPTY IS THE NORMAL ANSWER, AND IT IS NOT THE SAME AS AN ERROR. Most tenants
 * have one till per outlet and never configure a counter; they get `[]` here and
 * NULL attribution everywhere, which reads as "this outlet's till" in every
 * report. A caller must render `[]` as "not configured", never as a failure —
 * and must render NULL (the request did not come back) as a failure, never as
 * "not configured", because "every bill counts as this outlet's single till" is
 * a claim about the configuration and would be a lie if nobody could read it.
 */
export const getBillingCounters = async (
    restaurantId: string,
    includeInactive = false,
): Promise<BillingCounterRecord[] | null> => {
    const qs = new URLSearchParams({ restaurantId });
    if (includeInactive) {qs.set('include_inactive', '1');}
    const data = await backendJson<{ counters?: BillingCounterRecord[] }>(
        `/billing-counters?${qs.toString()}`,
        restaurantId,
        { method: 'GET' },
    );
    if (data === null) {return null;}
    return Array.isArray(data.counters) ? data.counters : [];
};

/**
 * Create or rename a till.
 *
 * UPSERTS ON THE CODE, case-insensitively per outlet, so re-saving the
 * configuration screen updates rather than duplicating and "C1" and "c1" can
 * never become two tills nobody can tell apart on a cash-up sheet at 1am.
 *
 * THERE IS NO DELETE, here or on the server. Removing a counter would orphan the
 * attribution on every bill it ever rang, which is precisely the history the
 * column exists to keep. `active: false` retires it.
 */
export const saveBillingCounter = async (
    restaurantId: string,
    body: { id?: string; code: string; name?: string; kind?: string; device_hint?: string | null; active?: boolean; sort_order?: number },
): Promise<BillingCounterRecord> => {
    const result = await captureWrite<{ counter: BillingCounterRecord }>(
        '/billing-counters',
        restaurantId,
        'POST',
        body,
        'Unable to save that counter',
    );
    return result.counter;
};

/**
 * Attribute a bill to the till that rang it.
 *
 * The settle route already does this from the `counter_id` it is handed, so this
 * exists for the two cases that cannot: attributing a bill BEFORE it is settled,
 * and CORRECTING an attribution after a terminal was found to be misconfigured.
 * A `null` counter clears it back to "this outlet's single till", which is the
 * state of every bill that predates migration 038.
 */
export const setBillCounter = async (
    restaurantId: string,
    target: BillTarget,
    counterId: string | null,
): Promise<{ bill_id: string; counter_id: string | null }> =>
    captureWrite<{ bill_id: string; counter_id: string | null }>(
        '/bills/counter',
        restaurantId,
        'POST',
        { ...billTargetBody(target), ...(counterId ? { counter_id: counterId } : {}) },
        'Unable to attribute that bill',
    );

// --- 039: MENU GROUPS AND VARIATIONS -----------------------------------------
//
// NEVER A WHOLESALE REPLACE. There is no PUT here and none on the server: a
// full-replace bulk save once wiped 56 menu items' images, sections and recipes,
// and the rule that came out of it is that a field absent from a payload means
// "keep what is stored". Every write below is ONE row, merged server-side over a
// snapshot of itself. There is no DELETE either — a variation id is stamped onto
// order lines, and an order that named "Half" must still print that label next
// year, so retiring is `{ active: false }`.

/** The outlet's groups. Both axes unless one is asked for. */
export const getMenuGroups = async (
    restaurantId: string,
    opts: { kind?: string; includeInactive?: boolean } = {},
): Promise<MenuGroupRecord[]> => {
    const qs = new URLSearchParams({ restaurantId });
    if (opts.kind) {qs.set('kind', opts.kind);}
    if (opts.includeInactive) {qs.set('include_inactive', 'true');}
    const data = await backendJson<{ groups?: MenuGroupRecord[] }>(
        `/menu-groups?${qs.toString()}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.groups) ? data.groups : [];
};

/**
 * The classification map: every category and every dish, with what it is filed
 * as and what that resolves to.
 *
 * THE ONLY PLACE A CLIENT CAN LEARN A CATEGORY'S ID. GetMenuCategories returns
 * bare names and the menu read flattens the taxonomy to one string, so without
 * this the category default — the assignment actually worth making — could not
 * be set at all, and an owner would be filing 300 items one at a time.
 */
export const getMenuGroupAssignments = async (
    restaurantId: string,
    kind = 'revenue',
): Promise<MenuGroupAssignments | null> =>
    backendJson<MenuGroupAssignments>(
        `/menu-group-assignments?restaurantId=${encodeURIComponent(restaurantId)}&kind=${encodeURIComponent(kind)}`,
        restaurantId,
        { method: 'GET' },
    );

/**
 * Create a group. A 409 means that name is taken on that axis — and the server
 * hands the EXISTING row back with the refusal, so the editor can offer "you
 * already have this, edit it?" instead of a dead end.
 */
export const createMenuGroup = async (
    restaurantId: string,
    body: { name: string; kind?: string; active?: boolean; sort_order?: number },
): Promise<MenuGroupRecord> => {
    const result = await captureWrite<{ group: MenuGroupRecord }>(
        '/menu-groups',
        restaurantId,
        'POST',
        body,
        'Unable to create that group',
    );
    return result.group;
};

/** Rename a group, move it to the other axis, reposition it, or retire it. A MERGE. */
export const updateMenuGroup = async (
    restaurantId: string,
    groupId: string,
    patch: { name?: string; kind?: string; active?: boolean; sort_order?: number },
): Promise<MenuGroupRecord> => {
    const result = await captureWrite<{ group: MenuGroupRecord }>(
        `/menu-groups/${encodeURIComponent(groupId)}`,
        restaurantId,
        'PATCH',
        patch,
        'Unable to update that group',
    );
    return result.group;
};

/**
 * File a CATEGORY (the default) or one DISH (the exception) under a group.
 *
 * `group_id: null` CLEARS. On an item that means "fall back to my category"; on
 * a category it means "everything under me is Unclassified until somebody says
 * otherwise". Neither is an error — an unclassified menu is what every tenant
 * has on the day this ships, and the reports say so out loud rather than
 * inventing a group.
 */
export const assignMenuGroup = async (
    restaurantId: string,
    target: { menu_id?: string; main_cat_id?: string },
    groupId: string | null,
): Promise<{ assigned: boolean; group_id: string | null }> =>
    captureWrite<{ assigned: boolean; group_id: string | null }>(
        '/menu-group-assignments',
        restaurantId,
        'POST',
        {
            ...(target.menu_id ? { menu_id: target.menu_id } : {}),
            ...(target.main_cat_id ? { main_cat_id: target.main_cat_id } : {}),
            group_id: groupId,
        },
        'Unable to file that under a group',
    );

/** The price points of one dish, or of the whole menu. */
export const getMenuVariations = async (
    restaurantId: string,
    opts: { menuId?: string; includeInactive?: boolean } = {},
): Promise<MenuVariationRecord[]> => {
    const qs = new URLSearchParams({ restaurantId });
    if (opts.menuId) {qs.set('menu_id', opts.menuId);}
    if (opts.includeInactive) {qs.set('include_inactive', 'true');}
    const data = await backendJson<{ variations?: MenuVariationRecord[] }>(
        `/menu-variations?${qs.toString()}`,
        restaurantId,
        { method: 'GET' },
    );
    return Array.isArray(data?.variations) ? data.variations : [];
};

/**
 * Add a price point to a dish.
 *
 * A ZERO PRICE IS REFUSED by the server even though the CHECK allows it, and the
 * reason is the money sentence of migration 039: a line naming a variation is
 * FLOORED at that variation's price on both the guest and the staff order paths,
 * so a ₹0 variation is a standing invitation to ring any quantity of that dish
 * in at ₹0 with the bill still printing its name. Free food is a comp, which has
 * a reason, an authoriser and a ledger row.
 */
export const createMenuVariation = async (
    restaurantId: string,
    body: { menu_id: string; name: string; price: number; is_default?: boolean; active?: boolean; sort_order?: number },
): Promise<MenuVariationRecord> => {
    const result = await captureWrite<{ variation: MenuVariationRecord }>(
        '/menu-variations',
        restaurantId,
        'POST',
        body,
        'Unable to add that variation',
    );
    return result.variation;
};

/**
 * Reprice, rename, reposition or retire a price point.
 *
 * `menu_id` CANNOT BE CHANGED and the server refuses it in a sentence: the id on
 * this row is stamped onto order lines, so re-pointing it would silently
 * relabel every past sale that named it — last month's "Half" would start
 * reporting under another dish.
 */
export const updateMenuVariation = async (
    restaurantId: string,
    variationId: string,
    patch: { name?: string; price?: number; is_default?: boolean; active?: boolean; sort_order?: number },
): Promise<MenuVariationRecord> => {
    const result = await captureWrite<{ variation: MenuVariationRecord }>(
        `/menu-variations/${encodeURIComponent(variationId)}`,
        restaurantId,
        'PATCH',
        patch,
        'Unable to update that variation',
    );
    return result.variation;
};
