// A simple in-memory database for prototyping purposes.

export type User = {
    employeeId: string;
    name: string;
    password: string; // In a real app, this should be a hash.
    role: 'admin' | 'employee';
};

export type Restaurant = {
    id: string;
    name: string;
    users: User[];
};

// IMPORTANT: Restaurant names must be unique.
export const db: Restaurant[] = [
    {
        id: 'thegrandbistro',
        name: 'The Grand Bistro',
        users: [
            { employeeId: 'admin', name: 'John Doe', password: 'password123', role: 'admin' },
            { employeeId: 'employee1', name: 'Jane Smith', password: 'password', role: 'employee' }
        ]
    }
];

export const findRestaurantByName = (name: string): Restaurant | undefined => {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return db.find(r => r.id === normalizedName);
};

export const findUserInRestaurant = (restaurantId: string, employeeId: string): User | undefined => {
    const restaurant = db.find(r => r.id === restaurantId);
    if (!restaurant) return undefined;
    return restaurant.users.find(u => u.employeeId.toLowerCase() === employeeId.toLowerCase());
};

export const createRestaurant = (restaurantName: string, admin: User): Restaurant => {
    const normalizedName = restaurantName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (findRestaurantByName(restaurantName)) {
        throw new Error(`A restaurant with the name "${restaurantName}" already exists.`);
    }

    const newRestaurant: Restaurant = {
        id: normalizedName,
        name: restaurantName,
        users: [admin]
    };

    db.push(newRestaurant);
    return newRestaurant;
};
