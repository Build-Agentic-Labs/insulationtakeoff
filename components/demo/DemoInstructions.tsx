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
    <div className="ev-card mb-6 overflow-hidden rounded-[22px]">
      <div
        className="flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--takeoff-paper)]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="ev-icon-box flex h-8 w-8 items-center justify-center rounded-full">
            <Lightbulb className="h-4 w-4 text-[var(--takeoff-accent)]" />
          </div>
          <div>
            <p className="ev-label">Guided Step</p>
            <p className="text-xs text-[var(--takeoff-text-muted)]">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsDismissed(true)
            }}
            className="rounded-[10px] p-1 text-[var(--takeoff-text-subtle)] transition-colors hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
          >
            <X className="w-4 h-4" />
          </button>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="border-t border-[var(--takeoff-line)] pt-3">
            <ol className="space-y-2">
              {steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3 text-sm text-[var(--takeoff-ink)]">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-xs font-semibold text-[var(--takeoff-ink)]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {tip && (
            <div className="rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2 text-xs text-[var(--takeoff-text-muted)]">
              <span className="font-semibold text-[var(--takeoff-ink)]">Tip:</span> {tip}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
