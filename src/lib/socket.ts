import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

import { socketBackendBase } from "./backend-url";

let socket: Socket | null = null;
let hasLoggedConnectError = false;

export function initSocket({ url, restaurantId, token }: { url?: string; restaurantId: string; token?: string }) {
  if (socket) {return socket;}

  // Prefer an explicit URL, otherwise ask the shared resolver for an ABSOLUTE
  // backend origin. Realtime cannot use the same-origin "/backend-api" prefix
  // that the HTTP paths fall back to: a Next rewrite does not proxy websockets,
  // and socket.io-client discards the path of the URL it is given (it uses the
  // separate `path` option below), so "/backend-api" would resolve to
  // <dashboard-origin>/socket.io — which the Next server does not serve.
  //
  // The previous line read the env var with `??`. An empty NEXT_PUBLIC_BACKEND_URL
  // is not null, so it won the fallback and this became io(""), which
  // socket.io-client resolves to `https://:443` — a URL with an EMPTY HOST.
  // Realtime could not connect at all on that build.
  const serverUrl = url ?? socketBackendBase();

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

  if (token) {opts.auth.token = token;}

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
  if (!socket) {return;}
  socket.disconnect();
  socket = null;
}
