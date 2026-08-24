"use client";

import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  Briefcase,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import { Bars, Chips, Delta, Donut, Heat, Rows, Sparkline, Stat, Timeline } from "./charts";

export type View = {
  name: string;
  headline: string;
  icon: ReactNode;
  /** Five cells with fixed grid positions: A primary stat, B hero chart,
   * C secondary stat, D mid widget, E list/detail. Cards persist across
   * views; only these contents morph. */
  cells: { title: string; content: ReactNode }[];
};

const HOURS = ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"];

export const VIEWS: View[] = [
  {
    name: "Manager",
    headline: "The day, at a glance.",
    icon: <LayoutDashboard size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Revenue today",
        content: (
          <div className="flex h-full flex-col justify-between gap-2">
            <Stat value={128400} prefix="$" delta={6.4} label="vs last Friday" />
            <div className="h-10">
              <Sparkline data={[52, 61, 58, 72, 84, 79, 95, 108, 121, 128]} accent="gold" height={40} />
            </div>
          </div>
        ),
      },
      {
        title: "Throughput by hour",
        content: (
          <Sparkline
            data={[120, 180, 320, 640, 520, 340, 300, 380, 460, 560, 610, 430]}
            labels={HOURS}
            accent="azure"
            unit=" orders"
            height={110}
          />
        ),
      },
      {
        title: "On-time fulfillment",
        content: <Stat value={96.2} suffix="%" decimals={1} delta={0.8} label="vs 7-day average" />,
      },
      {
        title: "Shift coverage",
        content: (
          <Timeline
            items={[
              { time: "06:00", label: "Open crew · 42", accent: "neutral" },
              { time: "11:00", label: "Peak · 118", accent: "gold" },
              { time: "15:00", label: "Mid · 74", accent: "neutral" },
              { time: "18:00", label: "Peak · 112", accent: "gold" },
              { time: "22:00", label: "Close · 38", accent: "neutral" },
            ]}
          />
        ),
      },
      {
        title: "Needs attention",
        content: (
          <Rows
            items={[
              { label: "2 SKUs below par — reorder", value: "15:00", accent: "gold" },
              { label: "Unassigned shift tomorrow", value: "1", accent: "violet" },
              { label: "Delivery running late — Harbor 12", value: "40m", accent: "azure" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Operations",
    headline: "Flow, in real time.",
    icon: <Activity size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Avg fulfillment time",
        content: <Stat value={760} format="minsec" label="−1m 10s vs 7-day average" />,
      },
      {
        title: "Load by zone",
        content: (
          <Heat
            grid={[
              [22, 30, 48, 74, 60, 38, 30, 42, 55, 68, 72, 44],
              [30, 44, 66, 91, 78, 52, 40, 56, 70, 84, 88, 58],
              [18, 26, 40, 62, 50, 34, 26, 36, 46, 60, 64, 38],
            ]}
            rowLabels={["Prep", "Assembly", "Dispatch"]}
            colLabels={["09", "12", "15", "18", "21"]}
          />
        ),
      },
      {
        title: "Equipment uptime",
        content: <Stat value={98.7} suffix="%" decimals={1} label="142 of 144 stations online" />,
      },
      {
        title: "Queue depth by channel",
        content: <Bars data={[14, 9, 22]} labels={["On-site", "Pickup", "Delivery"]} accent="azure" highlight={2} />,
      },
      {
        title: "Exceptions",
        content: (
          <Rows
            items={[
              { label: "Order #4187 stalled — Downtown 05", value: "9m", accent: "gold" },
              { label: "Chiller temp drift — Harbor 12", value: "live", accent: "azure" },
              { label: "Courier delayed — Midtown 08", value: "12m", accent: "violet" },
              { label: "Station offline — Airport 11", value: "1", accent: "neutral" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Inventory",
    headline: "Supply, always ahead.",
    icon: <Boxes size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Stock cover",
        content: <Stat value={9.4} decimals={1} suffix=" days" delta={0.6} label="network median" />,
      },
      {
        title: "Cover by category",
        content: (
          <Bars
            data={[3.1, 4.8, 5.2, 11, 14, 21]}
            labels={["Prod", "Prot", "Dairy", "Bev", "Dry", "Pack"]}
            accent="emerald"
            highlight={0}
          />
        ),
      },
      {
        title: "Waste rate",
        content: <Donut value={93} display={2.8} decimals={1} suffix="%" accent="emerald" label="target ≤ 3.0%" />,
      },
      {
        title: "Inbound today",
        content: (
          <Timeline
            items={[
              { time: "06:30", label: "Produce — received", accent: "emerald" },
              { time: "09:00", label: "Dairy — received", accent: "emerald" },
              { time: "11:30", label: "Dry goods — in transit", accent: "azure" },
              { time: "14:00", label: "Packaging — scheduled", accent: "neutral" },
              { time: "16:30", label: "Beverage — scheduled", accent: "neutral" },
            ]}
          />
        ),
      },
      {
        title: "Reorder queue",
        content: (
          <Rows
            items={[
              { label: "Produce — leafy, below par", value: "12", accent: "gold" },
              { label: "Dairy base — order today", value: "now", accent: "gold" },
              { label: "Packaging M — 2.1d cover", value: "2.1d", accent: "azure" },
              { label: "Protein A — vendor confirms", value: "Fri", accent: "neutral" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Analytics",
    headline: "Patterns become foresight.",
    icon: <BarChart3 size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Revenue, weekly",
        content: <Stat value={1.58} prefix="$" suffix="M" decimals={2} delta={5.1} label="12-week trend" />,
      },
      {
        title: "Revenue, 12 weeks",
        content: (
          <Sparkline
            data={[1180, 1240, 1195, 1310, 1370, 1330, 1420, 1465, 1440, 1510, 1555, 1580]}
            labels={["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12"]}
            accent="gold"
            unit="k"
            height={110}
          />
        ),
      },
      {
        title: "Forecast accuracy",
        content: <Stat value={94.1} suffix="%" decimals={1} delta={1.2} label="since model refresh" />,
      },
      {
        title: "Demand by day",
        content: (
          <Heat
            grid={[[40, 45, 50, 55, 70, 95, 80]]}
            colLabels={["S", "M", "T", "W", "T", "F", "S"]}
            accentVar="--violet"
          />
        ),
      },
      {
        title: "Channel mix",
        content: <Donut value={54} display={54} suffix="%" accent="violet" label="on-site share" />,
      },
    ],
  },
  {
    name: "Executive",
    headline: "The whole network, one view.",
    icon: <Briefcase size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Network revenue, MTD",
        content: <Stat value={2.41} prefix="$" suffix="M" decimals={2} delta={8.2} label="YoY · 12 locations" />,
      },
      {
        title: "Revenue by location",
        content: (
          <Bars
            data={[312, 278, 259, 164, 121]}
            labels={["Dwtn 05", "Rvsd 02", "Arpt 11", "Mdtn 08", "Hrbr 12"]}
            accent="azure"
            highlight={0}
          />
        ),
      },
      {
        title: "Labor ratio",
        content: <Stat value={27.6} suffix="%" decimals={1} label="of revenue · target ≤ 28%" />,
      },
      {
        title: "Cost structure",
        content: (
          <Rows
            items={[
              { label: "Supply", value: "31%", pct: 31, accent: "neutral" },
              { label: "Labor", value: "28%", pct: 28, accent: "neutral" },
              { label: "Occupancy", value: "12%", pct: 12, accent: "neutral" },
              { label: "Margin", value: "20%", pct: 20, accent: "gold" },
            ]}
          />
        ),
      },
      {
        title: "Location scorecard",
        content: (
          <Rows
            items={[
              { label: "Downtown 05", value: "94", pct: 94, accent: "gold" },
              { label: "Riverside 02", value: "92", pct: 92, accent: "gold" },
              { label: "Airport 11", value: "90", pct: 90, accent: "gold" },
              { label: "Midtown 08", value: "71", pct: 71, accent: "neutral" },
              { label: "Harbor 12", value: "68", pct: 68, accent: "neutral" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Admin",
    headline: "Control, without friction.",
    icon: <ShieldCheck size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Active users",
        content: <Stat value={214} delta={4.4} label="across 12 locations" />,
      },
      {
        title: "Integrations",
        content: (
          <Rows
            items={[
              { label: "Point-of-sale", value: "2m ago", accent: "emerald" },
              { label: "Payroll", value: "1h ago", accent: "emerald" },
              { label: "Vendor EDI", value: "14m ago", accent: "emerald" },
              { label: "Accounting", value: "3h ago", accent: "emerald" },
              { label: "BI export", value: "nightly", accent: "azure" },
            ]}
          />
        ),
      },
      {
        title: "Sync health",
        content: <Stat value={99.98} suffix="%" decimals={2} label="events delivered, 24h" />,
      },
      {
        title: "Roles",
        content: (
          <Chips
            items={[
              { label: "Owner · 2", accent: "gold" },
              { label: "Regional · 4", accent: "violet" },
              { label: "Site lead · 12", accent: "azure" },
              { label: "Shift lead · 38", accent: "emerald" },
              { label: "Team · 158", accent: "neutral" },
            ]}
          />
        ),
      },
      {
        title: "Audit trail",
        content: (
          <Timeline
            items={[
              { time: "07:02", label: "Role updated — Riverside 02", accent: "neutral" },
              { time: "09:15", label: "Par levels changed — network", accent: "gold" },
              { time: "11:48", label: "User invited", accent: "neutral" },
              { time: "13:20", label: "Vendor added", accent: "neutral" },
              { time: "14:05", label: "Export scheduled", accent: "azure" },
            ]}
          />
        ),
      },
    ],
  },
];

export { Delta };
