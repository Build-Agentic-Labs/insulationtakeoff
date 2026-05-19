import type {
  AssemblyScope,
  MeasurementBasis,
  OpeningType,
  PageScanExtracts,
  PageScanFlags,
  PageStopFlags,
  PageRole,
  PdfPoint,
  ZoneCeilingType,
  ZoneType,
} from './takeoff';

export const WORKSPACE_SCHEMA_VERSION = 2;

export type PageCapability =
  | 'page_title'
  | 'wall_measurement'
  | 'zoning'
  | 'wall_height'
  | 'opening_schedule'
  | 'wall_type'
  | 'attic_scope'
  | 'roof_pitch'
  | 'crawlspace_scope'
  | 'garage_scope'
  | 'vapor_barrier'
  | 'air_barrier'
  | 'spec_scope';

export interface PageCapabilityScore {
  capability: PageCapability;
  score: number;
  evidence?: string[];
}

export interface PageAnalysis {
  pageIndex: number;
  title: string;
  pageType?: string;
  selectedByAi: boolean;
  confidence: number;
  roles: PageRole[];
  aiRoles: PageRole[];
  capabilities: PageCapabilityScore[];
  notes: string[];
  scanFlags?: PageScanFlags;
  stopFlags?: PageStopFlags;
  scanExtracts?: PageScanExtracts;
}

export type EvidenceRequirement =
  | 'measurement_page'
  | 'wall_height_reference'
  | 'insulation_details'
  | 'roof_pitch_reference'
  | 'vapor_barrier_reference'
  | 'opening_schedule';

export interface EvidenceRequirementStatus {
  requirement: EvidenceRequirement;
  label: string;
  description: string;
  severity: 'required' | 'recommended';
  satisfied: boolean;
  pageIndexes: number[];
}

export type TakeoffViewScope =
  | 'general'
  | 'exterior_walls'
  | 'garage_shared_walls'
  | 'attic_floor'
  | 'crawlspace_floor'
  | 'garage_ceiling'
  | 'openings'
  | 'custom';

export interface TakeoffView {
  id: string;
  pageIndex: number;
  name: string;
  scope: TakeoffViewScope;
  isPrimary: boolean;
  status: 'draft' | 'active' | 'reviewed';
  hiddenObjectIds: string[];
  ghostedViewIds: string[];
}

export interface Zone {
  id: string;
  pageIndex: number;
  viewId: string;
  label: string;
  zoneType: ZoneType;
  floorLabel?: string | null;
  defaultCeilingHeightFt?: number | null;
  ceilingType?: ZoneCeilingType | null;
  insulationType?: string | null;
  rValue?: string | null;
  roofPitchRise?: number | null;
  roofPitchRun?: number | null;
  roofPitchSourceText?: string | null;
  roofPitchConfidence?: number | null;
  roofPitchSource?: 'manual' | 'vision' | null;
  takeoffStatus?: 'pending' | 'complete' | null;
  polygon: PdfPoint[];
  status: 'draft' | 'confirmed';
  aiSuggestionId?: string;
}

export interface WallRun {
  id: string;
  pageIndex: number;
  viewId: string;
  label: string;
  path: PdfPoint[];
  measurementBasis: MeasurementBasis;
  thicknessIn: 4 | 6 | 8 | 10 | 12;
  fillSide?: 'left' | 'right';
  framingType?: '2x4' | '2x6' | 'cmu' | 'icf' | 'other';
  sideAZoneId?: string;
  sideBZoneId?: string;
  heightFt?: number;
  heightSource: 'manual' | 'ai_note' | 'page_default' | 'inherited' | 'unknown';
  assemblyScope?: AssemblyScope;
  openingIds: string[];
  confidence: {
    geometry: number;
    zoning: number;
    assembly: number;
  };
  reviewFlags: string[];
}

export interface Surface {
  id: string;
  pageIndex: number;
  viewId: string;
  label: string;
  polygon: PdfPoint[];
  assemblyScope:
    | 'attic_floor'
    | 'crawlspace_floor'
    | 'garage_ceiling'
    | 'sound_floor'
    | 'cathedral_ceiling'
    | 'cantilever_floor';
  roofPitchRise?: number | null;
  roofPitchRun?: number | null;
  roofPitchSourceText?: string | null;
  roofPitchConfidence?: number | null;
  roofPitchSource?: 'manual' | 'vision' | null;
  status: 'draft' | 'confirmed';
  aiSuggestionId?: string;
}

export interface OpeningItemRecord {
  id: string;
  pageIndex: number;
  viewId: string;
  wallRunId?: string;
  type: OpeningType;
  widthFt?: number;
  heightFt?: number;
  quantity: number;
  label?: string;
  source: 'manual' | 'ai_suggestion';
}

export interface CompletionChecklistItem {
  id: string;
  label: string;
  scope: string;
  status: 'pending' | 'in_progress' | 'complete' | 'not_applicable';
  notes?: string;
}

export interface AiSuggestion {
  id: string;
  pageIndex: number;
  kind: 'page' | 'zone' | 'wall_run' | 'surface' | 'opening' | 'warning';
  label: string;
  confidence: number;
  evidence: string[];
  status: 'pending' | 'accepted' | 'dismissed' | 'edited';
  fieldLabel?: string;
  suggestedValue?: string;
  appliedValue?: string;
  sourceSnippet?: string;
  targetId?: string;
}

export interface SourcePageViewState {
  pageIndex: number;
  activeViewId?: string;
  ghostedViewIds: string[];
  zoom?: number;
  pan?: { x: number; y: number };
  openingScanMarkers?: Array<{
    id: string;
    openingType: 'door' | 'window' | 'garage_door' | 'sliding_door' | 'french_door' | 'door_opening';
    pageIndex: number;
    wallRunId: string;
    point: { x: number; y: number };
  }>;
}

export type WorkspaceAreaId =
  | 'exterior_walls'
  | 'garage_walls'
  | 'basement_walls'
  | 'knee_walls'
  | 'attic_ceiling'
  | 'crawlspace_floor'
  | 'garage_ceiling'
  | 'sound_floor'
  | 'cathedral_ceiling'
  | 'cantilever_floor'
  | 'rim_joist';

export interface WorkspaceSummaryBucket {
  scope: AssemblyScope;
  lf: number;
  grossSf: number;
  netSf: number;
  openingSf: number;
  count: number;
}

export interface WorkspaceSummaryArea {
  id: WorkspaceAreaId;
  label: string;
  sqft: number;
  lf?: number;
  description: string;
  source: 'calibrated_takeoff';
}

export interface WorkspaceSummary {
  schemaVersion: number;
  generatedAt: string;
  totals: {
    totalLf: number;
    grossSf: number;
    netSf: number;
    openingSf: number;
    bucketCount: number;
  };
  buckets: WorkspaceSummaryBucket[];
  areas: WorkspaceSummaryArea[];
}

export interface TakeoffWorkspaceV2 {
  schemaVersion: number;
  pageAnalysis: PageAnalysis[];
  views: TakeoffView[];
  zones: Zone[];
  wallRuns: WallRun[];
  surfaces: Surface[];
  openingItems: OpeningItemRecord[];
  completionChecklist: CompletionChecklistItem[];
  aiSuggestions: AiSuggestion[];
  viewerState: SourcePageViewState[];
  workspaceSummary: WorkspaceSummary;
}
