"use client"

// Shared chrome for the Settings cards — the web copy of Flutter's settings
// idiom: every card carries its own titleMedium title + gray caption, uppercase
// micro-labels above dense inputs, and its own Save (no page-level submit).

import * as React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function SettingsCard({
  title,
  caption,
  trailing,
  children,
  className,
}: {
  title: React.ReactNode
  caption?: React.ReactNode
  trailing?: React.ReactNode
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Card className={className}>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 text-[15px] font-semibold leading-snug sm:text-base">{title}</h3>
            {trailing}
          </div>
          {caption ? <p className="text-xs text-muted-foreground sm:text-sm">{caption}</p> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** Uppercase micro-label above a dense input. */
export function FieldLabel({ htmlFor, children, className }: { htmlFor?: string; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <Label htmlFor={htmlFor} className={cn("micro-label block", className)}>
      {children}
    </Label>
  )
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>
}

/** A save-on-flip switch card: title + (animated) caption + switch. */
export function SwitchCard({
  id,
  title,
  caption,
  checked,
  disabled,
  onChange,
}: {
  id: string
  title: string
  caption: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={id} className="text-sm font-semibold">{title}</Label>
          <p key={caption} className="animate-in fade-in text-xs text-muted-foreground duration-200 sm:text-sm">
            {caption}
          </p>
        </div>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
      </CardContent>
    </Card>
  )
}
