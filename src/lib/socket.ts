import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function initSocket({ url, restaurantId, token }: { url?: string; restaurantId: string; token?: string }) {
  if (socket) return socket;

  // Prefer explicit url, then known backend env vars, then current origin.
  const envServerUrl =
    process.env.NEXT_PUBLIC_RECEPTION_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_URL;
  const serverUrl =
    url ??
    (typeof window !== "undefined"
      ? envServerUrl ?? window.location.origin
      : envServerUrl ?? "/");

  const opts: any = {
    path: "/socket.io",
    // prefer websocket transport to avoid polling/xhr issues in some environments
    transports: ["websocket", "polling"],
    auth: { restaurantId },
    transportOptions: {
      polling: { extraHeaders: {} },
    },
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  };

  if (token) opts.auth.token = token;

  socket = io(serverUrl, opts);

  socket.on("connect_error", (err) => {
    console.error("socket connect_error", err?.message ?? err);
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
