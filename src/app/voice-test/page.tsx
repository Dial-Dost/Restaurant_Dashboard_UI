"use client";

import type { FormEvent} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  RealtimeAgent,
  RealtimeSession,
  tool,
  utils,
} from "@openai/agents/realtime";
import type { RealtimeItem } from "@openai/agents/realtime";
import { requestReceptionBackend } from "@/lib/db";
import { isMobile10 } from "@/lib/phone";

interface RestaurantInfoEntry {
  field: string;
  value: string;
}

interface RestaurantKnowledge {
  infoEntries: RestaurantInfoEntry[];
  infoContext: string;
  openingTime: string;
  closingTime: string;
}

interface ConversationMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

async function fetchKnowledge(): Promise<RestaurantKnowledge> {
  const response = await requestReceptionBackend<RestaurantKnowledge>({
    path: "/reception/info",
    method: "GET",
  });
  if (!response.ok || !response.data) {
    throw new Error("Failed to load restaurant information");
  }
  return response.data;
}

interface AvailabilityRequest {
  reservationDate: string;
  reservationTime: string;
  partySize: number;
}

interface ReservationRequest {
  guestName: string;
  contactNumber: string;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  tablePreference?: string | null;
  specialRequests?: string | null;
}

interface AvailabilityResult {
  status: "available" | "unavailable" | "connectivity" | "validation";
  message: string;
  tables?: { tableName: string; capacity: number | null }[];
}

interface ReservationResult {
  status: "confirmed" | "queued" | "failed";
  message: string;
  tableName?: string;
  referenceId?: string | null;
}

async function postJSON<TInput, TOutput>(
  path: string,
  payload: TInput,
): Promise<TOutput> {
  const response = await requestReceptionBackend<TOutput | { error?: string }>({
    path,
    method: "POST",
    body: payload,
  });
  if (!response.ok || !response.data) {
    const maybeError = response.data as { error?: string } | null;
    throw new Error(maybeError?.error ?? response.text ?? "Request failed");
  }
  return response.data as TOutput;
}

function buildPersona(knowledge: RestaurantKnowledge): string {
  return `
You are Mia, a warm and attentive receptionist for Iron Hill Bengaluru. You speak naturally, using polite courtesies, gentle empathy, and concise guidance. Keep the caller informed about the next step.

# Core Responsibilities
1. Greet the caller and offer help proactively.
2. When handling reservations:
   - Gather and confirm the guest name, contact number, party size, reservation date, and reservation time.
   - Repeat back names and numbers for confirmation before moving forward.
   - Use \`check_availability\` whenever the guest proposes a time.
   - Only call \`create_reservation\` after all details are confirmed and the caller agrees.
   - Offer nearby alternatives if the requested slot is unavailable.
3. For general questions, use \`lookup_restaurant_fact\` to stay accurate. If the fact isn't in the file, gently say you don't have that data and pivot back to helping with reservations.
4. Never invent answers, menu items, or policies not present in the provided data or confirmed by the caller.
5. Keep the conversation friendly, concise, and goal-oriented. Close the call with an offer for further assistance.

# Voice & Tone
- Warm, upbeat, and professional.
- Express genuine enthusiasm about welcoming the guest.
- Pace is steady and confident—no rushing.
- Use light filler words only when it sounds natural (e.g., "sure thing" or "let me just confirm that").

# Operating Hours
- Opening: ${knowledge.openingTime}
- Closing: ${knowledge.closingTime}

# Safety Checks
- Always confirm spelling for names and digits for phone numbers.
- If details are unclear, politely ask the caller to repeat them.
- If the system connection fails, reassure the caller that you'll log the details manually and a teammate will follow up.

# Knowledge Base Snapshot
${knowledge.infoContext}
`;
}

function buildRestaurantInfoLookup(knowledge: RestaurantKnowledge) {
  return tool({
    name: "lookup_restaurant_fact",
    description:
      "Look up quick facts about the restaurant such as operating hours, amenities, or signature dishes.",
    parameters: z.object({
      topic: z.string().describe("The subject the guest is asking about."),
      includeFullContext: z
        .boolean()
        .optional()
        .describe("Set true if the caller requested a detailed overview."),
    }),
    execute: async ({ topic, includeFullContext = false }) => {
      if (includeFullContext) {
        return knowledge.infoContext;
      }
      const normalized = topic.trim().toLowerCase();
      if (!normalized) {
        return "I don't have that detail on file.";
      }
      const matches = knowledge.infoEntries
        .map((entry) => ({
          entry,
          score: entry.field.toLowerCase().includes(normalized)
            ? 3
            : entry.value.toLowerCase().includes(normalized)
              ? 2
              : normalized
                  .split(/[^a-z0-9]+/g)
                  .filter(Boolean)
                  .reduce(
                    (count, token) =>
                      count + (entry.field.toLowerCase().includes(token) || entry.value.toLowerCase().includes(token) ? 1 : 0),
                    0,
                  ),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((candidate) => candidate.entry);

      if (!matches.length) {
        return "I don't have that detail on file.";
      }

      return matches.map((entry) => `${entry.field}: ${entry.value}`).join("\n");
    },
  });
}

function buildAvailabilityTool() {
  return tool({
    name: "check_availability",
    description:
      "Check whether a table is open for the requested time slot before committing the reservation.",
    parameters: z.object({
      reservationDate: z
        .string()
        .describe("Date in YYYY-MM-DD format"),
      reservationTime: z
        .string()
        .describe("Time in HH:MM 24-hour format. Append AM/PM only if needed."),
      partySize: z
        .number()
        .int()
        .min(1)
        .describe("Number of guests the caller mentioned."),
    }),
    execute: async ({ reservationDate, reservationTime, partySize }) => {
      return postJSON<AvailabilityRequest, AvailabilityResult>(
        "/reception/check-availability",
        {
          reservationDate,
          reservationTime,
          partySize,
        },
      );
    },
  });
}

function buildReservationTool() {
  return tool({
    name: "create_reservation",
    description:
      "Commit a reservation once all details are confirmed with the caller. The agent must repeat sensitive details like names and phone numbers back to the guest before calling this tool.",
    parameters: z.object({
      guestName: z.string().min(2).describe("Guest's full name."),
      // POST /reception/create-reservation rejects anything that is not exactly
      // 10 digits, so the agent is told the rule up front instead of discovering
      // it as a 400 after the caller has hung up.
      contactNumber: z
        .string()
        .refine(isMobile10, "Enter a 10-digit mobile number")
        .describe("Exactly 10 digits (Indian mobile). No country code, no spaces."),
      partySize: z
        .number()
        .int()
        .min(1)
        .describe("Number of guests."),
      reservationDate: z
        .string()
        .describe("Date in YYYY-MM-DD format."),
      reservationTime: z
        .string()
        .describe("Time in HH:MM 24-hour format. 7:30 PM is acceptable."),
      tablePreference: z
        .string()
        .optional()
        .nullable()
        .describe(
          "Specific table identifier requested by the guest. Leave null to auto-select the smallest suitable table.",
        ),
      specialRequests: z
        .string()
        .optional()
        .nullable()
        .describe("Any additional notes the guest shared."),
    }),
    execute: async (payload) => {
      return postJSON<ReservationRequest, ReservationResult>(
        "/reception/create-reservation",
        payload,
      );
    },
  });
}

export default function VoiceTestPage() {
  const [knowledge, setKnowledge] = useState<RestaurantKnowledge | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pendingText, setPendingText] = useState("");

  const sessionRef = useRef<RealtimeSession | null>(null);
  const agentRef = useRef<RealtimeAgent | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchKnowledge()
      .then((data) => {
        if (mounted) {
          setKnowledge(data);
        }
      })
      .catch((err) => {
        console.error(err);
        if (mounted) {
          setError(err.message);
        }
      });
    return () => {
      mounted = false;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const addMessage = useCallback((entry: ConversationMessage) => {
    setMessages((prev) => {
      const exists = prev.some((item) => item.id === entry.id);
      if (exists) {
        return prev.map((item) => (item.id === entry.id ? entry : item));
      }
      return [...prev, entry];
    });
  }, []);

  const handleHistoryItem = useCallback(
    (item: RealtimeItem) => {
      if (item.type !== "message") {
        return;
      }
      if (item.role === "assistant") {
        const transcript =
          item.content
            .filter((chunk) => chunk.type === "output_text" && chunk.text)
            .map((chunk) => (chunk.type === "output_text" ? chunk.text : ""))
            .join("") || utils.getLastTextFromAudioOutputMessage(item) || "";
        if (transcript.trim()) {
          addMessage({ id: item.itemId, role: "assistant", text: transcript.trim() });
        }
        return;
      }

      if (item.role === "user") {
        const parts: string[] = [];
        for (const chunk of item.content) {
          if (chunk.type === "input_text" && chunk.text) {
            parts.push(chunk.text);
          } else if (chunk.type === "input_audio" && chunk.transcript) {
            parts.push(chunk.transcript);
          }
        }
        const transcript = parts.join(" ").trim();
        if (transcript) {
          addMessage({ id: item.itemId, role: "user", text: transcript });
        }
      }
    },
    [addMessage],
  );

  const buildAgent = useCallback(() => {
    if (!knowledge) {
      throw new Error("Restaurant data not loaded yet");
    }
    return new RealtimeAgent({
      name: "ironhill-receptionist",
      instructions: buildPersona(knowledge),
      voice: "alloy",
      tools: [buildAvailabilityTool(), buildReservationTool(), buildRestaurantInfoLookup(knowledge)],
    });
  }, [knowledge]);

  const connect = useCallback(async () => {
    if (status !== "idle") {
      return;
    }
    try {
      setError(null);
      setStatus("connecting");
      setMessages([]);

      await navigator.mediaDevices.getUserMedia({ audio: true });

      const agent = buildAgent();
      const session = new RealtimeSession(agent, {
        transport: "webrtc",
        context: { restaurantName: "Iron Hill Bengaluru" },
        config: {
          voice: "alloy",
          outputModalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
            },
            output: {
              format: { type: "audio/pcm", rate: 24000 },
              voice: "alloy",
            },
          },
        },
      });

      session.on("history_added", handleHistoryItem);
      session.on("error", ({ error: err }) => {
        console.error("session_error", err);
        setError(err instanceof Error ? err.message : "Realtime session error");
      });

      const ephemeral = await requestReceptionBackend<{ client_secret?: { value?: string } | null; error?: string }>({
        path: "/realtime/session",
        method: "POST",
      });
      if (!ephemeral.ok || !ephemeral.data) {
        const info = ephemeral.data;
        throw new Error(info?.error ?? ephemeral.text ?? "Unable to create realtime session");
      }
      const ephemeralData = ephemeral.data;
      const apiKey: string | undefined = ephemeralData?.client_secret?.value;
      if (!apiKey) {
        throw new Error("Realtime session token missing client_secret");
      }

      await session.connect({ apiKey });
      sessionRef.current = session;
      agentRef.current = agent;
      setStatus("connected");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to start voice session");
      setStatus("idle");
      sessionRef.current?.close();
      sessionRef.current = null;
    }
  }, [buildAgent, handleHistoryItem, status]);

  const disconnect = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    agentRef.current = null;
    setStatus("idle");
  }, []);

  const sendText = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const message = pendingText.trim();
      if (!message || !sessionRef.current || status !== "connected") {
        return;
      }
      sessionRef.current.sendMessage({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message }],
      });
      setPendingText("");
    },
    [pendingText, status],
  );

  const canConnect = useMemo(() => status === "idle" && knowledge !== null, [status, knowledge]);
  const canDisconnect = useMemo(() => status === "connected", [status]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Realtime Voice Receptionist</h1>
        <p className="text-sm text-muted-foreground">
          Connect to chat with Mia using your microphone. You can also send manual text messages while the
          session is active.
        </p>
        <p className="text-sm text-muted-foreground">Status: {status}</p>
      </header>

      <div className="flex gap-3">
        <button
          type="button"
          className="rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          onClick={connect}
          disabled={!canConnect}
        >
          Connect &amp; Start Talking
        </button>
        <button
          type="button"
          className="rounded bg-slate-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          onClick={disconnect}
          disabled={!canDisconnect}
        >
          Disconnect
        </button>
      </div>

      {error ? <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Conversation Transcript</h2>
        <div className="max-h-80 overflow-auto rounded border border-slate-200 bg-white p-4 text-sm shadow-sm">
          {messages.length === 0 ? (
            <p className="text-muted-foreground">Say something once the session is connected. Audio replies will appear here as text summaries.</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="mb-2">
                <span className="font-semibold">
                  {message.role === "assistant" ? "Mia" : "You"}:
                </span>{" "}
                <span>{message.text}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <form className="flex gap-2" onSubmit={sendText}>
        <input
          type="text"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder="Type a message while connected"
          value={pendingText}
          onChange={(event) => { setPendingText(event.target.value); }}
          disabled={status !== "connected"}
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={status !== "connected" || !pendingText.trim()}
        >
          Send
        </button>
      </form>
    </main>
  );
}
