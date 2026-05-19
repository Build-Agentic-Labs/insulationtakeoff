import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  TakeoffSession,
  Trace,
  TraceClassification,
  Calibration,
  CalibrationPoint,
  PdfPoint,
  PageScore,
  AssemblyScope,
  MeasurementBasis,
  Opening,
  OpeningType,
  OpeningScanMarker,
  WindowCatalogItem,
  DoorCatalogItem,
  ZoneType,
} from '@/lib/types/takeoff';
import {
  pdfDistance,
  calibratedLength,
  traceTotalLf,
  traceAreaSf,
  openingAreaSf,
  deriveZoneStatus,
  normalizeZoneType,
} from '@/lib/types/takeoff';
import {
  ensureTakeoffSessionWorkspace,
  syncWorkspaceObjectsFromTraceData,
} from '@/lib/takeoff/workspace-v2';
import {
  getSurfacePreset,
  getSurfacePresetByScope,
  getWallPreset,
  getWallPresetByScope,
  type DrawingPreset,
  type SurfacePresetKey,
  type WallPresetKey,
} from '@/lib/takeoff/presets';
import { buildWallRunSuggestionsForView } from '@/lib/takeoff/zone-classifier';
import type {
  Surface as TakeoffSurface,
  WallRun,
  Zone as TakeoffZone,
} from '@/lib/types/takeoff-v2';

// ── Tool modes ───────────────────────────────────────────────────────────────

export type ToolMode = 'pointer' | 'calibrate' | 'trace' | 'auto_detect';
export type TraceMode = 'linear' | 'area';
export type CalibrationStep = 'idle' | 'primary_a' | 'primary_b' | 'primary_input' | 'verify_a' | 'verify_b' | 'verify_input' | 'done';
export type WallFillSide = 'left' | 'right';

function syncSessionWorkspace(session: TakeoffSession): TakeoffSession {
  return syncWorkspaceObjectsFromTraceData(ensureTakeoffSessionWorkspace(session));
}

function normalizeSessionZoneTypes(session: TakeoffSession): TakeoffSession {
  const normalizedZones = (session.zones ?? []).map((zone) => {
    const nextZoneType = normalizeZoneType(zone.zoneType, zone.label);
    return {
      ...zone,
      zoneType: nextZoneType,
      status: deriveZoneStatus({
        zoneType: nextZoneType,
        defaultCeilingHeightFt: zone.defaultCeilingHeightFt ?? null,
        ceilingType: zone.ceilingType ?? 'flat',
        insulationType: zone.insulationType ?? null,
        rValue: zone.rValue ?? null,
        roofPitchRise: zone.roofPitchRise ?? null,
        roofPitchRun: zone.roofPitchRun ?? null,
      }),
    };
  });

  const zoneTypeById = new Map(normalizedZones.map((zone) => [zone.id, zone.zoneType]));
  const normalizedTraces = session.traces.map((trace) => {
    if (trace.type !== 'area' || !trace.zone) return trace;

    return {
      ...trace,
      zone: normalizeZoneType(zoneTypeById.get(trace.id) ?? trace.zone, trace.label),
    };
  });

  return {
    ...session,
    zones: normalizedZones,
    traces: normalizedTraces,
  };
}

function resolveActiveViewId(session: TakeoffSession | null, pageIndex: number): string | null {
  if (!session) return null;

  const fromViewerState = session.viewerState?.find((state) => state.pageIndex === pageIndex)?.activeViewId;
  if (fromViewerState) return fromViewerState;

  const primaryView = session.views?.find((view) => view.pageIndex === pageIndex && view.isPrimary);
  if (primaryView) return primaryView.id;

  return session.views?.find((view) => view.pageIndex === pageIndex)?.id ?? null;
}

function resolveCalibrationDismissStep(
  session: TakeoffSession | null,
  pageIndex: number,
): CalibrationStep {
  return session?.calibrations[pageIndex] ? 'done' : 'idle';
}

// ── Derived segment data (computed, never stored) ────────────────────────────

export interface DerivedSegment {
  traceId: string;
  segmentIndex: number;
  lengthFt: number;
  classification: TraceClassification | undefined;
  grossSf: number;
  openingsSf: number;
  netSf: number;
}

export interface DerivedArea {
  traceId: string;
  areaSf: number;
  perimeterLf: number;
  classification: TraceClassification | undefined;
}

// ── Store interface ──────────────────────────────────────────────────────────

interface TakeoffState {
  // Session
  session: TakeoffSession | null;
  currentStep: 'analysis' | 'page-selection' | 'zones' | 'workspace' | 'summary';

  // Page selection
  pageScores: PageScore[];
  selectedPages: number[];
  previewPageIndex: number;

  // Workspace
  activePageIndex: number;
  activeViewId: string | null;
  tool: ToolMode;
  calibrationStep: CalibrationStep;

  // In-progress calibration clicks
  calibrationPointA: PdfPoint | null;
  calibrationPointB: PdfPoint | null;

  // In-progress trace
  drawingPreset: DrawingPreset;
  wallPreset: WallPresetKey;
  activeWallFillSide: WallFillSide;
  zonePreset: ZoneType;
  surfacePreset: SurfacePresetKey;
  traceMode: TraceMode;
  activeTraceId: string | null;
  activeTracePoints: PdfPoint[]; // Points being drawn (not yet committed)

  // Selection
  selectedTraceId: string | null;
  selectedSegmentIndex: number | null;

  // Vision cache (preserved from old system for page classification)
  visionCache: Record<number, unknown[]>;
  visionLoading: Record<number, boolean>;
  openingScanMarkers: OpeningScanMarker[];

  // ── Actions: session ───────────────────────────────────────────────────────
  setSession: (session: TakeoffSession) => void;
  setStep: (step: TakeoffState['currentStep']) => void;

  // ── Actions: page selection ────────────────────────────────────────────────
  setPageScores: (scores: PageScore[]) => void;
  togglePage: (pageIndex: number) => void;
  setPreviewPage: (pageIndex: number) => void;
  confirmPageSelection: () => void;

  // ── Actions: workspace ─────────────────────────────────────────────────────
  setActivePage: (pageIndex: number) => void;
  setActiveView: (viewId: string) => void;
  duplicateActiveView: () => void;
  toggleObjectHidden: (objectId: string) => void;
  toggleObjectHiddenInView: (viewId: string, objectId: string) => void;
  setTool: (tool: ToolMode) => void;
  setMeasurementBasis: (basis: MeasurementBasis) => void;
  setDrawingPreset: (preset: DrawingPreset) => void;
  setWallPreset: (preset: WallPresetKey) => void;
  setActiveWallFillSide: (side: WallFillSide) => void;
  toggleActiveWallFillSide: () => void;
  setZonePreset: (preset: ZoneType) => void;
  setSurfacePreset: (preset: SurfacePresetKey) => void;
  updateAiSuggestionStatus: (
    suggestionId: string,
    status: 'pending' | 'accepted' | 'dismissed' | 'edited',
    appliedValue?: string,
  ) => void;
  updateZoneObject: (
    zoneId: string,
    updates: Partial<
      Pick<
        TakeoffZone,
        | 'label'
        | 'zoneType'
        | 'status'
        | 'viewId'
        | 'floorLabel'
        | 'defaultCeilingHeightFt'
        | 'ceilingType'
        | 'insulationType'
        | 'rValue'
        | 'roofPitchRise'
        | 'roofPitchRun'
        | 'roofPitchSourceText'
        | 'roofPitchConfidence'
        | 'roofPitchSource'
        | 'takeoffStatus'
      >
    > & {
      isEnvelope?: boolean;
    },
  ) => void;
  updateWallRunObject: (
    wallRunId: string,
    updates: Partial<
      Pick<
        WallRun,
        | 'label'
        | 'assemblyScope'
        | 'heightFt'
        | 'heightSource'
        | 'thicknessIn'
        | 'fillSide'
        | 'framingType'
        | 'sideAZoneId'
        | 'sideBZoneId'
        | 'reviewFlags'
        | 'viewId'
      >
    >,
  ) => void;
  updateSurfaceObject: (
    surfaceId: string,
    updates: Partial<
      Pick<
        TakeoffSurface,
        | 'label'
        | 'assemblyScope'
        | 'status'
        | 'viewId'
        | 'roofPitchRise'
        | 'roofPitchRun'
        | 'roofPitchSourceText'
        | 'roofPitchConfidence'
        | 'roofPitchSource'
      >
    >,
  ) => void;
  applyWallSuggestionsForActiveView: () => void;

  // ── Actions: calibration ───────────────────────────────────────────────────
  startCalibration: () => void;
  setCalibrationPointA: (point: PdfPoint) => void;
  setCalibrationPointB: (point: PdfPoint) => void;
  confirmPrimaryCalibration: (knownValueFt: number, dimensionText?: string) => void;
  confirmVerificationCalibration: (knownValueFt: number, dimensionText?: string) => void;
  applyScalePresetCalibration: (pdfPointsPerFoot: number, label: string) => void;
  skipVerification: () => void;
  recalibrate: () => void;

  // ── Actions: tracing ───────────────────────────────────────────────────────
  setTraceMode: (mode: TraceMode) => void;
  startTrace: (mode?: TraceMode) => void;
  addTracePoint: (point: PdfPoint) => void;
  removeLastTracePoint: () => void;
  updateActiveTracePoint: (pointIndex: number, point: PdfPoint) => void;
  finishTrace: (close?: boolean) => void;
  cancelTrace: () => void;
  continueTrace: (traceId: string) => void;
  renameTrace: (traceId: string, label: string) => void;
  setTraceZone: (traceId: string, zone: ZoneType) => void;
  setTraceEnvelope: (traceId: string, isEnvelope: boolean) => void;
  deleteTrace: (traceId: string) => void;
  deleteTraceSegment: (traceId: string, segmentIndex: number) => void;
  updateTracePoint: (traceId: string, pointIndex: number, point: PdfPoint) => void;

  // ── Actions: classification ────────────────────────────────────────────────
  setSegmentClassification: (
    traceId: string,
    segmentIndex: number,
    scope: AssemblyScope,
    heightFt?: number,
  ) => void;
  setSegmentOpenings: (traceId: string, segmentIndex: number, openings: Opening[]) => void;
  upsertWindowCatalogItem: (item: {
    widthFt: number;
    heightFt: number;
    label: string;
    tag?: string | null;
    tagNormalized?: string | null;
    room?: string | null;
    rawSize?: string | null;
    scheduleType?: string | null;
    confidence?: number;
    reviewFlags?: string[];
    source?: WindowCatalogItem['source'];
    sourceText?: string | null;
    pageIndex?: number;
  }) => { id: string; isNew: boolean } | null;
  upsertDoorCatalogItem: (item: {
    type: Exclude<OpeningType, 'window'>;
    widthFt: number;
    heightFt: number;
    label: string;
    tag?: string | null;
    tagNormalized?: string | null;
    room?: string | null;
    rawSize?: string | null;
    scheduleType?: string | null;
    confidence?: number;
    reviewFlags?: string[];
    source?: DoorCatalogItem['source'];
    sourceText?: string | null;
    designationRaw?: string | null;
    designationNormalized?: DoorCatalogItem['designationNormalized'];
    dimensionFormat?: DoorCatalogItem['dimensionFormat'];
    pageIndex?: number;
  }) => { id: string; isNew: boolean } | null;
  setBatchClassification: (
    traceId: string,
    segmentIndexes: number[],
    scope: AssemblyScope,
    heightFt?: number,
  ) => void;

  // ── Actions: selection ─────────────────────────────────────────────────────
  selectTrace: (traceId: string | null) => void;
  selectSegment: (traceId: string, segmentIndex: number) => void;
  clearSelection: () => void;
  handleEscape: () => void;

  // ── Actions: vision (kept for page classification) ─────────────────────────
  setVisionLoading: (pageIndex: number, loading: boolean) => void;
  addOpeningScanMarker: (
    marker: Omit<OpeningScanMarker, 'id'> & {
      id?: string;
    },
  ) => void;
  clearOpeningScanMarkers: () => void;

  // ── Computed ───────────────────────────────────────────────────────────────
  getCalibration: () => Calibration | undefined;
  getTracesForPage: (pageIndex: number) => Trace[];
  getVisibleTracesForPage: (pageIndex: number) => Trace[];
  getClassificationsForTrace: (traceId: string) => TraceClassification[];
  getDerivedSegments: () => DerivedSegment[];
  getDerivedAreas: () => DerivedArea[];
  getRunningTotal: () => {
    totalLf: number;
    grossSf: number;
    netSf: number;
    traceCount: number;
    segmentCount: number;
    areaCount: number;
    byScope: Record<string, { lf: number; grossSf: number; netSf: number; count: number }>;
  };
}

// ── Default classification for new segments ──────────────────────────────────

function defaultClassification(
  traceId: string,
  segmentIndex: number,
): TraceClassification {
  return {
    traceId,
    segmentIndex,
    label: `Wall ${segmentIndex + 1}`,
    assemblyScope: 'exterior_wall_2x6',
    wallHeightFt: undefined,
    openings: [],
    installMethod: 'batt_kraft',
    notes: [],
  };
}

function dedupeSequentialTracePoints(
  points: PdfPoint[],
  thresholdPts: number = 1,
): PdfPoint[] {
  return points.reduce<PdfPoint[]>((deduped, point) => {
    const previousPoint = deduped[deduped.length - 1];
    if (!previousPoint || pdfDistance(previousPoint, point) > thresholdPts) {
      deduped.push(point);
    }
    return deduped;
  }, []);
}

function reindexSegmentClassifications(
  classifications: TraceClassification[],
  sourceTraceId: string,
  nextTraceId: string,
  startSegmentIndex: number,
  endSegmentIndex: number,
  segmentOffset: number,
): TraceClassification[] {
  return classifications
    .filter(
      (classification) =>
        classification.traceId === sourceTraceId &&
        classification.segmentIndex >= startSegmentIndex &&
        classification.segmentIndex <= endSegmentIndex,
    )
    .map((classification) => ({
      ...classification,
      traceId: nextTraceId,
      segmentIndex: classification.segmentIndex - segmentOffset,
    }));
}

function isSameWindowCatalogSize(
  left: Pick<WindowCatalogItem, 'widthFt' | 'heightFt'>,
  right: Pick<WindowCatalogItem, 'widthFt' | 'heightFt'>,
  tolerance: number = 0.01,
) {
  return (
    Math.abs(left.widthFt - right.widthFt) <= tolerance &&
    Math.abs(left.heightFt - right.heightFt) <= tolerance
  );
}

function isSameWindowCatalogItem(
  left: WindowCatalogItem,
  right: Pick<WindowCatalogItem, 'widthFt' | 'heightFt' | 'tagNormalized'>,
) {
  if (left.tagNormalized && right.tagNormalized) return left.tagNormalized === right.tagNormalized;
  return isSameWindowCatalogSize(left, right);
}

function isSameDoorCatalogShape(
  left: Pick<DoorCatalogItem, 'type' | 'widthFt' | 'heightFt'>,
  right: Pick<DoorCatalogItem, 'type' | 'widthFt' | 'heightFt'>,
  tolerance: number = 0.01,
) {
  return (
    left.type === right.type &&
    Math.abs(left.widthFt - right.widthFt) <= tolerance &&
    Math.abs(left.heightFt - right.heightFt) <= tolerance
  );
}

function isSameDoorCatalogItem(
  left: DoorCatalogItem,
  right: Pick<DoorCatalogItem, 'type' | 'widthFt' | 'heightFt' | 'tagNormalized'>,
) {
  if (left.tagNormalized && right.tagNormalized) return left.tagNormalized === right.tagNormalized;
  return isSameDoorCatalogShape(left, right);
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useTakeoffStore = create<TakeoffState>((set, get) => ({
  // Initial state
  session: null,
  currentStep: 'analysis',
  pageScores: [],
  selectedPages: [],
  previewPageIndex: 0,
  activePageIndex: 0,
  activeViewId: null,
  tool: 'pointer',
  calibrationStep: 'idle',
  calibrationPointA: null,
  calibrationPointB: null,
  drawingPreset: 'wall',
  wallPreset: 'exterior_2x6',
  activeWallFillSide: 'left',
  zonePreset: 'conditioned',
  surfacePreset: 'attic_floor',
  traceMode: 'linear',
  activeTraceId: null,
  activeTracePoints: [],
  selectedTraceId: null,
  selectedSegmentIndex: null,
  visionCache: {},
  visionLoading: {},
  openingScanMarkers: [],

  // ── Session ────────────────────────────────────────────────────────────────

  setSession: (session) => set(() => {
    const nextSession = syncSessionWorkspace(normalizeSessionZoneTypes(session));
    const defaultPageIndex =
      nextSession.pageAnalysis?.find((page) => page.roles.includes('measurement'))?.pageIndex ??
      nextSession.selectedPages[0] ??
      0;
    return {
      session: nextSession,
      activePageIndex: defaultPageIndex,
      activeViewId: resolveActiveViewId(nextSession, defaultPageIndex),
      openingScanMarkers: nextSession.openingScanMarkers ?? [],
    };
  }),
  setStep: (step) => set({ currentStep: step }),

  // ── Page selection ─────────────────────────────────────────────────────────

  setPageScores: (scores) => set({
    pageScores: scores,
    selectedPages: scores
      .filter((s) => s.roles.length > 0)
      .map((s) => s.page_index),
    previewPageIndex:
      scores.find((s) => s.roles.includes('measurement'))?.page_index ??
      scores.find((s) => s.roles.length > 0)?.page_index ??
      0,
  }),

  togglePage: (pageIndex) => set((state) => {
    const selected = state.selectedPages.includes(pageIndex)
      ? state.selectedPages.filter((p) => p !== pageIndex)
      : [...state.selectedPages, pageIndex].sort((a, b) => a - b);
    return { selectedPages: selected };
  }),

  setPreviewPage: (pageIndex) => set({ previewPageIndex: pageIndex }),

  confirmPageSelection: () => set((state) => ({
    currentStep: 'zones',
    activePageIndex:
      state.pageScores.find((page) => page.roles.includes('measurement'))?.page_index ??
      state.selectedPages[0] ??
      0,
    activeViewId: resolveActiveViewId(
      state.session,
      state.pageScores.find((page) => page.roles.includes('measurement'))?.page_index ??
        state.selectedPages[0] ??
        0,
    ),
  })),

  // ── Workspace ──────────────────────────────────────────────────────────────

  setActivePage: (pageIndex) => set((state) => ({
    activePageIndex: pageIndex,
    activeViewId: resolveActiveViewId(state.session, pageIndex),
    calibrationStep: resolveCalibrationDismissStep(state.session, pageIndex),
    calibrationPointA: null,
    calibrationPointB: null,
    tool: state.tool === 'calibrate' ? 'pointer' : state.tool,
  })),

  setActiveView: (viewId) => set((state) => {
    if (!state.session) return state;

    const viewerState = (state.session.viewerState ?? []).map((viewerStateItem) =>
      viewerStateItem.pageIndex === state.activePageIndex
        ? { ...viewerStateItem, activeViewId: viewId }
        : viewerStateItem
    );

    const nextSession = syncSessionWorkspace({
      ...state.session,
      viewerState,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
      activeViewId: viewId,
    };
  }),

  duplicateActiveView: () => set((state) => {
    if (!state.session || !state.activeViewId) return state;

    const sourceView = state.session.views?.find((view) => view.id === state.activeViewId);
    if (!sourceView) return state;

    const duplicatedView = {
      ...sourceView,
      id: uuid(),
      name: `${sourceView.name} Copy`,
      isPrimary: false,
      status: 'draft' as const,
      hiddenObjectIds: [],
      ghostedViewIds: [sourceView.id],
    };

    const viewerState = (state.session.viewerState ?? []).map((viewerStateItem) =>
      viewerStateItem.pageIndex === state.activePageIndex
        ? { ...viewerStateItem, activeViewId: duplicatedView.id }
        : viewerStateItem
    );

    const nextSession = syncSessionWorkspace({
      ...state.session,
      views: [...(state.session.views ?? []), duplicatedView],
      viewerState,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
      activeViewId: duplicatedView.id,
    };
  }),

  toggleObjectHidden: (objectId) => set((state) => {
    if (!state.session || !state.activeViewId) return state;

    const nextViews = (state.session.views ?? []).map((view) => {
      if (view.id !== state.activeViewId) return view;

      const isHidden = view.hiddenObjectIds.includes(objectId);
      return {
        ...view,
        hiddenObjectIds: isHidden
          ? view.hiddenObjectIds.filter((id) => id !== objectId)
          : [...view.hiddenObjectIds, objectId],
      };
    });

    const nextSession = syncSessionWorkspace({
      ...state.session,
      views: nextViews,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
      selectedTraceId: state.selectedTraceId === objectId ? null : state.selectedTraceId,
      selectedSegmentIndex: state.selectedTraceId === objectId ? null : state.selectedSegmentIndex,
    };
  }),

  toggleObjectHiddenInView: (viewId, objectId) => set((state) => {
    if (!state.session) return state;

    const nextViews = (state.session.views ?? []).map((view) => {
      if (view.id !== viewId) return view;

      const isHidden = view.hiddenObjectIds.includes(objectId);
      return {
        ...view,
        hiddenObjectIds: isHidden
          ? view.hiddenObjectIds.filter((id) => id !== objectId)
          : [...view.hiddenObjectIds, objectId],
      };
    });

    const nextSession = syncSessionWorkspace({
      ...state.session,
      views: nextViews,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
      selectedTraceId: state.selectedTraceId === objectId ? null : state.selectedTraceId,
      selectedSegmentIndex: state.selectedTraceId === objectId ? null : state.selectedSegmentIndex,
    };
  }),

  setTool: (tool) => set((state) => {
    // Leaving trace mode should always clear the pending draft trace session.
    if (state.tool === 'trace' && tool !== 'trace') {
      return {
        tool,
        activeTracePoints: [],
        activeTraceId: null,
      };
    }
    return { tool };
  }),

  setMeasurementBasis: (basis) => set((state) => {
    if (!state.session) return state;
    const nextSession = syncSessionWorkspace({
      ...state.session,
      measurementBasis: basis,
      updatedAt: new Date().toISOString(),
    });
    return {
      session: nextSession,
    };
  }),

  setDrawingPreset: (preset) => set({
    drawingPreset: preset,
    traceMode: preset === 'wall' ? 'linear' : 'area',
  }),

  setWallPreset: (preset) => set({
    wallPreset: preset,
    drawingPreset: 'wall',
    traceMode: 'linear',
  }),

  setActiveWallFillSide: (side) => set({
    activeWallFillSide: side,
  }),

  toggleActiveWallFillSide: () => set((state) => ({
    activeWallFillSide: state.activeWallFillSide === 'left' ? 'right' : 'left',
  })),

  setZonePreset: (preset) => set({
    zonePreset: preset,
    drawingPreset: 'zone',
    traceMode: 'area',
  }),

  setSurfacePreset: (preset) => set({
    surfacePreset: preset,
    drawingPreset: 'surface',
    traceMode: 'area',
  }),

  updateAiSuggestionStatus: (suggestionId, status, appliedValue) => set((state) => {
    if (!state.session) return state;

    return {
      session: {
        ...state.session,
        aiSuggestions: (state.session.aiSuggestions ?? []).map((suggestion) =>
          suggestion.id === suggestionId
            ? {
                ...suggestion,
                status,
                appliedValue: appliedValue ?? suggestion.appliedValue,
              }
            : suggestion
        ),
        updatedAt: new Date().toISOString(),
      },
    };
  }),

  updateZoneObject: (zoneId, updates) => set((state) => {
    if (!state.session) return state;

    const targetZone = state.session.zones?.find((zone) => zone.id === zoneId);
    const resolvedZoneType = normalizeZoneType(
      updates.zoneType ?? targetZone?.zoneType,
      updates.label ?? targetZone?.label,
    );
    const nextTraces = state.session.traces.map((trace) => {
      if (trace.id === zoneId) {
        return {
          ...trace,
          label: updates.label ?? trace.label,
          zone: resolvedZoneType,
          isEnvelope: updates.isEnvelope ?? trace.isEnvelope,
        };
      }

      if (
        updates.isEnvelope &&
        targetZone &&
        trace.pageIndex === targetZone.pageIndex &&
        trace.isEnvelope
      ) {
        return { ...trace, isEnvelope: false };
      }

      return trace;
    });

    const nextZones = (state.session.zones ?? []).map((zone) =>
      zone.id === zoneId
        ? {
            ...zone,
            label: updates.label ?? zone.label,
            zoneType: resolvedZoneType,
            viewId: updates.viewId ?? zone.viewId,
            floorLabel:
              updates.floorLabel !== undefined ? updates.floorLabel : zone.floorLabel,
            defaultCeilingHeightFt:
              updates.defaultCeilingHeightFt !== undefined
                ? updates.defaultCeilingHeightFt
                : zone.defaultCeilingHeightFt,
            ceilingType:
              updates.ceilingType !== undefined
                ? updates.ceilingType
                : zone.ceilingType,
            insulationType:
              updates.insulationType !== undefined
                ? updates.insulationType
                : zone.insulationType,
            rValue:
              updates.rValue !== undefined
                ? updates.rValue
                : zone.rValue,
            roofPitchRise:
              updates.roofPitchRise !== undefined
                ? updates.roofPitchRise
                : zone.roofPitchRise,
            roofPitchRun:
              updates.roofPitchRun !== undefined
                ? updates.roofPitchRun
                : zone.roofPitchRun,
            roofPitchSourceText:
              updates.roofPitchSourceText !== undefined
                ? updates.roofPitchSourceText
                : zone.roofPitchSourceText,
            roofPitchConfidence:
              updates.roofPitchConfidence !== undefined
                ? updates.roofPitchConfidence
                : zone.roofPitchConfidence,
            roofPitchSource:
              updates.roofPitchSource !== undefined
                ? updates.roofPitchSource
                : zone.roofPitchSource,
            takeoffStatus:
              updates.takeoffStatus !== undefined
                ? updates.takeoffStatus
                : zone.takeoffStatus,
            status:
              updates.status ??
              deriveZoneStatus({
                zoneType: resolvedZoneType,
                defaultCeilingHeightFt:
                  updates.defaultCeilingHeightFt !== undefined
                    ? updates.defaultCeilingHeightFt
                    : zone.defaultCeilingHeightFt,
                ceilingType:
                  updates.ceilingType !== undefined
                    ? updates.ceilingType
                    : zone.ceilingType,
                insulationType:
                  updates.insulationType !== undefined
                    ? updates.insulationType
                    : zone.insulationType,
                rValue:
                  updates.rValue !== undefined
                    ? updates.rValue
                    : zone.rValue,
                roofPitchRise:
                  updates.roofPitchRise !== undefined
                    ? updates.roofPitchRise
                    : zone.roofPitchRise,
                roofPitchRun:
                  updates.roofPitchRun !== undefined
                    ? updates.roofPitchRun
                    : zone.roofPitchRun,
              }),
          }
        : zone
    );

    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces: nextTraces,
      zones: nextZones,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  updateWallRunObject: (wallRunId, updates) => set((state) => {
    if (!state.session) return state;

    const trace = state.session.traces.find((item) => item.id === wallRunId);
    if (!trace) return state;

    const segmentCount = trace.isClosed ? trace.points.length : Math.max(0, trace.points.length - 1);
    const hasExistingClassifications = state.session.classifications.some(
      (classification) => classification.traceId === wallRunId && classification.segmentIndex >= 0
    );

    const nextClassifications = state.session.classifications.map((classification) => {
      if (classification.traceId !== wallRunId || classification.segmentIndex < 0) return classification;

      return {
        ...classification,
        label: updates.label ?? classification.label,
        assemblyScope: updates.assemblyScope ?? classification.assemblyScope,
        wallHeightFt: updates.heightFt ?? classification.wallHeightFt,
      };
    });

    if (!hasExistingClassifications && segmentCount > 0) {
      const wallPreset =
        updates.assemblyScope
          ? getWallPresetByScope(updates.assemblyScope)
          : getWallPreset('exterior_2x6');

      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        nextClassifications.push({
          ...defaultClassification(wallRunId, segmentIndex),
          label: updates.label ?? wallPreset?.label ?? trace.label,
          assemblyScope: updates.assemblyScope ?? wallPreset?.scope ?? 'exterior_wall_2x6',
          wallHeightFt: updates.heightFt,
        });
      }
    }

    const nextWallRuns = (state.session.wallRuns ?? []).map((wallRun) =>
      wallRun.id === wallRunId
        ? {
            ...wallRun,
            ...updates,
            heightSource:
              updates.heightFt !== undefined
                ? updates.heightSource ?? 'manual'
                : updates.heightSource ?? wallRun.heightSource,
          }
        : wallRun
    );

    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces: state.session.traces.map((item) =>
        item.id === wallRunId ? { ...item, label: updates.label ?? item.label } : item
      ),
      classifications: nextClassifications,
      wallRuns: nextWallRuns,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  updateSurfaceObject: (surfaceId, updates) => set((state) => {
    if (!state.session) return state;

    const trace = state.session.traces.find((item) => item.id === surfaceId);
    if (!trace) return state;

    const nextClassifications = state.session.classifications.map((classification) => {
      if (classification.traceId !== surfaceId || classification.segmentIndex !== -1) return classification;

      return {
        ...classification,
        label: updates.label ?? classification.label,
        assemblyScope: updates.assemblyScope ?? classification.assemblyScope,
      };
    });

    if (!nextClassifications.some((classification) => classification.traceId === surfaceId && classification.segmentIndex === -1)) {
      nextClassifications.push({
        traceId: surfaceId,
        segmentIndex: -1,
        label: updates.label ?? trace.label,
        assemblyScope: updates.assemblyScope ?? 'attic_floor',
        wallHeightFt: undefined,
        openings: [],
        installMethod: 'blown_fiberglass',
        notes: [],
      });
    }

    const nextSurfaces = (state.session.surfaces ?? []).map((surface) =>
      surface.id === surfaceId
        ? {
            ...surface,
            ...updates,
          }
        : surface
    );

    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces: state.session.traces.map((item) =>
        item.id === surfaceId ? { ...item, label: updates.label ?? item.label } : item
      ),
      classifications: nextClassifications,
      surfaces: nextSurfaces,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  applyWallSuggestionsForActiveView: () => set((state) => {
    if (!state.session) return state;

    const suggestions = buildWallRunSuggestionsForView(
      state.session,
      state.activePageIndex,
      state.activeViewId
    );

    if (suggestions.length === 0) return state;

    const suggestionsByWallRunId = new Map(
      suggestions.map((suggestion) => [suggestion.wallRunId, suggestion])
    );

    const wallRuns = (state.session.wallRuns ?? []).map((wallRun) => {
      const suggestion = suggestionsByWallRunId.get(wallRun.id);
      if (!suggestion) return wallRun;

      return {
        ...wallRun,
        sideAZoneId: suggestion.sideAZoneId ?? wallRun.sideAZoneId,
        sideBZoneId: suggestion.sideBZoneId ?? wallRun.sideBZoneId,
        assemblyScope: suggestion.assemblyScope ?? wallRun.assemblyScope,
        confidence: {
          ...wallRun.confidence,
          zoning: Math.max(wallRun.confidence.zoning, suggestion.confidence),
          assembly: suggestion.assemblyScope
            ? Math.max(wallRun.confidence.assembly, suggestion.confidence)
            : wallRun.confidence.assembly,
        },
        reviewFlags: suggestion.reviewFlags,
      };
    });

    const classifications = state.session.classifications.map((classification) => {
      if (classification.segmentIndex < 0) return classification;
      const suggestion = suggestionsByWallRunId.get(classification.traceId);
      if (!suggestion?.assemblyScope) return classification;

      return {
        ...classification,
        assemblyScope: suggestion.assemblyScope,
      };
    });

    const nextSession = syncSessionWorkspace({
      ...state.session,
      wallRuns,
      classifications,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  // ── Calibration ────────────────────────────────────────────────────────────

  startCalibration: () => set({
    tool: 'calibrate',
    calibrationStep: 'primary_a',
    calibrationPointA: null,
    calibrationPointB: null,
  }),

  setCalibrationPointA: (point) => set({ calibrationPointA: point }),

  setCalibrationPointB: (point) => set((state) => ({
    calibrationPointB: point,
    calibrationStep: state.calibrationStep === 'primary_a' || state.calibrationStep === 'primary_b'
      ? 'primary_input'
      : 'verify_input',
  })),

  confirmPrimaryCalibration: (knownValueFt, dimensionText) => set((state) => {
    if (!state.session || !state.calibrationPointA || !state.calibrationPointB) return state;

    const dist = pdfDistance(state.calibrationPointA, state.calibrationPointB);
    const pdfPointsPerFoot = dist / knownValueFt;
    const now = new Date().toISOString();

    const primary: CalibrationPoint = {
      pointA: state.calibrationPointA,
      pointB: state.calibrationPointB,
      pdfDistance: dist,
      knownValueFt,
      dimensionText,
      timestamp: now,
    };

    const calibration: Calibration = {
      primary,
      pdfPointsPerFoot,
      confidence: 'good',
      pageIndex: state.activePageIndex,
      history: [{ pdfPointsPerFoot, timestamp: now, reason: 'initial' }],
    };

    const calibrations = {
      ...state.session.calibrations,
      [state.activePageIndex]: calibration,
    };

    return {
      session: {
        ...state.session,
        calibrations,
        status: 'tracing' as const,
        updatedAt: now,
      },
      tool: 'pointer',
      calibrationStep: 'done',
      calibrationPointA: null,
      calibrationPointB: null,
    };
  }),

  confirmVerificationCalibration: (knownValueFt, dimensionText) => set((state) => {
    if (!state.session || !state.calibrationPointA || !state.calibrationPointB) return state;

    const existing = state.session.calibrations[state.activePageIndex];
    if (!existing) return state;

    const dist = pdfDistance(state.calibrationPointA, state.calibrationPointB);
    const verifyPpf = dist / knownValueFt;
    const now = new Date().toISOString();

    const verification: CalibrationPoint = {
      pointA: state.calibrationPointA,
      pointB: state.calibrationPointB,
      pdfDistance: dist,
      knownValueFt,
      dimensionText,
      timestamp: now,
    };

    // Average the two calibrations
    const avgPpf = (existing.primary.pdfDistance / existing.primary.knownValueFt + verifyPpf) / 2;
    const variancePercent = Math.abs(
      (existing.primary.pdfDistance / existing.primary.knownValueFt - verifyPpf) /
      ((existing.primary.pdfDistance / existing.primary.knownValueFt + verifyPpf) / 2)
    ) * 100;

    const confidence: Calibration['confidence'] =
      variancePercent <= 1 ? 'high' :
      variancePercent <= 3 ? 'good' : 'low';

    const updated: Calibration = {
      ...existing,
      verification,
      pdfPointsPerFoot: avgPpf,
      confidence,
      variancePercent,
      history: [
        ...existing.history,
        { pdfPointsPerFoot: avgPpf, timestamp: now, reason: 'verification' },
      ],
    };

    return {
      session: {
        ...state.session,
        calibrations: { ...state.session.calibrations, [state.activePageIndex]: updated },
        updatedAt: now,
      },
      calibrationStep: 'done',
      calibrationPointA: null,
      calibrationPointB: null,
      tool: 'pointer',
    };
  }),

  applyScalePresetCalibration: (pdfPointsPerFoot, label) => set((state) => {
    if (!state.session || !Number.isFinite(pdfPointsPerFoot) || pdfPointsPerFoot <= 0) return state;

    const now = new Date().toISOString();
    const primary: CalibrationPoint = {
      pointA: { x: 0, y: 0 },
      pointB: { x: pdfPointsPerFoot, y: 0 },
      pdfDistance: pdfPointsPerFoot,
      knownValueFt: 1,
      dimensionText: label,
      timestamp: now,
    };

    const calibration: Calibration = {
      primary,
      pdfPointsPerFoot,
      confidence: 'good',
      pageIndex: state.activePageIndex,
      history: [{ pdfPointsPerFoot, timestamp: now, reason: `preset:${label}` }],
    };

    return {
      session: {
        ...state.session,
        calibrations: {
          ...state.session.calibrations,
          [state.activePageIndex]: calibration,
        },
        status: 'tracing' as const,
        updatedAt: now,
      },
      tool: 'pointer',
      calibrationStep: 'done',
      calibrationPointA: null,
      calibrationPointB: null,
    };
  }),

  skipVerification: () => set((state) => {
    if (!state.session) return state;
    const existing = state.session.calibrations[state.activePageIndex];
    if (!existing) return state;

    // Promote to 'good' even without verification (user chose to skip)
    const updated: Calibration = { ...existing, confidence: 'good' };

    return {
      session: {
        ...state.session,
        calibrations: { ...state.session.calibrations, [state.activePageIndex]: updated },
      },
      calibrationStep: 'done',
      calibrationPointA: null,
      calibrationPointB: null,
      tool: 'pointer',
    };
  }),

  recalibrate: () => set({
    calibrationStep: 'primary_a',
    tool: 'calibrate',
    calibrationPointA: null,
    calibrationPointB: null,
  }),

  // ── Tracing ────────────────────────────────────────────────────────────────

  setTraceMode: (mode) => set({ traceMode: mode }),

  startTrace: (mode) => set((state) => ({
    tool: 'trace',
    traceMode: mode ?? (state.drawingPreset === 'wall' ? 'linear' : 'area'),
    activeTraceId: uuid(),
    activeTracePoints: [],
    activeWallFillSide: 'left',
  })),

  addTracePoint: (point) => set((state) => ({
    activeTracePoints: [...state.activeTracePoints, point],
  })),

  removeLastTracePoint: () => set((state) => ({
    activeTracePoints: state.activeTracePoints.slice(0, -1),
  })),

  updateActiveTracePoint: (pointIndex, point) => set((state) => {
    if (pointIndex < 0 || pointIndex >= state.activeTracePoints.length) {
      return state;
    }

    return {
      activeTracePoints: state.activeTracePoints.map((existingPoint, index) =>
        index === pointIndex ? point : existingPoint,
      ),
    };
  }),

  finishTrace: (close) => set((state) => {
    if (!state.session || !state.activeTraceId) return state;

    const existingTrace = state.session.traces.find((t) => t.id === state.activeTraceId);
    const isArea = existingTrace ? existingTrace.type === 'area' : state.traceMode === 'area';
    const shouldClose = close ?? isArea; // Area traces always close; linear closes on snap
    const minPoints = isArea ? 3 : 2;
    const sanitizedPoints = dedupeSequentialTracePoints(state.activeTracePoints);
    if (sanitizedPoints.length < minPoints) {
      return {
        activeTracePoints: sanitizedPoints,
      };
    }

    // Check if this is a continued trace (has existing classifications)
    const existingClassifications = state.session.classifications.filter(
      (c) => c.traceId === state.activeTraceId
    );
    const traceNum = state.session.traces.length + 1;
    const defaultLabel = (() => {
      if (state.drawingPreset === 'zone') return `Zone ${traceNum}`;
      if (state.drawingPreset === 'surface') return getSurfacePreset(state.surfacePreset).label;
      return getWallPreset(state.wallPreset).label;
    })();

    const newTrace: Trace = {
      id: state.activeTraceId,
      pageIndex: state.activePageIndex,
      type: existingTrace?.type ?? (isArea ? 'area' : 'linear'),
      points: sanitizedPoints,
      isClosed: shouldClose, // Area traces always close; linear closes on snap-to-first
      isLocked: false,
      label: existingTrace?.label ?? defaultLabel,
      zone: existingTrace?.zone ?? (state.drawingPreset === 'zone' ? state.zonePreset : undefined),
      isEnvelope: existingTrace?.isEnvelope,
    };

    // For area traces: one classification for the whole trace (segmentIndex = -1)
    // For linear traces: one classification per segment
    const newClassifications: TraceClassification[] = [];
    if (state.drawingPreset === 'zone') {
      // Zones should inform adjacency but not contribute billable area directly.
    } else if (isArea) {
      const surfacePreset = getSurfacePreset(state.surfacePreset);
      if (!existingClassifications.some((c) => c.segmentIndex === -1)) {
        newClassifications.push({
          traceId: state.activeTraceId,
          segmentIndex: -1,
          label: surfacePreset.label,
          assemblyScope: surfacePreset.scope,
          wallHeightFt: undefined,
          openings: [],
          installMethod: 'blown_fiberglass',
          notes: [],
        });
      }
    } else {
      // Closed traces have an extra closing segment (last→first)
      const segmentCount = shouldClose
        ? sanitizedPoints.length
        : sanitizedPoints.length - 1;
      const wallPreset = getWallPreset(state.wallPreset);
      for (let i = existingClassifications.length; i < segmentCount; i++) {
        const template = existingClassifications.length > 0
          ? existingClassifications[existingClassifications.length - 1]
          : undefined;
        const cls = defaultClassification(state.activeTraceId, i);
        if (template) {
          cls.assemblyScope = template.assemblyScope;
          cls.wallHeightFt = template.wallHeightFt;
          cls.installMethod = template.installMethod;
          cls.label = template.label;
        } else {
          cls.assemblyScope = wallPreset.scope;
          cls.wallHeightFt = undefined;
          cls.label = wallPreset.label;
        }
        newClassifications.push(cls);
      }
    }

    const mergedClassifications = existingTrace
      ? [
          ...state.session.classifications.filter((classification) => classification.traceId !== newTrace.id),
          ...existingClassifications,
          ...newClassifications,
        ]
      : [...state.session.classifications, ...newClassifications];

    const syncedSession = syncSessionWorkspace({
      ...state.session,
      traces: existingTrace
        ? state.session.traces.map((trace) =>
            trace.id === newTrace.id ? newTrace : trace
          )
        : [...state.session.traces, newTrace],
      classifications: mergedClassifications,
      updatedAt: new Date().toISOString(),
    });

    const nextSession =
      state.drawingPreset === 'wall'
        ? {
            ...syncedSession,
            wallRuns: (syncedSession.wallRuns ?? []).map((wallRun) =>
              wallRun.id === newTrace.id
                ? {
                    ...wallRun,
                    fillSide: state.activeWallFillSide,
                  }
                : wallRun,
            ),
          }
        : syncedSession;

    return {
      session: nextSession,
      activeTraceId: null,
      activeTracePoints: [],
      selectedTraceId: newTrace.id,
      selectedSegmentIndex: null,
      tool: 'pointer',
    };
  }),

  continueTrace: (traceId: string) => set((state) => {
    if (!state.session) return state;
    const trace = state.session.traces.find((t) => t.id === traceId);
    if (!trace || trace.isLocked) return state;

    const traceClassifications = state.session.classifications
      .filter((classification) => classification.traceId === traceId)
      .sort((a, b) => a.segmentIndex - b.segmentIndex);
    const primaryClassification =
      trace.type === 'area'
        ? traceClassifications.find((classification) => classification.segmentIndex === -1)
        : traceClassifications[0];
    const wallPreset = getWallPresetByScope(primaryClassification?.assemblyScope);
    const surfacePreset = getSurfacePresetByScope(primaryClassification?.assemblyScope);
    const drawingPreset: DrawingPreset =
      trace.zone ? 'zone' : trace.type === 'area' ? 'surface' : 'wall';

    return {
      tool: 'trace' as const,
      traceMode: trace.type,
      drawingPreset,
      wallPreset: wallPreset?.key ?? state.wallPreset,
      activeWallFillSide:
        (state.session.wallRuns ?? []).find((wallRun) => wallRun.id === traceId)?.fillSide ?? 'left',
      surfacePreset: surfacePreset?.key ?? state.surfacePreset,
      zonePreset: trace.zone ?? state.zonePreset,
      activeTraceId: trace.id,
      activeTracePoints: [...trace.points],
      selectedTraceId: null,
      selectedSegmentIndex: null,
    };
  }),

  cancelTrace: () => set((state) => ({
    activeTraceId: state.tool === 'trace' ? uuid() : null,
    activeTracePoints: [],
    selectedTraceId: null,
    selectedSegmentIndex: null,
  })),

  renameTrace: (traceId, label) => set((state) => {
    if (!state.session) return state;
    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces: state.session.traces.map((t) =>
        t.id === traceId
          ? {
              ...t,
              label,
              zone: t.type === 'area' && t.zone ? normalizeZoneType(t.zone, label) : t.zone,
            }
          : t
      ),
      updatedAt: new Date().toISOString(),
    });
    return {
      session: nextSession,
    };
  }),

  setTraceZone: (traceId, zone) => set((state) => {
    if (!state.session) return state;
    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces: state.session.traces.map((t) =>
        t.id === traceId ? { ...t, zone: normalizeZoneType(zone, t.label) } : t
      ),
      updatedAt: new Date().toISOString(),
    });
    return {
      session: nextSession,
    };
  }),

  setTraceEnvelope: (traceId, isEnvelope) => set((state) => {
    if (!state.session) return state;
    const nextSession = syncSessionWorkspace({
      ...state.session,
      // Only one trace can be the envelope per page — clear others
      traces: state.session.traces.map((t) => {
        if (t.id === traceId) return { ...t, isEnvelope };
        if (isEnvelope && t.pageIndex === state.activePageIndex) return { ...t, isEnvelope: false };
        return t;
      }),
      updatedAt: new Date().toISOString(),
    });
    return {
      session: nextSession,
    };
  }),

  deleteTrace: (traceId) => set((state) => {
    if (!state.session) return state;
    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces: state.session.traces.filter((t) => t.id !== traceId),
      classifications: state.session.classifications.filter((c) => c.traceId !== traceId),
      updatedAt: new Date().toISOString(),
    });
    return {
      session: nextSession,
      selectedTraceId: state.selectedTraceId === traceId ? null : state.selectedTraceId,
      selectedSegmentIndex: state.selectedTraceId === traceId ? null : state.selectedSegmentIndex,
    };
  }),

  deleteTraceSegment: (traceId, segmentIndex) => set((state) => {
    if (!state.session) return state;

    const trace = state.session.traces.find((candidate) => candidate.id === traceId);
    if (!trace || trace.type !== 'linear' || trace.isClosed) {
      return state;
    }

    const maxSegmentIndex = trace.points.length - 2;
    if (segmentIndex < 0 || segmentIndex > maxSegmentIndex) {
      return state;
    }

    const leftPoints = trace.points.slice(0, segmentIndex + 1);
    const rightPoints = trace.points.slice(segmentIndex + 1);
    const nextTraces = state.session.traces.filter((candidate) => candidate.id !== traceId);
    const nextClassifications = state.session.classifications.filter(
      (classification) => classification.traceId !== traceId,
    );
    const traceClassifications = state.session.classifications.filter(
      (classification) => classification.traceId === traceId && classification.segmentIndex >= 0,
    );
    const existingWallRun = (state.session.wallRuns ?? []).find((wallRun) => wallRun.id === traceId);

    const leftTrace =
      leftPoints.length >= 2
        ? {
            ...trace,
            points: leftPoints,
          }
        : null;
    const rightTraceId = uuid();
    const rightTrace =
      rightPoints.length >= 2
        ? {
            ...trace,
            id: rightTraceId,
            points: rightPoints,
          }
        : null;

    if (leftTrace) {
      nextTraces.push(leftTrace);
      nextClassifications.push(
        ...reindexSegmentClassifications(
          traceClassifications,
          traceId,
          leftTrace.id,
          0,
          segmentIndex - 1,
          0,
        ),
      );
    }

    if (rightTrace) {
      nextTraces.push(rightTrace);
      nextClassifications.push(
        ...reindexSegmentClassifications(
          traceClassifications,
          traceId,
          rightTrace.id,
          segmentIndex + 1,
          maxSegmentIndex,
          segmentIndex + 1,
        ),
      );
    }

    const syncedSession = syncSessionWorkspace({
      ...state.session,
      traces: nextTraces,
      classifications: nextClassifications,
      updatedAt: new Date().toISOString(),
    });

    const nextSession =
      existingWallRun
        ? {
            ...syncedSession,
            wallRuns: (syncedSession.wallRuns ?? []).map((wallRun) =>
              wallRun.id === leftTrace?.id || wallRun.id === rightTrace?.id
                ? {
                    ...wallRun,
                    thicknessIn: existingWallRun.thicknessIn,
                    fillSide: existingWallRun.fillSide,
                    framingType: existingWallRun.framingType,
                    sideAZoneId: existingWallRun.sideAZoneId,
                    sideBZoneId: existingWallRun.sideBZoneId,
                  }
                : wallRun,
            ),
          }
        : syncedSession;

    return {
      session: nextSession,
      selectedTraceId: leftTrace?.id ?? rightTrace?.id ?? null,
      selectedSegmentIndex: null,
    };
  }),

  updateTracePoint: (traceId, pointIndex, point) => set((state) => {
    if (!state.session) return state;

    const trace = state.session.traces.find((candidate) => candidate.id === traceId);
    if (!trace || pointIndex < 0 || pointIndex >= trace.points.length) {
      return state;
    }

    const traces = state.session.traces.map((candidate) =>
      candidate.id === traceId
        ? {
            ...candidate,
            points: candidate.points.map((existingPoint, index) =>
              index === pointIndex ? point : existingPoint,
            ),
          }
        : candidate,
    );

    const nextSession = syncSessionWorkspace({
      ...state.session,
      traces,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
      selectedTraceId: traceId,
      selectedSegmentIndex: null,
    };
  }),

  // ── Classification ─────────────────────────────────────────────────────────

  setSegmentClassification: (traceId, segmentIndex, scope, heightFt) => set((state) => {
    if (!state.session) return state;

    const classifications = state.session.classifications.map((c) => {
      if (c.traceId !== traceId || c.segmentIndex !== segmentIndex) return c;
      return {
        ...c,
        assemblyScope: scope,
        wallHeightFt: heightFt ?? c.wallHeightFt,
      };
    });
    const nextSession = syncSessionWorkspace({
      ...state.session,
      classifications,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  setSegmentOpenings: (traceId, segmentIndex, openings) => set((state) => {
    if (!state.session) return state;

    const classifications = state.session.classifications.map((c) => {
      if (c.traceId !== traceId || c.segmentIndex !== segmentIndex) return c;
      return { ...c, openings };
    });
    const nextSession = syncSessionWorkspace({
      ...state.session,
      classifications,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  upsertWindowCatalogItem: (item) => {
    let result: { id: string; isNew: boolean } | null = null;

    set((state) => {
      if (!state.session) return state;

      const now = new Date().toISOString();
      const existing = (state.session.windowCatalog ?? []).find((catalogItem) =>
        isSameWindowCatalogItem(catalogItem, item),
      );

      const windowCatalog = existing
        ? (state.session.windowCatalog ?? []).map((catalogItem) =>
            catalogItem.id === existing.id
              ? {
                  ...catalogItem,
                  label: item.label,
                  tag: item.tag ?? catalogItem.tag ?? null,
                  tagNormalized: item.tagNormalized ?? catalogItem.tagNormalized ?? null,
                  room: item.room ?? catalogItem.room ?? null,
                  rawSize: item.rawSize ?? catalogItem.rawSize ?? null,
                  scheduleType: item.scheduleType ?? catalogItem.scheduleType ?? null,
                  confidence: item.confidence ?? catalogItem.confidence,
                  reviewFlags: item.reviewFlags ?? catalogItem.reviewFlags,
                  source: item.source ?? catalogItem.source ?? null,
                  sourceText: item.sourceText ?? catalogItem.sourceText ?? null,
                  pageIndex: item.pageIndex ?? catalogItem.pageIndex,
                  captureCount: catalogItem.captureCount + 1,
                  updatedAt: now,
                }
              : catalogItem,
          )
        : [
            ...(state.session.windowCatalog ?? []),
            {
              id: uuid(),
              widthFt: item.widthFt,
              heightFt: item.heightFt,
              areaSf: item.widthFt * item.heightFt,
              label: item.label,
              tag: item.tag ?? null,
              tagNormalized: item.tagNormalized ?? null,
              room: item.room ?? null,
              rawSize: item.rawSize ?? null,
              scheduleType: item.scheduleType ?? null,
              confidence: item.confidence,
              reviewFlags: item.reviewFlags,
              source: item.source ?? null,
              sourceText: item.sourceText ?? null,
              pageIndex: item.pageIndex,
              captureCount: 1,
              createdAt: now,
              updatedAt: now,
            } satisfies WindowCatalogItem,
          ];

      const selectedItem = existing
        ? windowCatalog.find((catalogItem) => catalogItem.id === existing.id) ?? null
        : windowCatalog[windowCatalog.length - 1] ?? null;

      result = selectedItem
        ? { id: selectedItem.id, isNew: !existing }
        : null;

      return {
        session: syncSessionWorkspace({
          ...state.session,
          windowCatalog,
          updatedAt: now,
        }),
      };
    });

    return result;
  },

  upsertDoorCatalogItem: (item) => {
    let result: { id: string; isNew: boolean } | null = null;

    set((state) => {
      if (!state.session) return state;

      const now = new Date().toISOString();
      const existing = (state.session.doorCatalog ?? []).find((catalogItem) =>
        isSameDoorCatalogItem(catalogItem, item),
      );

      const doorCatalog = existing
        ? (state.session.doorCatalog ?? []).map((catalogItem) =>
            catalogItem.id === existing.id
              ? {
                  ...catalogItem,
                  label: item.label,
                  tag: item.tag ?? catalogItem.tag ?? null,
                  tagNormalized: item.tagNormalized ?? catalogItem.tagNormalized ?? null,
                  room: item.room ?? catalogItem.room ?? null,
                  rawSize: item.rawSize ?? catalogItem.rawSize ?? null,
                  scheduleType: item.scheduleType ?? catalogItem.scheduleType ?? null,
                  confidence: item.confidence ?? catalogItem.confidence,
                  reviewFlags: item.reviewFlags ?? catalogItem.reviewFlags,
                  source: item.source ?? catalogItem.source ?? null,
                  sourceText: item.sourceText ?? catalogItem.sourceText ?? null,
                  designationRaw: item.designationRaw ?? catalogItem.designationRaw ?? null,
                  designationNormalized:
                    item.designationNormalized ?? catalogItem.designationNormalized ?? null,
                  dimensionFormat: item.dimensionFormat ?? catalogItem.dimensionFormat ?? null,
                  pageIndex: item.pageIndex ?? catalogItem.pageIndex,
                  captureCount: catalogItem.captureCount + 1,
                  updatedAt: now,
                }
              : catalogItem,
          )
        : [
            ...(state.session.doorCatalog ?? []),
            {
              id: uuid(),
              type: item.type,
              widthFt: item.widthFt,
              heightFt: item.heightFt,
              areaSf: item.widthFt * item.heightFt,
              label: item.label,
              tag: item.tag ?? null,
              tagNormalized: item.tagNormalized ?? null,
              room: item.room ?? null,
              rawSize: item.rawSize ?? null,
              scheduleType: item.scheduleType ?? null,
              confidence: item.confidence,
              reviewFlags: item.reviewFlags,
              source: item.source ?? null,
              sourceText: item.sourceText ?? null,
              designationRaw: item.designationRaw ?? null,
              designationNormalized: item.designationNormalized ?? null,
              dimensionFormat: item.dimensionFormat ?? null,
              pageIndex: item.pageIndex,
              captureCount: 1,
              createdAt: now,
              updatedAt: now,
            } satisfies DoorCatalogItem,
          ];

      const selectedItem = existing
        ? doorCatalog.find((catalogItem) => catalogItem.id === existing.id) ?? null
        : doorCatalog[doorCatalog.length - 1] ?? null;

      result = selectedItem ? { id: selectedItem.id, isNew: !existing } : null;

      return {
        session: syncSessionWorkspace({
          ...state.session,
          doorCatalog,
          updatedAt: now,
        }),
      };
    });

    return result;
  },

  setBatchClassification: (traceId, segmentIndexes, scope, heightFt) => set((state) => {
    if (!state.session) return state;

    const indexSet = new Set(segmentIndexes);
    const classifications = state.session.classifications.map((c) => {
      if (c.traceId !== traceId || !indexSet.has(c.segmentIndex)) return c;
      return {
        ...c,
        assemblyScope: scope,
        wallHeightFt: heightFt ?? c.wallHeightFt,
      };
    });
    const nextSession = syncSessionWorkspace({
      ...state.session,
      classifications,
      updatedAt: new Date().toISOString(),
    });

    return {
      session: nextSession,
    };
  }),

  // ── Selection ──────────────────────────────────────────────────────────────

  selectTrace: (traceId) => set({
    selectedTraceId: traceId,
    selectedSegmentIndex: null,
  }),

  selectSegment: (traceId, segmentIndex) => set({
    selectedTraceId: traceId,
    selectedSegmentIndex: segmentIndex,
  }),

  clearSelection: () => set({
    selectedTraceId: null,
    selectedSegmentIndex: null,
  }),

  handleEscape: () => set((state) => {
    const calibrationActive =
      state.calibrationStep !== 'idle' && state.calibrationStep !== 'done';

    if (state.tool === 'trace') {
      return {
        tool: 'pointer' as const,
        activeTraceId: null,
        activeTracePoints: [],
        selectedTraceId: null,
        selectedSegmentIndex: null,
      };
    }

    if (calibrationActive || state.tool === 'calibrate') {
      return {
        tool: 'pointer' as const,
        calibrationStep: resolveCalibrationDismissStep(state.session, state.activePageIndex),
        calibrationPointA: null,
        calibrationPointB: null,
      };
    }

    if (state.tool === 'auto_detect') {
      return {
        tool: 'pointer' as const,
      };
    }

    if (state.selectedTraceId !== null || state.selectedSegmentIndex !== null) {
      return {
        selectedTraceId: null,
        selectedSegmentIndex: null,
      };
    }

    if (state.tool !== 'pointer') {
      return {
        tool: 'pointer' as const,
      };
    }

    return state;
  }),

  // ── Vision (kept for page classification) ──────────────────────────────────

  setVisionLoading: (pageIndex, loading) => set((state) => ({
    visionLoading: { ...state.visionLoading, [pageIndex]: loading },
  })),
  addOpeningScanMarker: (marker) => set((state) => {
    const nextMarker = {
      id: marker.id ?? uuid(),
      openingType: marker.openingType,
      pageIndex: marker.pageIndex,
      wallRunId: marker.wallRunId,
      point: marker.point,
    };
    const nextMarkers = [...state.openingScanMarkers, nextMarker];

    return {
      openingScanMarkers: nextMarkers,
      session: state.session
        ? {
            ...state.session,
            openingScanMarkers: nextMarkers,
          }
        : state.session,
    };
  }),
  clearOpeningScanMarkers: () =>
    set((state) => ({
      openingScanMarkers: [],
      session: state.session
        ? {
            ...state.session,
            openingScanMarkers: [],
          }
        : state.session,
    })),

  // ── Computed ───────────────────────────────────────────────────────────────

  getCalibration: () => {
    const { session, activePageIndex } = get();
    return session?.calibrations[activePageIndex];
  },

  getTracesForPage: (pageIndex) => {
    const session = get().session;
    if (!session) return [];
    return session.traces.filter((t) => t.pageIndex === pageIndex);
  },

  getVisibleTracesForPage: (pageIndex) => {
    const { session, activeViewId } = get();
    if (!session) return [];

    const tracesForPage = session.traces.filter((trace) => trace.pageIndex === pageIndex);
    if (!activeViewId) return tracesForPage;

    const zoneIds = new Set(
      (session.zones ?? [])
        .filter((zone) => zone.pageIndex === pageIndex && zone.viewId === activeViewId)
        .map((zone) => zone.id)
    );
    const wallRunIds = new Set(
      (session.wallRuns ?? [])
        .filter((wallRun) => wallRun.pageIndex === pageIndex && wallRun.viewId === activeViewId)
        .map((wallRun) => wallRun.id)
    );
    const surfaceIds = new Set(
      (session.surfaces ?? [])
        .filter((surface) => surface.pageIndex === pageIndex && surface.viewId === activeViewId)
        .map((surface) => surface.id)
    );
    const hiddenObjectIds = new Set(
      (session.views ?? []).find((view) => view.id === activeViewId)?.hiddenObjectIds ?? []
    );

    return tracesForPage.filter((trace) =>
      !hiddenObjectIds.has(trace.id) &&
      (zoneIds.has(trace.id) || wallRunIds.has(trace.id) || surfaceIds.has(trace.id))
    );
  },

  getClassificationsForTrace: (traceId) => {
    const session = get().session;
    if (!session) return [];
    return session.classifications
      .filter((c) => c.traceId === traceId)
      .sort((a, b) => a.segmentIndex - b.segmentIndex);
  },

  getDerivedSegments: () => {
    const { session, activePageIndex } = get();
    if (!session) return [];

    const cal = session.calibrations[activePageIndex];
    if (!cal) return [];

    // Only linear traces have per-segment data
    const traces = get().getVisibleTracesForPage(activePageIndex).filter((t) => t.type === 'linear');
    const segments: DerivedSegment[] = [];

    for (const trace of traces) {
      // Closed traces have an extra closing segment (last→first)
      const segCount = trace.isClosed ? trace.points.length : trace.points.length - 1;
      for (let i = 0; i < segCount; i++) {
        const classification = session.classifications.find(
          (c) => c.traceId === trace.id && c.segmentIndex === i
        );
        // For closing segment, use last→first point distance
        const isClosingSegment = trace.isClosed && i === trace.points.length - 1;
        const ptA = trace.points[i];
        const ptB = isClosingSegment ? trace.points[0] : trace.points[i + 1];
        const lengthFt = calibratedLength(ptA, ptB, cal);
        const heightFt = classification?.wallHeightFt ?? 0;
        const grossSf = lengthFt * heightFt;
        const openingsSf = (classification?.openings ?? []).reduce(
          (sum, o) => sum + openingAreaSf(o), 0
        );

        segments.push({
          traceId: trace.id,
          segmentIndex: i,
          lengthFt,
          classification,
          grossSf,
          openingsSf,
          netSf: Math.max(0, grossSf - openingsSf),
        });
      }
    }

    return segments;
  },

  getDerivedAreas: () => {
    const { session, activePageIndex } = get();
    if (!session) return [];

    const cal = session.calibrations[activePageIndex];
    if (!cal) return [];

    const traces = get()
      .getVisibleTracesForPage(activePageIndex)
      .filter((t) => t.type === 'area' && !t.zone);
    const areas: DerivedArea[] = [];

    for (const trace of traces) {
      const classification = session.classifications.find(
        (c) => c.traceId === trace.id && c.segmentIndex === -1
      );
      areas.push({
        traceId: trace.id,
        areaSf: traceAreaSf(trace, cal),
        perimeterLf: traceTotalLf(trace, cal),
        classification,
      });
    }

    return areas;
  },

  getRunningTotal: () => {
    const segments = get().getDerivedSegments();
    const areas = get().getDerivedAreas();

    const byScope: Record<string, { lf: number; grossSf: number; netSf: number; count: number }> = {};

    let totalLf = 0;
    let grossSf = 0;
    let netSf = 0;

    // Linear segments
    for (const seg of segments) {
      totalLf += seg.lengthFt;
      grossSf += seg.grossSf;
      netSf += seg.netSf;

      const scopeKey = seg.classification
        ? `${seg.classification.assemblyScope}_${seg.classification.wallHeightFt ?? 0}`
        : 'unclassified_0';

      if (!byScope[scopeKey]) {
        byScope[scopeKey] = { lf: 0, grossSf: 0, netSf: 0, count: 0 };
      }
      byScope[scopeKey].lf += seg.lengthFt;
      byScope[scopeKey].grossSf += seg.grossSf;
      byScope[scopeKey].netSf += seg.netSf;
      byScope[scopeKey].count += 1;
    }

    // Area traces
    for (const area of areas) {
      grossSf += area.areaSf;
      netSf += area.areaSf;

      const scopeKey = area.classification
        ? `${area.classification.assemblyScope}_0`
        : 'unclassified_0';

      if (!byScope[scopeKey]) {
        byScope[scopeKey] = { lf: 0, grossSf: 0, netSf: 0, count: 0 };
      }
      byScope[scopeKey].grossSf += area.areaSf;
      byScope[scopeKey].netSf += area.areaSf;
      byScope[scopeKey].count += 1;
    }

    const session = get().session;
    const pageTraces = session?.traces.filter(
      (t) => t.pageIndex === get().activePageIndex
    ) ?? [];

    return {
      totalLf,
      grossSf,
      netSf,
      traceCount: pageTraces.length,
      segmentCount: segments.length,
      areaCount: areas.length,
      byScope,
    };
  },
}));
