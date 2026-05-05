'use client';

import { useTakeoffStore } from '@/lib/stores/takeoff-store';

export function CalibrationBanner() {
  const getCalibration = useTakeoffStore((s) => s.getCalibration);
  const recalibrate = useTakeoffStore((s) => s.recalibrate);
  const startCalibration = useTakeoffStore((s) => s.startCalibration);
  const calibrationStep = useTakeoffStore((s) => s.calibrationStep);

  const cal = getCalibration();
  const hasVerification = !!cal?.verification;

  // ── No calibration yet ─────────────────────────────────────────────────────
  if (!cal && calibrationStep === 'idle') {
    return (
      <div className="border-b border-[var(--takeoff-line)] bg-[rgba(15,16,17,0.03)] px-5 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--takeoff-warning)]" />
            <span className="takeoff-mono text-[10px] font-medium text-[var(--takeoff-ink)]">
              Calibration required — measure two known dimensions to set the scale
            </span>
          </div>
          <button
            onClick={startCalibration}
            className="takeoff-mono rounded-full border border-[var(--takeoff-ink)] px-3 py-1 text-[9px] font-semibold text-[var(--takeoff-ink)] transition-colors hover:bg-black/5"
          >
            Start Calibration
          </button>
        </div>
      </div>
    );
  }

  // ── Calibration in progress — no data yet ──────────────────────────────────
  if (!cal && calibrationStep !== 'idle') {
    const isPrimaryPhase = calibrationStep.startsWith('primary');
    return (
      <div className="border-b border-[var(--takeoff-line)] bg-[rgba(0,0,0,0.03)] px-5 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-[var(--takeoff-ink)] animate-pulse" />
          <span className="takeoff-mono text-[10px] font-medium text-[var(--takeoff-ink)]">
            {isPrimaryPhase ? 'Step 1: Click two endpoints of a known dimension' : 'Setting up calibration...'}
          </span>
        </div>
      </div>
    );
  }

  if (!cal) return null;

  // ── Primary done, needs verification ───────────────────────────────────────
  if (!hasVerification) {
    const isVerifying = calibrationStep.startsWith('verify');
    return (
      <div className="border-b border-[var(--takeoff-line)] bg-[rgba(0,0,0,0.03)] px-5 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[var(--takeoff-ink)] animate-pulse" />
            <span className="takeoff-mono text-[10px] font-medium text-[var(--takeoff-ink)]">
              {isVerifying
                ? 'Step 2: Click two endpoints of a DIFFERENT dimension to verify'
                : 'Step 2: Verify with a second dimension for accuracy'}
            </span>
          </div>
          {!isVerifying && (
            <button
              onClick={startCalibration}
              className="takeoff-mono rounded-full border border-[var(--takeoff-ink)] px-3 py-1 text-[9px] font-semibold text-[var(--takeoff-ink)] transition-colors hover:bg-black/5"
            >
              Continue Calibration
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Fully calibrated (verified) ────────────────────────────────────────────
  const confidenceColors = {
    high: { bg: 'bg-[rgba(15,16,17,0.04)]', border: 'border-[var(--takeoff-line)]', dot: 'bg-[var(--takeoff-ink)]', text: 'text-[var(--takeoff-ink)]', meta: 'text-[var(--takeoff-text-subtle)]' },
    good: { bg: 'bg-[rgba(15,16,17,0.04)]', border: 'border-[var(--takeoff-line)]', dot: 'bg-[var(--takeoff-ink)]', text: 'text-[var(--takeoff-ink)]', meta: 'text-[var(--takeoff-text-subtle)]' },
    low:  { bg: 'bg-[rgba(212,168,67,0.08)]', border: 'border-[var(--takeoff-line)]', dot: 'bg-[var(--takeoff-warning)]', text: 'text-[var(--takeoff-ink)]', meta: 'text-[var(--takeoff-warning)]' },
  };

  const colors = confidenceColors[cal.confidence];
  const ppf = cal.pdfPointsPerFoot.toFixed(2);
  const variance = cal.variancePercent !== undefined
    ? `±${cal.variancePercent.toFixed(1)}%`
    : '';

  return (
    <div className={`flex items-center gap-2 border-b px-5 py-2 ${colors.bg} ${colors.border}`}>
      <div className={`h-2 w-2 rounded-full ${colors.dot}`} />
      <span className={`takeoff-mono text-[10px] font-medium ${colors.text}`}>
        Scale: {ppf} pts/ft
      </span>
      <span className={`takeoff-mono text-[9px] ${colors.meta}`}>
        {cal.confidence === 'high' && `High confidence (${variance})`}
        {cal.confidence === 'good' && `Good confidence (${variance})`}
        {cal.confidence === 'low' && `Low confidence (${variance}) — dimensions may not agree`}
      </span>
      <span className={`takeoff-mono text-[9px] ${colors.meta}`}>
        Verified with 2 dimensions
      </span>
      <button
        onClick={recalibrate}
        className={`takeoff-mono ml-auto rounded-full border border-[var(--takeoff-line)] px-3 py-1 text-[9px] ${colors.text} transition-colors hover:bg-black/5`}
      >
        Recalibrate
      </button>
    </div>
  );
}
