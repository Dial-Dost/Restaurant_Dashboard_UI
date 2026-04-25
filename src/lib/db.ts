'use server';

import { type Booking } from '@/app/dashboard/bookings/data';
import { type Customer } from '@/app/dashboard/customers/page';
import { type InventoryItem } from '@/app/dashboard/inventory/page';
import { type MenuItem } from '@/app/dashboard/menu/data';
import { type Order } from '@/app/dashboard/orders/page';
import { type Table } from '@/app/dashboard/tables/data';
import { type AuditLog } from '@/app/dashboard/audit-logs/page';

export type User = {
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
};

export type RestaurantProfile = {
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
};

export type RoleDefinition = {
    id: string;
    role_name: string;
    actions_performable: string[];
};

export type TableAssignmentDefinition = {
    id: string;
    table_name: string;
    employee_id: string;
    employee_name: string;
    employee_role: string;
};

export type ApcZone = 'red' | 'yellow' | 'green';

export type OrderApcInsight = {
    order_id: string;
    table_name: string;
    created_at: string;
    total: number;
    people_count: number;
    target_total: number;
    zone: ApcZone;
    assigned_employee_id: string | null;
    assigned_employee_name: string | null;
};

export type EmployeeApcIncentive = {
    employee_id: string;
    employee_name: string;
    employee_role: string;
    assigned_tables: string[];
    orders_count: number;
    covers_count: number;
    mean_apc: number;
    zone: ApcZone;
};

export type MonthlyApcInsight = {
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
};

export type PaymentMethod =
    | 'Swiggy'
    | 'Dine Out'
    | 'Zomato Pay'
    | 'Eazydiner'
    | 'Cash'
    | 'Upi'
    | 'Card'
    | 'Online Transfer';

type RestaurantData = {
    profile: RestaurantProfile;
    bookings: Booking[];
    customers: Customer[];
    inventory: InventoryItem[];
    menuItems: MenuItem[];
    menuCategories: string[];
    orders: Order[];
    tables: Table[];
    auditLogs: AuditLog[];
};

type RestaurantRecord = {
    id: string;
    name: string;
    users: User[];
    data: RestaurantData;
};

const API_BASE_URL = (
    process.env.NEXT_PUBLIC_RECEPTION_API_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    'http://localhost:3000'
).replace(/\/$/, '');

const restaurantStore = new Map<string, RestaurantRecord>();

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const getRestaurantId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

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
    bookings: [],
    customers: [],
    inventory: [],
    menuItems: [],
    menuCategories: ['Appetizers', 'Main Courses', 'Desserts', 'Beverages'],
    orders: [],
    tables: [],
    auditLogs: [],
});

const ensureLocalRestaurant = (restaurantId: string, restaurantName?: string): RestaurantRecord => {
    const existing = restaurantStore.get(restaurantId);
    if (existing) {
        return existing;
    }

    const name = restaurantName ?? restaurantId;
    const created: RestaurantRecord = {
        id: restaurantId,
        name,
        users: [],
        data: defaultRestaurantData(name),
    };
    restaurantStore.set(restaurantId, created);
    return created;
};

const stableTableId = (tableName: string, fallback = 1): number => {
    if (!tableName) return fallback;
    let hash = 0;
    for (let i = 0; i < tableName.length; i += 1) {
        hash = ((hash << 5) - hash + tableName.charCodeAt(i)) | 0;
    }
    const normalized = Math.abs(hash % 100000);
    return normalized > 0 ? normalized : fallback;
};

const formatBookingTime = (isoString: string): string => {
    const value = new Date(isoString);
    if (Number.isNaN(value.getTime())) {
        return isoString;
    }
    return value.toLocaleString(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
};

const toCustomerStatus = (hasBooking: unknown): Customer['status'] =>
    hasBooking ? 'In-house' : 'Departed';

const toTableStatus = (booked: unknown, reserved: unknown): Table['status'] => {
    if (Boolean(booked)) return 'Occupied';
    if (Boolean(reserved)) return 'Reserved';
    return 'Available';
};

const headersForRestaurant = (restaurantId: string, headers?: HeadersInit): Headers => {
    const merged = new Headers(headers);
    merged.set('X-Restaurant-Id', restaurantId);
    return merged;
};

const backendJson = async <T>(
    path: string,
    restaurantId: string,
    init?: RequestInit,
): Promise<T | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...init,
            cache: 'no-store',
            headers: headersForRestaurant(restaurantId, init?.headers),
        });

        if (!response.ok) {
            return null;
        }

        return (await response.json()) as T;
    } catch (error) {
        console.warn(`Backend request failed for ${path}`, error);
        return null;
    }
};

const backendCall = async (
    path: string,
    restaurantId: string,
    init?: RequestInit,
): Promise<Response | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...init,
            headers: headersForRestaurant(restaurantId, init?.headers),
        });
        return response;
    } catch (error) {
        console.warn(`Backend request failed for ${path}`, error);
        return null;
    }
};

const readErrorMessage = async (response: Response): Promise<string> => {
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

const mapBooking = (item: any): Booking => ({
    id: String(item.booking_id ?? item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    customer: item.customer_name ?? 'Guest',
    time: formatBookingTime(String(item.booking_date_time ?? '')),
    guests: Number(item.number_of_people ?? 0),
    table: item.table_name ?? '',
    source: item.source ?? 'Unknown',
    status: item.status ?? (item.active ? 'Arrived' : 'Confirmed'),
    notes: item.notes ?? item.additional_information ?? '',
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
    return {
        id: stableTableId(name, index + 1),
        name,
        capacity: Number.isFinite(capacity) ? capacity : 0,
        status: toTableStatus(item.booked, item.reserved),
    };
};

const mapAuditLog = (item: any): AuditLog => ({
    id: String(item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    employee: item.employee ?? 'Unknown',
    action: item.action ?? 'Unknown',
    details: item.details ?? '',
    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
});

const mapInventoryItem = (item: any): InventoryItem => ({
    id: String(item.id ?? item.barcode ?? `${Date.now()}`),
    name: String(item.name ?? 'Unnamed Item'),
    category: String(item.category ?? 'General'),
    stock: Math.max(0, Number(item.stock ?? 0)),
    unit: String(item.unit ?? 'pcs'),
    status: (item.status as InventoryItem['status']) ?? 'In Stock',
});

const mapMenuItem = (item: any): MenuItem => ({
    id: String(item.id ?? `${Date.now()}`),
    name: String(item.name ?? 'Unnamed Item'),
    price: Number(item.price ?? 0),
    category: String(item.category ?? 'General'),
});

const mapOrderItem = (item: any) => ({
    id: String(item.id ?? `${Date.now()}`),
    name: String(item.name ?? 'Unnamed'),
    quantity: Math.max(1, Number(item.quantity ?? 1)),
    price: Number(item.price ?? 0),
    orderedAt: String(item.orderedAt ?? new Date().toISOString()),
});

const mapOrder = (item: any): Order => ({
    id: String(item.id ?? `${Date.now()}`),
    table: String(item.table ?? ''),
    customer: String(item.customer ?? 'Guest'),
    taken_by_employee_id:
        typeof item.taken_by_employee_id === 'string' ? item.taken_by_employee_id : null,
    taken_by_employee_name:
        typeof item.taken_by_employee_name === 'string' ? item.taken_by_employee_name : null,
    taken_by_employee_role:
        typeof item.taken_by_employee_role === 'string' ? item.taken_by_employee_role : null,
    items: Array.isArray(item.items) ? item.items.map(mapOrderItem) : [],
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

const seedDefaultRestaurant = () => {
    const id = getRestaurantId('CSR Organics');
    if (restaurantStore.has(id)) return;
    restaurantStore.set(id, {
        id,
        name: 'CSR Organics',
        users: [
            {
                id: '12fa3af0-f13d-4dfc-9b79-a6d634aa07dc',
                res_id: 'e47e69a8-fd5b-462e-bb33-92024b5ab347',
                outlet_id: 'a5390f5a-f99c-4f8c-9916-ab5d6c4f8b99',
                employee_id: '12fa3af0-f13d-4dfc-9b79-a6d634aa07dc',
                employee_Username: 'admin',
                emp_Fname: 'Admin',
                emp_Lname: '-',
                password: 'admin123',
                role: 'admin',
                role_all: ['admin'],
                action_list: ['*'],
            },
        ],
        data: defaultRestaurantData('CSR Organics'),
    });
};

seedDefaultRestaurant();

// --- User and Restaurant Management ---
export const findRestaurantByName = async (name: string) => {
    const normalized = getRestaurantId(name);
    const direct = name.trim().toLowerCase();

    const local = restaurantStore.get(normalized) ?? restaurantStore.get(direct);
    if (local) {
        const verify = await backendCall(
            `/get-customers?restaurantId=${encodeURIComponent(local.id)}`,
            local.id,
            { method: 'GET' },
        );
        console.log(verify);
        if (verify?.ok) {
            return deepClone(local);
        }

        // Remove stale local-only entries that do not exist in backend.
        restaurantStore.delete(local.id);
    }

    const probe = await backendCall(`/get-customers?restaurantId=${encodeURIComponent(normalized)}`, normalized, {
        method: 'GET',
    });

    if (!probe || !probe.ok) {
        return null;
    }

    const created = ensureLocalRestaurant(normalized, name);
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
            headers: {
                'X-Employee-Id': employeeId,
                'X-User-Role': 'admin',
            },
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

export const createRestaurant = async (restaurantName: string, admin: User) => {
    const id = getRestaurantId(restaurantName);
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

    const restaurant: RestaurantRecord = {
        id: persistedId,
        name: persistedName,
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

    const payload = await resp.json().catch(() => null) as any;
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
export const getBookings = async (restaurantId: string): Promise<Booking[]> => {
    const data = await backendJson<any[]>(
        `/get-bookings?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapBooking);
        await writeLocalField(restaurantId, 'bookings', mapped);
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

    return readLocalField<string[]>(restaurantId, 'menuCategories');
};

export const getOrders = async (restaurantId: string): Promise<Order[]> => {
    const data = await backendJson<any[]>(
        `/orders?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapOrder);
        await writeLocalField(restaurantId, 'orders', mapped);
        return mapped;
    }

    return readLocalField<Order[]>(restaurantId, 'orders');
};

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

export const getAuditLogs = async (restaurantId: string, limit = 100): Promise<AuditLog[]> => {
    const data = await backendJson<any[]>(
        `/audit-logs?restaurantId=${encodeURIComponent(restaurantId)}&limit=${Math.max(1, limit)}`,
        restaurantId,
        { method: 'GET' },
    );

    if (Array.isArray(data)) {
        const mapped = data.map(mapAuditLog);
        await writeLocalField(restaurantId, 'auditLogs', mapped);
        return mapped;
    }

    return readLocalField<AuditLog[]>(restaurantId, 'auditLogs');
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
        await getOrders(restaurantId);
        return { acknowledged: true };
    }

    await addToLocalField(restaurantId, 'orders', order);
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

    if (!response) return null;
    if (!response.ok) return null;
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

    if (!response) return null;
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
) => {
    const response = await backendCall(`/bills/order/${encodeURIComponent(orderId)}/waiter-confirm-payment`, restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Employee-Id': employeeId,
        },
        body: JSON.stringify({ payment_method }),
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
    if (!response || !response.ok) return null;
    try { return await response.json(); } catch { return null; }
};

export const getRestaurantLogo = async (restaurantId: string): Promise<string | null> => {
    const response = await backendCall('/restaurant/logo', restaurantId, { method: 'GET' });
    if (!response || !response.ok) return null;
    try { const data = await response.json(); return data?.logo_base64 ?? null; } catch { return null; }
};

export const getOutletDefaultTax = async (restaurantId: string): Promise<Record<string, number> | null> => {
    const response = await backendCall('/outlets/default-tax', restaurantId, { method: 'GET' });
    if (!response || !response.ok) return null;
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

export const addAuditLogEntry = async (
    restaurantId: string,
    log: Omit<AuditLog, 'id' | 'timestamp'> & { employeeId?: string },
): Promise<void> => {
    const response = await backendCall('/audit-logs', restaurantId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(log.employeeId ? { 'X-Employee-Id': log.employeeId } : {}),
        },
        body: JSON.stringify({
            employee: log.employeeId ?? log.employee,
            employee_id: log.employeeId ?? null,
            action: log.action,
            details: log.details ?? null,
        }),
    });

    if (response?.ok) {
        await getAuditLogs(restaurantId);
        return;
    }

    const logs = await getAuditLogs(restaurantId);
    logs.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        employee: log.employee,
        action: log.action,
        details: log.details ?? '',
        timestamp: new Date().toISOString(),
    });
    await writeLocalField(restaurantId, 'auditLogs', logs);
};

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
        body: JSON.stringify(profile),
    });

    if (response?.ok) {
        await getRestaurantProfile(restaurantId, employeeId);
        return { acknowledged: true };
    }

    const restaurant = ensureLocalRestaurant(restaurantId);
    restaurant.name = profile.restaurant_name;
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

export type ActionRow = {
    id: string;
    action_name: string;
    action_desc?: string | null;
    group?: string | null;
};

export type CoreRoleRow = {
    role: string;
    actions: string[]; // '*' indicates all actions
};

export const getActions = async (
    restaurantId: string,
    actionList: string[]
): Promise<Array<{ group: string; actions: { id: string; name: string; desc?: string | null }[] }>> => {
    const data = await backendJson<ActionRow[]>(
        `/actions?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Action-List': actionList.join(',') } },
    );

    if (!Array.isArray(data)) return [];

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

export const getCoreRoles = async (restaurantId: string): Promise<CoreRoleRow[]> => {
    const data = await backendJson<CoreRoleRow[]>(
        `/core-roles?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
        { method: 'GET' },
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
