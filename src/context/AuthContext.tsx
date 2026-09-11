
"use client";

import type { ReactNode} from 'react';
import React, { createContext, useState, useContext, useEffect } from 'react';
import { signOutUser } from '@/services/authService';
import type { User } from '@/lib/db';
import { refreshSession } from '@/lib/db';
import type { SessionScope } from '@/lib/session-scope';

interface AuthUser {
  uid: string;
  employeeId: string; // employee UUID
  employeeUsername?: string;
  role: 'admin' | 'employee' | 'valet' | 'waiter' | 'cashier' | 'captain' | 'manager';
  role_all?: string[];
  restaurantUsername: string;
  restaurantName: string;
  res_id: string;
  outlet_id: string;
  emp_Fname: string | null;
  emp_Lname?: string | null;
  actions_set: string[];
  action_names?: string[];
  /*
    THE SERVER'S ANSWER TO "IS THIS A SCOPED FLOOR ROLE", CARRIED VERBATIM.

    It used to be worked out here, three separate times, by asking whether the
    role strings said "waiter" — and a waiter holding any custom role carries
    that role's UUID, so the test failed and every restriction lifted at once.
    The rule now lives on the server (role_scope.ts) and rides on the
    /auth/employee-login and /auth/me payloads; `src/lib/session-scope.ts` is the
    only thing in this app allowed to read it.

    OPTIONAL because a session stored by a previous release carries no `scope`.
    Those are re-hydrated from /auth/me on mount below rather than guessed at.
  */
  scope?: SessionScope;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * The seven core role names this app knows. A value from the wire that is not
 * one of them is IGNORED rather than stored: `role` is a union type, and letting
 * an unrecognised string in turns every `role === 'admin'` comparison in the app
 * into a silent false.
 */
const APP_ROLES = ['admin', 'employee', 'valet', 'waiter', 'cashier', 'captain', 'manager'] as const;
const isAppRole = (value: unknown): value is AuthUser['role'] =>
  typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);

const safeJsonParse = (str: string | null) => {
  if (!str) {return null;}
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
    const storedUser = safeJsonParse(localStorage.getItem('authUser'));
    React.startTransition(() => {
      if (storedUser) {setUser(storedUser);}
      setLoading(false);
    });
  }, []);

  /*
    RE-HYDRATE THE PERMISSIONS FROM THE SERVER, ONCE, ON MOUNT.

    What this app knows about a session — the resolved action set, the role list,
    and now the `scope` block that decides the floor restrictions — was frozen
    into localStorage at LOGIN. A role changed since then, or a permission
    granted or revoked, did not reach this browser until the user signed out and
    in again; and a session stored by the release before `scope` existed carries
    no scope at all, so every gate reading it would fail open indefinitely.

    GET /auth/me recomputes all of it from the verified session on every call —
    deliberately, backend-side, "so a role change takes effect on the next
    launch, not on the next login". This is that launch.

    STRICTLY ADDITIVE, AND IT NEVER SIGNS ANYBODY OUT. A refusal, an outage or a
    laptop on a hotel wifi returns null and the stored session is left exactly as
    it was: the alternative is a floor screen that logs the staff out whenever
    the office wifi blinks. A genuinely dead session is still caught the moment
    any real request comes back 401 — `enforceSessionAlive` in db.ts owns that,
    and it is the one place that should.

    The identity fields (who, which restaurant, which outlet) are NOT overwritten
    from here: this is about what the session may DO, and the token that says who
    it is has not changed. The `authUser` cookie the server-side accessors read
    is not rewritten either, for the same reason — what they take from it is the
    bearer token and the outlet, and neither has moved; the backend derives
    permissions from the token itself on every request, never from that cookie.
  */
  useEffect(() => {
    if (!user?.employeeId) { return; }
    // A mutable holder rather than a bare `let`: the cleanup below flips it after
    // the async call has already been suspended, and a plain boolean read back
    // inside the closure is the classic unmount-write race this guards.
    const mounted = { current: true };
    void (async () => {
      const fresh = await refreshSession();
      if (!mounted.current || fresh === null) { return; }
      setUser((current) => {
        if (!current) { return current; }
        const next: AuthUser = { ...current };
        // Field by field, and only when the server actually sent one: a
        // spread of `fresh` would blank `scope` and `actions_set` on a backend
        // that answered without them, which is the one direction this refresh
        // must never move — a session that suddenly holds no permissions is a
        // screen with every control missing.
        if (isAppRole(fresh.role)) { next.role = fresh.role; }
        if (Array.isArray(fresh.role_all)) { next.role_all = fresh.role_all; }
        if (Array.isArray(fresh.actions_set)) { next.actions_set = fresh.actions_set; }
        if (Array.isArray(fresh.action_names)) { next.action_names = fresh.action_names; }
        if (fresh.scope && typeof fresh.scope.waiter_only === 'boolean') { next.scope = fresh.scope; }
        // Persist so the NEXT page load starts from the server's answer too.
        try { localStorage.setItem('authUser', JSON.stringify(next)); } catch { /* private mode, quota */ }
        return next;
      });
    })();
    return () => { mounted.current = false; };
    // Keyed on the identity, not on the permissions it returns — depending on
    // `user` itself would re-run this every time it updates its own answer.
  }, [user?.employeeId]);

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
