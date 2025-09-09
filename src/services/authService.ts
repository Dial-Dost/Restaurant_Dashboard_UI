
import { db, findRestaurantByName, findUserInRestaurant, createRestaurant, User } from '@/lib/db';

// This is a mock authentication service that uses the in-memory database.
// In a real application, you would use a secure authentication provider.

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
        const newRestaurant = createRestaurant(restaurantName, adminUser);
        return { user: { uid: newRestaurant.id, name: adminName, ...adminUser } }; // Return a mock user object
    } catch (error: any) {
        console.error("Registration failed:", error);
        throw error; // Re-throw the error to be caught by the UI
    }
}

// Employee Sign In
export const signInEmployee = async (restaurantName: string, employeeId: string, password: string) => {
    const restaurant = findRestaurantByName(restaurantName);
    if (!restaurant) {
        throw new Error('Invalid restaurant name.');
    }

    const user = findUserInRestaurant(restaurant.id, employeeId);

    if (!user || user.password !== password) {
        throw new Error('Invalid employee ID or password.');
    }
    
    // In a real app, you'd get a session token here.
    // For this mock service, we just return a mock user object with role and restaurant info.
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
    const restaurant = findRestaurantByName(restaurantName);
    if (!restaurant) {
        // Don't reveal if user exists for security reasons
        console.log(`Password reset requested for non-existent restaurant: ${restaurantName}`);
        return;
    }
    
    const user = findUserInRestaurant(restaurant.id, employeeId);
    if (!user) {
        // Don't reveal if user exists
        console.log(`Password reset requested for non-existent user: ${employeeId}`);
        return;
    }

    // In a real app, you would send an email. Here we just log it.
    console.log(`A password reset link would be sent to the registered email for employee ${employeeId} at ${restaurantName}.`);
}

// Sign Out - Mock implementation
export const signOutUser = async () => {
    // In a real app, this would clear session tokens/cookies.
    console.log("User signed out.");
    return;
}

// Add a new employee to a restaurant
export const addEmployeeToRestaurant = async (restaurantId: string, employeeData: Omit<User, 'password'> & {password: string}) => {
    const restaurant = db.find(r => r.id === restaurantId);
    if (!restaurant) {
        throw new Error("Restaurant not found.");
    }

    const existingUser = restaurant.users.find(u => u.employeeId.toLowerCase() === employeeData.employeeId.toLowerCase());
    if (existingUser) {
        throw new Error("An employee with this ID already exists.");
    }
    
    const newEmployee: User = {
        name: employeeData.name,
        employeeId: employeeData.employeeId,
        password: employeeData.password, // Hash in real app
        role: employeeData.role,
    };

    restaurant.users.push(newEmployee);
    return newEmployee;
};

// Remove an employee from a restaurant
export const removeEmployeeFromRestaurant = async (restaurantId: string, employeeId: string) => {
    const restaurant = db.find(r => r.id === restaurantId);
     if (!restaurant) {
        throw new Error("Restaurant not found.");
    }

    const userIndex = restaurant.users.findIndex(u => u.employeeId.toLowerCase() === employeeId.toLowerCase());
    
    if (userIndex === -1) {
        throw new Error("Employee not found.");
    }

    const userToRemove = restaurant.users[userIndex];
    if (userToRemove.role === 'admin' && restaurant.users.filter(u => u.role === 'admin').length === 1) {
        throw new Error("Cannot remove the only admin of the restaurant.");
    }

    restaurant.users.splice(userIndex, 1);
    return true;
};
