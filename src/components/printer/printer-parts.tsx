"use client";

// Printer module pieces — the server-side view of Flutter `printerModule`
// (modules.dart ~30981–31556): connection status, the devices that print,
// the outlet's printers (destinations) with health, and test-slip results.

import { useState } from "react";
import type { JSX } from "react";
import { Info, Laptop, Loader2, Network, Plus, Printer, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { ForkCard } from "@/components/ui/fork-card";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoChip, StatusChip, type StatusChipStatus } from "@/components/ui/status-chip";
import { formatAgo } from "@/hooks/use-cached-fetch";
import {
  roleLabel,
  type DestinationHealth,
  type DestinationHealthStatus,
  type PrintDestination,
  type PrintDevice,
  type PrintHealth,
  type TestSlipResponse,
} from "@/lib/api/printer";

const agoOf = (iso: string | null): string => {
  if (!iso) {return "never";}
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatAgo(t) : "never";
};

/* ── Connection ─────────────────────────────────────────────────────── */

export function ConnectionCard({
  devices,
  presence,
  health,
  onTestAll,
  testing,
}: {
  devices: PrintDevice[];
  presence: "ok" | "unknown";
  health: PrintHealth | null;
  onTestAll: () => void;
  testing: boolean;
}): JSX.Element {
  const live = devices.filter((d) => !d.retired_at);
  const online = live.filter((d) => d.online === true).length;
  const chip: { status: StatusChipStatus; label: string } =
    presence === "unknown"
      ? { status: "neutral", label: "Unknown" }
      : online > 0
        ? { status: "success", label: "Listening" }
        : { status: "danger", label: "Offline" };
  const legacy = health?.legacy_agents;

  return (
    <ForkCard>
      <div className="flex flex-wrap items-center gap-3">
        <Printer className="size-5 shrink-0 text-accent-hi" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Printing in this outlet</div>
          <div className="text-xs text-muted-foreground">
            {presence === "unknown"
              ? "The server couldn't read which devices are connected right now — this is unknown, not offline."
              : live.length === 0
                ? "No till, phone or print agent has registered for printing here yet."
                : `${online} of ${live.length} printing device${live.length === 1 ? "" : "s"} connected.`}
          </div>
        </div>
        <StatusChip status={chip.status} label={chip.label} animated={chip.status === "success"} />
        <Button variant="outline" size="sm" onClick={onTestAll} disabled={testing}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
          Print test slip
        </Button>
      </div>
      <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          A browser can&apos;t reach a printer itself — the tills, phones and print agents running the app do the
          printing. Their own printers, print queue and activity log live on each device; this page sets the
          outlet&apos;s rules and shows whether each printer can be served.
          {legacy != null && legacy > 0 && ` Up to ${legacy} older client${legacy === 1 ? "" : "s"} still print every job.`}
        </span>
      </div>
    </ForkCard>
  );
}

/* ── Devices ────────────────────────────────────────────────────────── */

const deviceChip = (d: PrintDevice): { status: StatusChipStatus; label: string } =>
  d.retired_at
    ? { status: "neutral", label: "Retired" }
    : d.online == null
      ? { status: "neutral", label: "Unknown" }
      : d.online
        ? { status: "success", label: "Online" }
        : { status: "danger", label: "Offline" };

export function DevicesSection({ devices }: { devices: PrintDevice[] }): JSX.Element {
  const [open, setOpen] = useState<PrintDevice | null>(null);
  return (
    <section>
      <SectionHeader title="Printing devices" count={devices.length} className="mb-1.5" />
      <p className="mb-3 text-xs text-muted-foreground">
        Each till, phone or print agent that has signed in to print for this outlet.
      </p>
      {devices.length === 0 ? (
        <ForkCard>
          <p className="text-xs text-muted-foreground">
            None yet. Open Printer on a till or phone running the app and it registers itself here.
          </p>
        </ForkCard>
      ) : (
        <div className="grid gap-3 min-[760px]:grid-cols-2">
          {devices.map((d) => {
            const chip = deviceChip(d);
            return (
              <ForkCard key={d.id} onClick={() => { setOpen(d); }}>
                <div className="flex items-center gap-3 pr-4">
                  <Laptop className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.label || d.device_key}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[d.platform, `seen ${agoOf(d.last_seen_at)}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <StatusChip status={chip.status} label={chip.label} dense />
                </div>
              </ForkCard>
            );
          })}
        </div>
      )}
      <DrillSheet
        open={open != null}
        onOpenChange={(o) => { if (!o) { setOpen(null); } }}
        eyebrow="Printing device"
        title={open?.label || open?.device_key || "Device"}
      >
        {open && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="micro-label self-center">Status</dt>
            <dd>
              <StatusChip {...deviceChip(open)} dense />
            </dd>
            <dt className="micro-label self-center">Platform</dt>
            <dd>{open.platform || "—"}</dd>
            <dt className="micro-label self-center">App version</dt>
            <dd>{open.agent_version || "—"}</dd>
            <dt className="micro-label self-center">Default printer</dt>
            <dd className="break-all">{open.default_target || "—"}</dd>
            <dt className="micro-label self-center">Last seen</dt>
            <dd>{open.last_seen_at ? new Date(open.last_seen_at).toLocaleString() : "Never"}</dd>
            <dt className="micro-label self-center">Device key</dt>
            <dd className="break-all font-mono text-xs">{open.device_key}</dd>
          </dl>
        )}
      </DrillSheet>
    </section>
  );
}

/* ── Printers (destinations) ────────────────────────────────────────── */

const HEALTH: Record<DestinationHealthStatus, { status: StatusChipStatus; label: string; caption: string }> = {
  ok: { status: "success", label: "Ready", caption: "A connected device is serving this printer." },
  degraded: {
    status: "warning",
    label: "Degraded",
    caption: "Being served, but some of its devices are retired or switched off.",
  },
  offline: {
    status: "danger",
    label: "Offline",
    caption: "Nothing online can serve it — its jobs are printing on every printer in the outlet right now.",
  },
  unbound: {
    status: "warning",
    label: "Not set up",
    caption: "No device has been given this printer yet. Pick it on a till or phone under Printer.",
  },
  unknown: { status: "neutral", label: "Unknown", caption: "The server couldn't read which devices are connected." },
};

const healthChip = (s: string): (typeof HEALTH)[DestinationHealthStatus] =>
  (HEALTH as Partial<Record<string, (typeof HEALTH)[DestinationHealthStatus]>>)[s] ?? HEALTH.unknown;

export function DestinationsSection({
  destinations,
  health,
  stations,
  onSave,
  onDelete,
}: {
  destinations: PrintDestination[];
  health: PrintHealth | null;
  stations: string[];
  onSave: (input: { id?: string; name: string; active?: boolean }) => Promise<void>;
  onDelete: (d: PrintDestination) => Promise<void>;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PrintDestination | null>(null);
  const [drill, setDrill] = useState<PrintDestination | null>(null);

  const healthOf = (id: string): DestinationHealth | undefined => health?.destinations.find((h) => h.id === id);

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const drillHealth = drill ? healthOf(drill.id) : undefined;

  return (
    <section>
      <SectionHeader
        title="Printers"
        count={destinations.length}
        className="mb-1.5"
        trailing={
          <Button variant="ghost" size="sm" onClick={() => { setAdding(true); }}>
            <Plus className="size-4" /> Add
          </Button>
        }
      />
      <p className="mb-3 text-xs text-muted-foreground">
        Name each printer once (Till, Kitchen, Bar). Each device then picks which of its printers is which, and the
        rules above send every job to the right one.
      </p>
      {destinations.length === 0 ? (
        <ForkCard>
          <EmptyState
            icon={<Network />}
            title="None added yet"
            caption="Until a printer is added and given a rule, every device prints every job, as before."
          />
        </ForkCard>
      ) : (
        <div className="grid gap-3 min-[760px]:grid-cols-2">
          {destinations.map((d) => {
            const h = healthOf(d.id);
            const chip = !d.active
              ? { status: "neutral" as StatusChipStatus, label: "Switched off" }
              : h
                ? healthChip(h.status)
                : null;
            return (
              <ForkCard key={d.id} onClick={() => { setDrill(d); }} className={d.active ? undefined : "opacity-70"}>
                <div className="flex items-center gap-3 pr-4">
                  <Network className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {h && h.roles.length > 0
                        ? h.roles.map((r) => roleLabel(r, stations)).join(", ")
                        : "No jobs routed here"}
                    </div>
                  </div>
                  {chip && <StatusChip status={chip.status} label={chip.label} dense />}
                </div>
              </ForkCard>
            );
          })}
        </div>
      )}

      {/* Drill: health detail + switch off / delete */}
      <DrillSheet
        open={drill != null}
        onOpenChange={(o) => { if (!o) { setDrill(null); } }}
        eyebrow="Printer"
        title={drill?.name ?? ""}
        description={
          drill && !drill.active
            ? "Switched off — rules pointing here are ignored and those jobs print everywhere."
            : drillHealth
              ? healthChip(drillHealth.status).caption
              : undefined
        }
      >
        {drill && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="micro-label mb-1.5">Prints</div>
              <div className="flex flex-wrap gap-1.5">
                {drillHealth && drillHealth.roles.length > 0 ? (
                  drillHealth.roles.map((r) => <InfoChip key={r} label={roleLabel(r, stations)} />)
                ) : (
                  <span className="text-xs text-muted-foreground">No jobs routed here.</span>
                )}
              </div>
            </div>
            <div>
              <div className="micro-label mb-1.5">Devices</div>
              {drillHealth && drillHealth.devices.length > 0 ? (
                <ul className="flex flex-col divide-y divide-divider text-sm">
                  {drillHealth.devices.map((dv) => (
                    <li key={dv.device_id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate">
                        {dv.label}
                        {dv.target && <span className="ml-1 text-xs text-muted-foreground">→ {dv.target}</span>}
                      </span>
                      <StatusChip
                        dense
                        {...(dv.retired || !dv.active
                          ? { status: "neutral" as const, label: dv.retired ? "Retired" : "Off" }
                          : dv.serving == null
                            ? { status: "neutral" as const, label: "Unknown" }
                            : dv.serving
                              ? { status: "success" as const, label: "Serving" }
                              : { status: "danger" as const, label: "Offline" })}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-muted-foreground">No device has been given this printer yet.</span>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy != null}
                onClick={() =>
                  void run(`toggle:${drill.id}`, async () => {
                    await onSave({ id: drill.id, name: drill.name, active: !drill.active });
                    setDrill(null);
                  })
                }
              >
                {busy === `toggle:${drill.id}` && <Loader2 className="size-4 animate-spin" />}
                {drill.active ? "Switch off" : "Switch on"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={busy != null}
                onClick={() => { setConfirmDelete(drill); }}
              >
                <Trash2 className="size-4" /> Remove
              </Button>
            </div>
          </div>
        )}
      </DrillSheet>

      {/* Add */}
      <Dialog
        open={adding}
        onOpenChange={(o) => {
          if (busy === "add") {return;}
          setAdding(o);
          if (!o) {setName("");}
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a printer</DialogTitle>
            <DialogDescription>
              A name for the place it prints — each device then says which of its printers this is.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Kitchen"
            maxLength={80}
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                void run("add", async () => {
                  await onSave({ name: name.trim() });
                  setAdding(false);
                  setName("");
                });
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAdding(false); }} disabled={busy === "add"}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || busy === "add"}
              onClick={() =>
                void run("add", async () => {
                  await onSave({ name: name.trim() });
                  setAdding(false);
                  setName("");
                })
              }
            >
              {busy === "add" && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete != null} onOpenChange={(o) => { if (!o && busy == null) { setConfirmDelete(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its rules and device links go with it, and every job that went here prints on every printer in the
              outlet instead. To stop it for now, Switch off keeps the setup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy != null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy != null}
              onClick={(e) => {
                e.preventDefault();
                const target = confirmDelete;
                if (!target) {return;}
                void run(`delete:${target.id}`, async () => {
                  await onDelete(target);
                  setConfirmDelete(null);
                  setDrill(null);
                });
              }}
            >
              {busy?.startsWith("delete:") && <Loader2 className="size-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ── Test-slip results ──────────────────────────────────────────────── */

export function TestResultsSheet({
  result,
  stations,
  onClose,
}: {
  result: TestSlipResponse | null;
  stations: string[];
  onClose: () => void;
}): JSX.Element {
  return (
    <DrillSheet
      open={result != null}
      onOpenChange={(o) => { if (!o) { onClose(); } }}
      eyebrow="Test slip"
      title="Where the test slips went"
      description={
        result?.replayMinutes != null
          ? `A slip no device printed waits ${result.replayMinutes} min for a device that connects late — check the roll if nothing came out: a printer that is out of paper accepts the job in silence.`
          : "A test slip proves the route, not the paper — check the roll if nothing came out."
      }
    >
      {result && (
        <ul className="flex flex-col divide-y divide-divider text-sm">
          {result.results.map((r) => (
            <li key={r.role} className="flex flex-col gap-0.5 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{roleLabel(r.role, stations)}</span>
                <StatusChip
                  dense
                  status={r.device ? "success" : "warning"}
                  label={r.device ? "Sent to a device" : "Broadcast"}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {[r.destination ? `Printer: ${r.destination}` : "No printer rule", r.reason].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
          {result.skipped > 0 && (
            <li className="py-2 text-xs text-muted-foreground">
              {result.skipped} more rule{result.skipped === 1 ? "" : "s"} not tested in one go.
            </li>
          )}
        </ul>
      )}
    </DrillSheet>
  );
}
