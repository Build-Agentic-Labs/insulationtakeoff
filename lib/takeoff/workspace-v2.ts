import { v4 as uuid } from 'uuid';
import type { OpeningScanMarker, TakeoffSession } from '@/lib/types/takeoff';
import {
  calibratedLength,
  deriveZoneStatus,
  normalizeZoneType,
  openingAreaSf,
  traceAreaSf,
} from '@/lib/types/takeoff';
import type {
  AssemblyScope,
  PageRole,
  PageScore,
  Trace,
  TraceClassification,
} from '@/lib/types/takeoff';
import type {
  AiSuggestion,
  PageCapability,
  EvidenceRequirementStatus,
  PageAnalysis,
  SourcePageViewState,
  TakeoffView,
  TakeoffWorkspaceV2,
  WorkspaceSummary,
  WorkspaceSummaryArea,
  WorkspaceSummaryBucket,
} from '@/lib/types/takeoff-v2';
import { WORKSPACE_SCHEMA_VERSION } from '@/lib/types/takeoff-v2';
import {
  getSurfacePresetByScope,
  getWallPreset,
  getWallPresetByScope,
} from '@/lib/takeoff/presets';
import { computeSlopedAreaSf } from '@/lib/takeoff/roof-pitch';
import { sanitizeEstimateRows } from '@/lib/quotes/estimate';

interface PageClassificationLike {
  page_index: number;
  page_type?: string;
  page_name?: string;
  label?: string;
  has_dimensions?: boolean;
  is_floor_plan?: boolean;
  secondary_page_types?: string[];
  takeoff_relevance?: PageScore['takeoff_relevance'];
  confidence?: number;
  score?: number;
  scan_flags?: PageScore['scan_flags'];
  stop_flags?: PageScore['stop_flags'];
  scan_extracts?: PageScore['scan_extracts'];
  scan_notes?: string[];
}

const PAGE_ROLE_ORDER: PageRole[] = ['measurement', 'evidence'];

function normalizePageRoles(roles: PageRole[] | undefined): PageRole[] {
  return PAGE_ROLE_ORDER.filter((role) => roles?.includes(role));
}

export function inferAiPageRoles({
  page_type,
  is_floor_plan,
  takeoff_relevance,
  scan_flags,
}: Pick<PageClassificationLike, 'page_type' | 'is_floor_plan' | 'takeoff_relevance' | 'scan_flags'>): PageRole[] {
  const roles = new Set<PageRole>();

  if (takeoff_relevance === 'primary_measurement') {
    roles.add('measurement');
  }

  if (takeoff_relevance === 'supporting_evidence') {
    roles.add('evidence');
  }

  if (is_floor_plan) {
    roles.add('measurement');
  }

  if (
    ['section', 'elevation', 'schedule', 'detail', 'roof', 'foundation'].includes(
      page_type ?? ''
    )
  ) {
    roles.add('evidence');
  }

  if (
    scan_flags?.general_insulation_notes ||
    scan_flags?.wall_type_legend ||
    scan_flags?.exterior_wall_details ||
    scan_flags?.interior_wall_details ||
    scan_flags?.roof_ceiling_details ||
    scan_flags?.floor_foundation_details ||
    scan_flags?.enlarged_sections ||
    scan_flags?.height_references ||
    scan_flags?.opening_info ||
    scan_flags?.material_specs ||
    scan_flags?.symbols_and_keynotes
  ) {
    roles.add('evidence');
  }

  return normalizePageRoles(Array.from(roles));
}

function inferCapabilities(match: PageClassificationLike | undefined, confidence: number) {
  const pageType = match?.page_type ?? 'other';
  const scanFlags = match?.scan_flags;
  const scanExtracts = match?.scan_extracts;
  const hasDimensions = Boolean(match?.has_dimensions || scanFlags?.dimensions);
  const isFloorPlan = Boolean(match?.is_floor_plan);
  const hasHeightReferences = Boolean(scanFlags?.height_references);
  const hasOpeningInfo = Boolean(
    scanFlags?.opening_info ||
      scanExtracts?.window_sizes?.length ||
      scanExtracts?.opening_quantity_notes?.length ||
      scanExtracts?.opening_schedule_items?.length ||
      scanExtracts?.opening_evidence === 'direct_dimensions' ||
      scanExtracts?.opening_evidence === 'tags_only'
  );
  const hasWallAssemblyInfo = Boolean(
    scanFlags?.wall_type_legend ||
      scanFlags?.exterior_wall_details ||
      scanFlags?.interior_wall_details
  );
  const hasExtractedInsulationInfo = Boolean(
    scanExtracts?.r_values?.length || scanExtracts?.insulation_types?.length
  );
  const hasRoofPitchInfo = Boolean(scanFlags?.roof_pitch || scanExtracts?.roof_pitches?.length);
  const hasVaporBarrierInfo = Boolean(
    scanFlags?.vapor_barrier || scanExtracts?.vapor_barriers?.length
  );
  const hasAirBarrierInfo = Boolean(scanFlags?.air_barrier || scanExtracts?.air_barriers?.length);
  const hasSpecInfo = Boolean(
    scanFlags?.general_insulation_notes ||
      scanFlags?.material_specs ||
      scanFlags?.wall_type_legend ||
      hasVaporBarrierInfo ||
      hasAirBarrierInfo ||
      hasExtractedInsulationInfo
  );
  const hasStructuralDetailContext = Boolean(
    scanFlags?.enlarged_sections ||
      scanFlags?.symbols_and_keynotes ||
      scanFlags?.alternates_or_conflicts
  );
  const hasRoofScope = Boolean(scanFlags?.roof_ceiling_details);
  const hasFoundationScope = Boolean(scanFlags?.floor_foundation_details);
  const hasZoningInfo = Boolean(scanFlags?.insulated_area_plan_views || scanFlags?.room_names);
  const high = confidence;
  const medium = confidence > 0 ? Math.min(confidence * 0.75, 0.68) : 0.22;
  const low = 0.05;

  return [
    {
      capability: 'page_title' as const,
      score: match?.page_name || match?.label ? Math.max(confidence, 0.8) : 0.2,
      evidence: match?.page_name || match?.label ? [match.page_name ?? match.label ?? ''] : [],
    },
    {
      capability: 'wall_measurement' as const,
      score:
        isFloorPlan || scanFlags?.insulated_area_plan_views
          ? hasDimensions
            ? high
            : medium
          : low,
      evidence: hasDimensions ? ['dimension strings detected'] : [],
    },
    {
      capability: 'zoning' as const,
      score: hasZoningInfo || isFloorPlan ? high : 0.15,
      evidence: hasZoningInfo ? ['plan views or room names support zoning'] : isFloorPlan ? ['AI flagged floor-plan geometry'] : [],
    },
    {
      capability: 'wall_height' as const,
      score: hasHeightReferences
        ? high
        : pageType === 'section' || pageType === 'elevation'
          ? high
          : pageType === 'detail'
            ? medium
            : 0.1,
      evidence: hasHeightReferences
        ? ['height references detected']
        : pageType === 'section' || pageType === 'elevation'
          ? [`${pageType} page likely contains height references`]
          : [],
    },
    {
      capability: 'opening_schedule' as const,
      score: hasOpeningInfo ? high : pageType === 'schedule' ? high : 0.08,
      evidence: hasOpeningInfo
        ? [
            scanExtracts?.opening_schedule_items?.length
              ? `schedule rows: ${scanExtracts.opening_schedule_items.length}`
              : scanExtracts?.opening_evidence === 'tags_only'
                ? 'floor plan uses opening tags'
                : scanExtracts?.window_sizes?.length
              ? `opening sizes: ${scanExtracts.window_sizes.slice(0, 3).join(', ')}`
              : 'opening sizes or schedules detected',
          ]
        : pageType === 'schedule'
          ? ['schedule page detected']
          : [],
    },
    {
      capability: 'wall_type' as const,
      score: hasWallAssemblyInfo
        ? high
        : pageType === 'detail' || pageType === 'section'
          ? hasStructuralDetailContext
            ? medium
            : 0.18
          : pageType === 'schedule'
            ? medium
            : 0.1,
      evidence: hasWallAssemblyInfo
        ? ['wall assembly information detected']
        : pageType === 'detail' || pageType === 'section'
          ? hasStructuralDetailContext
            ? [`${pageType} page may contain assembly context, but insulation evidence is not explicit`]
            : []
          : [],
    },
    {
      capability: 'attic_scope' as const,
      score: hasRoofScope ? high : pageType === 'roof' ? high : 0.08,
      evidence: hasRoofScope ? ['roof or ceiling assembly details detected'] : pageType === 'roof' ? ['roof plan detected'] : [],
    },
    {
      capability: 'roof_pitch' as const,
      score: hasRoofPitchInfo
        ? high
        : pageType === 'section' || pageType === 'roof'
          ? medium
          : 0.08,
      evidence: hasRoofPitchInfo
        ? [
            scanExtracts?.roof_pitches?.length
              ? `roof pitch: ${scanExtracts.roof_pitches.slice(0, 3).join(', ')}`
              : 'roof pitch or slope note detected',
          ]
        : [],
    },
    {
      capability: 'crawlspace_scope' as const,
      score: hasFoundationScope ? high : pageType === 'foundation' ? high : 0.08,
      evidence: hasFoundationScope ? ['foundation or slab insulation details detected'] : pageType === 'foundation' ? ['foundation page detected'] : [],
    },
    {
      capability: 'garage_scope' as const,
      score: scanFlags?.room_names ? medium : isFloorPlan ? medium : 0.08,
      evidence: scanFlags?.room_names ? ['room names may identify garage scope'] : isFloorPlan ? ['garage scope may be measurable from floor plan'] : [],
    },
    {
      capability: 'vapor_barrier' as const,
      score: hasVaporBarrierInfo ? high : 0.08,
      evidence: hasVaporBarrierInfo
        ? [
            scanExtracts?.vapor_barriers?.length
              ? `vapor barrier: ${scanExtracts.vapor_barriers.slice(0, 2).join(', ')}`
              : 'vapor barrier or retarder note detected',
          ]
        : [],
    },
    {
      capability: 'air_barrier' as const,
      score: hasAirBarrierInfo ? high : 0.08,
      evidence: hasAirBarrierInfo
        ? [
            scanExtracts?.air_barriers?.length
              ? `air barrier: ${scanExtracts.air_barriers.slice(0, 2).join(', ')}`
              : 'air barrier or air sealing note detected',
          ]
        : [],
    },
    {
      capability: 'spec_scope' as const,
      score: hasSpecInfo
        ? high
        : pageType === 'detail' || pageType === 'schedule'
          ? hasStructuralDetailContext
            ? 0.28
            : 0.12
          : pageType === 'section'
            ? hasStructuralDetailContext
              ? 0.22
              : 0.1
            : 0.1,
      evidence: hasSpecInfo
        ? [
            hasExtractedInsulationInfo
              ? `explicit insulation values: ${[
                  ...(scanExtracts?.r_values ?? []).slice(0, 3),
                  ...(scanExtracts?.insulation_types ?? []).slice(0, 2),
                ].join(', ')}`
              : 'insulation notes, wall type legend, or material specs detected',
          ]
        : pageType === 'detail' || pageType === 'schedule'
          ? hasStructuralDetailContext
            ? [`${pageType} page may contain construction notes, but explicit insulation specs are not confirmed`]
            : []
          : [],
    },
  ];
}

function capabilityScore(page: PageAnalysis, capability: string): number {
  return page.capabilities.find((item) => item.capability === capability)?.score ?? 0;
}

function capabilityEvidence(page: PageAnalysis, capability: PageCapability): string[] {
  return page.capabilities.find((item) => item.capability === capability)?.evidence ?? [];
}

function uniqueList(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function zoneHintFor(page: PageAnalysis, key: AnticipatedZoneSignal['key']) {
  return page.scanExtracts?.zone_hints?.[key];
}

function zoneHintEvidence(page: PageAnalysis, key: AnticipatedZoneSignal['key']) {
  const hint = zoneHintFor(page, key);
  if (!hint) return [];

  return uniqueList([
    ...(hint.r_value_details ?? hint.r_values ?? []).map((value) => `Detected ${value}`),
    ...(hint.wall_framing ?? []).map((value) => `Detected ${value} framing`),
    ...(hint.insulation_types ?? []).map((value) => `Detected ${value}`),
  ]);
}

export interface AnticipatedZoneSignal {
  key: 'exterior' | 'interior' | 'attic' | 'crawlspace';
  label: string;
  confidence: number;
  status: 'likely' | 'possible';
  provenance: 'scan_extract' | 'page_inference' | 'mixed';
  pageIndexes: number[];
  scanBackedPageIndexes: number[];
  inferredPageIndexes: number[];
  evidence: string[];
  wallFraming: string[];
  rValues: string[];
  rValueDetails: string[];
  insulationTypes: string[];
  notes: string[];
}

export function buildAnticipatedZonesFromPageAnalysis(
  pageAnalysis: PageAnalysis[],
): AnticipatedZoneSignal[] {
  const workingSet = pageAnalysis.filter((page) => page.roles.length > 0);

  const collect = (
    key: AnticipatedZoneSignal['key'],
    label: string,
    predicate: (page: PageAnalysis) => boolean,
    evidenceFor: (page: PageAnalysis) => string[],
  ): AnticipatedZoneSignal | null => {
    const scanBackedMatches = workingSet.filter((page) => Boolean(zoneHintFor(page, key)));
    const inferredMatches = workingSet.filter(
      (page) => !scanBackedMatches.includes(page) && predicate(page),
    );
    const matches = [...scanBackedMatches, ...inferredMatches];
    if (matches.length === 0) return null;

    const confidence =
      scanBackedMatches.length > 0
        ? scanBackedMatches.reduce((max, page) => Math.max(max, page.confidence), 0)
        : inferredMatches.reduce((max, page) => Math.max(max, page.confidence), 0);

    const evidenceSource = scanBackedMatches.length > 0 ? scanBackedMatches : inferredMatches;
    const evidence = uniqueList(
      evidenceSource.flatMap((page) => evidenceFor(page)).filter(Boolean),
    ).slice(0, 3);

    const provenance =
      scanBackedMatches.length > 0 && inferredMatches.length > 0
        ? 'mixed'
        : scanBackedMatches.length > 0
          ? 'scan_extract'
          : 'page_inference';

    return {
      key,
      label,
      confidence,
      status: scanBackedMatches.length > 0 ? 'likely' : 'possible',
      pageIndexes: matches.map((page) => page.pageIndex),
      scanBackedPageIndexes: scanBackedMatches.map((page) => page.pageIndex),
      inferredPageIndexes: inferredMatches.map((page) => page.pageIndex),
      provenance,
      evidence:
        evidence.length > 0
          ? evidence
          : provenance === 'scan_extract'
            ? [`Explicit scan-backed zone evidence found on ${scanBackedMatches.length} page${scanBackedMatches.length === 1 ? '' : 's'}.`]
            : [`Inferred from ${matches.length} scanned page${matches.length === 1 ? '' : 's'} with no explicit zone callout yet.`],
      wallFraming: uniqueList(
        scanBackedMatches.flatMap((page) => page.scanExtracts?.zone_hints?.[key]?.wall_framing ?? []),
      ),
      rValues: uniqueList(
        scanBackedMatches.flatMap((page) => page.scanExtracts?.zone_hints?.[key]?.r_values ?? []),
      ),
      rValueDetails: uniqueList(
        scanBackedMatches.flatMap((page) => page.scanExtracts?.zone_hints?.[key]?.r_value_details ?? []),
      ),
      insulationTypes: uniqueList(
        scanBackedMatches.flatMap((page) => page.scanExtracts?.zone_hints?.[key]?.insulation_types ?? []),
      ),
      notes: uniqueList(
        scanBackedMatches.flatMap((page) => page.scanExtracts?.zone_hints?.[key]?.notes ?? []),
      ),
    };
  };

  const exterior = collect(
    'exterior',
    'Exterior',
    (page) =>
      Boolean(zoneHintFor(page, 'exterior')) ||
      page.roles.includes('measurement') ||
      capabilityScore(page, 'wall_measurement') >= 0.65 ||
      capabilityScore(page, 'zoning') >= 0.72,
    (page) => [
      ...zoneHintEvidence(page, 'exterior'),
      ...(zoneHintFor(page, 'exterior')
        ? []
        : [
            ...capabilityEvidence(page, 'wall_measurement'),
            ...capabilityEvidence(page, 'zoning'),
          ]),
    ],
  );

  const interior = collect(
    'interior',
    'Interior',
    (page) =>
      Boolean(zoneHintFor(page, 'interior')) ||
      (capabilityScore(page, 'zoning') >= 0.72 &&
        (page.roles.includes('measurement') || capabilityScore(page, 'wall_type') >= 0.2)),
    (page) => [
      ...zoneHintEvidence(page, 'interior'),
      ...(zoneHintFor(page, 'interior')
        ? []
        : [
            ...capabilityEvidence(page, 'zoning'),
            ...capabilityEvidence(page, 'wall_type'),
          ]),
    ],
  );

  const attic = collect(
    'attic',
    'Attic',
    (page) => Boolean(zoneHintFor(page, 'attic')) || capabilityScore(page, 'attic_scope') >= 0.58,
    (page) => [
      ...zoneHintEvidence(page, 'attic'),
      ...(zoneHintFor(page, 'attic') ? [] : capabilityEvidence(page, 'attic_scope')),
    ],
  );

  const crawlspace = collect(
    'crawlspace',
    'Crawlspace / Floor',
    (page) =>
      Boolean(zoneHintFor(page, 'crawlspace')) || capabilityScore(page, 'crawlspace_scope') >= 0.58,
    (page) => [
      ...zoneHintEvidence(page, 'crawlspace'),
      ...(zoneHintFor(page, 'crawlspace') ? [] : capabilityEvidence(page, 'crawlspace_scope')),
    ],
  );

  return [exterior, interior, attic, crawlspace].filter(
    (item): item is AnticipatedZoneSignal => Boolean(item),
  );
}

export interface TakeoffSessionRowLike {
  id: string;
  project_id: string;
  document_id: string;
  status: string;
  measurement_basis: TakeoffSession['measurementBasis'] | null;
  selected_pages: number[] | null;
  calibrations: TakeoffSession['calibrations'] | null;
  traces: TakeoffSession['traces'] | null;
  classifications: TakeoffSession['classifications'] | null;
  window_catalog?: TakeoffSession['windowCatalog'] | null;
  door_catalog?: TakeoffSession['doorCatalog'] | null;
  workspace_schema_version?: number | null;
  page_analysis?: TakeoffSession['pageAnalysis'] | null;
  views?: TakeoffSession['views'] | null;
  zones?: TakeoffSession['zones'] | null;
  wall_runs?: TakeoffSession['wallRuns'] | null;
  surfaces?: TakeoffSession['surfaces'] | null;
  opening_items?: TakeoffSession['openingItems'] | null;
  completion_checklist?: TakeoffSession['completionChecklist'] | null;
  ai_suggestions?: TakeoffSession['aiSuggestions'] | null;
  viewer_state?: TakeoffSession['viewerState'] | null;
  workspace_summary?: TakeoffSession['workspaceSummary'] | null;
  estimate_rows?: TakeoffSession['estimateRows'] | null;
  created_at: string;
  updated_at: string;
}

function extractOpeningScanMarkersFromViewerState(
  viewerState: TakeoffSession['viewerState'] | null | undefined,
): OpeningScanMarker[] {
  if (!viewerState?.length) return [];

  return viewerState.flatMap((state) =>
    (state.openingScanMarkers ?? [])
      .filter(
        (marker) =>
          Boolean(marker?.id) &&
          Boolean(marker?.wallRunId) &&
          typeof marker?.pageIndex === 'number' &&
          typeof marker?.point?.x === 'number' &&
          typeof marker?.point?.y === 'number',
      )
      .map((marker) => ({
        id: marker.id,
        openingType: marker.openingType,
        pageIndex: marker.pageIndex,
        wallRunId: marker.wallRunId,
        point: {
          x: marker.point.x,
          y: marker.point.y,
        },
      })),
  );
}

function serializeViewerStateWithOpeningScanMarkers(
  viewerState: TakeoffSession['viewerState'] | null | undefined,
  openingScanMarkers: OpeningScanMarker[] | null | undefined,
): SourcePageViewState[] {
  const baseViewerState = viewerState?.length ? viewerState : [];
  const markersByPage = new Map<number, OpeningScanMarker[]>();

  for (const marker of openingScanMarkers ?? []) {
    const pageMarkers = markersByPage.get(marker.pageIndex) ?? [];
    pageMarkers.push(marker);
    markersByPage.set(marker.pageIndex, pageMarkers);
  }

  const pageIndexes = new Set<number>([
    ...baseViewerState.map((state) => state.pageIndex),
    ...markersByPage.keys(),
  ]);

  return Array.from(pageIndexes)
    .sort((a, b) => a - b)
    .map((pageIndex) => {
      const existingState =
        baseViewerState.find((state) => state.pageIndex === pageIndex) ?? {
          pageIndex,
          ghostedViewIds: [],
        };
      const pageMarkers = markersByPage.get(pageIndex) ?? [];

      return pageMarkers.length > 0
        ? { ...existingState, openingScanMarkers: pageMarkers }
        : { ...existingState, openingScanMarkers: [] };
    });
}

const WALL_SCOPES = new Set<AssemblyScope>([
  'exterior_wall_2x6',
  'exterior_wall_2x4',
  'garage_wall',
  'basement_wall',
  'knee_wall',
  'rim_joist',
]);

const SURFACE_SCOPES = new Set<AssemblyScope>([
  'attic_floor',
  'crawlspace_floor',
  'garage_ceiling',
  'sound_floor',
  'cathedral_ceiling',
  'cantilever_floor',
]);

const DEFAULT_SCOPE_LABELS: Record<WorkspaceSummaryArea['id'], string> = {
  exterior_walls: 'Exterior Walls',
  garage_walls: 'Garage Walls',
  basement_walls: 'Basement Walls',
  knee_walls: 'Knee Walls',
  attic_ceiling: 'Attic/Ceiling Insulation',
  crawlspace_floor: 'Crawlspace/Floor Insulation',
  garage_ceiling: 'Garage Ceiling Insulation',
  sound_floor: 'Sound Floor Insulation',
  cathedral_ceiling: 'Cathedral Ceiling Insulation',
  cantilever_floor: 'Cantilever Floor Insulation',
  rim_joist: 'Rim Joist Insulation',
};

function createEmptyWorkspaceSummary(): WorkspaceSummary {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totals: {
      totalLf: 0,
      grossSf: 0,
      netSf: 0,
      openingSf: 0,
      bucketCount: 0,
    },
    buckets: [],
    areas: [],
  };
}

function createViewerState(views: TakeoffView[]): SourcePageViewState[] {
  const viewIdsByPage = new Map<number, string[]>();

  for (const view of views) {
    const pageViewIds = viewIdsByPage.get(view.pageIndex) ?? [];
    pageViewIds.push(view.id);
    viewIdsByPage.set(view.pageIndex, pageViewIds);
  }

  return Array.from(viewIdsByPage.entries()).map(([pageIndex, pageViewIds]) => ({
    pageIndex,
    activeViewId: pageViewIds[0],
    ghostedViewIds: [],
  }));
}

export function createDefaultTakeoffViews(selectedPages: number[]): TakeoffView[] {
  return selectedPages.map((pageIndex, index) => ({
    id: uuid(),
    pageIndex,
    name: `Page ${pageIndex + 1} / Primary View`,
    scope: 'general',
    isPrimary: true,
    status: index === 0 ? 'active' : 'draft',
    hiddenObjectIds: [],
    ghostedViewIds: [],
  }));
}

export function buildPageAnalysisFromPageScores({
  totalPages,
  pageScores,
}: {
  totalPages: number;
  pageScores: PageScore[];
}): PageAnalysis[] {
  return Array.from({ length: totalPages }, (_, pageIndex) => {
    const match = pageScores.find((item) => item.page_index === pageIndex);
    const aiRoles = normalizePageRoles(match?.ai_roles);
    const roles = normalizePageRoles(match?.roles);
    const selectedByAi = aiRoles.length > 0 || Boolean(match?.ai_selected);
    const confidence = typeof match?.score === 'number' ? match.score : 0;
    const pageType = match?.page_type;
    const hasDimensions = Boolean(match?.scan_flags?.dimensions);

    return {
      pageIndex,
      title: match?.label?.trim() || `Page ${pageIndex + 1}`,
      pageType,
      selectedByAi,
      confidence,
      roles,
      aiRoles,
      capabilities: inferCapabilities(match, confidence),
      scanFlags: match?.scan_flags,
      stopFlags: match?.stop_flags,
      scanExtracts: match?.scan_extracts,
      notes: [
        roles.length > 0
          ? `Tagged for ${roles.join(' + ')}`
          : 'Not selected for the active page set',
        hasDimensions ? 'Carries measurable dimensions' : 'No explicit measurement dimensions detected',
        selectedByAi ? 'Included in the AI-recommended page set' : 'Added manually or left unselected',
        confidence > 0 ? `Vision confidence: ${Math.round(confidence * 100)}%` : 'No vision confidence captured',
        ...(match?.scan_extracts?.r_values?.length
          ? [`R-values: ${match.scan_extracts.r_values.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.insulation_types?.length
          ? [`Insulation types: ${match.scan_extracts.insulation_types.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.roof_pitches?.length
          ? [`Roof pitch: ${match.scan_extracts.roof_pitches.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.vapor_barriers?.length
          ? [`Vapor barrier: ${match.scan_extracts.vapor_barriers.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.air_barriers?.length
          ? [`Air barrier: ${match.scan_extracts.air_barriers.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.baffles_or_venting?.length
          ? [`Baffles / venting: ${match.scan_extracts.baffles_or_venting.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.window_sizes?.length
          ? [`Opening sizes: ${match.scan_extracts.window_sizes.join(', ')}`]
          : []),
        ...(match?.scan_extracts?.opening_evidence === 'tags_only'
          ? ['Opening evidence: floor plan uses tags without dimensions']
          : match?.scan_extracts?.opening_evidence === 'direct_dimensions'
            ? ['Opening evidence: direct opening dimensions visible']
            : match?.scan_extracts?.opening_evidence === 'unlabeled'
              ? ['Opening evidence: visible but unlabeled openings']
              : []),
        ...(match?.scan_extracts?.opening_schedule_items?.length
          ? [
              `Opening schedule rows: ${match.scan_extracts.opening_schedule_items.length}`,
              `Opening schedule samples: ${match.scan_extracts.opening_schedule_items
                .slice(0, 4)
                .map((item) => item.tagNormalized)
                .join(', ')}`,
            ]
          : []),
        ...(match?.scan_extracts?.opening_quantity_notes?.length
          ? match.scan_extracts.opening_quantity_notes.map((note) => `Opening hint: ${note}`)
          : []),
        ...(match?.scan_notes ?? []),
        ...(match?.stop_flags
          ? Object.entries(match.stop_flags)
              .filter(([, flagged]) => Boolean(flagged))
              .map(([key]) => `Stop check: ${key.replace(/_/g, ' ')}`)
          : []),
      ],
    };
  });
}

export function getEvidenceRequirementStatuses(
  pageAnalysis: PageAnalysis[],
): EvidenceRequirementStatus[] {
  const selectedPages = pageAnalysis.filter((page) => page.roles.length > 0);
  const measurementPages = selectedPages.filter((page) => page.roles.includes('measurement'));
  const evidencePages = selectedPages.filter((page) => page.roles.includes('evidence'));

  const findPages = (
    predicate: (page: PageAnalysis) => boolean,
  ) => evidencePages.filter(predicate).map((page) => page.pageIndex);

  const wallHeightPages = findPages(
    (page) =>
      Boolean(page.scanFlags?.height_references) ||
      (['section', 'elevation'].includes(page.pageType ?? '') && page.confidence >= 0.7),
  );
  const detailPages = findPages(
    (page) =>
      Boolean(
        page.scanExtracts?.r_values?.length ||
        page.scanExtracts?.insulation_types?.length ||
        page.scanExtracts?.vapor_barriers?.length ||
        page.scanExtracts?.air_barriers?.length ||
        page.scanExtracts?.baffles_or_venting?.length ||
        page.scanFlags?.general_insulation_notes ||
        page.scanFlags?.material_specs ||
        page.scanFlags?.wall_type_legend ||
        page.scanFlags?.vapor_barrier ||
        page.scanFlags?.air_barrier ||
        page.scanFlags?.baffles_or_venting
      ),
  );
  const roofPitchPages = findPages(
    (page) =>
      Boolean(page.scanExtracts?.roof_pitches?.length || page.scanFlags?.roof_pitch) ||
      capabilityScore(page, 'roof_pitch') >= 0.7,
  );
  const vaporBarrierPages = findPages(
    (page) =>
      Boolean(
        page.scanExtracts?.vapor_barriers?.length ||
          page.scanExtracts?.air_barriers?.length ||
          page.scanFlags?.vapor_barrier ||
          page.scanFlags?.air_barrier,
      ) ||
      capabilityScore(page, 'vapor_barrier') >= 0.7 ||
      capabilityScore(page, 'air_barrier') >= 0.7,
  );
  const schedulePages = findPages(
    (page) =>
      Boolean(
        page.scanExtracts?.opening_schedule_items?.length ||
          page.scanExtracts?.window_sizes?.length ||
          page.scanExtracts?.opening_quantity_notes?.length
      ) ||
      (page.pageType === 'schedule' && page.confidence >= 0.7),
  );
  const directOpeningPlanPages = measurementPages.filter(
    (page) =>
      page.scanExtracts?.opening_evidence === 'direct_dimensions' ||
      Boolean(page.scanExtracts?.window_sizes?.length),
  );
  const taggedOpeningPlanPages = measurementPages.filter(
    (page) => page.scanExtracts?.opening_evidence === 'tags_only',
  );
  const unlabeledOpeningPlanPages = measurementPages.filter(
    (page) =>
      page.scanExtracts?.opening_evidence === 'unlabeled' ||
      page.scanExtracts?.opening_evidence === 'no_opening_evidence' ||
      Boolean(page.stopFlags?.missing_opening_identification),
  );
  const scheduleRows = selectedPages.flatMap(
    (page) => page.scanExtracts?.opening_schedule_items ?? [],
  );
  const scheduleRequired = taggedOpeningPlanPages.length > 0;
  const estimatorReviewRequired =
    taggedOpeningPlanPages.length === 0 &&
    directOpeningPlanPages.length === 0 &&
    unlabeledOpeningPlanPages.length > 0;

  return [
    {
      requirement: 'measurement_page',
      label: 'Measurement page',
      description: 'At least one measurable plan page is required to trace exterior scope.',
      severity: 'required',
      satisfied: measurementPages.length > 0,
      pageIndexes: measurementPages.map((page) => page.pageIndex),
    },
    {
      requirement: 'wall_height_reference',
      label: 'Sections / elevations',
      description: 'Supports wall-height confirmation and section review.',
      severity: 'required',
      satisfied: wallHeightPages.length > 0,
      pageIndexes: wallHeightPages,
    },
    {
      requirement: 'insulation_details',
      label: 'Insulation details / specs',
      description: 'Supports wall assembly and insulation attribute review.',
      severity: 'required',
      satisfied: detailPages.length > 0,
      pageIndexes: detailPages,
    },
    {
      requirement: 'roof_pitch_reference',
      label: 'Roof pitch',
      description: 'Recommended for sloped and cathedral ceiling takeoff.',
      severity: 'recommended',
      satisfied: roofPitchPages.length > 0,
      pageIndexes: roofPitchPages,
    },
    {
      requirement: 'vapor_barrier_reference',
      label: 'Vapor / air barrier',
      description: 'Recommended because insulation scope can include vapor and air barrier requirements.',
      severity: 'recommended',
      satisfied: vaporBarrierPages.length > 0,
      pageIndexes: vaporBarrierPages,
    },
    {
      requirement: 'opening_schedule',
      label: 'Opening schedule',
      description: scheduleRequired
        ? 'Required because one or more floor plans use opening tags without dimensions.'
        : estimatorReviewRequired
          ? 'Estimator review required because openings are visible without reliable labels or dimensions.'
          : directOpeningPlanPages.length > 0
            ? 'Optional support because direct opening dimensions are visible on the plan.'
            : 'Recommended for reusable opening types later in the workflow.',
      severity: scheduleRequired || estimatorReviewRequired ? 'required' : 'recommended',
      satisfied: scheduleRequired || estimatorReviewRequired ? scheduleRows.length > 0 : schedulePages.length > 0,
      pageIndexes: schedulePages,
    },
  ];
}

export function buildInitialAiSuggestionsFromPageAnalysis(
  pageAnalysis: PageAnalysis[],
): AiSuggestion[] {
  const suggestions: AiSuggestion[] = [];
  const evidenceStatuses = getEvidenceRequirementStatuses(pageAnalysis);
  const evidencePages = pageAnalysis.filter((page) => page.roles.includes('evidence'));

  for (const page of evidencePages) {
    if (capabilityScore(page, 'wall_height') >= 0.7) {
      suggestions.push({
        id: uuid(),
        pageIndex: page.pageIndex,
        kind: 'page',
        label: `Use "${page.title}" to confirm wall heights.`,
        fieldLabel: 'Evidence role',
        suggestedValue: 'Wall height reference',
        confidence: page.confidence,
        evidence: page.capabilities
          .find((capability) => capability.capability === 'wall_height')
          ?.evidence ?? [],
        sourceSnippet: page.pageType
          ? `AI classified this page as ${page.pageType}.`
          : 'AI flagged this page as supporting evidence.',
        status: 'pending',
      });
    }

    if (capabilityScore(page, 'wall_type') >= 0.7 || capabilityScore(page, 'spec_scope') >= 0.7) {
      suggestions.push({
        id: uuid(),
        pageIndex: page.pageIndex,
        kind: 'page',
        label: `Use "${page.title}" to confirm insulation details.`,
        fieldLabel: 'Evidence role',
        suggestedValue: 'Assembly / spec reference',
        confidence: page.confidence,
        evidence: page.capabilities
          .find((capability) => capability.capability === 'wall_type')
          ?.evidence ?? page.capabilities.find((capability) => capability.capability === 'spec_scope')
            ?.evidence ?? [],
        sourceSnippet: page.pageType
          ? `AI classified this page as ${page.pageType}.`
          : 'AI flagged this page as supporting evidence.',
        status: 'pending',
      });
    }

    if (capabilityScore(page, 'roof_pitch') >= 0.7) {
      suggestions.push({
        id: uuid(),
        pageIndex: page.pageIndex,
        kind: 'page',
        label: `Use "${page.title}" as a roof pitch reference.`,
        fieldLabel: 'Evidence role',
        suggestedValue: 'Roof pitch reference',
        confidence: page.confidence,
        evidence: page.capabilities
          .find((capability) => capability.capability === 'roof_pitch')
          ?.evidence ?? [],
        sourceSnippet: 'AI found a roof pitch or slope clue on this page.',
        status: 'pending',
      });
    }

    if (
      capabilityScore(page, 'vapor_barrier') >= 0.7 ||
      capabilityScore(page, 'air_barrier') >= 0.7
    ) {
      suggestions.push({
        id: uuid(),
        pageIndex: page.pageIndex,
        kind: 'page',
        label: `Use "${page.title}" to confirm vapor / air barrier requirements.`,
        fieldLabel: 'Evidence role',
        suggestedValue: 'Vapor / air barrier reference',
        confidence: page.confidence,
        evidence:
          page.capabilities.find((capability) => capability.capability === 'vapor_barrier')
            ?.evidence ??
          page.capabilities.find((capability) => capability.capability === 'air_barrier')
            ?.evidence ??
          [],
        sourceSnippet: 'AI found vapor barrier, vapor retarder, or air sealing clues on this page.',
        status: 'pending',
      });
    }

    if (capabilityScore(page, 'opening_schedule') >= 0.7) {
      suggestions.push({
        id: uuid(),
        pageIndex: page.pageIndex,
        kind: 'page',
        label: `Use "${page.title}" as the opening library source.`,
        fieldLabel: 'Evidence role',
        suggestedValue: 'Opening schedule',
        confidence: page.confidence,
        evidence: page.capabilities
          .find((capability) => capability.capability === 'opening_schedule')
          ?.evidence ?? [],
        sourceSnippet: 'AI classified this page as a schedule page.',
        status: 'pending',
      });
    }
  }

  for (const status of evidenceStatuses) {
    if (status.satisfied) continue;

    suggestions.push({
      id: uuid(),
      pageIndex: -1,
      kind: 'warning',
      label: `Missing ${status.label.toLowerCase()}.`,
      fieldLabel: 'Page coverage',
      suggestedValue: status.label,
      confidence: status.severity === 'required' ? 0.94 : 0.72,
      evidence: [status.description],
      sourceSnippet:
        status.severity === 'required'
          ? 'The current page set is missing a required support category.'
          : 'This category is recommended for later scope refinement.',
      status: 'pending',
    });
  }

  return suggestions;
}

function normalizeArea(
  area: WorkspaceSummaryArea | null | undefined,
  nextSqft: number,
  nextLf: number | undefined,
  description: string,
): WorkspaceSummaryArea | null {
  if (!area) return null;

  return {
    ...area,
    sqft: Math.max(0, area.sqft + nextSqft),
    lf: nextLf !== undefined ? Math.max(0, (area.lf ?? 0) + nextLf) : area.lf,
    description,
  };
}

function areaForScope(
  scope: AssemblyScope,
  bucket: WorkspaceSummaryBucket,
): WorkspaceSummaryArea | null {
  const byLabel = (id: WorkspaceSummaryArea['id'], description: string, lf?: number) => ({
    id,
    label: DEFAULT_SCOPE_LABELS[id],
    sqft: bucket.netSf,
    lf,
    description,
    source: 'calibrated_takeoff' as const,
  });

  switch (scope) {
    case 'exterior_wall_2x6':
    case 'exterior_wall_2x4':
      return byLabel('exterior_walls', `${Math.round(bucket.netSf).toLocaleString()} net sf from calibrated wall runs`);
    case 'garage_wall':
      return byLabel('garage_walls', `${Math.round(bucket.netSf).toLocaleString()} net sf from calibrated garage wall runs`);
    case 'basement_wall':
      return byLabel('basement_walls', `${Math.round(bucket.netSf).toLocaleString()} net sf from calibrated basement wall runs`);
    case 'knee_wall':
      return byLabel('knee_walls', `${Math.round(bucket.netSf).toLocaleString()} net sf from calibrated knee walls`);
    case 'attic_floor':
      return byLabel('attic_ceiling', `${Math.round(bucket.netSf).toLocaleString()} sq ft from calibrated attic surfaces`);
    case 'crawlspace_floor':
      return byLabel('crawlspace_floor', `${Math.round(bucket.netSf).toLocaleString()} sq ft from calibrated crawlspace surfaces`);
    case 'garage_ceiling':
      return byLabel('garage_ceiling', `${Math.round(bucket.netSf).toLocaleString()} sq ft from calibrated garage ceilings`);
    case 'sound_floor':
      return byLabel('sound_floor', `${Math.round(bucket.netSf).toLocaleString()} sq ft from calibrated sound floor surfaces`);
    case 'cathedral_ceiling':
      return byLabel('cathedral_ceiling', `${Math.round(bucket.netSf).toLocaleString()} sq ft from calibrated cathedral ceilings`);
    case 'cantilever_floor':
      return byLabel('cantilever_floor', `${Math.round(bucket.netSf).toLocaleString()} sq ft from calibrated cantilever floors`);
    case 'rim_joist':
      return byLabel(
        'rim_joist',
        `${Math.round(bucket.lf).toLocaleString()} LF from calibrated rim joists`,
        bucket.lf
      );
    default:
      return null;
  }
}

function toAreaMap(summaryBuckets: WorkspaceSummaryBucket[]): WorkspaceSummaryArea[] {
  const areas = new Map<WorkspaceSummaryArea['id'], WorkspaceSummaryArea>();

  for (const bucket of summaryBuckets) {
    const area = areaForScope(bucket.scope, bucket);
    if (!area) continue;

    const existing = areas.get(area.id);
    const merged = normalizeArea(
      existing ?? area,
      existing ? area.sqft : 0,
      area.lf,
      area.description
    );

    if (merged) {
      areas.set(area.id, merged);
    }
  }

  return Array.from(areas.values()).filter((area) => area.sqft > 0 || (area.lf ?? 0) > 0);
}

function getSegmentEndpoints(trace: Trace, segmentIndex: number) {
  const isClosingSegment = trace.isClosed && segmentIndex === trace.points.length - 1;
  const start = trace.points[segmentIndex];
  const end = isClosingSegment ? trace.points[0] : trace.points[segmentIndex + 1];

  if (!start || !end) return null;
  return { start, end };
}

function getSummaryFromStoredValue(value: TakeoffSession['workspaceSummary']): WorkspaceSummary | null {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value.buckets) || !Array.isArray(value.areas)) return null;
  return value as WorkspaceSummary;
}

function resolveViewIdForPage(session: TakeoffSession, pageIndex: number): string | null {
  const fromViewerState = session.viewerState?.find((state) => state.pageIndex === pageIndex)?.activeViewId;
  if (fromViewerState) return fromViewerState;

  const primaryView = session.views?.find((view) => view.pageIndex === pageIndex && view.isPrimary);
  if (primaryView) return primaryView.id;

  const anyView = session.views?.find((view) => view.pageIndex === pageIndex);
  return anyView?.id ?? null;
}

function defaultReviewFlags(session: TakeoffSession, pageIndex: number): string[] {
  const calibration = session.calibrations[pageIndex];
  if (!calibration?.verification) return ['needs_calibration_verification'];
  return [];
}

function mergeReviewFlags(
  existingFlags: string[] | undefined,
  nextFlags: string[],
): string[] {
  const dynamicFlags = new Set([
    'needs_calibration_verification',
    'missing_wall_scope',
    'missing_wall_height',
    'needs_zone_assignment',
    'mixed_segment_scope',
    'mixed_segment_height',
  ]);
  const preservedFlags = (existingFlags ?? []).filter(
    (flag) => !dynamicFlags.has(flag)
  );

  return Array.from(
    new Set([...preservedFlags, ...nextFlags])
  );
}

function getUniqueSegmentScopes(classifications: TraceClassification[]): AssemblyScope[] {
  return Array.from(
    new Set(
      classifications
        .filter((classification) => classification.segmentIndex >= 0)
        .map((classification) => classification.assemblyScope)
        .filter((scope): scope is AssemblyScope => Boolean(scope)),
    ),
  );
}

function getUniqueSegmentHeights(classifications: TraceClassification[]): number[] {
  const uniqueValues: number[] = [];

  for (const classification of classifications) {
    if (classification.segmentIndex < 0) continue;
    if (typeof classification.wallHeightFt !== 'number' || classification.wallHeightFt <= 0) continue;

    const hasMatch = uniqueValues.some(
      (value) => Math.abs(value - classification.wallHeightFt!) <= 0.05,
    );
    if (!hasMatch) {
      uniqueValues.push(classification.wallHeightFt);
    }
  }

  return uniqueValues;
}

function buildWallReviewFlags({
  session,
  pageIndex,
  wallRun,
  classification,
}: {
  session: TakeoffSession;
  pageIndex: number;
  wallRun: {
    heightFt?: number;
    assemblyScope?: AssemblyScope;
    sideAZoneId?: string;
    sideBZoneId?: string;
    hasMixedSegmentScope?: boolean;
    hasMixedSegmentHeight?: boolean;
  };
  classification?: TraceClassification;
}): string[] {
  const flags = [...defaultReviewFlags(session, pageIndex)];
  const assemblyScope = classification?.assemblyScope ?? wallRun.assemblyScope;
  const heightFt = classification?.wallHeightFt ?? wallRun.heightFt;

  if (wallRun.hasMixedSegmentScope) {
    flags.push('mixed_segment_scope');
  } else if (!assemblyScope) {
    flags.push('missing_wall_scope');
  }

  if (wallRun.hasMixedSegmentHeight) {
    flags.push('mixed_segment_height');
  } else if (!heightFt || heightFt <= 0) {
    flags.push('missing_wall_height');
  }

  if (!wallRun.sideAZoneId && !wallRun.sideBZoneId) flags.push('needs_zone_assignment');

  return flags;
}

export function buildWorkspaceSummaryFromSession(
  session: TakeoffSession | null | undefined,
): WorkspaceSummary | null {
  if (!session) return null;
  if (!session.traces.length || !session.classifications.length) return createEmptyWorkspaceSummary();

  const classificationsByKey = new Map<string, TraceClassification>();
  const surfacesById = new Map((session.surfaces ?? []).map((surface) => [surface.id, surface]));
  for (const classification of session.classifications) {
    classificationsByKey.set(
      `${classification.traceId}:${classification.segmentIndex}`,
      classification
    );
  }

  const bucketMap = new Map<AssemblyScope, WorkspaceSummaryBucket>();
  let totalLf = 0;
  let grossSf = 0;
  let netSf = 0;
  let openingSf = 0;

  for (const trace of session.traces) {
    const calibration = session.calibrations[trace.pageIndex];
    if (!calibration) continue;

    if (trace.type === 'linear') {
      const segmentCount = trace.points.length - 1 + (trace.isClosed ? 1 : 0);

      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        const classification = classificationsByKey.get(`${trace.id}:${segmentIndex}`);
        if (!classification || !WALL_SCOPES.has(classification.assemblyScope)) continue;

        const endpoints = getSegmentEndpoints(trace, segmentIndex);
        if (!endpoints) continue;

        const lengthFt = calibratedLength(endpoints.start, endpoints.end, calibration);
        const wallHeightFt =
          classification.assemblyScope === 'rim_joist'
            ? 1
            : classification.wallHeightFt;
        if (!wallHeightFt || wallHeightFt <= 0) continue;
        const grossSegmentSf = lengthFt * wallHeightFt;
        const openingSegmentSf = classification.openings.reduce(
          (sum, opening) => sum + openingAreaSf(opening),
          0
        );
        const netSegmentSf = Math.max(0, grossSegmentSf - openingSegmentSf);

        totalLf += lengthFt;
        grossSf += grossSegmentSf;
        netSf += netSegmentSf;
        openingSf += openingSegmentSf;

        const currentBucket = bucketMap.get(classification.assemblyScope) ?? {
          scope: classification.assemblyScope,
          lf: 0,
          grossSf: 0,
          netSf: 0,
          openingSf: 0,
          count: 0,
        };

        currentBucket.lf += lengthFt;
        currentBucket.grossSf += grossSegmentSf;
        currentBucket.netSf += netSegmentSf;
        currentBucket.openingSf += openingSegmentSf;
        currentBucket.count += 1;
        bucketMap.set(classification.assemblyScope, currentBucket);
      }
    }

    if (trace.type === 'area') {
      const classification = classificationsByKey.get(`${trace.id}:-1`);
      if (!classification || !SURFACE_SCOPES.has(classification.assemblyScope)) continue;

      const surface = surfacesById.get(trace.id);
      const planAreaSf = traceAreaSf(trace, calibration);
      const hasRoofPitch =
        typeof surface?.roofPitchRise === 'number' &&
        Number.isFinite(surface.roofPitchRise) &&
        surface.roofPitchRise > 0 &&
        typeof surface.roofPitchRun === 'number' &&
        Number.isFinite(surface.roofPitchRun) &&
        surface.roofPitchRun > 0;
      if (classification.assemblyScope === 'cathedral_ceiling' && !hasRoofPitch) continue;

      const areaSf =
        classification.assemblyScope === 'cathedral_ceiling'
          ? computeSlopedAreaSf(planAreaSf, surface?.roofPitchRise, surface?.roofPitchRun)
          : planAreaSf;
      grossSf += areaSf;
      netSf += areaSf;

      const currentBucket = bucketMap.get(classification.assemblyScope) ?? {
        scope: classification.assemblyScope,
        lf: 0,
        grossSf: 0,
        netSf: 0,
        openingSf: 0,
        count: 0,
      };

      currentBucket.grossSf += areaSf;
      currentBucket.netSf += areaSf;
      currentBucket.count += 1;
      bucketMap.set(classification.assemblyScope, currentBucket);
    }
  }

  const buckets = Array.from(bucketMap.values()).sort((a, b) => a.scope.localeCompare(b.scope));

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totals: {
      totalLf,
      grossSf,
      netSf,
      openingSf,
      bucketCount: buckets.length,
    },
    buckets,
    areas: toAreaMap(buckets),
  };
}

export function getPreferredWorkspaceSummary(
  session: TakeoffSession | null | undefined,
): WorkspaceSummary | null {
  if (!session) return null;
  return getSummaryFromStoredValue(session.workspaceSummary) ?? buildWorkspaceSummaryFromSession(session);
}

function mergeAiSuggestions(
  existingSuggestions: TakeoffSession['aiSuggestions'] | undefined,
  nextSuggestions: AiSuggestion[],
): AiSuggestion[] {
  if (!existingSuggestions?.length) return nextSuggestions;

  return nextSuggestions.map((suggestion) => {
    const existing = existingSuggestions.find(
      (item) =>
        item.label === suggestion.label &&
        item.suggestedValue === suggestion.suggestedValue &&
        item.pageIndex === suggestion.pageIndex
    );

    return existing
      ? {
          ...suggestion,
          id: existing.id,
          status: existing.status,
          appliedValue: existing.appliedValue,
        }
      : suggestion;
  });
}

export function buildCompletionChecklistFromSession(
  session: TakeoffSession | null | undefined,
): TakeoffSession['completionChecklist'] {
  if (!session) return [];

  const pageAnalysis = session.pageAnalysis ?? [];
  const selectedPages = pageAnalysis.filter((page) => page.roles.length > 0);
  const measurementPages = selectedPages.filter((page) => page.roles.includes('measurement'));
  const evidenceStatuses = getEvidenceRequirementStatuses(pageAnalysis);
  const requiredEvidenceReady = evidenceStatuses
    .filter((item) => item.severity === 'required')
    .every((item) => item.satisfied);
  const exteriorZones = (session.zones ?? []).filter((zone) => zone.status === 'confirmed');
  const calibratedMeasurementPages = measurementPages.filter(
    (page) => session.calibrations[page.pageIndex]?.verification
  );
  const wallRuns = session.wallRuns ?? [];
  const unresolvedWallFlags = wallRuns.flatMap((wallRun) => wallRun.reviewFlags);

  return [
    {
      id: 'pages',
      label: 'Confirm measurement and evidence pages',
      scope: 'page_confirmation',
      status:
        selectedPages.length === 0
          ? 'pending'
          : requiredEvidenceReady
            ? 'complete'
            : 'in_progress',
      notes:
        selectedPages.length === 0
          ? 'No pages selected yet.'
          : requiredEvidenceReady
            ? 'Measurement and required evidence coverage confirmed.'
            : 'Required evidence coverage still has gaps.',
    },
    {
      id: 'zones',
      label: 'Create exterior workflow zone',
      scope: 'zone_selection',
      status:
        exteriorZones.length === 0
          ? measurementPages.length > 0
            ? 'in_progress'
            : 'pending'
          : 'complete',
      notes:
        exteriorZones.length > 0
          ? `${exteriorZones.length} zone${exteriorZones.length === 1 ? '' : 's'} ready.`
          : 'At least one exterior zone is required before calibration and tracing.',
    },
    {
      id: 'calibration',
      label: 'Verify scale on active measurement pages',
      scope: 'calibration',
      status:
        calibratedMeasurementPages.length === 0
          ? exteriorZones.length > 0
            ? 'in_progress'
            : 'pending'
          : calibratedMeasurementPages.length === measurementPages.length
            ? 'complete'
            : 'in_progress',
      notes:
        measurementPages.length === 0
          ? 'No measurement pages are tagged yet.'
          : `${calibratedMeasurementPages.length} of ${measurementPages.length} measurement pages have verified scale.`,
    },
    {
      id: 'perimeter',
      label: 'Trace the exterior perimeter',
      scope: 'perimeter_trace',
      status:
        wallRuns.length === 0
          ? calibratedMeasurementPages.length > 0
            ? 'in_progress'
            : 'pending'
          : 'complete',
      notes:
        wallRuns.length > 0
          ? `${wallRuns.length} wall run${wallRuns.length === 1 ? '' : 's'} captured.`
          : 'Exterior perimeter tracing has not started yet.',
    },
    {
      id: 'review',
      label: 'Clear wall review flags',
      scope: 'segment_review',
      status:
        wallRuns.length === 0
          ? 'pending'
          : unresolvedWallFlags.length === 0
            ? 'complete'
            : 'in_progress',
      notes:
        unresolvedWallFlags.length === 0
          ? 'No unresolved wall review flags.'
          : `${unresolvedWallFlags.length} review flag${unresolvedWallFlags.length === 1 ? '' : 's'} still need attention.`,
    },
  ];
}

export function ensureTakeoffSessionWorkspace(
  session: TakeoffSession,
  pageAnalysis?: PageAnalysis[],
): TakeoffSession {
  const views = session.views?.length
    ? session.views
    : createDefaultTakeoffViews(session.selectedPages);
  const analysis = session.pageAnalysis?.length
    ? session.pageAnalysis
    : pageAnalysis ?? [];
  const summary = getPreferredWorkspaceSummary(session) ?? createEmptyWorkspaceSummary();
  const aiSuggestions = mergeAiSuggestions(
    session.aiSuggestions,
    buildInitialAiSuggestionsFromPageAnalysis(analysis),
  );

  const hydratedSession: TakeoffSession = {
    ...session,
    workspaceSchemaVersion: session.workspaceSchemaVersion ?? WORKSPACE_SCHEMA_VERSION,
    pageAnalysis: analysis,
    views,
    zones: session.zones ?? [],
    wallRuns: session.wallRuns ?? [],
    surfaces: session.surfaces ?? [],
    openingItems: session.openingItems ?? [],
    windowCatalog: session.windowCatalog,
    doorCatalog: session.doorCatalog,
    completionChecklist: session.completionChecklist ?? [],
    aiSuggestions,
    viewerState: session.viewerState?.length ? session.viewerState : createViewerState(views),
    openingScanMarkers:
      session.openingScanMarkers ?? extractOpeningScanMarkersFromViewerState(session.viewerState),
    workspaceSummary: summary,
  };

  return {
    ...hydratedSession,
    completionChecklist: buildCompletionChecklistFromSession(hydratedSession),
  };
}

export function syncWorkspaceObjectsFromTraceData(
  session: TakeoffSession,
): TakeoffSession {
  const hydratedSession = ensureTakeoffSessionWorkspace(session);
  const existingZones = new Map((hydratedSession.zones ?? []).map((zone) => [zone.id, zone]));
  const existingWallRuns = new Map((hydratedSession.wallRuns ?? []).map((wallRun) => [wallRun.id, wallRun]));
  const existingSurfaces = new Map((hydratedSession.surfaces ?? []).map((surface) => [surface.id, surface]));

  const classificationsByTrace = new Map<string, TraceClassification[]>();
  for (const classification of hydratedSession.classifications) {
    const list = classificationsByTrace.get(classification.traceId) ?? [];
    list.push(classification);
    classificationsByTrace.set(classification.traceId, list);
  }

  const zones = [];
  const wallRuns = [];
  const surfaces = [];
  const openingItems = [];

  for (const trace of hydratedSession.traces) {
    const traceClassifications = (classificationsByTrace.get(trace.id) ?? []).sort(
      (a, b) => a.segmentIndex - b.segmentIndex
    );
    const primaryClassification =
      trace.type === 'area'
        ? traceClassifications.find((classification) => classification.segmentIndex === -1)
        : traceClassifications[0];

    const viewId =
      existingZones.get(trace.id)?.viewId ??
      existingWallRuns.get(trace.id)?.viewId ??
      existingSurfaces.get(trace.id)?.viewId ??
      resolveViewIdForPage(hydratedSession, trace.pageIndex) ??
      '';

    if (trace.type === 'area' && trace.zone) {
      const existingZone = existingZones.get(trace.id);
      const normalizedZoneType = normalizeZoneType(existingZone?.zoneType ?? trace.zone, existingZone?.label ?? trace.label);
      zones.push({
        id: trace.id,
        pageIndex: trace.pageIndex,
        viewId: existingZone?.viewId ?? viewId,
        label: trace.label,
        zoneType: normalizedZoneType,
        floorLabel: existingZone?.floorLabel ?? null,
        defaultCeilingHeightFt: existingZone?.defaultCeilingHeightFt ?? null,
        ceilingType: existingZone?.ceilingType ?? 'flat',
        insulationType: existingZone?.insulationType ?? null,
        rValue: existingZone?.rValue ?? null,
        roofPitchRise: existingZone?.roofPitchRise ?? null,
        roofPitchRun: existingZone?.roofPitchRun ?? null,
        roofPitchSourceText: existingZone?.roofPitchSourceText ?? null,
        roofPitchConfidence: existingZone?.roofPitchConfidence ?? null,
        roofPitchSource: existingZone?.roofPitchSource ?? null,
        takeoffStatus: existingZone?.takeoffStatus ?? null,
        polygon: trace.points,
        status: deriveZoneStatus({
          zoneType: normalizedZoneType,
          defaultCeilingHeightFt: existingZone?.defaultCeilingHeightFt ?? null,
          ceilingType: existingZone?.ceilingType ?? 'flat',
          insulationType: existingZone?.insulationType ?? null,
          rValue: existingZone?.rValue ?? null,
          roofPitchRise: existingZone?.roofPitchRise ?? null,
          roofPitchRun: existingZone?.roofPitchRun ?? null,
        }),
        aiSuggestionId: existingZone?.aiSuggestionId,
      });
      continue;
    }

    if (trace.type === 'area') {
      const surfacePreset = getSurfacePresetByScope(primaryClassification?.assemblyScope);
      if (!surfacePreset) continue;

      const existingSurface = existingSurfaces.get(trace.id);
      surfaces.push({
        id: trace.id,
        pageIndex: trace.pageIndex,
        viewId: existingSurface?.viewId ?? viewId,
        label: trace.label,
        polygon: trace.points,
        assemblyScope: surfacePreset.scope,
        roofPitchRise: existingSurface?.roofPitchRise ?? null,
        roofPitchRun: existingSurface?.roofPitchRun ?? null,
        roofPitchSourceText: existingSurface?.roofPitchSourceText ?? null,
        roofPitchConfidence: existingSurface?.roofPitchConfidence ?? null,
        roofPitchSource: existingSurface?.roofPitchSource ?? null,
        status: existingSurface?.status ?? 'confirmed',
        aiSuggestionId: existingSurface?.aiSuggestionId,
      });
      continue;
    }

    const wallPreset = getWallPresetByScope(primaryClassification?.assemblyScope) ?? getWallPreset('exterior_2x6');
    const existingWallRun = existingWallRuns.get(trace.id);
    const uniqueSegmentScopes = getUniqueSegmentScopes(traceClassifications);
    const uniqueSegmentHeights = getUniqueSegmentHeights(traceClassifications);
    const hasMixedSegmentScope = uniqueSegmentScopes.length > 1;
    const hasMixedSegmentHeight = uniqueSegmentHeights.length > 1;
    const resolvedAssemblyScope =
      uniqueSegmentScopes.length === 1
        ? uniqueSegmentScopes[0]
        : hasMixedSegmentScope
          ? undefined
          : existingWallRun?.assemblyScope ?? wallPreset.scope;
    const resolvedHeightFt =
      uniqueSegmentHeights.length === 1
        ? uniqueSegmentHeights[0]
        : hasMixedSegmentHeight
          ? undefined
          : existingWallRun?.heightFt;
    const currentOpeningIds: string[] = [];

    for (const classification of traceClassifications) {
      for (let openingIndex = 0; openingIndex < classification.openings.length; openingIndex += 1) {
        const opening = classification.openings[openingIndex];
        const openingId = `${trace.id}:${classification.segmentIndex}:${openingIndex}`;
        currentOpeningIds.push(openingId);
        openingItems.push({
          id: openingId,
          pageIndex: trace.pageIndex,
          viewId: existingWallRun?.viewId ?? viewId,
          wallRunId: trace.id,
          type: opening.type,
          widthFt: opening.width_ft,
          heightFt: opening.height_ft,
          quantity: opening.quantity,
          label: opening.label,
          source: 'manual' as const,
        });
      }
    }

    wallRuns.push({
      id: trace.id,
      pageIndex: trace.pageIndex,
      viewId: existingWallRun?.viewId ?? viewId,
      label: trace.label,
      path: trace.points,
      measurementBasis: hydratedSession.measurementBasis,
      thicknessIn: existingWallRun?.thicknessIn ?? wallPreset.thicknessIn,
      fillSide: existingWallRun?.fillSide ?? 'left',
      framingType: existingWallRun?.framingType ?? wallPreset.framingType,
      sideAZoneId: existingWallRun?.sideAZoneId,
      sideBZoneId: existingWallRun?.sideBZoneId,
      heightFt: resolvedHeightFt,
      heightSource: hasMixedSegmentHeight
        ? 'unknown'
        : existingWallRun?.heightSource ?? (resolvedHeightFt ? 'manual' : 'unknown'),
      assemblyScope: resolvedAssemblyScope,
      openingIds: currentOpeningIds,
      confidence: {
        geometry: existingWallRun?.confidence.geometry ?? 1,
        zoning: existingWallRun?.confidence.zoning ?? 0,
        assembly: hasMixedSegmentScope || hasMixedSegmentHeight
          ? Math.min(existingWallRun?.confidence.assembly ?? 0.8, 0.45)
          : existingWallRun?.confidence.assembly ?? (primaryClassification ? 0.8 : 0.5),
      },
      reviewFlags: mergeReviewFlags(
        existingWallRun?.reviewFlags,
        buildWallReviewFlags({
          session: hydratedSession,
          pageIndex: trace.pageIndex,
          wallRun: {
            heightFt: resolvedHeightFt,
            assemblyScope: resolvedAssemblyScope,
            sideAZoneId: existingWallRun?.sideAZoneId,
            sideBZoneId: existingWallRun?.sideBZoneId,
            hasMixedSegmentScope,
            hasMixedSegmentHeight,
          },
          classification: primaryClassification,
        })
      ),
    });
  }

  const nextSession: TakeoffSession = {
    ...hydratedSession,
    zones,
    wallRuns,
    surfaces,
    openingItems,
  };

  return {
    ...nextSession,
    completionChecklist: buildCompletionChecklistFromSession(nextSession),
    workspaceSummary: buildWorkspaceSummaryFromSession(nextSession) ?? createEmptyWorkspaceSummary(),
  };
}

export function createEmptyTakeoffWorkspaceV2(
  selectedPages: number[],
  pageAnalysis: PageAnalysis[] = [],
): TakeoffWorkspaceV2 {
  const views = createDefaultTakeoffViews(selectedPages);
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    pageAnalysis,
    views,
    zones: [],
    wallRuns: [],
    surfaces: [],
    openingItems: [],
    completionChecklist: [],
    aiSuggestions: [],
    viewerState: createViewerState(views),
    workspaceSummary: createEmptyWorkspaceSummary(),
  };
}

export function mapTakeoffSessionRowToSession(row: TakeoffSessionRowLike): TakeoffSession {
  const openingScanMarkers = extractOpeningScanMarkersFromViewerState(row.viewer_state ?? []);

  return ensureTakeoffSessionWorkspace({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    status: row.status === 'in_progress' ? 'calibrating' : (row.status as TakeoffSession['status']),
    measurementBasis: row.measurement_basis ?? 'exterior_face',
    selectedPages: row.selected_pages ?? [],
    calibrations: row.calibrations ?? {},
    traces: row.traces ?? [],
    classifications: row.classifications ?? [],
    windowCatalog: row.window_catalog === undefined ? undefined : (row.window_catalog ?? []),
    doorCatalog: row.door_catalog === undefined ? undefined : (row.door_catalog ?? []),
    workspaceSchemaVersion: row.workspace_schema_version ?? WORKSPACE_SCHEMA_VERSION,
    pageAnalysis: row.page_analysis ?? [],
    views: row.views ?? [],
    zones: row.zones ?? [],
    wallRuns: row.wall_runs ?? [],
    surfaces: row.surfaces ?? [],
    openingItems: row.opening_items ?? [],
    completionChecklist: row.completion_checklist ?? [],
    aiSuggestions: row.ai_suggestions ?? [],
    viewerState: row.viewer_state ?? [],
    openingScanMarkers,
    workspaceSummary: row.workspace_summary ?? null,
    estimateRows: sanitizeEstimateRows(row.estimate_rows),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function takeoffSessionToApiPayload(session: TakeoffSession) {
  const hydratedSession = ensureTakeoffSessionWorkspace(session);
  const recomputedSummary =
    hydratedSession.traces.length > 0 || hydratedSession.classifications.length > 0
      ? buildWorkspaceSummaryFromSession(hydratedSession)
      : null;
  const completionChecklist = buildCompletionChecklistFromSession(hydratedSession);

  return {
    status: hydratedSession.status,
    measurement_basis: hydratedSession.measurementBasis,
    selected_pages: hydratedSession.selectedPages,
    calibrations: hydratedSession.calibrations,
    traces: hydratedSession.traces,
    classifications: hydratedSession.classifications,
    workspace_schema_version: hydratedSession.workspaceSchemaVersion ?? WORKSPACE_SCHEMA_VERSION,
    page_analysis: hydratedSession.pageAnalysis ?? [],
    views: hydratedSession.views ?? [],
    zones: hydratedSession.zones ?? [],
    wall_runs: hydratedSession.wallRuns ?? [],
    surfaces: hydratedSession.surfaces ?? [],
    opening_items: hydratedSession.openingItems ?? [],
    completion_checklist: completionChecklist,
    ai_suggestions: hydratedSession.aiSuggestions ?? [],
    viewer_state: serializeViewerStateWithOpeningScanMarkers(
      hydratedSession.viewerState,
      hydratedSession.openingScanMarkers,
    ),
    workspace_summary:
      recomputedSummary ??
      hydratedSession.workspaceSummary ??
      createEmptyWorkspaceSummary(),
    estimate_rows: sanitizeEstimateRows(hydratedSession.estimateRows),
    ...(hydratedSession.windowCatalog !== undefined
      ? { window_catalog: hydratedSession.windowCatalog }
      : {}),
    ...(hydratedSession.doorCatalog !== undefined
      ? { door_catalog: hydratedSession.doorCatalog }
      : {}),
  };
}

export interface SuggestedInsulationArea {
  id: WorkspaceSummaryArea['id'];
  name: string;
  description: string;
  sqft: number;
  unit: 'SF' | 'LF';
  enabled: boolean;
  pricePerSqft: number;
}

export interface PricingLike {
  wall_per_sqft: number;
  attic_per_sqft: number;
  garage_wall_per_sqft: number;
  floor_per_sqft: number;
}

export function buildSuggestedAreasFromWorkspaceSummary(
  summary: WorkspaceSummary | null | undefined,
  pricing: PricingLike,
): SuggestedInsulationArea[] {
  if (!summary) return [];

  const getUnitPrice = (id: WorkspaceSummaryArea['id']) => {
    switch (id) {
      case 'garage_walls':
        return pricing.garage_wall_per_sqft;
      case 'attic_ceiling':
      case 'garage_ceiling':
      case 'cathedral_ceiling':
        return pricing.attic_per_sqft;
      case 'crawlspace_floor':
      case 'sound_floor':
      case 'cantilever_floor':
      case 'rim_joist':
        return pricing.floor_per_sqft;
      default:
        return pricing.wall_per_sqft;
    }
  };

  return summary.areas
    .filter((area) => area.sqft > 0 || (area.lf ?? 0) > 0)
    .map((area) => ({
      id: area.id,
      name: area.label,
      description: area.description,
      sqft: area.id === 'rim_joist' ? Math.round(area.lf ?? area.sqft) : area.sqft,
      unit: area.id === 'rim_joist' ? 'LF' : 'SF',
      enabled: true,
      pricePerSqft: getUnitPrice(area.id),
    }));
}
