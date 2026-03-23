/**
 * Shared active-mode resolver — single source of truth for Review, Quote, and Project pages.
 *
 * Rules:
 * 1. Persisted mode ALWAYS wins if its backing data exists
 * 2. Auto-detect uses freshness rule (skip stale envelope after failed latest OCR)
 * 3. In-progress runs don't count as successful
 */

export type ActiveMode = 'ocr' | 'vision' | null;

export interface RunInfo {
  id: string;
  mode: 'ocr' | 'vision' | 'hybrid';
  status: string;
  finished_at: string | null;
}

export interface ModeResolution {
  /** The resolved active mode */
  mode: ActiveMode;
  /** True if persisted mode was honored */
  persisted: boolean;
  /** True if showing an older envelope because latest OCR failed */
  staleEnvelope: boolean;
  /** The run that the resolved mode corresponds to (if any) */
  activeRun: RunInfo | null;
  /** The latest failed OCR run (if staleEnvelope is true) */
  failedRun: RunInfo | null;
}

export function resolveActiveMode(opts: {
  persistedMode: ActiveMode;
  runs: RunInfo[];
  hasEnvelope: boolean;
  hasRooms: boolean;
}): ModeResolution {
  const { persistedMode, runs, hasEnvelope, hasRooms } = opts;
  const isEnvelopeMode = (mode: RunInfo['mode']) => mode === 'ocr' || mode === 'hybrid';

  const latestOcrSuccess = runs.find(
    r => isEnvelopeMode(r.mode) && (r.status === 'complete' || r.status === 'review'),
  ) || null;
  const latestVisionSuccess = runs.find(
    r => r.mode === 'vision' && r.status === 'complete',
  ) || null;
  const latestOcrAny = runs.find(r => isEnvelopeMode(r.mode)) || null;

  // Freshness: envelope is "valid" only if the latest OCR run overall is the successful one
  const ocrEnvelopeValid = hasEnvelope && latestOcrSuccess && (
    !latestOcrAny || latestOcrAny.id === latestOcrSuccess.id
  );

  // Detect stale scenario: envelope exists, a successful run exists,
  // but a newer OCR run failed (so latest overall !== latest successful)
  const staleEnvelope = hasEnvelope && !!latestOcrSuccess && !!latestOcrAny
    && latestOcrAny.id !== latestOcrSuccess.id
    && latestOcrAny.status === 'failed';

  const failedRun = staleEnvelope ? latestOcrAny : null;

  // 1. Persisted mode wins if backing data exists
  if (persistedMode === 'ocr' && hasEnvelope) {
    return {
      mode: 'ocr',
      persisted: true,
      staleEnvelope,
      activeRun: latestOcrSuccess,
      failedRun,
    };
  }
  if (persistedMode === 'vision' && hasRooms) {
    return {
      mode: 'vision',
      persisted: true,
      staleEnvelope: false,
      activeRun: latestVisionSuccess,
      failedRun: null,
    };
  }

  // 2. Auto-detect (no persisted choice or persisted has no data)
  if (ocrEnvelopeValid) {
    return { mode: 'ocr', persisted: false, staleEnvelope: false, activeRun: latestOcrSuccess, failedRun: null };
  }
  if (latestVisionSuccess && hasRooms) {
    return { mode: 'vision', persisted: false, staleEnvelope, activeRun: latestVisionSuccess, failedRun };
  }
  if (hasEnvelope) {
    return { mode: 'ocr', persisted: false, staleEnvelope, activeRun: latestOcrSuccess, failedRun };
  }
  if (hasRooms) {
    return { mode: 'vision', persisted: false, staleEnvelope: false, activeRun: null, failedRun: null };
  }

  return { mode: null, persisted: false, staleEnvelope: false, activeRun: null, failedRun: null };
}
