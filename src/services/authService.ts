

'use server';

import { findRestaurantByName, findUserInRestaurant, createRestaurant, User, addEmployee, removeEmployee } from '@/lib/db';

// This is a mock authentication service that uses the in-memory database.
// In a real application, you would use a secure authentication provider.

const getRestaurantId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// Restaurant and Admin Sign Up
export const signUpRestaurant = async ({ restaurantName, adminName, adminEmployeeId, password }: {
    restaurantName: string,
    adminName: string,
    adminEmployeeId: string,
    password: string
}) => {
    try {
        const adminUser: User = {
            employeeId: adminEmployeeId,
            name: adminName,
            password: password, // In a real app, hash this password
            role: 'admin' as const
        };
    const newRestaurant = await createRestaurant(restaurantName, adminUser);
    return { user: { uid: newRestaurant.id, ...adminUser } };
    } catch (error: any) {
        console.error("Registration failed:", error);
        throw error;
    }
}

// Employee Sign In
export const signInEmployee = async (restaurantName: string, employeeId: string, password: string) => {
    const restaurant = await findRestaurantByName(restaurantName);
    if (!restaurant) {
        throw new Error('Invalid restaurant name.');
    }

    const user = await findUserInRestaurant(restaurant.id, employeeId);

    if (!user || user.password !== password) {
        throw new Error('Invalid employee ID or password.');
    }
    
    return {
        uid: user.employeeId,
        employeeId: user.employeeId,
        name: user.name,
        role: user.role,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
    };
}

// Password Reset - Mock implementation
export const sendPasswordReset = async (restaurantName: string, employeeId: string) => {
    const restaurant = await findRestaurantByName(restaurantName);
    if (!restaurant) {
        console.log(`Password reset requested for non-existent restaurant: ${restaurantName}`);
        return;
    }
    
    const user = await findUserInRestaurant(restaurant.id, employeeId);
    if (!user) {
        console.log(`Password reset requested for non-existent user: ${employeeId}`);
        return;
    }

    console.log(`A password reset link would be sent to the registered email for employee ${employeeId} at ${restaurantName}.`);
}

// Sign Out - Mock implementation
export const signOutUser = async () => {
    console.log("User signed out.");
    return;
}

// Add a new employee to a restaurant
export const addEmployeeToRestaurant = async (restaurantId: string, employeeData: Omit<User, 'password'> & {password: string}) => {
    const existingUser = await findUserInRestaurant(restaurantId, employeeData.employeeId);
    if (existingUser) {
        throw new Error("An employee with this ID already exists.");
    }
    
    const newEmployee: User = {
        name: employeeData.name,
        employeeId: employeeData.employeeId,
        password: employeeData.password, // Hash in real app
        role: employeeData.role,
    };

    await addEmployee(restaurantId, newEmployee);
    return newEmployee;
};

// Remove an employee from a restaurant
export const removeEmployeeFromRestaurant = async (restaurantId: string, employeeId: string) => {
    const restaurant = await findRestaurantByName(getRestaurantId(restaurantId));
     if (!restaurant) {
        throw new Error("Restaurant not found.");
    }

    const userToRemove = await findUserInRestaurant(restaurantId, employeeId);
    if (!userToRemove) {
        throw new Error("Employee not found.");
    }

    const adminUsers = restaurant.users.filter((u:User) => u.role === 'admin');
    if (userToRemove.role === 'admin' && adminUsers.length <= 1) {
        throw new Error("Cannot remove the only admin of the restaurant.");
    }
    
    await removeEmployee(restaurantId, employeeId);
    
    return true;
};
