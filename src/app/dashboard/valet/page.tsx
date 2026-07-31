"use client";

import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/context/RealtimeContext";
import { useToast } from "@/hooks/use-toast";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { requestBackend } from "@/lib/db";
import { dayKeyInZone, formatTime, todayInZone, utcToWallClockInZone } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import { Activity, RefreshCw, Clock, Package, Users, ArrowUpDown, Camera, Loader2 } from "lucide-react";

interface ValetBays {
  Bay_id: string | undefined;
  Bay_name: string;
  current_capacity: number;
  total_capacity: number;
  restaurant_id?: string | undefined;
}

interface ValetBooking {
  booking_id?: string;
  customer_name?: string;
  bay_name?: string | null;
  bay_id?: string | null;
  // number_of_people?: number;
  booking_date_time?: string;
  exit_date_time?: string | null;
  status?: string;
  active?: boolean;
  number_plate?: string | null;
  // notes?: string | null;
  // Valet ops depth (Wave D)
  parking_location?: string | null;
  key_holder?: string | null;
  key_updated_at?: string | null;
  condition_notes?: string | null;
  condition_photo_url?: string | null;
  eta_minutes?: number | null;
  requested_at?: string | null;
}

interface ChargeTarget { table_name: string; covers?: number | null }

interface ValetInfoResponse {
  role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager";
  generated_at: string;
  bays: ValetBays[];
  bookings: ValetBooking[];
}

const VALET_STAGES = [
  "Vehicle added",
  "Parked",
  "Request to bring car (from customer)",
  "Request accepted (from valet)",
  "Car arrived at entrance",
  "Customer took car",
] as const;

type ValetStage = (typeof VALET_STAGES)[number];

function normalizeStage(status?: string): ValetStage {
  const normalized = (status ?? "").trim().toLowerCase();

  if (normalized === "vehicle added") {return "Vehicle added";}
  if (normalized === "parked") {return "Parked";}
  if (normalized === "request to bring car") {return "Request to bring car (from customer)";}
  if (normalized === "request to bring car (from customer)") {return "Request to bring car (from customer)";}
  if (normalized === "request accepted") {return "Request accepted (from valet)";}
  if (normalized === "request accepted (from valet)") {return "Request accepted (from valet)";}
  if (normalized === "car arrived at entrance") {return "Car arrived at entrance";}
  if (normalized === "customer took car") {return "Customer took car";}

  // Backward compatibility with older statuses.
  if (normalized === "retrieved") {return "Customer took car";}
  if (normalized === "arrived") {return "Car arrived at entrance";}
  if (normalized === "in_valet") {return "Parked";}

  return "Vehicle added";
}

function isInProgressStage(stage: ValetStage): boolean {
  return stage !== "Customer took car";
}

function isParkedLikeStage(stage: ValetStage): boolean {
  // Parked-like stages: parked, request-to-bring (customer), request-accepted (valet).
  // 'Car arrived at entrance' is treated separately as pickup stage.
  return (
    stage === "Parked" ||
    stage === "Request to bring car (from customer)" ||
    stage === "Request accepted (from valet)"
  );
}

function isPickupStage(stage: ValetStage): boolean {
  return stage === "Car arrived at entrance";
}

// Named formatClock, not formatTime, so it cannot shadow the shared tz helper.
function formatClock(value: string | null | undefined, timeZone: string): string {
  if (!value) {
    return "N/A";
  }
  return formatTime(value, timeZone, value);
}

// Seeds a datetime-local input with "now" as the RESTAURANT reads it, so a
// valet booking taken on a device set to another zone still defaults to the
// house clock the rest of the screen shows.
function getCurrentLocalDateTimeValue(timeZone: string): string {
  return utcToWallClockInZone(new Date(), timeZone);
}

function formatTicket(bookingId?: string, index?: number): string {
  if (bookingId && bookingId.length >= 6) {
    return `VLT-${bookingId.slice(-6).toUpperCase()}`;
  }

  const serial = (index ?? 0) + 1;
  return `VLT-${serial.toString().padStart(4, "0")}`;
}

function extractVehiclePlate(booking: ValetBooking): string {
  // Prefer explicit number_plate field, fall back to legacy notes parsing.
  if (booking.number_plate && String(booking.number_plate).trim().length > 0) {
    return String(booking.number_plate).trim();
  }

  const notes = (booking as any).notes ?? "";
  const match = /vehicle\s*plate\s*:\s*(.+)$/i.exec(String(notes));
  if (!match?.[1]) {
    return "N/A";
  }
  return match[1].trim();
}

function getStageIndex(stage: ValetStage): number {
  return VALET_STAGES.indexOf(stage);
}

function moveStage(stage: ValetStage, delta: number): ValetStage {
  const current = getStageIndex(stage);
  const next = Math.max(0, Math.min(VALET_STAGES.length - 1, current + delta));
  return VALET_STAGES[next];
}

function ValetDashboardPageInner() {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ValetInfoResponse | null>(null);
  // A valet notification links here as ?highlightValet=<booking id>; ring and
  // scroll to that vehicle record instead of dropping the user on the dashboard.
  const highlight = useHighlightRow("highlightValet", data?.bookings?.length ?? 0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [draftTableByBookingId, setDraftTableByBookingId] = useState<Record<string, string>>({});
  const [draftStageByBookingId, setDraftStageByBookingId] = useState<Record<string, ValetStage>>({});
  const [spaceAvailableDisplay, setSpaceAvailableDisplay] = useState(0);
  const [maxBaysDisplay, setMaxBaysDisplay] = useState(0);
  const [spaceInitializedForRestaurant, setSpaceInitializedForRestaurant] = useState<string | null>(null);
  const [managedBays, setManagedBays] = useState<{ name: string; total_capacity: number }[]>([{ name: "Main", total_capacity: 5 }]);
  const [baysInitializedForRestaurant, setBaysInitializedForRestaurant] = useState<string | null>(null);
  const [baysLoading, setBaysLoading] = useState<boolean>(true);
  const [newBayCapacity, setNewBayCapacity] = useState<number | string>(5);
  const [editingBay, setEditingBay] = useState<string | null>(null);
  const [editingBayName, setEditingBayName] = useState<string>("");
  const [editingBayCapacity, setEditingBayCapacity] = useState<number | string>(5);
  const [newBayName, setNewBayName] = useState("");
  const [recordSearchQuery, setRecordSearchQuery] = useState("");
  const [recordStageFilter, setRecordStageFilter] = useState<"all" | ValetStage>("all");
  const [recordBayFilter, setRecordBayFilter] = useState<string>("all");
  const [recordDate, setRecordDate] = useState<string>(() => todayInZone(timezone));
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [showAllParked, setShowAllParked] = useState(false);
  const [showAllIncoming, setShowAllIncoming] = useState(false);
  const [showAllPickup, setShowAllPickup] = useState(false);
  const [newGuestName, setNewGuestName] = useState("");
  const [newVehiclePlate, setNewVehiclePlate] = useState("");
  const [newDateTime, setNewDateTime] = useState<string>(() => getCurrentLocalDateTimeValue(timezone));
  const [newRecordBayValue, setNewRecordBayValue] = useState<string>("__default_main__");
  const [creating, setCreating] = useState(false);
  const [scanningPlate, setScanningPlate] = useState(false);
  const plateScanInputRef = useRef<HTMLInputElement | null>(null);
  const hasShownAccessToastRef = useRef(false);
  // Valet ops depth (Wave D): parking location / key log / condition / ETA / charge-to-table.
  const [chargeTargets, setChargeTargets] = useState<ChargeTarget[]>([]);
  const [draftLocationByBookingId, setDraftLocationByBookingId] = useState<Record<string, string>>({});
  const [draftNotesByBookingId, setDraftNotesByBookingId] = useState<Record<string, string>>({});
  const [chargeTableByBookingId, setChargeTableByBookingId] = useState<Record<string, string>>({});
  const [chargeAmountByBookingId, setChargeAmountByBookingId] = useState<Record<string, string>>({});
  const [opsBusyId, setOpsBusyId] = useState<string | null>(null);

  const canViewValet = user?.role === "valet" || user?.role === "admin";

  const fetchValetInfo = async () => {
    if (!user?.restaurantUsername || !user.employeeId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await requestBackend<ValetInfoResponse>({
        path: "/valet-info",
        method: "GET",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
      });

      if (!response.ok) {
        throw new Error(response.text || "Unable to load valet dashboard data.");
      }

      const payload = (response.data ?? null)!;
      setData(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load valet dashboard data.";
      setError(message);
    } finally {
      setLoading(false);
    }

    // Occupied tables for "Charge to table" (best-effort — the board still works without it).
    try {
      const targets = await requestBackend<{ tables?: ChargeTarget[] }>({
        path: "/valet/charge-targets",
        method: "GET",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
      });
      if (targets.ok) {
        setChargeTargets(Array.isArray(targets.data?.tables) ? targets.data.tables : []);
      }
    } catch {
      // ignore — charge picker just shows no tables
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => fetchValetInfo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantUsername, user?.employeeId]);

  // React to realtime events and refresh data when valet records or bays change
  const { lastEvent } = useRealtime();

  useEffect(() => {
    if (!lastEvent) {return;}
    const relevant = [
      "valet:created",
      "valet:updated",
      "valet:bay_added",
      "valet:bay_updated",
      "valet:bay_deleted",
      "valet:bay_current_set",
      "booking:deleted",
      "booking:created",
      "booking:status_updated",
      "table:added",
      "table:deleted",
    ];
    if (relevant.includes(lastEvent.event)) {
      // lightweight approach: refetch the full valet snapshot
      Promise.resolve().then(() => fetchValetInfo());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  const patchBookingStatus = async (bookingId: string, status: ValetStage) => {
    if (!user?.restaurantUsername) {
      return;
    }

    const stateCode = getStageIndex(status) + 1;

    const response = await requestBackend<{ error?: string }>({
      path: "/update_valet_state",
      method: "POST",
      restaurantId: user.restaurantUsername,
      employeeId: user.employeeId,
      outletId: user.outlet_id,
      body: { booking_id: bookingId, state: stateCode },
    });

    if (!response.ok) {
      const message = response.data?.error ?? response.text;
      throw new Error(message || "Failed to update stage.");
    }
  };

  const patchBookingTable = async (bookingId: string, tableName: string | null) => {
    if (!user?.restaurantUsername) {
      return;
    }

    // If caller wants to unassign bay (tableName === null), call dedicated unassign endpoint
    if (tableName === null) {
      const resp = await requestBackend<{ error?: string }>({
        path: "/unassign-valet-bay",
        method: "POST",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
        body: { booking_id: bookingId },
      });

      if (!resp.ok) {
        const message = resp.data?.error ?? resp.text;
        throw new Error(message || "Failed to unassign bay.");
      }

      return resp.data ?? {};
    }

    const response = await requestBackend<{ error?: string }>({
      path: "/update_valet_bay",
      method: "POST",
      restaurantId: user.restaurantUsername,
      employeeId: user.employeeId,
      outletId: user.outlet_id,
      // send bay_id (tableName may be a name or an id; caller should pass id when available)
      body: { booking_id: bookingId, bay_id: tableName },
    });

    if (!response.ok) {
      const message = response.data?.error ?? response.text;
      throw new Error(message || "Failed to update bay.");
    }
    return response.data ?? {};
  };

  // --- Valet ops depth (Wave D) handlers -------------------------------------

  const saveOps = async (
    bookingId: string,
    patch: {
      parking_location?: string;
      condition_notes?: string;
      eta_minutes?: number | null;
      condition_photo_base64?: string;
      condition_photo_content_type?: string;
    },
    successTitle: string,
  ) => {
    if (!user?.restaurantUsername) {return;}
    try {
      setOpsBusyId(bookingId);
      const response = await requestBackend<{ record?: ValetBooking; error?: string }>({
        path: `/valet/${encodeURIComponent(bookingId)}/ops`,
        method: "POST",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
        body: patch,
      });
      if (!response.ok) {
        throw new Error(response.data?.error ?? response.text ?? "Unable to update valet record.");
      }
      const record = response.data?.record ?? {};
      setData((previous) => {
        if (!previous) {return previous;}
        return {
          ...previous,
          bookings: previous.bookings.map((b) =>
            b.booking_id === bookingId
              ? {
                  ...b,
                  parking_location: record.parking_location ?? ("parking_location" in patch ? patch.parking_location ?? null : b.parking_location),
                  condition_notes: record.condition_notes ?? ("condition_notes" in patch ? patch.condition_notes ?? null : b.condition_notes),
                  condition_photo_url: record.condition_photo_url ?? b.condition_photo_url,
                  eta_minutes: "eta_minutes" in patch ? record.eta_minutes ?? patch.eta_minutes ?? null : b.eta_minutes,
                }
              : b,
          ),
        };
      });
      toast({ title: successTitle, description: `${formatTicket(bookingId)} updated.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to update valet record.";
      toast({ title: "Update Failed", description: message, variant: "destructive" });
    } finally {
      setOpsBusyId(null);
    }
  };

  const keysAction = async (bookingId: string, action: "take" | "handover") => {
    if (!user?.restaurantUsername) {return;}
    try {
      setOpsBusyId(bookingId);
      const response = await requestBackend<{ key_holder?: string | null; key_updated_at?: string | null; error?: string }>({
        path: `/valet/${encodeURIComponent(bookingId)}/keys`,
        method: "POST",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
        body: { action },
      });
      if (!response.ok) {
        throw new Error(response.data?.error ?? response.text ?? "Unable to update key log.");
      }
      const holder = response.data?.key_holder ?? null;
      const at = response.data?.key_updated_at ?? new Date().toISOString();
      setData((previous) => {
        if (!previous) {return previous;}
        return {
          ...previous,
          bookings: previous.bookings.map((b) =>
            b.booking_id === bookingId ? { ...b, key_holder: holder, key_updated_at: at } : b,
          ),
        };
      });
      toast({
        title: action === "take" ? "Keys Taken" : "Keys Handed Over",
        description: holder ? `Keys now with ${holder}.` : "Keys handed over.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to update key log.";
      toast({ title: "Key Log Failed", description: message, variant: "destructive" });
    } finally {
      setOpsBusyId(null);
    }
  };

  const chargeToTable = async (bookingId: string) => {
    if (!user?.restaurantUsername) {return;}
    const tableName = (chargeTableByBookingId[bookingId] ?? "").trim();
    const amount = Number(chargeAmountByBookingId[bookingId]);
    if (!tableName) {
      toast({ title: "Pick a table", description: "Choose the occupied table to charge.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive valet fee amount.", variant: "destructive" });
      return;
    }
    try {
      setOpsBusyId(bookingId);
      const response = await requestBackend<{ order_id?: string; error?: string }>({
        path: `/valet/${encodeURIComponent(bookingId)}/charge`,
        method: "POST",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
        body: { table_name: tableName, amount },
      });
      if (!response.ok) {
        throw new Error(response.data?.error ?? response.text ?? "Unable to charge valet fee.");
      }
      setChargeAmountByBookingId((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
      toast({ title: "Valet Fee Charged", description: `"Valet parking" (${amount}) added to ${tableName}'s bill.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to charge valet fee.";
      toast({ title: "Charge Failed", description: message, variant: "destructive" });
    } finally {
      setOpsBusyId(null);
    }
  };

  const handleUpdate = async (
    bookingId?: string,
    overrides?: { stage?: ValetStage; tableName?: string | null },
  ) => {
    if (!bookingId) {
      return;
    }

    const currentBooking = (data?.bookings ?? []).find((booking) => booking.booking_id === bookingId);
    if (!currentBooking) {
      return;
    }

    const stage =
      overrides?.stage ?? draftStageByBookingId[bookingId] ?? normalizeStage(currentBooking.status);
    const selectedTable =
      overrides?.tableName ?? draftTableByBookingId[bookingId] ?? (currentBooking.bay_name ?? currentBooking.bay_id ?? "");
    const rawTable = selectedTable === "" || selectedTable === "unassigned" ? null : selectedTable;

    // Normalize to bay_id: try to resolve by Bay_name from data.bays, fall back to assuming rawTable is already an id
    let normalizedBayId: string | null = null;
    let resolvedBayName: string | null = null;
    if (rawTable) {
      const match = (data?.bays ?? []).find((b) => b.Bay_name === rawTable || b.Bay_id === rawTable);
      if (match) {
        normalizedBayId = match.Bay_id ?? null;
        resolvedBayName = match.Bay_name;
      } else {
        normalizedBayId = String(rawTable);
        resolvedBayName = rawTable;
      }
    }

    try {
      setUpdatingId(bookingId);
      // If stage indicates the vehicle has left (5 or 6), force unassign the bay
      const stageCode = getStageIndex(stage) + 1;
      if (stageCode === 5 || stageCode === 6) {
        normalizedBayId = null;
        resolvedBayName = null;
      }

      await patchBookingStatus(bookingId, stage);
      await patchBookingTable(bookingId, normalizedBayId);
      // compute and persist bay capacity changes to server after updating state
      const prevBays = data?.bays ?? [];

      // Build updatedBays locally (same logic as used for setData update)
      const prevBooking = (data?.bookings ?? []).find((b) => b.booking_id === bookingId);
      const prevState = normalizeStage(prevBooking?.status);
      const prevBayId = prevBooking?.bay_id ?? null;
      const counted = (s: ValetStage) => isParkedLikeStage(s);

      const updatedBaysLocal = (data?.bays ?? []).map((bay) => ({ ...bay }));

      try {
        if (prevBayId && prevBayId !== normalizedBayId) {
          if (counted(prevState)) {
            const idx = updatedBaysLocal.findIndex((b) => b.Bay_id === prevBayId);
            if (idx >= 0) {updatedBaysLocal[idx].current_capacity = Math.max(0, (updatedBaysLocal[idx].current_capacity ?? 0) - 1);}
          }

          if (normalizedBayId && counted(stage)) {
            const idx2 = updatedBaysLocal.findIndex((b) => b.Bay_id === normalizedBayId);
            if (idx2 >= 0) {updatedBaysLocal[idx2].current_capacity = (updatedBaysLocal[idx2].current_capacity ?? 0) + 1;}
          }
        } else {
          if (prevBayId && prevBayId === normalizedBayId) {
            const idx = updatedBaysLocal.findIndex((b) => b.Bay_id === prevBayId);
            if (idx >= 0) {
              if (!counted(prevState) && counted(stage)) {
                updatedBaysLocal[idx].current_capacity = (updatedBaysLocal[idx].current_capacity ?? 0) + 1;
              }
              if (counted(prevState) && !counted(stage)) {
                updatedBaysLocal[idx].current_capacity = Math.max(0, (updatedBaysLocal[idx].current_capacity ?? 0) - 1);
              }
            }
          }
        }
      } catch (e) {
        console.error("Error computing local bay capacity diffs:", e);
      }

      // Persist changes to server for any bay with a changed current_capacity
      let adjustmentResults: any[] = [];
      try {
        const adjustments: Promise<any>[] = [];
        for (const ub of updatedBaysLocal) {
          const prev = prevBays.find((b) => String(b.Bay_id) === String(ub.Bay_id));
          const prevVal = prev ? Number(prev.current_capacity ?? 0) : 0;
          const newVal = Number(ub.current_capacity ?? 0);
          if (String(ub.Bay_id) && newVal !== prevVal) {
            adjustments.push(
              requestBackend({
                path: "/set-valet-bay-current",
                method: "POST",
                restaurantId: user?.restaurantUsername,
                employeeId: user?.employeeId,
                outletId: user?.outlet_id,
                body: { Bay_id: ub.Bay_id, current_capacity: newVal },
              }).then(async (r) => {
                if (!r.ok) {
                  throw new Error(`Failed to set bay current: ${r.status} ${r.text}`);
                }
                return r.data;
              }),
            );
          }
        }

        if (adjustments.length > 0) {
          try {
            adjustmentResults = await Promise.all(adjustments);
          } catch (e) {
            console.error("One or more set-bay-current requests failed:", e);
            // attempt best-effort: ignore failed ones, we'll still merge available results
            adjustmentResults = [];
          }
        }
      } catch (e) {
        console.error("Failed to persist bay capacity changes:", e);
      }

      setData((previous) => {
        if (!previous) {
          return previous;
        }

        const prevBooking = previous.bookings.find((b) => b.booking_id === bookingId);
        const prevState = normalizeStage(prevBooking?.status);
        const prevBayId = prevBooking?.bay_id ?? null;

        const counted = (s: ValetStage) => isParkedLikeStage(s);

        // produce updated bookings list
        const updatedBookings = previous.bookings.map((booking) =>
          booking.booking_id === bookingId
            ? {
                ...booking,
                status: stage,
                bay_id: normalizedBayId,
                bay_name: resolvedBayName ?? null,
                active: isParkedLikeStage(stage),
              }
            : booking,
        );

        // adjust local bay capacities based on transition
        // Merge any server responses from set-valet-bay-current into local bay state
        const serverAdjustmentsMap = new Map<string, any>();
        try {
          for (const r of (adjustmentResults ?? [])) {
            if (r && (r.Bay_id || r.Bay_id === 0)) {
              serverAdjustmentsMap.set(String(r.Bay_id), r);
            }
          }
        } catch (e) {
          // ignore
        }

        const updatedBays = (previous.bays ?? []).map((bay) => {
          const copy = { ...bay };
          const srv = serverAdjustmentsMap.get(String(copy.Bay_id));
          if (srv?.current_capacity !== undefined) {
            copy.current_capacity = Number(srv.current_capacity ?? copy.current_capacity ?? 0);
          }
          return copy;
        });

        try {
          // If bay changed
          if (prevBayId && prevBayId !== normalizedBayId) {
            // if previously counted, decrement previous bay
            if (counted(prevState)) {
              const idx = updatedBays.findIndex((b) => b.Bay_id === prevBayId);
              if (idx >= 0) {
                updatedBays[idx].current_capacity = Math.max(0, (updatedBays[idx].current_capacity ?? 0) - 1);
              }
            }

            // if now counted, increment new bay
            if (normalizedBayId && counted(stage)) {
              const idx2 = updatedBays.findIndex((b) => b.Bay_id === normalizedBayId);
              if (idx2 >= 0) {
                updatedBays[idx2].current_capacity = (updatedBays[idx2].current_capacity ?? 0) + 1;
              }
            }
          } else {
            // same bay or both unassigned
            if (prevBayId && prevBayId === normalizedBayId) {
              const idx = updatedBays.findIndex((b) => b.Bay_id === prevBayId);
              if (idx >= 0) {
                // was not counted -> now counted => +1
                if (!counted(prevState) && counted(stage)) {
                  updatedBays[idx].current_capacity = (updatedBays[idx].current_capacity ?? 0) + 1;
                }
                // was counted -> now not counted => -1
                if (counted(prevState) && !counted(stage)) {
                  updatedBays[idx].current_capacity = Math.max(0, (updatedBays[idx].current_capacity ?? 0) - 1);
                }
              }
            }
          }
        } catch (e) {
          // swallow UI-only errors
          console.error("Error adjusting local bay capacities:", e);
        }

        return {
          ...previous,
          bookings: updatedBookings,
          bays: updatedBays,
        };
      });

      setDraftStageByBookingId((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });

      setDraftTableByBookingId((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });

      toast({
        title: "Valet Record Updated",
        description: `${formatTicket(bookingId)} has been updated.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to update valet record.";
      toast({ title: "Update Failed", description: message, variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  };

  // Read a picked photo and downscale it (longest side ~1600px, JPEG) so the
  // base64 upload to the plate-scan endpoint stays small. Falls back to the raw
  // data URL if the browser can't decode/redraw the image.
  const fileToScaledDataUrl = (file: File, maxDim = 1600): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => { reject(new Error("Unable to read image")); };
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        if (!dataUrl) {
          reject(new Error("Unable to read image"));
          return;
        }
        const img = new window.Image();
        img.onerror = () => { resolve(dataUrl); };
        img.onload = () => {
          const largest = Math.max(img.width, img.height);
          const scale = largest > 0 ? Math.min(1, maxDim / largest) : 1;
          if (scale >= 1) {
            resolve(dataUrl);
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });

  // Web mirror of the Flutter app's "Scan plate from photo": read the photo,
  // POST it to /valet/scan-plate (OpenAI vision server-side), and prefill the
  // number-plate input. Never blocks manual entry — any failure just asks the
  // attendant to type it in.
  const scanPlateFromPhoto = async (file: File) => {
    if (!user?.restaurantUsername) {
      return;
    }
    try {
      setScanningPlate(true);
      const image = await fileToScaledDataUrl(file);
      const response = await requestBackend<{ plate?: string | null; error?: string }>({
        path: "/valet/scan-plate",
        method: "POST",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
        body: { image },
      });

      const plate = response.ok ? response.data?.plate ?? null : null;
      if (plate) {
        const normalized = String(plate).trim().toUpperCase();
        setNewVehiclePlate(normalized);
        toast({ title: "Plate Detected", description: `Detected '${normalized}' — check it, then add.` });
      } else {
        toast({
          title: "No Plate Found",
          description: "Could not read a plate — please type it in.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "No Plate Found",
        description: "Could not read a plate — please type it in.",
        variant: "destructive",
      });
    } finally {
      setScanningPlate(false);
    }
  };

  const createValetRecord = async () => {
    if (!user?.restaurantUsername) {
      return;
    }

    if (!newVehiclePlate.trim()) {
      toast({ title: "Missing Vehicle Plate", description: "Enter vehicle number plate.", variant: "destructive" });
      return;
    }

    if (!newDateTime) {
      toast({ title: "Missing Time", description: "Select date and time.", variant: "destructive" });
      return;
    }

    const date = new Date(newDateTime);
    if (Number.isNaN(date.getTime())) {
      toast({ title: "Invalid Time", description: "Please select a valid date/time.", variant: "destructive" });
      return;
    }

    try {
      setCreating(true);
      const selectedBayIdentifier =
        newRecordBayValue === "__default_main__" ? "Main" : newRecordBayValue;

      const response = await requestBackend<{ message: string; booking_id?: string; entry_time?: string; bay_id?: string; number_plate?: string; customer_name?: string; error?: string }>({
        path: "/create_valet_record",
        method: "POST",
        restaurantId: user.restaurantUsername,
        employeeId: user.employeeId,
        outletId: user.outlet_id,
        body: {
          number_plate: newVehiclePlate.trim().toUpperCase(),
          customer_name: newGuestName.trim() || undefined,
          booking_date_time: date.toISOString(),
          bay_id: selectedBayIdentifier,
        },
      });

      if (!response.ok) {
        const message = response.data?.error ?? response.text;
        throw new Error(message || "Unable to create valet record.");
      }

      const created = (response.data ?? {}) as {
        message: string;
        booking_id?: string;
        entry_time?: string;
        bay_id?: string;
        number_plate?: string;
        customer_name?: string;
      };
      const createdBookingId = typeof created.booking_id === "string" ? created.booking_id : undefined;
      const createdEntryTime = typeof created.entry_time === "string" ? created.entry_time : undefined;
      const createdBayId = typeof created.bay_id === "string" ? created.bay_id : undefined;
      const createdCustomerName =
        typeof created.customer_name === "string" && created.customer_name.trim().length > 0
          ? created.customer_name.trim()
          : undefined;
      const createdNumberPlate =
        typeof created.number_plate === "string" && created.number_plate.trim().length > 0
          ? created.number_plate.trim().toUpperCase()
          : newVehiclePlate.trim().toUpperCase();

      setData((previous) => {
        const resolvedBayName =
          createdBayId && previous
            ? (previous.bays ?? []).find((b) => String(b.Bay_id) === createdBayId)?.Bay_name ?? null
            : null;

        const optimisticBooking: ValetBooking = {
          booking_id: createdBookingId,
          customer_name: createdCustomerName ?? (newGuestName.trim() || "Guest"),
          bay_id: createdBayId ?? null,
          bay_name: resolvedBayName,
          booking_date_time: createdEntryTime ? createdEntryTime : new Date().toISOString(),
          exit_date_time: undefined,
          // number_of_people: 1,
          status: "Vehicle added",
          number_plate: createdNumberPlate,
          active: true,
        };

        if (!previous) {
          return {
            role: user.role,
            generated_at: new Date().toISOString(),
            bays: [],
            bookings: [optimisticBooking],
          };
        }

        return {
          ...previous,
          bookings: [optimisticBooking, ...previous.bookings],
        };
      });

      // Prevent newly created records from being hidden by stale filters.
      setRecordSearchQuery("");
      setRecordStageFilter("all");
      setRecordBayFilter("all");

      // Pull authoritative row (including mapped bay name and persisted metadata).
      await fetchValetInfo();

      toast({ title: "Valet Record Added", description: `${newGuestName.trim() || "Guest"} was added.` });
      setNewGuestName("");
      setNewVehiclePlate("");
      setNewDateTime(getCurrentLocalDateTimeValue(timezone));
      setNewRecordBayValue("__default_main__");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to create valet record.";
      toast({ title: "Create Failed", description: message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const inProgressBookings = useMemo(
    () =>
      (data?.bookings ?? []).filter((booking) => {
        const stage = normalizeStage(booking.status);
        return isInProgressStage(stage);
      }),
    [data],
  );

  const stats = useMemo(() => {
    const tables = data?.bays ?? [];

    const parkedNow = inProgressBookings.filter((booking) => isParkedLikeStage(normalizeStage(booking.status))).length;
    const pickupCount = inProgressBookings.filter((booking) => isPickupStage(normalizeStage(booking.status))).length;
    // Yet to park specifically means stage 1 (Vehicle added)
    const yetToPark = inProgressBookings.filter((booking) => normalizeStage(booking.status) === "Vehicle added").length;
    // Cars that customers have requested the valet to bring from the parking bay (stage 3)
    const toBePickedByValet = inProgressBookings.filter((booking) => normalizeStage(booking.status) === "Request to bring car (from customer)").length;
    const activeCars = inProgressBookings.length;

    // Compute occupancy using bay capacities from server/local state
    const totalCapacity = tables.reduce((s, b) => s + (Number(b.total_capacity) || 0), 0);
    const occupiedCapacity = tables.reduce((s, b) => s + (Number(b.current_capacity) || 0), 0);
    const spaceAvailable = Math.max(totalCapacity - occupiedCapacity, 0);

    return {
      activeCars,
      toBePickedByValet,
      parkedNow,
      pickupCount,
      yetToPark,
      spaceAvailable,
      totalBays: tables.length,
      totalCapacity,
      occupiedCapacity,
    };
  }, [data, inProgressBookings]);

  const activeCarQueue = useMemo(
    () => inProgressBookings.filter((booking) => isParkedLikeStage(normalizeStage(booking.status))),
    [inProgressBookings],
  );

  const pickupQueue = useMemo(
    () => inProgressBookings.filter((booking) => isPickupStage(normalizeStage(booking.status))),
    [inProgressBookings],
  );

  const incomingCarQueue = useMemo(
    // incoming = stage 1 (Vehicle added)
    () => inProgressBookings.filter((booking) => normalizeStage(booking.status) === "Vehicle added"),
    [inProgressBookings],
  );

  const editableBookings = useMemo(() => data?.bookings ?? [], [data]);

  const displayedParkedQueue = useMemo(
    () => (showAllParked ? activeCarQueue : activeCarQueue.slice(0, 5)),
    [activeCarQueue, showAllParked],
  );

  const displayedPickupQueue = useMemo(
    () => (showAllPickup ? pickupQueue : pickupQueue.slice(0, 5)),
    [pickupQueue, showAllPickup],
  );

  const displayedIncomingQueue = useMemo(
    () => (showAllIncoming ? incomingCarQueue : incomingCarQueue.slice(0, 5)),
    [incomingCarQueue, showAllIncoming],
  );

  const filteredEditableBookings = useMemo(() => {
    const query = recordSearchQuery.trim().toLowerCase();

    const results = editableBookings.filter((booking, index) => {
      const bookingId = booking.booking_id;
      const stage = normalizeStage(booking.status);
      const bayDisplay =
        booking.bay_name ??
        (booking.bay_id ? (data?.bays ?? []).find((b) => b.Bay_id === booking.bay_id)?.Bay_name : "") ??
        "";

      // Bay filter
      if (recordBayFilter === "__unassigned__") {
        if (String(bayDisplay).trim().length > 0) {
          return false;
        }
      } else if (recordBayFilter !== "all") {
        if (String(bayDisplay).trim().toLowerCase() !== recordBayFilter.toLowerCase()) {
          return false;
        }
      }

      // Stage filter
      if (recordStageFilter !== "all" && stage !== recordStageFilter) {
        return false;
      }

      // Date filter (compare YYYY-MM-DD)
      if (recordDate) {
        const raw = booking.booking_date_time;
        if (!raw) {return false;}
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {return false;}
        if (dayKeyInZone(d, timezone) !== recordDate) {return false;}
      }

      // Search query
      if (!query) {return true;}

      const searchable = [
        booking.customer_name ?? "",
        bayDisplay,
        extractVehiclePlate(booking),
        stage,
        formatTicket(bookingId, index),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });

    // Sort by booking time
    results.sort((a, b) => {
      const ta = a.booking_date_time ? new Date(a.booking_date_time).getTime() : 0;
      const tb = b.booking_date_time ? new Date(b.booking_date_time).getTime() : 0;
      return sortAsc ? ta - tb : tb - ta;
    });

    return results;
  }, [editableBookings, recordSearchQuery, recordStageFilter, recordBayFilter, recordDate, sortAsc, data]);

  const bayOptions = useMemo(() => {
    const normalized = managedBays
      .map((bay) => ({ name: bay.name.trim(), total_capacity: bay.total_capacity }))
      .filter((bay) => bay.name.length > 0);
    const hasMain = normalized.some((b) => b.name === "Main");
    const ensured = hasMain ? normalized : [{ name: "Main", total_capacity: 5 }, ...normalized];
    return Array.from(new Set(ensured.map((b) => b.name)));
  }, [managedBays]);

  const addRecordBayOptions = useMemo(() => {
    const options = new Map<string, string>();

    (data?.bays ?? []).forEach((bay) => {
      const value = String(bay.Bay_id ?? bay.Bay_name ?? "").trim();
      const label = String(bay.Bay_name ?? bay.Bay_id ?? "").trim();
      if (value && label) {
        options.set(value, label);
      }
    });

    managedBays.forEach((bay) => {
      const normalized = bay.name.trim();
      if (normalized && !Array.from(options.values()).includes(normalized)) {
        options.set(normalized, normalized);
      }
    });

    if (!Array.from(options.values()).some((label) => label.toLowerCase() === "main")) {
      options.set("Main", "Main");
    }

    return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
  }, [data?.bays, managedBays]);

  const recordBayFilterOptions = useMemo(() => {
    const labels = new Set<string>();

    (data?.bays ?? []).forEach((bay) => {
      const label = String(bay.Bay_name ?? "").trim();
      if (label) {
        labels.add(label);
      }
    });

    managedBays.forEach((bay) => {
      const label = bay.name.trim();
      if (label) {
        labels.add(label);
      }
    });

    labels.add("Main");
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [data?.bays, managedBays]);

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    if (baysInitializedForRestaurant === user.restaurantUsername) {return;}

    const bayKey = `valet-bays:${user.restaurantUsername}`;
    const savedBaysRaw = window.localStorage.getItem(bayKey);

    // Fast path: use localStorage for immediate UI responsiveness
    if (savedBaysRaw) {
      try {
        const parsed = JSON.parse(savedBaysRaw) as unknown;
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .map((value) => {
              if (typeof value === "string") {return { name: value.trim(), total_capacity: 5 };}
              if (typeof value === "object" && value !== null) {
                const n = (value).name ?? (value).Bay_name ?? "";
                const cap = Number((value).total_capacity ?? (value).totalCapacity ?? 5) || 5;
                return { name: String(n).trim(), total_capacity: cap };
              }
              return null;
            })
            .filter((v) => v && v.name.length > 0) as { name: string; total_capacity: number }[];

          const ensuredMain = cleaned.some((c) => c.name === "Main") ? cleaned : [{ name: "Main", total_capacity: 5 }, ...cleaned];
          Promise.resolve().then(() => { setManagedBays(ensuredMain); });
        }
      } catch {
        // ignore parse errors
      }
    }

    // Async: fetch authoritative bays from server, update UI and localStorage
    (async () => {
      setBaysLoading(true);
      try {
        const resp = await requestBackend<any[]>({
          path: "/valet-bays",
          method: "GET",
          restaurantId: user?.restaurantUsername,
          employeeId: user?.employeeId,
          outletId: user?.outlet_id,
        });

        if (!resp.ok) {
          setBaysInitializedForRestaurant(user.restaurantUsername);
          setBaysLoading(false);
          return;
        }

        const server = Array.isArray(resp.data) ? resp.data : [];
        const serverBays = server.map((b) => ({ name: b.Bay_name, total_capacity: Number(b.total_capacity) || 0, Bay_id: b.Bay_id, restaurant_id: b.restaurant_id }));

        // If server has no Main, create it in DB
        const hasMain = serverBays.some((b) => b.name === "Main");
        let finalServerBays = serverBays;
        if (!hasMain) {
          try {
            const addResp = await requestBackend<{ Bay_id?: string }>({
              path: "/add-valet-bay",
              method: "POST",
              restaurantId: user?.restaurantUsername,
              employeeId: user?.employeeId,
              outletId: user?.outlet_id,
              body: { Bay_name: "Main", total_capacity: 5 },
            });
            if (addResp.ok) {
              const addedJson = addResp.data ?? {};
              finalServerBays = [{ name: "Main", total_capacity: 5, Bay_id: addedJson?.Bay_id, restaurant_id: user?.restaurantUsername }, ...serverBays];
            }
          } catch {
            // ignore
          }
        }

        // update UI and localStorage
        setManagedBays(finalServerBays.map((b) => ({ name: b.name, total_capacity: b.total_capacity })));
        setData((prev) => {
          const mapped = finalServerBays.map((b) => ({ Bay_id: b.Bay_id ?? String(b.name), Bay_name: b.name, total_capacity: b.total_capacity, current_capacity: 0, restaurant_id: b.restaurant_id } as ValetBays));
          if (!prev) {return { role: user?.role ?? "valet", generated_at: new Date().toISOString(), bays: mapped, bookings: [] };}
          return { ...prev, bays: mapped };
        });

        try {
          window.localStorage.setItem(bayKey, JSON.stringify(finalServerBays.map((b) => ({ name: b.name, total_capacity: b.total_capacity }))));
        } catch {
          // ignore
        }
      } catch (e) {
        // network error: keep localStorage values
      } finally {
        setBaysInitializedForRestaurant(user.restaurantUsername);
        setBaysLoading(false);
      }
    })();
  }, [user?.restaurantUsername, user?.employeeId, user?.outlet_id, user?.role, data?.bays, baysInitializedForRestaurant]);

  useEffect(() => {
    if (!user?.restaurantUsername) {
      return;
    }

    if (baysInitializedForRestaurant !== user.restaurantUsername) {
      return;
    }

    const bayKey = `valet-bays:${user.restaurantUsername}`;
    window.localStorage.setItem(bayKey, JSON.stringify(managedBays));
  }, [user?.restaurantUsername, user?.employeeId, user?.outlet_id, user?.role, baysInitializedForRestaurant, bayOptions, managedBays]);

  const addBay = async () => {
    const normalized = newBayName.trim();
    const capacity = Number(newBayCapacity);
    if (!normalized) {
      toast({ title: "Missing Name", description: "Enter a bay name.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      toast({ title: "Invalid Capacity", description: "Enter a valid total capacity (positive integer).", variant: "destructive" });
      return;
    }

    // Check against existing managed bays and server-provided bays
    const existsLocal = managedBays.some((b) => b.name.toLowerCase() === normalized.toLowerCase());
    const existsServer = (data?.bays ?? []).some((b) => String(b.Bay_name).toLowerCase() === normalized.toLowerCase());
    if (existsLocal || existsServer) {
      toast({ title: "Bay exists", description: `${normalized} is already added.` });
      return;
    }

    // Persist to server and update data.bays and managedBays only on success
    try {
      const resp = await requestBackend<{ Bay_id?: string; current_capacity?: number; error?: string }>({
        path: "/add-valet-bay",
        method: "POST",
        restaurantId: user?.restaurantUsername,
        employeeId: user?.employeeId,
        outletId: user?.outlet_id,
        body: { Bay_name: normalized, total_capacity: capacity },
      });

      const json = resp.data ?? {};
      if (resp.ok) {
        const added = {
          Bay_id: json?.Bay_id ?? undefined,
          Bay_name: normalized,
          total_capacity: capacity,
          current_capacity: json?.current_capacity ?? 0,
          restaurant_id: user?.restaurantUsername,
        } as ValetBays;

        // update managedBays and data.bays
        setManagedBays((prev) => [...prev, { name: added.Bay_name, total_capacity: added.total_capacity }]);
        setData((prev) => {
          if (!prev) {
            return { role: user?.role ?? "valet", generated_at: new Date().toISOString(), bays: [added], bookings: [] };
          }
          return { ...prev, bays: [added, ...(prev.bays ?? [])] };
        });

        // persist inputs and localStorage update
        setNewBayName("");
        setNewBayCapacity(5);
        try {
          if (user?.restaurantUsername) {
            const bayKey = `valet-bays:${user.restaurantUsername}`;
            const raw = window.localStorage.getItem(bayKey);
            let arr: { name: string; total_capacity: number }[] = [];
            if (raw) {
              try { arr = JSON.parse(raw); } catch { arr = []; }
            }
            arr.push({ name: added.Bay_name, total_capacity: added.total_capacity });
            window.localStorage.setItem(bayKey, JSON.stringify(arr));
          }
        } catch {
          // ignore
        }
      } else {
        const err = (json?.error && String(json.error)) || resp.text || "Failed to add bay";
        toast({ title: "Add Bay Failed", description: err, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Add Bay Failed", description: "Network error while adding bay.", variant: "destructive" });
    }
  };

  const removeBay = async (bayName: string) => {
    if (bayName === "Main") {
      toast({ title: "Main bay required", description: "Main cannot be removed.", variant: "destructive" });
      return;
    }

    const proceed = window.confirm(
      `Removing bay '${bayName}' will delete all valet entries assigned to it. Do you want to proceed?`,
    );
    if (!proceed) {return;}

    // Try to remove from server and cascade-delete valet_state records
    try {
      const serverMatch = (data?.bays ?? []).find((b) => String(b.Bay_name) === bayName);
      const payload: Record<string, unknown> = {};
      if (serverMatch?.Bay_id) {payload.Bay_id = serverMatch.Bay_id;}
      else {payload.Bay_name = bayName;}

      const resp = await requestBackend<{ error?: string }>({
        path: "/delete-valet-bay",
        method: "POST",
        restaurantId: user?.restaurantUsername,
        employeeId: user?.employeeId,
        outletId: user?.outlet_id,
        body: payload,
      });

      const json = resp.data ?? {};
      if (!resp.ok) {
        const err = (typeof json?.error === "string" ? json.error : resp.text || "Unable to delete bay on server");
        toast({ title: "Delete Failed", description: err, variant: "destructive" });
        return;
      }
      // On success: remove locally and clear related bookings
      setManagedBays((prev) => prev.filter((bay) => bay.name !== bayName));
      setData((prev) => {
        if (!prev) {return prev;}
        const filteredBays = (prev.bays ?? []).filter((b) => String(b.Bay_name) !== bayName);
        const filteredBookings = (prev.bookings ?? []).filter((bk) => {
          const bayDisplay = bk.bay_name ?? (bk.bay_id ? (prev.bays ?? []).find((b) => b.Bay_id === bk.bay_id)?.Bay_name : "");
          return String(bayDisplay) !== bayName;
        });
        return { ...prev, bays: filteredBays, bookings: filteredBookings };
      });

      // Clear any localStorage valet entries for this restaurant if present (best-effort)
      try {
        if (user?.restaurantUsername) {
          const key = `valet-records:${user.restaurantUsername}`;
          const raw = window.localStorage.getItem(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as any[];
              if (Array.isArray(parsed)) {
                const filtered = parsed.filter((r) => {
                  const bayNameLocal = (r?.bay_name ?? r?.bay ?? "") as string;
                  return String(bayNameLocal) !== bayName;
                });
                window.localStorage.setItem(key, JSON.stringify(filtered));
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch {
        // ignore localStorage errors
      }

      toast({ title: "Bay Removed", description: `${bayName} deleted and related valet entries removed.` });
    } catch (e) {
      toast({ title: "Delete Failed", description: "Unable to delete bay on server.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!user?.restaurantUsername) {
      return;
    }

    if (spaceInitializedForRestaurant === user.restaurantUsername) {
      return;
    }

    const spaceKey = `valet-space-available:${user.restaurantUsername}`;
    const maxKey = `valet-max-bays:${user.restaurantUsername}`;

    const savedSpaceValue = window.localStorage.getItem(spaceKey);
    const savedMaxValue = window.localStorage.getItem(maxKey);

    const parsedMax = savedMaxValue ? Number.parseInt(savedMaxValue, 10) : Number.NaN;
    const initialMax = Number.isNaN(parsedMax) ? Math.max(0, stats.totalBays) : Math.max(0, parsedMax);

    const parsedSpace = savedSpaceValue ? Number.parseInt(savedSpaceValue, 10) : Number.NaN;
    const initialSpace = Number.isNaN(parsedSpace)
      ? Math.max(0, stats.spaceAvailable)
      : Math.max(0, parsedSpace);

    Promise.resolve().then(() => {
      setMaxBaysDisplay(initialMax);
      setSpaceAvailableDisplay(initialSpace);
      window.localStorage.setItem(maxKey, String(initialMax));
      window.localStorage.setItem(spaceKey, String(initialSpace));
      setSpaceInitializedForRestaurant(user.restaurantUsername);
    });
  }, [user?.restaurantUsername, stats.spaceAvailable, stats.totalBays, spaceInitializedForRestaurant]);

  // Keep the visible space available in sync when server-side capacities change.
  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    if (spaceInitializedForRestaurant !== user.restaurantUsername) {return;}
    Promise.resolve().then(() => { setSpaceAvailableDisplay(Math.max(0, stats.spaceAvailable)); });
  }, [user?.restaurantUsername, stats.spaceAvailable, spaceInitializedForRestaurant]);

  useEffect(() => {
    if (!user?.restaurantUsername) {
      return;
    }

    if (spaceInitializedForRestaurant !== user.restaurantUsername) {
      return;
    }

    const spaceKey = `valet-space-available:${user.restaurantUsername}`;
    const maxKey = `valet-max-bays:${user.restaurantUsername}`;

    window.localStorage.setItem(spaceKey, String(Math.max(0, spaceAvailableDisplay)));
    window.localStorage.setItem(maxKey, String(Math.max(0, maxBaysDisplay)));
  }, [user?.restaurantUsername, spaceAvailableDisplay, maxBaysDisplay, spaceInitializedForRestaurant]);

  useEffect(() => {
    if (!user?.role || canViewValet || hasShownAccessToastRef.current) {
      return;
    }

    toast({
      title: "Access denied",
      description: "You do not have the required role for this page. Required role: valet or admin.",
      variant: "destructive",
    });
    hasShownAccessToastRef.current = true;
  }, [user?.role, canViewValet, toast]);

  if (user?.role && !canViewValet) {
    return (
      <div className="p-4">
        <p>You do not have permission to view this page. Required role: valet or admin.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Valet Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => document.getElementById("manage-valet-records")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Edit Records
          </Button>
          <Button onClick={fetchValetInfo} variant="outline" disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">To be picked by Valet</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.toBePickedByValet}</div>
            <p className="text-xs text-muted-foreground">Cars customers have requested to be picked from bays</p>
            <div className="mt-2 flex flex-col gap-2 max-h-28 overflow-y-auto py-1">
              {(inProgressBookings ?? [])
                .filter((b) => normalizeStage(b.status) === "Request to bring car (from customer)")
                .slice(0, 12)
                .map((b) => (
                  <Badge key={b.booking_id} variant="secondary" className="whitespace-nowrap">
                    {extractVehiclePlate(b)}
                    {b.parking_location ? ` @ ${b.parking_location}` : ""}
                    {b.eta_minutes ? ` · ETA ${b.eta_minutes}m` : ""}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Currently Parked</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.parkedNow}</div>
            <p className="text-xs text-muted-foreground">Vehicles parked/in retrieval process</p>
            <div className="mt-2 flex flex-col gap-2 max-h-28 overflow-y-auto py-1">
              {(activeCarQueue ?? []).slice(0, 12).map((b) => (
                <Badge key={b.booking_id} variant="secondary" className="whitespace-nowrap">{extractVehiclePlate(b)}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">To be picked up</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pickupCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">Cars arrived and awaiting pickup</p>
            <div className="mt-2 flex flex-col gap-2 max-h-28 overflow-y-auto py-1">
              {(pickupQueue ?? []).slice(0, 12).map((b) => (
                <Badge key={b.booking_id} variant="secondary" className="whitespace-nowrap">{extractVehiclePlate(b)}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Yet To Park</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.yetToPark}</div>
            <p className="text-xs text-muted-foreground">Vehicles at stage 1</p>
            <div className="mt-2 flex flex-col gap-2 max-h-28 overflow-y-auto py-1">
              {(incomingCarQueue ?? []).slice(0, 12).map((b) => (
                <Badge key={b.booking_id} variant="secondary" className="whitespace-nowrap">{extractVehiclePlate(b)}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Space Available</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{spaceAvailableDisplay}</div>
            <p className="text-xs text-muted-foreground">Total available spaces across bays</p>

            {/* Per-bay availability list (responsive to bay and record updates) */}
            <div className="mt-3 space-y-2">
              {(data?.bays ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No bays configured</p>
              ) : (
                <div className="grid gap-2">
                  {(data?.bays ?? []).map((bay) => {
                    const total = Number(bay.total_capacity ?? 0) || 0;
                    const used = Number(bay.current_capacity ?? 0) || 0;
                    const avail = Math.max(0, total - used);
                    return (
                      <div key={bay.Bay_id ?? bay.Bay_name} className="flex items-center justify-between gap-4 p-2 rounded-md border">
                        <div className="flex flex-col">
                          <div className="text-sm font-medium">{bay.Bay_name ?? bay.Bay_id}</div>
                          <div className="text-xs text-muted-foreground">{used} / {total} occupied</div>
                        </div>
                        <div className="text-sm font-semibold">{avail} free</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bay Management</CardTitle>
          <CardDescription>Add or remove bays. Main always stays as default.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="new-bay">Add Bay</Label>
              <Input
                id="new-bay"
                placeholder="e.g. Bay A2"
                value={newBayName}
                onChange={(e) => { setNewBayName(e.target.value); }}
              />
            </div>
            <div className="w-36">
              <Label htmlFor="new-bay-capacity">Total Capacity</Label>
              <Input
                id="new-bay-capacity"
                type="number"
                min={1}
                value={String(newBayCapacity)}
                onChange={(e) => { setNewBayCapacity(e.target.value ? Number(e.target.value) : ""); }}
              />
            </div>
            <Button type="button" variant="outline" onClick={addBay}>Add Bay</Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {managedBays.map((bay) => (
              <div key={bay.name} className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                {editingBay === bay.name ? (
                  <div className="flex items-center gap-2">
                    <Input value={editingBayName} onChange={(e) => { setEditingBayName(e.target.value); }} className="w-36" />
                    <Input type="number" value={String(editingBayCapacity)} onChange={(e) => { setEditingBayCapacity(e.target.value ? Number(e.target.value) : ""); }} className="w-24" />
                      <Button size="sm" onClick={async () => {
                      const newName = editingBayName.trim();
                      const cap = Number(editingBayCapacity);
                        if (baysLoading) { toast({ title: "Bays still loading", description: "Wait for bays to load before editing.", variant: "destructive" }); return; }
                      if (!newName) { toast({ title: "Missing Name", description: "Enter a bay name.", variant: "destructive" }); return; }
                      if (!Number.isFinite(cap) || cap <= 0) { toast({ title: "Invalid Capacity", description: "Enter a valid capacity.", variant: "destructive" }); return; }
                      // prevent duplicate name
                      const conflict = managedBays.some((b) => b.name.toLowerCase() === newName.toLowerCase() && b.name !== bay.name);
                      const conflictServer = (data?.bays ?? []).some((b) => String(b.Bay_name).toLowerCase() === newName.toLowerCase() && String(b.Bay_name) !== bay.name);
                      if (conflict || conflictServer) { toast({ title: "Bay exists", description: `${newName} already exists.`, variant: "destructive" }); return; }

                      // Defer updating local managedBays/data until server confirms success


                      try {
                        // If there is a server record for this bay, call update; else create new
                        const serverMatch = (data?.bays ?? []).find((sb) => String(sb.Bay_name) === bay.name || String(sb.Bay_id) === bay.name);
                        if (serverMatch?.Bay_id) {
                          const resp = await requestBackend<{ Bay_id?: string; Bay_name?: string; total_capacity?: number; current_capacity?: number }>({
                            path: "/update-valet-bay",
                            method: "POST",
                            restaurantId: user?.restaurantUsername,
                            employeeId: user?.employeeId,
                            outletId: user?.outlet_id,
                            body: { Bay_id: serverMatch.Bay_id, Bay_name: newName, total_capacity: cap },
                          });
                          const json = resp.data ?? {};
                          if (resp.ok) {
                            // If server didn't include current_capacity, refetch authoritative bay list
                            let serverCurrent = json?.current_capacity;
                            if (serverCurrent === undefined && serverMatch.Bay_id) {
                              try {
                                const fetchBays = await requestBackend<any[]>({
                                  path: "/valet-bays",
                                  method: "GET",
                                  restaurantId: user?.restaurantUsername,
                                  employeeId: user?.employeeId,
                                  outletId: user?.outlet_id,
                                });
                                if (fetchBays.ok) {
                                  const all = Array.isArray(fetchBays.data) ? fetchBays.data : [];
                                  const found = (Array.isArray(all) ? all : []).find((b: any) => String(b.Bay_id) === String(serverMatch.Bay_id));
                                  serverCurrent = found?.current_capacity ?? serverMatch.current_capacity ?? 0;
                                }
                              } catch (e) {
                                serverCurrent = serverMatch.current_capacity ?? 0;
                              }
                            }

                            // update managedBays and data.bays with server-confirmed values
                            setManagedBays((prev) => prev.map((p) => (p.name === bay.name ? { name: newName, total_capacity: cap } : p)));
                            setData((prev) => {
                              if (!prev) {return prev;}
                              const updated = { Bay_id: json?.Bay_id ?? serverMatch.Bay_id, Bay_name: json?.Bay_name ?? newName, total_capacity: json?.total_capacity ?? cap, current_capacity: serverCurrent, restaurant_id: user?.restaurantUsername } as ValetBays;
                              const filtered = (prev.bays ?? []).filter((b) => String(b.Bay_id) !== updated.Bay_id);
                              return { ...prev, bays: [updated, ...filtered] };
                            });
                          }
                        } else {
                          const resp = await requestBackend<{ Bay_id?: string; current_capacity?: number }>({
                            path: "/add-valet-bay",
                            method: "POST",
                            restaurantId: user?.restaurantUsername,
                            employeeId: user?.employeeId,
                            outletId: user?.outlet_id,
                            body: { Bay_name: newName, total_capacity: cap },
                          });
                          const json = resp.data ?? {};
                          if (resp.ok) {
                            const added = { Bay_id: json?.Bay_id ?? undefined, Bay_name: newName, total_capacity: cap, current_capacity: json?.current_capacity ?? 0, restaurant_id: user?.restaurantUsername } as ValetBays;
                            setManagedBays((prev) => [...prev, { name: added.Bay_name, total_capacity: added.total_capacity }]);
                            setData((prev) => {
                              if (!prev) {return prev;}
                              const filtered = (prev.bays ?? []).filter((b) => String(b.Bay_name) !== newName);
                              return { ...prev, bays: [added, ...filtered] };
                            });
                          }
                        }
                      } catch (e) {
                        // ignore
                      }

                      setEditingBay(null);
                    }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingBay(null); }}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <span className="mr-2">{bay.name} ({bay.total_capacity})</span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" disabled={bay.name === "Main"} onClick={() => removeBay(bay.name)}>x</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => { setEditingBay(bay.name); setEditingBayName(bay.name); setEditingBayCapacity(bay.total_capacity); }}>Edit</Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add Valet Record</CardTitle>
          <CardDescription>Create a new car/guest valet entry directly from this dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="valet-guest-name">Guest Name</Label>
              <Input
                id="valet-guest-name"
                value={newGuestName}
                onChange={(e) => { setNewGuestName(e.target.value); }}
                placeholder="Customer name (optional)"
              />
            </div>
            <div>
              <Label htmlFor="valet-plate">Vehicle Number Plate</Label>
              <Input
                id="valet-plate"
                value={newVehiclePlate}
                onChange={(e) => { setNewVehiclePlate(e.target.value); }}
                placeholder="KA01AB1234"
              />
              <input
                ref={plateScanInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) {
                    scanPlateFromPhoto(file);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                disabled={scanningPlate}
                onClick={() => plateScanInputRef.current?.click()}
              >
                {scanningPlate ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Reading plate…
                  </>
                ) : (
                  <>
                    <Camera className="mr-2 h-4 w-4" />
                    Scan plate from photo
                  </>
                )}
              </Button>
            </div>
            <div>
              <Label htmlFor="valet-datetime">Date & Time</Label>
              <Input
                id="valet-datetime"
                type="datetime-local"
                value={newDateTime}
                onChange={(e) => { setNewDateTime(e.target.value); }}
              />
            </div>
            <div>
              <Label htmlFor="valet-bay">Bay</Label>
              <Select value={newRecordBayValue} onValueChange={(value) => { setNewRecordBayValue(value); }}>
                <SelectTrigger id="valet-bay">
                  <SelectValue placeholder="Select Bay" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default_main__">Main (Default)</SelectItem>
                  {addRecordBayOptions
                    .filter((bay) => bay.label.toLowerCase() !== "main")
                    .map((bay) => (
                      <SelectItem key={bay.value} value={bay.value}>{bay.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {/* Initial stage removed — new records default to 'Vehicle added' */}
          </div>
          <div className="mt-4">
            <Button type="button" onClick={createValetRecord} disabled={creating}>
              {creating ? "Adding..." : "Add Record"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card id="manage-valet-records" className="border-primary/40">
        <CardHeader>
          <CardTitle>Manage Valet Records</CardTitle>
          <CardDescription>
            Primary editor for valet. Update stage or bay here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div>
              <Label htmlFor="record-search">Search records</Label>
              <Input
                id="record-search"
                placeholder="Search by name, ticket, plate, stage or bay"
                value={recordSearchQuery}
                onChange={(e) => { setRecordSearchQuery(e.target.value); }}
              />
            </div>
            <div>
              <Label>Filter stage</Label>
              <Select value={recordStageFilter} onValueChange={(value) => { setRecordStageFilter(value as "all" | ValetStage); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {VALET_STAGES.map((stageOption) => (
                    <SelectItem key={stageOption} value={stageOption}>{stageOption}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Filter bay</Label>
              <Select value={recordBayFilter} onValueChange={setRecordBayFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All bays" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All bays</SelectItem>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {recordBayFilterOptions.map((bayOption) => (
                    <SelectItem key={bayOption} value={bayOption}>{bayOption}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Filter date & sort</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="record-date"
                  type="date"
                  value={recordDate}
                  onChange={(e) => { setRecordDate(e.target.value); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  title={sortAsc ? "Sort ascending" : "Sort descending"}
                  onClick={() => { setSortAsc((s) => !s); }}
                >
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {loading ? <p>Loading valet data...</p> : null}
          {!loading && error ? <p className="text-destructive">{error}</p> : null}
          {!loading && !error && filteredEditableBookings.length === 0 ? <p>No matching valet records found.</p> : null}

          {!loading && !error && filteredEditableBookings.length > 0 ? (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
              {filteredEditableBookings.map((booking, index) => {
                const bookingId = booking.booking_id;
                const stage = normalizeStage(booking.status);
                const currentTable =
                  booking.bay_name ??
                  (booking.bay_id ? (data?.bays ?? []).find((b) => b.Bay_id === booking.bay_id)?.Bay_name : null) ??
                  "unassigned";
                const draftStage = bookingId ? draftStageByBookingId[bookingId] : undefined;
                const draftTable = bookingId ? draftTableByBookingId[bookingId] : undefined;
                const stageValue = bookingId ? (draftStage ?? stage) : stage;
                const tableValue = bookingId ? (draftTable ?? currentTable) : currentTable;

                const isDirty = Boolean(
                  bookingId && (
                    (draftStage !== undefined && draftStage !== stage) || (draftTable !== undefined && draftTable !== currentTable)
                  ),
                );

                return (
                  <div
                    key={bookingId ?? `${booking.customer_name}-${index}`}
                    id={highlight.rowProps(bookingId).id}
                    className={`rounded-md border p-3 ${isDirty ? "bg-yellow-50" : ""} ${highlight.rowProps(bookingId).className}`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium">
                        {booking.customer_name ?? "Guest"} - {formatTicket(bookingId, index)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatClock(booking.booking_date_time, timezone)}</p>
                    </div>
                    <p className="mb-2 text-sm text-muted-foreground">Vehicle Plate: {extractVehiclePlate(booking)}</p>

                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant={stageValue === "Customer took car" ? "secondary" : "default"}>
                        Stage {getStageIndex(stageValue) + 1} / 6
                      </Badge>
                      <span className="text-sm text-muted-foreground">{stageValue}</span>
                    </div>

                    <div className="mb-2 grid gap-2 md:grid-cols-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!bookingId || updatingId === bookingId || getStageIndex(stageValue) === 0}
                        onClick={() => {
                          if (!bookingId) {return;}
                          const next = moveStage(stageValue, -1);
                          setDraftStageByBookingId((prev) => ({ ...prev, [bookingId]: next }));
                        }}
                      >
                        - Stage
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!bookingId || updatingId === bookingId || getStageIndex(stageValue) === VALET_STAGES.length - 1}
                        onClick={() => {
                          if (!bookingId) {return;}
                          const next = moveStage(stageValue, 1);
                          setDraftStageByBookingId((prev) => ({ ...prev, [bookingId]: next }));
                        }}
                      >
                        + Stage
                      </Button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_auto]">
                      <Select
                        value={stageValue}
                        onValueChange={(value) => {
                          if (!bookingId) {return;}
                          setDraftStageByBookingId((prev) => ({ ...prev, [bookingId]: value as ValetStage }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select stage" />
                        </SelectTrigger>
                        <SelectContent>
                          {VALET_STAGES.map((stageOption) => (
                            <SelectItem key={stageOption} value={stageOption}>{stageOption}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={tableValue}
                        onValueChange={(value) => {
                          if (!bookingId) {return;}
                          if (baysLoading) {
                            toast({ title: "Bays still loading", description: "Please wait until bays finish loading before assigning.", variant: "destructive" });
                            return;
                          }
                          // Prevent assigning 'Unassigned' when the stage is a counted stage (2-4)
                          const currentStage = draftStageByBookingId[bookingId] ?? normalizeStage(booking.status);
                          const counted = (s: ValetStage) => isParkedLikeStage(s);
                          if (value === "unassigned" && counted(currentStage)) {
                            toast({ title: "Cannot unassign", description: "Vehicles in parked/active stages must be assigned a bay.", variant: "destructive" });
                            return;
                          }
                          setDraftTableByBookingId((prev) => ({ ...prev, [bookingId]: value }));
                        }}
                        disabled={baysLoading}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Assign Bay" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {bayOptions.map((bay) => (
                            <SelectItem key={bay} value={bay}>{bay}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button disabled={!bookingId || updatingId === bookingId || !isDirty} onClick={() => handleUpdate(bookingId)}>
                        Save
                      </Button>
                    </div>

                    {bookingId ? (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        {/* Parking location — any attendant can retrieve */}
                        <div className="grid gap-2 md:grid-cols-[1.4fr_auto_1fr]">
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Parking location (e.g. P2 / Level 1 / Slot 14)"
                              value={draftLocationByBookingId[bookingId] ?? booking.parking_location ?? ""}
                              onChange={(e) =>
                                { setDraftLocationByBookingId((prev) => ({ ...prev, [bookingId]: e.target.value })); }
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              disabled={opsBusyId === bookingId || draftLocationByBookingId[bookingId] === undefined}
                              onClick={() =>
                                saveOps(bookingId, { parking_location: draftLocationByBookingId[bookingId] ?? "" }, "Parking Location Saved")
                              }
                            >
                              Save location
                            </Button>
                          </div>

                          {/* Digital key log */}
                          <Button
                            type="button"
                            variant={booking.key_holder ? "secondary" : "outline"}
                            disabled={opsBusyId === bookingId}
                            onClick={() => keysAction(bookingId, booking.key_holder ? "handover" : "take")}
                          >
                            {booking.key_holder ? `Hand over (with ${booking.key_holder})` : "Take keys"}
                          </Button>

                          {/* Condition notes */}
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Condition notes (scratches, dents...)"
                              value={draftNotesByBookingId[bookingId] ?? booking.condition_notes ?? ""}
                              onChange={(e) =>
                                { setDraftNotesByBookingId((prev) => ({ ...prev, [bookingId]: e.target.value })); }
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              disabled={opsBusyId === bookingId || draftNotesByBookingId[bookingId] === undefined}
                              onClick={() =>
                                saveOps(bookingId, { condition_notes: draftNotesByBookingId[bookingId] ?? "" }, "Condition Notes Saved")
                              }
                            >
                              Save notes
                            </Button>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              id={`valet-photo-${bookingId}`}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file) {return;}
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const result = String(reader.result ?? "");
                                  const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
                                  if (!base64) {return;}
                                  saveOps(
                                    bookingId,
                                    { condition_photo_base64: base64, condition_photo_content_type: file.type || "image/jpeg" },
                                    "Condition Photo Saved",
                                  );
                                };
                                reader.readAsDataURL(file);
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              disabled={opsBusyId === bookingId}
                              onClick={() => document.getElementById(`valet-photo-${bookingId}`)?.click()}
                            >
                              Photo
                            </Button>
                            {booking.condition_photo_url ? (
                              <a
                                href={booking.condition_photo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary underline whitespace-nowrap"
                              >
                                View
                              </a>
                            ) : null}
                          </div>
                        </div>

                        {/* ETA quick-set when the guest has asked for the car */}
                        {stage === "Request to bring car (from customer)" || stage === "Request accepted (from valet)" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-muted-foreground">ETA to guest:</span>
                            {[5, 10, 15].map((mins) => (
                              <Button
                                key={mins}
                                type="button"
                                size="sm"
                                variant={booking.eta_minutes === mins ? "default" : "outline"}
                                disabled={opsBusyId === bookingId}
                                onClick={() => saveOps(bookingId, { eta_minutes: mins }, "ETA Set")}
                              >
                                {mins} min
                              </Button>
                            ))}
                            {booking.eta_minutes ? (
                              <Badge variant="secondary">ETA {booking.eta_minutes} min</Badge>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Valet fee → the table's open bill */}
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[180px]">
                            <Label className="text-xs">Charge to table</Label>
                            <Select
                              value={chargeTableByBookingId[bookingId] ?? ""}
                              onValueChange={(value) =>
                                { setChargeTableByBookingId((prev) => ({ ...prev, [bookingId]: value })); }
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={chargeTargets.length === 0 ? "No occupied tables" : "Pick occupied table"} />
                              </SelectTrigger>
                              <SelectContent>
                                {chargeTargets.map((t) => (
                                  <SelectItem key={t.table_name} value={t.table_name}>
                                    {t.table_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-32">
                            <Label className="text-xs">Fee amount</Label>
                            <Input
                              type="number"
                              min={1}
                              placeholder="e.g. 100"
                              value={chargeAmountByBookingId[bookingId] ?? ""}
                              onChange={(e) =>
                                { setChargeAmountByBookingId((prev) => ({ ...prev, [bookingId]: e.target.value })); }
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={opsBusyId === bookingId || chargeTargets.length === 0}
                            onClick={() => chargeToTable(bookingId)}
                          >
                            Charge to table
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>To be picked up by customer</CardTitle>
            <CardDescription>Cars that have arrived at entrance and are waiting for customer pickup.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <p>Loading valet data...</p> : null}
            {!loading && error ? <p className="text-destructive">{error}</p> : null}
            {!loading && !error && pickupQueue.length === 0 ? <p>No cars awaiting pickup.</p> : null}

            {!loading && !error && pickupQueue.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Showing {displayedPickupQueue.length} of {pickupQueue.length} cars awaiting pickup
                </p>
                {displayedPickupQueue.map((booking, index) => {
                  const bookingId = booking.booking_id;
                  const stage = normalizeStage(booking.status);

                  return (
                    <div key={bookingId ?? `${booking.customer_name}-${index}`} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{booking.customer_name ?? "Guest"}</p>
                        <Badge>{formatTicket(bookingId, index)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">Plate: {extractVehiclePlate(booking)}</p>
                      {booking.parking_location ? (
                        <p className="text-sm font-semibold">Location: {booking.parking_location}</p>
                      ) : null}
                      {booking.key_holder ? (
                        <p className="text-sm text-muted-foreground">Keys with: {booking.key_holder}</p>
                      ) : null}
                      {booking.eta_minutes ? (
                        <p className="text-sm text-muted-foreground">ETA quoted: {booking.eta_minutes} min</p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">Bay: {booking.bay_name ?? (booking.bay_id ? (data?.bays ?? []).find((b) => b.Bay_id === booking.bay_id)?.Bay_name : undefined) ?? "Main"}</p>
                      <p className="text-sm text-muted-foreground">Stage: {stage}</p>
                      <p className="text-sm text-muted-foreground">Time: {formatClock(booking.booking_date_time, timezone)}</p>
                    </div>
                  );
                })}
                {pickupQueue.length > 5 ? (
                  <Button type="button" variant="outline" onClick={() => { setShowAllPickup((prev) => !prev); }}>
                    {showAllPickup ? "Show Less" : `Show All (${pickupQueue.length})`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Currently Parked Cars</CardTitle>
            <CardDescription>Cars in stages 2-4.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <p>Loading valet data...</p> : null}
            {!loading && error ? <p className="text-destructive">{error}</p> : null}
            {!loading && !error && activeCarQueue.length === 0 ? <p>No parked cars right now.</p> : null}

            {!loading && !error && activeCarQueue.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Showing {displayedParkedQueue.length} of {activeCarQueue.length} parked cars
                </p>
                {displayedParkedQueue.map((booking, index) => {
                  const bookingId = booking.booking_id;
                  const stage = normalizeStage(booking.status);

                  return (
                    <div key={bookingId ?? `${booking.customer_name}-${index}`} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{booking.customer_name ?? "Guest"}</p>
                        <Badge>{formatTicket(bookingId, index)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">Plate: {extractVehiclePlate(booking)}</p>
                      {booking.parking_location ? (
                        <p className="text-sm font-semibold">Location: {booking.parking_location}</p>
                      ) : null}
                      {booking.key_holder ? (
                        <p className="text-sm text-muted-foreground">Keys with: {booking.key_holder}</p>
                      ) : null}
                      {booking.eta_minutes && stage !== "Parked" ? (
                        <p className="text-sm text-muted-foreground">ETA quoted: {booking.eta_minutes} min</p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">Bay: {booking.bay_name ?? (booking.bay_id ? (data?.bays ?? []).find((b) => b.Bay_id === booking.bay_id)?.Bay_name : undefined) ?? "Main"}</p>
                      <p className="text-sm text-muted-foreground">Stage: {stage}</p>
                      <p className="text-sm text-muted-foreground">Time: {formatClock(booking.booking_date_time, timezone)}</p>
                    </div>
                  );
                })}
                {activeCarQueue.length > 5 ? (
                  <Button type="button" variant="outline" onClick={() => { setShowAllParked((prev) => !prev); }}>
                    {showAllParked ? "Show Less" : `Show All (${activeCarQueue.length})`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yet To Park Queue</CardTitle>
            <CardDescription>Cars at stage 1 waiting to be parked.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <p>Loading valet data...</p> : null}
            {!loading && error ? <p className="text-destructive">{error}</p> : null}
            {!loading && !error && incomingCarQueue.length === 0 ? <p>No incoming cars in queue.</p> : null}

            {!loading && !error && incomingCarQueue.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Showing {displayedIncomingQueue.length} of {incomingCarQueue.length} incoming cars
                </p>
                {displayedIncomingQueue.map((booking, index) => {
                  const bookingId = booking.booking_id;
                  const stage = normalizeStage(booking.status);

                  return (
                    <div key={bookingId ?? `${booking.customer_name}-${index}`} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{booking.customer_name ?? "Guest"}</p>
                        <Badge variant="secondary">{formatTicket(bookingId, index)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">Plate: {extractVehiclePlate(booking)}</p>
                      {booking.parking_location ? (
                        <p className="text-sm font-semibold">Location: {booking.parking_location}</p>
                      ) : null}
                      {booking.key_holder ? (
                        <p className="text-sm text-muted-foreground">Keys with: {booking.key_holder}</p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">Bay: {booking.bay_name ?? (booking.bay_id ? (data?.bays ?? []).find((b) => b.Bay_id === booking.bay_id)?.Bay_name : undefined) ?? "Main"}</p>
                      <p className="text-sm text-muted-foreground">Stage: {stage}</p>
                      <p className="text-sm text-muted-foreground">ETA: {formatClock(booking.booking_date_time, timezone)}</p>
                    </div>
                  );
                })}
                {incomingCarQueue.length > 5 ? (
                  <Button type="button" variant="outline" onClick={() => { setShowAllIncoming((prev) => !prev); }}>
                    {showAllIncoming ? "Show Less" : `Show All (${incomingCarQueue.length})`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>


    </div>
  );
}

// useSearchParams (via useHighlightRow) requires a Suspense boundary
// (same pattern as the accounting and queue pages).
export default function ValetDashboardPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading…</div>}>
      <ValetDashboardPageInner />
    </Suspense>
  );
}
