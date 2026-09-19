import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      // cardRaised fill (bg-muted is nearly invisible on the card it loads
      // inside), 6px radius, the app's 0.45->1.0 opacity pulse.
      className={cn("animate-skeleton-pulse rounded-[6px] bg-popover", className)}
      {...props}
    />
  )
}

export { Skeleton }
