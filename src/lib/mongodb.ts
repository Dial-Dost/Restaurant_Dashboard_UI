
import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('Please add your Mongo URI to .env.local');
}

const options = {
  serverApi: {
    version: '1' as const,
    strict: true,
    deprecationErrors: true,
  },
};

let cachedDb: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
    if (cachedDb) {
        return cachedDb;
    }

    const client = new MongoClient(uri, options);
    
    try {
        await client.connect();
        console.log("New MongoDB connection established.");
        const db = client.db(); // This uses the default database from the connection string
        cachedDb = db;
        return db;
    } catch (error) {
        console.error("Failed to connect to MongoDB", error);
        throw new Error("Could not connect to the database.");
    }
}
