"use client";

import type { ReactNode } from "react";
import {
  Armchair,
  BarChart3,
  ChefHat,
  Hourglass,
  LayoutDashboard,
  Wallet,
} from "lucide-react";
import { Bars, Delta, Donut, Heat, Rows, Sparkline, Stat, Timeline } from "./charts";

export type View = {
  name: string;
  headline: string;
  icon: ReactNode;
  /** Five cells with fixed grid positions: A primary stat, B hero chart,
   * C secondary stat, D mid widget, E list/detail. Cards persist across
   * views; only these contents morph. */
  cells: { title: string; content: ReactNode }[];
};

/* Every number below is example data, but every METRIC is one the product
 * actually computes and every label is a real module doing its real job:
 * covers counted once per table, APC = bill / covers (pre-tax), daily KOT
 * numbers, GST from the outlet's tax config, QR waitlist with held
 * pre-orders. Nothing here claims a feature CuisineFlow does not ship. */

const HOURS = ["12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"];

export const VIEWS: View[] = [
  {
    name: "Overview",
    headline: "The day, at a glance.",
    icon: <LayoutDashboard size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Revenue today",
        content: (
          <div className="flex h-full flex-col justify-between gap-2">
            <Stat value={86410} prefix="₹" delta={6.4} label="61 bills · vs last Friday" />
            <div className="h-10">
              <Sparkline data={[4, 11, 26, 38, 41, 44, 48, 57, 68, 86]} accent="copper" height={40} />
            </div>
          </div>
        ),
      },
      {
        title: "Covers by hour",
        content: (
          <Sparkline
            data={[18, 42, 36, 14, 8, 10, 16, 34, 52, 58, 40, 22]}
            labels={HOURS}
            accent="copper"
            unit=" covers"
            height={110}
          />
        ),
      },
      {
        title: "APC, today",
        content: <Stat value={412} prefix="₹" delta={2.1} label="per cover · pre-tax" />,
      },
      {
        title: "Service pulse",
        content: (
          <Timeline
            items={[
              { time: "13:05", label: "T4 seated — 4 covers", accent: "neutral" },
              { time: "13:09", label: "KOT #118 fired — tandoor", accent: "copper" },
              { time: "13:31", label: "T2 settled — ₹1,840 · UPI", accent: "success" },
              { time: "13:38", label: "Guest QR order — Table 9", accent: "info" },
              { time: "13:44", label: "Feedback in — 5★, Table 2", accent: "success" },
            ]}
          />
        ),
      },
      {
        title: "Needs attention",
        content: (
          <Rows
            items={[
              { label: "T12 — bill printed, unsettled", value: "46m", accent: "warning" },
              { label: "Waitlist — 3 parties at the gate", value: "3", accent: "info" },
              { label: "Paneer below par — reorder", value: "1.2 kg", accent: "warning" },
              { label: "KOT #121 aging — tandoor", value: "9m", accent: "danger" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Tables",
    headline: "The floor, in real time.",
    icon: <Armchair size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Tables occupied",
        content: <Stat value={14} suffix="/22" label="2 clubbed · 3 reserved" />,
      },
      {
        title: "Occupancy by hour",
        content: (
          <Heat
            grid={[
              [42, 78, 64, 22, 10, 12, 26, 60, 88, 92, 70, 34],
              [30, 62, 50, 16, 8, 10, 20, 48, 76, 84, 58, 26],
              [22, 48, 38, 12, 6, 8, 14, 36, 60, 66, 44, 18],
            ]}
            rowLabels={["AC Hall", "Terrace", "Family"]}
            colLabels={["12", "15", "18", "21"]}
            accentVar="--copper"
          />
        ),
      },
      {
        title: "Covers so far",
        content: <Stat value={168} delta={4.8} label="counted once per table" />,
      },
      {
        title: "Table moves",
        content: (
          <Timeline
            items={[
              { time: "13:02", label: "T4 + T5 clubbed — one bill", accent: "copper" },
              { time: "13:20", label: "Item moved T7 → T3", accent: "neutral" },
              { time: "13:44", label: "Bill split by items — T9", accent: "copper" },
              { time: "14:01", label: "T6 settled — ₹2,310", accent: "success" },
              { time: "14:06", label: "T6 reset — free", accent: "neutral" },
            ]}
          />
        ),
      },
      {
        title: "Open bills",
        content: (
          <Rows
            items={[
              { label: "T3 · 4 covers · 2 KOTs", value: "₹1,240", accent: "copper" },
              { label: "T7 · 2 covers · 1 KOT", value: "₹640", accent: "copper" },
              { label: "T9 · 6 covers · clubbed", value: "₹3,180", accent: "copper" },
              { label: "T12 · bill printed", value: "46m", accent: "warning" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Waitlist",
    headline: "The queue runs itself.",
    icon: <Hourglass size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Waiting now",
        content: <Stat value={7} label="parties · longest wait 22m" />,
      },
      {
        title: "Queue through the evening",
        content: (
          <Sparkline
            data={[1, 2, 4, 7, 9, 8, 6, 4, 2]}
            labels={["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"]}
            accent="copper"
            unit=" waiting"
            height={110}
          />
        ),
      },
      {
        title: "Joined by QR",
        content: <Donut value={82} suffix="%" accent="copper" label="scanned at the gate" />,
      },
      {
        title: "Pre-orders held",
        content: (
          <Rows
            items={[
              { label: "Arora · 4 — cart held", value: "6 items", accent: "copper" },
              { label: "Mehta · 2 — cart held", value: "3 items", accent: "copper" },
              { label: "Iyer · 5 — browsing menu", value: "—", accent: "neutral" },
            ]}
          />
        ),
      },
      {
        title: "Call → seat",
        content: (
          <Timeline
            items={[
              { time: "19:41", label: "Called — Arora · 4, pop-up on phone", accent: "copper" },
              { time: "19:44", label: "Seated at T6 — pre-order placed", accent: "success" },
              { time: "19:45", label: "KOT #164 fired to kitchen", accent: "neutral" },
              { time: "19:52", label: "Next up — Mehta · 2", accent: "info" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Kitchen",
    headline: "Every KOT, on the clock.",
    icon: <ChefHat size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Open KOTs",
        content: <Stat value={9} label="oldest 6m · tandoor" />,
      },
      {
        title: "Prep load by station",
        content: (
          <Heat
            grid={[
              [30, 64, 52, 18, 10, 12, 24, 58, 86, 90, 66, 30],
              [24, 50, 42, 14, 8, 10, 18, 44, 70, 78, 54, 24],
              [12, 26, 20, 8, 6, 8, 10, 22, 38, 44, 30, 14],
            ]}
            rowLabels={["Tandoor", "Curry", "Chinese"]}
            colLabels={["12", "15", "18", "21"]}
            accentVar="--copper"
          />
        ),
      },
      {
        title: "Avg prep time",
        content: <Stat value={754} format="minsec" label="fire to pass, today" />,
      },
      {
        title: "Tickets by channel",
        content: (
          <Bars data={[46, 18, 6]} labels={["Dine-in", "Guest QR", "Pre-order"]} accent="copper" highlight={0} />
        ),
      },
      {
        title: "Firing now",
        content: (
          <Rows
            items={[
              { label: "KOT #212 — T7 · 2× tandoori platter", value: "2m", accent: "success" },
              { label: "KOT #213 — T3 · 3× dal makhani", value: "4m", accent: "copper" },
              { label: "KOT #214 — QR · 1× biryani", value: "1m", accent: "info" },
              { label: "KOT #209 — T12 · running late", value: "9m", accent: "warning" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Analytics",
    headline: "Patterns become decisions.",
    icon: <BarChart3 size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Revenue this week",
        content: <Stat value={6.4} prefix="₹" suffix="L" decimals={1} delta={5.1} label="pre-tax · all outlets" />,
      },
      {
        title: "APC, 12 weeks · ₹",
        content: (
          <Sparkline
            data={[382, 391, 388, 402, 410, 405, 418, 424, 421, 431, 436, 442]}
            labels={["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12"]}
            accent="copper"
            height={110}
          />
        ),
      },
      {
        title: "Price suggestions",
        content: <Stat value={6} label="dishes flagged to reprice" />,
      },
      {
        title: "Demand by day",
        content: (
          <Heat
            grid={[[40, 32, 34, 38, 52, 88, 96]]}
            colLabels={["S", "M", "T", "W", "T", "F", "S"]}
            accentVar="--copper"
          />
        ),
      },
      {
        title: "Menu insights",
        content: (
          <Rows
            items={[
              { label: "Butter chicken — top seller", value: "312 plates", accent: "copper" },
              { label: "Veg biryani — raise ₹20", value: "+₹20", accent: "warning" },
              { label: "Ravi — top waiter, this week", value: "₹52k", accent: "success" },
              { label: "What-if: +5% APC", value: "simulate", accent: "info" },
            ]}
          />
        ),
      },
    ],
  },
  {
    name: "Money",
    headline: "GST-ready, every night.",
    icon: <Wallet size={15} strokeWidth={1.75} />,
    cells: [
      {
        title: "Grand total, today",
        content: <Stat value={92140} prefix="₹" delta={4.2} label="tax-inclusive · 61 bills" />,
      },
      {
        title: "Settlements by mode",
        content: (
          <Bars data={[31, 18, 9, 3]} labels={["UPI", "Cash", "Card", "Pending"]} accent="copper" highlight={0} />
        ),
      },
      {
        title: "GST collected",
        content: <Stat value={4380} prefix="₹" label="CGST + SGST, today" />,
      },
      {
        title: "Cash register",
        content: (
          <Rows
            items={[
              { label: "Opening float", value: "₹5,000", accent: "neutral" },
              { label: "Cash sales", value: "₹22,340", accent: "copper" },
              { label: "Payouts", value: "−₹1,200", accent: "warning" },
              { label: "Expected in drawer", value: "₹26,140", accent: "success" },
            ]}
          />
        ),
      },
      {
        title: "Day close",
        content: (
          <Timeline
            items={[
              { time: "22:48", label: "Last bill settled — T9", accent: "neutral" },
              { time: "23:00", label: "Cash counted — drawer matches", accent: "success" },
              { time: "23:05", label: "GST summary — ₹2,190 + ₹2,190", accent: "copper" },
              { time: "23:10", label: "Daily report → owner's bell", accent: "info" },
            ]}
          />
        ),
      },
    ],
  },
];

export { Delta };
