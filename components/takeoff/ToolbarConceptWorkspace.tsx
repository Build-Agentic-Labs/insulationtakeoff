'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  MousePointer2,
  PenLine,
  Pentagon,
  Ruler,
  ScanSearch,
  Trash2,
} from 'lucide-react';
import {
  BlueprintViewer,
  type BlueprintViewerHandle,
  type SnapDebugEntry,
} from '@/components/takeoff/BlueprintViewer';
import { CalibrationOverlay } from '@/components/takeoff/CalibrationOverlay';
import { RoofPitchToolOverlay } from '@/components/takeoff/RoofPitchToolOverlay';
import { WallThicknessOverlay } from '@/components/takeoff/WallThicknessOverlay';
import { WallTraceOverlay } from '@/components/takeoff/WallTraceOverlay';
import { DoorToolOverlay } from '@/components/takeoff/DoorToolOverlay';
import { WindowToolOverlay } from '@/components/takeoff/WindowToolOverlay';
import { useBlueprintPageHotkeys } from '@/components/takeoff/useBlueprintPageHotkeys';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import {
  SURFACE_PRESET_OPTIONS,
  getSurfacePreset,
  getWallPreset,
  type SurfacePresetKey,
  type WallPresetKey,
} from '@/lib/takeoff/presets';
import {
  computeSlopedAreaSf,
  formatRoofPitch,
  parseRoofPitchText,
} from '@/lib/takeoff/roof-pitch';
import {
  calibratedLength,
  deriveZoneLifecycleState,
  formatFeetInches,
  getZoneMissingData,
  normalizeZoneType,
  openingAreaSf,
  parseDimensionToFeet,
  traceAreaSf,
  traceTotalLf,
  type Calibration,
  type Opening,
  type OpeningType,
  type PdfPoint,
  type ZoneCeilingType,
  type ZoneType,
  ZONE_COLORS,
  ZONE_LABELS,
} from '@/lib/types/takeoff';

interface ToolbarConceptWorkspaceProps {
  pdfUrl: string;
}

type WindowToolMode = 'idle' | 'capture' | 'place';
type DoorToolMode = 'idle' | 'capture' | 'place';
type RoofPitchToolMode = 'idle' | 'capture';
type MatrixToolPanel = 'select' | 'scale' | 'wall6' | 'wall4' | 'surface' | 'roof' | 'window' | 'door';

interface GestureDebugEntry {
  timestamp: number;
  source: string;
  action: string;
  deltaMode?: number | null;
  deltaX?: number | null;
  deltaY?: number | null;
  wheelDeltaY?: number | null;
  ctrlKey?: boolean | null;
  metaKey?: boolean | null;
  firesTouchEvents?: boolean | null;
  scaleBefore?: number | null;
  scaleAfter?: number | null;
  scrollLeft?: number | null;
  scrollTop?: number | null;
  scrollLeftBefore?: number | null;
  scrollLeftAfter?: number | null;
  scrollTopBefore?: number | null;
  scrollTopAfter?: number | null;
  href?: string | null;
}

const GESTURE_DEBUG_STORAGE_KEY = '__takeoffGestureDebugLog';
const GESTURE_DEBUG_LOG_LIMIT = 120;
const SHOW_TAKEOFF_DEBUG_OVERLAYS = process.env.NEXT_PUBLIC_TAKEOFF_DEBUG_OVERLAYS === '1';

const DOOR_TYPE_LABELS: Record<Exclude<OpeningType, 'window'>, string> = {
  door: 'Door',
  french_door: 'French Door',
  garage_door: 'Garage Door',
  sliding_door: 'Sliding Door',
  door_opening: 'Door Opening',
};

const ZONE_MODAL_LABELS: Record<ZoneCeilingType, string> = {
  flat: 'Flat',
  vaulted: 'Vaulted',
};

function zoneNeedsHeight(zoneType: ZoneType) {
  return zoneType === 'conditioned' || zoneType === 'unconditioned_garage' || zoneType === 'unconditioned_storage';
}

function readStoredGestureDebugLog(): GestureDebugEntry[] {
  if (typeof window === 'undefined') return [];
  const stored = (
    window as Window & {
      [GESTURE_DEBUG_STORAGE_KEY]?: unknown;
    }
  )[GESTURE_DEBUG_STORAGE_KEY];

  return Array.isArray(stored) ? (stored as GestureDebugEntry[]) : [];
}

function writeStoredGestureDebugLog(entries: GestureDebugEntry[]) {
  if (typeof window === 'undefined') return;
  (
    window as Window & {
      [GESTURE_DEBUG_STORAGE_KEY]?: GestureDebugEntry[];
    }
  )[GESTURE_DEBUG_STORAGE_KEY] = entries;
}

function zoneNeedsCeilingType(zoneType: ZoneType) {
  return zoneType === 'conditioned' || zoneType === 'unconditioned_attic';
}

function zoneNeedsInsulationType(zoneType: ZoneType) {
  return zoneType === 'unconditioned_crawl' || zoneType === 'unconditioned_attic';
}

function zoneShowsFloorLabel(zoneType: ZoneType) {
  return zoneType === 'conditioned' || zoneType === 'unconditioned_garage' || zoneType === 'unconditioned_storage';
}

function zoneStatusCopy(zoneType: ZoneType, missing: string[]) {
  if (missing.length === 0) {
    switch (zoneType) {
      case 'unconditioned_crawl':
      case 'unconditioned_attic':
        return 'Complete · insulation data ready';
      case 'conditioned':
        return 'Complete · height context ready';
      case 'unconditioned_garage':
      case 'unconditioned_storage':
        return 'Complete · shared-wall context ready';
      default:
        return 'Complete';
    }
  }

  return `Needs ${missing.join(' and ')}`;
}

function zoneLifecycleLabel(zone: {
  zoneType: ZoneType;
  defaultCeilingHeightFt?: number | null;
  ceilingType?: ZoneCeilingType | null;
  insulationType?: string | null;
  rValue?: string | null;
  takeoffStatus?: 'pending' | 'complete' | null;
}) {
  const lifecycle = deriveZoneLifecycleState(zone);
  if (lifecycle === 'incomplete') return 'incomplete';
  if (lifecycle === 'needs_takeoff') return 'needs takeoff';
  return 'complete';
}

function formatZoneMeta(zone: {
  label: string;
  pageIndex: number;
  zoneType: ZoneType;
  floorLabel?: string | null;
  defaultCeilingHeightFt?: number | null;
  ceilingType?: ZoneCeilingType | null;
  insulationType?: string | null;
  rValue?: string | null;
  polygon: PdfPoint[];
}, calibration?: Calibration | null): string[] {
  const parts = [`P${zone.pageIndex + 1}`];

  if (zoneShowsFloorLabel(zone.zoneType) && zone.floorLabel) {
    parts.push(`Level ${zone.floorLabel}`);
  }

  if (zoneNeedsHeight(zone.zoneType) && zone.defaultCeilingHeightFt) {
    parts.push(`${zone.defaultCeilingHeightFt.toFixed(2).replace(/\.00$/, '')} ft ceiling`);
  }

  if (zoneNeedsCeilingType(zone.zoneType) && zone.ceilingType) {
    parts.push(ZONE_MODAL_LABELS[zone.ceilingType]);
  }

  if (zoneNeedsInsulationType(zone.zoneType) && zone.insulationType?.trim()) {
    parts.push(zone.insulationType.trim());
  }

  const normalizedRValue = zone.rValue?.trim();
  if (normalizedRValue && normalizedRValue !== zone.insulationType?.trim()) {
    parts.push(normalizedRValue);
  }

  if (zoneNeedsInsulationType(zone.zoneType) && calibration && zone.polygon.length >= 3) {
    const areaSf = traceAreaSf(
      {
        id: `zone-meta-${zone.pageIndex}`,
        pageIndex: zone.pageIndex,
        type: 'area',
        points: zone.polygon,
        isClosed: true,
        isLocked: true,
        label: zone.label,
      },
      calibration,
    );
    parts.push(`${Math.round(areaSf).toLocaleString('en-US')} SF`);
  }

  return parts;
}

interface ZoneWallMetrics {
  wallCount: number;
  totalLf: number;
  totalGrossSf: number;
}

interface ZoneCatalogOpeningBreakdown {
  key: string;
  label: string;
  kindLabel: string;
  widthLabel: string | null;
  heightLabel: string | null;
  quantity: number;
  totalAreaSf: number;
}

type ZoneCatalogMath =
  | {
      kind: 'wall';
      grossSf: number;
      openingSf: number;
      netSf: number;
      openingGroups: ZoneCatalogOpeningBreakdown[];
    }
  | {
      kind: 'area';
      areaLabel: string;
      areaSf: number;
    };

interface ZoneLayerWallEntry {
  kind: 'wall';
  id: string;
  wallRunId: string;
  label: string;
  descriptor: string;
  hidden: boolean;
  selected: boolean;
}

interface ZoneLayerOpeningEntry {
  kind: 'opening';
  id: string;
  wallRunId: string;
  label: string;
  descriptor: string;
  openingType: OpeningType;
  widthFt: number | null;
  heightFt: number | null;
  quantity: number;
}

interface OpeningLayerEditTarget {
  wallRunId: string;
  openingType: OpeningType;
  widthFt: number | null;
  heightFt: number | null;
  label: string;
}

function formatCompactNumber(value: number) {
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

function formatCompactDimensionFt(value: number) {
  const totalInches = Math.max(0, Math.round(value * 12));
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  if (inches === 0) {
    return `${feet}'`;
  }

  return `${feet}'${inches}"`;
}

function formatSnapDebugDistance(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} pt`;
}

function SnapDebugPanel() {
  const [latestSnapDebug, setLatestSnapDebug] = useState<SnapDebugEntry | null>(null);

  useEffect(() => {
    const handleSnapDebug = (event: Event) => {
      const detail = (event as CustomEvent<SnapDebugEntry>).detail;
      if (!detail) return;
      setLatestSnapDebug(detail);
    };

    window.addEventListener('takeoff-snap-debug', handleSnapDebug as EventListener);
    return () => {
      window.removeEventListener('takeoff-snap-debug', handleSnapDebug as EventListener);
    };
  }, []);

  return (
    <div className="pointer-events-auto overflow-hidden border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_14px_28px_rgba(31,39,33,0.14)]">
      <div className="border-b border-[var(--takeoff-line)] px-3 py-2">
        <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
          Snap Debug
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--takeoff-text-muted)]">
          See whether a missed corner was absent from the backend or rejected locally.
        </div>
      </div>
      <div className="px-3 py-2">
        {latestSnapDebug ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">
                {latestSnapDebug.outcome === 'snapped'
                  ? 'Snapped'
                  : latestSnapDebug.outcome === 'no_snap_data'
                    ? 'No snap data'
                    : latestSnapDebug.outcome === 'disabled'
                      ? 'Snap bypassed'
                      : latestSnapDebug.outcome === 'no_candidates'
                        ? 'No candidate in range'
                        : 'Ambiguous cluster'}
              </div>
              <div className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-2 py-0.5 text-[9px] text-[var(--takeoff-text-subtle)]">
                {latestSnapDebug.source}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2">
                <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Threshold</div>
                <div className="takeoff-mono mt-1 text-[11px] text-[var(--takeoff-ink)]">
                  {formatSnapDebugDistance(latestSnapDebug.thresholdPts)}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2">
                <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Candidates</div>
                <div className="takeoff-mono mt-1 text-[11px] text-[var(--takeoff-ink)]">
                  {latestSnapDebug.candidateCount}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2">
                <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Known Points</div>
                <div className="takeoff-mono mt-1 text-[11px] text-[var(--takeoff-ink)]">
                  {latestSnapDebug.totalSnapPoints}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2">
                <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Significant Lines</div>
                <div className="takeoff-mono mt-1 text-[11px] text-[var(--takeoff-ink)]">
                  {latestSnapDebug.significantLines}
                </div>
              </div>
            </div>
            <div className="mt-2 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
              <div>
                Nearest known point:{' '}
                <span className="takeoff-mono text-[var(--takeoff-ink)]">
                  {formatSnapDebugDistance(latestSnapDebug.nearestKnown?.dist)}
                </span>
                {latestSnapDebug.nearestKnown
                  ? ` · ${latestSnapDebug.nearestKnown.point.connections}-way`
                  : ''}
              </div>
              {latestSnapDebug.bestCandidate && (
                <div className="mt-1">
                  Best candidate:{' '}
                  <span className="takeoff-mono text-[var(--takeoff-ink)]">
                    {formatSnapDebugDistance(latestSnapDebug.bestCandidate.dist)}
                  </span>
                  {` · ${latestSnapDebug.bestCandidate.connections}-way`}
                </div>
              )}
              {latestSnapDebug.runnerUpCandidate && (
                <div className="mt-1">
                  Runner-up:{' '}
                  <span className="takeoff-mono text-[var(--takeoff-ink)]">
                    {formatSnapDebugDistance(latestSnapDebug.runnerUpCandidate.dist)}
                  </span>
                  {` · ${latestSnapDebug.runnerUpCandidate.connections}-way`}
                </div>
              )}
              {typeof latestSnapDebug.distanceDelta === 'number' &&
                typeof latestSnapDebug.candidateSeparation === 'number' && (
                  <div className="mt-1">
                    Delta / separation:{' '}
                    <span className="takeoff-mono text-[var(--takeoff-ink)]">
                      {formatSnapDebugDistance(latestSnapDebug.distanceDelta)} /{' '}
                      {formatSnapDebugDistance(latestSnapDebug.candidateSeparation)}
                    </span>
                  </div>
                )}
            </div>
            {latestSnapDebug.topCandidates.length > 0 && (
              <div className="mt-2 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2">
                <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Top nearby candidates</div>
                <div className="mt-1.5 space-y-1">
                  {latestSnapDebug.topCandidates.map((candidate, index) => (
                    <div
                      key={`${candidate.x}:${candidate.y}:${index}`}
                      className="flex items-center justify-between gap-2 text-[9px] text-[var(--takeoff-text-muted)]"
                    >
                      <span className="takeoff-mono">
                        #{index + 1} · {candidate.connections}-way · {candidate.x.toFixed(1)},{' '}
                        {candidate.y.toFixed(1)}
                      </span>
                      <span className="takeoff-mono text-[var(--takeoff-ink)]">
                        {formatSnapDebugDistance(candidate.dist)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-[10px] leading-5 text-[var(--takeoff-text-muted)]">
            Move over the plan to inspect the last snap decision.
          </div>
        )}
      </div>
    </div>
  );
}

function formatWallLayerMetrics(lengthFt: number | null, rValue?: string | null) {
  const parts: string[] = [];

  if (lengthFt && lengthFt > 0) {
    parts.push(`${formatCompactNumber(lengthFt)} LF`);
  }

  if (rValue?.trim()) {
    parts.push(rValue.trim());
  }

  return parts.join(' | ');
}

interface WallMetricsData {
  lfLabel: string;
  sfLabel: string | null;
}

function formatZoneWallMetrics(
  zone: {
    zoneType: ZoneType;
    defaultCeilingHeightFt?: number | null;
  },
  metrics?: ZoneWallMetrics | null,
): WallMetricsData | null {
  if (!metrics || metrics.totalLf <= 0) return null;

  return {
    lfLabel: `${formatCompactNumber(metrics.totalLf)} LF walls`,
    sfLabel:
      zoneNeedsHeight(zone.zoneType) && zone.defaultCeilingHeightFt && metrics.totalGrossSf > 0
        ? `${Math.round(metrics.totalGrossSf)} SF`
        : null,
  };
}

function formatOpeningLayerLabel(opening: {
  type: OpeningType;
  widthFt?: number;
  heightFt?: number;
  label?: string;
}) {
  if (opening.label?.trim()) return opening.label.trim();

  if (opening.type === 'window') {
    if (opening.widthFt && opening.heightFt) {
      return `${formatFeetInches(opening.widthFt)} x ${formatFeetInches(opening.heightFt)} window`;
    }
    return 'Window';
  }

  if (opening.widthFt && opening.heightFt) {
    return formatDoorCatalogLabel(opening.type, opening.widthFt, opening.heightFt);
  }

  return DOOR_TYPE_LABELS[opening.type];
}

function formatOpeningMathLabel(opening: {
  type: OpeningType;
  widthFt?: number | null;
  heightFt?: number | null;
  label?: string | null;
}) {
  if (opening.type === 'window') {
    if (opening.widthFt && opening.heightFt) {
      return `Window ${formatCompactDimensionFt(opening.widthFt)} x ${formatCompactDimensionFt(opening.heightFt)}`;
    }
    return opening.label?.trim() || 'Window';
  }

  if (opening.widthFt && opening.heightFt) {
    return `Door ${formatCompactDimensionFt(opening.widthFt)} x ${formatCompactDimensionFt(opening.heightFt)}`;
  }

  return 'Door';
}

function formatOpeningMathParts(opening: {
  type: OpeningType;
  widthFt?: number | null;
  heightFt?: number | null;
  label?: string | null;
}) {
  const kindLabel = opening.type === 'window' ? 'Window' : 'Door';
  const widthLabel =
    typeof opening.widthFt === 'number' && Number.isFinite(opening.widthFt)
      ? formatCompactDimensionFt(opening.widthFt)
      : null;
  const heightLabel =
    typeof opening.heightFt === 'number' && Number.isFinite(opening.heightFt)
      ? formatCompactDimensionFt(opening.heightFt)
      : null;

  return {
    label: formatOpeningMathLabel(opening),
    kindLabel,
    widthLabel,
    heightLabel,
  };
}

function getWallRunZoneAssignmentUpdates(
  wallRun: { sideAZoneId?: string; sideBZoneId?: string },
  zoneId: string,
) {
  if (wallRun.sideAZoneId === zoneId || wallRun.sideBZoneId === zoneId) {
    return null;
  }

  if (!wallRun.sideAZoneId) {
    return { sideAZoneId: zoneId };
  }

  if (!wallRun.sideBZoneId) {
    return { sideBZoneId: zoneId };
  }

  return null;
}

function formatDoorCatalogLabel(type: Exclude<OpeningType, 'window'>, widthFt: number, heightFt: number) {
  return `${DOOR_TYPE_LABELS[type]} · ${formatFeetInches(widthFt)} x ${formatFeetInches(heightFt)}`;
}

function buildOpeningLayerKey(opening: {
  type: OpeningType;
  widthFt?: number | null;
  heightFt?: number | null;
  label?: string | null;
}) {
  return [
    opening.type,
    opening.widthFt ?? 'na',
    opening.heightFt ?? 'na',
    opening.label?.trim() ?? '',
  ].join('::');
}

function dimensionsMatch(left: number | null, right: number | null, tolerance: number = 0.01) {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= tolerance;
}

function openingMatchesEditTarget(
  opening: {
    type: OpeningType;
    width_ft: number;
    height_ft: number;
    label?: string;
  },
  target: OpeningLayerEditTarget,
) {
  return (
    opening.type === target.openingType &&
    dimensionsMatch(opening.width_ft, target.widthFt) &&
    dimensionsMatch(opening.height_ft, target.heightFt) &&
    (opening.label?.trim() ?? '') === target.label.trim()
  );
}

function formatGestureDebugEntry(entry: GestureDebugEntry) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = [`${time}`, `${entry.source}:${entry.action}`];

  if (entry.deltaMode !== undefined) parts.push(`mode=${entry.deltaMode}`);
  if (entry.deltaX !== undefined) parts.push(`dx=${entry.deltaX}`);
  if (entry.deltaY !== undefined) parts.push(`dy=${entry.deltaY}`);
  if (entry.wheelDeltaY !== undefined && entry.wheelDeltaY !== null) parts.push(`wheelY=${entry.wheelDeltaY}`);
  if (entry.ctrlKey !== undefined && entry.ctrlKey !== null) parts.push(`ctrl=${entry.ctrlKey}`);
  if (entry.metaKey !== undefined && entry.metaKey !== null) parts.push(`meta=${entry.metaKey}`);
  if (entry.firesTouchEvents !== undefined && entry.firesTouchEvents !== null) {
    parts.push(`touchLike=${entry.firesTouchEvents}`);
  }
  if (entry.scaleBefore !== undefined && entry.scaleAfter !== undefined) {
    parts.push(`scale=${entry.scaleBefore}->${entry.scaleAfter}`);
  }
  if (entry.scrollLeftBefore !== undefined && entry.scrollLeftAfter !== undefined) {
    parts.push(`scrollX=${entry.scrollLeftBefore}->${entry.scrollLeftAfter}`);
  } else if (entry.scrollLeft !== undefined && entry.scrollLeft !== null) {
    parts.push(`scrollX=${entry.scrollLeft}`);
  }
  if (entry.scrollTopBefore !== undefined && entry.scrollTopAfter !== undefined) {
    parts.push(`scrollY=${entry.scrollTopBefore}->${entry.scrollTopAfter}`);
  } else if (entry.scrollTop !== undefined && entry.scrollTop !== null) {
    parts.push(`scrollY=${entry.scrollTop}`);
  }
  if (entry.href) parts.push(entry.href);

  return parts.join(' | ');
}

function PagePill({
  active,
  pageLabel,
  title,
  onClick,
}: {
  active: boolean;
  pageLabel: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group w-full border px-2.5 py-1.5 text-left transition-colors ${
        active
          ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
          : 'border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.92)] text-[var(--takeoff-ink)] hover:border-[#9eb29d] hover:bg-[rgba(158,178,157,0.08)]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`takeoff-mono shrink-0 border px-1.5 py-0.5 text-[9px] transition-colors ${
            active
              ? 'border-[rgba(255,255,255,0.28)] bg-[rgba(255,255,255,0.08)] text-white'
              : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-subtle)] group-hover:border-[#b8c7b7]'
          }`}
        >
          {pageLabel}
        </span>
        <span className="min-w-0 truncate text-[10px] font-medium">
          {title}
        </span>
      </div>
    </button>
  );
}

function ZoneRow({
  zoneType,
  label,
  status,
  selected,
  hidden,
  metaParts,
  wallMetrics,
  expanded,
  math,
  onSelect,
  onToggleHidden,
}: {
  zoneType: ZoneType;
  label: string;
  status: string;
  selected: boolean;
  hidden: boolean;
  metaParts?: string[];
  wallMetrics?: WallMetricsData | null;
  expanded?: boolean;
  math?: ZoneCatalogMath | null;
  onSelect: () => void;
  onToggleHidden: () => void;
}) {
  const zoneColor = ZONE_COLORS[zoneType];

  return (
    <div
      className={`relative border px-3 py-2.5 transition-colors ${
        selected
          ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)]'
          : 'border-[var(--takeoff-line)] bg-white'
      }`}
    >
      <button onClick={onSelect} className="w-full text-left">
        <div>
          <div className="flex items-center gap-1.5 pr-10">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: zoneColor.stroke }}
            />
            <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--takeoff-ink)]">
              {label}
            </span>
            <span className="ml-auto shrink-0 text-[var(--takeoff-text-subtle)]">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className="takeoff-mono rounded-sm px-1 py-px text-[7px] font-medium"
              style={{ color: zoneColor.stroke, backgroundColor: `${zoneColor.fill}18` }}
            >
              {ZONE_LABELS[zoneType]}
            </span>
            <span className="takeoff-mono rounded-sm bg-[var(--takeoff-paper)] px-1 py-px text-[7px] text-[var(--takeoff-text-subtle)]">
              {status}
            </span>
            {hidden && (
              <span className="takeoff-mono rounded-sm bg-[var(--takeoff-paper)] px-1 py-px text-[7px] text-[var(--takeoff-text-subtle)]">
                hidden
              </span>
            )}
          </div>
          {(metaParts?.length || wallMetrics) && (
            <div className="mt-1 takeoff-mono text-[9px] leading-[15px] text-[var(--takeoff-text-muted)]">
              {metaParts && metaParts.length > 0 && (
                <span>{metaParts.join(' · ')}</span>
              )}
              {wallMetrics && (
                <>
                  {metaParts && metaParts.length > 0 && <br />}
                  <span className="tabular-nums text-[var(--takeoff-text-subtle)]">
                    {wallMetrics.lfLabel}
                    {wallMetrics.sfLabel && (
                      <> · <span className="font-bold text-[var(--takeoff-ink)]">{wallMetrics.sfLabel}</span></>
                    )}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
          {expanded && math && (
            <div className="mt-2 border-t border-[var(--takeoff-line)] pt-2">
              {math.kind === 'area' ? (
                <table className="takeoff-mono w-full border-collapse text-[9px] text-[var(--takeoff-text-muted)]">
                  <tbody>
                    <tr className="font-semibold text-[var(--takeoff-ink)]">
                      <td colSpan={4} className="leading-4">{math.areaLabel}</td>
                      <td className="w-[48px] text-right tabular-nums leading-4">{Math.round(math.areaSf)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <table className="takeoff-mono w-full border-collapse text-[9px] text-[var(--takeoff-text-muted)]">
                  <tbody>
                    <tr className="border-b border-[var(--takeoff-line)]">
                      <td colSpan={4} className="pb-1.5 leading-4">Total wall SF</td>
                      <td className="w-[36px] pb-1.5 text-right tabular-nums leading-4">{Math.round(math.grossSf)}</td>
                    </tr>
                    {math.openingGroups.length > 0 ? (
                      math.openingGroups.map((group) => (
                        <tr key={group.key} className="border-b border-[var(--takeoff-line)]/40">
                          {group.widthLabel && group.heightLabel ? (
                            <>
                              <td className="w-[52px] truncate py-1 leading-4">{group.kindLabel}</td>
                              <td className="w-[76px] whitespace-nowrap py-1 leading-4">
                                {group.widthLabel} x {group.heightLabel}
                              </td>
                            </>
                          ) : (
                            <td colSpan={2} className="truncate py-1 leading-4">{group.label}</td>
                          )}
                          <td className="py-1 leading-4" />
                          <td className="w-[40px] whitespace-nowrap py-1 text-right leading-4">Qty {group.quantity}</td>
                          <td className="w-[36px] py-1 text-right tabular-nums leading-4">{Math.round(group.totalAreaSf)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="pt-1.5 leading-4">No opening subtractions yet</td>
                      </tr>
                    )}
                    <tr className="font-semibold text-[var(--takeoff-ink)]">
                      <td colSpan={4} className="pt-1.5 leading-4">Remaining wall SF</td>
                      <td className="w-[36px] pt-1.5 text-right tabular-nums leading-4">{Math.round(math.netSf)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
      </button>

      <button
        onClick={onToggleHidden}
        className="absolute right-3 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d] hover:text-[var(--takeoff-ink)]"
        title={hidden ? 'Show area' : 'Hide area'}
      >
        {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function PrimaryToolButton({
  label,
  icon: Icon,
  active,
  disabled,
  accent,
  compact,
  iconOnly,
  onClick,
}: {
  label: string;
  icon: typeof MousePointer2;
  active: boolean;
  disabled?: boolean;
  accent: 'neutral' | 'blue' | 'green' | 'teal' | 'burgundy' | 'amber';
  compact?: boolean;
  iconOnly?: boolean;
  onClick: () => void;
}) {
  const accentClass = (() => {
    switch (accent) {
      case 'blue':
        return active
          ? 'border-[#1d4ed8] bg-[#1d4ed8] text-white'
          : 'border-[rgba(29,78,216,0.22)] bg-white text-[#1d4ed8]';
      case 'green':
        return active
          ? 'border-[#047857] bg-[#047857] text-white'
          : 'border-[rgba(4,120,87,0.22)] bg-white text-[#047857]';
      case 'teal':
        return active
          ? 'border-[#0f766e] bg-[#0f766e] text-white'
          : 'border-[rgba(15,118,110,0.22)] bg-white text-[#0f766e]';
      case 'burgundy':
        return active
          ? 'border-[#7f1d1d] bg-[#7f1d1d] text-white'
          : 'border-[rgba(127,29,29,0.22)] bg-white text-[#7f1d1d]';
      case 'amber':
        return active
          ? 'border-[#92400e] bg-[#92400e] text-white'
          : 'border-[rgba(146,64,14,0.22)] bg-white text-[#92400e]';
      case 'blue':
        return active
          ? 'border-[#1d4ed8] bg-[#1d4ed8] text-white'
          : 'border-[rgba(29,78,216,0.22)] bg-white text-[#1d4ed8]';
      default:
        return active
          ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
          : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]';
    }
  })();

  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] ${
        iconOnly
          ? 'flex h-11 items-center justify-center px-0 py-0'
          : compact
          ? 'flex min-h-[62px] flex-col items-center justify-center gap-1.5'
          : 'inline-flex items-center gap-2.5'
      } ${accentClass}`}
    >
      <Icon className={iconOnly ? 'h-4 w-4' : compact ? 'h-4 w-4' : 'h-4 w-4 shrink-0'} />
      {!iconOnly && (
        <span className={`takeoff-mono ${compact ? 'text-center text-[9px] font-semibold leading-4' : 'text-[10px] font-semibold'}`}>
          {label}
        </span>
      )}
    </button>
  );
}

function UtilityActionButton({
  label,
  disabled,
  type,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick: () => void;
}) {
  return (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
    >
      {label}
    </button>
  );
}

function CanvasManualWindowModal({
  sourceText,
  widthText,
  heightText,
  inputClass,
  onWidthChange,
  onHeightChange,
  onCancel,
  onSubmit,
  submitDisabled,
}: {
  sourceText?: string | null;
  widthText: string;
  heightText: string;
  inputClass: string;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-[rgba(248,248,246,0.32)] px-6">
      <div className="w-full max-w-[380px] border border-[rgba(216,116,29,0.28)] bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(31,39,33,0.16)] backdrop-blur-sm">
        <div className="border-b border-[rgba(216,116,29,0.18)] px-4 py-3">
          <div className="takeoff-label text-[9px] font-semibold text-[rgba(147,62,11,0.86)]">
            Manual Window
          </div>
          <div className="mt-1 text-[14px] font-medium text-[var(--takeoff-ink)]">
            Type the window size
          </div>
          {sourceText && (
            <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
              Scan text: &quot;{sourceText}&quot;
            </div>
          )}
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <input
              autoFocus
              value={widthText}
              onChange={(event) => onWidthChange(event.target.value)}
              placeholder="Width"
              className={inputClass}
            />
            <input
              value={heightText}
              onChange={(event) => onHeightChange(event.target.value)}
              placeholder="Height"
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <UtilityActionButton label="Cancel" onClick={onCancel} />
            <UtilityActionButton label="Add window" disabled={submitDisabled} onClick={onSubmit} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ToolbarConceptWorkspace({ pdfUrl }: ToolbarConceptWorkspaceProps) {
  const viewerRef = useRef<BlueprintViewerHandle>(null);
  const gestureDebugLogRef = useRef<GestureDebugEntry[]>(
    SHOW_TAKEOFF_DEBUG_OVERLAYS ? readStoredGestureDebugLog() : [],
  );
  const gestureDebugTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const activeTracePoints = useTakeoffStore((state) => state.activeTracePoints);
  const activeWallFillSide = useTakeoffStore((state) => state.activeWallFillSide);
  const activeWallPresetKey = useTakeoffStore((state) => state.wallPreset);
  const activeSurfacePresetKey = useTakeoffStore((state) => state.surfacePreset);
  const drawingPreset = useTakeoffStore((state) => state.drawingPreset);
  const calibrationStep = useTakeoffStore((state) => state.calibrationStep);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const selectedSegmentIndex = useTakeoffStore((state) => state.selectedSegmentIndex);
  const tool = useTakeoffStore((state) => state.tool);
  const setActivePage = useTakeoffStore((state) => state.setActivePage);
  const setActiveView = useTakeoffStore((state) => state.setActiveView);
  const setDrawingPreset = useTakeoffStore((state) => state.setDrawingPreset);
  const setSurfacePreset = useTakeoffStore((state) => state.setSurfacePreset);
  const setTool = useTakeoffStore((state) => state.setTool);
  const setWallPreset = useTakeoffStore((state) => state.setWallPreset);
  const updateZoneObject = useTakeoffStore((state) => state.updateZoneObject);
  const updateWallRunObject = useTakeoffStore((state) => state.updateWallRunObject);
  const updateSurfaceObject = useTakeoffStore((state) => state.updateSurfaceObject);
  const toggleObjectHiddenInView = useTakeoffStore((state) => state.toggleObjectHiddenInView);
  const selectTrace = useTakeoffStore((state) => state.selectTrace);
  const selectSegment = useTakeoffStore((state) => state.selectSegment);
  const clearSelection = useTakeoffStore((state) => state.clearSelection);
  const continueTrace = useTakeoffStore((state) => state.continueTrace);
  const deleteTrace = useTakeoffStore((state) => state.deleteTrace);
  const deleteTraceSegment = useTakeoffStore((state) => state.deleteTraceSegment);
  const startCalibration = useTakeoffStore((state) => state.startCalibration);
  const startTrace = useTakeoffStore((state) => state.startTrace);
  const removeLastTracePoint = useTakeoffStore((state) => state.removeLastTracePoint);
  const upsertWindowCatalogItem = useTakeoffStore((state) => state.upsertWindowCatalogItem);
  const upsertDoorCatalogItem = useTakeoffStore((state) => state.upsertDoorCatalogItem);
  const setSegmentOpenings = useTakeoffStore((state) => state.setSegmentOpenings);
  const openingScanMarkers = useTakeoffStore((state) => state.openingScanMarkers);
  const addOpeningScanMarker = useTakeoffStore((state) => state.addOpeningScanMarker);
  const getCalibration = useTakeoffStore((state) => state.getCalibration);
  const getDerivedAreas = useTakeoffStore((state) => state.getDerivedAreas);
  const getDerivedSegments = useTakeoffStore((state) => state.getDerivedSegments);
  const handleEscape = useTakeoffStore((state) => state.handleEscape);

  const [pageTrayOpen, setPageTrayOpen] = useState(false);
  const [selectedToolPanel, setSelectedToolPanel] = useState<MatrixToolPanel>('select');
  const [windowToolMode, setWindowToolMode] = useState<WindowToolMode>('idle');
  const [doorToolMode, setDoorToolMode] = useState<DoorToolMode>('idle');
  const [roofPitchToolMode, setRoofPitchToolMode] = useState<RoofPitchToolMode>('idle');
  const [windowWidthText, setWindowWidthText] = useState(`5'-0"`);
  const [windowHeightText, setWindowHeightText] = useState(`5'-0"`);
  const [windowSourceText, setWindowSourceText] = useState<string | null>(null);
  const [windowStatus, setWindowStatus] = useState<string | null>(null);
  const [selectedWindowCatalogId, setSelectedWindowCatalogId] = useState<string | null>(null);
  const [manualWindowModalOpen, setManualWindowModalOpen] = useState(false);
  const [pendingManualWindowMarkerPoint, setPendingManualWindowMarkerPoint] = useState<PdfPoint | null>(null);
  const [doorWidthText, setDoorWidthText] = useState(`3'-0"`);
  const [doorHeightText, setDoorHeightText] = useState(`6'-8"`);
  const [doorType, setDoorType] = useState<Exclude<OpeningType, 'window'>>('door');
  const [doorSourceText, setDoorSourceText] = useState<string | null>(null);
  const [doorStatus, setDoorStatus] = useState<string | null>(null);
  const [selectedDoorCatalogId, setSelectedDoorCatalogId] = useState<string | null>(null);
  const [surfaceStatus, setSurfaceStatus] = useState<string | null>(null);
  const [roofPitchRiseText, setRoofPitchRiseText] = useState('7');
  const [roofPitchRunText, setRoofPitchRunText] = useState('12');
  const [roofPitchSourceText, setRoofPitchSourceText] = useState<string | null>(null);
  const [roofPitchStatus, setRoofPitchStatus] = useState<string | null>(null);
  const [zoneCatalogOpen, setZoneCatalogOpen] = useState(false);
  const [expandedZoneCatalogId, setExpandedZoneCatalogId] = useState<string | null>(null);
  const [activeTakeoffZoneId, setActiveTakeoffZoneId] = useState<string | null>(null);
  const [openingEditTarget, setOpeningEditTarget] = useState<OpeningLayerEditTarget | null>(null);
  const [gestureDebugLog, setGestureDebugLog] = useState<GestureDebugEntry[]>(
    () => (SHOW_TAKEOFF_DEBUG_OVERLAYS ? readStoredGestureDebugLog() : []),
  );
  const [gestureDebugCopyState, setGestureDebugCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const calibration = getCalibration();
  const isCalibrated = Boolean(calibration);
  const showCalibrationOverlay = calibrationStep !== 'idle' && calibrationStep !== 'done';
  const activeWallPreset = getWallPreset(activeWallPresetKey);
  const activeSurfacePreset = getSurfacePreset(activeSurfacePresetKey);
  const sixInchPreset = getWallPreset('exterior_2x6');
  const fourInchPreset = getWallPreset('exterior_2x4');
  const isPointerMode = tool === 'pointer';
  const isTraceMode = tool === 'trace';
  const isSurfaceTraceMode = isTraceMode && drawingPreset === 'surface';
  const isCalibrateMode = showCalibrationOverlay || tool === 'calibrate';
  const selectedTrace = selectedTraceId
    ? session?.traces.find((trace) => trace.id === selectedTraceId) ?? null
    : null;
  const allZones = useMemo(() => session?.zones ?? [], [session?.zones]);
  const hiddenObjectIdsByView = useMemo(
    () => new Map((session?.views ?? []).map((view) => [view.id, new Set(view.hiddenObjectIds)])),
    [session?.views],
  );
  const selectedZoneTrace = useMemo(
    () => allZones.find((zone) => zone.id === selectedTraceId) ?? null,
    [allZones, selectedTraceId],
  );
  const selectedZone = useMemo(
    () => allZones.find((zone) => zone.id === activeTakeoffZoneId) ?? selectedZoneTrace ?? null,
    [activeTakeoffZoneId, allZones, selectedZoneTrace],
  );
  const zonesById = useMemo(
    () => new Map(allZones.map((zone) => [zone.id, zone])),
    [allZones],
  );
  const selectedZoneMissingData = selectedZone ? getZoneMissingData(selectedZone) : [];
  const zoneTasks = useMemo(
    () => allZones.filter((zone) => deriveZoneLifecycleState(zone) === 'needs_takeoff'),
    [allZones],
  );
  const visibleZones = useMemo(
    () =>
      allZones.filter((zone) => {
        const lifecycle = deriveZoneLifecycleState(zone);
        return lifecycle !== 'complete' || normalizeZoneType(zone.zoneType, zone.label) === 'unconditioned_attic';
      }),
    [allZones],
  );
  const zonesByType = useMemo(
    () =>
      ['conditioned', 'unconditioned_garage', 'unconditioned_attic', 'unconditioned_crawl', 'unconditioned_storage']
        .map((zoneType) => ({
          zoneType: zoneType as ZoneType,
          zones: allZones.filter((zone) => normalizeZoneType(zone.zoneType, zone.label) === zoneType),
        }))
        .filter((entry) => entry.zones.length > 0),
    [allZones],
  );
  const selectedOpenWall =
    selectedTrace && selectedTrace.type === 'linear' && !selectedTrace.isClosed
      ? selectedTrace
      : null;
  const selectedSurfaceTrace =
    selectedTrace && selectedTrace.type === 'area' && !selectedTrace.zone
      ? selectedTrace
      : null;
  const selectedSurfaceObject = useMemo(
    () =>
      selectedSurfaceTrace
        ? (session?.surfaces ?? []).find((surface) => surface.id === selectedSurfaceTrace.id) ?? null
        : null,
    [selectedSurfaceTrace, session?.surfaces],
  );
  const selectedWallRun =
    selectedTrace && selectedTrace.type === 'linear'
      ? (session?.wallRuns ?? []).find((wallRun) => wallRun.id === selectedTrace.id) ?? null
      : null;
  const zoneAssociatedWalls = useMemo(() => {
    if (!selectedZone || !session) return [];

    const tracesById = new Map(session.traces.map((trace) => [trace.id, trace]));

    return (session.wallRuns ?? [])
      .filter(
        (wallRun) =>
          wallRun.sideAZoneId === selectedZone.id || wallRun.sideBZoneId === selectedZone.id,
      )
      .map((wallRun) => {
        const trace = tracesById.get(wallRun.id) ?? null;
        const calibrationForPage = session.calibrations[wallRun.pageIndex];
        let lengthFt: number | null = null;

        if (calibrationForPage) {
          if (trace?.type === 'linear') {
            const measuredLf = traceTotalLf(trace, calibrationForPage);
            lengthFt = measuredLf > 0 ? measuredLf : null;
          } else if (wallRun.path.length > 1) {
            let totalLf = 0;
            for (let index = 0; index < wallRun.path.length - 1; index += 1) {
              totalLf += calibratedLength(
                wallRun.path[index],
                wallRun.path[index + 1],
                calibrationForPage,
              );
            }
            lengthFt = totalLf > 0 ? totalLf : null;
          }
        }

        return {
          wallRun,
          descriptor: formatWallLayerMetrics(lengthFt, selectedZone.rValue),
        };
      })
      .sort((a, b) => a.wallRun.label.localeCompare(b.wallRun.label));
  }, [selectedZone, session]);
  const zoneLayerItems = useMemo(() => {
    if (!selectedZone || !session) return [] as Array<ZoneLayerWallEntry | ZoneLayerOpeningEntry>;

    const openingsByWallRunId = new Map<string, NonNullable<typeof session.openingItems>[number][]>();
    for (const opening of session.openingItems ?? []) {
      if (!opening.wallRunId) continue;
      const existing = openingsByWallRunId.get(opening.wallRunId) ?? [];
      existing.push(opening);
      openingsByWallRunId.set(opening.wallRunId, existing);
    }

    const items: Array<ZoneLayerWallEntry | ZoneLayerOpeningEntry> = [];

    for (const { wallRun, descriptor } of zoneAssociatedWalls) {
      const isHidden = hiddenObjectIdsByView.get(wallRun.viewId)?.has(wallRun.id) ?? false;
      const isSelectedWall = selectedTrace?.id === wallRun.id;

      items.push({
        kind: 'wall',
        id: `wall-${wallRun.id}`,
        wallRunId: wallRun.id,
        label: wallRun.label,
        descriptor,
        hidden: isHidden,
        selected: isSelectedWall,
      });

      const groupedOpenings = new Map<
        string,
        {
          openingType: OpeningType;
          widthFt: number | null;
          heightFt: number | null;
          label: string;
          quantity: number;
          totalAreaSf: number;
        }
      >();

      for (const opening of openingsByWallRunId.get(wallRun.id) ?? []) {
        const key = buildOpeningLayerKey(opening);
        const current = groupedOpenings.get(key) ?? {
          openingType: opening.type,
          widthFt: opening.widthFt ?? null,
          heightFt: opening.heightFt ?? null,
          label: formatOpeningLayerLabel(opening),
          quantity: 0,
          totalAreaSf: 0,
        };

        current.quantity += opening.quantity;
        if (typeof opening.widthFt === 'number' && typeof opening.heightFt === 'number') {
          current.totalAreaSf += openingAreaSf({
            id: opening.id,
            type: opening.type,
            width_ft: opening.widthFt,
            height_ft: opening.heightFt,
            quantity: opening.quantity,
            label: opening.label,
          });
        }
        groupedOpenings.set(key, current);
      }

      for (const [key, opening] of groupedOpenings) {
        items.push({
          kind: 'opening',
          id: `opening-${wallRun.id}-${key}`,
          wallRunId: wallRun.id,
          label: opening.label,
          descriptor: `${formatCompactNumber(opening.totalAreaSf)} SF | Qty ${opening.quantity}`,
          openingType: opening.openingType,
          widthFt: opening.widthFt,
          heightFt: opening.heightFt,
          quantity: opening.quantity,
        });
      }
    }

    return items;
  }, [hiddenObjectIdsByView, selectedTrace?.id, selectedZone, session, zoneAssociatedWalls]);
  const selectedZoneWallEntry = useMemo(() => {
    if (!selectedWallRun || !selectedZone) return null;
    return zoneAssociatedWalls.find((entry) => entry.wallRun.id === selectedWallRun.id) ?? null;
  }, [selectedWallRun, selectedZone, zoneAssociatedWalls]);
  const selectedZoneWallRunId = selectedZoneWallEntry?.wallRun.id ?? null;
  const selectedZoneWallLabel = selectedZoneWallEntry?.wallRun.label ?? null;
  const canUseOpeningTools = Boolean(selectedZoneWallRunId);
  const windowScanMarkers = useMemo(
    () => openingScanMarkers.filter((marker) => marker.openingType === 'window'),
    [openingScanMarkers],
  );
  const doorScanMarkers = useMemo(
    () => openingScanMarkers.filter((marker) => marker.openingType !== 'window'),
    [openingScanMarkers],
  );
  const zoneWallMetricsById = useMemo(() => {
    if (!session) return new Map<string, ZoneWallMetrics>();

    const tracesById = new Map(session.traces.map((trace) => [trace.id, trace]));
    const metricsByZoneId = new Map<string, ZoneWallMetrics>();

    for (const wallRun of session.wallRuns ?? []) {
      const calibrationForPage = session.calibrations[wallRun.pageIndex];
      if (!calibrationForPage) continue;

      const trace = tracesById.get(wallRun.id);
      let wallLf = 0;

      if (trace?.type === 'linear') {
        wallLf = traceTotalLf(trace, calibrationForPage);
      } else if (wallRun.path.length > 1) {
        for (let index = 0; index < wallRun.path.length - 1; index += 1) {
          wallLf += calibratedLength(
            wallRun.path[index],
            wallRun.path[index + 1],
            calibrationForPage,
          );
        }
      }

      if (wallLf <= 0) continue;

      const relatedZoneIds = Array.from(
        new Set([wallRun.sideAZoneId, wallRun.sideBZoneId].filter(Boolean)),
      ) as string[];

      for (const zoneId of relatedZoneIds) {
        const zone = zonesById.get(zoneId);
        if (!zone) continue;

        const current = metricsByZoneId.get(zoneId) ?? {
          wallCount: 0,
          totalLf: 0,
          totalGrossSf: 0,
        };

        current.wallCount += 1;
        current.totalLf += wallLf;

        if (zone.defaultCeilingHeightFt && zone.defaultCeilingHeightFt > 0) {
          current.totalGrossSf += wallLf * zone.defaultCeilingHeightFt;
        }

        metricsByZoneId.set(zoneId, current);
      }
    }

    return metricsByZoneId;
  }, [session, zonesById]);
  const zoneCatalogMathById = useMemo(() => {
    if (!session) return new Map<string, ZoneCatalogMath>();

    const wallRunsById = new Map((session.wallRuns ?? []).map((wallRun) => [wallRun.id, wallRun]));
    const openingGroupsByZoneId = new Map<
      string,
      Map<string, ZoneCatalogOpeningBreakdown>
    >();

    for (const opening of session.openingItems ?? []) {
      const wallRun = opening.wallRunId ? wallRunsById.get(opening.wallRunId) : null;
      if (!wallRun) continue;

      const relatedZoneIds = Array.from(
        new Set([wallRun.sideAZoneId, wallRun.sideBZoneId].filter(Boolean)),
      ) as string[];

      if (relatedZoneIds.length === 0) continue;

      const openingDisplay = formatOpeningMathParts({
        type: opening.type,
        widthFt: opening.widthFt,
        heightFt: opening.heightFt,
        label: opening.label,
      });
      const openingKey = buildOpeningLayerKey({
        type: opening.type,
        widthFt: opening.widthFt,
        heightFt: opening.heightFt,
        label: opening.label,
      });
      const areaSf =
        typeof opening.widthFt === 'number' && typeof opening.heightFt === 'number'
          ? openingAreaSf({
              id: opening.id,
              type: opening.type,
              width_ft: opening.widthFt,
              height_ft: opening.heightFt,
              quantity: opening.quantity,
              label: opening.label,
            })
          : 0;

      for (const zoneId of relatedZoneIds) {
        const zoneGroups = openingGroupsByZoneId.get(zoneId) ?? new Map<string, ZoneCatalogOpeningBreakdown>();
        const current = zoneGroups.get(openingKey) ?? {
          key: openingKey,
          label: openingDisplay.label,
          kindLabel: openingDisplay.kindLabel,
          widthLabel: openingDisplay.widthLabel,
          heightLabel: openingDisplay.heightLabel,
          quantity: 0,
          totalAreaSf: 0,
        };

        current.quantity += opening.quantity;
        current.totalAreaSf += areaSf;
        zoneGroups.set(openingKey, current);
        openingGroupsByZoneId.set(zoneId, zoneGroups);
      }
    }

    const mathByZoneId = new Map<string, ZoneCatalogMath>();

    for (const zone of allZones) {
      const grossSf = zoneWallMetricsById.get(zone.id)?.totalGrossSf ?? 0;
      const openingGroups = Array.from(openingGroupsByZoneId.get(zone.id)?.values() ?? []).sort(
        (a, b) => b.totalAreaSf - a.totalAreaSf,
      );
      const openingSf = openingGroups.reduce((sum, group) => sum + group.totalAreaSf, 0);

      if (zoneNeedsInsulationType(zone.zoneType)) {
        const calibration = session.calibrations[zone.pageIndex];
        const areaSf =
          calibration && zone.polygon.length >= 3
            ? traceAreaSf(
                {
                  id: zone.id,
                  pageIndex: zone.pageIndex,
                  type: 'area',
                  points: zone.polygon,
                  isClosed: true,
                  isLocked: true,
                  label: zone.label,
                },
                calibration,
              )
            : 0;
        mathByZoneId.set(zone.id, {
          kind: 'area',
          areaLabel: zone.zoneType === 'unconditioned_crawl' ? 'Floor area' : 'Zone area',
          areaSf,
        });
        continue;
      }

      mathByZoneId.set(zone.id, {
        kind: 'wall',
        grossSf,
        openingSf,
        netSf: Math.max(0, grossSf - openingSf),
        openingGroups,
      });
    }

    return mathByZoneId;
  }, [allZones, session, zoneWallMetricsById]);
  const canContinueSelectedWall = isPointerMode && Boolean(selectedOpenWall);
  const canDeleteSelectedSegment =
    isPointerMode && Boolean(selectedOpenWall) && selectedSegmentIndex !== null;
  const canDeleteSelectedTrace = isPointerMode && Boolean(selectedTrace);
  const deleteSelectionLabel = (() => {
    if (canDeleteSelectedSegment) return 'Delete segment';
    if (selectedTrace?.isClosed || selectedTrace?.type === 'area') return 'Delete shape';
    if (selectedTrace) return 'Delete wall';
    return 'Delete selection';
  })();
  const parsedWindowWidthFt = parseDimensionToFeet(windowWidthText);
  const parsedWindowHeightFt = parseDimensionToFeet(windowHeightText);
  const parsedDoorWidthFt = parseDimensionToFeet(doorWidthText);
  const parsedDoorHeightFt = parseDimensionToFeet(doorHeightText);
  const windowPreset =
    parsedWindowWidthFt && parsedWindowHeightFt
      ? {
          widthFt: parsedWindowWidthFt,
          heightFt: parsedWindowHeightFt,
          label: `${formatFeetInches(parsedWindowWidthFt)} x ${formatFeetInches(parsedWindowHeightFt)}`,
          sourceText: windowSourceText,
        }
      : null;
  const doorPreset =
    parsedDoorWidthFt && parsedDoorHeightFt
      ? {
          type: doorType,
          widthFt: parsedDoorWidthFt,
          heightFt: parsedDoorHeightFt,
          label: formatDoorCatalogLabel(doorType, parsedDoorWidthFt, parsedDoorHeightFt),
          sourceText: doorSourceText,
        }
      : null;
  const selectedSegmentMetrics = useMemo(() => {
    if (!session || selectedTraceId === null || selectedSegmentIndex === null) {
      return null;
    }

    const selectedTraceForMetrics =
      session.traces.find((trace) => trace.id === selectedTraceId) ?? null;
    if (!selectedTraceForMetrics || selectedTraceForMetrics.pageIndex !== activePageIndex) {
      return null;
    }

    return (
      getDerivedSegments().find(
        (segment) =>
          segment.traceId === selectedTraceId && segment.segmentIndex === selectedSegmentIndex,
      ) ?? null
    );
  }, [activePageIndex, getDerivedSegments, selectedSegmentIndex, selectedTraceId, session]);
  const selectedAreaMetrics = useMemo(() => {
    if (!session || !selectedTraceId) {
      return null;
    }

    const selectedTraceForMetrics =
      session.traces.find((trace) => trace.id === selectedTraceId) ?? null;
    if (!selectedTraceForMetrics || selectedTraceForMetrics.pageIndex !== activePageIndex || selectedTraceForMetrics.type !== 'area' || selectedTraceForMetrics.zone) {
      return null;
    }

    return getDerivedAreas().find((area) => area.traceId === selectedTraceId) ?? null;
  }, [activePageIndex, getDerivedAreas, selectedTraceId, session]);
  const isWindowCaptureMode = windowToolMode === 'capture';
  const isWindowPlaceMode = windowToolMode === 'place';
  const isWindowToolActive = isWindowCaptureMode || isWindowPlaceMode;
  const isDoorCaptureMode = doorToolMode === 'capture';
  const isDoorPlaceMode = doorToolMode === 'place';
  const isDoorToolActive = isDoorCaptureMode || isDoorPlaceMode;
  const isRoofPitchCaptureMode = roofPitchToolMode === 'capture';
  const canResetWindowTool =
    isWindowToolActive || Boolean(windowSourceText) || Boolean(windowStatus);
  const canResetDoorTool =
    isDoorToolActive || Boolean(doorSourceText) || Boolean(doorStatus);
  const windowCatalog = useMemo(() => session?.windowCatalog ?? [], [session?.windowCatalog]);
  const doorCatalog = useMemo(() => session?.doorCatalog ?? [], [session?.doorCatalog]);
  const selectedSurfaceScope = selectedAreaMetrics?.classification?.assemblyScope ?? null;
  const canApplySurfacePresetToSelection =
    Boolean(selectedSurfaceTrace) && selectedSurfaceScope !== activeSurfacePreset.scope;
  const atticZoneSelected = selectedZone?.zoneType === 'unconditioned_attic';
  const selectedRoofSurface =
    selectedSurfaceObject?.assemblyScope === 'cathedral_ceiling'
      ? selectedSurfaceObject
      : null;
  const roofToolEnabled = atticZoneSelected || Boolean(selectedRoofSurface);
  const canTraceRoof = isCalibrated && atticZoneSelected;
  const roofPitchDraft = parseRoofPitchText(`${roofPitchRiseText}/${roofPitchRunText}`);
  const roofPitchDraftLabel = roofPitchDraft
    ? formatRoofPitch(roofPitchDraft.rise, roofPitchDraft.run)
    : null;
  const selectedSurfacePlanAreaSf = selectedAreaMetrics?.areaSf ?? 0;
  const selectedSurfaceAdjustedAreaSf =
    selectedAreaMetrics && selectedSurfaceObject
      ? computeSlopedAreaSf(
          selectedAreaMetrics.areaSf,
          selectedSurfaceObject.roofPitchRise,
          selectedSurfaceObject.roofPitchRun,
        )
      : 0;
  const canConvertSelectedSurfaceToRoof =
    Boolean(selectedSurfaceTrace) && selectedSurfaceScope !== 'cathedral_ceiling';
  const canScanRoofPitch =
    Boolean(selectedSurfaceTrace) &&
    (selectedSurfaceObject?.assemblyScope ?? selectedSurfaceScope) === 'cathedral_ceiling';
  const hasSelectedRoofPitch =
    Boolean(selectedSurfaceObject?.roofPitchRise && selectedSurfaceObject?.roofPitchRun);
  const isRoofSectionEditingMode =
    atticZoneSelected &&
    (
      selectedToolPanel === 'roof' ||
      isRoofPitchCaptureMode ||
      Boolean(selectedRoofSurface) ||
      (isSurfaceTraceMode && activeSurfacePreset.scope === 'cathedral_ceiling')
    );

  const cursorMode =
    showCalibrationOverlay || tool === 'trace' || isWindowToolActive || isDoorToolActive || isRoofPitchCaptureMode
      ? 'crosshair'
      : 'default';

  const selectedPages = useMemo(() => session?.selectedPages ?? [], [session?.selectedPages]);
  const pageAnalysis = session?.pageAnalysis ?? [];
  const activePageTitle =
    pageAnalysis.find((page) => page.pageIndex === activePageIndex)?.title?.trim() ||
    `Page ${activePageIndex + 1}`;

  const calibratedPages = selectedPages.filter((pageIndex) =>
    Boolean(session?.calibrations[pageIndex]),
  );

  const bandWidthForInches = (thicknessIn: number) => {
    const viewer = viewerRef.current;
    if (!viewer || !calibration) return null;

    const origin = viewer.pageCoordsToCss(0, 0);
    const offset = viewer.pageCoordsToCss(
      calibration.pdfPointsPerFoot * (thicknessIn / 12),
      0,
    );

    if (!origin || !offset) return null;

    return Math.abs(offset.x - origin.x);
  };

  const fourInchBandWidth = bandWidthForInches(4);
  const sixInchBandWidth = bandWidthForInches(6);

  useEffect(() => {
    if (activeTakeoffZoneId && !allZones.some((zone) => zone.id === activeTakeoffZoneId)) {
      setActiveTakeoffZoneId(null);
    }
  }, [activeTakeoffZoneId, allZones]);

  useEffect(() => {
    if (!selectedSurfaceObject) return;

    if (selectedSurfaceObject.roofPitchRise && selectedSurfaceObject.roofPitchRun) {
      setRoofPitchRiseText(String(selectedSurfaceObject.roofPitchRise));
      setRoofPitchRunText(String(selectedSurfaceObject.roofPitchRun));
      setRoofPitchSourceText(selectedSurfaceObject.roofPitchSourceText ?? null);
      return;
    }

    setRoofPitchRiseText('7');
    setRoofPitchRunText('12');
    setRoofPitchSourceText(null);
  }, [
    selectedSurfaceObject?.id,
    selectedSurfaceObject?.roofPitchRise,
    selectedSurfaceObject?.roofPitchRun,
    selectedSurfaceObject?.roofPitchSourceText,
  ]);

  useEffect(() => {
    if (!SHOW_TAKEOFF_DEBUG_OVERLAYS) return;

    const handleGestureDebug = (event: Event) => {
      const detail = (event as CustomEvent<GestureDebugEntry>).detail;
      if (!detail) return;
      setGestureDebugLog((current) => {
        const next = [detail, ...current].slice(0, GESTURE_DEBUG_LOG_LIMIT);
        gestureDebugLogRef.current = next;
        writeStoredGestureDebugLog(next);
        return next;
      });
    };

    window.addEventListener('takeoff-gesture-debug', handleGestureDebug as EventListener);
    return () => {
      window.removeEventListener('takeoff-gesture-debug', handleGestureDebug as EventListener);
    };
  }, []);

  useEffect(() => {
    if (selectedZoneTrace && activeTakeoffZoneId !== selectedZoneTrace.id) {
      setActiveTakeoffZoneId(selectedZoneTrace.id);
    }
  }, [activeTakeoffZoneId, selectedZoneTrace]);

  useEffect(() => {
    if (
      !selectedZone ||
      deriveZoneLifecycleState(selectedZone) !== 'needs_takeoff' ||
      !selectedWallRun ||
      selectedWallRun.pageIndex !== selectedZone.pageIndex ||
      selectedWallRun.viewId !== selectedZone.viewId
    ) {
      return;
    }

    const updates = getWallRunZoneAssignmentUpdates(selectedWallRun, selectedZone.id);
    if (!updates) return;

    updateWallRunObject(selectedWallRun.id, updates);
  }, [selectedWallRun, selectedZone, updateWallRunObject]);

  useEffect(() => {
    if (!selectedWindowCatalogId) return;
    if (windowCatalog.some((item) => item.id === selectedWindowCatalogId)) return;
    setSelectedWindowCatalogId(null);
  }, [selectedWindowCatalogId, windowCatalog]);

  useEffect(() => {
    if (!selectedDoorCatalogId) return;
    if (doorCatalog.some((item) => item.id === selectedDoorCatalogId)) return;
    setSelectedDoorCatalogId(null);
  }, [selectedDoorCatalogId, doorCatalog]);

  useEffect(() => {
    if (canUseOpeningTools) return;
    if (windowToolMode !== 'idle') {
      setWindowToolMode('idle');
    }
    if (doorToolMode !== 'idle') {
      setDoorToolMode('idle');
    }
  }, [canUseOpeningTools, doorToolMode, windowToolMode]);

  const handleSelectZone = (zoneId: string) => {
    const zone = allZones.find((item) => item.id === zoneId);
    if (!zone) return;

    setOpeningEditTarget(null);
    setActiveTakeoffZoneId(zone.id);
    setTool('pointer');
    setSelectedToolPanel('select');
    setActivePage(zone.pageIndex);
    setActiveView(zone.viewId);
    const isZoneHidden = hiddenObjectIdsByView.get(zone.viewId)?.has(zone.id) ?? false;
    if (isZoneHidden) {
      toggleObjectHiddenInView(zone.viewId, zone.id);
    }
    selectTrace(zone.id);
  };

  const handleSelectZoneFromCatalog = (zoneId: string) => {
    setExpandedZoneCatalogId((current) => (current === zoneId ? null : zoneId));
    handleSelectZone(zoneId);
  };

  const handleCompleteZone = (zoneId: string) => {
    updateZoneObject(zoneId, {
      takeoffStatus: 'complete',
    });

    setOpeningEditTarget(null);
    if (activeTakeoffZoneId === zoneId) {
      setActiveTakeoffZoneId(null);
    }

    if (selectedTraceId === zoneId) {
      clearSelection();
    }
  };

  const handleSelectZoneWall = (wallRunId: string) => {
    const wallRun = (session?.wallRuns ?? []).find((item) => item.id === wallRunId);
    if (!wallRun) return;

    setOpeningEditTarget(null);
    setTool('pointer');
    setSelectedToolPanel('select');
    setActivePage(wallRun.pageIndex);
    setActiveView(wallRun.viewId);
    const isHidden = hiddenObjectIdsByView.get(wallRun.viewId)?.has(wallRun.id) ?? false;
    if (isHidden) {
      toggleObjectHiddenInView(wallRun.viewId, wallRun.id);
    }
    selectTrace(wallRun.id);
  };

  const handleEditZoneOpening = (item: ZoneLayerOpeningEntry) => {
    const target: OpeningLayerEditTarget = {
      wallRunId: item.wallRunId,
      openingType: item.openingType,
      widthFt: item.widthFt,
      heightFt: item.heightFt,
      label: item.label,
    };

    handleSelectZoneWall(item.wallRunId);
    setOpeningEditTarget(target);

    if (item.openingType === 'window') {
      setSelectedToolPanel('window');
      setSelectedWindowCatalogId(
        item.widthFt !== null && item.heightFt !== null
          ? (windowCatalog.find(
              (catalogItem) =>
                dimensionsMatch(catalogItem.widthFt, item.widthFt) &&
                dimensionsMatch(catalogItem.heightFt, item.heightFt),
            )?.id ?? null)
          : null,
      );
      setWindowWidthText(item.widthFt !== null ? formatFeetInches(item.widthFt) : '');
      setWindowHeightText(item.heightFt !== null ? formatFeetInches(item.heightFt) : '');
      setWindowSourceText(null);
      setWindowToolMode('idle');
      setWindowStatus(`Editing ${item.label}`);
      return;
    }

    setSelectedToolPanel('door');
    setSelectedDoorCatalogId(
      item.widthFt !== null && item.heightFt !== null
        ? (doorCatalog.find(
            (catalogItem) =>
              catalogItem.type === item.openingType &&
              dimensionsMatch(catalogItem.widthFt, item.widthFt) &&
              dimensionsMatch(catalogItem.heightFt, item.heightFt),
          )?.id ?? null)
        : null,
    );
    setDoorType(item.openingType as Exclude<OpeningType, 'window'>);
    setDoorWidthText(item.widthFt !== null ? formatFeetInches(item.widthFt) : '');
    setDoorHeightText(item.heightFt !== null ? formatFeetInches(item.heightFt) : '');
    setDoorSourceText(null);
    setDoorToolMode('idle');
    setDoorStatus(`Editing ${item.label}`);
  };

  const handleDeleteZoneOpening = (item: ZoneLayerOpeningEntry) => {
    const target: OpeningLayerEditTarget = {
      wallRunId: item.wallRunId,
      openingType: item.openingType,
      widthFt: item.widthFt,
      heightFt: item.heightFt,
      label: item.label,
    };

    const deleted = removeOpeningGroupFromWall(target);
    if (!deleted) return;

    if (
      openingEditTarget &&
      openingEditTarget.wallRunId === item.wallRunId &&
      openingEditTarget.openingType === item.openingType &&
      dimensionsMatch(openingEditTarget.widthFt, item.widthFt) &&
      dimensionsMatch(openingEditTarget.heightFt, item.heightFt) &&
      openingEditTarget.label.trim() === item.label.trim()
    ) {
      setOpeningEditTarget(null);
    }

    if (item.openingType === 'window') {
      setWindowStatus(`Deleted ${item.label}`);
      return;
    }

    setDoorStatus(`Deleted ${item.label}`);
  };

  const applyOpeningEditToWall = (
    target: OpeningLayerEditTarget,
    nextOpening: {
      type: OpeningType;
      widthFt: number;
      heightFt: number;
      label: string;
    },
  ) => {
    if (!session) return false;

    let updated = false;

    for (const classification of session.classifications) {
      if (classification.traceId !== target.wallRunId || classification.segmentIndex < 0) continue;

      let segmentChanged = false;
      const nextOpenings = classification.openings.map((opening) => {
        if (!openingMatchesEditTarget(opening, target)) {
          return opening;
        }

        segmentChanged = true;
        updated = true;

        return {
          ...opening,
          type: nextOpening.type,
          width_ft: nextOpening.widthFt,
          height_ft: nextOpening.heightFt,
          label: nextOpening.label,
        };
      });

      if (segmentChanged) {
        setSegmentOpenings(target.wallRunId, classification.segmentIndex, nextOpenings);
      }
    }

    return updated;
  };

  const removeOpeningGroupFromWall = (target: OpeningLayerEditTarget) => {
    if (!session) return false;

    let removed = false;

    for (const classification of session.classifications) {
      if (classification.traceId !== target.wallRunId || classification.segmentIndex < 0) continue;

      const openings = classification.openings ?? [];
      const nextOpenings = openings.filter((opening) => !openingMatchesEditTarget(opening, target));

      if (nextOpenings.length !== openings.length) {
        removed = true;
        setSegmentOpenings(target.wallRunId, classification.segmentIndex, nextOpenings);
      }
    }

    return removed;
  };

  const addOpeningToSelectedWall = (nextOpening: {
    type: OpeningType;
    widthFt: number;
    heightFt: number;
    label: string;
  }) => {
    const state = useTakeoffStore.getState();
    const currentSession = state.session;
    const currentSelectedTraceId = state.selectedTraceId;
    const currentSelectedSegmentIndex = state.selectedSegmentIndex;

    if (!currentSession || !selectedZoneWallRunId) return null;

    const matchingClassifications = currentSession.classifications
      .filter(
        (classification) =>
          classification.traceId === selectedZoneWallRunId && classification.segmentIndex >= 0,
      )
      .sort((a, b) => a.segmentIndex - b.segmentIndex);

    const targetSegmentIndex =
      currentSelectedTraceId === selectedZoneWallRunId && currentSelectedSegmentIndex !== null
        ? currentSelectedSegmentIndex
        : matchingClassifications[0]?.segmentIndex ?? 0;

    const classification = matchingClassifications.find(
      (item) => item.segmentIndex === targetSegmentIndex,
    );
    if (!classification) return null;

    const openings = classification.openings ?? [];
    const existingMatch = openings.find(
      (opening) =>
        opening.type === nextOpening.type &&
        Math.abs(opening.width_ft - nextOpening.widthFt) < 0.01 &&
        Math.abs(opening.height_ft - nextOpening.heightFt) < 0.01 &&
        (opening.label ?? '') === nextOpening.label,
    );

    const nextOpenings: Opening[] = existingMatch
      ? openings.map((opening) =>
          opening.id === existingMatch.id
            ? { ...opening, quantity: opening.quantity + 1 }
            : opening,
        )
      : [
          ...openings,
          {
            id: crypto.randomUUID(),
            type: nextOpening.type,
            width_ft: nextOpening.widthFt,
            height_ft: nextOpening.heightFt,
            quantity: 1,
            label: nextOpening.label,
          },
        ];

    setSegmentOpenings(selectedZoneWallRunId, targetSegmentIndex, nextOpenings);
    selectSegment(selectedZoneWallRunId, targetSegmentIndex);

    return {
      segmentIndex: targetSegmentIndex,
      openingArea: nextOpenings.reduce((sum, opening) => sum + openingAreaSf(opening), 0),
      openingCount: nextOpenings.reduce((sum, opening) => sum + opening.quantity, 0),
    };
  };

  useEffect(() => {
    if (isWindowToolActive) {
      setSelectedToolPanel('window');
      return;
    }

    if (isDoorToolActive) {
      setSelectedToolPanel('door');
      return;
    }

    if (isCalibrateMode) {
      setSelectedToolPanel('scale');
      return;
    }

    if (isTraceMode) {
      if (drawingPreset === 'surface') {
        setSelectedToolPanel('surface');
        return;
      }
      setSelectedToolPanel(activeWallPresetKey === fourInchPreset.key ? 'wall4' : 'wall6');
      return;
    }

    if (isPointerMode && selectedSurfaceTrace) {
      setSelectedToolPanel('surface');
      return;
    }

    if (isPointerMode && selectedZone) {
      setSelectedToolPanel('select');
    }
  }, [
    activeWallPresetKey,
    drawingPreset,
    fourInchPreset.key,
    isCalibrateMode,
    isDoorToolActive,
    isPointerMode,
    isTraceMode,
    isWindowToolActive,
    selectedSurfaceTrace,
    selectedZone,
  ]);

  const handleTraceWall = (presetKey: WallPresetKey) => {
    if (!isCalibrated) return;
    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setRoofPitchToolMode('idle');
    if (selectedZone) {
      clearSelection();
    }
    setSelectedToolPanel(presetKey === fourInchPreset.key ? 'wall4' : 'wall6');
    setDrawingPreset('wall');
    setWallPreset(presetKey);
    startTrace('linear');
  };

  const handleTraceSurface = (presetKey: SurfacePresetKey = activeSurfacePresetKey) => {
    if (!isCalibrated) return;
    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setRoofPitchToolMode('idle');
    setSurfaceStatus(null);
    setSelectedToolPanel('surface');
    setDrawingPreset('surface');
    setSurfacePreset(presetKey);
    startTrace('area');
  };

  const handleApplySurfacePresetToSelection = () => {
    if (!selectedSurfaceTrace) return;
    updateSurfaceObject(selectedSurfaceTrace.id, {
      assemblyScope: activeSurfacePreset.scope,
      label: activeSurfacePreset.label,
    });
    setSurfaceStatus(`Applied ${activeSurfacePreset.label} to the selected area.`);
  };

  const handleOpenRoofPanel = () => {
    setSelectedToolPanel('roof');
    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setRoofPitchToolMode('idle');
    if (!roofToolEnabled) {
      setRoofPitchStatus('Select an attic zone to trace or edit roof sections.');
    }
  };

  const handleTraceRoof = () => {
    if (!canTraceRoof) {
      setSelectedToolPanel('roof');
      setRoofPitchStatus('Select the attic zone first, then trace the roof section.');
      return;
    }

    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setRoofPitchToolMode('idle');
    setSurfaceStatus(null);
    setRoofPitchStatus(null);
    setSelectedToolPanel('roof');
    setDrawingPreset('surface');
    setSurfacePreset('cathedral_ceiling');
    startTrace('area');
  };

  const handleConvertSelectedSurfaceToRoof = () => {
    if (!selectedSurfaceTrace) return;

    updateSurfaceObject(selectedSurfaceTrace.id, {
      assemblyScope: 'cathedral_ceiling',
    });
    setRoofPitchStatus('Selected area is now treated as a roof section.');
    setSelectedToolPanel('roof');
  };

  const handleStartRoofPitchCapture = () => {
    if (!selectedSurfaceTrace) {
      setRoofPitchStatus('Trace or select a roof section first.');
      return;
    }

    if ((selectedSurfaceObject?.assemblyScope ?? selectedSurfaceScope) !== 'cathedral_ceiling') {
      setRoofPitchStatus('Convert the selected area to a roof section before scanning pitch.');
      return;
    }

    setWindowToolMode('idle');
    setDoorToolMode('idle');
    setRoofPitchToolMode('capture');
    setSelectedToolPanel('roof');
    setRoofPitchStatus('Drag a box around the roof pitch note.');
  };

  const handleApplyRoofPitch = (
    source: 'manual' | 'vision',
    confidence?: number | null,
    pitchOverride?: { rise: number; run: number } | null,
    sourceTextOverride?: string | null,
  ) => {
    const pitch = pitchOverride ?? roofPitchDraft;
    if (!selectedSurfaceTrace || !pitch) return;

    const adjustedAreaSf = computeSlopedAreaSf(
      selectedSurfacePlanAreaSf,
      pitch.rise,
      pitch.run,
    );

    updateSurfaceObject(selectedSurfaceTrace.id, {
      assemblyScope: 'cathedral_ceiling',
      roofPitchRise: pitch.rise,
      roofPitchRun: pitch.run,
      roofPitchSourceText: sourceTextOverride ?? roofPitchSourceText ?? formatRoofPitch(pitch.rise, pitch.run),
      roofPitchConfidence:
        source === 'vision' && typeof confidence === 'number'
          ? Math.max(0, Math.min(1, confidence))
          : null,
      roofPitchSource: source,
    });

    setRoofPitchStatus(
      `${formatRoofPitch(pitch.rise, pitch.run)} applied · ${Math.round(adjustedAreaSf).toLocaleString()} SF adjusted`,
    );
    setRoofPitchToolMode('idle');
    setSelectedToolPanel('roof');
  };

  const handleClearRoofPitch = () => {
    if (!selectedSurfaceTrace) return;

    updateSurfaceObject(selectedSurfaceTrace.id, {
      roofPitchRise: null,
      roofPitchRun: null,
      roofPitchSourceText: null,
      roofPitchConfidence: null,
      roofPitchSource: null,
    });
    setRoofPitchSourceText(null);
    setRoofPitchStatus('Cleared roof pitch from the selected section.');
  };

  useEffect(() => {
    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      const state = useTakeoffStore.getState();
      const calibrationActive =
        state.calibrationStep !== 'idle' && state.calibrationStep !== 'done';
      const storeNeedsReset =
        state.tool === 'trace' ||
        state.tool === 'calibrate' ||
        state.tool === 'auto_detect' ||
        calibrationActive;
      const localNeedsReset =
        windowToolMode !== 'idle' ||
        doorToolMode !== 'idle' ||
        roofPitchToolMode !== 'idle' ||
        manualWindowModalOpen ||
        openingEditTarget !== null ||
        selectedToolPanel !== 'select';

      if (!storeNeedsReset && !localNeedsReset) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (storeNeedsReset) {
        handleEscape();
      } else if (state.tool !== 'pointer') {
        setTool('pointer');
      }

      setWindowToolMode('idle');
      setDoorToolMode('idle');
      setRoofPitchToolMode('idle');
      setManualWindowModalOpen(false);
      setPendingManualWindowMarkerPoint(null);
      setOpeningEditTarget(null);
      setWindowStatus(null);
      setDoorStatus(null);
      setRoofPitchStatus(null);
      setWindowSourceText(null);
      setDoorSourceText(null);
      setRoofPitchSourceText(null);
      setSelectedWindowCatalogId(null);
      setSelectedDoorCatalogId(null);
      setSelectedToolPanel('select');
    };

    window.addEventListener('keydown', handleGlobalEscape, true);
    return () => window.removeEventListener('keydown', handleGlobalEscape, true);
  }, [
    doorToolMode,
    handleEscape,
    manualWindowModalOpen,
    openingEditTarget,
    roofPitchToolMode,
    selectedToolPanel,
    setTool,
    windowToolMode,
  ]);

  useBlueprintPageHotkeys({
    activePageIndex,
    selectedPages,
    setActivePage,
    disabled: tool === 'trace' || showCalibrationOverlay,
    onBeforeNavigate: () => setPageTrayOpen(false),
  });

  const handleStartCaptureWindow = () => {
    if (!canUseOpeningTools) return;
    setOpeningEditTarget(null);
    setTool('pointer');
    setDoorToolMode('idle');
    setRoofPitchToolMode('idle');
    setSelectedToolPanel('window');
    setManualWindowModalOpen(false);
    setPendingManualWindowMarkerPoint(null);
    setWindowToolMode('capture');
    setWindowStatus('Drag a box around the printed window size.');
  };

  const handleStartPlaceWindow = () => {
    if (!windowPreset || !canUseOpeningTools) return;
    setOpeningEditTarget(null);
    setTool('pointer');
    setDoorToolMode('idle');
    setRoofPitchToolMode('idle');
    setSelectedToolPanel('window');
    setWindowToolMode('place');
    setWindowStatus(
      selectedZoneWallLabel
        ? `Placing ${windowPreset.label} on ${selectedZoneWallLabel}.`
        : `Placing ${windowPreset.label}.`,
    );
  };

  const handleResetWindowTool = () => {
    setOpeningEditTarget(null);
    setManualWindowModalOpen(false);
    setPendingManualWindowMarkerPoint(null);
    setWindowToolMode('idle');
    setWindowSourceText(null);
    setWindowStatus(null);
  };

  const handleCancelManualWindowModal = () => {
    setManualWindowModalOpen(false);
    setPendingManualWindowMarkerPoint(null);
    setWindowStatus('Drag a box around the printed window size.');
  };

  const handleSubmitManualWindowModal = () => {
    if (!parsedWindowWidthFt || !parsedWindowHeightFt) return;

    const label = `${formatFeetInches(parsedWindowWidthFt)} x ${formatFeetInches(parsedWindowHeightFt)}`;
    const catalogResult = upsertWindowCatalogItem({
      widthFt: parsedWindowWidthFt,
      heightFt: parsedWindowHeightFt,
      label,
      sourceText: windowSourceText,
      pageIndex: activePageIndex,
    });
    setSelectedWindowCatalogId(catalogResult?.id ?? null);

    const placementResult = canUseOpeningTools
      ? addOpeningToSelectedWall({
          type: 'window',
          widthFt: parsedWindowWidthFt,
          heightFt: parsedWindowHeightFt,
          label,
        })
      : null;

    if (pendingManualWindowMarkerPoint && selectedZoneWallRunId) {
      addOpeningScanMarker({
        openingType: 'window',
        pageIndex: activePageIndex,
        wallRunId: selectedZoneWallRunId,
        point: pendingManualWindowMarkerPoint,
      });
    }

    setManualWindowModalOpen(false);
    setPendingManualWindowMarkerPoint(null);
    setWindowToolMode('capture');
    setWindowStatus(
      placementResult && selectedZoneWallLabel
        ? `Added ${label} to ${selectedZoneWallLabel}`
        : `${catalogResult?.isNew ? 'Added' : 'Updated'} ${label}`,
    );
  };

  const handleStartCaptureDoor = () => {
    if (!canUseOpeningTools) return;
    setOpeningEditTarget(null);
    setTool('pointer');
    setWindowToolMode('idle');
    setRoofPitchToolMode('idle');
    setSelectedToolPanel('door');
    setDoorToolMode('capture');
    setDoorStatus('Drag a box around the printed door size.');
  };

  const handleStartPlaceDoor = () => {
    if (!doorPreset || !canUseOpeningTools) return;
    setOpeningEditTarget(null);
    setTool('pointer');
    setWindowToolMode('idle');
    setRoofPitchToolMode('idle');
    setSelectedToolPanel('door');
    setDoorToolMode('place');
    setDoorStatus(
      selectedZoneWallLabel
        ? `Placing ${doorPreset.label} on ${selectedZoneWallLabel}.`
        : `Placing ${doorPreset.label}.`,
    );
  };

  const handleResetDoorTool = () => {
    setOpeningEditTarget(null);
    setDoorToolMode('idle');
    setDoorSourceText(null);
    setDoorStatus(null);
  };

  const handleSaveCurrentWindowToCatalog = () => {
    if (!windowPreset) return;

    const result = upsertWindowCatalogItem({
      widthFt: windowPreset.widthFt,
      heightFt: windowPreset.heightFt,
      label: windowPreset.label,
      sourceText: windowSourceText,
      pageIndex: activePageIndex,
    });

    if (!result) return;

    const editedPlacedWindows =
      openingEditTarget?.openingType === 'window'
        ? applyOpeningEditToWall(openingEditTarget, {
            type: 'window',
            widthFt: windowPreset.widthFt,
            heightFt: windowPreset.heightFt,
            label: windowPreset.label,
          })
        : false;

    setSelectedWindowCatalogId(result.id);
    setWindowStatus(
      editedPlacedWindows
        ? `Updated placed ${windowPreset.label} openings on ${selectedZoneWallLabel ?? 'the selected wall'}.`
        : result.isNew
          ? `Saved ${windowPreset.label} to this plan set's window catalog.`
          : `Updated the existing ${windowPreset.label} catalog item for this plan set.`,
    );
    if (editedPlacedWindows) {
      setOpeningEditTarget(null);
    }
  };

  const handleSaveCurrentDoorToCatalog = () => {
    if (!doorPreset) return;

    const result = upsertDoorCatalogItem({
      type: doorPreset.type,
      widthFt: doorPreset.widthFt,
      heightFt: doorPreset.heightFt,
      label: doorPreset.label,
      sourceText: doorSourceText,
      pageIndex: activePageIndex,
    });

    if (!result) return;

    const editedPlacedDoors =
      openingEditTarget && openingEditTarget.openingType !== 'window'
        ? applyOpeningEditToWall(openingEditTarget, {
            type: doorPreset.type,
            widthFt: doorPreset.widthFt,
            heightFt: doorPreset.heightFt,
            label: doorPreset.label,
          })
        : false;

    setSelectedDoorCatalogId(result.id);
    setDoorStatus(
      editedPlacedDoors
        ? `Updated placed ${doorPreset.label} openings on ${selectedZoneWallLabel ?? 'the selected wall'}.`
        : result.isNew
          ? `Saved ${doorPreset.label} to this plan set's door catalog.`
          : `Updated the existing ${doorPreset.label} catalog item for this plan set.`,
    );
    if (editedPlacedDoors) {
      setOpeningEditTarget(null);
    }
  };

  const handleCopyGestureDebugLog = async () => {
    if (!SHOW_TAKEOFF_DEBUG_OVERLAYS) return;

    const payload = gestureDebugLogRef.current.map((entry) => formatGestureDebugEntry(entry)).join('\n');
    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
      setGestureDebugCopyState('copied');
      return;
    } catch {
      const textarea = gestureDebugTextareaRef.current;
      if (!textarea) {
        setGestureDebugCopyState('error');
      } else {
        textarea.value = payload;
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, payload.length);

        try {
          const succeeded = document.execCommand('copy');
          setGestureDebugCopyState(succeeded ? 'copied' : 'error');
        } catch {
          setGestureDebugCopyState('error');
        }
      }
    }

    window.setTimeout(() => {
      setGestureDebugCopyState('idle');
    }, 1600);
  };

  const instructionText = (() => {
    switch (calibrationStep) {
      case 'primary_a':
        return 'Pick first scale point';
      case 'primary_input':
        return 'Enter first dimension';
      case 'verify_a':
        return 'Pick verify point';
      case 'verify_input':
        return 'Enter verify dimension';
      default:
        if (isWindowCaptureMode) {
          return 'Scan window note';
        }
        if (isDoorCaptureMode) {
          return 'Scan door note';
        }
        if (isRoofPitchCaptureMode) {
          return 'Scan roof pitch';
        }
        if (isWindowPlaceMode && windowPreset) {
          return `Stamp ${windowPreset.label}`;
        }
        if (isDoorPlaceMode && doorPreset) {
          return `Stamp ${doorPreset.label}`;
        }
        if (tool === 'trace' && drawingPreset === 'surface' && activeTracePoints.length > 0) {
          return `${activeSurfacePreset.label} boundary`;
        }
        if (selectedToolPanel === 'roof') {
          if (selectedAreaMetrics) {
            return hasSelectedRoofPitch
              ? `${Math.round(selectedSurfaceAdjustedAreaSf).toLocaleString()} SF adjusted`
              : 'Scan or enter roof pitch';
          }
          return atticZoneSelected ? 'Trace roof section' : 'Select attic zone';
        }
        if (selectedZone) {
          return zoneStatusCopy(selectedZone.zoneType, selectedZoneMissingData);
        }
        if (tool === 'trace' && activeTracePoints.length > 0) {
          return `${activeWallPreset.thicknessIn}" wall · Tab flips fill`;
        }
        if (tool === 'pointer' && selectedRoofSurface && selectedAreaMetrics) {
          return `${Math.round(selectedSurfaceAdjustedAreaSf).toLocaleString()} SF roof section`;
        }
        if (tool === 'pointer' && selectedSurfaceTrace && selectedAreaMetrics) {
          return `${Math.round(selectedAreaMetrics.areaSf)} SF selected`;
        }
        if (tool === 'pointer' && selectedTraceId) {
          if (selectedSegmentIndex !== null) {
            return selectedOpenWall ? 'Segment selected' : 'Shape selected';
          }
          return selectedOpenWall ? 'Wall selected' : 'Shape selected';
        }
        if (tool === 'pointer') {
          return 'Select or edit';
        }
        return isCalibrated ? 'Live toolbar review' : 'Run calibration first';
    }
  })();
  const activeModeLabel = (() => {
    if (isWindowCaptureMode) return 'Window scan';
    if (isWindowPlaceMode) return 'Place window';
    if (isDoorCaptureMode) return 'Door scan';
    if (isDoorPlaceMode) return 'Place door';
    if (isRoofPitchCaptureMode) return 'Roof pitch scan';
    if (isCalibrateMode) return 'Scale';
    if (selectedToolPanel === 'roof') return 'Roof';
    if (isSurfaceTraceMode) return activeSurfacePreset.label;
    if (isTraceMode) return `${activeWallPreset.thicknessIn}" wall`;
    return 'Select';
  })();
  const sidebarWidthClass = 'w-[304px]';
  const railSurfaceClass = 'bg-[rgba(248,248,246,0.98)]';
  const sectionClass =
    'border-b border-[var(--takeoff-line)] px-3 py-3 last:border-b-0';
  const inputClass =
    'takeoff-mono w-full border border-[var(--takeoff-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5';
  const activePanelTitle = (() => {
    if (selectedZone && (selectedToolPanel === 'window' || selectedToolPanel === 'door')) {
      return 'Select';
    }

    switch (selectedToolPanel) {
      case 'scale':
        return 'Scale';
      case 'wall6':
        return '6" Wall';
      case 'wall4':
        return '4" Wall';
      case 'surface':
        return 'Area';
      case 'roof':
        return 'Roof';
      case 'window':
        return 'Windows';
      case 'door':
        return 'Doors';
      default:
        return 'Select';
    }
  })();
  const showZoneLayersPanel =
    Boolean(selectedZone) &&
    (selectedToolPanel === 'select' || selectedToolPanel === 'window' || selectedToolPanel === 'door');
  const primaryToolButtons = (iconOnly = false) => (
    <>
      <PrimaryToolButton
        label="Select"
        icon={MousePointer2}
        active={isPointerMode && !isWindowToolActive && !isDoorToolActive}
        accent="neutral"
        compact
        iconOnly={iconOnly}
        onClick={() => {
          setSelectedToolPanel('select');
          setWindowToolMode('idle');
          setDoorToolMode('idle');
          setRoofPitchToolMode('idle');
          setTool('pointer');
        }}
      />
      <PrimaryToolButton
        label={calibration ? 'Scale' : 'Scale'}
        icon={Ruler}
        active={isCalibrateMode}
        accent="neutral"
        compact
        iconOnly={iconOnly}
        onClick={() => {
          setSelectedToolPanel('scale');
          setWindowToolMode('idle');
          setDoorToolMode('idle');
          setRoofPitchToolMode('idle');
          startCalibration();
        }}
      />
      <PrimaryToolButton
        label='6" wall'
        icon={PenLine}
        active={isTraceMode && activeWallPresetKey === sixInchPreset.key}
        disabled={!isCalibrated}
        accent="burgundy"
        compact
        iconOnly={iconOnly}
        onClick={() => handleTraceWall(sixInchPreset.key)}
      />
      <PrimaryToolButton
        label='4" wall'
        icon={PenLine}
        active={isTraceMode && activeWallPresetKey === fourInchPreset.key}
        disabled={!isCalibrated}
        accent="amber"
        compact
        iconOnly={iconOnly}
        onClick={() => handleTraceWall(fourInchPreset.key)}
      />
      <PrimaryToolButton
        label="Area"
        icon={Pentagon}
        active={isSurfaceTraceMode}
        disabled={!isCalibrated}
        accent="blue"
        compact
        iconOnly={iconOnly}
        onClick={() => handleTraceSurface()}
      />
      <PrimaryToolButton
        label="Roof"
        icon={ChevronUp}
        active={selectedToolPanel === 'roof' || isRoofPitchCaptureMode}
        disabled={!roofToolEnabled}
        accent="teal"
        compact
        iconOnly={iconOnly}
        onClick={handleOpenRoofPanel}
      />
      <PrimaryToolButton
        label="Win scan"
        icon={ScanSearch}
        active={isWindowCaptureMode}
        disabled={!canUseOpeningTools}
        accent="blue"
        compact
        iconOnly={iconOnly}
        onClick={handleStartCaptureWindow}
      />
      <PrimaryToolButton
        label="Door scan"
        icon={ScanSearch}
        active={isDoorCaptureMode}
        disabled={!canUseOpeningTools}
        accent="green"
        compact
        iconOnly={iconOnly}
        onClick={handleStartCaptureDoor}
      />
    </>
  );

  return (
    <div className="takeoff-shell takeoff-light-theme h-full overflow-hidden text-[var(--takeoff-ink)]">
      <div className="relative flex h-full overflow-hidden border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.74)] shadow-[0_30px_72px_rgba(31,39,33,0.12)]">
        <aside className={`flex h-full shrink-0 overflow-hidden border-r border-[var(--takeoff-line)] ${sidebarWidthClass} ${railSurfaceClass}`}>
          <div className="takeoff-hide-scrollbar flex h-full w-full flex-col overflow-y-auto">
            <div className={sectionClass}>
              <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                Matrix Toolbar
              </div>
              <div className="mt-1 text-[15px] font-medium text-[var(--takeoff-ink)]">
                {activePageTitle}
              </div>
            </div>

            <div className={sectionClass}>
              <div className="grid grid-cols-2 gap-2">{primaryToolButtons(false)}</div>
            </div>

            <div className={sectionClass}>
              <div className="flex items-center justify-between gap-3">
                <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Areas
                </div>
                <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                  {visibleZones.length}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {visibleZones.length > 0 ? (
                  visibleZones.map((zone) => {
                    const zoneLifecycle = deriveZoneLifecycleState(zone);
                    return (
                      <button
                        key={`zone-task-${zone.id}`}
                        onClick={() => handleSelectZone(zone.id)}
                        className={`group relative w-full border px-2.5 py-1.5 text-left transition-colors ${
                          selectedZone?.id === zone.id
                            ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)]'
                            : 'border-[var(--takeoff-line)] bg-white hover:border-[#9eb29d]'
                        }`}
                      >
                        <div className={`relative flex items-center gap-2 ${zoneLifecycle === 'needs_takeoff' ? 'pr-14' : 'pr-8'}`}>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: ZONE_COLORS[normalizeZoneType(zone.zoneType, zone.label)].stroke }}
                            />
                            <span className="truncate text-[11px] font-medium text-[var(--takeoff-ink)]">
                              {zone.label}
                            </span>
                          </div>
                          <span
                            className={`takeoff-mono absolute right-0 shrink-0 text-[9px] text-[var(--takeoff-text-subtle)] ${
                              zoneLifecycle === 'needs_takeoff' ? 'transition-opacity group-hover:opacity-0' : ''
                            }`}
                          >
                            P{zone.pageIndex + 1}
                          </span>
                        </div>
                        {zoneLifecycle === 'needs_takeoff' && (
                          <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleCompleteZone(zone.id);
                              }}
                              className="pointer-events-auto takeoff-mono inline-flex items-center gap-1 border border-[rgba(22,163,74,0.2)] bg-[rgba(22,163,74,0.08)] px-1.5 py-0.5 text-[8px] text-[#15803d] transition-colors hover:border-[rgba(22,163,74,0.35)] hover:bg-[rgba(22,163,74,0.14)]"
                            >
                              <Check className="h-3 w-3" />
                              <span>Complete</span>
                            </button>
                          </div>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2.5 text-[10px] leading-5 text-[var(--takeoff-text-muted)]">
                    No takeoff areas to pick.
                  </div>
                )}
              </div>
            </div>

            <div className={`${sectionClass} min-h-0 flex-1`}>
              <div className="flex items-center justify-between gap-3">
                <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                  {activePanelTitle}
                </div>
                <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                  {activeModeLabel}
                </span>
              </div>

      {showZoneLayersPanel && (
                <div className="mt-3 space-y-3">
                  {selectedZone ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                            Layers
                          </div>
                          <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                            {zoneLayerItems.length}
                          </span>
                        </div>
                        {zoneLayerItems.map((item) =>
                          item.kind === 'wall' ? (
                            <button
                              key={item.id}
                              onClick={() => handleSelectZoneWall(item.wallRunId)}
                              className={`w-full border px-2.5 py-1.5 text-left transition-colors ${
                                item.selected
                                  ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)]'
                                  : 'border-[var(--takeoff-line)] bg-white hover:border-[#9eb29d]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] font-medium text-[var(--takeoff-ink)]">
                                    {item.label}
                                  </div>
                                  {item.descriptor ? (
                                    <div className="text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                                      {item.descriptor}
                                    </div>
                                  ) : null}
                                </div>
                                {item.hidden && (
                                  <span className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-1.5 py-0.5 text-[8px] text-[var(--takeoff-text-subtle)]">
                                    hidden
                                  </span>
                                )}
                              </div>
                            </button>
                          ) : (
                            <div
                              key={item.id}
                              onClick={() => handleSelectZoneWall(item.wallRunId)}
                              onDoubleClick={() => handleEditZoneOpening(item)}
                              title="Double-click to edit this opening group"
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  handleSelectZoneWall(item.wallRunId);
                                }
                              }}
                              className={`group relative ml-3 w-[calc(100%-0.75rem)] border px-2.5 py-1.5 pr-9 text-left transition-colors ${
                                openingEditTarget &&
                                openingEditTarget.wallRunId === item.wallRunId &&
                                openingEditTarget.openingType === item.openingType &&
                                dimensionsMatch(openingEditTarget.widthFt, item.widthFt) &&
                                dimensionsMatch(openingEditTarget.heightFt, item.heightFt) &&
                                openingEditTarget.label.trim() === item.label.trim()
                                  ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)]'
                                  : 'border-[var(--takeoff-line)] bg-[rgba(248,248,246,0.8)] hover:border-[#9eb29d]'
                              }`}
                            >
                              <div className="truncate text-[11px] font-medium text-[var(--takeoff-ink)]">
                                {item.label}
                              </div>
                              <div className="text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                                {item.descriptor}
                              </div>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleDeleteZoneOpening(item);
                                }}
                                className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center border border-transparent text-[var(--takeoff-text-subtle)] opacity-0 transition-all hover:border-[var(--takeoff-line)] hover:bg-white hover:text-[#991b1b] group-hover:opacity-100"
                                aria-label={`Delete ${item.label}`}
                                title={`Delete ${item.label}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                        {instructionText}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <UtilityActionButton
                          label="Continue wall"
                          disabled={!canContinueSelectedWall}
                          onClick={() => {
                            if (selectedOpenWall) {
                              continueTrace(selectedOpenWall.id);
                            }
                          }}
                        />
                        <UtilityActionButton
                          label={deleteSelectionLabel}
                          disabled={!canDeleteSelectedTrace}
                          onClick={() => {
                            if (selectedOpenWall && selectedSegmentIndex !== null) {
                              deleteTraceSegment(selectedOpenWall.id, selectedSegmentIndex);
                              return;
                            }
                            if (selectedTrace) {
                              deleteTrace(selectedTrace.id);
                            }
                          }}
                        />
                      </div>
                      {selectedSegmentMetrics && (
                        <div className="takeoff-mono inline-flex border border-[rgba(161,98,7,0.16)] bg-[rgba(161,98,7,0.08)] px-2 py-1 text-[10px] text-[#92400e]">
                          Net {Math.round(selectedSegmentMetrics.netSf)} SF
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {selectedToolPanel === 'scale' && (
                <div className="mt-3 space-y-3">
                  <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                    {instructionText}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`takeoff-mono border px-2 py-1 text-[10px] ${
                      isCalibrated
                        ? 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]'
                        : 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
                    }`}>
                      {isCalibrated ? 'Scale on' : 'Scale off'}
                    </span>
                    <span className="takeoff-mono border bg-white px-2 py-1 text-[10px]" style={{ borderColor: 'rgba(127,29,29,0.22)', color: '#7f1d1d' }}>
                      6&quot; {sixInchBandWidth ? `${sixInchBandWidth.toFixed(1)} px` : 'pending'}
                    </span>
                    <span className="takeoff-mono border bg-white px-2 py-1 text-[10px]" style={{ borderColor: 'rgba(146,64,14,0.22)', color: '#92400e' }}>
                      4&quot; {fourInchBandWidth ? `${fourInchBandWidth.toFixed(1)} px` : 'pending'}
                    </span>
                  </div>
                </div>
              )}

              {(selectedToolPanel === 'wall6' || selectedToolPanel === 'wall4') && (
                <div className="mt-3 space-y-3">
                  <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                    {instructionText}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="takeoff-mono border bg-white px-2 py-1 text-[10px]" style={selectedToolPanel === 'wall6' ? { borderColor: 'rgba(127,29,29,0.22)', color: '#7f1d1d' } : { borderColor: 'rgba(146,64,14,0.22)', color: '#92400e' }}>
                      {selectedToolPanel === 'wall6' ? '6"' : '4"'} active
                    </span>
                    {isTraceMode && (
                      <span className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-2 py-1 text-[10px] text-[var(--takeoff-text-muted)]">
                        Fill {activeWallFillSide}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <UtilityActionButton
                      label="Undo point"
                      disabled={tool !== 'trace' || activeTracePoints.length === 0}
                      onClick={() => removeLastTracePoint()}
                    />
                    <UtilityActionButton
                      label="Continue wall"
                      disabled={!canContinueSelectedWall}
                      onClick={() => {
                        if (selectedOpenWall) {
                          continueTrace(selectedOpenWall.id);
                        }
                      }}
                    />
                    <UtilityActionButton
                      label={deleteSelectionLabel}
                      disabled={!canDeleteSelectedTrace}
                      onClick={() => {
                        if (selectedOpenWall && selectedSegmentIndex !== null) {
                          deleteTraceSegment(selectedOpenWall.id, selectedSegmentIndex);
                          return;
                        }
                        if (selectedTrace) {
                          deleteTrace(selectedTrace.id);
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {selectedToolPanel === 'surface' && (
                <div className="mt-3 space-y-3">
                  <select
                    value={activeSurfacePresetKey}
                    onChange={(event) => {
                      const nextPreset = event.target.value as SurfacePresetKey;
                      setSurfacePreset(nextPreset);
                      setSurfaceStatus(`${getSurfacePreset(nextPreset).label} ready`);
                    }}
                    className={inputClass}
                  >
                    {SURFACE_PRESET_OPTIONS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <UtilityActionButton label="Trace" disabled={!isCalibrated} onClick={() => handleTraceSurface()} />
                    <UtilityActionButton label="Apply" disabled={!canApplySurfacePresetToSelection} onClick={handleApplySurfacePresetToSelection} />
                    <UtilityActionButton
                      label={deleteSelectionLabel}
                      disabled={!canDeleteSelectedTrace}
                      onClick={() => {
                        if (selectedTrace) {
                          deleteTrace(selectedTrace.id);
                        }
                      }}
                    />
                  </div>
                  <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                    {surfaceStatus ??
                      (selectedAreaMetrics
                        ? `${Math.round(selectedAreaMetrics.areaSf)} SF · ${Math.round(selectedAreaMetrics.perimeterLf)} LF perimeter`
                        : `${activeSurfacePreset.label} ready`)}
                  </div>
                  {selectedAreaMetrics && (
                    <div className="takeoff-mono inline-flex border border-[rgba(29,78,216,0.16)] bg-[rgba(29,78,216,0.08)] px-2 py-1 text-[10px] text-[#1d4ed8]">
                      {selectedAreaMetrics.classification?.assemblyScope ?? activeSurfacePreset.scope}
                    </div>
                  )}
                </div>
              )}

              {selectedToolPanel === 'roof' && (
                <div className="mt-3 space-y-3">
                  <div className="takeoff-mono text-[10px] leading-relaxed text-[var(--takeoff-text-muted)]">
                    Trace one roof section per uniform pitch, then scan or enter the pitch to convert plan area into sloped SF.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <UtilityActionButton label="Trace roof" disabled={!canTraceRoof} onClick={handleTraceRoof} />
                    <UtilityActionButton label="Use selection" disabled={!canConvertSelectedSurfaceToRoof} onClick={handleConvertSelectedSurfaceToRoof} />
                    <UtilityActionButton label="Scan pitch" disabled={!canScanRoofPitch} onClick={handleStartRoofPitchCapture} />
                    <UtilityActionButton
                      label="Apply pitch"
                      disabled={!roofPitchDraft || !selectedSurfaceTrace}
                      onClick={() => handleApplyRoofPitch('manual')}
                    />
                    <UtilityActionButton label="Clear pitch" disabled={!hasSelectedRoofPitch} onClick={handleClearRoofPitch} />
                    <UtilityActionButton
                      label={deleteSelectionLabel}
                      disabled={!canDeleteSelectedTrace}
                      onClick={() => {
                        if (selectedTrace) {
                          deleteTrace(selectedTrace.id);
                        }
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={roofPitchRiseText}
                      onChange={(event) => setRoofPitchRiseText(event.target.value)}
                      placeholder="Rise"
                      className={inputClass}
                    />
                    <input
                      value={roofPitchRunText}
                      onChange={(event) => setRoofPitchRunText(event.target.value)}
                      placeholder="Run"
                      className={inputClass}
                    />
                  </div>
                  <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                    {roofPitchStatus ??
                      (!roofToolEnabled
                        ? 'Select an attic zone to trace or edit roof sections.'
                        : selectedAreaMetrics
                          ? hasSelectedRoofPitch
                            ? `Plan ${Math.round(selectedSurfacePlanAreaSf).toLocaleString()} SF · Adjusted ${Math.round(selectedSurfaceAdjustedAreaSf).toLocaleString()} SF`
                            : `Plan ${Math.round(selectedSurfacePlanAreaSf).toLocaleString()} SF · scan or enter pitch`
                          : 'Trace a roof section to start pitch-adjusted SF.')}
                  </div>
                  {roofPitchDraftLabel && (
                    <div className="takeoff-mono inline-flex border border-[rgba(15,118,110,0.16)] bg-[rgba(15,118,110,0.08)] px-2 py-1 text-[10px] text-[#0f766e]">
                      Draft pitch {roofPitchDraftLabel}
                    </div>
                  )}
                  {roofPitchSourceText && (
                    <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                      Source: {roofPitchSourceText}
                    </div>
                  )}
                  {selectedSurfaceObject?.assemblyScope && (
                    <div className="takeoff-mono inline-flex border border-[rgba(15,118,110,0.16)] bg-[rgba(15,118,110,0.08)] px-2 py-1 text-[10px] text-[#0f766e]">
                      {selectedSurfaceObject.assemblyScope}
                    </div>
                  )}
                </div>
              )}

              {selectedToolPanel === 'window' && !selectedZone && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={windowWidthText}
                      onChange={(event) => setWindowWidthText(event.target.value)}
                      placeholder={`Win W`}
                      className={inputClass}
                    />
                    <input
                      value={windowHeightText}
                      onChange={(event) => setWindowHeightText(event.target.value)}
                      placeholder={`Win H`}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <UtilityActionButton label="Place" disabled={!windowPreset || !canUseOpeningTools} onClick={handleStartPlaceWindow} />
                    <UtilityActionButton label="Scan" disabled={!canUseOpeningTools} onClick={handleStartCaptureWindow} />
                    <UtilityActionButton label="Save" disabled={!windowPreset} onClick={handleSaveCurrentWindowToCatalog} />
                    <UtilityActionButton label="Complete" disabled={!canResetWindowTool && !windowPreset} onClick={handleResetWindowTool} />
                  </div>
                  {!canUseOpeningTools && (
                    <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                      Select a wall layer
                    </div>
                  )}
                </div>
              )}

              {selectedToolPanel === 'door' && !selectedZone && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={doorWidthText}
                      onChange={(event) => setDoorWidthText(event.target.value)}
                      placeholder={`Door W`}
                      className={inputClass}
                    />
                    <input
                      value={doorHeightText}
                      onChange={(event) => setDoorHeightText(event.target.value)}
                      placeholder={`Door H`}
                      className={inputClass}
                    />
                  </div>
                  <select
                    value={doorType}
                    onChange={(event) => setDoorType(event.target.value as Exclude<OpeningType, 'window'>)}
                    className={inputClass}
                  >
                    {Object.entries(DOOR_TYPE_LABELS).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <UtilityActionButton label="Place" disabled={!doorPreset || !canUseOpeningTools} onClick={handleStartPlaceDoor} />
                    <UtilityActionButton label="Scan" disabled={!canUseOpeningTools} onClick={handleStartCaptureDoor} />
                    <UtilityActionButton label="Save" disabled={!doorPreset} onClick={handleSaveCurrentDoorToCatalog} />
                    <UtilityActionButton label="Complete" disabled={!canResetDoorTool && !doorPreset} onClick={handleResetDoorTool} />
                  </div>
                  {!canUseOpeningTools && (
                    <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
                      Select a wall layer
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="relative min-w-0 flex-1 overflow-hidden border-l border-[var(--takeoff-line)] bg-[var(--takeoff-canvas)]">
          <div className="takeoff-dot-grid h-full overflow-hidden bg-[var(--takeoff-canvas)]">
            <BlueprintViewer
              ref={viewerRef}
              pdfUrl={pdfUrl}
              pageNumber={activePageIndex + 1}
              cursorMode={cursorMode}
              disableLeftMousePan
            >
              {(dims) => (
                <>
                  <WallThicknessOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    defaultThicknessIn={6}
                  />
                  <WallTraceOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    focusedZoneTraceId={selectedZone?.id ?? null}
                    pdfUrl={pdfUrl}
                    suppressMeasurementLabels={isWindowToolActive || isDoorToolActive || isRoofPitchCaptureMode || isRoofSectionEditingMode}
                    roofSectionMode={isRoofSectionEditingMode}
                  />
                  <WindowToolOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    pdfUrl={pdfUrl}
                    mode={windowToolMode}
                    preset={windowPreset}
                    traceIdFilter={selectedZoneWallRunId}
                    scanMarkers={windowScanMarkers}
                    onCaptureComplete={({ sourceText, detectedWidthFt, detectedHeightFt, detectionMethod, confirmed, disposition, markerPoint }) => {
                      setWindowSourceText(sourceText || null);

                      if (confirmed && detectedWidthFt && detectedHeightFt) {
                        setManualWindowModalOpen(false);
                        setPendingManualWindowMarkerPoint(null);
                        if (markerPoint && selectedZoneWallRunId) {
                          addOpeningScanMarker({
                            openingType: 'window',
                            pageIndex: activePageIndex,
                            wallRunId: selectedZoneWallRunId,
                            point: markerPoint,
                          });
                        }
                        setWindowToolMode('capture');
                        setWindowWidthText(formatFeetInches(detectedWidthFt));
                        setWindowHeightText(formatFeetInches(detectedHeightFt));
                        const catalogResult = upsertWindowCatalogItem({
                          widthFt: detectedWidthFt,
                          heightFt: detectedHeightFt,
                          label: `${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)}`,
                          sourceText,
                          pageIndex: activePageIndex,
                        });
                        setSelectedWindowCatalogId(catalogResult?.id ?? null);
                        const placementResult = canUseOpeningTools
                          ? addOpeningToSelectedWall({
                              type: 'window',
                              widthFt: detectedWidthFt,
                              heightFt: detectedHeightFt,
                              label: `${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)}`,
                            })
                          : null;
                        setWindowStatus(
                          placementResult && selectedZoneWallLabel
                            ? `Added ${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)} to ${selectedZoneWallLabel}`
                            : detectionMethod === 'vision'
                              ? `${catalogResult?.isNew ? 'Added' : 'Updated'} ${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)}`
                              : `Detected ${formatFeetInches(detectedWidthFt)} x ${formatFeetInches(detectedHeightFt)}`,
                        );
                        return;
                      }

                      setWindowToolMode('capture');
                      setSelectedWindowCatalogId(null);
                      setWindowWidthText(
                        detectedWidthFt && Number.isFinite(detectedWidthFt)
                          ? formatFeetInches(detectedWidthFt)
                          : '',
                      );
                      setWindowHeightText(
                        detectedHeightFt && Number.isFinite(detectedHeightFt)
                          ? formatFeetInches(detectedHeightFt)
                          : '',
                      );

                      setPendingManualWindowMarkerPoint(markerPoint ?? null);
                      setManualWindowModalOpen(true);
                      setWindowStatus(
                        disposition === 'invalid_target'
                          ? sourceText
                            ? `"${sourceText}" is not a standard window note. Enter the size manually.`
                            : 'Window scan could not read a standard note. Enter the size manually.'
                          : sourceText
                            ? `${detectionMethod === 'vision' ? 'Vision saw' : 'Captured'} "${sourceText}" but needs review`
                            : 'Window scan needs review',
                      );
                    }}
                    onPlacement={({ segmentIndex, openingArea, openingCount }) => {
                      setWindowStatus(
                        `Placed on segment ${segmentIndex + 1} · ${Math.round(openingArea)} SF · ${openingCount} total`,
                      );
                    }}
                  />
                  <DoorToolOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    pdfUrl={pdfUrl}
                    mode={doorToolMode}
                    preset={doorPreset}
                    traceIdFilter={selectedZoneWallRunId}
                    scanMarkers={doorScanMarkers}
                    onCaptureComplete={({
                      sourceText,
                      detectedWidthFt,
                      detectedHeightFt,
                      detectedOpeningType,
                      designationRaw,
                      designationNormalized,
                      dimensionFormat,
                      detectionMethod,
                      confirmed,
                      disposition,
                      markerPoint,
                    }) => {
                      setDoorSourceText(sourceText || null);

                      if (confirmed && detectedWidthFt && detectedHeightFt) {
                        if (markerPoint && selectedZoneWallRunId) {
                          addOpeningScanMarker({
                            openingType: detectedOpeningType,
                            pageIndex: activePageIndex,
                            wallRunId: selectedZoneWallRunId,
                            point: markerPoint,
                          });
                        }
                        setDoorToolMode('capture');
                        setDoorType(detectedOpeningType);
                        setDoorWidthText(formatFeetInches(detectedWidthFt));
                        setDoorHeightText(formatFeetInches(detectedHeightFt));
                        const catalogResult = upsertDoorCatalogItem({
                          type: detectedOpeningType,
                          widthFt: detectedWidthFt,
                          heightFt: detectedHeightFt,
                          label: formatDoorCatalogLabel(
                            detectedOpeningType,
                            detectedWidthFt,
                            detectedHeightFt,
                          ),
                          sourceText,
                          designationRaw,
                          designationNormalized,
                          dimensionFormat,
                          pageIndex: activePageIndex,
                        });
                        setSelectedDoorCatalogId(catalogResult?.id ?? null);
                        const placementResult = canUseOpeningTools
                          ? addOpeningToSelectedWall({
                              type: detectedOpeningType,
                              widthFt: detectedWidthFt,
                              heightFt: detectedHeightFt,
                              label: formatDoorCatalogLabel(
                                detectedOpeningType,
                                detectedWidthFt,
                                detectedHeightFt,
                              ),
                            })
                          : null;
                        setDoorStatus(
                          placementResult && selectedZoneWallLabel
                            ? `Added ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)} to ${selectedZoneWallLabel}`
                            : disposition === 'width_only'
                              ? `${catalogResult?.isNew ? 'Added' : 'Updated'} ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)}`
                              : detectionMethod === 'vision'
                                ? `${catalogResult?.isNew ? 'Added' : 'Updated'} ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)}`
                                : `Detected ${formatDoorCatalogLabel(detectedOpeningType, detectedWidthFt, detectedHeightFt)}`,
                        );
                        return;
                      }

                      setDoorToolMode('capture');
                      setSelectedDoorCatalogId(null);
                      setDoorWidthText('');
                      setDoorHeightText('');

                      if (disposition === 'invalid_target') {
                        setDoorStatus(
                          sourceText
                            ? `"${sourceText}" is not a door note`
                            : 'Not a door note',
                        );
                        return;
                      }

                      setDoorStatus(
                        sourceText
                          ? `${detectionMethod === 'vision' ? 'Vision saw' : 'Captured'} "${sourceText}" but needs review`
                          : 'Door scan needs review',
                      );
                    }}
                    onPlacement={({ segmentIndex, openingArea, openingCount }) => {
                      setDoorStatus(
                        `Placed on segment ${segmentIndex + 1} · ${Math.round(openingArea)} SF · ${openingCount} total`,
                      );
                    }}
                  />
                  <RoofPitchToolOverlay
                    viewerRef={viewerRef}
                    pageWidth={dims.width}
                    pageHeight={dims.height}
                    pdfUrl={pdfUrl}
                    mode={roofPitchToolMode}
                    onCaptureComplete={({ sourceText, detectedRise, detectedRun, confidence, confirmed, disposition, detectionMethod }) => {
                      setRoofPitchToolMode('idle');
                      setRoofPitchSourceText(sourceText || null);
                      setSelectedToolPanel('roof');

                      setRoofPitchRiseText(
                        detectedRise && Number.isFinite(detectedRise)
                          ? String(Math.round(detectedRise))
                          : '',
                      );
                      setRoofPitchRunText(
                        detectedRun && Number.isFinite(detectedRun)
                          ? String(Math.round(detectedRun))
                          : '',
                      );

                      if (confirmed && detectedRise && detectedRun) {
                        handleApplyRoofPitch(
                          'vision',
                          confidence,
                          { rise: detectedRise, run: detectedRun },
                          sourceText || null,
                        );
                        return;
                      }

                      setRoofPitchStatus(
                        disposition === 'invalid_target'
                          ? sourceText
                            ? `"${sourceText}" is not a roof pitch note. Enter the pitch manually.`
                            : 'Roof pitch scan could not find a pitch note. Enter it manually.'
                          : sourceText
                            ? `${detectionMethod === 'vision' ? 'Vision saw' : 'Captured'} "${sourceText}" but needs review`
                            : 'Roof pitch scan needs review',
                      );
                    }}
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

          {manualWindowModalOpen && (
            <CanvasManualWindowModal
              sourceText={windowSourceText}
              widthText={windowWidthText}
              heightText={windowHeightText}
              inputClass={inputClass}
              onWidthChange={setWindowWidthText}
              onHeightChange={setWindowHeightText}
              onCancel={handleCancelManualWindowModal}
              onSubmit={handleSubmitManualWindowModal}
              submitDisabled={!parsedWindowWidthFt || !parsedWindowHeightFt}
            />
          )}

          {selectedPages.length > 1 && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-20">
              {pageTrayOpen && (
                <div className="pointer-events-auto mb-2 w-[244px] overflow-hidden border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_18px_36px_rgba(31,39,33,0.16)]">
                  <div className="border-b border-[var(--takeoff-line)] px-3 py-2">
                    <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">
                      Pages
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-[var(--takeoff-ink)]">
                      Switch sheets
                    </div>
                  </div>
                  <div className="space-y-1.5 p-2">
                    {selectedPages.map((pageIndex) => (
                      <PagePill
                        key={pageIndex}
                        active={pageIndex === activePageIndex}
                        pageLabel={`P${pageIndex + 1}`}
                        title={
                          pageAnalysis.find((page) => page.pageIndex === pageIndex)?.title?.trim() ||
                          `Page ${pageIndex + 1}`
                        }
                        onClick={() => {
                          setActivePage(pageIndex);
                          setPageTrayOpen(false);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setPageTrayOpen((current) => !current)}
                className="pointer-events-auto flex h-11 items-center gap-2 border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] px-3.5 text-[11px] font-medium text-[var(--takeoff-ink)] shadow-[0_12px_24px_rgba(31,39,33,0.12)] transition-colors hover:border-[#9eb29d]"
              >
                <div className="flex min-w-0 flex-col text-left">
                  <span className="takeoff-mono text-[9px] text-[var(--takeoff-text-subtle)]">
                    Pages
                  </span>
                  <span className="truncate text-[11px] font-medium">
                    P{activePageIndex + 1} · {activePageTitle}
                  </span>
                </div>
                <div className="takeoff-mono border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[9px] text-[var(--takeoff-text-subtle)]">
                  {calibratedPages.length}/{selectedPages.length}
                </div>
                {pageTrayOpen ? (
                  <ChevronDown className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
                ) : (
                  <ChevronUp className="h-4 w-4 rotate-180 text-[var(--takeoff-text-subtle)]" />
                )}
              </button>
            </div>
          )}
        </div>

        {!zoneCatalogOpen && (
          <div className="pointer-events-none absolute right-4 top-4 z-20 hidden xl:block">
            <button
              onClick={() => setZoneCatalogOpen(true)}
              className="pointer-events-auto flex h-10 items-center gap-2 border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] px-3 text-[11px] font-medium text-[var(--takeoff-ink)] shadow-[0_12px_24px_rgba(31,39,33,0.12)] transition-colors hover:border-[#9eb29d]"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Area catalog</span>
            </button>
          </div>
        )}

        {SHOW_TAKEOFF_DEBUG_OVERLAYS && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-20 w-[320px] max-w-[calc(100%-2rem)] space-y-3">
            <SnapDebugPanel />

            <div className="pointer-events-auto overflow-hidden border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_14px_28px_rgba(31,39,33,0.14)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--takeoff-line)] px-3 py-2">
                <div>
                  <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Gesture Debug
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--takeoff-text-muted)]">
                    Reproduce the pan-left issue, then copy the log.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      gestureDebugLogRef.current = [];
                      writeStoredGestureDebugLog([]);
                      setGestureDebugLog([]);
                    }}
                    className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-2 py-1 text-[9px] text-[var(--takeoff-text-muted)]"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleCopyGestureDebugLog}
                    disabled={gestureDebugLog.length === 0}
                    className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-2 py-1 text-[9px] text-[var(--takeoff-ink)] disabled:text-[var(--takeoff-text-subtle)]"
                  >
                    {gestureDebugCopyState === 'copied'
                      ? 'Copied'
                      : gestureDebugCopyState === 'error'
                        ? 'Retry'
                        : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="takeoff-hide-scrollbar max-h-[200px] overflow-y-auto px-3 py-2">
                <textarea
                  ref={gestureDebugTextareaRef}
                  readOnly
                  aria-hidden="true"
                  tabIndex={-1}
                  className="pointer-events-none absolute left-[-9999px] top-[-9999px] h-0 w-0 opacity-0"
                />
                {gestureDebugLog.length > 0 ? (
                  <div className="space-y-1.5">
                    {gestureDebugLog.map((entry, index) => (
                      <div
                        key={`${entry.timestamp}-${index}`}
                        className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-2 py-1.5 text-[9px] leading-4 text-[var(--takeoff-ink)]"
                      >
                        {formatGestureDebugEntry(entry)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] leading-5 text-[var(--takeoff-text-muted)]">
                    No gesture events yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <aside
          className={`pointer-events-auto absolute inset-y-0 right-0 z-30 hidden w-[252px] overflow-hidden border-l border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.94)] transition-[transform,opacity] duration-200 ease-out xl:flex ${
            zoneCatalogOpen
              ? 'translate-x-0 opacity-100 shadow-[-18px_0_36px_rgba(31,39,33,0.08)]'
              : 'pointer-events-none translate-x-full opacity-0'
          }`}
        >
          <div className="takeoff-hide-scrollbar flex h-full w-full flex-col overflow-y-auto">
            <div className={sectionClass}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Area Catalog
                  </div>
                  <div className="mt-1 text-[14px] font-medium text-[var(--takeoff-ink)]">
                    All Takeoff Areas
                  </div>
                </div>
                <button
                  onClick={() => setZoneCatalogOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d] hover:text-[var(--takeoff-ink)]"
                  title="Close area catalog"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                Live through takeoff. Incomplete areas stay visible here until their required data is filled in.
              </div>
            </div>

            <div className={sectionClass}>
                  <div className="grid grid-cols-3 gap-2">
                <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2.5">
                  <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Areas</div>
                  <div className="takeoff-mono mt-1 text-[12px]">{allZones.length}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2.5">
                  <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Active</div>
                  <div className="takeoff-mono mt-1 text-[12px]">{zoneTasks.length}</div>
                </div>
                <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2.5">
                  <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Done</div>
                  <div className="takeoff-mono mt-1 text-[12px]">
                    {allZones.filter((zone) => deriveZoneLifecycleState(zone) === 'complete').length}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 px-3 py-3">
              <div className="space-y-2">
                {allZones.length > 0 ? (
                  zonesByType.map((group) => (
                    <div key={`zone-group-${group.zoneType}`} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 px-1">
                        <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                          {ZONE_LABELS[group.zoneType]}
                        </div>
                        <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                          {group.zones.length}
                        </span>
                      </div>
                      {group.zones.map((zone) => {
                        const hiddenIds = hiddenObjectIdsByView.get(zone.viewId);
                        const isZoneHidden = hiddenIds?.has(zone.id) ?? false;
                        const displayZoneType = normalizeZoneType(zone.zoneType, zone.label);
                        return (
                          <ZoneRow
                            key={`catalog-${zone.id}`}
                            zoneType={displayZoneType}
                            label={zone.label}
                            status={zoneLifecycleLabel(zone)}
                            selected={selectedZone?.id === zone.id}
                            hidden={isZoneHidden}
                            metaParts={formatZoneMeta(zone, session?.calibrations?.[zone.pageIndex] ?? null)}
                            wallMetrics={formatZoneWallMetrics(zone, zoneWallMetricsById.get(zone.id))}
                            expanded={expandedZoneCatalogId === zone.id}
                            math={zoneCatalogMathById.get(zone.id) ?? null}
                            onSelect={() => handleSelectZoneFromCatalog(zone.id)}
                            onToggleHidden={() => toggleObjectHiddenInView(zone.viewId, zone.id)}
                          />
                        );
                      })}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                    No takeoff areas yet. Finish the areas step first, then they will stay live here throughout takeoff.
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
