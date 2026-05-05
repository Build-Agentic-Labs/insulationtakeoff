'use client';

import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  CopyPlus,
  MousePointer2,
  Pen,
  Ruler,
  Save,
} from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { saveSession } from '@/lib/takeoff/save-session';
import {
  buildAnticipatedZonesFromPageAnalysis,
  getEvidenceRequirementStatuses,
} from '@/lib/takeoff/workspace-v2';
import {
  BlueprintViewer,
  type BlueprintViewerHandle,
} from '@/components/takeoff/BlueprintViewer';
import { CalibrationOverlay } from '@/components/takeoff/CalibrationOverlay';
import { WallTraceOverlay } from '@/components/takeoff/WallTraceOverlay';
import { WallThicknessOverlay } from '@/components/takeoff/WallThicknessOverlay';
import { SegmentList } from '@/components/takeoff/SegmentList';
import { RunningTotal } from '@/components/takeoff/RunningTotal';
import { useBlueprintPageHotkeys } from '@/components/takeoff/useBlueprintPageHotkeys';
import { ZONE_LABELS, type PageRole, type ZoneType } from '@/lib/types/takeoff';
import type { AiSuggestion, CompletionChecklistItem, Zone as TakeoffZone } from '@/lib/types/takeoff-v2';

interface BlueprintWorkspaceProps {
  pdfUrl: string;
  workflowStage: 'zones' | 'takeoff';
  onOpenReview: () => void;
  showWallThicknessPreview?: boolean;
  wallThicknessPreviewDefaultIn?: 4 | 6 | 8 | 10 | 12;
}

const FUTURE_ZONE_OPTIONS: Array<{
  key: 'exterior' | 'interior' | 'attic' | 'crawlspace';
  label: string;
  status: string;
  enabled: boolean;
  zonePreset?: ZoneType;
}> = [
  { key: 'exterior', label: 'Conditioned Footprint', status: 'Enabled in v1', enabled: true, zonePreset: 'conditioned' },
  { key: 'interior', label: 'Conditioned Split', status: 'Enabled', enabled: true, zonePreset: 'conditioned' },
  { key: 'attic', label: 'Attic', status: 'Planned', enabled: false },
  { key: 'crawlspace', label: 'Crawlspace', status: 'Planned', enabled: false },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="takeoff-label text-[9px] font-semibold tracking-[0.18em] text-[var(--takeoff-text-subtle)]">
      {children}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2.5">
      <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">{label}</div>
      <div className="takeoff-mono mt-1.5 text-[12px] text-[var(--takeoff-ink)]">{value}</div>
    </div>
  );
}

const ZONE_CONTEXT_OPTIONS: ZoneType[] = [
  'conditioned',
  'unconditioned_garage',
  'unconditioned_storage',
  'unconditioned_crawl',
  'unconditioned_attic',
];

function ZoneContextEditorCard({
  zone,
  onUpdate,
}: {
  zone: TakeoffZone;
  onUpdate: (updates: {
    label?: string;
    zoneType?: ZoneType;
    floorLabel?: string | null;
    defaultCeilingHeightFt?: number | null;
    status?: TakeoffZone['status'];
  }) => void;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">{zone.label}</div>
          <div className="mt-1 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
            Thermal boundary + level/height context for later wall and surface takeoff.
          </div>
        </div>
        <span
          className={`takeoff-mono rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${
            zone.status === 'confirmed'
              ? 'border-[#47644a] bg-[#edf5e8] text-[#47644a]'
              : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-muted)]'
          }`}
        >
          {zone.status}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1">
          <span className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Label</span>
          <input
            value={zone.label}
            onChange={(event) => onUpdate({ label: event.target.value })}
            className="w-full rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[12px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Space Type</span>
          <select
            value={zone.zoneType}
            onChange={(event) => onUpdate({ zoneType: event.target.value as ZoneType })}
            className="w-full rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[12px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            {ZONE_CONTEXT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {ZONE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Status</span>
          <select
            value={zone.status}
            onChange={(event) => onUpdate({ status: event.target.value as TakeoffZone['status'] })}
            className="w-full rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[12px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Floor / Level</span>
          <input
            value={zone.floorLabel ?? ''}
            placeholder="Main floor"
            onChange={(event) => onUpdate({ floorLabel: event.target.value || null })}
            className="w-full rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[12px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Default Height</span>
          <input
            type="number"
            min="0"
            step="0.25"
            value={zone.defaultCeilingHeightFt ?? ''}
            placeholder="9"
            onChange={(event) =>
              {
                const nextValue = Number.parseFloat(event.target.value);
                onUpdate({
                  defaultCeilingHeightFt:
                    event.target.value === '' || !Number.isFinite(nextValue) ? null : nextValue,
                });
              }
            }
            className="w-full rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[12px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>
      </div>

      <div className="mt-3 rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2.5 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
        Split zones only when the thermal type, floor/level, or default ceiling height changes materially.
      </div>
    </div>
  );
}

function TaskStep({
  item,
  active,
}: {
  item: CompletionChecklistItem;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-[14px] border px-3 py-2.5 ${
        active
          ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
          : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-medium">{item.label}</div>
        <span
          className={`takeoff-mono rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
            active
              ? 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]'
              : item.status === 'complete'
                ? 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-ink)]'
                : item.status === 'in_progress'
                  ? 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
                  : 'border-[var(--takeoff-line)] bg-transparent text-[var(--takeoff-text-subtle)]'
          }`}
        >
          {item.status.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="mt-1.5 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
        {item.notes}
      </div>
    </div>
  );
}

function CanvasCalibrationPrompt({
  calibrationStep,
  hasCalibration,
  isVerified,
  onStart,
}: {
  calibrationStep: string;
  hasCalibration: boolean;
  isVerified: boolean;
  onStart: () => void;
}) {
  if (isVerified) return null;

  const isInProgress = calibrationStep !== 'idle' && calibrationStep !== 'done';
  const instruction = (() => {
    switch (calibrationStep) {
      case 'primary_a':
        return 'Pick the first endpoint of a known dimension';
      case 'primary_b':
        return 'Pick the second endpoint of this dimension';
      case 'primary_input':
        return 'Enter the known dimension below';
      case 'verify_a':
        return 'Pick the first endpoint of a different dimension';
      case 'verify_b':
        return 'Pick the second endpoint to verify the scale';
      case 'verify_input':
        return 'Enter the verification dimension below';
      default:
        return hasCalibration
          ? 'Use a second dimension to verify the scale before tracing.'
          : 'Measure two known dimensions to set the drawing scale before tracing.';
    }
  })();
  const actionLabel = !hasCalibration
    ? 'Start calibration'
    : isInProgress
      ? null
      : 'Continue calibration';

  if (isInProgress) {
    return (
      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[20rem]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.86)] px-3 py-2 text-[var(--takeoff-ink)] shadow-[0_12px_24px_rgba(31,39,33,0.08)] backdrop-blur-md">
          <div className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--takeoff-ink)]" />
          <div className="takeoff-mono text-[10px] leading-4 text-[var(--takeoff-ink)]">{instruction}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[19rem]">
      <div className="pointer-events-auto rounded-[16px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] px-3 py-2.5 text-[var(--takeoff-ink)] shadow-[0_14px_28px_rgba(31,39,33,0.1)] backdrop-blur-lg">
        <div className="flex items-start gap-3">
          <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--takeoff-warning)]" />
          <div className="min-w-0 flex-1">
            <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">Calibration</div>
            <div className="mt-1 text-[13px] font-medium leading-5">
              {hasCalibration ? 'Verification required' : 'Calibration required'}
            </div>
            <div className="mt-1 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">{instruction}</div>
            {actionLabel && (
              <button
                onClick={onStart}
                className="takeoff-mono mt-2 inline-flex h-7 items-center justify-center rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3 text-[10px] font-semibold text-white transition-colors hover:bg-[#202621]"
              >
                {actionLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PageSwitcherItem({
  active,
  verified,
  title,
  pageLabel,
  roles,
  onClick,
}: {
  active: boolean;
  verified: boolean;
  title: string;
  pageLabel: string;
  roles: PageRole[];
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-[16px] border px-3 py-2.5 text-left transition-all ${
        active
          ? 'border-[var(--takeoff-line-strong)] bg-[rgba(255,255,255,0.94)] text-[var(--takeoff-ink)] shadow-[0_10px_20px_rgba(0,0,0,0.06)]'
          : 'border-[rgba(199,208,195,0.72)] bg-[rgba(255,255,255,0.62)] text-[var(--takeoff-ink)] hover:border-[#9eb29d] hover:bg-[rgba(255,255,255,0.82)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="takeoff-mono text-[10px]">{pageLabel}</div>
          <div className="mt-1 truncate text-[11px] font-medium text-[var(--takeoff-ink)]">{title}</div>
        </div>
        <div className="flex gap-1">
          <span className={`takeoff-mono rounded-full border px-1 py-0.5 text-[7px] ${roles.includes('measurement') ? 'border-current/25 bg-current/8' : 'border-current/15 opacity-40'}`}>
            M
          </span>
          <span className={`takeoff-mono rounded-full border px-1 py-0.5 text-[7px] ${roles.includes('evidence') ? 'border-current/25 bg-current/8' : 'border-current/15 opacity-40'}`}>
            E
          </span>
        </div>
      </div>
      <div className="mt-2 text-[8px] uppercase tracking-[0.16em] text-[var(--takeoff-text-subtle)]">
        {verified ? 'Verified' : 'Pending'}
      </div>
    </button>
  );
}

function SuggestionCard({
  suggestion,
  draftValue,
  onChange,
  onAccept,
  onDismiss,
  onJumpToPage,
}: {
  suggestion: AiSuggestion;
  draftValue: string;
  onChange: (value: string) => void;
  onAccept: () => void;
  onDismiss: () => void;
  onJumpToPage: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-[var(--takeoff-line)] bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-[var(--takeoff-ink)]">{suggestion.label}</div>
          {suggestion.sourceSnippet && (
            <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
              {suggestion.sourceSnippet}
            </div>
          )}
        </div>
        <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2.5 py-1 text-[9px] text-[var(--takeoff-text-muted)]">
          {Math.round(suggestion.confidence * 100)}%
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestion.pageIndex >= 0 && (
          <button
            onClick={onJumpToPage}
            className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-transparent px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d]"
          >
            View page {suggestion.pageIndex + 1}
          </button>
        )}
        {suggestion.fieldLabel && (
          <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] px-2.5 py-1 text-[10px] text-[var(--takeoff-text-subtle)]">
            {suggestion.fieldLabel}
          </span>
        )}
        <span
          className={`takeoff-mono rounded-full border px-2.5 py-1 text-[10px] ${
            suggestion.status === 'pending'
              ? 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
              : 'border-[#dce6d7] bg-[#f5f8f1] text-[#17211c]'
          }`}
        >
          {suggestion.status}
        </span>
      </div>

      <div className="mt-3">
        <label className="takeoff-label text-[10px] font-semibold text-[#8fa28f]">
          Suggested value
        </label>
        <input
          value={draftValue}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2 text-[12px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
        />
      </div>

      {suggestion.evidence.length > 0 && (
        <div className="mt-3 rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
          {suggestion.evidence.join(' • ')}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onAccept}
          className="takeoff-mono rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-[#202621]"
        >
          {draftValue.trim() !== (suggestion.suggestedValue ?? '').trim() ? 'Save edit' : 'Accept'}
        </button>
        <button
          onClick={onDismiss}
          className="takeoff-mono rounded-full border border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] px-3 py-1.5 text-[10px] font-semibold text-[var(--takeoff-warning)] transition-colors hover:border-[var(--takeoff-warning)]/50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function EvidenceStatusCard({
  label,
  description,
  covered,
  pages,
  onJumpToPage,
}: {
  label: string;
  description: string;
  covered: boolean;
  pages: number[];
  onJumpToPage: (pageIndex: number) => void;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">{label}</div>
          <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">{description}</div>
        </div>
        <div
          className={`takeoff-mono rounded-full border px-2.5 py-1 text-[9px] ${
            covered
              ? 'border-[#dce6d7] bg-[#f5f8f1] text-[#17211c]'
              : 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
          }`}
        >
          {covered ? 'covered' : 'missing'}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {pages.length > 0 ? (
          pages.map((pageIndex) => (
            <button
              key={pageIndex}
              onClick={() => onJumpToPage(pageIndex)}
              className="takeoff-mono rounded-full border border-[var(--takeoff-line)] px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d]"
            >
              Page {pageIndex + 1}
            </button>
          ))
        ) : (
          <span className="text-[11px] text-[var(--takeoff-text-subtle)]">No supporting page tagged yet.</span>
        )}
      </div>
    </div>
  );
}

function formatFramingDetails(framing: string[]) {
  if (!framing.length) return null;

  return framing.join(', ');
}

function zoneProvenanceLabel(
  provenance: 'scan_extract' | 'page_inference' | 'mixed',
) {
  switch (provenance) {
    case 'scan_extract':
      return 'Scan-backed';
    case 'mixed':
      return 'Scan + inferred';
    case 'page_inference':
    default:
      return 'Inferred';
  }
}

function zoneProvenanceDescription(
  provenance: 'scan_extract' | 'page_inference' | 'mixed',
) {
  switch (provenance) {
    case 'scan_extract':
      return 'Values below come from explicit vision-scanned notes, details, or callouts.';
    case 'mixed':
      return 'Some zone cues are scan-backed, but part of the scope is still inferred from page roles or geometry.';
    case 'page_inference':
    default:
      return 'This zone is inferred from the scanned page set. Thickness, insulation, and R-value stay blank until the scan finds explicit text or a human adds them later.';
  }
}

export function BlueprintWorkspace({
  pdfUrl,
  workflowStage,
  onOpenReview,
  showWallThicknessPreview = false,
  wallThicknessPreviewDefaultIn = 6,
}: BlueprintWorkspaceProps) {
  const viewerRef = useRef<BlueprintViewerHandle>(null);
  const pageSwitcherRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSessionVersionRef = useRef<string | null>(null);

  const session = useTakeoffStore((s) => s.session);
  const selectedPages = useTakeoffStore((s) => s.selectedPages);
  const activePageIndex = useTakeoffStore((s) => s.activePageIndex);
  const activeViewId = useTakeoffStore((s) => s.activeViewId);
  const setActivePage = useTakeoffStore((s) => s.setActivePage);
  const setActiveView = useTakeoffStore((s) => s.setActiveView);
  const duplicateActiveView = useTakeoffStore((s) => s.duplicateActiveView);
  const setMeasurementBasis = useTakeoffStore((s) => s.setMeasurementBasis);
  const setDrawingPreset = useTakeoffStore((s) => s.setDrawingPreset);
  const setZonePreset = useTakeoffStore((s) => s.setZonePreset);
  const updateZoneObject = useTakeoffStore((s) => s.updateZoneObject);
  const drawingPreset = useTakeoffStore((s) => s.drawingPreset);
  const tool = useTakeoffStore((s) => s.tool);
  const calibrationStep = useTakeoffStore((s) => s.calibrationStep);
  const setTool = useTakeoffStore((s) => s.setTool);
  const startCalibration = useTakeoffStore((s) => s.startCalibration);
  const startTrace = useTakeoffStore((s) => s.startTrace);
  const updateAiSuggestionStatus = useTakeoffStore((s) => s.updateAiSuggestionStatus);
  const getCalibration = useTakeoffStore((s) => s.getCalibration);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, string>>({});
  const [pageTrayOpen, setPageTrayOpen] = useState(false);

  const persistSession = useCallback(async (mode: 'manual' | 'auto' = 'manual') => {
    const currentSession = useTakeoffStore.getState().session;
    if (!currentSession) return;
    setIsSaving(true);
    const ok = await saveSession(currentSession);
    setIsSaving(false);
    if (ok && mode === 'manual') {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  }, []);

  const handleSave = useCallback(async () => {
    await persistSession('manual');
  }, [persistSession]);

  const currentCalibration = getCalibration();
  const isFullyCalibrated = !!currentCalibration?.verification;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const canDrawMeasuredObjects = !!useTakeoffStore.getState().getCalibration()?.verification;

      if (event.key === 'v' || event.key === 'V') setTool('pointer');
      if (event.key === 'z' || event.key === 'Z') {
        setZonePreset('conditioned');
        startTrace('area');
      }
      if (event.key === 'c' || event.key === 'C') startCalibration();
      if ((event.key === 't' || event.key === 'T' || event.key === 'w' || event.key === 'W') && canDrawMeasuredObjects) {
        setDrawingPreset('wall');
        startTrace('linear');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setDrawingPreset, setTool, setZonePreset, startCalibration, startTrace]);

  useEffect(() => {
    if (!pageTrayOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!pageSwitcherRef.current) return;
      if (pageSwitcherRef.current.contains(event.target as Node)) return;
      setPageTrayOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [pageTrayOpen]);

  useEffect(() => {
    if (!session) return;

    const currentVersion = `${session.id}:${session.updatedAt}`;
    const lastVersion = lastSessionVersionRef.current;

    if (!lastVersion || !lastVersion.startsWith(`${session.id}:`)) {
      lastSessionVersionRef.current = currentVersion;
      return;
    }

    if (lastVersion === currentVersion) return;
    lastSessionVersionRef.current = currentVersion;

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      void persistSession('auto');
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [persistSession, session]);

  const cursorMode =
    tool === 'calibrate' || tool === 'trace' || tool === 'auto_detect'
      ? 'crosshair'
      : 'default';
  const showCalibrationOverlay =
    tool === 'calibrate' && calibrationStep !== 'idle' && calibrationStep !== 'done';

  useBlueprintPageHotkeys({
    activePageIndex,
    selectedPages,
    setActivePage,
    disabled: tool === 'trace' || showCalibrationOverlay,
    onBeforeNavigate: () => setPageTrayOpen(false),
  });

  const pageAnalysis = session?.pageAnalysis ?? [];
  const activePageAnalysis = pageAnalysis.find((page) => page.pageIndex === activePageIndex);
  const preferredMeasurementPageIndex =
    pageAnalysis.find((page) => page.roles.includes('measurement'))?.pageIndex ??
    selectedPages[0] ??
    0;
  const activePageIsMeasurement = activePageAnalysis?.roles.includes('measurement') ?? false;
  const activePageViews = (session?.views ?? []).filter((view) => view.pageIndex === activePageIndex);
  const currentView = activePageViews.find((view) => view.id === activeViewId) ?? activePageViews[0];
  const activeWallRuns = (session?.wallRuns ?? []).filter(
    (wallRun) => wallRun.pageIndex === activePageIndex && wallRun.viewId === currentView?.id
  );
  const activeZones = (session?.zones ?? []).filter(
    (zone) => zone.pageIndex === activePageIndex && zone.viewId === currentView?.id
  );
  const confirmedActiveZones = activeZones.filter((zone) => zone.status === 'confirmed');
  const zonesWithHeightContext = activeZones.filter(
    (zone) => typeof zone.defaultCeilingHeightFt === 'number' && zone.defaultCeilingHeightFt > 0
  );
  const activeSurfaces = (session?.surfaces ?? []).filter(
    (surface) => surface.pageIndex === activePageIndex && surface.viewId === currentView?.id
  );
  const verifiedPages = selectedPages.filter((pageIndex) => {
    const calibration = session?.calibrations[pageIndex];
    return !!calibration?.verification;
  }).length;
  const evidenceStatuses = getEvidenceRequirementStatuses(pageAnalysis);
  const anticipatedZones = buildAnticipatedZonesFromPageAnalysis(pageAnalysis);
  const anticipatedZoneMap = new Map(anticipatedZones.map((zone) => [zone.key, zone]));
  const activeSuggestions = (session?.aiSuggestions ?? [])
    .filter((suggestion) => suggestion.pageIndex === activePageIndex || suggestion.pageIndex === -1)
    .sort((a, b) => {
      const pendingA = a.status === 'pending' ? -1 : 1;
      const pendingB = b.status === 'pending' ? -1 : 1;
      if (pendingA !== pendingB) return pendingA - pendingB;
      return b.confidence - a.confidence;
    });
  const activePageTitle =
    activePageAnalysis?.title?.trim() ||
    currentView?.name?.replace(/\s*\/\s*Primary View$/i, '').trim() ||
    `Page ${activePageIndex + 1}`;
  const currentViewLabel = currentView?.isPrimary ? 'Primary View' : currentView?.name;

  const activeTask = (() => {
    if (!activePageIsMeasurement && preferredMeasurementPageIndex !== activePageIndex) {
      return {
        key: 'switch_measurement',
        title: 'Return to a measurement page',
        description: 'Exterior zone drawing, calibration, and perimeter tracing should stay on a tagged measurement page.',
        actionLabel: 'Open measurement page',
        actionIcon: MousePointer2,
        action: () => {
          setActivePage(preferredMeasurementPageIndex);
          setTool('pointer');
        },
        isActionActive: tool === 'pointer',
      };
    }

    if (workflowStage === 'zones') {
      return {
        key: 'zone_selection',
        title: confirmedActiveZones.length > 0 ? 'Verify zone context before takeoff' : 'Draw the conditioned footprint first',
        description: confirmedActiveZones.length > 0
          ? 'Confirm the thermal type, floor/level, and default height for each major zone before moving into takeoff.'
          : 'Start with one coarse conditioned zone, then add only major unconditioned or height-changing spaces that affect scope.',
        actionLabel: confirmedActiveZones.length > 0 ? 'Edit zone context' : 'Draw conditioned zone',
        actionIcon: CircleDot,
        action: () => {
          setZonePreset('conditioned');
          startTrace('area');
        },
        isActionActive: tool === 'trace' && drawingPreset === 'zone',
      };
    }

    if (confirmedActiveZones.length === 0) {
      return {
        key: 'zone_selection',
        title: 'Draw the conditioned footprint first',
        description: 'Start with one coarse conditioned zone, then add only major unconditioned or height-changing spaces that affect scope.',
        actionLabel: 'Draw conditioned zone',
        actionIcon: CircleDot,
        action: () => {
          setZonePreset('conditioned');
          startTrace('area');
        },
        isActionActive: tool === 'trace' && drawingPreset === 'zone',
      };
    }

    if (!currentCalibration?.verification) {
      return {
        key: 'calibration',
        title: 'Verify scale for this measurement page',
        description: 'Keep the current calibration workflow intact, but gate it after zone confirmation.',
        actionLabel: currentCalibration ? 'Complete verification' : 'Start calibration',
        actionIcon: Ruler,
        action: () => startCalibration(),
        isActionActive: tool === 'calibrate',
      };
    }

    if (activeWallRuns.length === 0) {
      return {
        key: 'perimeter_trace',
        title: 'Trace the exterior perimeter',
        description: 'Capture one closed perimeter first, then refine its segments in the review rail.',
        actionLabel: 'Trace exterior perimeter',
        actionIcon: Pen,
        action: () => {
          setDrawingPreset('wall');
          startTrace('linear');
        },
        isActionActive: tool === 'trace' && drawingPreset === 'wall',
      };
    }

    return {
      key: 'segment_review',
      title: 'Review segment properties',
      description: 'Clear wall review flags and confirm the right assemblies, heights, and openings.',
      actionLabel: 'Review current takeoff',
      actionIcon: MousePointer2,
      action: () => setTool('pointer'),
      isActionActive: tool === 'pointer',
    };
  })();

  const handleSuggestionDraftChange = useCallback((suggestionId: string, value: string) => {
    setSuggestionDrafts((current) => ({
      ...current,
      [suggestionId]: value,
    }));
  }, []);

  const handleAcceptSuggestion = useCallback((suggestion: AiSuggestion) => {
    const draft = (suggestionDrafts[suggestion.id] ?? suggestion.appliedValue ?? suggestion.suggestedValue ?? '').trim();
    const suggested = (suggestion.suggestedValue ?? '').trim();
    updateAiSuggestionStatus(
      suggestion.id,
      draft !== suggested ? 'edited' : 'accepted',
      draft || undefined
    );
  }, [suggestionDrafts, updateAiSuggestionStatus]);

  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    updateAiSuggestionStatus(suggestionId, 'dismissed');
  }, [updateAiSuggestionStatus]);

  return (
    <div className="takeoff-shell takeoff-light-theme h-full overflow-hidden text-[var(--takeoff-ink)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.82)] px-4 py-2 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <h1 className="truncate text-[16px] font-medium tracking-[-0.03em] text-[var(--takeoff-ink)]">
                {activePageTitle}
              </h1>
              {currentView && currentViewLabel && (
                <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2 py-0.5 text-[8px] font-medium text-[var(--takeoff-text-subtle)]">
                  {currentViewLabel}
                </span>
              )}
              <span
                className={`takeoff-mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-medium ${
                  currentCalibration?.verification
                    ? 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                    : currentCalibration
                      ? 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
                      : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-subtle)]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    currentCalibration?.verification
                      ? 'bg-[var(--takeoff-ink)]'
                      : currentCalibration
                        ? 'bg-[var(--takeoff-warning)]'
                        : 'bg-[var(--takeoff-text-subtle)]'
                  }`}
                />
                {currentCalibration?.verification
                  ? 'Scale verified'
                  : currentCalibration
                    ? 'Needs verification'
                    : 'Calibration required'}
              </span>
            </div>

	            <div className="flex flex-wrap items-center gap-1">
	              <select
	                value={session?.measurementBasis ?? 'exterior_face'}
	                onChange={(event) =>
                  setMeasurementBasis(
                    event.target.value as
                      | 'exterior_face'
                      | 'stud_line'
                      | 'centerline'
                      | 'sheathing_line'
                  )
                }
                aria-label="Measurement basis"
                title="Measurement basis"
                className="takeoff-mono h-7 rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 text-[8px] font-medium text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--takeoff-ink)]/10"
              >
                <option value="exterior_face">Exterior Face</option>
                <option value="stud_line">Stud Line</option>
                <option value="centerline">Centerline</option>
                <option value="sheathing_line">Sheathing Line</option>
              </select>

              <button
                onClick={handleSave}
                disabled={isSaving}
                className="takeoff-mono flex h-7 items-center gap-1 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-2.5 text-[8px] font-semibold text-white transition-colors hover:bg-[#202621] disabled:cursor-wait disabled:opacity-70"
              >
                {saveSuccess ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <Save className="h-2.5 w-2.5" />
                )}
                {isSaving ? 'Saving…' : saveSuccess ? 'Saved' : 'Save Session'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-3">
          <div className="relative h-full overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.74)] shadow-[0_30px_72px_rgba(31,39,33,0.12)] xl:grid xl:grid-cols-[minmax(0,1fr)_352px] xl:gap-3 xl:p-3">
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[rgba(255,255,255,0.92)] to-transparent" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[rgba(255,255,255,0.92)] to-transparent" />

            <div className="relative h-full min-h-0">
              <CanvasCalibrationPrompt
                calibrationStep={calibrationStep}
                hasCalibration={!!currentCalibration}
                isVerified={isFullyCalibrated}
                onStart={startCalibration}
              />

	              <div ref={pageSwitcherRef} className="absolute bottom-3 left-3 z-20">
                {pageTrayOpen && (
                  <div className="mb-2 w-[280px] overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] p-2 shadow-[0_18px_36px_rgba(31,39,33,0.16)] backdrop-blur-xl">
                    <div className="mb-2 flex items-center justify-between px-1 pb-1">
                      <div>
                        <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">Page Switcher</div>
                        <div className="mt-1 text-[12px] font-medium text-[var(--takeoff-ink)]">
                          Jump between takeoff pages
                        </div>
                      </div>
                      <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-1 text-[9px] text-[var(--takeoff-text-subtle)]">
                        {selectedPages.length} pages
                      </div>
                    </div>
                    <div className="takeoff-hide-scrollbar max-h-[320px] space-y-2 overflow-y-auto pr-1">
                      {selectedPages.map((pageIndex) => {
                        const calibration = session?.calibrations[pageIndex];
                        const page = pageAnalysis.find((item) => item.pageIndex === pageIndex);
                        const pageTitle = page?.title?.trim() || `Page ${pageIndex + 1}`;
                        return (
                          <PageSwitcherItem
                            key={pageIndex}
                            active={pageIndex === activePageIndex}
                            verified={!!calibration?.verification}
                            title={pageTitle}
                            pageLabel={`P${pageIndex + 1}`}
                            roles={page?.roles ?? []}
                            onClick={() => {
                              setActivePage(pageIndex);
                              setPageTrayOpen(false);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setPageTrayOpen((current) => !current)}
                  className="flex h-11 items-center gap-2 rounded-full border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] px-3.5 text-[11px] font-medium text-[var(--takeoff-ink)] shadow-[0_12px_24px_rgba(31,39,33,0.12)] backdrop-blur-xl transition-colors hover:border-[#9eb29d]"
                >
                  <div className="flex min-w-0 flex-col text-left">
                    <span className="takeoff-mono text-[9px] text-[var(--takeoff-text-subtle)]">Pages</span>
                    <span className="truncate text-[11px] font-medium">
                      P{activePageIndex + 1} · {activePageTitle}
                    </span>
                  </div>
                  <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[9px] text-[var(--takeoff-text-subtle)]">
                    {verifiedPages}/{selectedPages.length}
                  </div>
                  {pageTrayOpen ? (
                    <ChevronDown className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
                  ) : (
                    <ChevronUp className="h-4 w-4 rotate-180 text-[var(--takeoff-text-subtle)]" />
                  )}
	                </button>
	              </div>

	              <div className="absolute inset-0 z-10 overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[var(--takeoff-canvas)] shadow-[0_18px_36px_rgba(31,39,33,0.12)]">
                <div className="takeoff-dot-grid h-full overflow-hidden rounded-[8px] bg-[var(--takeoff-canvas)]">
                  <BlueprintViewer
                    ref={viewerRef}
                    pdfUrl={pdfUrl}
                    pageNumber={activePageIndex + 1}
                    cursorMode={cursorMode}
                  >
                    {(dims) => (
                      <>
                        {showWallThicknessPreview && (
                          <WallThicknessOverlay
                            viewerRef={viewerRef}
                            pageWidth={dims.width}
                            pageHeight={dims.height}
                            defaultThicknessIn={wallThicknessPreviewDefaultIn}
                          />
                        )}
                        <WallTraceOverlay
                          viewerRef={viewerRef}
                          pageWidth={dims.width}
                          pageHeight={dims.height}
                          pdfUrl={pdfUrl}
                        />

                        {showCalibrationOverlay && (
                          <CalibrationOverlay
                            viewerRef={viewerRef}
                            pageWidth={dims.width}
                            pageHeight={dims.height}
                          />
                        )}
                      </>
                    )}
                  </BlueprintViewer>
                </div>
              </div>
            </div>

            <div className="relative z-20 hidden min-h-0 xl:block">
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.94)] text-[var(--takeoff-ink)] shadow-[0_18px_36px_rgba(31,39,33,0.12)] backdrop-blur-xl">
                <div className="border-b border-[var(--takeoff-line)] px-4 py-4">
                  <SectionLabel>Current Task</SectionLabel>
                  <div className="mt-2 text-[16px] font-medium">{activeTask.title}</div>
                  <div className="mt-2 text-[12px] leading-5 text-[var(--takeoff-text-muted)]">{activeTask.description}</div>

                  <button
                    onClick={activeTask.action}
                    className="takeoff-mono mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] py-2.5 text-[11px] font-semibold text-white"
                  >
                    <activeTask.actionIcon className="h-3.5 w-3.5" />
                    {activeTask.actionLabel}
                  </button>

                  {activeTask.key === 'zone_selection' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {FUTURE_ZONE_OPTIONS.map((option) => {
                        const anticipated = anticipatedZoneMap.get(option.key);
                        const statusText = anticipated
                          ? zoneProvenanceLabel(anticipated.provenance)
                          : option.status;

                        return (
                          <div
                            key={option.key}
                            className={`rounded-full border px-3 py-1.5 ${
                              anticipated
                                ? 'border-[#47644a] bg-[#edf5e8] text-[var(--takeoff-ink)]'
                                : option.enabled
                                  ? 'border-[#47644a] bg-[#edf5e8] text-[var(--takeoff-ink)]'
                                  : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-subtle)]'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="text-[11px] font-medium">{option.label}</div>
                              <span className="takeoff-mono text-[9px]">{statusText}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {activeTask.key !== 'zone_selection' && (
                    <div className="mt-4 space-y-1.5">
                      {(session?.completionChecklist ?? []).map((item) => (
                        <TaskStep key={item.id} item={item} active={item.scope === activeTask.key} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  {activeTask.key === 'zone_selection' ? (
                    <div className="space-y-4">
                      <section>
                        <SectionLabel>How Zones Work</SectionLabel>
                        <div className="mt-2 rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-3 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                          Draw zones as coarse space containers, not detailed takeoff geometry. Use one zone whenever the space type, floor/level, or default ceiling height changes. Later wall takeoff uses that context to understand what each wall separates.
                          <div className="takeoff-mono mt-3 rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2.5 text-[10px] text-[var(--takeoff-ink)]">
                            Wall SF = traced wall length × inherited height − openings
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2.5">
                          <MetricPill label="Pages ready" value={`${selectedPages.length}`} />
                          <MetricPill label="AI hints" value={`${anticipatedZones.length}`} />
                          <MetricPill label="Zones on page" value={`${activeZones.length}`} />
                          <MetricPill label="Heights tagged" value={`${zonesWithHeightContext.length}`} />
                        </div>
                        <div className="mt-3 space-y-3">
                          {anticipatedZones.length > 0 ? (
                            anticipatedZones.map((zone) => {
                              const option = FUTURE_ZONE_OPTIONS.find((item) => item.key === zone.key);
                              const framingDetails = formatFramingDetails(zone.wallFraming);
                              const rValueSummary = (zone.rValueDetails.length > 0 ? zone.rValueDetails : zone.rValues)
                                .slice(0, 3)
                                .join(', ');
                              const insulationSummary = zone.insulationTypes.slice(0, 2).join(', ');

                              return (
                                <div
                                  key={zone.key}
                                  className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-4"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-[13px] font-medium text-[var(--takeoff-ink)]">
                                        {zone.label}
                                      </div>
                                      <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                                        {zone.evidence[0] ?? zoneProvenanceDescription(zone.provenance)}
                                      </div>
                                      <div className="mt-1 text-[10px] leading-4 text-[var(--takeoff-text-subtle)]">
                                        Use this only as a starting hint. You still define the actual zone polygon, level, and default height.
                                      </div>
                                    </div>
                                    <span
                                      className={`takeoff-mono rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                                        zone.provenance !== 'page_inference'
                                          ? 'border-[#47644a] bg-[#edf5e8] text-[#47644a]'
                                          : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-muted)]'
                                      }`}
                                    >
                                      {zoneProvenanceLabel(zone.provenance)}
                                    </span>
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    <div className="rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2.5">
                                      <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Wall Thickness</div>
                                      <div className="mt-1 text-[11px] text-[var(--takeoff-ink)]">
                                        {framingDetails ??
                                          (zone.provenance === 'page_inference'
                                            ? 'Only shown when explicit scan text is found'
                                            : 'No explicit wall thickness scanned')}
                                      </div>
                                    </div>
                                    <div className="rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2.5">
                                      <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">R-Value</div>
                                      <div className="mt-1 text-[11px] text-[var(--takeoff-ink)]">
                                        {rValueSummary ||
                                          (zone.provenance === 'page_inference'
                                            ? 'Only shown when explicit scan text is found'
                                            : 'No explicit R-value scanned')}
                                      </div>
                                    </div>
                                  </div>

                                  {insulationSummary && (
                                    <div className="mt-2 rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2.5 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                                      {`Insulation: ${insulationSummary}`}
                                    </div>
                                  )}

                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {zone.scanBackedPageIndexes.map((pageIndex) => (
                                      <button
                                        key={`${zone.key}-scan-${pageIndex}`}
                                        onClick={() => setActivePage(pageIndex)}
                                        className="takeoff-mono rounded-full border border-[#47644a] bg-[#edf5e8] px-2.5 py-1 text-[10px] text-[#47644a] transition-colors hover:border-[#355239]"
                                      >
                                        Scan page {pageIndex + 1}
                                      </button>
                                    ))}
                                    {zone.inferredPageIndexes.map((pageIndex) => (
                                      <button
                                        key={`${zone.key}-inferred-${pageIndex}`}
                                        onClick={() => setActivePage(pageIndex)}
                                        className="takeoff-mono rounded-full border border-[var(--takeoff-line)] px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d]"
                                      >
                                        Review page {pageIndex + 1}
                                      </button>
                                    ))}
                                    {option?.enabled && (
                                      <button
                                        onClick={() => {
                                          if (zone.pageIndexes[0] !== undefined) {
                                            setActivePage(zone.pageIndexes[0]);
                                          }
                                          if (option.zonePreset) {
                                            setZonePreset(option.zonePreset);
                                          }
                                          startTrace('area');
                                        }}
                                        className="takeoff-mono rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-2.5 py-1 text-[10px] font-semibold text-white"
                                      >
                                        Start zone from this hint
                                      </button>
                                    )}
                                  </div>

                                  {!option?.enabled && (
                                    <div className="mt-2 text-[10px] leading-4 text-[var(--takeoff-text-subtle)]">
                                      This zone is anticipated by the scan, but its dedicated workflow is still planned for a later version.
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-4 text-[11px] leading-5 text-[var(--takeoff-text-subtle)]">
                              The scan did not find strong zone cues yet. You can still draw the conditioned footprint manually, then add only major garage, crawlspace, attic, storage, or height-change zones.
                            </div>
                          )}

                          {activeZones.length > 0 && (
                            <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-4">
                              <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">Drawn zones on this page</div>
                              <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                                After drawing a zone, tag what kind of space it is, what floor/level it belongs to, and the default ceiling height you want walls to inherit later.
                              </div>
                              <div className="mt-3 space-y-3">
                                {activeZones.map((zone) => (
                                  <ZoneContextEditorCard
                                    key={zone.id}
                                    zone={zone}
                                    onUpdate={(updates) => updateZoneObject(zone.id, updates)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {activeZones.length === 0 && (
                            <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-4 text-[11px] leading-5 text-[var(--takeoff-text-subtle)]">
                              No zones drawn on this page yet. Start with one coarse conditioned zone, then split only when the space type, floor/level, or default ceiling height changes.
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <section>
                        <SectionLabel>Zone Details</SectionLabel>
                        <div className="mt-3 grid grid-cols-2 gap-2.5">
                          <MetricPill label="Zones" value={`${activeZones.length}`} />
                          <MetricPill label="Wall runs" value={`${activeWallRuns.length}`} />
                          <MetricPill label="Surfaces" value={`${activeSurfaces.length}`} />
                          <MetricPill label="Verified pages" value={`${verifiedPages}/${selectedPages.length || 0}`} />
                        </div>
                        <div className="mt-3 space-y-2">
                          {confirmedActiveZones.length > 0 ? (
                            confirmedActiveZones.map((zone) => (
                              <div key={zone.id} className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">{zone.label}</div>
                                  <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2.5 py-0.5 text-[9px] text-[var(--takeoff-ink)]">
                                    {ZONE_LABELS[zone.zoneType]}
                                  </div>
                                </div>
                                <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                                  {[
                                    zone.floorLabel ? `Level: ${zone.floorLabel}` : null,
                                    zone.defaultCeilingHeightFt
                                      ? `Height: ${zone.defaultCeilingHeightFt.toFixed(2).replace(/\.00$/, '')} ft`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ') || 'Zone polygons are workflow containers. The exterior perimeter remains a separate measured object.'}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-subtle)]">
                              No confirmed exterior zone on this page yet.
                            </div>
                          )}
                        </div>
                      </section>

                      <section>
                      <SectionLabel>AI Suggestions</SectionLabel>
                      <div className="mt-3 space-y-3">
                        {activeSuggestions.length > 0 ? (
                          activeSuggestions.map((suggestion) => (
                            <SuggestionCard
                              key={suggestion.id}
                              suggestion={suggestion}
                              draftValue={
                                suggestionDrafts[suggestion.id] ??
                                suggestion.appliedValue ??
                                suggestion.suggestedValue ??
                                ''
                              }
                              onChange={(value) => handleSuggestionDraftChange(suggestion.id, value)}
                              onAccept={() => handleAcceptSuggestion(suggestion)}
                              onDismiss={() => handleDismissSuggestion(suggestion.id)}
                              onJumpToPage={() => {
                                if (suggestion.pageIndex >= 0) {
                                  setActivePage(suggestion.pageIndex);
                                }
                              }}
                            />
                          ))
                        ) : (
                          <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-subtle)]">
                            No active suggestion cards for this page yet.
                          </div>
                        )}
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between gap-3">
                        <SectionLabel>Evidence</SectionLabel>
                        <button
                          onClick={() => setEvidenceOpen((current) => !current)}
                          className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] text-[var(--takeoff-text-muted)]"
                        >
                          {evidenceOpen ? 'Collapse' : 'Expand'}
                        </button>
                      </div>

                      {evidenceOpen && (
                        <div className="mt-3 space-y-3">
                          {evidenceStatuses.map((status) => (
                            <EvidenceStatusCard
                              key={status.requirement}
                              label={status.label}
                              description={status.description}
                              covered={status.satisfied}
                              pages={status.pageIndexes}
                              onJumpToPage={setActivePage}
                            />
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <SectionLabel>Object Properties</SectionLabel>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activePageViews.map((view) => (
                          <button
                            key={view.id}
                            onClick={() => setActiveView(view.id)}
                            className={`takeoff-mono rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors ${
                              currentView?.id === view.id
                                ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
                                : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] hover:border-[#9eb29d]'
                            }`}
                          >
                            {view.name}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => duplicateActiveView()}
                        className="takeoff-mono mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] py-2.5 text-[11px] font-semibold text-[var(--takeoff-ink)]"
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                        Duplicate view
                      </button>

                      <div className="mt-4 rounded-[20px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                        {activeTask.key === 'segment_review' ? (
                          <div className="max-h-[420px] overflow-y-auto px-3 py-3">
                            <SegmentList />
                          </div>
                        ) : (
                          <div className="px-4 py-4 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                            {activeTask.key === 'zone_selection'
                              ? 'Zone drawing is active. Confirm the conditioned footprint first, then add only major unconditioned or height-changing zones before wall takeoff.'
                              : activeTask.key === 'calibration'
                                ? 'Calibration tools are available. Existing calibration behavior stays unchanged in this version.'
                                : activeTask.key === 'perimeter_trace'
                                  ? 'Perimeter tracing is active. Trace one closed exterior run, then return here for segment review.'
                                  : 'Switch back to a tagged measurement page to continue the guided workflow.'}
                          </div>
                        )}
                      </div>
                    </section>
                    </div>
                  )}
                </div>

                <div className="border-t border-[var(--takeoff-line)]">
                  <RunningTotal
                    onOpenReview={onOpenReview}
                    showReviewAction={workflowStage === 'takeoff'}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
