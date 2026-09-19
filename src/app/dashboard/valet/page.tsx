"use client";

// Web copy of Flutter `valetModule` (modules.dart): one board with two
// sections — "Parking bays" (tappable occupancy cards → bay sheet) and
// "Vehicles on valet" (active vehicles only → detail sheet) — plus a floating
// "Check in vehicle" button. Every action POSTs and then refetches /valet-info;
// the server is the only authority on capacity and stage.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Car, ChevronRight, Clock, Key, MapPin, ParkingSquare, Plus, Timer, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { StatusChip, InfoChip } from "@/components/ui/status-chip";
import { MicroStat } from "@/components/ui/micro-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBox, SkeletonRows } from "@/components/ui/fork-skeleton";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { KvRow, useConfirm } from "@/components/outlets/sheet-parts";
import {
  AddBayDialog, AssignBayDialog, ChargeDialog, CheckInDialog, ConditionDialog, LocationDialog,
  type CheckInPayload,
} from "@/components/valet/valet-dialogs";
import {
  capped, isRequestStage, plateOf, stageOf, valetChipProps, valetLabel, valetNext,
  type ValetBay, type ValetBooking, type ValetInfo,
} from "@/components/valet/valet-model";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/context/RealtimeContext";
import { useToast } from "@/hooks/use-toast";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { requestBackend } from "@/lib/db";
import { formatTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import { cn } from "@/lib/utils";

type Dlg =
  | { kind: "checkin"; bayId?: string }
  | { kind: "assign"; id: string }
  | { kind: "location"; b: ValetBooking }
  | { kind: "condition"; b: ValetBooking }
  | { kind: "charge"; b: ValetBooking; tables: string[] }
  | { kind: "addBay" }
  | null;

const REALTIME_EVENTS = new Set([
  "valet:created", "valet:updated", "valet:bay_added", "valet:bay_updated", "valet:bay_deleted",
  "valet:bay_current_set", "booking:deleted", "booking:created", "booking:status_updated",
]);

// Downscale a photo (longest side ~1600px, JPEG) so the base64 upload stays small.
const fileToScaledDataUrl = (file: File, maxDim = 1600): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(new Error("Unable to read image")); };
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) { reject(new Error("Unable to read image")); return; }
      const img = new window.Image();
      img.onerror = () => { resolve(dataUrl); };
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) { resolve(dataUrl); return; }
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

function ValetBoard(): React.JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  const { confirm, confirmDialog } = useConfirm();
  const rid = user?.restaurantUsername ?? "";

  const call = useCallback(
    <T,>(path: string, method: "GET" | "POST", body?: unknown) =>
      requestBackend<T & { error?: string }>({
        path, method, body,
        restaurantId: rid,
        employeeId: user?.employeeId,
        outletId: user?.outlet_id,
      }),
    [rid, user?.employeeId, user?.outlet_id],
  );

  const q = useCachedFetch<ValetInfo>(
    `valet:${rid}:${user?.outlet_id ?? ""}`,
    useCallback(async () => {
      const r = await call<ValetInfo>("/valet-info", "GET");
      if (!r.ok) { throw new Error(r.data?.error || r.text || "Unable to load valet data."); }
      return { bays: r.data?.bays ?? [], bookings: r.data?.bookings ?? [] };
    }, [call]),
    { enabled: rid.length > 0 },
  );
  const bays = useMemo(() => q.data?.bays ?? [], [q.data]);
  // Only the live fleet — completed vehicles leave the board.
  const active = useMemo(() => (q.data?.bookings ?? []).filter((v) => v.active !== false), [q.data]);

  const { lastEvent } = useRealtime();
  const { refresh } = q;
  useEffect(() => {
    if (lastEvent && REALTIME_EVENTS.has(lastEvent.event)) { refresh(); }
  }, [lastEvent, refresh]);

  const highlight = useHighlightRow("highlightValet", active.length);

  const [dlg, setDlg] = useState<Dlg>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [bayId, setBayId] = useState<string | null>(null);
  const detail = detailId ? active.find((v) => v.booking_id === detailId) ?? null : null;
  const openBay = bayId ? bays.find((b) => String(b.Bay_id) === bayId) ?? null : null;

  /** Flutter `post`: POST, then reload; a failure is one terse message. */
  const post = async (path: string, body: unknown): Promise<boolean> => {
    try {
      const r = await call<Record<string, unknown>>(path, "POST", body);
      if (!r.ok) { throw new Error(r.data?.error || r.text || "Request failed."); }
      refresh();
      return true;
    } catch (e) {
      toast({ description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    }
  };

  /** Sheet actions step out of the sheet first (it can't refresh under them). */
  const fromSheet = (fn: () => void) => () => { setDetailId(null); setBayId(null); fn(); };

  const bayName = (v: ValetBooking): string =>
    v.bay_name || bays.find((b) => String(b.Bay_id) === String(v.bay_id ?? ""))?.Bay_name || "";

  /* ── Actions ──────────────────────────────────────────────────────── */

  const assignBay = (id: string): void => {
    if (bays.length === 0) { toast({ description: "Add a parking bay first." }); return; }
    setDlg({ kind: "assign", id });
  };

  const toggleKeys = (v: ValetBooking): void => {
    void post(`/valet/${encodeURIComponent(v.booking_id ?? "")}/keys`, { action: v.key_holder ? "handover" : "take" });
  };

  const startCharge = async (v: ValetBooking): Promise<void> => {
    let tables: string[] = [];
    try {
      const r = await call<{ tables?: { table_name?: string | number | null }[] }>("/valet/charge-targets", "GET");
      if (r.ok) { tables = (r.data?.tables ?? []).map((t) => String(t.table_name ?? "")).filter(Boolean); }
    } catch { /* treated as none */ }
    if (tables.length === 0) { toast({ description: "No occupied tables to charge right now." }); return; }
    setDlg({ kind: "charge", b: v, tables });
  };

  const scanPlate = async (file: File): Promise<string | null> => {
    try {
      const image = await fileToScaledDataUrl(file);
      const r = await call<{ plate?: string | number | null }>("/valet/scan-plate", "POST", { image });
      const plate = r.ok ? String(r.data?.plate ?? "").trim().toUpperCase() : "";
      if (plate) {
        toast({ description: `Detected "${plate}" — check it, then Check in.` });
        return plate;
      }
    } catch { /* fall through */ }
    toast({ description: "Could not read a plate — please type it in." });
    return null;
  };

  const deleteBay = async (b: ValetBay): Promise<void> => {
    const ok = await confirm({ title: "Delete bay", body: `Delete "${b.Bay_name}"?`, confirmLabel: "Delete", destructive: true });
    if (ok) { await post("/delete-valet-bay", { Bay_id: String(b.Bay_id) }); }
  };

  const advance = (v: ValetBooking): void => {
    const nx = valetNext(stageOf(v.status));
    if (nx) { void post("/update_valet_state", { booking_id: v.booking_id, state: nx.next }); }
  };

  /* ── Pieces ───────────────────────────────────────────────────────── */

  const stageChip = (v: ValetBooking): React.JSX.Element => {
    const st = stageOf(v.status);
    return <StatusChip key={st} dense className="shrink-0 animate-in fade-in-0" label={valetLabel(st)} {...valetChipProps(st)} />;
  };

  const plate = (v: ValetBooking, cls?: string): React.JSX.Element => (
    <span className={cn("truncate font-mono font-semibold tracking-[0.12em]", cls)}>{plateOf(v)}</span>
  );

  const opsActions = (v: ValetBooking): React.JSX.Element => {
    const id = v.booking_id ?? "";
    return (
      <>
        <Button size="sm" variant="outline" onClick={fromSheet(() => { assignBay(id); })}>Bay</Button>
        <Button size="sm" variant="outline" onClick={fromSheet(() => { setDlg({ kind: "location", b: v }); })}>Location</Button>
        <Button size="sm" variant="outline" onClick={fromSheet(() => { toggleKeys(v); })}>{v.key_holder ? "Hand over" : "Take keys"}</Button>
        <Button size="sm" variant="outline" onClick={fromSheet(() => { setDlg({ kind: "condition", b: v }); })}>Condition</Button>
        <Button size="sm" variant="outline" onClick={fromSheet(() => { void startCharge(v); })}>Charge</Button>
      </>
    );
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  if (q.loading) {
    return (
      <div className="grid gap-5">
        <SkeletonRows rows={1} title />
        <div className="flex flex-wrap gap-3.5">{[0, 1, 2].map((i) => <SkeletonBox key={i} width={210} height={120} />)}</div>
        <SkeletonRows rows={4} title />
      </div>
    );
  }
  if (q.error) {
    return <LoadErrorState whatFailed="Couldn't load valet." error={q.error} onRetry={q.retry} />;
  }

  return (
    <div className="relative grid gap-6 pb-24">
      {/* Parking bays */}
      <section className="grid gap-3">
        <SectionHeader
          title="Parking bays"
          count={bays.length}
          trailing={<Button size="sm" variant="outline" onClick={() => { setDlg({ kind: "addBay" }); }}><Plus className="mr-1 h-4 w-4" />Add bay</Button>}
        />
        {bays.length === 0 ? (
          <EmptyState
            icon={<ParkingSquare />}
            title="No parking bays yet"
            caption="Add a bay to start valet parking."
            action={<Button onClick={() => { setDlg({ kind: "addBay" }); }}><Plus className="mr-1 h-4 w-4" />Add parking bay</Button>}
          />
        ) : (
          <div className="flex flex-wrap gap-3.5">
            {bays.map((b) => {
              const cur = Number(b.current_capacity ?? 0);
              const tot = Number(b.total_capacity ?? 0);
              const ratio = tot > 0 ? Math.min(1, Math.max(0, cur / tot)) : 0;
              const here = active.filter((v) => String(v.bay_id ?? "") === String(b.Bay_id)).length;
              return (
                <ForkCard
                  key={String(b.Bay_id)}
                  chevron={false}
                  onClick={() => { setBayId(String(b.Bay_id)); }}
                  className="w-[210px] max-w-full px-4 pb-4 pt-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.Bay_name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      title="Delete bay"
                      aria-label="Delete bay"
                      onClick={(e) => { e.stopPropagation(); void deleteBay(b); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <MicroStat className="mt-1" value={`${cur} / ${tot}`} label="occupied" />
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-inset">
                    <div className="h-full rounded-full bg-accent-hi transition-all duration-slow" style={{ width: `${ratio * 100}%` }} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1">
                      {here === 0 ? "Empty — tap to check a car in" : `Tap to see the ${here} vehicle${here === 1 ? "" : "s"} here`}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-tertiary" />
                  </div>
                </ForkCard>
              );
            })}
          </div>
        )}
      </section>

      {/* Vehicles on valet */}
      <section className="grid gap-3">
        <SectionHeader title="Vehicles on valet" count={active.length} />
        {active.length === 0 ? (
          <EmptyState
            icon={<Car />}
            title="No vehicles on valet"
            caption="Checked-in vehicles appear here with their bay, keys and stage."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3.5 min-[720px]:grid-cols-2 min-[1120px]:grid-cols-3 min-[1500px]:grid-cols-4">
            {active.map((v, i) => {
              const st = stageOf(v.status);
              const nx = valetNext(st);
              const bay = bayName(v);
              const hp = highlight.rowProps(v.booking_id);
              return (
                <ForkCard
                  key={v.booking_id ?? i}
                  id={hp.id}
                  chevron={false}
                  onClick={() => { setDetailId(v.booking_id ?? null); }}
                  className={cn("flex flex-col gap-3", hp.className)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-accent-hi/40 bg-accent-hi/15 text-accent-hi">
                      <Car className="h-[18px] w-[18px]" />
                    </div>
                    {plate(v, "min-w-0 flex-1 text-[15px]")}
                    {stageChip(v)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {v.customer_name && <InfoChip icon={<User />} label={capped(v.customer_name)} />}
                    {bay && <InfoChip icon={<ParkingSquare />} label={capped(`Bay ${bay}`)} />}
                    {v.parking_location && <InfoChip icon={<MapPin />} label={capped(v.parking_location)} />}
                    {v.key_holder && <InfoChip icon={<Key />} label={capped(v.key_holder)} />}
                    {isRequestStage(st) && v.eta_minutes != null && <InfoChip icon={<Timer />} label={`ETA ${v.eta_minutes} min`} />}
                  </div>
                  {nx && (
                    <div>
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); advance(v); }}>{nx.label}</Button>
                    </div>
                  )}
                </ForkCard>
              );
            })}
          </div>
        )}
      </section>

      <CacheStalePill offline={q.offline} fromCache={q.fromCache} updatedAt={q.updatedAt} />

      {/* Floating check-in */}
      <Button
        size="lg"
        className="fixed bottom-6 right-6 z-40 rounded-full shadow-card-hover"
        onClick={() => { setDlg({ kind: "checkin" }); }}
      >
        <Car className="mr-2 h-5 w-5" />Check in vehicle
      </Button>

      {/* Vehicle detail */}
      <DrillSheet open={detail != null} onOpenChange={(o) => { if (!o) { setDetailId(null); } }} eyebrow="On valet" title={detail ? plateOf(detail) : ""}>
        {detail && (() => {
          const st = stageOf(detail.status);
          return (
            <div>
              <KvRow label="Stage" value={valetLabel(st)} />
              <KvRow label="Owner" value={detail.customer_name || "—"} />
              <KvRow label="Bay" value={bayName(detail) || "—"} />
              <KvRow label="Parked at" value={detail.parking_location || "—"} />
              <KvRow label="Keys" value={detail.key_holder ? `With ${detail.key_holder}` : "Not taken"} />
              <KvRow label="Checked in" value={formatTime(detail.booking_date_time ?? null, timezone)} />
              {detail.eta_minutes != null && <KvRow label="ETA quoted" value={`${detail.eta_minutes} min`} />}
              {detail.condition_notes && <p className="mt-3 text-sm italic text-muted-foreground">{detail.condition_notes}</p>}
              {isRequestStage(st) && (
                <div className="mt-4">
                  <div className="micro-label mb-2">QUOTE ETA</div>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 15].map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant="outline"
                        onClick={fromSheet(() => { void post(`/valet/${encodeURIComponent(detail.booking_id ?? "")}/ops`, { eta_minutes: m }); })}
                      >
                        {m} min
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">{opsActions(detail)}</div>
            </div>
          );
        })()}
      </DrillSheet>

      {/* Bay sheet */}
      <DrillSheet
        open={openBay != null}
        onOpenChange={(o) => { if (!o) { setBayId(null); } }}
        eyebrow="PARKING BAY"
        title={openBay?.Bay_name ?? ""}
      >
        {openBay && (() => {
          const parked = active.filter((v) => String(v.bay_id ?? "") === String(openBay.Bay_id));
          return (
            <div className="grid gap-3">
              <div>
                <StatusChip
                  label={`${openBay.current_capacity ?? 0} / ${openBay.total_capacity ?? 0} occupied`}
                  {...(parked.length === 0 ? { status: "success" as const } : { color: "hsl(var(--accent-hi))" })}
                />
              </div>
              {parked.length === 0 ? (
                <EmptyState
                  icon={<ParkingSquare />}
                  title="This bay is empty"
                  caption={`Nothing is parked in ${openBay.Bay_name} right now.`}
                  action={
                    <Button onClick={fromSheet(() => { setDlg({ kind: "checkin", bayId: String(openBay.Bay_id) }); })}>
                      <Car className="mr-1 h-4 w-4" />Check a vehicle in here
                    </Button>
                  }
                />
              ) : (
                parked.map((v, i) => {
                  const nx = valetNext(stageOf(v.status));
                  return (
                    <ForkCard key={v.booking_id ?? i} className="grid gap-2.5 p-4">
                      <div className="flex items-center gap-2">
                        {plate(v, "min-w-0 flex-1")}
                        {stageChip(v)}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {v.customer_name && <InfoChip icon={<User />} label={capped(v.customer_name)} />}
                        {v.booking_date_time && <InfoChip icon={<Clock />} label={`Since ${formatTime(v.booking_date_time, timezone)}`} />}
                        {v.parking_location && <InfoChip icon={<MapPin />} label={capped(v.parking_location)} />}
                        <InfoChip icon={<Key />} label={v.key_holder ? capped(`Keys with ${v.key_holder}`) : "Keys not taken"} />
                        {v.eta_minutes != null && <InfoChip icon={<Timer />} label={`ETA ${v.eta_minutes} min`} />}
                      </div>
                      {v.condition_notes && <p className="text-sm italic text-muted-foreground">{v.condition_notes}</p>}
                      <div className="flex flex-wrap gap-2">
                        {opsActions(v)}
                        {nx && <Button size="sm" onClick={fromSheet(() => { advance(v); })}>{nx.label}</Button>}
                      </div>
                    </ForkCard>
                  );
                })
              )}
            </div>
          );
        })()}
      </DrillSheet>

      {/* Dialogs */}
      {dlg?.kind === "checkin" && (
        <CheckInDialog
          bays={bays}
          initialBayId={dlg.bayId}
          onClose={() => { setDlg(null); }}
          onScan={scanPlate}
          onSubmit={(p: CheckInPayload) => { setDlg(null); void post("/create_valet_record", p); }}
        />
      )}
      {dlg?.kind === "assign" && (
        <AssignBayDialog
          bays={bays}
          onClose={() => { setDlg(null); }}
          onPick={(bid) => { const id = dlg.id; setDlg(null); void post("/update_valet_bay", { booking_id: id, bay_id: bid }); }}
        />
      )}
      {dlg?.kind === "location" && (
        <LocationDialog
          initial={dlg.b.parking_location ?? ""}
          onClose={() => { setDlg(null); }}
          onSave={(val) => {
            const id = dlg.b.booking_id ?? "";
            setDlg(null);
            void post(`/valet/${encodeURIComponent(id)}/ops`, { parking_location: val });
          }}
        />
      )}
      {dlg?.kind === "condition" && (
        <ConditionDialog
          initial={dlg.b.condition_notes ?? ""}
          onClose={() => { setDlg(null); }}
          onSave={(notes, photo) => {
            const id = dlg.b.booking_id ?? "";
            setDlg(null);
            void (async () => {
              const body: Record<string, unknown> = { condition_notes: notes };
              if (photo) {
                try {
                  const url = await fileToScaledDataUrl(photo);
                  body.condition_photo_base64 = url.slice(url.indexOf(",") + 1);
                  body.condition_photo_content_type = /^data:([^;,]+)/.exec(url)?.[1] ?? "image/jpeg";
                } catch { /* notes still save */ }
              }
              await post(`/valet/${encodeURIComponent(id)}/ops`, body);
            })();
          }}
        />
      )}
      {dlg?.kind === "charge" && (
        <ChargeDialog
          tables={dlg.tables}
          onClose={() => { setDlg(null); }}
          onCharge={(table, amount) => {
            const id = dlg.b.booking_id ?? "";
            setDlg(null);
            if (!table || amount == null || amount <= 0) {
              toast({ description: "Pick a table and a positive amount.", variant: "destructive" });
              return;
            }
            void post(`/valet/${encodeURIComponent(id)}/charge`, { table_name: table, amount });
          }}
        />
      )}
      {dlg?.kind === "addBay" && (
        <AddBayDialog
          onClose={() => { setDlg(null); }}
          onAdd={(name, capacity) => { setDlg(null); void post("/add-valet-bay", { Bay_name: name, total_capacity: capacity }); }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

// useSearchParams (via useHighlightRow) requires a Suspense boundary.
export default function ValetDashboardPage(): React.JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={4} title />}>
      <ValetBoard />
    </Suspense>
  );
}
