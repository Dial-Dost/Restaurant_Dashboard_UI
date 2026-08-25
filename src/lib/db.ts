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
import { type Order } from '@/app/dashboard/orders/page';
import { type Table } from '@/app/dashboard/tables/data';
import { type AuditLog } from '@/app/dashboard/audit-logs/page';
import { serverBackendBase, serverBaseUrlFrom } from '@/lib/backend-url';
import { SELECTED_OUTLET_KEY } from '@/lib/outlet';
import type { BrandConfig } from '@/lib/brand-fonts';

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

export type PaymentMethod =
    | 'Swiggy'
    | 'Dine Out'
    | 'Zomato Pay'
    | 'Eazydiner'
    | 'Cash'
    | 'Upi'
    | 'Card'
    | 'Online Transfer'
    | 'Split';

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

const readErrorMessage = async (response: Response): Promise<string> => {
    if (response.status === 403) {
        return 'Action forbidden';
    }
    if (response.status === 413) {
        return 'Uploaded screenshot is too large. Please use a smaller image.';
    }

    try {
        const payload = await response.json();
        if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
            return payload.error;
        }
    } catch {
        // Ignore JSON parse issues and fall back to response text.
    }

    try {
        const text = await response.text();
        if (text.trim().length > 0) {
            return text;
        }
    } catch {
        // Ignore text parse issues and fall back to status code.
    }

    return `Request failed with status ${response.status}`;
};

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
    status: (item.status as InventoryItem['status']) ?? 'In Stock',
    expiry_date: typeof item.expiry_date === 'string' ? item.expiry_date : null,
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
});

const mapOrder = (item: any): Order => ({
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
});

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

export const occupyTable = async (restaurantId: string, tableName: string, numCovers?: number | null, linkedOrderId?: string | null) => {
    const payload: any = { table_name: tableName };
    if (typeof numCovers === 'number' && numCovers >= 1) {payload.num_covers = numCovers;}
    if (typeof linkedOrderId === 'string' && linkedOrderId.trim().length > 0) {payload.order_id = linkedOrderId;}

    const response = await backendCall('/occupy-table', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (response?.ok) {
        await getTables(restaurantId);
        // notify other UI parts (Tables page) that table data changed
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('tables:changed'));
            }
        } catch {
            // ignore
        }
        return { acknowledged: true };
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

export const releaseTable = async (restaurantId: string, tableName: string) => {
    const response = await backendCall('/release-table', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableName }),
    });

    if (response?.ok) {
        await getTables(restaurantId);
        return { acknowledged: true };
    }

    throw new Error(response ? await readErrorMessage(response) : 'Unable to release table');
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

export interface ClosedBillItem { name: string; price: number; quantity: number; note: string | null; line_total: number }
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
    // twice. INVARIANT: taxable_base + service_charge + tax_total === grand_total.
    tax_total: number;
    taxable_base: number;
    service_charge: number;
    service_charge_percent: number;
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
// settled bill — taxable_base + service_charge + tax_total === grand_total, with
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

export const addInventoryItem = async (restaurantId: string, item: InventoryItem) => {
    const response = await backendCall('/inventory', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
    });

    if (response?.ok) {
        await getInventory(restaurantId);
        return { acknowledged: true };
    }

    await addToLocalField(restaurantId, 'inventory', item);
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

export const addOrder = async (restaurantId: string, order: Order) => {
    const response = await backendCall('/orders', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
    });

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
) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/admin-approve-payment`, restaurantId, {
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
    stock_alerts: { name: string; qty: number; expiring?: boolean; expiry_date?: string | null }[];
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

export const getAdvancedAnalytics = async (restaurantId: string, days = 90): Promise<AdvancedAnalytics | null> => {
    const data = await backendJson<AdvancedAnalytics>(
        `/analytics/advanced?restaurantId=${encodeURIComponent(restaurantId)}&days=${Math.max(7, days)}`,
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

export const getOutletsComparison = async (restaurantId: string, days = 30): Promise<OutletComparison | null> => {
    const data = await backendJson<OutletComparison>(
        `/analytics/outlets?restaurantId=${encodeURIComponent(restaurantId)}&days=${Math.max(1, days)}`,
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
    days = 30,
): Promise<MenuInsights | null> => {
    const data = await backendJson<MenuInsights>(
        `/analytics/menu-insights?restaurantId=${encodeURIComponent(restaurantId)}&days=${days}`,
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

export interface OperationsAnalytics {
    days: number;
    by_hour: { hour: number; orders: number; revenue: number }[];
    by_weekday: { weekday: number; label: string; orders: number; revenue: number }[];
}

export const getOperationsAnalytics = async (
    restaurantId: string,
    days = 30,
): Promise<OperationsAnalytics | null> => {
    const data = await backendJson<OperationsAnalytics>(
        `/analytics/operations?restaurantId=${encodeURIComponent(restaurantId)}&days=${days}`,
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
    days = 30,
): Promise<KitchenAnalytics> => {
    const data = await backendJson<KitchenAnalytics>(
        `/analytics/kitchen?days=${days}`,
        restaurantId,
        { method: 'GET' },
    );
    return data ?? emptyKitchenAnalytics(days);
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
    days = 30,
): Promise<OverviewInsights | null> => {
    // A failed insight read must never blank the whole Overview tab — the caller
    // renders its existing sections when this is null.
    return await backendJson<OverviewInsights>(
        `/analytics/overview?days=${days}`,
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
    by_day: { date: string; sales: number; tax: number; refund: number; bills: number }[];
    by_method: { method: string; sales: number; bills: number }[];
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

// --- Bank / settlement reconciliation -----------------------------------------
export interface ReconciliationRow {
    method: string;
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
    channel: string;
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
export const setBillDiscount = async (restaurantId: string, tableName: string, type: 'percent' | 'flat', value: number): Promise<BillDiscountResult> =>
    postJson('/bills/discount', restaurantId, { table_name: tableName, type, value });

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
}

const BILL_QR_NOTE_MAX_FALLBACK = 120;

export const getBillPrintSettings = async (restaurantId: string): Promise<BillPrintSettings> => {
    const empty: BillPrintSettings = { legalName: '', gstin: '', qrNote: '', qrNoteDefault: '', qrNoteMax: BILL_QR_NOTE_MAX_FALLBACK };
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
        };
    } catch { return empty; }
};

// Sends only the keys the caller actually passed. Sending '' is how an owner
// CLEARS a field (and clearing the note restores the built-in valet line), so an
// empty string must reach the backend — presence, not truthiness, decides.
export const setBillPrintSettings = async (
    restaurantId: string,
    patch: { legalName?: string; gstin?: string; qrNote?: string },
): Promise<BillPrintSettings> => {
    const body: Record<string, string> = {};
    if (patch.legalName !== undefined) {body.bill_legal_name = patch.legalName;}
    if (patch.gstin !== undefined) {body.bill_gstin = patch.gstin;}
    if (patch.qrNote !== undefined) {body.bill_qr_note = patch.qrNote;}
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
        };
    } catch {
        return { legalName: patch.legalName ?? '', gstin: patch.gstin ?? '', qrNote: patch.qrNote ?? '', qrNoteDefault: '', qrNoteMax: BILL_QR_NOTE_MAX_FALLBACK };
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
}
// brand_config as the editor writes it — `surface_style` (panel material) is the
// newer live key; the guest pages read the same shape via GuestBrandConfig.
// The revived palette roles the guest surfaces now consume. BrandConfig (shared
// with the guest theme helper) predates them, so they are declared here until it
// catches up — every one is optional and blank means "derive from the accent".
export type BrandConfigPatch = BrandConfig & {
    surface_style?: string;
    color_accent?: string;
    color_success?: string;
    color_warning?: string;
    color_error?: string;
};
export interface BrandConfigSettings {
    brand_config: BrandConfigPatch;
    brand_fonts: string[];
    brand_fields?: BrandFieldSplit;
    brand_field_options?: BrandFieldOptions;
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
            }
            : undefined;
        return {
            brand_config: (j?.brand_config && typeof j.brand_config === 'object') ? (j.brand_config as BrandConfigPatch) : fallback.brand_config,
            brand_fonts: strings(j?.brand_fonts) ?? [],
            ...(split ? { brand_fields: split } : {}),
            ...(opts ? { brand_field_options: opts } : {}),
        };
    } catch {
        return fallback;
    }
};
export const saveBrandConfig = async (restaurantId: string, brandConfig: BrandConfigPatch): Promise<BrandConfigPatch> => {
    const res = await backendCall('/restaurant/branding', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_config: brandConfig }),
    });
    if (!res?.ok) {throw new Error(res ? await readErrorMessage(res) : 'Unable to save customer-page branding');}
    try { const j = await res.json(); return (j?.brand_config && typeof j.brand_config === 'object') ? (j.brand_config as BrandConfigPatch) : brandConfig; } catch { return brandConfig; }
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
export const splitBill = async (restaurantId: string, tableName: string, parts: number): Promise<{ grand_total: number; parts: SplitPart[] }> =>
    postJson('/bills/split', restaurantId, { table_name: tableName, mode: 'even', parts });
export const mergeTables = async (restaurantId: string, fromTable: string, toTable: string) =>
    postJson('/bills/merge', restaurantId, { from_table: fromTable, to_table: toTable });
export const refundBill = async (restaurantId: string, opts: { table_name?: string; bill_id?: string; amount?: number; reason?: string }): Promise<{ amount: number; gateway: string }> =>
    postJson('/bills/refund', restaurantId, opts);
