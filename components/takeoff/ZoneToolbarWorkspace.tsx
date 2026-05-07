'use client';

import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  MousePointer2,
  Pentagon,
  Ruler,
  Trash2,
} from 'lucide-react';
import { BlueprintViewer, type BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import { CalibrationOverlay } from '@/components/takeoff/CalibrationOverlay';
import { WallTraceOverlay } from '@/components/takeoff/WallTraceOverlay';
import { useBlueprintPageHotkeys } from '@/components/takeoff/useBlueprintPageHotkeys';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { buildAnticipatedZonesFromPageAnalysis } from '@/lib/takeoff/workspace-v2';
import type { AnticipatedZoneSignal } from '@/lib/takeoff/workspace-v2';
import { buildRoofPitchColorMap, resolveAreaZoneColor, type AreaColor } from '@/lib/takeoff/area-colors';
import { computeSlopedAreaSf, formatRoofPitch, parseRoofPitchText } from '@/lib/takeoff/roof-pitch';
import {
  traceAreaSf,
  deriveZoneLifecycleState,
  ZONE_COLORS,
  ZONE_LABELS,
  formatFeetInches,
  parseDimensionToFeet,
  type Calibration,
  type ZoneCeilingType,
  type Trace,
  type ZoneType,
} from '@/lib/types/takeoff';
import type { PageAnalysis, Zone as TakeoffZone } from '@/lib/types/takeoff-v2';

interface ZoneToolbarWorkspaceProps {
  pdfUrl: string;
}

type ZoneToolPanel = 'select' | 'scale' | 'zone';
type AnticipatedZoneKey = 'exterior' | 'interior' | 'crawlspace' | 'attic';

interface ZoneCreationSeed {
  label: string;
  zoneType: ZoneType;
  ceilingType: ZoneCeilingType;
  defaultCeilingHeightFt: number | null;
  insulationType: string | null;
  rValue: string | null;
}

interface RoofPitchCandidate {
  key: string;
  rise: number;
  run: number;
  label: string;
  sourceText: string;
  pageIndex: number;
}

const ZONE_TYPE_OPTIONS: ZoneType[] = [
  'conditioned',
  'unconditioned_garage',
  'unconditioned_attic',
  'unconditioned_crawl',
  'unconditioned_storage',
];
const DEFAULT_ZONE_TYPE: ZoneType = 'conditioned';

const ANTICIPATED_ZONE_PRESETS: Partial<Record<'exterior' | 'interior' | 'attic' | 'crawlspace', ZoneType>> =
  {
    exterior: 'conditioned',
    interior: 'conditioned',
    attic: 'unconditioned_attic',
    crawlspace: 'unconditioned_crawl',
  };

const ZONE_MODAL_LABELS: Record<ZoneCeilingType, string> = {
  flat: 'Flat',
  vaulted: 'Vaulted',
};

const AREA_GROUP_LABELS: Record<ZoneType, string> = {
  conditioned: 'Living / Heated Area',
  unconditioned_garage: 'Garage / Shared Wall',
  unconditioned_storage: 'Storage / Manual Review',
  unconditioned_crawl: 'Crawlspace / Floor Insulation',
  unconditioned_attic: 'Attic / Ceiling Insulation',
  outside: 'Outside',
};

const SCALE_PRESETS = [
  { label: `1/16" = 1'-0"`, pdfPointsPerFoot: 4.5 },
  { label: `1/8" = 1'-0"`, pdfPointsPerFoot: 9 },
  { label: `3/16" = 1'-0"`, pdfPointsPerFoot: 13.5 },
  { label: `1/4" = 1'-0"`, pdfPointsPerFoot: 18 },
  { label: `3/8" = 1'-0"`, pdfPointsPerFoot: 27 },
  { label: `1/2" = 1'-0"`, pdfPointsPerFoot: 36 },
  { label: `3/4" = 1'-0"`, pdfPointsPerFoot: 54 },
  { label: `1" = 1'-0"`, pdfPointsPerFoot: 72 },
] as const;

function zoneNeedsHeight(zoneType: ZoneType) {
  return zoneType === 'conditioned' || zoneType === 'unconditioned_garage' || zoneType === 'unconditioned_storage';
}

function zoneNeedsCeilingType(zoneType: ZoneType) {
  return zoneType === 'unconditioned_attic';
}

function zoneNeedsRoofPitch(zone: Pick<TakeoffZone, 'zoneType' | 'ceilingType'>) {
  return zone.zoneType === 'unconditioned_attic' && zone.ceilingType === 'vaulted';
}

function zoneHasRoofPitch(zone: Pick<TakeoffZone, 'roofPitchRise' | 'roofPitchRun'>) {
  return (
    typeof zone.roofPitchRise === 'number' &&
    Number.isFinite(zone.roofPitchRise) &&
    zone.roofPitchRise > 0 &&
    typeof zone.roofPitchRun === 'number' &&
    Number.isFinite(zone.roofPitchRun) &&
    zone.roofPitchRun > 0
  );
}

function zoneShowsFloorLabel(zoneType: ZoneType) {
  return zoneType === 'conditioned' || zoneType === 'unconditioned_garage' || zoneType === 'unconditioned_storage';
}

function zoneInsulationHelperText(zoneType: ZoneType, hasManualValue: boolean) {
  if (hasManualValue) {
    return 'This manual insulation value will carry forward with this area.';
  }

  if (zoneType === 'unconditioned_crawl' || zoneType === 'unconditioned_attic') {
    return 'No recommendation is set yet. Add the insulation type or R-value to carry into the estimate.';
  }

  return 'No recommendation detected. Add one manually if this area needs insulation tracked.';
}

function pageCapabilityScore(page: PageAnalysis, capability: string) {
  return page.capabilities.find((item) => item.capability === capability)?.score ?? 0;
}

function isPageAbout(page: PageAnalysis, pattern: RegExp) {
  return pattern.test(`${page.title} ${page.pageType ?? ''}`.toLowerCase());
}

function getBestPageIndexForSuggestedArea(
  suggestion: AnticipatedZoneSignal,
  pageAnalysis: PageAnalysis[],
  selectedPages: number[],
  activePageIndex: number,
) {
  const selectedPageSet = new Set(selectedPages);
  const candidateIndexes = new Set([
    ...suggestion.scanBackedPageIndexes,
    ...suggestion.inferredPageIndexes,
    ...suggestion.pageIndexes,
  ]);
  const candidatePages = pageAnalysis.filter(
    (page) =>
      candidateIndexes.has(page.pageIndex) &&
      (selectedPageSet.size === 0 || selectedPageSet.has(page.pageIndex)),
  );
  const fallbackPages = pageAnalysis.filter((page) => candidateIndexes.has(page.pageIndex));
  const pages = candidatePages.length > 0 ? candidatePages : fallbackPages;
  if (pages.length === 0) return activePageIndex;

  const scored = pages.map((page) => {
    let score = page.confidence * 12;

    if (suggestion.scanBackedPageIndexes.includes(page.pageIndex)) score += 100;
    if (suggestion.inferredPageIndexes.includes(page.pageIndex)) score += 28;
    if (selectedPageSet.has(page.pageIndex)) score += 8;
    if (page.roles.includes('measurement')) score += 14;
    if (page.selectedByAi) score += 6;

    if (suggestion.key === 'exterior' || suggestion.key === 'interior') {
      score += pageCapabilityScore(page, 'wall_measurement') * 36;
      score += pageCapabilityScore(page, 'zoning') * 26;
      score += pageCapabilityScore(page, 'wall_type') * 10;
      if (isPageAbout(page, /floor|framing|plan|main|first|second/)) score += 10;
    } else if (suggestion.key === 'attic') {
      score += pageCapabilityScore(page, 'attic_scope') * 40;
      score += pageCapabilityScore(page, 'roof_pitch') * 22;
      score += pageCapabilityScore(page, 'zoning') * 10;
      if (page.scanFlags?.roof_ceiling_details) score += 14;
      if (page.scanExtracts?.roof_pitches?.length) score += 10;
      if (isPageAbout(page, /roof|attic|ceiling|framing|truss/)) score += 14;
    } else if (suggestion.key === 'crawlspace') {
      score += pageCapabilityScore(page, 'crawlspace_scope') * 40;
      score += pageCapabilityScore(page, 'wall_measurement') * 12;
      if (page.scanFlags?.floor_foundation_details) score += 18;
      if (isPageAbout(page, /crawl|foundation|floor|framing|plan/)) score += 14;
    }

    return { page, score };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.page.pageIndex - right.page.pageIndex;
  });

  return scored[0]?.page.pageIndex ?? activePageIndex;
}

function formatBestPageLabel(pageIndex: number, pageAnalysis: PageAnalysis[]) {
  const title = pageAnalysis.find((page) => page.pageIndex === pageIndex)?.title?.trim();
  return title ? `P${pageIndex + 1} · ${title}` : `P${pageIndex + 1}`;
}

function buildRoofPitchCandidates(
  pageAnalysis: PageAnalysis[],
  activePageIndex: number,
): RoofPitchCandidate[] {
  const candidates: RoofPitchCandidate[] = [];
  const seen = new Set<string>();
  const sortedPages = [...pageAnalysis].sort((left, right) => {
    if (left.pageIndex === activePageIndex) return -1;
    if (right.pageIndex === activePageIndex) return 1;
    return left.pageIndex - right.pageIndex;
  });

  for (const page of sortedPages) {
    const scanExtracts = page.scanExtracts;
    const rawValues = [
      ...(scanExtracts?.roof_pitches ?? []),
      ...(scanExtracts?.zone_hints?.attic?.roof_pitches ?? []),
    ];

    for (const rawValue of rawValues) {
      const sourceText = rawValue.trim();
      if (!sourceText) continue;

      const parsed = parseRoofPitchText(sourceText);
      if (!parsed) continue;

      const key = `${parsed.rise}/${parsed.run}`;
      if (seen.has(key)) continue;

      seen.add(key);
      candidates.push({
        key,
        rise: parsed.rise,
        run: parsed.run,
        label: formatRoofPitch(parsed.rise, parsed.run),
        sourceText,
        pageIndex: page.pageIndex,
      });
    }
  }

  return candidates;
}

function zoneLifecycleLabel(zone: {
  zoneType: ZoneType;
  defaultCeilingHeightFt?: number | null;
  ceilingType?: ZoneCeilingType | null;
  insulationType?: string | null;
  rValue?: string | null;
  takeoffStatus?: 'pending' | 'complete' | null;
  roofPitchRise?: number | null;
  roofPitchRun?: number | null;
}) {
  const lifecycle = deriveZoneLifecycleState(zone);
  if (lifecycle === 'incomplete') return 'incomplete';
  if (lifecycle === 'needs_takeoff') return 'needs takeoff';
  return 'complete';
}

function formatZoneMeta(zone: {
  pageIndex: number;
  label?: string;
  floorLabel?: string | null;
  defaultCeilingHeightFt?: number | null;
  ceilingType?: ZoneCeilingType | null;
  insulationType?: string | null;
  rValue?: string | null;
  roofPitchRise?: number | null;
  roofPitchRun?: number | null;
  roofPitchSource?: 'manual' | 'vision' | null;
  polygon: Trace['points'];
  zoneType: ZoneType;
	}, calibration?: Calibration | null) {
	  const parts: string[] = [];

  if (zoneShowsFloorLabel(zone.zoneType) && zone.floorLabel) {
    parts.push(`Level ${zone.floorLabel}`);
  }

  if (zoneNeedsHeight(zone.zoneType) && zone.defaultCeilingHeightFt) {
    parts.push(`${zone.defaultCeilingHeightFt.toFixed(2).replace(/\.00$/, '')} ft ceiling`);
  }

  if (zoneNeedsCeilingType(zone.zoneType) && zone.ceilingType) {
    parts.push(ZONE_MODAL_LABELS[zone.ceilingType]);
  }

  if (zoneNeedsRoofPitch(zone) && zoneHasRoofPitch(zone)) {
    parts.push(`${formatRoofPitch(zone.roofPitchRise ?? 0, zone.roofPitchRun ?? 0)} pitch`);
  }

	  const normalizedInsulationType = zone.insulationType?.trim();
	  if (normalizedInsulationType) {
	    parts.push(normalizedInsulationType);
	  }

	  const normalizedRValue = zone.rValue?.trim();
	  if (
	    normalizedRValue &&
	    normalizedRValue !== normalizedInsulationType &&
	    !normalizedInsulationType?.toLowerCase().includes(normalizedRValue.toLowerCase())
	  ) {
	    parts.push(normalizedRValue);
	  }

  if (calibration && zone.polygon.length >= 3) {
    const areaSf = getZoneAreaSf(
      {
        id: `meta-${zone.pageIndex}`,
        pageIndex: zone.pageIndex,
        label: zone.label ?? 'Area',
        polygon: zone.polygon,
        zoneType: zone.zoneType,
        ceilingType: zone.ceilingType,
        roofPitchRise: zone.roofPitchRise,
        roofPitchRun: zone.roofPitchRun,
      },
      calibration,
    );
    if (areaSf === null) {
      parts.push('Needs roof pitch');
      return parts.join(' · ');
    }
    parts.push(`${Math.round(areaSf).toLocaleString('en-US')} SF`);
  }

  return parts.join(' · ');
}

function normalizedGroupToken(value?: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function areaGroupKey(zone: Pick<TakeoffZone, 'zoneType' | 'floorLabel' | 'ceilingType' | 'insulationType' | 'rValue'>) {
  return [
    zone.zoneType,
    normalizedGroupToken(zone.floorLabel),
    zoneNeedsCeilingType(zone.zoneType) ? normalizedGroupToken(zone.ceilingType) : '',
    normalizedGroupToken(zone.insulationType),
    normalizedGroupToken(zone.rValue),
  ].join('|');
}

function getZoneAreaSf(
  zone: Pick<
    TakeoffZone,
    'id' | 'pageIndex' | 'label' | 'polygon' | 'zoneType' | 'ceilingType' | 'roofPitchRise' | 'roofPitchRun'
  >,
  calibration?: Calibration | null,
) {
  if (!calibration || zone.polygon.length < 3) return 0;
  const planAreaSf = traceAreaSf(
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
  );

  if (!(planAreaSf > 0)) return 0;
  if (!zoneNeedsRoofPitch(zone)) return planAreaSf;
  if (!zoneHasRoofPitch(zone)) return null;
  return computeSlopedAreaSf(planAreaSf, zone.roofPitchRise, zone.roofPitchRun);
}

function formatAreaGroupMeta(zones: TakeoffZone[], calibrations?: Record<number, Calibration> | null) {
  const firstZone = zones[0];
  if (!firstZone) return '';

  const areaValues = zones.map((zone) =>
    getZoneAreaSf(zone, calibrations?.[zone.pageIndex] ?? null),
  );
  if (areaValues.some((areaSf) => areaSf === null)) {
    return 'Needs roof pitch';
  }

  const totalAreaSf = areaValues
    .filter((areaSf): areaSf is number => typeof areaSf === 'number')
    .reduce((sum, areaSf) => sum + areaSf, 0);
  return totalAreaSf > 0 ? `${Math.round(totalAreaSf).toLocaleString('en-US')} SF total` : '';
}

function buildAreaCatalogGroups(zones: TakeoffZone[]) {
  const groups = new Map<string, { key: string; zoneType: ZoneType; label: string; zones: TakeoffZone[] }>();

  for (const zone of zones) {
    const key = areaGroupKey(zone);
    const existing = groups.get(key);
    if (existing) {
      existing.zones.push(zone);
      continue;
    }

    groups.set(key, {
      key,
      zoneType: zone.zoneType,
      label: AREA_GROUP_LABELS[zone.zoneType] ?? ZONE_LABELS[zone.zoneType],
      zones: [zone],
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftTypeOrder = ZONE_TYPE_OPTIONS.indexOf(left.zoneType);
    const rightTypeOrder = ZONE_TYPE_OPTIONS.indexOf(right.zoneType);
    if (leftTypeOrder !== rightTypeOrder) return leftTypeOrder - rightTypeOrder;
    return left.label.localeCompare(right.label);
  });
}

function getZoneLabelBase(zoneType: ZoneType, suggestionLabel?: string | null) {
  const normalizedSuggestion = suggestionLabel?.trim().toLowerCase() ?? '';

  if (normalizedSuggestion.includes('exterior')) return 'Living Area';
  if (normalizedSuggestion.includes('interior')) return 'Living Area';
  if (normalizedSuggestion.includes('crawl')) return 'Crawlspace Floor';
  if (normalizedSuggestion.includes('attic')) return 'Attic Ceiling';
  if (normalizedSuggestion.includes('garage')) return 'Garage Shared Wall';
  if (normalizedSuggestion.includes('storage')) return 'Storage Review';

  switch (zoneType) {
    case 'conditioned':
      return 'Living Area';
    case 'unconditioned_garage':
      return 'Garage Shared Wall';
    case 'unconditioned_storage':
      return 'Storage Review';
    case 'unconditioned_crawl':
      return 'Crawlspace Floor';
    case 'unconditioned_attic':
      return 'Attic Ceiling';
    default:
      return 'Takeoff Area';
  }
}

function inferAnticipatedZoneKey(
  label?: string | null,
  zoneType?: ZoneType | null,
): AnticipatedZoneKey | null {
  const normalizedLabel = label?.trim().toLowerCase() ?? '';

  if (normalizedLabel.includes('exterior')) return 'exterior';
  if (normalizedLabel.includes('interior')) return 'interior';
  if (normalizedLabel.includes('crawl')) return 'crawlspace';
  if (normalizedLabel.includes('attic')) return 'attic';

  if (zoneType === 'unconditioned_crawl') return 'crawlspace';
  if (zoneType === 'unconditioned_attic') return 'attic';

  return null;
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

function PrimaryToolButton({
  label,
  active,
  color,
  icon: Icon,
  onClick,
}: {
  label: string;
  active: boolean;
  color: { stroke: string };
  icon: typeof MousePointer2;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="border px-2 py-1.5 text-left transition-colors"
      style={{
        borderColor: active ? color.stroke : 'var(--takeoff-line)',
        backgroundColor: active ? color.stroke : '#ffffff',
        color: active ? '#ffffff' : color.stroke,
      }}
    >
      <div className="flex min-h-[54px] flex-col items-center justify-center gap-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="takeoff-mono text-center text-[8px] font-semibold leading-3.5">{label}</span>
      </div>
    </button>
  );
}

function UtilityActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[9px] font-medium text-[var(--takeoff-ink)] transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
    >
      {label}
    </button>
  );
}

function ZoneRow({
  zoneType,
  label,
  status,
  selected,
  hidden,
  meta,
  onSelect,
  onToggleHidden,
  onDelete,
  color,
}: {
  zoneType: ZoneType;
  label: string;
  status: string;
  selected: boolean;
  hidden: boolean;
  meta?: string | null;
  onSelect: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  color?: AreaColor;
}) {
  const zoneColor = color ?? ZONE_COLORS[zoneType];

  return (
    <div
      className={`border px-3 py-2 transition-colors ${
        selected
          ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)]'
          : 'border-[var(--takeoff-line)] bg-white'
      }`}
    >
      <div className="flex items-start gap-2">
        <button onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: zoneColor.stroke }}
            />
            <span className="truncate text-[11px] font-medium text-[var(--takeoff-ink)]">
              {label}
            </span>
          </div>
	          {hidden && (
	            <div className="mt-1 flex flex-wrap items-center gap-1.5">
	              <span className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-1.5 py-0.5 text-[8px] text-[var(--takeoff-text-subtle)]">
	                hidden
	              </span>
	            </div>
	          )}
	          {meta && (
	            <div className="mt-1 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
	              {meta}
	            </div>
	          )}
        </button>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            onClick={onToggleHidden}
	            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d] hover:text-[var(--takeoff-ink)]"
	            title={hidden ? 'Show area' : 'Hide area'}
	          >
	            {hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
	          </button>
	          <button
	            onClick={onDelete}
	            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] transition-colors hover:border-[#d7a8a8] hover:text-[#b42318]"
	            title="Delete area"
	          >
	            <Trash2 className="h-3 w-3" />
	          </button>
        </div>
      </div>
    </div>
  );
}

export function ZoneToolbarWorkspace({ pdfUrl }: ZoneToolbarWorkspaceProps) {
  const viewerRef = useRef<BlueprintViewerHandle>(null);
  const areaCatalogScrollRef = useRef<HTMLDivElement>(null);
  const knownZoneIdsRef = useRef<Set<string> | null>(null);
  const zoneSnapshotKeyRef = useRef<string>('');
  const calibrationSuccessTimerRef = useRef<number | null>(null);

  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const activeViewId = useTakeoffStore((state) => state.activeViewId);
  const activeTracePoints = useTakeoffStore((state) => state.activeTracePoints);
  const drawingPreset = useTakeoffStore((state) => state.drawingPreset);
  const calibrationStep = useTakeoffStore((state) => state.calibrationStep);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const tool = useTakeoffStore((state) => state.tool);
  const zonePreset = useTakeoffStore((state) => state.zonePreset);
  const setActivePage = useTakeoffStore((state) => state.setActivePage);
  const setActiveView = useTakeoffStore((state) => state.setActiveView);
  const setTool = useTakeoffStore((state) => state.setTool);
  const setZonePreset = useTakeoffStore((state) => state.setZonePreset);
  const startCalibration = useTakeoffStore((state) => state.startCalibration);
  const startTrace = useTakeoffStore((state) => state.startTrace);
  const removeLastTracePoint = useTakeoffStore((state) => state.removeLastTracePoint);
  const deleteTrace = useTakeoffStore((state) => state.deleteTrace);
  const selectTrace = useTakeoffStore((state) => state.selectTrace);
  const clearSelection = useTakeoffStore((state) => state.clearSelection);
  const toggleObjectHiddenInView = useTakeoffStore((state) => state.toggleObjectHiddenInView);
  const updateZoneObject = useTakeoffStore((state) => state.updateZoneObject);
  const getCalibration = useTakeoffStore((state) => state.getCalibration);
  const applyScalePresetCalibration = useTakeoffStore((state) => state.applyScalePresetCalibration);

  const [pageTrayOpen, setPageTrayOpen] = useState(false);
  const [selectedToolPanel, setSelectedToolPanel] = useState<ZoneToolPanel>('select');
  const [zoneCatalogOpen, setZoneCatalogOpen] = useState(false);
  const [showScalePresetMenu, setShowScalePresetMenu] = useState(false);
  const [zoneConfigTraceId, setZoneConfigTraceId] = useState<string | null>(null);
  const [pendingZoneSeed, setPendingZoneSeed] = useState<ZoneCreationSeed | null>(null);
  const [showCalibrationSuccess, setShowCalibrationSuccess] = useState(false);
  const [calibrationSuccessFading, setCalibrationSuccessFading] = useState(false);
  const [selectedZoneHeightText, setSelectedZoneHeightText] = useState('');
  const [configZoneHeightText, setConfigZoneHeightText] = useState('');
  const [selectedZoneInsulationText, setSelectedZoneInsulationText] = useState('');
  const [configZoneInsulationText, setConfigZoneInsulationText] = useState('');
  const [selectedZoneRValueText, setSelectedZoneRValueText] = useState('');
  const [configZoneRValueText, setConfigZoneRValueText] = useState('');
  const [selectedZoneRoofPitchText, setSelectedZoneRoofPitchText] = useState('');
  const [configZoneRoofPitchText, setConfigZoneRoofPitchText] = useState('');
  const previousHasCalibrationRef = useRef(false);

  const calibration = getCalibration();
  const hasCalibration = Boolean(calibration);
  const isScaleVerified = hasCalibration;
  const showCalibrationOverlay = calibrationStep !== 'idle' && calibrationStep !== 'done';
  const isPointerMode = tool === 'pointer';
  const isTraceMode = tool === 'trace' && drawingPreset === 'zone';
  const isScaleMode = showCalibrationOverlay || tool === 'calibrate';
  const cursorMode = isScaleMode ? 'none' : isTraceMode ? 'crosshair' : 'default';

  const selectedPages = useMemo(() => session?.selectedPages ?? [], [session?.selectedPages]);
  const pageAnalysis = useMemo(() => session?.pageAnalysis ?? [], [session?.pageAnalysis]);
  const roofPitchCandidates = useMemo(
    () => buildRoofPitchCandidates(pageAnalysis, activePageIndex),
    [activePageIndex, pageAnalysis],
  );
  const activePageTitle =
    pageAnalysis.find((page) => page.pageIndex === activePageIndex)?.title?.trim() ||
    `Page ${activePageIndex + 1}`;
  const calibratedPages = selectedPages.filter((pageIndex) =>
    Boolean(session?.calibrations[pageIndex]),
  );
  const activePageViews = useMemo(
    () => (session?.views ?? []).filter((view) => view.pageIndex === activePageIndex),
    [activePageIndex, session?.views],
  );
  const currentView = activePageViews.find((view) => view.id === activeViewId) ?? activePageViews[0] ?? null;
  const hiddenObjectIds = new Set(currentView?.hiddenObjectIds ?? []);
  const activeZones = useMemo(
    () =>
      (session?.zones ?? []).filter(
        (zone) =>
          zone.pageIndex === activePageIndex &&
          (!currentView || zone.viewId === currentView.id),
      ),
    [activePageIndex, currentView, session?.zones],
  );
  const allZones = useMemo(() => session?.zones ?? [], [session?.zones]);
  const roofPitchColorByKey = useMemo(
    () => buildRoofPitchColorMap(allZones),
    [allZones],
  );
  const hiddenObjectIdsByView = useMemo(
    () =>
      new Map((session?.views ?? []).map((view) => [view.id, new Set(view.hiddenObjectIds)])),
    [session?.views],
  );
  const areaCatalogGroups = useMemo(() => buildAreaCatalogGroups(allZones), [allZones]);
  const selectedZone = useMemo(
    () => activeZones.find((zone) => zone.id === selectedTraceId) ?? null,
    [activeZones, selectedTraceId],
  );
  const configZone = useMemo(
    () => activeZones.find((zone) => zone.id === zoneConfigTraceId) ?? null,
    [activeZones, zoneConfigTraceId],
  );
  const anticipatedZones = useMemo(
    () =>
      buildAnticipatedZonesFromPageAnalysis(pageAnalysis).sort((a, b) => {
        const order = ['exterior', 'interior', 'crawlspace', 'attic'];
        return order.indexOf(a.key) - order.indexOf(b.key);
      }),
    [pageAnalysis],
  );
  const activeSuggestedZoneKey = useMemo(
    () =>
      inferAnticipatedZoneKey(
        pendingZoneSeed?.label ?? configZone?.label ?? selectedZone?.label,
        pendingZoneSeed?.zoneType ?? configZone?.zoneType ?? selectedZone?.zoneType ?? null,
      ),
    [
      configZone?.label,
      configZone?.zoneType,
      pendingZoneSeed?.label,
      pendingZoneSeed?.zoneType,
      selectedZone?.label,
      selectedZone?.zoneType,
    ],
  );
  const getAnticipatedZoneForSeed = (zoneType: ZoneType, suggestionLabel?: string | null) => {
    const normalizedLabel = suggestionLabel?.trim().toLowerCase();
    if (normalizedLabel) {
      const directMatch = anticipatedZones.find(
        (zone) => zone.label.trim().toLowerCase() === normalizedLabel,
      );
      if (directMatch) return directMatch;
    }

    return anticipatedZones.find(
      (zone) => (ANTICIPATED_ZONE_PRESETS[zone.key] ?? DEFAULT_ZONE_TYPE) === zoneType,
    );
  };

  useEffect(() => {
    if (!selectedZone) {
      setSelectedZoneHeightText('');
      setSelectedZoneInsulationText('');
      setSelectedZoneRValueText('');
      setSelectedZoneRoofPitchText('');
      return;
    }

    setSelectedZoneHeightText(
      typeof selectedZone.defaultCeilingHeightFt === 'number'
        ? formatFeetInches(selectedZone.defaultCeilingHeightFt)
        : '',
    );
    setSelectedZoneInsulationText(selectedZone.insulationType ?? '');
    setSelectedZoneRValueText(selectedZone.rValue ?? '');
    setSelectedZoneRoofPitchText(
      zoneHasRoofPitch(selectedZone)
        ? formatRoofPitch(selectedZone.roofPitchRise ?? 0, selectedZone.roofPitchRun ?? 0)
        : '',
    );
  }, [
    selectedZone,
    selectedZone?.defaultCeilingHeightFt,
    selectedZone?.id,
    selectedZone?.roofPitchRise,
    selectedZone?.roofPitchRun,
  ]);

  useEffect(() => {
    if (!configZone) {
      setConfigZoneHeightText('');
      setConfigZoneInsulationText('');
      setConfigZoneRValueText('');
      setConfigZoneRoofPitchText('');
      return;
    }

    setConfigZoneHeightText(
      typeof configZone.defaultCeilingHeightFt === 'number'
        ? formatFeetInches(configZone.defaultCeilingHeightFt)
        : '',
    );
    setConfigZoneInsulationText(configZone.insulationType ?? '');
    setConfigZoneRValueText(configZone.rValue ?? '');
    setConfigZoneRoofPitchText(
      zoneHasRoofPitch(configZone)
        ? formatRoofPitch(configZone.roofPitchRise ?? 0, configZone.roofPitchRun ?? 0)
        : '',
    );
  }, [
    configZone,
    configZone?.defaultCeilingHeightFt,
    configZone?.id,
    configZone?.roofPitchRise,
    configZone?.roofPitchRun,
  ]);

  useEffect(() => {
    if (isScaleMode) {
      setSelectedToolPanel('scale');
      return;
    }

    if (isTraceMode) {
      setSelectedToolPanel('zone');
      return;
    }

    if (isPointerMode) {
      setSelectedToolPanel('select');
    }
  }, [isPointerMode, isScaleMode, isTraceMode, zonePreset]);

  useEffect(() => {
    const snapshotKey = `${activePageIndex}:${currentView?.id ?? 'none'}`;
    const currentZoneIds = new Set(activeZones.map((zone) => zone.id));

    if (zoneSnapshotKeyRef.current !== snapshotKey || knownZoneIdsRef.current === null) {
      zoneSnapshotKeyRef.current = snapshotKey;
      knownZoneIdsRef.current = currentZoneIds;
      return;
    }

    const newZone = activeZones.find((zone) => !knownZoneIdsRef.current?.has(zone.id));
    knownZoneIdsRef.current = currentZoneIds;

    if (!newZone) return;

    const nextSeed = pendingZoneSeed ?? {
      label: `${getZoneLabelBase(newZone.zoneType)} ${activeZones.filter((zone) => zone.zoneType === newZone.zoneType).length}`,
      zoneType: newZone.zoneType,
      ceilingType: 'flat' as const,
      defaultCeilingHeightFt: null,
      insulationType: null,
      rValue: null,
    };

    updateZoneObject(newZone.id, {
      label: nextSeed.label,
      zoneType: nextSeed.zoneType,
      ceilingType: nextSeed.ceilingType,
      defaultCeilingHeightFt: nextSeed.defaultCeilingHeightFt,
      insulationType: nextSeed.insulationType,
      rValue: nextSeed.rValue,
    });

    setZoneConfigTraceId(newZone.id);
    setZoneCatalogOpen(true);
    setSelectedToolPanel('select');
    selectTrace(newZone.id);
    setTool('pointer');
    setPendingZoneSeed(null);
  }, [activePageIndex, activeZones, currentView?.id, pendingZoneSeed, selectTrace, setTool, updateZoneObject]);

  useEffect(() => {
    if (zoneConfigTraceId && !configZone) {
      setZoneConfigTraceId(null);
    }
  }, [configZone, zoneConfigTraceId]);

  useEffect(() => {
    const justCalibrated = !previousHasCalibrationRef.current && hasCalibration;
    previousHasCalibrationRef.current = hasCalibration;

    if (!justCalibrated) {
      return;
    }

    setShowCalibrationSuccess(true);

    if (pendingZoneSeed && !isTraceMode) {
      setSelectedToolPanel('zone');
      setZonePreset(pendingZoneSeed.zoneType);
      startTrace('area');
    }
  }, [hasCalibration, isTraceMode, pendingZoneSeed, setZonePreset, startTrace]);

  useEffect(() => {
    if (!showCalibrationSuccess) return;

    if (calibrationSuccessTimerRef.current) {
      window.clearTimeout(calibrationSuccessTimerRef.current);
    }

    calibrationSuccessTimerRef.current = window.setTimeout(() => {
      setCalibrationSuccessFading(true);
    }, 1050);

    const hideTimer = window.setTimeout(() => {
      calibrationSuccessTimerRef.current = null;
      setShowCalibrationSuccess(false);
      setCalibrationSuccessFading(false);
    }, 1680);

    return () => {
      if (calibrationSuccessTimerRef.current) {
        window.clearTimeout(calibrationSuccessTimerRef.current);
        calibrationSuccessTimerRef.current = null;
      }
      window.clearTimeout(hideTimer);
    };
  }, [showCalibrationSuccess]);

  useBlueprintPageHotkeys({
    activePageIndex,
    selectedPages,
    setActivePage,
    disabled: tool === 'trace' || showCalibrationOverlay,
    onBeforeNavigate: () => setPageTrayOpen(false),
  });

  const handleTraceZone = (
    nextZonePreset: ZoneType = DEFAULT_ZONE_TYPE,
    options?: { suggestionLabel?: string | null; targetPageIndex?: number | null },
  ) => {
    const targetPageIndex = options?.targetPageIndex ?? activePageIndex;
    const labelBase = getZoneLabelBase(nextZonePreset, options?.suggestionLabel);
    const targetZones =
      targetPageIndex === activePageIndex
        ? activeZones
        : allZones.filter((zone) => zone.pageIndex === targetPageIndex);
    const nextIndex =
      targetZones.filter((zone) => zone.label.toLowerCase().startsWith(labelBase.toLowerCase())).length + 1;
    const anticipatedZone = getAnticipatedZoneForSeed(nextZonePreset, options?.suggestionLabel);
    const suggestedInsulationType =
      anticipatedZone?.insulationTypes[0] ??
      anticipatedZone?.rValueDetails[0] ??
      anticipatedZone?.rValues[0] ??
      null;
    const suggestedRValue = anticipatedZone?.rValues[0] ?? null;

    setPendingZoneSeed({
      label: `${labelBase} ${nextIndex}`,
      zoneType: nextZonePreset,
      ceilingType: 'flat',
      defaultCeilingHeightFt: null,
      insulationType: suggestedInsulationType,
      rValue: suggestedRValue,
    });

    if (targetPageIndex !== activePageIndex) {
      setActivePage(targetPageIndex);
      setPageTrayOpen(false);
    }

    const targetHasCalibration = Boolean(session?.calibrations?.[targetPageIndex]);
    if (!targetHasCalibration) {
      setSelectedToolPanel('scale');
      startCalibration();
      return;
    }

    setSelectedToolPanel('zone');
    setZonePreset(nextZonePreset);
    startTrace('area');
  };

  const commitZoneHeight = (
    zoneId: string,
    rawValue: string,
    setText: (value: string) => void,
  ) => {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      updateZoneObject(zoneId, { defaultCeilingHeightFt: null });
      setText('');
      return;
    }

    const parsed = parseDimensionToFeet(trimmed);
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    updateZoneObject(zoneId, { defaultCeilingHeightFt: parsed });
    setText(formatFeetInches(parsed));
  };

  const applyZoneRoofPitch = (
    zoneId: string,
    pitch: { rise: number; run: number },
    source: 'manual' | 'vision',
    sourceText: string,
  ) => {
    updateZoneObject(zoneId, {
      roofPitchRise: pitch.rise,
      roofPitchRun: pitch.run,
      roofPitchSource: source,
      roofPitchSourceText: sourceText.trim() || formatRoofPitch(pitch.rise, pitch.run),
      roofPitchConfidence: source === 'vision' ? 0.82 : null,
    });
  };

  const commitZoneRoofPitch = (
    zoneId: string,
    rawValue: string,
    setText: (value: string) => void,
  ) => {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      updateZoneObject(zoneId, {
        roofPitchRise: null,
        roofPitchRun: null,
        roofPitchSourceText: null,
        roofPitchConfidence: null,
        roofPitchSource: null,
      });
      setText('');
      return;
    }

    const parsed = parseRoofPitchText(trimmed);
    if (!parsed) return;

    applyZoneRoofPitch(zoneId, parsed, 'manual', trimmed);
    setText(formatRoofPitch(parsed.rise, parsed.run));
  };

  const clearZoneRoofPitch = (zoneId: string, setText: (value: string) => void) => {
    updateZoneObject(zoneId, {
      roofPitchRise: null,
      roofPitchRun: null,
      roofPitchSourceText: null,
      roofPitchConfidence: null,
      roofPitchSource: null,
    });
    setText('');
  };

  const activeModeLabel = (() => {
    if (isScaleMode) return 'Calibrate';
    if (isTraceMode) return pendingZoneSeed?.label ?? 'Area';
    if (selectedZone) return selectedZone.label;
    return 'Select';
  })();

  const instructionText = (() => {
    switch (calibrationStep) {
      case 'primary_a':
        return 'Pick first scale point';
      case 'primary_b':
        return 'Pick second scale point';
      case 'primary_input':
        return 'Enter first dimension';
      case 'verify_a':
        return 'Pick verify point';
      case 'verify_b':
        return 'Pick second verify point';
      case 'verify_input':
        return 'Enter verify dimension';
      default:
        if (isTraceMode && activeTracePoints.length > 0) {
          return `${pendingZoneSeed?.label ?? 'Takeoff area'} · 90° snap is active`;
        }
        if (selectedZone) {
          return `${selectedZone.label} selected`;
        }
        if (isScaleVerified) {
          return 'Draw takeoff areas, then add only the fields needed for that area.';
        }
        return 'Calibrate once, then draw areas that affect wall, ceiling, or floor insulation.';
    }
  })();
  const showToolDetailPanel =
    selectedToolPanel === 'zone' || (selectedToolPanel === 'select' && Boolean(selectedZone));
  const showCanvasGuide =
    configZone !== null || !hasCalibration || showCalibrationOverlay || showCalibrationSuccess;
  const shouldHighlightZoneSelection =
    hasCalibration &&
    !showCalibrationOverlay &&
    !showCalibrationSuccess &&
    !isTraceMode &&
    !configZone &&
    !selectedZone;
  const calibrationGuideText = (() => {
    switch (calibrationStep) {
      case 'primary_a':
        return 'Step 1 · Click the first point of a known dimension on the plan.';
      case 'primary_b':
        return 'Step 1 · Click the second point of that same dimension.';
      case 'primary_input':
        return 'Step 2 · Enter the real-world dimension to finish calibration.';
      case 'verify_a':
        return 'Verify · Click the first point of a different printed dimension.';
      case 'verify_b':
        return 'Verify · Click the second point of that dimension.';
      case 'verify_input':
        return 'Verify · Enter the printed dimension to confirm the scale.';
      default:
        if (!hasCalibration) {
          return pendingZoneSeed
            ? `Calibrate once, then you can trace ${pendingZoneSeed.label}.`
            : 'Calibrate this page once before you start drawing areas.';
        }
        return pendingZoneSeed
          ? `Calibrated. ${pendingZoneSeed.label} is ready to trace.`
          : 'Calibrated. You can start tracing areas.';
    }
  })();

  const leftSectionClass = 'border-b border-[var(--takeoff-line)] px-3 py-2.5 last:border-b-0';
  const rightSectionClass = 'border-b border-[var(--takeoff-line)] px-3 py-3 last:border-b-0';
  const inputClass =
    'takeoff-mono w-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1.5 text-[10px] text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5';
  const handleAreaCatalogWheelCapture = (event: ReactWheelEvent<HTMLElement>) => {
    const scrollContainer = areaCatalogScrollRef.current;
    if (!scrollContainer) return;

    event.preventDefault();
    event.stopPropagation();

    const deltaMultiplier =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? scrollContainer.clientHeight
          : 1;
    const dominantDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    scrollContainer.scrollTop += dominantDelta * deltaMultiplier;
  };

  const renderZoneRoofPitchControls = (
    zone: TakeoffZone,
    value: string,
    setValue: (nextValue: string) => void,
  ) => {
    if (!zoneNeedsRoofPitch(zone)) return null;

    const currentPitchLabel = zoneHasRoofPitch(zone)
      ? formatRoofPitch(zone.roofPitchRise ?? 0, zone.roofPitchRun ?? 0)
      : null;
    const draftPitch = parseRoofPitchText(value);
    const pitchSourceLabel =
      zone.roofPitchSource === 'vision'
        ? 'AI vision'
        : zone.roofPitchSource === 'manual'
          ? 'manual'
          : null;

    return (
      <div className="col-span-2 space-y-2 border border-[rgba(15,118,110,0.18)] bg-[rgba(240,253,250,0.65)] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="takeoff-label text-[8px] font-semibold text-[#0f766e]">
            Roof pitch
          </span>
          {currentPitchLabel && (
            <span className="takeoff-mono border border-[rgba(15,118,110,0.2)] bg-white px-1.5 py-0.5 text-[8px] text-[#0f766e]">
              {currentPitchLabel}
            </span>
          )}
        </div>
        <div className="text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
          {currentPitchLabel
            ? `Using ${currentPitchLabel}${pitchSourceLabel ? ` from ${pitchSourceLabel}` : ''}. Sloped SF can now carry forward.`
            : 'Vaulted areas need a roof pitch before SF is shown or carried into the estimate.'}
        </div>

        {roofPitchCandidates.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5">
            {roofPitchCandidates.map((candidate) => {
              const active =
                zone.roofPitchRise === candidate.rise && zone.roofPitchRun === candidate.run;
              return (
                <button
                  key={`${zone.id}-${candidate.key}`}
                  type="button"
                  onClick={() => {
                    applyZoneRoofPitch(zone.id, candidate, 'vision', candidate.sourceText);
                    setValue(candidate.label);
                  }}
                  className={`takeoff-mono border px-2 py-1.5 text-left text-[9px] transition-colors ${
                    active
                      ? 'border-[#0f766e] bg-white text-[#0f766e]'
                      : 'border-[rgba(15,118,110,0.18)] bg-white/80 text-[var(--takeoff-ink)] hover:border-[#0f766e]'
                  }`}
                >
                  <span className="block font-semibold">{candidate.label}</span>
                  <span className="block text-[8px] text-[var(--takeoff-text-muted)]">
                    P{candidate.pageIndex + 1}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="takeoff-mono border border-[rgba(15,118,110,0.16)] bg-white/80 px-2 py-1.5 text-[9px] text-[var(--takeoff-text-muted)]">
            No AI roof pitch found on the selected pages.
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => commitZoneRoofPitch(zone.id, value, setValue)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitZoneRoofPitch(zone.id, value, setValue);
                event.currentTarget.blur();
              }
            }}
            placeholder="Manual pitch e.g. 7/12"
            className={inputClass}
          />
          <button
            type="button"
            disabled={!draftPitch}
            onClick={() => commitZoneRoofPitch(zone.id, value, setValue)}
            className="takeoff-mono rounded-full border border-[rgba(15,118,110,0.22)] bg-white px-2.5 py-1 text-[9px] font-medium text-[#0f766e] transition-colors disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:text-[var(--takeoff-text-subtle)]"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={!currentPitchLabel}
            onClick={() => clearZoneRoofPitch(zone.id, setValue)}
            className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[9px] font-medium text-[var(--takeoff-text-muted)] transition-colors disabled:cursor-not-allowed disabled:text-[var(--takeoff-text-subtle)]"
          >
            Clear
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="takeoff-shell takeoff-light-theme h-full overflow-hidden text-[var(--takeoff-ink)]">
      <div className="relative flex h-full overflow-hidden border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.74)] shadow-[0_30px_72px_rgba(31,39,33,0.12)]">
        <aside className="flex h-full w-[304px] shrink-0 overflow-hidden border-r border-[var(--takeoff-line)] bg-[rgba(248,248,246,0.98)]">
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div className={leftSectionClass}>
              <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                Takeoff Areas
              </div>
              <div className="mt-0.5 text-[14px] font-medium text-[var(--takeoff-ink)]">
                {activePageTitle}
              </div>
            </div>

            <div className={leftSectionClass} data-tour="areas-primary-tools">
              <div className="grid grid-cols-2 gap-1.5">
                <PrimaryToolButton
                  label="Select"
                  active={isPointerMode}
                  color={{ stroke: 'var(--takeoff-ink)' }}
                  icon={MousePointer2}
                  onClick={() => {
                    setSelectedToolPanel('select');
                    setTool('pointer');
                  }}
                />
                <PrimaryToolButton
                  label="Cal."
                  active={isScaleMode}
                  color={{ stroke: 'var(--takeoff-ink)' }}
                  icon={Ruler}
                  onClick={() => {
                    setSelectedToolPanel('scale');
                    startCalibration();
                  }}
                />
                <PrimaryToolButton
                  label="Area"
                  active={isTraceMode}
                  color={{ stroke: 'var(--takeoff-ink)' }}
                  icon={Pentagon}
                  onClick={() => handleTraceZone()}
                />
              </div>
            </div>

            {anticipatedZones.length > 0 && (
              <div
                data-tour="areas-ai-suggestions"
                className={`${leftSectionClass} transition-all duration-500 ${
                  shouldHighlightZoneSelection
                    ? 'bg-[rgba(59,130,246,0.08)] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.32),0_10px_24px_rgba(59,130,246,0.08)]'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    {shouldHighlightZoneSelection ? 'Step 2 · Choose Area' : 'Suggested Takeoff Areas'}
                  </div>
                  <div className="flex items-center gap-2">
                    {shouldHighlightZoneSelection && (
                      <span className="takeoff-mono rounded-full border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.12)] px-2 py-0.5 text-[9px] text-[#2563eb]">
                        Next step
                      </span>
                    )}
                    {!shouldHighlightZoneSelection && (
                      <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                        {anticipatedZones.length}
                      </span>
                    )}
                  </div>
                </div>
                {shouldHighlightZoneSelection && (
                  <div className="mt-1.5 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                    Calibration is complete. Pick a suggested area to start tracing.
                  </div>
                )}
                <div className="mt-2 space-y-1.5">
	                  {anticipatedZones.map((zone) => {
	                    const preset = ANTICIPATED_ZONE_PRESETS[zone.key];
	                    const isSelectedSuggestion = activeSuggestedZoneKey === zone.key;
	                    const bestPageIndex = getBestPageIndexForSuggestedArea(
	                      zone,
	                      pageAnalysis,
	                      selectedPages,
	                      activePageIndex,
	                    );
	                    const bestPageLabel = formatBestPageLabel(bestPageIndex, pageAnalysis);
	                    const detectedInsulation = Array.from(
	                      new Set(
	                        [
                          ...zone.insulationTypes,
                          ...zone.rValueDetails,
                          ...zone.rValues,
                        ]
                          .map((value) => value.trim())
                          .filter(Boolean),
                      ),
                    ).slice(0, 3);
                    return (
                      <button
	                        key={`${zone.key}-${zone.pageIndexes.join('-')}`}
	                        onClick={() => {
	                          if (preset) {
	                            handleTraceZone(preset, {
	                              suggestionLabel: zone.label,
	                              targetPageIndex: bestPageIndex,
	                            });
	                          }
	                        }}
                        className={`w-full border px-3 py-1.5 text-left transition-[border-color,box-shadow,transform,background-color] duration-300 hover:border-[#9eb29d] ${
                          isSelectedSuggestion
                            ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)] shadow-[0_0_0_1px_rgba(31,39,33,0.08)]'
                            : shouldHighlightZoneSelection
                              ? 'border-[rgba(59,130,246,0.34)] bg-white shadow-[0_0_0_1px_rgba(59,130,246,0.08)]'
                              : 'border-[var(--takeoff-line)] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] font-medium text-[var(--takeoff-ink)]">
                            {zone.label}
                          </div>
                          {isSelectedSuggestion && (
                            <span className="takeoff-mono rounded-full border border-[var(--takeoff-line-strong)] bg-[var(--takeoff-paper-strong)] px-1.5 py-0.5 text-[8px] text-[var(--takeoff-ink)]">
                              Selected
                            </span>
                          )}
                        </div>
	                        <div className="mt-0.5 truncate text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
	                          {zone.evidence[0] ?? 'Starting hint from scanned context'}
	                        </div>
	                        <div className="mt-0.5 truncate text-[9px] leading-4 text-[var(--takeoff-text-subtle)]">
	                          Best page: {bestPageLabel}
	                        </div>
	                        <div
                          className={`mt-1 text-[9px] leading-4 ${
                            detectedInsulation.length > 0
                              ? 'text-[#466f4c]'
                              : 'text-[var(--takeoff-text-subtle)]'
                          }`}
                        >
                          {detectedInsulation.length > 0
                            ? `Detected: ${detectedInsulation.join(' · ')}`
                            : 'No insulation recommendation detected'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {showToolDetailPanel && (
              <div className={`${leftSectionClass} takeoff-hide-scrollbar min-h-0 flex-1 overflow-y-auto`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    {selectedToolPanel === 'select' ? 'Select' : 'Area'}
                  </div>
                  <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                    {activeModeLabel}
                  </span>
                </div>

                {selectedToolPanel === 'select' && (
                <div className="mt-2 space-y-2">
                  <div className="takeoff-mono text-[9px] text-[var(--takeoff-text-muted)]">
                    {instructionText}
                  </div>

                  {selectedZone ? (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          value={selectedZone.label}
                          onChange={(event) =>
                            updateZoneObject(selectedZone.id, { label: event.target.value })
                          }
                          placeholder="Area label"
                          className={`${inputClass} col-span-2`}
                        />
                        <select
                          value={selectedZone.zoneType}
                          onChange={(event) =>
                            updateZoneObject(selectedZone.id, {
                              zoneType: event.target.value as ZoneType,
                            })
                          }
	                          className={`${inputClass} col-span-2`}
                        >
                          {ZONE_TYPE_OPTIONS.map((zoneType) => (
                            <option key={zoneType} value={zoneType}>
                              {ZONE_LABELS[zoneType]}
                            </option>
                          ))}
                        </select>
                        {zoneNeedsCeilingType(selectedZone.zoneType) && (
                          <select
                            value={selectedZone.ceilingType ?? 'flat'}
                            onChange={(event) =>
                              updateZoneObject(selectedZone.id, {
                                ceilingType: event.target.value as ZoneCeilingType,
                              })
                            }
	                            className={`${inputClass} ${
	                              zoneShowsFloorLabel(selectedZone.zoneType) ||
	                              zoneNeedsHeight(selectedZone.zoneType)
	                                ? ''
	                                : 'col-span-2'
	                            }`}
                          >
                            {Object.entries(ZONE_MODAL_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                        {zoneShowsFloorLabel(selectedZone.zoneType) && (
                          <input
                            value={selectedZone.floorLabel ?? ''}
                            onChange={(event) =>
                              updateZoneObject(selectedZone.id, {
                                floorLabel: event.target.value || null,
                              })
                            }
                            placeholder="Floor / level"
                            className={inputClass}
                          />
                        )}
                        {zoneNeedsHeight(selectedZone.zoneType) && (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={selectedZoneHeightText}
                            onChange={(event) => setSelectedZoneHeightText(event.target.value)}
                            onBlur={() =>
                              commitZoneHeight(
                                selectedZone.id,
                                selectedZoneHeightText,
                                setSelectedZoneHeightText,
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                commitZoneHeight(
                                  selectedZone.id,
                                  selectedZoneHeightText,
                                  setSelectedZoneHeightText,
                                );
                                event.currentTarget.blur();
                              }
                            }}
                            placeholder={`Ceiling height e.g. 9'-6"`}
                            className={`${inputClass} ${
                              !zoneNeedsCeilingType(selectedZone.zoneType) && !zoneShowsFloorLabel(selectedZone.zoneType)
                                ? 'col-span-2'
                                : ''
                            }`}
                          />
                        )}
                        {renderZoneRoofPitchControls(
                          selectedZone,
                          selectedZoneRoofPitchText,
                          setSelectedZoneRoofPitchText,
                        )}
                        <div className="col-span-2 space-y-2 border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="takeoff-label text-[8px] font-semibold text-[var(--takeoff-text-subtle)]">
                              Insulation
                            </span>
                            <span className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-1.5 py-0.5 text-[8px] text-[var(--takeoff-text-muted)]">
                              Manual
                            </span>
                          </div>
                          <input
                            type="text"
                            value={selectedZoneInsulationText}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setSelectedZoneInsulationText(nextValue);
                              updateZoneObject(selectedZone.id, {
                                insulationType: nextValue.trim() || null,
                              });
                            }}
                            placeholder="Type e.g. Fiberglass batt"
                            className={inputClass}
                          />
                          <input
                            type="text"
                            value={selectedZoneRValueText}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setSelectedZoneRValueText(nextValue);
                              updateZoneObject(selectedZone.id, {
                                rValue: nextValue.trim() || null,
                              });
                            }}
                            placeholder="R-value e.g. R-21"
                            className={inputClass}
                          />
                          <div className="text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                            {zoneInsulationHelperText(
                              selectedZone.zoneType,
                              Boolean(selectedZoneInsulationText.trim() || selectedZoneRValueText.trim()),
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                      Select an area from the canvas or catalog to review what it means for walls, ceilings, or floors.
                    </div>
                  )}
                </div>
                )}

                {selectedToolPanel === 'zone' && (() => {
                  const activeAreaType = pendingZoneSeed?.zoneType ?? zonePreset ?? DEFAULT_ZONE_TYPE;
                  const activeAreaColor = ZONE_COLORS[activeAreaType];
                  const activeAreaLabel = pendingZoneSeed?.label ?? getZoneLabelBase(activeAreaType);

                  return (
                    <div className="mt-2 space-y-2">
                      <div className="border border-[var(--takeoff-line)] bg-white px-2.5 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="takeoff-label text-[8px] font-semibold text-[var(--takeoff-text-subtle)]">
                              Active Area
                            </div>
                            <div className="mt-1 flex min-w-0 items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: activeAreaColor.stroke }}
                              />
                              <span className="truncate text-[11px] font-medium text-[var(--takeoff-ink)]">
                                {activeAreaLabel}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                              {ZONE_LABELS[activeAreaType]}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                        {isTraceMode ? (
                          <div
                            className="takeoff-mono flex min-h-8 items-center justify-center border px-2.5 py-1.5 text-[9px] font-medium"
                            style={{
                              borderColor: `${activeAreaColor.stroke}33`,
                              backgroundColor: `${activeAreaColor.fill}16`,
                              color: activeAreaColor.stroke,
                            }}
                          >
                            Trace active
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleTraceZone()}
                            className="takeoff-mono flex min-h-8 items-center justify-center gap-1.5 border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-2.5 py-1.5 text-[9px] font-medium text-white transition-colors hover:bg-black"
                          >
                            <Pentagon className="h-3.5 w-3.5" />
                            <span>Trace area</span>
                          </button>
                        )}
                        {activeTracePoints.length > 0 && (
                          <button
                            type="button"
                            onClick={() => removeLastTracePoint()}
                            className="takeoff-mono min-h-8 border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[9px] font-medium text-[var(--takeoff-ink)] transition-colors hover:border-[#9eb29d]"
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
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

          {showCanvasGuide && (
            <div className="pointer-events-none absolute left-4 top-4 z-20">
	              <div
	                className={`pointer-events-auto border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] text-[var(--takeoff-ink)] shadow-[0_18px_40px_rgba(31,39,33,0.18)] backdrop-blur-md ${
	                  !configZone && (!hasCalibration || showCalibrationOverlay)
	                    ? 'w-[min(92vw,280px)] px-4 py-3'
	                    : 'w-[min(92vw,320px)] px-3 py-3'
	                }`}
	              >
	                {configZone ? (
	                  <>
	                    <div className="flex items-start justify-between gap-3 border-b border-[var(--takeoff-line)] pb-2">
	                      <div className="min-w-0">
	                        <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
	                          Area Settings
	                        </div>
	                        <div className="mt-1 truncate text-[15px] font-medium text-[var(--takeoff-ink)]">
	                          {configZone.label}
	                        </div>
	                      </div>
	                      <button
	                        type="button"
	                        onClick={() => setZoneConfigTraceId(null)}
	                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)] transition-colors hover:border-[#9eb29d] hover:bg-[var(--takeoff-paper)]"
	                        aria-label="Done configuring area"
	                        title="Done"
	                      >
	                        <Check className="h-4 w-4" />
	                      </button>
	                    </div>
	                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <input
                          value={configZone.label}
                          onChange={(event) =>
                            updateZoneObject(configZone.id, { label: event.target.value })
                          }
                        placeholder="Area label"
                        className={`${inputClass} col-span-2`}
                        autoFocus
                      />
                      <select
                        value={configZone.zoneType}
                        onChange={(event) =>
                          updateZoneObject(configZone.id, {
                            zoneType: event.target.value as ZoneType,
                          })
                        }
	                        className={`${inputClass} col-span-2`}
                      >
                        {ZONE_TYPE_OPTIONS.map((zoneType) => (
                          <option key={zoneType} value={zoneType}>
                            {ZONE_LABELS[zoneType]}
                          </option>
                        ))}
                      </select>
                      {zoneNeedsCeilingType(configZone.zoneType) && (
                        <select
                          value={configZone.ceilingType ?? 'flat'}
                          onChange={(event) =>
                            updateZoneObject(configZone.id, {
                              ceilingType: event.target.value as ZoneCeilingType,
                            })
                          }
	                          className={`${inputClass} ${
	                            zoneShowsFloorLabel(configZone.zoneType) ||
	                            zoneNeedsHeight(configZone.zoneType)
	                              ? ''
	                              : 'col-span-2'
	                          }`}
                        >
                          {Object.entries(ZONE_MODAL_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                      {zoneShowsFloorLabel(configZone.zoneType) && (
                        <input
                          value={configZone.floorLabel ?? ''}
                          onChange={(event) =>
                            updateZoneObject(configZone.id, {
                              floorLabel: event.target.value || null,
                            })
                          }
                          placeholder="Floor / level"
                          className={inputClass}
                        />
                      )}
                      {zoneNeedsHeight(configZone.zoneType) && (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={configZoneHeightText}
                          onChange={(event) => setConfigZoneHeightText(event.target.value)}
                          onBlur={() =>
                            commitZoneHeight(
                              configZone.id,
                              configZoneHeightText,
                              setConfigZoneHeightText,
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitZoneHeight(
                                configZone.id,
                                configZoneHeightText,
                                setConfigZoneHeightText,
                              );
                              event.currentTarget.blur();
                            }
                          }}
                          placeholder={`Ceiling height e.g. 9'-6"`}
                          className={`${inputClass} ${
                            !zoneNeedsCeilingType(configZone.zoneType) && !zoneShowsFloorLabel(configZone.zoneType)
                              ? 'col-span-2'
                              : ''
                          }`}
                        />
                      )}
                      {renderZoneRoofPitchControls(
                        configZone,
                        configZoneRoofPitchText,
                        setConfigZoneRoofPitchText,
                      )}
                      <div className="col-span-2 space-y-2 border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="takeoff-label text-[8px] font-semibold text-[var(--takeoff-text-subtle)]">
                            Insulation
                          </span>
                          <span className="takeoff-mono border border-[var(--takeoff-line)] bg-white px-1.5 py-0.5 text-[8px] text-[var(--takeoff-text-muted)]">
                            Manual
                          </span>
                        </div>
                        <input
                          type="text"
                          value={configZoneInsulationText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setConfigZoneInsulationText(nextValue);
                            updateZoneObject(configZone.id, {
                              insulationType: nextValue.trim() || null,
                            });
                          }}
                          placeholder="Type e.g. Fiberglass batt"
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={configZoneRValueText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setConfigZoneRValueText(nextValue);
                            updateZoneObject(configZone.id, {
                              rValue: nextValue.trim() || null,
                            });
                          }}
                          placeholder="R-value e.g. R-21"
                          className={inputClass}
                        />
                        <div className="text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                          {zoneInsulationHelperText(
                            configZone.zoneType,
                            Boolean(configZoneInsulationText.trim() || configZoneRValueText.trim()),
                          )}
                        </div>
                      </div>
                    </div>
	                  </>
                ) : !hasCalibration || showCalibrationOverlay ? (
                  <div className="space-y-2">
                    <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                      {showCalibrationOverlay ? 'Calibrating page' : 'Calibration required'}
                    </div>
                    <div className="text-[13px] font-medium leading-5 text-[var(--takeoff-ink)]">
                      {showCalibrationOverlay
                        ? calibrationGuideText
                        : pendingZoneSeed
                          ? `Calibrate once to trace ${pendingZoneSeed.label}.`
                          : 'Calibrate once to start tracing areas.'}
                    </div>
                    {!hasCalibration && (
                      <div className="rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                        Finish one calibration on this page to unlock area tracing and AI area pickup.
                      </div>
                    )}
                    {!showCalibrationOverlay && (
                      <div className="pt-1">
                        <button
                          onClick={() => {
                            setSelectedToolPanel('scale');
                            startCalibration();
                          }}
                          className="takeoff-mono rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3.5 py-1.5 text-[10px] font-medium text-white transition-colors hover:bg-black"
                        >
                          Calibrate
                        </button>
                      </div>
                    )}
                    {!hasCalibration && (
                      <div className="border-t border-[var(--takeoff-line)] pt-2">
                        <button
                          type="button"
                          onClick={() => setShowScalePresetMenu((current) => !current)}
                          className="flex w-full items-center justify-between gap-3 text-left"
                        >
                          <div>
                            <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                              Known printed scale
                            </div>
                            <div className="mt-0.5 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                              Use only when the sheet prints a matching architectural scale.
                            </div>
                          </div>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-[var(--takeoff-text-subtle)] transition-transform ${
                              showScalePresetMenu ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {showScalePresetMenu && (
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            {SCALE_PRESETS.map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => {
                                  applyScalePresetCalibration(preset.pdfPointsPerFoot, preset.label);
                                  setShowScalePresetMenu(false);
                                  setSelectedToolPanel('select');
                                }}
                                className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1.5 text-[9px] font-medium text-[var(--takeoff-ink)] transition-colors hover:border-[#9eb29d] hover:bg-[var(--takeoff-paper)]"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : showCalibrationSuccess ? (
                  <div
                    className={`relative flex items-center gap-3 transition-all duration-700 ease-out ${
                      calibrationSuccessFading
                        ? 'translate-y-1 scale-[0.97] opacity-0'
                        : 'translate-y-0 scale-100 opacity-100'
                    }`}
                  >
                    <div
                      className={`absolute left-0 top-1/2 h-14 w-14 -translate-y-1/2 rounded-full bg-[rgba(22,163,74,0.12)] blur-[2px] transition-all duration-700 ease-out ${
                        calibrationSuccessFading ? 'scale-[1.45] opacity-0' : 'scale-100 opacity-100'
                      }`}
                    />
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                      <div
                        className={`absolute inset-0 rounded-full border border-[rgba(22,163,74,0.24)] bg-[rgba(22,163,74,0.1)] transition-all duration-700 ease-out ${
                          calibrationSuccessFading ? 'scale-[1.25] opacity-0' : 'scale-100 opacity-100'
                        }`}
                      />
                      <div
                        className={`absolute inset-[5px] rounded-full border border-[rgba(22,163,74,0.18)] bg-[rgba(255,255,255,0.9)] transition-all duration-700 ease-out ${
                          calibrationSuccessFading ? 'scale-[0.92] opacity-0' : 'scale-100 opacity-100'
                        }`}
                      />
                      <Check
                        className={`relative h-5 w-5 text-[#15803d] transition-all duration-700 ease-out ${
                          calibrationSuccessFading ? 'scale-75 opacity-0' : 'scale-100 opacity-100'
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                        Calibrated
                      </div>
                      <div className="mt-1 text-[14px] font-medium text-[var(--takeoff-ink)]">
                        Scale confirmed
                      </div>
                      <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                        {pendingZoneSeed
                          ? `${pendingZoneSeed.label} is ready to trace.`
                          : 'Zone tracing is now unlocked.'}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
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

        <aside
          data-takeoff-wheel-guard="true"
          onWheelCapture={handleAreaCatalogWheelCapture}
          className={`pointer-events-auto absolute inset-y-0 right-0 z-30 hidden w-[252px] overflow-hidden border-l border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.94)] transition-[transform,opacity] duration-200 ease-out xl:flex ${
            zoneCatalogOpen
              ? 'translate-x-0 opacity-100 shadow-[-18px_0_36px_rgba(31,39,33,0.08)]'
              : 'translate-x-full opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div className={rightSectionClass}>
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
                Areas explain what each wall touches and which ceiling or floor quantities should carry into the estimate.
              </div>
            </div>

            <div
              ref={areaCatalogScrollRef}
              className="takeoff-hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3"
              style={{ overscrollBehavior: 'contain' }}
            >
              <div className="space-y-2">
	                {allZones.length > 0 ? (
	                  areaCatalogGroups.map((group) => {
	                    const zoneColors = group.zones.map((zone) =>
	                      resolveAreaZoneColor(zone, roofPitchColorByKey),
	                    );
	                    const uniqueStrokeColors = Array.from(new Set(zoneColors.map((color) => color.stroke)));
	                    const zoneColor =
	                      uniqueStrokeColors.length === 1
	                        ? zoneColors[0]
	                        : ZONE_COLORS[group.zoneType];
                    const selectedInGroup = group.zones.some((zone) => selectedTraceId === zone.id);
                    const hiddenCount = group.zones.filter((zone) => {
                      const hiddenIds = hiddenObjectIdsByView.get(zone.viewId);
                      return hiddenIds?.has(zone.id);
                    }).length;
                    const groupMeta = formatAreaGroupMeta(group.zones, session?.calibrations ?? null);

                    return (
                      <div
                        key={`area-group-${group.key}`}
                        className={`border px-3 py-2.5 transition-colors ${
                          selectedInGroup
                            ? 'border-[var(--takeoff-ink)] bg-[rgba(255,255,255,0.98)]'
                            : 'border-[var(--takeoff-line)] bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: zoneColor.stroke }}
                              />
                              <div className="truncate text-[11px] font-semibold text-[var(--takeoff-ink)]">
                                {group.label}
                              </div>
                            </div>
                            {groupMeta && (
                              <div className="mt-1 takeoff-mono text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                                {groupMeta}
                              </div>
                            )}
                          </div>
                          <div className="takeoff-mono shrink-0 rounded-sm border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-1.5 py-0.5 text-[8px] text-[var(--takeoff-text-subtle)]">
                            {group.zones.length} piece{group.zones.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        {hiddenCount > 0 && (
                          <div className="mt-1 takeoff-mono text-[8px] text-[var(--takeoff-text-subtle)]">
                            {hiddenCount} hidden
                          </div>
                        )}
                        <div className="mt-2 space-y-1.5 border-t border-[var(--takeoff-line)] pt-2">
	                          {group.zones.map((zone) => {
	                            const zoneHiddenIds = hiddenObjectIdsByView.get(zone.viewId);
	                            const isZoneHidden = zoneHiddenIds?.has(zone.id) ?? false;
	                            const zoneColor = resolveAreaZoneColor(zone, roofPitchColorByKey);
	                            return (
	                              <ZoneRow
	                                key={`catalog-${zone.id}`}
	                                zoneType={zone.zoneType}
	                                color={zoneColor}
	                                label={zone.label}
                                status={zoneLifecycleLabel(zone)}
                                selected={selectedTraceId === zone.id}
                                hidden={isZoneHidden}
                                meta={formatZoneMeta(zone, session?.calibrations?.[zone.pageIndex] ?? null)}
                                onSelect={() => {
                                  setTool('pointer');
                                  if (selectedTraceId === zone.id && activePageIndex === zone.pageIndex) {
                                    clearSelection();
                                    return;
                                  }
                                  setActivePage(zone.pageIndex);
                                  setActiveView(zone.viewId);
                                  if (isZoneHidden) {
                                    toggleObjectHiddenInView(zone.viewId, zone.id);
                                  }
                                  selectTrace(zone.id);
                                  setZoneCatalogOpen(true);
                                }}
                                onToggleHidden={() => toggleObjectHiddenInView(zone.viewId, zone.id)}
                                onDelete={() => deleteTrace(zone.id)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                    No takeoff areas yet. Draw the living/heated area first, then add only the garage, crawlspace, attic/ceiling, storage, or height-change areas that affect insulation.
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
