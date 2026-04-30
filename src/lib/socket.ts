import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let hasLoggedConnectError = false;

export function initSocket({ url, restaurantId, token }: { url?: string; restaurantId: string; token?: string }) {
  if (socket) return socket;

  // Prefer explicit URL, then shared backend env vars, then localhost:3001 dev fallback (backend runs on 3001).
  const serverUrl =
    url ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : "/");

  const opts: any = {
    path: "/socket.io",
    // Start with polling then upgrade to websocket; more resilient across local/proxy/dev setups.
    transports: ["polling", "websocket"],
    upgrade: true,
    timeout: 10000,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    auth: { restaurantId },
    transportOptions: {
      polling: {
        extraHeaders: {
          "X-Restaurant-Id": restaurantId,
        },
      },
    },
  };

  if (token) opts.auth.token = token;

  socket = io(serverUrl, opts);

  socket.on("connect_error", (err) => {
    if (!hasLoggedConnectError) {
      hasLoggedConnectError = true;
      console.warn("socket connect_error", err?.message ?? err, "url:", serverUrl);
    }
  });

  socket.on("error", (err) => {
    console.error("socket error", err);
  });

  socket.on("reconnect_attempt", (attempt) => {
    console.debug("socket reconnect attempt", attempt);
  });

  socket.on("reconnect_failed", () => {
    console.warn("socket reconnect failed");
  });

  socket.on("connect", () => {
    hasLoggedConnectError = false;
    console.log("socket connected", socket?.id, "to", serverUrl);
  });

  // engine.io polling errors sometimes surface as "poll error" on the socket
  // listen on transport-level messages for more details if needed
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
