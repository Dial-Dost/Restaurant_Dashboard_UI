"use client";

/**
 * Small drill-sheet building blocks shared by Outlets and Valet — the web twins
 * of the app's `_kv` (a key/value line), `_sheetRecordRow` (a tappable inset
 * row inside a sheet) and `_confirm` (a styled confirm dialog, red for
 * destructive actions). Nothing here is a window.confirm.
 */

import * as React from "react";
import { ChevronRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** `_kv`: a muted key over / beside its full, untruncated value. */
export function KvRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-divider py-2 text-sm last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  );
}

export interface SheetRecordRowProps {
  title: React.ReactNode;
  badge?: React.ReactNode;
  sub?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
}

/** `_sheetRecordRow`: an inset row that leads on to the member's own sheet. */
export function SheetRecordRow({ title, badge, sub, trailing, onClick }: SheetRecordRowProps): React.JSX.Element {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border bg-inset px-3.5 py-3 text-left",
        onClick && "transition-colors duration-fast hover:border-input hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {badge}
        </div>
        {sub != null && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {trailing != null && <span className="shrink-0 text-sm font-semibold tabular-nums">{trailing}</span>}
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-tertiary" />}
    </Tag>
  );
}

export interface ConfirmOptions {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** Imperative styled confirm: `if (!(await confirm({...}))) return;` */
export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; confirmDialog: React.ReactNode } {
  const [state, setState] = React.useState<ConfirmState | null>(null);
  const confirm = React.useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => { setState({ ...opts, resolve }); }),
    [],
  );
  const settle = (ok: boolean): void => {
    setState((s) => {
      s?.resolve(ok);
      return null;
    });
  };
  const confirmDialog = state ? (
    <AlertDialog open onOpenChange={(o) => { if (!o) { settle(false); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          <AlertDialogDescription>{state.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { settle(false); }}>Cancel</AlertDialogCancel>
          <Button variant={state.destructive ? "destructive" : "default"} onClick={() => { settle(true); }}>
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
  return { confirm, confirmDialog };
}

/** True below the app's 760px narrow edge. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 759px)");
    const on = (): void => { setNarrow(mql.matches); };
    on();
    mql.addEventListener("change", on);
    return () => { mql.removeEventListener("change", on); };
  }, []);
  return narrow;
}
