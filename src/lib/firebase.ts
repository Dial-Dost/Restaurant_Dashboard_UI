
// This file is no longer needed for auth, but might be used for other Firebase services later.
// Keeping it to avoid breaking potential future integrations.

import { initializeApp, getApp, getApps } from "firebase/app";

const firebaseConfig = {
  "projectId": "cuisineflow-mfu4e",
  "appId": "1:1045044026287:web:32cfa1737c2fff6f3e2d5a",
  "storageBucket": "cuisineflow-mfu4e.firebasestorage.app",
  "apiKey": "AIzaSyDGwB70qrDENx9HRf5q3djTv5duHe4LpI0",
  "authDomain": "cuisineflow-mfu4e.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "1045044026287"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export { app };
