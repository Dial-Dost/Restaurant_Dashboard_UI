
"use client";

import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { signOutUser } from '@/services/authService';
import { User } from '@/lib/db';

type AuthUser = {
  uid: string;
  employeeId: string; // employee UUID
  employeeUsername?: string;
  role: 'admin' | 'employee' | 'valet' | 'waiter';
  role_all?: string[];
  restaurantUsername: string;
  restaurantName: string;
  res_id: string;
  outlet_id: string;
  emp_Fname: string | null;
  emp_Lname?: string | null;
  actions_set: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const safeJsonParse = (str: string | null) => {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user session is stored in localStorage
    const storedUser = safeJsonParse(localStorage.getItem('authUser'));
    if (storedUser) {
      setUser(storedUser);
    }
    setLoading(false);
  }, []);

  const login = (userData: AuthUser) => {
    setUser(userData);
    localStorage.setItem('authUser', JSON.stringify(userData));
  };

  const logout = () => {
    signOutUser(); // Call mock signout service
    setUser(null);
    localStorage.removeItem('authUser');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
