"use client"

import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface DemoTooltipProps {
  children: React.ReactNode
  className?: string
}

export function DemoTooltip({ children, className }: DemoTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`inline-flex h-4 w-4 items-center justify-center rounded-[6px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-muted)] transition-colors hover:bg-white hover:text-[var(--takeoff-ink)] ${className}`}
          >
            <Info className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)] shadow-[0_18px_36px_rgba(31,39,33,0.16)]"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
