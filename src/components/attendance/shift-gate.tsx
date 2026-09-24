"use client";

/*
  THE SCREEN A WAITER SEES BEFORE THEY HAVE CLOCKED IN.

  Client: "the waiter can access the tables only when he is clocked in and
  present at the restaurant". `hooks/use-shift-gate.ts` decides WHEN this is
  drawn (waiter-only sessions, and never on a failed read); this is only what it
  says and the one button behind it.

  IT ADMITS WHAT IT KNOWS. "Present" is not something a web app can verify, so
  the card says the restaurant asks staff to clock in on arrival rather than
  pretending to have detected anybody's location.

  ONE TAP OUT. Clocking in from here files the same pending clock-in the
  Attendance page does — no manager, no second screen — because the failure mode
  that matters is a waiter standing in front of a table they cannot open.
*/

import * as React from "react";
import { Clock, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { useToast } from "@/hooks/use-toast";

export interface ShiftGateCardProps {
    /** What is behind the gate, named: "the floor", "the order pad". */
    what: string;
    onClockIn: () => Promise<void>;
}

export function ShiftGateCard({ what, onClockIn }: ShiftGateCardProps): React.JSX.Element {
    const { toast } = useToast();
    const [busy, setBusy] = React.useState(false);

    const clockIn = async (): Promise<void> => {
        setBusy(true);
        try {
            await onClockIn();
            toast({ title: "Clocked in", description: "Your shift has started — the floor is open." });
        } catch (error: unknown) {
            toast({
                title: "Could not clock in",
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <ForkCard className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-inset">
                <Clock aria-hidden className="h-5 w-5 text-muted-foreground" />
            </span>
            <h2 className="text-base font-semibold text-foreground">You are not on shift</h2>
            <p className="text-sm text-muted-foreground">
                {what} opens once you clock in. Clocking in records that you are at the restaurant and starts
                your hours for today.
            </p>
            <Button size="lg" className="w-full" disabled={busy} onClick={() => { void clockIn(); }}>
                <LogIn /> {busy ? "Clocking in…" : "Clock in & start my shift"}
            </Button>
            <p className="text-xs text-tertiary">
                Your manager reviews clock-ins on the Attendance page. You do not have to wait for that.
            </p>
        </ForkCard>
    );
}
