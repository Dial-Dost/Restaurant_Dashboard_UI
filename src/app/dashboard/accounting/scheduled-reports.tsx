"use client"

// Scheduled report delivery — the owner-facing half.
//
// A schedule says "this report, this often, at this local hour". A background
// sweep claims each occurrence exactly once, renders it to CSV and stores it on
// a delivery row; this section is where the owner sets that up and reads what
// actually happened.
//
// Two things it deliberately does not pretend:
//
//  * "Delivered" means the file exists and the notification bell has been rung.
//    There is no email transport, so nothing leaves the app — the Download
//    button here is the ONLY place a scheduled report's figures ever appear,
//    which is also why the bell notification carries none of them.
//  * "Run now" QUEUES an extra occurrence; the sweep renders it on its next
//    tick rather than inline, so the history fills in a moment later. Saying
//    "done" the instant the button returns would be a lie about a background job.
//
// Every hour on this screen is the RESTAURANT's wall clock, never the viewer's:
// an owner in Dubai setting "08:00" for a Mumbai kitchen means the kitchen's 8am.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Download, Layers, Play, Plus, Store, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  getReportSchedules, getReportDeliveries, createReportSchedule, updateReportSchedule,
  deleteReportSchedule, runReportScheduleNow, getReportDeliveryCsv,
  type ReportSchedule, type ReportDelivery, type ReportSchedulePatch,
} from "@/lib/db"
import { ALL_OUTLETS, getSelectedOutletId, setSelectedOutlet } from "@/lib/outlet"
import { buildSchedulePatch, isManualRun, runScheduleAction, type ScheduleFormState } from "@/lib/report-schedule-actions"
import { formatDateTime, timezoneCaption } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"

// Only what the backend can actually render. A combination that cannot be
// produced must not be offerable — the CHECK constraints behind these would
// reject it anyway, and a 23514 is not an error message anyone can act on.
const REPORT_KEYS = [
  { value: "sales", label: "Sales" },
  { value: "pnl", label: "Profit & Loss" },
  { value: "gst", label: "GST" },
]
const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]
// v1 ships one channel. It stays a control rather than becoming static text
// because the choice is real to the owner even while there is only one of it.
const CHANNELS = [{ value: "inbox", label: "In-app inbox (notification bell)" }]

// 0 = Sunday, matching the backend's weekday column.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
// Capped at 28, so "the 31st" can never silently skip February.
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

const DELIVERY_LIMIT = 20

// The page's own select styling (see the payroll pay-type control) and its chip
// styling (see reconciliation / payroll), reused so this section is not a
// visually foreign body inside the same card stack.
const SELECT_CLASS = "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
const CHIP = "rounded-full px-2.5 py-0.5 text-xs font-semibold"
const CHIP_OK = `${CHIP} bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300`
const CHIP_BAD = `${CHIP} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`
const CHIP_PENDING = `${CHIP} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`
const CHIP_MUTED = `${CHIP} bg-muted text-muted-foreground`

const labelFor = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`

const cadence = (s: ReportSchedule, tz: string) => {
  const at = `${hhmm(s.hour_local, s.minute_local)} ${tz}`
  if (s.frequency === "weekly") {return `Every ${WEEKDAYS[s.weekday ?? 0] ?? "week"} at ${at}`}
  if (s.frequency === "monthly") {return `On day ${String(s.day_of_month ?? 1)} of each month at ${at}`}
  return `Every day at ${at}`
}

// What a run will actually contain. Every schedule reports a CLOSED period — the
// day in progress is never in it — and an owner who assumes otherwise reads the
// Monday report as Monday's takings when it is Sunday's.
const coverage = (frequency: string) => {
  if (frequency === "weekly") {return "Covers the seven restaurant days ending the day before it runs."}
  if (frequency === "monthly") {return "Covers the whole previous calendar month."}
  return "Covers the previous restaurant day."
}

const outcomeChip = (s: ReportSchedule) => {
  if (!s.last_status) {return <span className={CHIP_MUTED}>Not run yet</span>}
  if (s.last_status === "delivered") {return <span className={CHIP_OK}>Last run OK</span>}
  return <span className={CHIP_BAD}>Last run failed</span>
}

// 'claimed' and 'rendered' are work in flight, not outcomes. 'abandoned' reads as
// "Missed" because that is what it means to the owner: the occurrence was past
// the catch-up window, so it was recorded instead of firing with stale numbers.
const deliveryChip = (status: string) => {
  if (status === "delivered") {return <span className={CHIP_OK}>Delivered</span>}
  if (status === "failed") {return <span className={CHIP_BAD}>Failed</span>}
  if (status === "abandoned") {return <span className={CHIP_BAD}>Missed</span>}
  return <span className={CHIP_PENDING}>{status === "rendered" ? "Rendering" : "Queued"}</span>
}

// Why the combined view cannot edit: GET /reports/schedules aggregates every
// outlet's rows in all-outlets mode (ListReportSchedules' `(og or outlet_id = $2)`,
// database_supabase.ts:14363), but requireAuth rejects EVERY non-GET request
// while that mode is active (index.ts:608-611, "Select a specific outlet before
// making changes"). Pause / Edit / Delete / Run now would therefore render on
// rows where all four can only 400. Same posture as the orders scope notice:
// withhold the action, keep the explanation, and offer the one click that fixes it.
const COMBINED_VIEW_NOTE = "Pick a single outlet before changing a schedule — a combined view spans several."

const BLANK_FORM: ScheduleFormState = {
  name: "", report_key: "sales", frequency: "daily", time: "08:00",
  weekday: "1", day_of_month: "1", channel: "inbox",
}

export function ScheduledReportsSection({ rid }: { rid: string }) {
  const { toast } = useToast()
  const { timezone } = useTimezone()

  const [schedules, setSchedules] = useState<ReportSchedule[]>([])
  const [deliveries, setDeliveries] = useState<ReportDelivery[]>([])
  const [loading, setLoading] = useState(true)
  // An unreachable backend and a tenant with no schedules must not render the
  // same: this feature is plan-gated, so "you have none" would be exactly the
  // wrong thing to tell someone who is really being refused. The history gets its
  // own flag for the same reason — "nothing has run yet" is the one sentence that
  // must never appear because a fetch failed.
  const [failed, setFailed] = useState(false)
  const [historyFailed, setHistoryFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  // null = the form is closed, "" = creating, an id = editing that row.
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduleFormState>(BLANK_FORM)

  // True while the outlet switcher is on "All outlets (combined)" — see
  // COMBINED_VIEW_NOTE. Read in an effect because localStorage does not exist
  // during the server render, and the initial `false` is the safe default: it
  // renders the controls for the single-outlet case, which is the common one.
  // The switcher is the only writer of that key and it renders for admins and
  // managers only, which is also the only role the backend honours the sentinel
  // for, so the stored selection is a sufficient signal on its own. In private
  // mode the choice survives only in the mirrored cookie, which a client
  // component cannot read; there the write reaches the backend and its refusal
  // reaches the toast verbatim, which is the second half of this fix.
  const [combinedView, setCombinedView] = useState(false)
  useEffect(() => { setCombinedView(getSelectedOutletId() === ALL_OUTLETS) }, [])

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    const [s, d] = await Promise.all([
      getReportSchedules(rid),
      getReportDeliveries(rid, { limit: DELIVERY_LIMIT }),
    ])
    if (!s) {
      setFailed(true)
      setHistoryFailed(true)
      setSchedules([])
      setDeliveries([])
      setLoading(false)
      return
    }
    setFailed(false)
    setSchedules(s)
    setHistoryFailed(!d)
    setDeliveries(d ?? [])
    setLoading(false)
  }, [rid])

  useEffect(() => { void load() }, [load])

  // Deliveries outlive their schedule (they are the at-most-once guard as well as
  // the history), so a row whose schedule was removed still has to say something.
  const scheduleName = (id: string) => schedules.find((s) => s.id === id)?.name ?? "Removed schedule"

  const startCreate = () => { setEditing(""); setForm(BLANK_FORM) }

  const startEdit = (s: ReportSchedule) => {
    setEditing(s.id)
    setForm({
      name: s.name,
      report_key: s.report_key,
      frequency: s.frequency,
      time: hhmm(s.hour_local, s.minute_local),
      weekday: String(s.weekday ?? 1),
      day_of_month: String(s.day_of_month ?? 1),
      channel: s.channel,
    })
  }

  // Every mutating handler runs through runScheduleAction (src/lib/report-schedule-actions.ts):
  // it owns the busy flag on BOTH paths, so a request that fails cannot leave
  // this card's buttons disabled until the page is reloaded, and it raises the
  // backend's own sentence rather than a generic one — /run-now's 409 and the
  // combined-view 400 are both answers the owner needs to read.
  const actionDeps = { setBusy, toast }

  const save = async () => {
    const isEdit = Boolean(editing)
    const built = buildSchedulePatch(form)
    if (!built.ok) {
      toast({ title: built.message, variant: "destructive" })
      return
    }
    const patch: ReportSchedulePatch = built.patch
    await runScheduleAction(actionDeps, "Couldn't save the schedule", async () => {
      if (editing) { await updateReportSchedule(rid, editing, patch) } else { await createReportSchedule(rid, patch) }
      setEditing(null)
      await load()
      return { title: isEdit ? "Schedule updated" : "Schedule created" }
    })
  }

  // One key, not the whole row: the backend fills every omitted field from the
  // stored row, so pausing can never stamp a stale name or hour.
  const toggleEnabled = async (s: ReportSchedule) => {
    await runScheduleAction(actionDeps, "Couldn't change the schedule", async () => {
      await updateReportSchedule(rid, s.id, { enabled: !s.enabled })
      await load()
      return { title: s.enabled ? "Schedule paused" : "Schedule resumed" }
    })
  }

  const remove = async (s: ReportSchedule) => {
    if (!window.confirm(`Stop sending "${s.name}"? Past deliveries stay in the history below and can still be downloaded.`)) {return}
    await runScheduleAction(actionDeps, "Couldn't remove the schedule", async () => {
      await deleteReportSchedule(rid, s.id)
      if (editing === s.id) { setEditing(null) }
      await load()
      return { title: "Schedule removed" }
    })
  }

  const runNow = async (s: ReportSchedule) => {
    await runScheduleAction(actionDeps, "Couldn't queue this report", async () => {
      const outcome = await runReportScheduleNow(rid, s.id)
      await load()
      // Clicking twice inside a minute collapses to one render. That is the
      // feature, so it is reported as an outcome rather than as a failure.
      if (!outcome.queued) {
        return {
          title: "Already queued",
          description: outcome.note ?? "This report is already queued for this minute — nothing extra was started.",
        }
      }
      return {
        title: "Queued",
        description: "The sweep renders it on its next tick — refresh the history in a minute to download the file.",
      }
    })
  }

  const download = async (d: ReportDelivery) => {
    try {
      const csv = await getReportDeliveryCsv(rid, d.id)
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url
      a.download = d.artifact_name ?? `report_${d.period_from}_to_${d.period_to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast({ title: "Couldn't download the report", description: String(e?.message ?? e), variant: "destructive" })
    }
  }

  // One form, shown either at the top (creating) or inside the row being edited.
  // Only one of those conditions is ever true, so the element is built once.
  const scheduleForm = (
    <div className="rounded-lg border p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Name (e.g. Morning sales)"
          value={form.name}
          onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); }}
        />
        <select
          className={SELECT_CLASS} value={form.report_key} title="Which report to run"
          onChange={(e) => { setForm((f) => ({ ...f, report_key: e.target.value })); }}
        >
          {REPORT_KEYS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className={SELECT_CLASS} value={form.frequency} title="How often it runs"
          onChange={(e) => { setForm((f) => ({ ...f, frequency: e.target.value })); }}
        >
          {FREQUENCIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {form.frequency === "weekly" && (
          <select
            className={SELECT_CLASS} value={form.weekday} title="Which day of the week"
            onChange={(e) => { setForm((f) => ({ ...f, weekday: e.target.value })); }}
          >
            {WEEKDAYS.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
          </select>
        )}
        {form.frequency === "monthly" && (
          <select
            className={SELECT_CLASS} value={form.day_of_month} title="Which day of the month"
            onChange={(e) => { setForm((f) => ({ ...f, day_of_month: e.target.value })); }}
          >
            {MONTH_DAYS.map((d) => <option key={d} value={String(d)}>Day {d}</option>)}
          </select>
        )}
        <Input
          type="time" value={form.time} title={`Fires at this time in ${timezone}, not your device's zone`}
          onChange={(e) => { setForm((f) => ({ ...f, time: e.target.value })); }}
        />
        <select
          className={SELECT_CLASS} value={form.channel} title="Where the finished report is announced"
          onChange={(e) => { setForm((f) => ({ ...f, channel: e.target.value })); }}
        >
          {CHANNELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {coverage(form.frequency)} Runs in restaurant time · {timezoneCaption(timezone)}.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : editing ? "Save" : "Create"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(null); }}>Cancel</Button>
      </div>
    </div>
  )

  return (
    <Card id="scheduled-reports-section" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Scheduled reports</CardTitle>
            <CardDescription>
              Have a report built on its own schedule instead of remembering to export it. Each run is
              generated as a CSV and announced in the notification bell; the figures themselves stay here,
              behind this page&apos;s permission, and are downloaded from the history below.
            </CardDescription>
            {combinedView && (
              <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-muted-foreground">
                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Showing <strong className="font-semibold">all outlets (combined)</strong> — every branch&apos;s
                  schedules are listed and their files still download here, but a schedule belongs to one
                  outlet and can only be changed from it. {COMBINED_VIEW_NOTE}
                </span>
              </p>
            )}
          </div>
          <Button size="sm" onClick={startCreate} disabled={editing === "" || combinedView} title={combinedView ? COMBINED_VIEW_NOTE : undefined}>
            <Plus className="mr-1 h-4 w-4" /> New schedule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing === "" && scheduleForm}

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : failed ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <p>Couldn&apos;t load scheduled reports.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Retry</Button>
          </div>
        ) : schedules.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {/* Not "create one" while the New schedule button is disabled. */}
            {combinedView
              ? "No scheduled reports on any outlet yet — pick a single outlet to create one."
              : "No scheduled reports yet — create one and it will run without anyone opening this page."}
          </p>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {s.name}
                      <span className="text-xs font-normal text-muted-foreground"> · {labelFor(REPORT_KEYS, s.report_key)} · {s.format.toUpperCase()}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cadence(s, timezone)} · {labelFor(CHANNELS, s.channel)}
                      {s.last_run_at ? ` · last run ${formatDateTime(s.last_run_at, timezone)}` : ""}
                    </p>
                  </div>
                  {!s.enabled && <span className={CHIP_MUTED}>Paused</span>}
                  {outcomeChip(s)}
                  {combinedView ? (
                    // The one click that makes the four buttons below reachable,
                    // and it is per-row because the row already knows which outlet
                    // owns it. Same affordance the orders scope notice offers.
                    <Button size="sm" variant="outline" title={COMBINED_VIEW_NOTE} onClick={() => { void setSelectedOutlet(s.outlet_id); }}>
                      <Store className="mr-1 h-4 w-4" /> Switch to this outlet
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void runNow(s)}>
                        <Play className="mr-1 h-4 w-4" /> Run now
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleEnabled(s)}>
                        {s.enabled ? "Pause" : "Resume"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { editing === s.id ? setEditing(null) : startEdit(s); }}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="icon" disabled={busy} onClick={() => void remove(s)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>

                {/* A failure that is only visible in the history is a failure the
                    owner finds a week late, so the last error also sits on the row. */}
                {s.last_status !== "delivered" && s.last_error && (
                  <p className="mt-2 text-xs text-destructive">
                    {s.last_error}
                    {s.consecutive_failures > 0 ? ` · ${s.consecutive_failures} failure${s.consecutive_failures === 1 ? "" : "s"} in a row` : ""}
                    {!s.enabled ? " · paused automatically — resume it once the cause is fixed" : ""}
                  </p>
                )}

                {editing === s.id && <div className="mt-3">{scheduleForm}</div>}
              </div>
            ))}
          </div>
        )}

        {/* The surface that catches what a status chip cannot: a run that never
            happened at all. Every occurrence gets a row the moment it is claimed,
            so a missing report is a visible row, not an absence. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Recent deliveries</p>
            <Button variant="ghost" size="sm" onClick={() => void load()}>Refresh</Button>
          </div>
          {historyFailed ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the delivery history.</p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
          ) : (
            deliveries.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {scheduleName(d.schedule_id)}
                    <span className="text-xs font-normal text-muted-foreground">
                      {" · "}{d.period_from === d.period_to ? d.period_from : `${d.period_from} → ${d.period_to}`}
                    </span>
                  </p>
                  {/* The delivery's OWN stored zone, not the page's — a wrong-zone
                      regression should be readable here rather than hidden by
                      re-formatting it in whatever zone the tenant has today. */}
                  <p className="text-xs text-muted-foreground">
                    {isManualRun(d.occurrence_key) ? "Manual run" : "Scheduled"} · {formatDateTime(d.fire_at, d.timezone)}
                    {d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}
                    {d.artifact_truncated ? " · file truncated" : ""}
                  </p>
                  {d.error && <p className="text-xs text-destructive">{d.error}</p>}
                </div>
                {deliveryChip(d.status)}
                <Button variant="outline" size="sm" disabled={!d.artifact_name} onClick={() => void download(d)}>
                  <Download className="mr-1 h-4 w-4" /> CSV
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
