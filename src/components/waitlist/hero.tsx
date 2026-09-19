"use client";

// The hero explainer and the closing banner — web copies of `_hero`,
// `_closingBanner` and `_previewGuest` (modules.dart `_WaitlistView`). The
// QR artifact itself lives in the RAIL join card; the hero only explains it,
// and the closing banner is the "let me look at it" button that opens the
// live guest page.

import * as React from "react";
import { ExternalLink, QrCode, Smile } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { useToast } from "@/hooks/use-toast";
import { IconTile, RoundBadge } from "@/components/waitlist/bits";
import { QueueMotif } from "@/components/waitlist/queue-motif";

export function WaitlistHero(): React.JSX.Element {
  return (
    <ForkCard className="flex items-start gap-4">
      <IconTile size={44} className="rounded-xl">
        <QrCode />
      </IconTile>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.007em] text-foreground">
          Entrance &ldquo;Join the queue&rdquo; QR
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Display this at your door. When all tables are full, guests scan it to join this waitlist — and can
          browse the menu and pre-order while they wait.
        </p>
      </div>
      {/* Ornament only — dropped whole at narrow widths. */}
      <div className="hidden shrink-0 sm:block">
        <QueueMotif />
      </div>
    </ForkCard>
  );
}

export function ClosingBanner({ queueUrl }: { queueUrl: string }): React.JSX.Element {
  const { toast } = useToast();

  // Open the guest queue page for real; a blocked window falls back to the
  // clipboard rather than a button that silently does nothing.
  const previewGuest = async (): Promise<void> => {
    const w = window.open(queueUrl, "_blank", "noopener,noreferrer");
    if (w) { return; }
    try {
      await navigator.clipboard.writeText(queueUrl);
      toast({ title: "Could not open a browser — the link has been copied instead." });
    } catch {
      toast({ title: "Could not open the guest page — copy the link from the Join card instead." });
    }
  };

  return (
    <ForkCard className="flex items-start gap-4">
      <RoundBadge size={40}>
        <Smile />
      </RoundBadge>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.007em] text-foreground">
          Keep your guests happy while they wait
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          From the queue page a party can browse your menu, hold a pre-order, and be notified the moment their
          table is ready.
        </p>
        <div className="mt-3.5">
          <Button size="sm" onClick={() => { void previewGuest(); }}>
            <ExternalLink /> Preview guest experience
          </Button>
        </div>
      </div>
      <div className="hidden shrink-0 sm:block">
        <QueueMotif width={110} height={78} />
      </div>
    </ForkCard>
  );
}
