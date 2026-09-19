import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The app's button voices (fork_button.dart / GaiaButton):
 *  - default  = ForkButton primary: vertical accent-hi -> accent-mid gradient,
 *    on-accent ink, 10px radius, a growing accent-shadow glow. Hover swaps
 *    the bottom stop to the base and widens the shadow. Under Gaia the
 *    gradient/shadow give way to the hairline champagne box with a tracked
 *    uppercase label.
 *  - outline  = the app's GHOST: hairline strong border, transparent fill,
 *    5% ink wash on hover.
 *  - ghost    = the app's SUBTLE: borderless, hover-only wash ("View all").
 *  - disabled = 42% opacity — a control that cannot act must look like one.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-[0.42] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 gaia:uppercase gaia:tracking-[0.2em]",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-accent-hi to-accent-mid text-accent-on shadow-[0_4px_10px_hsl(var(--accent-shadow)/0.5)] hover:to-accent-base hover:shadow-[0_4px_18px_hsl(var(--accent-shadow)/0.5)] gaia:[background:hsl(var(--primary))] gaia:hover:[background:hsl(var(--accent-foreground))] gaia:text-primary-foreground gaia:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 gaia:bg-transparent gaia:border gaia:border-destructive gaia:text-destructive gaia:hover:bg-destructive/10",
        outline:
          "border border-input bg-transparent hover:bg-foreground/5 hover:text-foreground gaia:border-primary gaia:text-primary gaia:hover:bg-primary/10",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-foreground/5 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 text-[13px] font-semibold tracking-[0.2px]",
        sm: "h-8 rounded-sm px-3 text-xs font-semibold",
        lg: "h-11 rounded-sm px-8",
        /** The one or two hero actions a sheet exists for — never a toolbar. */
        xl: "h-[52px] rounded-sm px-6 text-[15px] font-semibold",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
