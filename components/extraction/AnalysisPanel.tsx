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

type OcrOutcome = 'none' | 'complete' | 'review' | 'failed';

interface AnalysisPanelProps {
  isActive: boolean;
  isComplete: boolean;
  hasError: boolean;
  errorMessage?: string;
  ocrOutcome?: OcrOutcome;
}

export function AnalysisPanel({ isActive, isComplete, hasError, errorMessage, ocrOutcome = 'none' }: AnalysisPanelProps) {
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

  if (!isActive && !isComplete && !hasError && ocrOutcome === 'none') return null;

  const isOcrReview = ocrOutcome === 'review';
  const isOcrFailed = ocrOutcome === 'failed';

  const progressPercent = isComplete
    ? 100
    : isOcrReview
      ? 100
      : Math.round((currentStep / ANALYSIS_STEPS.length) * 100);

  return (
    <div className="flex h-full flex-col bg-[#122019]/95 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-[rgba(216,222,212,0.12)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[12px] border border-[rgba(216,222,212,0.14)] bg-[rgba(245,248,241,0.08)]">
            <Brain className="h-4 w-4 text-[#d4a843]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Analysis</h3>
            <p className="text-xs text-[#8ea08f]">
              {isComplete
                ? 'Automated takeoff complete'
                : isOcrReview
                  ? 'Automated takeoff finished — review recommended'
                  : isOcrFailed
                    ? 'Automated takeoff could not complete'
                    : hasError
                      ? 'Automated takeoff failed'
                      : 'Analyzing document...'}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(245,248,241,0.08)]">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${progressPercent}%`,
              background: hasError || isOcrFailed
                ? 'rgb(239, 68, 68)'
                : isComplete
                  ? 'rgb(142, 177, 109)'
                  : isOcrReview
                    ? 'rgb(212, 168, 67)'
                    : 'linear-gradient(90deg, rgb(214, 230, 216), rgb(142, 177, 109))',
            }}
          />
        </div>
        <p className="mt-1.5 text-xs text-[#8ea08f]">{progressPercent}% complete</p>
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
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#8eb16d]" />
                ) : isCurrent ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#d4a843]" />
                ) : (
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-[rgba(216,222,212,0.14)]" />
                )}
                <div>
                  <p className={`text-sm font-medium ${isDone ? 'text-[#b6c5b5]' : 'text-white'}`}>
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[#8ea08f]">
                    {step.detail}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {isComplete && (
          <div className="animate-fade-in-up mt-4 rounded-[14px] border border-[#8eb16d]/20 bg-[#8eb16d]/10 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#8eb16d]" />
              <p className="text-sm font-medium text-[#dfe6db]">
                Automated takeoff complete
              </p>
            </div>
            <p className="ml-6 mt-1 text-xs text-[#b6c5b5]">
              Redirecting to review...
            </p>
          </div>
        )}

        {hasError && !isOcrReview && (
          <div className="animate-fade-in-up mt-4 rounded-[14px] border border-[#d71921]/20 bg-[#d71921]/10 p-3">
            <p className="text-sm font-medium text-[#ffb8bd]">
              {isOcrFailed ? 'Automated takeoff could not complete' : 'Automated takeoff failed'}
            </p>
            {errorMessage && (
              <p className="mt-1 text-xs text-[#ffb8bd]/75">
                {errorMessage}
              </p>
            )}
            {isOcrFailed && (
              <p className="mt-2 text-xs text-[#8ea08f]">
                Use the button above to retry automated takeoff.
              </p>
            )}
          </div>
        )}

        {isOcrReview && (
          <div className="animate-fade-in-up mt-4 rounded-[14px] border border-[#d4a843]/20 bg-[#d4a843]/10 p-3">
            <p className="text-sm font-medium text-[#f0c763]">
              Automated takeoff finished — needs review
            </p>
            <p className="mt-1 text-xs text-[#f0c763]/75">
              Scope data was extracted, but some fields still need verification in review.
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
