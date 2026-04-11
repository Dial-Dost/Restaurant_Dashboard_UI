'use server';

import { type Booking } from '@/app/dashboard/bookings/data';
import { type Customer } from '@/app/dashboard/customers/page';
import { type InventoryItem } from '@/app/dashboard/inventory/page';
import { type MenuItem } from '@/app/dashboard/menu/data';
import { type Order } from '@/app/dashboard/orders/page';
import { type Table } from '@/app/dashboard/tables/data';
import { type AuditLog } from '@/app/dashboard/audit-logs/page';

export type User = {
    employeeId: string;
    name: string;
    password?: string;
    role: 'admin' | 'employee' | 'valet';
};

export type RestaurantProfile = {
    name: string;
    address: string;
    phone: string;
    email: string;
    hours: string;
};

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
    profile: { name: restaurantName, address: '', phone: '', email: '', hours: '' },
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
                employeeId: 'admin',
                name: 'Admin',
                password: 'admin123',
                role: 'admin',
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
        return deepClone(local);
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
        local.users.find((u) => u.employeeId.toLowerCase() === employeeId.toLowerCase()) ?? null;
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
        local.users.find((u) => u.employeeId.toLowerCase() === employeeId.toLowerCase()) ?? null;
    return matched ? deepClone(matched) : null;
};

export const createRestaurant = async (restaurantName: string, admin: User) => {
    const id = getRestaurantId(restaurantName);
    if (restaurantStore.has(id)) {
        throw new Error(`A restaurant with the name "${restaurantName}" already exists.`);
    }

    const restaurant: RestaurantRecord = {
        id,
        name: restaurantName,
        users: [admin],
        data: defaultRestaurantData(restaurantName),
    };
    restaurantStore.set(id, restaurant);
    return deepClone(restaurant);
};

export const addEmployee = async (restaurantId: string, employee: User) => {
    const restaurant = ensureLocalRestaurant(restaurantId);
    restaurant.users.push(deepClone(employee));
    return { acknowledged: true };
};

export const removeEmployee = async (restaurantId: string, employeeId: string) => {
    const restaurant = ensureLocalRestaurant(restaurantId);
    restaurant.users = restaurant.users.filter((u) => u.employeeId !== employeeId);
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

export const getInventory = async (restaurantId: string): Promise<InventoryItem[]> =>
    readLocalField<InventoryItem[]>(restaurantId, 'inventory');

export const getMenuItems = async (restaurantId: string): Promise<MenuItem[]> =>
    readLocalField<MenuItem[]>(restaurantId, 'menuItems');

export const getMenuCategories = async (restaurantId: string): Promise<string[]> =>
    readLocalField<string[]>(restaurantId, 'menuCategories');

export const getOrders = async (restaurantId: string): Promise<Order[]> =>
    readLocalField<Order[]>(restaurantId, 'orders');

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

export const getRestaurantProfile = async (restaurantId: string): Promise<RestaurantProfile> =>
    readLocalField<RestaurantProfile>(restaurantId, 'profile');

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
    await addToLocalField(restaurantId, 'inventory', item);
    return { acknowledged: true };
};

export const addMenuItem = async (restaurantId: string, item: MenuItem) => {
    await addToLocalField(restaurantId, 'menuItems', item);
    return { acknowledged: true };
};

export const addOrder = async (restaurantId: string, order: Order) => {
    await addToLocalField(restaurantId, 'orders', order);
    return { acknowledged: true };
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
    const categories = await getMenuCategories(restaurantId);
    if (!categories.includes(category)) {
        categories.push(category);
        await writeLocalField(restaurantId, 'menuCategories', categories);
    }
    return { acknowledged: true };
};

export const addAuditLogEntry = async (
    restaurantId: string,
    log: Omit<AuditLog, 'id' | 'timestamp'>,
): Promise<void> => {
    const response = await backendCall('/audit-logs', restaurantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            employee: log.employee,
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

export const updateRestaurantProfile = async (restaurantId: string, profile: RestaurantProfile) => {
    const restaurant = ensureLocalRestaurant(restaurantId);
    restaurant.name = profile.name;
    restaurant.data.profile = deepClone(profile);
    return { acknowledged: true };
};

export const removeInventoryItem = async (restaurantId: string, itemId: string) => {
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
    await writeLocalField(restaurantId, 'menuItems', items);
    return { acknowledged: true };
};
