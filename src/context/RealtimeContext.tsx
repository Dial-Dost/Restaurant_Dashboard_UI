"use client";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { initSocket, getSocket, disconnectSocket } from "../lib/socket";

type EventPayload = any;

type RealtimeContextValue = {
  connected: boolean;
  lastEvent?: { event: string; payload: EventPayload } | null;
};

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

export function RealtimeProvider({ children, restaurantId }: { children: ReactNode; restaurantId: string }) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ event: string; payload: EventPayload } | null>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    if (!restaurantId) return;
    // The backend authenticates the socket from this token (it derives the
    // tenant from the session, not from restaurantId).
    let token: string | undefined;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('authUser') : null;
      if (raw) token = JSON.parse(raw)?.token ?? undefined;
    } catch { /* ignore */ }
    const socket = initSocket({ restaurantId, token });
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    const events = [
      "booking:created",
      "booking:deleted",
      "booking:status_updated",
      "table:added",
      "table:deleted",
      "valet:created",
      "valet:updated",
      "valet:bay_added",
      "valet:bay_updated",
      "valet:bay_deleted",
      "valet:bay_current_set",
      "feedback:created",
      "feedback:updated",
      "feedback:deleted",
    ];

    for (const e of events) {
      socket.on(e, (payload: any) => {
        setLastEvent({ event: e, payload });
        // Also emit a DOM event for non-React parts to consume
        try {
          window.dispatchEvent(new CustomEvent("realtime:event", { detail: { event: e, payload } }));
        } catch (err) {
          // ignore
        }
      });
    }

    // Ensure we join the restaurant room explicitly
    socket.emit("join", restaurantId);

    return () => {
      if (!socket) return;
      for (const e of events) socket.off(e);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      try {
        socket.emit("leave", restaurantId);
      } catch (err) {
        // ignore
      }
      disconnectSocket();
    };
  }, [restaurantId]);

  return (
    <RealtimeContext.Provider value={{ connected, lastEvent }}>{children}</RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  // Return a safe default when provider is missing (e.g., during logout/unmount)
  if (!ctx) {
    return { connected: false, lastEvent: null } as RealtimeContextValue;
  }
  return ctx;
}
