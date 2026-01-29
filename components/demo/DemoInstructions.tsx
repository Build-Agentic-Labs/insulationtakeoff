"use client"

import { useState } from "react"
import { Lightbulb, ChevronDown, ChevronUp, X } from "lucide-react"

interface DemoInstructionsProps {
  title: string
  steps: string[]
  tip?: string
}

export function DemoInstructions({ title, steps, tip }: DemoInstructionsProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isDismissed, setIsDismissed] = useState(false)

  if (isDismissed) return null

  return (
    <div className="bg-gradient-to-r from-cyan-950/50 to-zinc-900/50 border border-cyan-500/20 rounded-lg mb-6 overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-cyan-500/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500/20">
            <Lightbulb className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-cyan-300">Demo Mode</p>
            <p className="text-xs text-zinc-400">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsDismissed(true)
            }}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="border-t border-cyan-500/10 pt-3">
            <ol className="space-y-2">
              {steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3 text-sm text-zinc-300">
                  <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-medium">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {tip && (
            <div className="bg-zinc-800/50 rounded-md px-3 py-2 text-xs text-zinc-400">
              <span className="text-cyan-400 font-medium">Tip:</span> {tip}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
