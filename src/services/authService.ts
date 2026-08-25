

'use server';

import { serverBackendBase } from '@/lib/backend-url';
import type { User} from '@/lib/db';
import { findRestaurantByName, findUserInRestaurant, createRestaurant, addEmployee, removeEmployee } from '@/lib/db';

// Authentication service: thin server-action wrapper over the backend auth API
// (employee login, restaurant registration, employee management, password reset).

const getRestaurantId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// This module is 'use server', so every fetch below runs inside the Next
// container and the base MUST be absolute — a relative "/backend-api" would
// throw `TypeError: Failed to parse URL`.
//
// Two bugs are fixed here at once. The `??` chain did not fall back on an EMPTY
// NEXT_PUBLIC_BACKEND_URL, so a production build with a blank build-arg made
// this "" and every login POST went to a bare path. And the literal default was
// port 3000 — the DASHBOARD's own port, not the backend's 3001 — so the
// fallback had never pointed at the backend even when it did fire.
const apiBaseUrl = (): string => serverBackendBase();

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
            password, // In a real app, hash this password
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
            `${apiBaseUrl()}/auth/outlets?restaurant=${encodeURIComponent(restaurant)}`,
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

// Employee Sign In.
//
// RETURNS the failure, never throws it. This is a 'use server' module, and an
// Error thrown across the server-action boundary has its message REDACTED by
// Next in production ("The specific message is omitted in production builds…")
// — so a wrong password showed that dialog instead of "Invalid employee ID or
// password." A returned {ok:false} carries the backend's sentence verbatim.
export type SignInResult =
    | { ok: true; user: Record<string, unknown> }
    | { ok: false; error: string };

export const signInEmployee = async (restaurantName: string, employeeUsername: string, password: string, outletId?: string): Promise<SignInResult> => {
    let response: Response;
    try {
        response = await fetch(`${apiBaseUrl()}/auth/employee-login`, {
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
    } catch {
        // The backend itself was unreachable — a transport failure, not a
        // credential one; say so rather than blaming the password.
        return { ok: false, error: 'Could not reach the server. Please try again in a moment.' };
    }

    if (!response.ok) {
        return { ok: false, error: await readErrorMessage(response) };
    }

    return { ok: true, user: await response.json() as Record<string, unknown> };
}

// Password reset: files a forgot-password request with the backend.
export const sendPasswordReset = async (restaurantName: string, employeeUsername: string) => {
    // File a forgot-password request: the restaurant's admin fulfils it from the
    // Employees page. The backend always responds success (no account enumeration).
    try {
        await fetch(`${apiBaseUrl()}/auth/forgot-password`, {
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

    await addEmployee(restaurantId, newEmployee, outletId, sendee_emp_id);
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
