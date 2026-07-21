

'use server';

import { findRestaurantByName, findUserInRestaurant, createRestaurant, User, addEmployee, removeEmployee } from '@/lib/db';

// Authentication service: thin server-action wrapper over the backend auth API
// (employee login, restaurant registration, employee management, password reset).

const getRestaurantId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const API_BASE_URL = (
    process.env.NEXT_PUBLIC_RECEPTION_API_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    'http://localhost:3000'
).replace(/\/$/, '');

const readErrorMessage = async (response: Response): Promise<string> => {
    if (response.status === 403) {
        return 'Action forbidden';
    }

    try {
        const payload = await response.json();
        if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
            return payload.error;
        }
    } catch {
        // Ignore parse errors and fall back to text.
    }

    try {
        const text = await response.text();
        if (text.trim().length > 0) {
            return text;
        }
    } catch {
        // Ignore text read errors and return generic message.
    }

    return 'Unable to sign in.';
};

// Restaurant and Admin Sign Up
export const signUpRestaurant = async ({ restaurantName, adminName, adminEmployeeId, password }: {
    restaurantName: string,
    adminName: string,
    adminEmployeeId: string,
    password: string
}) => {
    try {
        const restaurantId = getRestaurantId(restaurantName);
        const adminUser: User = {
            id: adminEmployeeId,
            res_id: restaurantId,
            outlet_id: 'main',
            employee_id: adminEmployeeId,
            employee_Username: adminEmployeeId,
            // store admin full name as first name for backwards-compatible signup UI
            emp_Fname: adminName,
            emp_Lname: null,
            password: password, // In a real app, hash this password
            role: 'admin' as const,
            action_list: [],
        };
        const newRestaurant = await createRestaurant(restaurantName, adminUser);
        return { user: { uid: newRestaurant.res_id, ...adminUser } };
    } catch (error: any) {
        console.error("Registration failed:", error);
        throw error;
    }
}

// Fetch the outlets for a restaurant (id + name only). Returns [] on any
// non-ok/error response and never throws, so the login page can degrade to a
// single-outlet form when the list is empty or unavailable.
export const getOutlets = async (restaurant: string): Promise<{ id: string; name: string }[]> => {
    try {
        const response = await fetch(
            `${API_BASE_URL}/auth/outlets?restaurant=${encodeURIComponent(restaurant)}`,
            { cache: 'no-store' },
        );
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.outlets)) {
            return [];
        }
        return payload.outlets
            .filter((o: any) => o && typeof o.id === 'string' && typeof o.name === 'string')
            .map((o: any) => ({ id: o.id as string, name: o.name as string }));
    } catch {
        return [];
    }
}

// Employee Sign In
export const signInEmployee = async (restaurantName: string, employeeUsername: string, password: string, outletId?: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/employee-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
            restaurantName,
            employeeUsername,
            password,
            ...(outletId ? { outletId } : {}),
        }),
    });

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    return await response.json();
}

// Password reset: files a forgot-password request with the backend.
export const sendPasswordReset = async (restaurantName: string, employeeUsername: string) => {
    // File a forgot-password request: the restaurant's admin fulfils it from the
    // Employees page. The backend always responds success (no account enumeration).
    try {
        await fetch(`${API_BASE_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ restaurant: restaurantName, username: employeeUsername }),
            cache: 'no-store',
        });
    } catch (error) {
        console.warn('forgot_password_request_failed', error);
    }
}

// Sign out: client-side no-op. The session is a bearer token held client-side and
// invalidated server-side via the backend /auth/logout call (see the auth hook);
// nothing to clear here.
export const signOutUser = async () => {
    return;
}

// Add a new employee to a restaurant
export const addEmployeeToRestaurant = async (restaurantId: string, outletId: string, employeeData: Record<string, any>, sendee_emp_id: string) => {
    // Server will generate the employee ID. Forward payload to backend via addEmployee.
    const newEmployee = {
        emp_Fname: employeeData.emp_Fname ?? undefined,
        emp_Lname: employeeData.emp_Lname ?? undefined,
        // employeeId intentionally omitted
        password: employeeData.password, // In a real app, hash this before sending
        role: employeeData.role ?? 'employee',
        username: employeeData.username ?? undefined,
        email: employeeData.email ?? undefined,
        ph: employeeData.ph ?? undefined,
        add: employeeData.add ?? undefined,
    } as any;

    await addEmployee(restaurantId, newEmployee as any, outletId, sendee_emp_id);
    return newEmployee;
};

// Remove an employee from a restaurant
export const removeEmployeeFromRestaurant = async (restaurantUsername: string, employeeIdToRemove: string, restaurantID: string, requestingEmployeeID: string, outletId: string) => {
    const restaurant = await findRestaurantByName(getRestaurantId(restaurantUsername));
    if (!restaurant) {
        throw new Error("Restaurant not found.");
    }

    const userToRemove = await findUserInRestaurant(restaurantUsername, employeeIdToRemove);
    if (!userToRemove) {
        throw new Error("Employee not found.");
    }

    const adminUsers = restaurant.users.filter((u: User) => u.role === 'admin');
    if (userToRemove.role === 'admin' && adminUsers.length <= 1) {
        throw new Error("Cannot remove the only admin of the restaurant.");
    }

    await removeEmployee(restaurantUsername, restaurantID, employeeIdToRemove, requestingEmployeeID, outletId);

    return true;
};
