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
            className={`inline-flex items-center justify-center rounded-full w-4 h-4 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors ${className}`}
          >
            <Info className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs bg-zinc-800 border border-cyan-500/30 text-zinc-200"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
