import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/10 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_10px_28px_rgba(31,39,33,0.16)] hover:bg-[#202621]",
        destructive:
          "bg-[var(--takeoff-accent)] text-white shadow-sm hover:bg-[#be1520]",
        outline:
          "border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)] shadow-sm hover:border-[var(--takeoff-line-strong)] hover:bg-[var(--takeoff-paper)]",
        secondary:
          "bg-[var(--takeoff-paper)] text-[var(--takeoff-ink)] shadow-sm hover:bg-[var(--takeoff-paper-strong)]",
        ghost: "text-[var(--takeoff-text-muted)] hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]",
        link: "text-[var(--takeoff-ink)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
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
