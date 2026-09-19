import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // The app's input recipe: recessed inset fill, quiet 7% hairline,
          // hint in tertiary ink; focus = the border becomes the accent at
          // 50% (no ring, no offset halo).
          "flex h-10 w-full rounded-md border border-border bg-inset px-3 py-2 text-base transition-colors duration-fast file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-tertiary focus-visible:outline-none focus-visible:border-[hsl(var(--primary)/0.5)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm gaia:rounded-[2px] gaia:border-input gaia:bg-transparent",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
