// Valet board model — the web copy of the pure helpers around Flutter
// `valetModule` (modules.dart): `_valetNext`, `valetLabel`, `valetColor`,
// `_valetChip`'s cap. The raw backend stage string drives every REST call;
// the short label is display only.

import type { StatusChipStatus } from "@/components/ui/status-chip";

export interface ValetBay {
  Bay_id?: string | number;
  Bay_name: string;
  current_capacity?: number | string;
  total_capacity?: number | string;
}

export interface ValetBooking {
  booking_id?: string;
  customer_name?: string;
  bay_name?: string | null;
  bay_id?: string | number | null;
  booking_date_time?: string;
  status?: string;
  active?: boolean;
  number_plate?: string | number | null;
  notes?: string | number | null;
  parking_location?: string | null;
  key_holder?: string | null;
  condition_notes?: string | null;
  condition_photo_url?: string | null;
  eta_minutes?: number | null;
}

export interface ValetInfo {
  bays: ValetBay[];
  bookings: ValetBooking[];
}

/** Canonical stage string (older backends used short aliases). */
export function stageOf(status?: string): string {
  const n = (status ?? "").trim().toLowerCase();
  switch (n) {
    case "parked":
    case "in_valet":
      return "Parked";
    case "request to bring car":
    case "request to bring car (from customer)":
      return "Request to bring car (from customer)";
    case "request accepted":
    case "request accepted (from valet)":
      return "Request accepted (from valet)";
    case "car arrived at entrance":
    case "arrived":
      return "Car arrived at entrance";
    case "customer took car":
    case "retrieved":
      return "Customer took car";
    default:
      return "Vehicle added";
  }
}

/** `_valetNext`: the one forward action for a stage (state = 1-based code). */
export function valetNext(stage: string): { next: number; label: string } | null {
  switch (stage) {
    case "Vehicle added": return { next: 2, label: "Mark parked" };
    case "Parked": return { next: 3, label: "Customer wants car" };
    case "Request to bring car (from customer)": return { next: 4, label: "Accept request" };
    case "Request accepted (from valet)": return { next: 5, label: "Car at entrance" };
    case "Car arrived at entrance": return { next: 6, label: "Customer took car" };
    default: return null;
  }
}

export function valetLabel(stage: string): string {
  switch (stage) {
    case "Vehicle added": return "Checked in";
    case "Request to bring car (from customer)": return "Car requested";
    case "Request accepted (from valet)": return "Request accepted";
    case "Car arrived at entrance": return "At entrance";
    case "Customer took car": return "Handed over";
    default: return stage;
  }
}

/** `valetColor` as StatusChip props — always paired with the label. */
export function valetChipProps(stage: string): { status?: StatusChipStatus; color?: string } {
  const l = stage.toLowerCase();
  if (l === "parked") { return { status: "success" }; }
  if (l.includes("request")) { return { status: "warning" }; }
  if (l.includes("entrance")) { return { color: "hsl(var(--accent-hi))" }; }
  if (l.includes("took")) { return { status: "neutral" }; }
  return { status: "info" };
}

export const isRequestStage = (stage: string): boolean => stage.toLowerCase().includes("request");

/** Plate, with the legacy "Vehicle plate: X" notes fallback; `Vehicle` when absent. */
export function plateOf(b: ValetBooking): string {
  const p = String(b.number_plate ?? "").trim();
  if (p) { return p; }
  const m = /vehicle\s*plate\s*:\s*(.+)$/i.exec(String(b.notes ?? ""));
  return m?.[1]?.trim() || "Vehicle";
}

/** `_capped`: a glanceable chip value; the full one lives on the sheet. */
export const capped = (s: string, max = 26): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
