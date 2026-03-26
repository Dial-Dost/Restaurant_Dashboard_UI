"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Activity, ArrowRight, Clock, Package, Users } from "lucide-react";

type ValetTable = {
  table_name: string;
  capacity: number | null;
  booked: boolean;
  reserved?: boolean;
};

type ValetBooking = {
  booking_id?: string;
  customer_name?: string;
  table_name?: string | null;
  number_of_people?: number;
  booking_date_time?: string;
  status?: string;
  active?: boolean;
  notes?: string | null;
};

type ValetInfoResponse = {
  role: "admin" | "employee" | "valet";
  generated_at: string;
  tables: ValetTable[];
  bookings: ValetBooking[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_RECEPTION_API_URL ?? "http://localhost:3000";

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

  if (normalized === "vehicle added") return "Vehicle added";
  if (normalized === "parked") return "Parked";
  if (normalized === "request to bring car") return "Request to bring car (from customer)";
  if (normalized === "request to bring car (from customer)") return "Request to bring car (from customer)";
  if (normalized === "request accepted") return "Request accepted (from valet)";
  if (normalized === "request accepted (from valet)") return "Request accepted (from valet)";
  if (normalized === "car arrived at entrance") return "Car arrived at entrance";
  if (normalized === "customer took car") return "Customer took car";

  // Backward compatibility with older statuses.
  if (normalized === "retrieved") return "Customer took car";
  if (normalized === "arrived") return "Car arrived at entrance";
  if (normalized === "in_valet") return "Parked";

  return "Vehicle added";
}

function isInProgressStage(stage: ValetStage): boolean {
  return stage !== "Customer took car";
}

function isParkedLikeStage(stage: ValetStage): boolean {
  return (
    stage === "Parked" ||
    stage === "Request to bring car (from customer)" ||
    stage === "Request accepted (from valet)" ||
    stage === "Car arrived at entrance"
  );
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse errors and fall back to text.
  }

  try {
    const text = await response.text();
    if (text.trim().length > 0) {
      return text;
    }
  } catch {
    // Ignore text read errors.
  }

  return "Unknown server error.";
}

function formatTime(value?: string): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTicket(bookingId?: string, index?: number): string {
  if (bookingId && bookingId.length >= 6) {
    return `VLT-${bookingId.slice(-6).toUpperCase()}`;
  }

  const serial = (index ?? 0) + 1;
  return `VLT-${serial.toString().padStart(4, "0")}`;
}

function extractVehiclePlate(booking: ValetBooking): string {
  const notes = booking.notes ?? "";
  const match = notes.match(/vehicle\s*plate\s*:\s*(.+)$/i);
  if (!match || !match[1]) {
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

export default function ValetDashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ValetInfoResponse | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [draftTableByBookingId, setDraftTableByBookingId] = useState<Record<string, string>>({});
  const [draftStageByBookingId, setDraftStageByBookingId] = useState<Record<string, ValetStage>>({});
  const [spaceAvailableDisplay, setSpaceAvailableDisplay] = useState(0);
  const [maxBaysDisplay, setMaxBaysDisplay] = useState(0);
  const [spaceInitializedForRestaurant, setSpaceInitializedForRestaurant] = useState<string | null>(null);
  const [managedBays, setManagedBays] = useState<string[]>(["Main"]);
  const [baysInitializedForRestaurant, setBaysInitializedForRestaurant] = useState<string | null>(null);
  const [newBayName, setNewBayName] = useState("");
  const [recordSearchQuery, setRecordSearchQuery] = useState("");
  const [recordStageFilter, setRecordStageFilter] = useState<"all" | ValetStage>("all");
  const [showAllParked, setShowAllParked] = useState(false);
  const [showAllIncoming, setShowAllIncoming] = useState(false);
  const [newGuestName, setNewGuestName] = useState("");
  const [newVehiclePlate, setNewVehiclePlate] = useState("");
  const [newDateTime, setNewDateTime] = useState("");
  const [newStage, setNewStage] = useState<ValetStage>("Vehicle added");
  const [creating, setCreating] = useState(false);

  const canViewValet = user?.role === "valet" || user?.role === "admin";

  const fetchValetInfo = async () => {
    if (!user?.restaurantId || !user.employeeId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/valet-info`, {
        headers: {
          "X-Restaurant-Id": user.restaurantId,
          "X-Employee-Id": user.employeeId,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Unable to load valet dashboard data.");
      }

      const payload = (await response.json()) as ValetInfoResponse;
      setData(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load valet dashboard data.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchValetInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.restaurantId, user?.employeeId]);

  const patchBookingStatus = async (bookingId: string, status: ValetStage) => {
    if (!user?.restaurantId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/booking/${bookingId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Restaurant-Id": user.restaurantId,
        "X-Employee-Id": user.employeeId,
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message || "Failed to update stage.");
    }
  };

  const patchBookingTable = async (bookingId: string, tableName: string | null) => {
    if (!user?.restaurantId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/booking/${bookingId}/table`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Restaurant-Id": user.restaurantId,
        "X-Employee-Id": user.employeeId,
      },
      body: JSON.stringify({ table_name: tableName }),
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message || "Failed to update bay.");
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
      overrides?.tableName ?? draftTableByBookingId[bookingId] ?? (currentBooking.table_name ?? "");
    const normalizedTable =
      selectedTable === "" || selectedTable === "unassigned" ? null : selectedTable;

    try {
      setUpdatingId(bookingId);
      await patchBookingStatus(bookingId, stage);
      await patchBookingTable(bookingId, normalizedTable);

      setData((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          bookings: previous.bookings.map((booking) =>
            booking.booking_id === bookingId
              ? {
                  ...booking,
                  status: stage,
                  table_name: normalizedTable,
                  active: isParkedLikeStage(stage),
                }
              : booking,
          ),
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

  const createValetRecord = async () => {
    if (!user?.restaurantId) {
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
      const response = await fetch(`${API_BASE_URL}/add-booking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Restaurant-Id": user.restaurantId,
          "X-Employee-Id": user.employeeId,
        },
        body: JSON.stringify({
          restaurantId: user.restaurantId,
          customer: {
            name: newGuestName.trim() || "Guest",
            number: `+91${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
          },
          booking: {
            table_name: null,
            date: date.toISOString(),
            duration: 120,
            number_of_people: 1,
            source: "Valet",
            status: newStage,
            from: "valet_dashboard",
            notes: `Vehicle Plate: ${newVehiclePlate.trim().toUpperCase()}`,
          },
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        throw new Error(message || "Unable to create valet record.");
      }

      const created = (await response.json()) as { booking_id?: string; table_name?: string | null };
      const createdBookingId = typeof created.booking_id === "string" ? created.booking_id : undefined;
      const createdTableName =
        typeof created.table_name === "string" && created.table_name.trim().length > 0
          ? created.table_name
          : null;

      setData((previous) => {
        const optimisticBooking: ValetBooking = {
          booking_id: createdBookingId,
          customer_name: newGuestName.trim() || "Guest",
          table_name: createdTableName,
          booking_date_time: date.toISOString(),
          number_of_people: 1,
          status: newStage,
          notes: `Vehicle Plate: ${newVehiclePlate.trim().toUpperCase()}`,
          active: true,
        };

        if (!previous) {
          return {
            role: user.role,
            generated_at: new Date().toISOString(),
            tables: [],
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

      toast({ title: "Valet Record Added", description: `${newGuestName.trim() || "Guest"} was added.` });
      setNewGuestName("");
      setNewVehiclePlate("");
      setNewDateTime("");
      setNewStage("Vehicle added");
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
    const tables = data?.tables ?? [];

    const parkedNow = inProgressBookings.filter((booking) => isParkedLikeStage(normalizeStage(booking.status))).length;
    const yetToPark = Math.max(inProgressBookings.length - parkedNow, 0);
    const activeCars = inProgressBookings.length;
    const occupiedBays = Math.min(parkedNow, tables.length);
    const spaceAvailable = Math.max(tables.length - occupiedBays, 0);

    return {
      activeCars,
      parkedNow,
      yetToPark,
      spaceAvailable,
      totalBays: tables.length,
    };
  }, [data, inProgressBookings]);

  const activeCarQueue = useMemo(
    () => inProgressBookings.filter((booking) => isParkedLikeStage(normalizeStage(booking.status))),
    [inProgressBookings],
  );

  const incomingCarQueue = useMemo(
    () => inProgressBookings.filter((booking) => !isParkedLikeStage(normalizeStage(booking.status))),
    [inProgressBookings],
  );

  const editableBookings = useMemo(() => data?.bookings ?? [], [data]);

  const displayedParkedQueue = useMemo(
    () => (showAllParked ? activeCarQueue : activeCarQueue.slice(0, 5)),
    [activeCarQueue, showAllParked],
  );

  const displayedIncomingQueue = useMemo(
    () => (showAllIncoming ? incomingCarQueue : incomingCarQueue.slice(0, 5)),
    [incomingCarQueue, showAllIncoming],
  );

  const filteredEditableBookings = useMemo(() => {
    const query = recordSearchQuery.trim().toLowerCase();
    return editableBookings.filter((booking, index) => {
      const bookingId = booking.booking_id;
      const stage = normalizeStage(booking.status);
      if (recordStageFilter !== "all" && stage !== recordStageFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        booking.customer_name ?? "",
        booking.table_name ?? "",
        extractVehiclePlate(booking),
        stage,
        formatTicket(bookingId, index),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [editableBookings, recordSearchQuery, recordStageFilter]);

  const bayOptions = useMemo(() => {
    const normalized = managedBays
      .map((bay) => bay.trim())
      .filter((bay) => bay.length > 0);
    const withMain = normalized.includes("Main") ? normalized : ["Main", ...normalized];
    return Array.from(new Set(withMain));
  }, [managedBays]);

  useEffect(() => {
    if (!user?.restaurantId) {
      return;
    }

    if (baysInitializedForRestaurant === user.restaurantId) {
      return;
    }

    const bayKey = `valet-bays:${user.restaurantId}`;
    const savedBaysRaw = window.localStorage.getItem(bayKey);
    const serverBays = (data?.tables ?? []).map((table) => table.table_name).filter((name) => Boolean(name?.trim()));
    const fallback = Array.from(new Set(["Main", ...serverBays]));

    if (!savedBaysRaw) {
      setManagedBays(fallback);
      window.localStorage.setItem(bayKey, JSON.stringify(fallback));
      setBaysInitializedForRestaurant(user.restaurantId);
      return;
    }

    try {
      const parsed = JSON.parse(savedBaysRaw) as unknown;
      if (Array.isArray(parsed)) {
        const cleaned = Array.from(
          new Set(
            parsed
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .filter((value) => value.length > 0),
          ),
        );
        const ensuredMain = cleaned.includes("Main") ? cleaned : ["Main", ...cleaned];
        setManagedBays(ensuredMain);
      } else {
        setManagedBays(fallback);
      }
    } catch {
      setManagedBays(fallback);
    }

    setBaysInitializedForRestaurant(user.restaurantId);
  }, [user?.restaurantId, data?.tables, baysInitializedForRestaurant]);

  useEffect(() => {
    if (!user?.restaurantId) {
      return;
    }

    if (baysInitializedForRestaurant !== user.restaurantId) {
      return;
    }

    const bayKey = `valet-bays:${user.restaurantId}`;
    window.localStorage.setItem(bayKey, JSON.stringify(bayOptions));
  }, [user?.restaurantId, baysInitializedForRestaurant, bayOptions]);

  const addBay = () => {
    const normalized = newBayName.trim();
    if (!normalized) {
      return;
    }
    if (bayOptions.includes(normalized)) {
      toast({ title: "Bay exists", description: `${normalized} is already added.` });
      return;
    }
    setManagedBays((prev) => [...prev, normalized]);
    setNewBayName("");
  };

  const removeBay = (bayName: string) => {
    if (bayName === "Main") {
      toast({ title: "Main bay required", description: "Main cannot be removed.", variant: "destructive" });
      return;
    }
    setManagedBays((prev) => prev.filter((bay) => bay !== bayName));
  };

  useEffect(() => {
    if (!user?.restaurantId) {
      return;
    }

    if (spaceInitializedForRestaurant === user.restaurantId) {
      return;
    }

    const spaceKey = `valet-space-available:${user.restaurantId}`;
    const maxKey = `valet-max-bays:${user.restaurantId}`;

    const savedSpaceValue = window.localStorage.getItem(spaceKey);
    const savedMaxValue = window.localStorage.getItem(maxKey);

    const parsedMax = savedMaxValue ? Number.parseInt(savedMaxValue, 10) : Number.NaN;
    const initialMax = Number.isNaN(parsedMax) ? Math.max(0, stats.totalBays) : Math.max(0, parsedMax);

    const parsedSpace = savedSpaceValue ? Number.parseInt(savedSpaceValue, 10) : Number.NaN;
    const initialSpace = Number.isNaN(parsedSpace)
      ? Math.max(0, stats.spaceAvailable)
      : Math.max(0, parsedSpace);

    setMaxBaysDisplay(initialMax);
    setSpaceAvailableDisplay(initialSpace);

    window.localStorage.setItem(maxKey, String(initialMax));
    window.localStorage.setItem(spaceKey, String(initialSpace));
    setSpaceInitializedForRestaurant(user.restaurantId);
  }, [user?.restaurantId, stats.spaceAvailable, stats.totalBays, spaceInitializedForRestaurant]);

  useEffect(() => {
    if (!user?.restaurantId) {
      return;
    }

    if (spaceInitializedForRestaurant !== user.restaurantId) {
      return;
    }

    const spaceKey = `valet-space-available:${user.restaurantId}`;
    const maxKey = `valet-max-bays:${user.restaurantId}`;

    window.localStorage.setItem(spaceKey, String(Math.max(0, spaceAvailableDisplay)));
    window.localStorage.setItem(maxKey, String(Math.max(0, maxBaysDisplay)));
  }, [user?.restaurantId, spaceAvailableDisplay, maxBaysDisplay, spaceInitializedForRestaurant]);

  if (user?.role && !canViewValet) {
    return (
      <div className="p-4">
        <p>You do not have permission to view this page.</p>
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
            <ArrowRight className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Cars</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeCars}</div>
            <p className="text-xs text-muted-foreground">Cars currently in valet workflow</p>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Space Available</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{spaceAvailableDisplay}</div>
            <p className="text-xs text-muted-foreground">Out of {maxBaysDisplay} total bays</p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSpaceAvailableDisplay((prev) => Math.max(0, prev - 1))}
              >
                -
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSpaceAvailableDisplay((prev) => prev + 1)}
              >
                +
              </Button>
            </div>
            <div className="mt-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">Max Bays</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="text-base font-semibold">{maxBaysDisplay}</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMaxBaysDisplay((prev) => Math.max(0, prev - 1))}
                >
                  -
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMaxBaysDisplay((prev) => prev + 1)}
                >
                  +
                </Button>
              </div>
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
                onChange={(e) => setNewBayName(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" onClick={addBay}>Add Bay</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {bayOptions.map((bay) => (
              <div key={bay} className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                <span>{bay}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  disabled={bay === "Main"}
                  onClick={() => removeBay(bay)}
                >
                  x
                </Button>
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
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="valet-guest-name">Guest Name</Label>
              <Input
                id="valet-guest-name"
                value={newGuestName}
                onChange={(e) => setNewGuestName(e.target.value)}
                placeholder="Customer name (optional)"
              />
            </div>
            <div>
              <Label htmlFor="valet-plate">Vehicle Number Plate</Label>
              <Input
                id="valet-plate"
                value={newVehiclePlate}
                onChange={(e) => setNewVehiclePlate(e.target.value)}
                placeholder="KA01AB1234"
              />
            </div>
            <div>
              <Label htmlFor="valet-datetime">Date & Time</Label>
              <Input
                id="valet-datetime"
                type="datetime-local"
                value={newDateTime}
                onChange={(e) => setNewDateTime(e.target.value)}
              />
            </div>
            <div>
              <Label>Initial Stage</Label>
              <Select value={newStage} onValueChange={(v) => setNewStage(v as ValetStage)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {VALET_STAGES.map((stageOption) => (
                    <SelectItem key={stageOption} value={stageOption}>{stageOption}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          <div className="mb-4 grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <div>
              <Label htmlFor="record-search">Search records</Label>
              <Input
                id="record-search"
                placeholder="Search by name, ticket, plate, stage or bay"
                value={recordSearchQuery}
                onChange={(e) => setRecordSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <Label>Filter stage</Label>
              <Select value={recordStageFilter} onValueChange={(value) => setRecordStageFilter(value as "all" | ValetStage)}>
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
          </div>

          {loading ? <p>Loading valet data...</p> : null}
          {!loading && error ? <p className="text-destructive">{error}</p> : null}
          {!loading && !error && filteredEditableBookings.length === 0 ? <p>No matching valet records found.</p> : null}

          {!loading && !error && filteredEditableBookings.length > 0 ? (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
              {filteredEditableBookings.map((booking, index) => {
                const bookingId = booking.booking_id;
                const stage = normalizeStage(booking.status);
                const stageValue = bookingId ? (draftStageByBookingId[bookingId] ?? stage) : stage;
                const tableValue = bookingId
                  ? (draftTableByBookingId[bookingId] ?? (booking.table_name || "unassigned"))
                  : (booking.table_name || "unassigned");

                return (
                  <div key={bookingId ?? `${booking.customer_name}-${index}`} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium">
                        {booking.customer_name ?? "Guest"} - {formatTicket(bookingId, index)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatTime(booking.booking_date_time)}</p>
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
                        onClick={async () => {
                          if (!bookingId) return;
                          const next = moveStage(stageValue, -1);
                          setDraftStageByBookingId((prev) => ({ ...prev, [bookingId]: next }));
                          await handleUpdate(bookingId, { stage: next });
                        }}
                      >
                        - Stage
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!bookingId || updatingId === bookingId || getStageIndex(stageValue) === VALET_STAGES.length - 1}
                        onClick={async () => {
                          if (!bookingId) return;
                          const next = moveStage(stageValue, 1);
                          setDraftStageByBookingId((prev) => ({ ...prev, [bookingId]: next }));
                          await handleUpdate(bookingId, { stage: next });
                        }}
                      >
                        + Stage
                      </Button>
                      <Button
                        type="button"
                        disabled={!bookingId || updatingId === bookingId}
                        onClick={() => handleUpdate(bookingId)}
                      >
                        Save Changes
                      </Button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_auto]">
                      <Select
                        value={stageValue}
                        onValueChange={(value) => {
                          if (!bookingId) return;
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
                          if (!bookingId) return;
                          setDraftTableByBookingId((prev) => ({ ...prev, [bookingId]: value }));
                        }}
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

                      <Button disabled={!bookingId || updatingId === bookingId} onClick={() => handleUpdate(bookingId)}>
                        Save
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Currently Parked Cars</CardTitle>
            <CardDescription>Cars in stages 2-5.</CardDescription>
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
                      <p className="text-sm text-muted-foreground">Bay: {booking.table_name || "Main"}</p>
                      <p className="text-sm text-muted-foreground">Stage: {stage}</p>
                      <p className="text-sm text-muted-foreground">Time: {formatTime(booking.booking_date_time)}</p>
                    </div>
                  );
                })}
                {activeCarQueue.length > 5 ? (
                  <Button type="button" variant="outline" onClick={() => setShowAllParked((prev) => !prev)}>
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
                      <p className="text-sm text-muted-foreground">Bay: {booking.table_name || "Main"}</p>
                      <p className="text-sm text-muted-foreground">Stage: {stage}</p>
                      <p className="text-sm text-muted-foreground">ETA: {formatTime(booking.booking_date_time)}</p>
                    </div>
                  );
                })}
                {incomingCarQueue.length > 5 ? (
                  <Button type="button" variant="outline" onClick={() => setShowAllIncoming((prev) => !prev)}>
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
