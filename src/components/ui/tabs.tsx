"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // ForkTabs: a transparent pill row (the opaque muted box is not the
      // app's voice); the copper tick separators live on the triggers. The
      // row scrolls rather than wraps. Gaia: underlined tabs on a hairline
      // rule, 20px apart.
      "inline-flex h-auto max-w-full items-center justify-start overflow-x-auto rounded-none bg-transparent p-0 text-muted-foreground",
      "gaia:gap-5 gaia:border-b gaia:border-border",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // The pill: 8% ink wash + strong hairline when active, 4% wash on
      // hover, 12.5px label. Every pair of pills is separated by a 1.5x11px
      // accent-deep tick (the ::before below).
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-[8px] border border-transparent px-[13px] py-[7px]",
      "text-[12.5px] font-medium tracking-[0.2px] transition-all duration-fast",
      "hover:bg-foreground/[0.04] hover:text-foreground/85",
      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-[0.42]",
      "data-[state=active]:border-input data-[state=active]:bg-foreground/[0.08] data-[state=active]:font-semibold data-[state=active]:text-foreground",
      "[&:not(:first-of-type)]:ml-[16px]",
      "[&:not(:first-of-type)]:before:absolute [&:not(:first-of-type)]:before:-left-[9px] [&:not(:first-of-type)]:before:top-1/2 [&:not(:first-of-type)]:before:h-[11px] [&:not(:first-of-type)]:before:w-[1.5px] [&:not(:first-of-type)]:before:-translate-y-1/2 [&:not(:first-of-type)]:before:rounded-[1px] [&:not(:first-of-type)]:before:bg-accent-deep/70 [&:not(:first-of-type)]:before:content-['']",
      // Gaia: underlined, tracked uppercase 11.5px; the row's rule carries
      // the separation, so the ticks disappear.
      "gaia:rounded-none gaia:border-0 gaia:border-b gaia:border-b-transparent gaia:px-0 gaia:pb-3 gaia:pt-0",
      "gaia:text-[11.5px] gaia:font-normal gaia:uppercase gaia:tracking-[0.18em] gaia:-mb-px",
      "gaia:hover:bg-transparent gaia:data-[state=active]:border-b-primary gaia:data-[state=active]:bg-transparent gaia:data-[state=active]:font-normal gaia:data-[state=active]:text-primary",
      "gaia:[&:not(:first-of-type)]:ml-0 gaia:[&:not(:first-of-type)]:before:hidden",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
