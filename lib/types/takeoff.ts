import type {
  AiSuggestion,
  CompletionChecklistItem,
  OpeningItemRecord,
  PageAnalysis,
  SourcePageViewState,
  Surface,
  TakeoffView,
  WallRun,
  WorkspaceSummary,
  Zone,
} from './takeoff-v2';
import type { EstimateWorksheetRow } from '@/lib/quotes/estimate';

// ── Coordinate primitives ────────────────────────────────────────────────────

/** Point in PDF-space (72 DPI points, origin = bottom-left of page) */
export interface PdfPoint {
  x: number;
  y: number;
}

// ── Enums / unions ───────────────────────────────────────────────────────────

export type MeasurementBasis =
  | 'exterior_face'
  | 'interior_face'
  | 'stud_line'
  | 'centerline'
  | 'sheathing_line';

export type AssemblyScope =
  | 'exterior_wall_2x6'
  | 'exterior_wall_2x4'
  | 'garage_wall'
  | 'basement_wall'
  | 'knee_wall'
  | 'attic_floor'
  | 'crawlspace_floor'
  | 'garage_ceiling'
  | 'sound_floor'
  | 'rim_joist'
  | 'cathedral_ceiling'
  | 'cantilever_floor';

export type InstallMethod =
  | 'batt_kraft'
  | 'batt_unfaced'
  | 'blown_fiberglass'
  | 'blown_cellulose'
  | 'spray_foam_open'
  | 'spray_foam_closed'
  | 'rigid_board'
  | 'dense_pack';

export type CalibrationConfidence = 'high' | 'good' | 'low';
export type SessionStatus =
  | 'calibrating'
  | 'tracing'
  | 'reviewing'
  | 'completed'
  | 'abandoned';

export type PageRole = 'measurement' | 'evidence';
export type PageTakeoffRelevance =
  | 'primary_measurement'
  | 'supporting_evidence'
  | 'low_value';

export interface PageScanFlags {
  sheet_index_revisions_scale: boolean;
  general_insulation_notes: boolean;
  wall_type_legend: boolean;
  exterior_wall_details: boolean;
  interior_wall_details: boolean;
  roof_ceiling_details: boolean;
  roof_pitch: boolean;
  floor_foundation_details: boolean;
  enlarged_sections: boolean;
  insulated_area_plan_views: boolean;
  dimensions: boolean;
  height_references: boolean;
  opening_info: boolean;
  room_names: boolean;
  material_specs: boolean;
  vapor_barrier: boolean;
  air_barrier: boolean;
  baffles_or_venting: boolean;
  symbols_and_keynotes: boolean;
  alternates_or_conflicts: boolean;
}

export interface PageStopFlags {
  missing_assembly_definition: boolean;
  missing_dimensions_or_heights: boolean;
  missing_opening_identification: boolean;
  conflicting_specs: boolean;
  missing_unusual_condition_details: boolean;
}

export interface PageScanExtracts {
  window_sizes: string[];
  opening_quantity_notes: string[];
  opening_evidence?: OpeningEvidenceLevel;
  opening_schedule_items?: OpeningScheduleItem[];
  insulation_types: string[];
  r_values: string[];
  roof_pitches: string[];
  vapor_barriers: string[];
  air_barriers: string[];
  baffles_or_venting: string[];
  wall_framing?: string[];
  zone_hints?: Partial<
    Record<
      'exterior' | 'interior' | 'attic' | 'crawlspace',
      {
        r_values?: string[];
        r_value_details?: string[];
        insulation_types?: string[];
        wall_framing?: string[];
        roof_pitches?: string[];
        vapor_barriers?: string[];
        air_barriers?: string[];
        baffles_or_venting?: string[];
        notes?: string[];
      }
    >
  >;
}

// ── Calibration ──────────────────────────────────────────────────────────────

export interface CalibrationPoint {
  pointA: PdfPoint;
  pointB: PdfPoint;
  pdfDistance: number;
  knownValueFt: number;
  dimensionText?: string;
  timestamp: string;
}

export interface Calibration {
  primary: CalibrationPoint;
  verification?: CalibrationPoint;
  pdfPointsPerFoot: number;
  confidence: CalibrationConfidence;
  variancePercent?: number;
  pageIndex: number;
  history: Array<{
    pdfPointsPerFoot: number;
    timestamp: string;
    reason: string;
  }>;
}

// ── Openings ─────────────────────────────────────────────────────────────────

export type OpeningType =
  | 'door'
  | 'window'
  | 'garage_door'
  | 'sliding_door'
  | 'french_door'
  | 'door_opening';

export type OpeningEvidenceLevel =
  | 'direct_dimensions'
  | 'tags_only'
  | 'unlabeled'
  | 'no_opening_evidence';

export type OpeningScheduleKind = 'window' | 'door';

export interface OpeningScheduleItem {
  id?: string;
  openingType: OpeningScheduleKind;
  tag: string;
  tagNormalized: string;
  room?: string | null;
  rawSize: string;
  widthFt: number | null;
  heightFt: number | null;
  areaSf: number | null;
  scheduleType?: string | null;
  sourcePageIndex?: number;
  confidence: number;
  reviewFlags: string[];
  rawText?: string | null;
}

export type DoorDesignationNormalized =
  | 'entry'
  | 'swing'
  | 'french'
  | 'pair_double'
  | 'sliding'
  | 'multi_slide'
  | 'garage_overhead'
  | 'rollup'
  | 'barn'
  | 'pocket'
  | 'bifold'
  | 'cased_opening'
  | 'service_man_door'
  | 'unknown';

export type DoorDimensionFormat =
  | 'compact_code'
  | 'leaf_pair_compact'
  | 'slash_pair'
  | 'feet_inches_pair'
  | 'dash_pair'
  | 'feet_only_pair'
  | 'width_only_compact'
  | 'width_only_slash'
  | 'width_only_feet_inches'
  | 'width_only_dash'
  | 'width_only_feet_only'
  | 'unknown';

export interface Opening {
  id: string;
  type: OpeningType;
  width_ft: number;
  height_ft: number;
  quantity: number;
  label?: string;
}

export interface WindowCatalogItem {
  id: string;
  widthFt: number;
  heightFt: number;
  areaSf: number;
  label: string;
  tag?: string | null;
  tagNormalized?: string | null;
  room?: string | null;
  rawSize?: string | null;
  scheduleType?: string | null;
  confidence?: number;
  reviewFlags?: string[];
  source?: 'manual_scan' | 'vision_schedule' | null;
  sourceText?: string | null;
  pageIndex?: number;
  captureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DoorCatalogItem {
  id: string;
  type: Exclude<OpeningType, 'window'>;
  widthFt: number;
  heightFt: number;
  areaSf: number;
  label: string;
  tag?: string | null;
  tagNormalized?: string | null;
  room?: string | null;
  rawSize?: string | null;
  scheduleType?: string | null;
  confidence?: number;
  reviewFlags?: string[];
  source?: 'manual_scan' | 'vision_schedule' | null;
  sourceText?: string | null;
  designationRaw?: string | null;
  designationNormalized?: DoorDesignationNormalized | null;
  dimensionFormat?: DoorDimensionFormat | null;
  pageIndex?: number;
  captureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpeningScanMarker {
  id: string;
  openingType: OpeningType;
  pageIndex: number;
  wallRunId: string;
  point: PdfPoint;
}

/** Presets for quick-add openings */
export const OPENING_PRESETS: Record<OpeningType, { width_ft: number; height_ft: number }> = {
  door:         { width_ft: 3.0,  height_ft: 6.67 },
  window:       { width_ft: 3.0,  height_ft: 4.0  },
  garage_door:  { width_ft: 16.0, height_ft: 7.0  },
  sliding_door: { width_ft: 6.0,  height_ft: 6.67 },
  french_door:  { width_ft: 6.0,  height_ft: 6.67 },
  door_opening: { width_ft: 3.0,  height_ft: 6.67 },
};

// ── Zones ────────────────────────────────────────────────────────────────────

export type ZoneType =
  | 'conditioned'              // Heated/cooled living space (default)
  | 'unconditioned_garage'     // Garage (not heated)
  | 'unconditioned_storage'    // Unfinished storage, mechanical room
  | 'unconditioned_crawl'      // Crawlspace
  | 'unconditioned_attic'      // Attic space
  | 'outside';                 // Exterior (implicit — everything outside envelope)

export type ZoneCeilingType = 'flat' | 'vaulted';

export const ZONE_LABELS: Record<ZoneType, string> = {
  conditioned: 'Living / Heated Area',
  unconditioned_garage: 'Garage / Shared Wall',
  unconditioned_storage: 'Storage / Manual Review',
  unconditioned_crawl: 'Crawlspace / Floor Insulation',
  unconditioned_attic: 'Attic / Ceiling Insulation',
  outside: 'Outside',
};

export const ZONE_COLORS: Record<ZoneType, { fill: string; stroke: string }> = {
  conditioned:              { fill: '#22c55e', stroke: '#16a34a' },  // green
  unconditioned_garage:     { fill: '#f97316', stroke: '#ea580c' },  // orange
  unconditioned_storage:    { fill: '#eab308', stroke: '#ca8a04' },  // yellow
  unconditioned_crawl:      { fill: '#ef4444', stroke: '#dc2626' },  // red
  unconditioned_attic:      { fill: '#a855f7', stroke: '#9333ea' },  // purple
  outside:                  { fill: '#94a3b8', stroke: '#64748b' },  // gray
};

export function inferZoneTypeFromLabel(label?: string | null): ZoneType | null {
  const normalized = label?.trim().toLowerCase() ?? '';
  if (!normalized) return null;

  if (normalized.includes('crawl')) return 'unconditioned_crawl';
  if (normalized.includes('attic')) return 'unconditioned_attic';
  if (normalized.includes('garage')) return 'unconditioned_garage';
  if (normalized.includes('storage')) return 'unconditioned_storage';
  if (normalized.includes('exterior') || normalized.includes('interior') || normalized.includes('conditioned')) {
    return 'conditioned';
  }

  return null;
}

export function normalizeZoneType(zoneType: ZoneType | null | undefined, label?: string | null): ZoneType {
  return inferZoneTypeFromLabel(label) ?? zoneType ?? 'conditioned';
}

/** Returns true if the zone is NOT heated/cooled */
export function isUnconditioned(zone: ZoneType): boolean {
  return zone !== 'conditioned';
}

export interface ZoneReadinessInput {
  zoneType: ZoneType;
  defaultCeilingHeightFt?: number | null;
  ceilingType?: ZoneCeilingType | null;
  insulationType?: string | null;
  rValue?: string | null;
  roofPitchRise?: number | null;
  roofPitchRun?: number | null;
  takeoffStatus?: 'pending' | 'complete' | null;
}

export function getZoneMissingData(zone: ZoneReadinessInput): string[] {
  switch (zone.zoneType) {
    case 'conditioned': {
      const missing: string[] = [];
      if (!(typeof zone.defaultCeilingHeightFt === 'number' && zone.defaultCeilingHeightFt > 0)) {
        missing.push('ceiling height');
      }
      return missing;
    }
    case 'unconditioned_garage':
    case 'unconditioned_storage':
      return typeof zone.defaultCeilingHeightFt === 'number' && zone.defaultCeilingHeightFt > 0
        ? []
        : ['ceiling height'];
    case 'unconditioned_crawl':
    case 'unconditioned_attic':
      return [
        ...(zone.insulationType?.trim() ? [] : ['insulation type']),
        ...(zone.rValue?.trim() ? [] : ['R-value']),
        ...(
          zone.zoneType === 'unconditioned_attic' &&
          zone.ceilingType === 'vaulted' &&
          !(
            typeof zone.roofPitchRise === 'number' &&
            Number.isFinite(zone.roofPitchRise) &&
            zone.roofPitchRise > 0 &&
            typeof zone.roofPitchRun === 'number' &&
            Number.isFinite(zone.roofPitchRun) &&
            zone.roofPitchRun > 0
          )
            ? ['roof pitch']
            : []
        ),
      ];
    default:
      return [];
  }
}

export function deriveZoneStatus(zone: ZoneReadinessInput): 'draft' | 'confirmed' {
  return getZoneMissingData(zone).length === 0 ? 'confirmed' : 'draft';
}

export type ZoneLifecycleState = 'incomplete' | 'needs_takeoff' | 'complete';

export function zoneRequiresTakeoff(zoneType: ZoneType): boolean {
  return (
    zoneType === 'conditioned' ||
    zoneType === 'unconditioned_garage' ||
    zoneType === 'unconditioned_storage'
  );
}

export function deriveZoneLifecycleState(zone: ZoneReadinessInput): ZoneLifecycleState {
  if (getZoneMissingData(zone).length > 0) {
    return 'incomplete';
  }

  if (zoneRequiresTakeoff(zone.zoneType)) {
    return zone.takeoffStatus === 'complete' ? 'complete' : 'needs_takeoff';
  }

  return 'complete';
}

// ── Traces ───────────────────────────────────────────────────────────────────

export interface Trace {
  id: string;
  pageIndex: number;
  type: 'linear' | 'area';
  points: PdfPoint[];
  isClosed: boolean;
  isLocked: boolean;
  label: string;
  /** Zone classification for closed traces */
  zone?: ZoneType;
  /** True if this trace is the building envelope (outermost perimeter) */
  isEnvelope?: boolean;
}

// ── Classification ───────────────────────────────────────────────────────────

export interface TraceClassification {
  traceId: string;
  segmentIndex: number;       // -1 for area traces (whole-trace)
  label: string;
  assemblyScope: AssemblyScope;
  wallHeightFt?: number;      // For linear/wall scopes
  openings: Opening[];        // For linear/wall scopes
  installMethod: InstallMethod;
  notes: string[];
}

// ── Session ──────────────────────────────────────────────────────────────────

export interface TakeoffSession {
  id: string;
  projectId: string;
  documentId: string;
  status: SessionStatus;
  measurementBasis: MeasurementBasis;
  selectedPages: number[];
  calibrations: Record<number, Calibration>;  // Keyed by pageIndex
  traces: Trace[];
  classifications: TraceClassification[];
  windowCatalog?: WindowCatalogItem[];
  doorCatalog?: DoorCatalogItem[];
  workspaceSchemaVersion?: number;
  pageAnalysis?: PageAnalysis[];
  views?: TakeoffView[];
  zones?: Zone[];
  wallRuns?: WallRun[];
  surfaces?: Surface[];
  openingItems?: OpeningItemRecord[];
  completionChecklist?: CompletionChecklistItem[];
  aiSuggestions?: AiSuggestion[];
  viewerState?: SourcePageViewState[];
  openingScanMarkers?: OpeningScanMarker[];
  workspaceSummary?: WorkspaceSummary | null;
  estimateRows?: EstimateWorksheetRow[];
  createdAt: string;
  updatedAt: string;
}

// ── Geometry helpers (pure functions) ────────────────────────────────────────

export function pdfDistance(a: PdfPoint, b: PdfPoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function calibratedLength(a: PdfPoint, b: PdfPoint, cal: Calibration): number {
  return pdfDistance(a, b) / cal.pdfPointsPerFoot;
}

export function segmentLengthFt(trace: Trace, segIndex: number, cal: Calibration): number {
  return calibratedLength(trace.points[segIndex], trace.points[segIndex + 1], cal);
}

export function traceTotalLf(trace: Trace, cal: Calibration): number {
  let total = 0;
  for (let i = 0; i < trace.points.length - 1; i++) {
    total += calibratedLength(trace.points[i], trace.points[i + 1], cal);
  }
  if (trace.isClosed && trace.points.length > 2) {
    total += calibratedLength(
      trace.points[trace.points.length - 1],
      trace.points[0],
      cal
    );
  }
  return total;
}

/** Shoelace formula for area traces — returns square feet */
export function traceAreaSf(trace: Trace, cal: Calibration): number {
  const pts = trace.points;
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const areaPdfPoints = Math.abs(sum) / 2;
  return areaPdfPoints / (cal.pdfPointsPerFoot ** 2);
}

/** Opening area in SF */
export function openingAreaSf(opening: Opening): number {
  return opening.width_ft * opening.height_ft * opening.quantity;
}

// ── Page classification (kept from old system) ──────────────────────────────

export interface PageScore {
  page_index: number;
  score: number;
  label: string;
  ai_selected: boolean;
  page_type?: string;
  secondary_page_types?: string[];
  takeoff_relevance?: PageTakeoffRelevance;
  roles: PageRole[];
  ai_roles: PageRole[];
  scan_flags?: PageScanFlags;
  stop_flags?: PageStopFlags;
  scan_notes?: string[];
  scan_extracts?: PageScanExtracts;
}

// ── Dimension text parser ────────────────────────────────────────────────────

/**
 * Parse user-entered dimension text into feet.
 * Accepts: "14", "14'", "14'-0\"", "14.5", "14'-6\"", "14' 6\"", "14-6"
 */
export function parseDimensionToFeet(text: string): number | null {
  const cleaned = text.trim()
    .replace(/\u2032/g, "'")          // prime → apostrophe
    .replace(/\u2033/g, '"')          // double prime → quote
    .replace(/\u2018|\u2019/g, "'")   // smart single quotes
    .replace(/\u201C|\u201D/g, '"')   // smart double quotes
    .replace(/\u00BD/g, '.5')         // ½
    .replace(/\u00BC/g, '.25')        // ¼
    .replace(/\u00BE/g, '.75');       // ¾

  // Handle fraction words/symbols in inches: "6 1/2" → 6.5
  const withFractions = cleaned.replace(
    /(\d+)\s+(\d+)\/(\d+)/g,
    (_, whole, num, den) => String(parseFloat(whole) + parseFloat(num) / parseFloat(den))
  );

  // Match: feet'-inches" or feet' -inches" or feet-inches or feet' inches"
  // Handles: 7'-6", 7'-6 1/2", 14'-0", 7' 6", 7' 6.5", 7-6, 14.5', etc.
  const feetInchesMatch = withFractions.match(
    /^(\d+(?:\.\d+)?)\s*'?\s*-?\s*(\d+(?:\.\d+)?)\s*"?\s*$/
  );
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1]);
    const inches = parseFloat(feetInchesMatch[2]);
    if (inches > 0 || withFractions.includes('-') || withFractions.includes('"') || withFractions.includes("'")) {
      return feet + inches / 12;
    }
  }

  // Match: just inches with " (e.g., "6.5\"" or "6 1/2\"")
  const inchesOnlyMatch = withFractions.match(/^(\d+(?:\.\d+)?)\s*"\s*$/);
  if (inchesOnlyMatch) {
    return parseFloat(inchesOnlyMatch[1]) / 12;
  }

  // Match: just feet (with optional ' mark)
  const feetOnlyMatch = withFractions.match(/^(\d+(?:\.\d+)?)\s*'?\s*$/);
  if (feetOnlyMatch) {
    return parseFloat(feetOnlyMatch[1]);
  }

  return null;
}

/** Format feet as a readable dimension string, e.g. 14.5 → "14'-6\"" */
export function formatFeetInches(feet: number): string {
  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  if (inches === 0) return `${wholeFeet}'-0"`;
  if (inches === 12) return `${wholeFeet + 1}'-0"`;
  return `${wholeFeet}'-${inches}"`;
}
