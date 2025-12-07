
'use server';

import { connectToDatabase } from './mongodb';
import { type Booking } from '@/app/dashboard/bookings/data';
import { type Customer } from '@/app/dashboard/customers/page';
import { type InventoryItem } from '@/app/dashboard/inventory/page';
import { type MenuItem } from '@/app/dashboard/menu/data';
import { type Order } from '@/app/dashboard/orders/page';
import { type Table } from '@/app/dashboard/tables/data';
import { type AuditLog } from '@/app/dashboard/audit-logs/page';
import { ObjectId } from 'mongodb';

export type User = {
    employeeId: string;
    name: string;
    password?: string; // Should be hashed. Optional for retrieval.
    role: 'admin' | 'employee';
};

export type RestaurantProfile = {
    name: string;
    address: string;
    phone: string;
    email: string;
    hours: string;
}

// Helper to serialize MongoDB objects
const serializeMongoObject = (obj: any): any => {
    if (!obj) {
        return null;
    }
    if (Array.isArray(obj)) {
        return obj.map(serializeMongoObject);
    }
    // Check for ObjectId specifically
    if (obj instanceof ObjectId) {
        return obj.toString();
    }
    if (typeof obj === 'object' && obj !== null) {
        const newObj: { [key: string]: any } = {};
        for (const key in obj) {
            if (key === '_id') {
                // In MongoDB, the id is an object. We need to convert it to a string
                 if (typeof obj[key].toString === 'function') {
                    newObj['id'] = obj[key].toString();
                } else {
                    newObj['id'] = obj[key];
                }
            } else {
                 newObj[key] = serializeMongoObject(obj[key]);
            }
        }
        return newObj;
    }
    return obj;
};

const getCollection = async (collectionName: string) => {
    const db = await connectToDatabase();
    return db.collection(collectionName);
};

// Internal helper, not exported
const getRestaurantId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// --- User and Restaurant Management ---
export const findRestaurantByName = async (name: string) => {
    const restaurants = await getCollection('restaurants');
    const id = getRestaurantId(name);
    const restaurant = await restaurants.findOne({ id: id });
    return serializeMongoObject(restaurant);
};

export const findUserInRestaurant = async (restaurantId: string, employeeId: string) => {
    const restaurants = await getCollection('restaurants');
    const restaurant = await restaurants.findOne({ id: restaurantId });
    if (!restaurant || !restaurant.users) return null;
    const user = restaurant.users.find((u: User) => u.employeeId.toLowerCase() === employeeId.toLowerCase()) || null;
    return serializeMongoObject(user);
};

export const createRestaurant = async (restaurantName: string, admin: User) => {
    const restaurants = await getCollection('restaurants');
    const id = getRestaurantId(restaurantName);
    const existing = await restaurants.findOne({ id: id });

    if (existing) {
        throw new Error(`A restaurant with the name "${restaurantName}" already exists.`);
    }

    const newRestaurant = {
        id,
        name: restaurantName,
        users: [admin],
        data: {
            profile: { name: restaurantName, address: "", phone: "", email: "", hours: "" },
            bookings: [], customers: [], inventory: [], menuItems: [], 
            menuCategories: ["Appetizers", "Main Courses", "Desserts", "Beverages"], 
            orders: [], tables: [], auditLogs: []
        }
    };

    const result = await restaurants.insertOne(newRestaurant as any);
    return serializeMongoObject({ ...newRestaurant, _id: result.insertedId });
};

export const addEmployee = async (restaurantId: string, employee: User) => {
    const restaurants = await getCollection('restaurants');
    return await (restaurants as any).updateOne({ id: restaurantId }, { $push: { users: employee } } as any);
};

export const removeEmployee = async (restaurantId: string, employeeId: string) => {
    const restaurants = await getCollection('restaurants');
    return await (restaurants as any).updateOne({ id: restaurantId }, { $pull: { users: { employeeId: employeeId } } } as any);
};


// --- Generic Data Access Functions ---
const getRestaurantDataField = async (restaurantId: string, field: string) => {
    const restaurants = await getCollection('restaurants');
    const restaurant = await restaurants.findOne({ id: restaurantId });
    if (!restaurant) throw new Error("Restaurant not found.");
    
    let data = restaurant.data?.[field];

    if (field === 'profile' && !data) {
        data = { name: "", address: "", phone: "", email: "", hours: "" };
    } else if (!data) {
        data = [];
    }

    return serializeMongoObject(data);
};

const updateRestaurantDataField = async (restaurantId: string, field: string, data: any) => {
    const restaurants = await getCollection('restaurants');
    return await (restaurants as any).updateOne({ id: restaurantId }, { $set: { [`data.${field}`]: data } } as any);
};

const addItemToRestaurantData = async (restaurantId: string, field: string, item: any) => {
    const restaurants = await getCollection('restaurants');
    if (!item.id) {
        // Find the max id and increment it
        const restaurant = await restaurants.findOne({ id: restaurantId });
        const dataArray = restaurant?.data?.[field] || [];
        const maxId = dataArray.reduce((max: number, current: any) => current.id > max ? current.id : max, 0);
        item.id = maxId + 1;
    }
    return await (restaurants as any).updateOne({ id: restaurantId }, { $push: { [`data.${field}`]: item } } as any);
}

// --- Specific Data Accessors ---
export const getBookings = async (restaurantId: string): Promise<Booking[]> => await getRestaurantDataField(restaurantId, 'bookings');
export const getCustomers = async (restaurantId: string): Promise<Customer[]> => await getRestaurantDataField(restaurantId, 'customers');
export const getInventory = async (restaurantId: string): Promise<InventoryItem[]> => await getRestaurantDataField(restaurantId, 'inventory');
export const getMenuItems = async (restaurantId: string): Promise<MenuItem[]> => await getRestaurantDataField(restaurantId, 'menuItems');
export const getMenuCategories = async (restaurantId: string): Promise<string[]> => await getRestaurantDataField(restaurantId, 'menuCategories');
export const getOrders = async (restaurantId: string): Promise<Order[]> => await getRestaurantDataField(restaurantId, 'orders');
export const getTables = async (restaurantId: string): Promise<Table[]> => await getRestaurantDataField(restaurantId, 'tables');
export const getAuditLogs = async (restaurantId: string, limit = 100): Promise<AuditLog[]> => {
    try {
        const auditLogsCollection = await getCollection('audit_logs');
        const docs = await auditLogsCollection
            .find({ restaurant_id: restaurantId })
            .sort({ timestamp: -1 })
            .limit(Math.max(1, limit))
            .toArray();

        return docs.map((doc: any) => ({
            id: doc._id ? doc._id.toString() : `${restaurantId}-${Math.random().toString(36).slice(2, 10)}`,
            employee: doc.employee ?? 'Unknown',
            action: doc.action ?? 'Unknown',
            details: doc.details ?? '',
            timestamp: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : new Date(doc.timestamp ?? Date.now()).toISOString(),
        }));
    } catch (error) {
        console.error('Failed to fetch audit logs', error);
        return [];
    }
};
export const getRestaurantProfile = async (restaurantId: string): Promise<RestaurantProfile> => await getRestaurantDataField(restaurantId, 'profile');


export const addBooking = async (restaurantId: string, booking: Booking) => await addItemToRestaurantData(restaurantId, 'bookings', booking);
export const addCustomer = async (restaurantId: string, customer: Customer) => await addItemToRestaurantData(restaurantId, 'customers', customer);
export const addInventoryItem = async (restaurantId: string, item: InventoryItem) => await addItemToRestaurantData(restaurantId, 'inventory', item);
export const addMenuItem = async (restaurantId: string, item: MenuItem) => await addItemToRestaurantData(restaurantId, 'menuItems', item);
export const addOrder = async (restaurantId: string, order: Order) => await addItemToRestaurantData(restaurantId, 'orders', order);
export const addTable = async (restaurantId: string, table: Omit<Table, 'id'>) => await addItemToRestaurantData(restaurantId, 'tables', table);

export const addMenuCategory = async (restaurantId: string, category: string) => {
    const restaurants = await getCollection('restaurants');
    return await (restaurants as any).updateOne({ id: restaurantId }, { $addToSet: { 'data.menuCategories': category } } as any);
};

export const addAuditLogEntry = async (restaurantId: string, log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> => {
    const auditLogsCollection = await getCollection('audit_logs');
    const entry = {
        restaurant_id: restaurantId,
        employee: log.employee,
        action: log.action,
        details: log.details ?? null,
        timestamp: new Date(),
    };
    await (auditLogsCollection as any).insertOne(entry);
};

export const updateTableStatus = async (
    restaurantId: string,
    tableName: string,
    status: 'Available' | 'Reserved' | 'Booked' | 'Occupied',
) => {
    const tables = await getTables(restaurantId);
    const updatedTables = tables.map(t => t.name === tableName ? { ...t, status } : t);
    return await updateRestaurantDataField(restaurantId, 'tables', updatedTables);
};

export const updateRestaurantProfile = async (restaurantId: string, profile: RestaurantProfile) => {
    const restaurants = await getCollection('restaurants');
    await (restaurants as any).updateOne({ id: restaurantId }, { $set: { name: profile.name, 'data.profile': profile } } as any);
};

export const removeInventoryItem = async (restaurantId: string, itemId: string) => {
    const inventory = await getInventory(restaurantId);
    const updatedInventory = inventory.filter(item => item.id !== itemId);
    return await updateRestaurantDataField(restaurantId, 'inventory', updatedInventory);
};

export const removeTable = async (restaurantId: string, tableId: number) => {
    const restaurants = await getCollection('restaurants');
    return await (restaurants as any).updateOne({ id: restaurantId }, { $pull: { 'data.tables': { id: tableId } } } as any);
}

export const saveTables = async (restaurantId: string, tables: Table[]) => {
    return await updateRestaurantDataField(restaurantId, 'tables', tables);
}

export const cancelBooking = async (restaurantId: string, bookingId: string) => {
    const bookings = await getBookings(restaurantId);
    const updatedBookings = bookings.filter(b => b.id !== bookingId);
    return await updateRestaurantDataField(restaurantId, 'bookings', updatedBookings);
};

export const updateBookingStatus = async (restaurantId: string, bookingId: string, status: Booking['status']) => {
    const bookings = await getBookings(restaurantId);
    const updatedBookings = bookings.map(b => b.id === bookingId ? { ...b, status } : b);
    return await updateRestaurantDataField(restaurantId, 'bookings', updatedBookings);
};

export const saveMenuItems = async (restaurantId: string, items: MenuItem[]) => {
    return await updateRestaurantDataField(restaurantId, 'menuItems', items);
};
