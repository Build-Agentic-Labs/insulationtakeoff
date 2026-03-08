// TakeoffEnvelopeV1 — TypeScript mirror of pdfengine's canonical response contract

export type FieldStatus = 'final' | 'estimated' | 'missing';

export interface TakeoffSummaryV1 {
  gross_sf: number;
  net_sf: number;
  exterior_lf: number;
  segment_count: number;
  bucket_count: number;
  opening_count: number;
  opening_area_sf: number;
  estimated_footprint_sf: number;
  estimated_ceiling_sf: number;
  estimated_garage_ceiling_sf: number;
  footprint_width_ft: number;
  footprint_depth_ft: number;
  estimated_crawlspace_sf: number;
  estimated_rim_joist_lf: number;
}

export interface TakeoffBucketV1 {
  height_ft: number;
  gross_sf: number;
  net_sf: number;
  opening_sf: number;
  segment_count: number;
}

export interface CompletenessV1 {
  gross_sf: FieldStatus;
  exterior_lf: FieldStatus;
  openings: FieldStatus;
  net_sf: FieldStatus;
  ceiling_area: FieldStatus;
  garage_ceiling_area: FieldStatus;
  crawlspace_area: FieldStatus;
  rim_joist: FieldStatus;
  degradation_reason: string | null;
  missing_components: string[];
}

export interface IssueV1 {
  item_id: string;
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  page_index: number | null;
  source_phase: string;
  recommended_action: string | null;
}

export interface ReviewV1 {
  required: boolean;
  session_id: string | null;
  total_issues: number;
  items: IssueV1[];
}

export interface PageSelectionV1 {
  source: 'auto' | 'override' | 'config' | 'not_run';
  selected_page_index: number | null;
  confidence: number;
}

export interface TelemetryV1 {
  overall_confidence: number;
  total_time_s: number;
  completed_phases: string[];
  skipped_phases: string[];
  timed_out: boolean;
}

export interface TakeoffEnvelopeV1 {
  schema_version: number;
  run_id: string;
  document_id: string;
  mode_used: 'vision_only' | 'ocr_only' | 'hybrid';
  status: 'complete' | 'review' | 'failed';
  page_selection: PageSelectionV1;
  summary: TakeoffSummaryV1;
  buckets: TakeoffBucketV1[];
  completeness: CompletenessV1;
  review: ReviewV1;
  telemetry: TelemetryV1;
  warnings: IssueV1[];
  errors: IssueV1[];
}

// Categories the UI should surface under the Scope section
export const FOUNDATION_ISSUE_CATEGORIES = [
  'crawlspace_assumed',
  'crawlspace_detected',
  'slab_detected',
  'basement_detected',
  'crawlspace_single_page_mode',
] as const;
