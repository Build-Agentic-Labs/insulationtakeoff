'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';

type TakeoffGuideFlowStep = 'analysis' | 'zones' | 'workspace' | 'summary';
type TourPlacement = 'left' | 'right' | 'top' | 'bottom' | 'center';

interface TourStep {
  id: string;
  flowStep?: TakeoffGuideFlowStep;
  selector?: string;
  fallbackSelector?: string;
  virtualTarget?: 'bottom-right';
  placement?: TourPlacement;
  eyebrow: string;
  title: string;
  body: string;
  lockedBody?: string;
}

interface TourRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TakeoffGuideTourProps {
  currentStep: TakeoffGuideFlowStep | 'page-selection';
  sessionReady: boolean;
  replaySignal: number;
  onGoToStep: (step: TakeoffGuideFlowStep) => void;
}

const STORAGE_KEY = 'insulation-takeoff-guide-dismissed-v1';
const CARD_WIDTH = 360;
const CARD_MIN_HEIGHT = 220;
const VIEWPORT_PADDING = 16;
const SPOTLIGHT_PADDING = 8;

const TOUR_STEPS: TourStep[] = [
  {
    id: 'flow',
    selector: '[data-tour="takeoff-flow"]',
    placement: 'bottom',
    eyebrow: 'Process',
    title: 'Follow the takeoff sequence',
    body: 'Work left to right: Vision, Areas, Takeoff, then Review. The guide can move with you when each step is unlocked.',
  },
  {
    id: 'vision',
    flowStep: 'analysis',
    selector: '[data-tour="vision-ai-review"]',
    fallbackSelector: '[data-tour="takeoff-step-analysis"]',
    placement: 'left',
    eyebrow: 'Vision',
    title: 'AI reads the plan set first',
    body: 'Vision suggests which pages are primary takeoff pages and which pages are support evidence. Review the suggestions before continuing.',
  },
  {
    id: 'vision-pages',
    flowStep: 'analysis',
    selector: '[data-tour="vision-page-cards"]',
    fallbackSelector: '[data-tour="takeoff-step-analysis"]',
    placement: 'right',
    eyebrow: 'User Check',
    title: 'Confirm the page roles',
    body: 'Keep floor plans as Primary Takeoff. Keep sections, schedules, notes, and details as Support Page. Clear anything that does not help the estimate.',
  },
  {
    id: 'areas',
    flowStep: 'zones',
    selector: '[data-tour="areas-ai-suggestions"]',
    fallbackSelector: '[data-tour="takeoff-step-zones"]',
    placement: 'right',
    eyebrow: 'Areas',
    title: 'Use AI area suggestions as a starting point',
    body: 'The app can suggest likely areas and the best page to start from. The user still calibrates, traces, names, and confirms the area.',
    lockedBody: 'Finish Vision first to unlock Areas. When you get here, use the suggestions as a starting point and confirm them manually.',
  },
  {
    id: 'calibration',
    flowStep: 'zones',
    virtualTarget: 'bottom-right',
    placement: 'left',
    eyebrow: 'Calibration',
    title: 'Find scale in the lower-right area',
    body: 'Use the lower-right area as the general place to look for scale guidance during the takeoff. Click Scale or Cal., pick two endpoints on a known dimension, enter the real length, then confirm the scale before tracing.',
    lockedBody: 'Finish Vision first. Calibration happens before measuring: click Scale or Cal., pick two endpoints on a known dimension, enter the real length, and verify it.',
  },
  {
    id: 'area-tools',
    flowStep: 'zones',
    selector: '[data-tour="areas-primary-tools"]',
    fallbackSelector: '[data-tour="takeoff-step-zones"]',
    placement: 'right',
    eyebrow: 'Area Tools',
    title: 'Trace the building areas',
    body: 'Use Select to inspect an area, Cal. to calibrate the current page, and Area to trace the zone boundary.',
    lockedBody: 'After Vision, this is where users choose Select, Cal., or Area to build the estimate zones.',
  },
  {
    id: 'takeoff-tools',
    flowStep: 'workspace',
    selector: '[data-tour="takeoff-primary-tools"]',
    fallbackSelector: '[data-tour="takeoff-step-workspace"]',
    placement: 'right',
    eyebrow: 'Takeoff',
    title: 'Pick the measurement tool',
    body: 'Use 6 inch wall, 4 inch wall, Surface, Roof, Win scan, and Door scan after selecting the right area.',
    lockedBody: 'Finish Areas first to unlock Takeoff. This is where the actual measured quantities are created.',
  },
  {
    id: 'tool-panel',
    flowStep: 'workspace',
    selector: '[data-tour="takeoff-tool-panel"]',
    fallbackSelector: '[data-tour="takeoff-step-workspace"]',
    placement: 'right',
    eyebrow: 'Tool Panel',
    title: 'The panel changes with the selected tool',
    body: 'This panel shows the active settings and actions: trace, apply, scan, save, complete, undo, continue, or delete depending on the tool.',
    lockedBody: 'In Takeoff, this panel changes based on the active tool and shows the actions users need next.',
  },
  {
    id: 'review',
    flowStep: 'summary',
    selector: '[data-tour="takeoff-step-summary"]',
    fallbackSelector: '[data-tour="takeoff-flow"]',
    placement: 'bottom',
    eyebrow: 'Review',
    title: 'Review before quote',
    body: 'Before generating the quote, check quantities, units, specs, deductions, and manual rows. AI does not approve the final quote.',
    lockedBody: 'After the takeoff, Review is the final estimator check before sending the customer quote.',
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeFlowStep(step: TakeoffGuideFlowStep | 'page-selection'): TakeoffGuideFlowStep {
  return step === 'page-selection' ? 'analysis' : step;
}

function getVirtualTargetRect(target: TourStep['virtualTarget']): TourRect | null {
  if (typeof window === 'undefined' || !target) return null;

  if (target === 'bottom-right') {
    const width = clamp(Math.round(window.innerWidth * 0.26), 230, 340);
    const height = clamp(Math.round(window.innerHeight * 0.22), 140, 210);
    return {
      left: window.innerWidth - width - 28,
      top: window.innerHeight - height - 58,
      width,
      height,
    };
  }

  return null;
}

function getElementRect(selector: string | undefined): TourRect | null {
  if (typeof document === 'undefined' || !selector) return null;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function resolveStepRect(step: TourStep, isLocked: boolean): TourRect | null {
  if (step.virtualTarget && !isLocked) {
    return getVirtualTargetRect(step.virtualTarget);
  }

  return (
    getElementRect(isLocked ? step.fallbackSelector : step.selector) ??
    getElementRect(step.fallbackSelector) ??
    getVirtualTargetRect(step.virtualTarget)
  );
}

function resolveCardPosition(rect: TourRect | null, placement: TourPlacement | undefined) {
  if (typeof window === 'undefined') {
    return { left: 24, top: 24, placement: 'center' as TourPlacement };
  }

  const width = Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
  const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
  const maxTop = window.innerHeight - CARD_MIN_HEIGHT - VIEWPORT_PADDING;

  if (!rect || placement === 'center') {
    return {
      left: clamp((window.innerWidth - width) / 2, VIEWPORT_PADDING, maxLeft),
      top: clamp((window.innerHeight - CARD_MIN_HEIGHT) / 2, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, maxTop)),
      placement: 'center' as TourPlacement,
    };
  }

  const resolvedPlacement =
    placement ??
    (rect.left > window.innerWidth / 2
      ? 'left'
      : rect.top > window.innerHeight / 2
        ? 'top'
        : 'right');

  if (resolvedPlacement === 'left') {
    return {
      left: clamp(rect.left - width - 18, VIEWPORT_PADDING, maxLeft),
      top: clamp(rect.top + rect.height / 2 - CARD_MIN_HEIGHT / 2, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, maxTop)),
      placement: resolvedPlacement,
    };
  }

  if (resolvedPlacement === 'right') {
    return {
      left: clamp(rect.left + rect.width + 18, VIEWPORT_PADDING, maxLeft),
      top: clamp(rect.top + rect.height / 2 - CARD_MIN_HEIGHT / 2, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, maxTop)),
      placement: resolvedPlacement,
    };
  }

  if (resolvedPlacement === 'top') {
    return {
      left: clamp(rect.left + rect.width / 2 - width / 2, VIEWPORT_PADDING, maxLeft),
      top: clamp(rect.top - CARD_MIN_HEIGHT - 18, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, maxTop)),
      placement: resolvedPlacement,
    };
  }

  return {
    left: clamp(rect.left + rect.width / 2 - width / 2, VIEWPORT_PADDING, maxLeft),
    top: clamp(rect.top + rect.height + 18, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, maxTop)),
    placement: resolvedPlacement,
  };
}

function arrowClassName(placement: TourPlacement) {
  const base = 'absolute h-3 w-3 rotate-45 border-[var(--takeoff-line)] bg-white';
  if (placement === 'left') {
    return `${base} right-[-7px] top-1/2 -translate-y-1/2 border-r border-t`;
  }
  if (placement === 'right') {
    return `${base} left-[-7px] top-1/2 -translate-y-1/2 border-b border-l`;
  }
  if (placement === 'top') {
    return `${base} bottom-[-7px] left-1/2 -translate-x-1/2 border-b border-r`;
  }
  if (placement === 'bottom') {
    return `${base} left-1/2 top-[-7px] -translate-x-1/2 border-l border-t`;
  }
  return '';
}

export function TakeoffGuideTour({
  currentStep,
  sessionReady,
  replaySignal,
  onGoToStep,
}: TakeoffGuideTourProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  const autoStartedRef = useRef(false);

  const activeStep = TOUR_STEPS[activeIndex] ?? TOUR_STEPS[0];
  const normalizedCurrentStep = normalizeFlowStep(currentStep);
  const stepIsLocked = Boolean(
    activeStep.flowStep &&
      activeStep.flowStep !== 'analysis' &&
      !sessionReady,
  );
  const cardPosition = useMemo(
    () => resolveCardPosition(targetRect, activeStep.placement),
    [activeStep.placement, targetRect],
  );

  const updateTargetRect = useCallback(() => {
    setTargetRect(resolveStepRect(activeStep, stepIsLocked));
  }, [activeStep, stepIsLocked]);

  const closeAndPersist = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setOpen(false);
  }, []);

  const openTour = useCallback((startIndex = 0) => {
    setActiveIndex(startIndex);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || autoStartedRef.current) return;
    autoStartedRef.current = true;

    if (window.localStorage.getItem(STORAGE_KEY) === '1') return;

    const timer = window.setTimeout(() => openTour(0), 650);
    return () => window.clearTimeout(timer);
  }, [openTour]);

  useEffect(() => {
    if (replaySignal <= 0) return;
    openTour(0);
  }, [openTour, replaySignal]);

  useEffect(() => {
    if (!open || !activeStep.flowStep) return;
    if (activeStep.flowStep === normalizedCurrentStep) return;
    if (activeStep.flowStep !== 'analysis' && !sessionReady) return;

    onGoToStep(activeStep.flowStep);
  }, [activeStep.flowStep, normalizedCurrentStep, onGoToStep, open, sessionReady]);

  useEffect(() => {
    if (!open) return;

    const updateSoon = window.setTimeout(updateTargetRect, 90);
    const handleUpdate = () => updateTargetRect();

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);

    return () => {
      window.clearTimeout(updateSoon);
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [open, updateTargetRect]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndPersist();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeAndPersist, open]);

  const goPrevious = () => {
    setActiveIndex((current) => Math.max(0, current - 1));
  };

  const goNext = () => {
    setActiveIndex((current) => Math.min(TOUR_STEPS.length - 1, current + 1));
  };

  if (!open) return null;

  const isLastStep = activeIndex === TOUR_STEPS.length - 1;
  const spotlightStyle = targetRect
    ? {
        left: targetRect.left - SPOTLIGHT_PADDING,
        top: targetRect.top - SPOTLIGHT_PADDING,
        width: targetRect.width + SPOTLIGHT_PADDING * 2,
        height: targetRect.height + SPOTLIGHT_PADDING * 2,
      }
    : undefined;

  return (
    <div aria-live="polite" className="fixed inset-0 z-[95]">
      <div className="pointer-events-none absolute inset-0 bg-[rgba(20,24,20,0.46)] backdrop-blur-[1px]" />

      {spotlightStyle && (
        <div
          className="pointer-events-none fixed rounded-[16px] border border-white/85 bg-white/5 shadow-[0_0_0_9999px_rgba(20,24,20,0.42),0_0_0_4px_rgba(255,255,255,0.18),0_24px_80px_rgba(0,0,0,0.26)] transition-[left,top,width,height] duration-200"
          style={spotlightStyle}
        />
      )}

      <section
        role="dialog"
        aria-modal="true"
        aria-label="Takeoff guide"
        className="fixed w-[min(360px,calc(100vw-32px))] rounded-[18px] border border-[var(--takeoff-line)] bg-white p-4 text-[var(--takeoff-ink)] shadow-[0_26px_80px_rgba(0,0,0,0.28)]"
        style={{ left: cardPosition.left, top: cardPosition.top }}
      >
        {cardPosition.placement !== 'center' && (
          <span aria-hidden="true" className={arrowClassName(cardPosition.placement)} />
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
              {activeStep.eyebrow} · {activeIndex + 1} of {TOUR_STEPS.length}
            </div>
            <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.035em] text-[var(--takeoff-ink)]">
              {activeStep.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeAndPersist}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--takeoff-line)] text-[var(--takeoff-text-muted)] transition-colors hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
            aria-label="Dismiss guide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-[13px] leading-6 text-[var(--takeoff-text-muted)]">
          {stepIsLocked && activeStep.lockedBody ? activeStep.lockedBody : activeStep.body}
        </p>

        {stepIsLocked && (
          <div className="mt-3 rounded-[12px] border border-[rgba(212,168,67,0.32)] bg-[rgba(212,168,67,0.09)] px-3 py-2 text-[11px] leading-5 text-[#7a5b19]">
            This part unlocks after the previous step is complete. You can keep reading the guide now or dismiss it and replay it later.
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--takeoff-line)] pt-3">
          <button
            type="button"
            onClick={closeAndPersist}
            className="takeoff-mono rounded-[10px] border border-transparent px-2 py-1.5 text-[10px] font-semibold text-[var(--takeoff-text-muted)] transition-colors hover:border-[var(--takeoff-line)] hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
          >
            Dismiss
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrevious}
              disabled={activeIndex === 0}
              className="flex h-8 items-center gap-1 rounded-[10px] border border-[var(--takeoff-line)] bg-white px-2.5 text-[11px] font-medium text-[var(--takeoff-ink)] transition-colors hover:bg-[var(--takeoff-paper)] disabled:cursor-not-allowed disabled:text-[var(--takeoff-text-subtle)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
            {isLastStep ? (
              <button
                type="button"
                onClick={closeAndPersist}
                className="flex h-8 items-center gap-1.5 rounded-[10px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#202621]"
              >
                <Check className="h-3.5 w-3.5" />
                Finish
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="flex h-8 items-center gap-1.5 rounded-[10px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#202621]"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
