
import { db } from '@/lib/firebase';
import { 
    collection, 
    doc, 
    setDoc, 
    getDoc,
    query,
    where,
    getDocs,
    Timestamp,
    addDoc,
    limit
} from 'firebase/firestore';


export const normalizeName = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Helper to get restaurant doc reference, now efficient and case-insensitive
export const getRestaurantRef = async (restaurantName: string) => {
    const normalizedTargetName = normalizeName(restaurantName);
    if (!normalizedTargetName) {
         throw new Error(`Invalid restaurant name provided.`);
    }

    const restaurantsCollection = collection(db, "restaurants");
    const q = query(restaurantsCollection, where("normalizedName", "==", normalizedTargetName), limit(1));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        throw new Error(`Restaurant "${restaurantName}" not found.`);
    }
    
    // Return the document reference from the query result
    return querySnapshot.docs[0].ref;
}


// Create Restaurant and Admin Employee
export const createRestaurantWithAdmin = async (
    adminUid: string,
    restaurantName: string, 
    adminName: string,
    adminEmployeeId: string
) => {
    const normalizedRestaurantName = normalizeName(restaurantName);
    if (!normalizedRestaurantName) {
        throw new Error("Restaurant name must contain alphanumeric characters.");
    }

    // Use the normalized name as the document ID
    const restaurantRef = doc(db, "restaurants", normalizedRestaurantName);
    const restaurantSnap = await getDoc(restaurantRef);

    if (restaurantSnap.exists()) {
        throw new Error(`A restaurant with the name "${restaurantName}" already exists.`);
    }

    // Create the restaurant document
    await setDoc(restaurantRef, {
        name: restaurantName,
        normalizedName: normalizedRestaurantName,
        createdAt: Timestamp.now()
    });

    // Create the employee document within the new restaurant's subcollection
    const employeeRef = doc(collection(restaurantRef, "employees"), adminEmployeeId);
    await setDoc(employeeRef, {
        uid: adminUid,
        name: adminName,
        employeeId: adminEmployeeId,
        role: "admin",
        createdAt: Timestamp.now()
    });
}

// Get Employee Details
export const getEmployeeDetails = async (restaurantName: string, employeeId: string) => {
    const restaurantRef = await getRestaurantRef(restaurantName);
    const employeeRef = doc(collection(restaurantRef, "employees"), employeeId);

    const employeeSnap = await getDoc(employeeRef);

    if (!employeeSnap.exists()) {
        throw new Error(`Employee with ID "${employeeId}" not found in this restaurant.`);
    }

    return employeeSnap.data();
}

// Audit Log Service
type AuditLogData = {
    action: string;
    details: Record<string, any>;
    performedBy: string; // employeeId
}

export const logAction = async (restaurantName: string, logData: AuditLogData) => {
    try {
        const restaurantRef = await getRestaurantRef(restaurantName);
        const auditLogCollection = collection(restaurantRef, "auditLog");
        await addDoc(auditLogCollection, {
            ...logData,
            timestamp: Timestamp.now()
        });
    } catch(error) {
        console.error("Failed to write to audit log:", error);
        // Fail silently so it doesn't break user-facing functionality
    }
}
