"use client";

import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, Loader2, Brain } from 'lucide-react';

interface AnalysisStep {
  label: string;
  detail: string;
}

const ANALYSIS_STEPS: AnalysisStep[] = [
  { label: 'Scanning plan sheets', detail: 'Identifying floor plans, wall sections, and schedules...' },
  { label: 'Measuring living area', detail: 'Finding total heated area and garage square footage...' },
  { label: 'Tracing exterior walls', detail: 'Calculating total perimeter length for gross wall SF...' },
  { label: 'Reading wall details', detail: 'Checking stud size (2x4 vs 2x6) and cavity depth...' },
  { label: 'Counting door openings', detail: 'Measuring exterior doors to deduct from wall SF...' },
  { label: 'Counting window openings', detail: 'Measuring windows to deduct from wall SF...' },
  { label: 'Computing net wall SF', detail: 'Gross wall SF minus doors and windows = insulation area...' },
  { label: 'Calculating ceiling & floor', detail: 'Ceiling SF for blown-in attic, floor SF for crawlspace...' },
  { label: 'Finalizing insulation data', detail: 'Net wall SF, ceiling SF, floor SF, stud size confirmed...' },
];

interface AnalysisPanelProps {
  isActive: boolean;
  isComplete: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export function AnalysisPanel({ isActive, isComplete, hasError, errorMessage }: AnalysisPanelProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visibleMessages, setVisibleMessages] = useState<number[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) {
      setCurrentStep(0);
      setVisibleMessages([]);
      return;
    }

    // Show first message immediately
    setVisibleMessages([0]);
    setCurrentStep(0);

    // Advance through steps on a timer
    let step = 0;
    intervalRef.current = setInterval(() => {
      step++;
      if (step < ANALYSIS_STEPS.length) {
        setCurrentStep(step);
        setVisibleMessages(prev => [...prev, step]);
      } else {
        // Loop back to keep animation going if API is still running
        // Don't reset visible messages, just keep showing them
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      }
    }, 4000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive]);

  useEffect(() => {
    if (isComplete) {
      // Show all steps as complete
      setVisibleMessages(ANALYSIS_STEPS.map((_, i) => i));
      setCurrentStep(ANALYSIS_STEPS.length);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [isComplete]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages]);

  if (!isActive && !isComplete && !hasError) return null;

  const progressPercent = isComplete
    ? 100
    : Math.round((currentStep / ANALYSIS_STEPS.length) * 100);

  return (
    <div className="flex flex-col h-full bg-zinc-900/95 backdrop-blur-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Brain className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Analysis</h3>
            <p className="text-xs text-zinc-500">
              {isComplete
                ? 'Extraction complete'
                : hasError
                  ? 'Extraction failed'
                  : 'Analyzing document...'}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${progressPercent}%`,
              background: hasError
                ? 'rgb(239, 68, 68)'
                : isComplete
                  ? 'rgb(34, 197, 94)'
                  : 'linear-gradient(90deg, rgb(34, 211, 238), rgb(59, 130, 246))',
            }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1.5">{progressPercent}% complete</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
        {visibleMessages.map((stepIndex) => {
          const step = ANALYSIS_STEPS[stepIndex];
          if (!step) return null;
          const isDone = isComplete || stepIndex < currentStep;
          const isCurrent = stepIndex === currentStep && !isComplete;

          return (
            <div
              key={stepIndex}
              className="animate-fade-in-up"
            >
              <div className="flex items-start gap-2.5">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                ) : isCurrent ? (
                  <Loader2 className="h-4 w-4 text-cyan-400 mt-0.5 shrink-0 animate-spin" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-zinc-700 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className={`text-sm font-medium ${isDone ? 'text-zinc-400' : 'text-white'}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {step.detail}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {isComplete && (
          <div className="animate-fade-in-up mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <p className="text-sm text-green-300 font-medium">
                Extraction complete
              </p>
            </div>
            <p className="text-xs text-green-400/70 mt-1 ml-6">
              Redirecting to review...
            </p>
          </div>
        )}

        {hasError && (
          <div className="animate-fade-in-up mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-300 font-medium">
              Extraction failed
            </p>
            {errorMessage && (
              <p className="text-xs text-red-400/70 mt-1">
                {errorMessage}
              </p>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
