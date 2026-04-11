
export async function connectToDatabase(): Promise<never> {
    throw new Error(
        'MongoDB connectivity has been removed. Use the API-backed helpers in src/lib/db.ts.',
    );
}
