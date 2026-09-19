"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ArrowRight, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The drill-down mini-overview: the surface a tapped stat tile / chart mark /
 * table row opens. Matches the app's grammar — a BOTTOM SHEET below 760px
 * (14px top radius, 40x4 grab handle) and a centred dialog above it — with
 * three slots:
 *
 *   eyebrow   micro-label context line ("TODAY · DINNER SERVICE")
 *   title     what was drilled into
 *   children  the body (a MetricTile grid, an HBarRow list, a table…)
 *   action    the "View in <Module>" footer slot (a Button asChild > Link)
 *
 * Controlled like any Radix dialog: `open` / `onOpenChange`.
 */
export interface DrillSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  /** Footer slot, right-aligned — usually the "View in <Module>" action. */
  action?: React.ReactNode
}

function DrillSheet({ open, onOpenChange, eyebrow, title, description, children, action }: DrillSheetProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex flex-col border border-border bg-card text-card-foreground shadow-lg outline-none duration-200",
            // Below 760px: the bottom sheet — full width, top radius, handle.
            "max-[759px]:inset-x-0 max-[759px]:bottom-0 max-[759px]:max-h-[85dvh] max-[759px]:rounded-t-[14px] max-[759px]:border-b-0",
            "max-[759px]:data-[state=open]:animate-in max-[759px]:data-[state=open]:slide-in-from-bottom",
            "max-[759px]:data-[state=closed]:animate-out max-[759px]:data-[state=closed]:slide-out-to-bottom",
            // From 760px: the centred dialog.
            "min-[760px]:left-1/2 min-[760px]:top-1/2 min-[760px]:w-full min-[760px]:max-w-lg min-[760px]:-translate-x-1/2 min-[760px]:-translate-y-1/2",
            "min-[760px]:rounded-lg min-[760px]:max-h-[85dvh]",
            "min-[760px]:data-[state=open]:animate-in min-[760px]:data-[state=open]:fade-in-0 min-[760px]:data-[state=open]:zoom-in-95",
            "min-[760px]:data-[state=closed]:animate-out min-[760px]:data-[state=closed]:fade-out-0 min-[760px]:data-[state=closed]:zoom-out-95",
            "gaia:rounded-[2px] gaia:max-[759px]:rounded-t-[2px]"
          )}
        >
          {/* The grab handle — bottom-sheet grammar only. */}
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-input min-[760px]:hidden" />

          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4 min-[760px]:pt-5">
            <div className="min-w-0">
              {eyebrow != null && <div className="micro-label mb-1.5">{eyebrow}</div>}
              <DialogPrimitive.Title className="truncate text-[17px] font-semibold tracking-[-0.01em] text-foreground gaia:font-serif gaia:text-[22px] gaia:font-medium">
                {title}
              </DialogPrimitive.Title>
              {description != null ? (
                <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-colors duration-fast hover:border-input hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring gaia:rounded-[2px]"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {action != null && (
            <div className="flex shrink-0 justify-end border-t border-divider px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
              {action}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * The conventional footer action: "View in Orders →". Pass an onClick (or
 * wrap in a Link via your own Button asChild) — kept as a component so all 24
 * modules say it the same way.
 */
export interface DrillSheetActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  module: string
}

function DrillSheetAction({ module: moduleName, className, ...props }: DrillSheetActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-muted-foreground",
        "transition-colors duration-fast hover:bg-foreground/5 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "gaia:rounded-[2px] gaia:uppercase gaia:tracking-[0.2em] gaia:text-xs gaia:text-primary",
        className
      )}
      {...props}
    >
      View in {moduleName}
      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
    </button>
  )
}

export { DrillSheet, DrillSheetAction }
