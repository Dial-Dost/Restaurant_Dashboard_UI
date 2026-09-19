"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";

// The qrcode package ships no types (src/types/qrcode.d.ts declares it as
// any); pin the one call this dialog makes.
const qrToDataUrl = (QRCode as {
  toDataURL: (text: string, opts?: { width?: number; margin?: number }) => Promise<string>;
}).toDataURL;

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * "Guest reservation link" (modules.dart `showReservationQr`): a white-quiet-
 * zone QR of /reserve/<restaurant>, the share caption, the URL as selectable
 * text, and a Print action that lays out the same page `_printTableQr`
 * prints ("Scan to order — Table Reservations").
 */
export function ReservationQrDialog({
  open,
  onOpenChange,
  url,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
}): React.JSX.Element {
  const { toast } = useToast();
  const [png, setPng] = React.useState("");

  React.useEffect(() => {
    if (!open || !url) { setPng(""); return; }
    let cancelled = false;
    qrToDataUrl(url, { width: 512, margin: 2 })
      .then((data: string) => { if (!cancelled) { setPng(data); } })
      .catch(() => { if (!cancelled) { setPng(""); } });
    return () => { cancelled = true; };
  }, [open, url]);

  const print = (): void => {
    if (!png) { return; }
    const w = window.open("", "_blank", "width=520,height=680");
    if (!w) {
      toast({
        title: "Pop-up blocked",
        description: "Allow pop-ups for this site to print the QR.",
        variant: "destructive",
      });
      return;
    }
    // The same sheet the app prints for a table QR, table name "Reservations".
    w.document.title = "Guest reservation link";
    w.document.body.setAttribute(
      "style",
      "font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#111",
    );
    w.document.body.innerHTML =
      `<h1 style="margin:0 0 24px;font-size:22px">Scan to order — Table Reservations</h1>` +
      `<img src="${png}" style="width:260px;height:260px"/>` +
      `<p style="margin-top:16px;font-size:9px;word-break:break-all">${url}</p>`;
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle>Guest reservation link</DialogTitle>
          <DialogDescription className="sr-only">
            A QR code guests scan to book a table online.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-stretch gap-2">
          <div className="flex justify-center">
            <div className="bg-white p-2">
              {png ? (
                <img src={png} alt="Reservation link QR code" className="h-[200px] w-[200px]" />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center text-xs text-neutral-500">
                  Generating…
                </div>
              )}
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Share so guests can book a table online
          </p>
          <p className="select-all break-all text-center text-[11px] text-foreground">{url}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={print} disabled={!png}>
            <Printer /> Print
          </Button>
          <Button type="button" size="sm" onClick={() => { onOpenChange(false); }}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
