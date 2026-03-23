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
  estimated_garage_wall_sf: number;
  estimated_sound_floor_sf: number;
}

export interface TakeoffBucketV1 {
  height_ft: number;
  gross_sf: number;
  net_sf: number;
  opening_sf: number;
  segment_count: number;
}

export interface OpeningItemV1 {
  opening_id: string;
  opening_type: string;
  width_ft: number | null;
  height_ft: number | null;
  area_sf: number | null;
  source: string;
  attributed_bucket: number | null;
}

export interface OpeningsSummaryV1 {
  total_count: number;
  attributed_count: number;
  sized_count: number;
  subtracted_count: number;
  total_area_sf: number;
  subtracted_area_sf: number;
  items: OpeningItemV1[];
  items_truncated: boolean;
  items_limit: number;
}

export interface NetSummaryV1 {
  gross_wall_area_sf: number;
  opening_area_sf: number;
  net_wall_area_sf: number;
  by_bucket_gross: Record<string, number>;
  by_bucket_opening: Record<string, number>;
  by_bucket_net: Record<string, number>;
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

export interface PageCandidateV1 {
  page_index: number;
  score: number;
  reasons: string[];
}

export interface PageSelectionV1 {
  source: 'auto' | 'override' | 'config' | 'not_run' | 'fallback';
  selected_page_index: number | null;
  confidence: number;
  candidates?: PageCandidateV1[];
}

export interface TelemetryV1 {
  overall_confidence: number;
  total_time_s: number;
  completed_phases: string[];
  skipped_phases: string[];
  timed_out: boolean;
  phase_timings?: Record<string, number>;
  vision_page_selection_used?: boolean;
  vision_boundary_used?: boolean;
  hybrid_features?: string[];
  vision_exterior_lf_estimate?: number;
  ocr_vision_exterior_lf_delta_ft?: number;
  ocr_vision_exterior_lf_delta_ratio?: number;
}

// Phase A-C: supplemental page exclusions and Vision credits
export interface ExcludedPageV1 {
  page_index: number;
  reason: string;
  ocr_token_count: number;
  exterior_lf: number;
  vision_exterior_lf_estimate: number;
  ocr_vision_ratio: number | null;
  segment_count: number;
  candidate_reasoning: string;
}

export interface VisionCreditV1 {
  page_index: number;
  vision_exterior_lf: number;
  height_prior_ft: number;
  discount_factor: number;
  credit_sf: number;
  source_exclusion_reason: string;
  page_type: 'architectural' | 'combo_architectural';
}

// Phase F: confidence tier
export type ConfidenceTier = 'high' | 'medium' | 'low';

export interface ConfidenceTierV1 {
  tier: ConfidenceTier;
  penalty: number;
  breakdown: Record<string, number>;
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
  openings: OpeningsSummaryV1;
  net: NetSummaryV1;
  completeness: CompletenessV1;
  review: ReviewV1;
  telemetry: TelemetryV1;
  warnings: IssueV1[];
  errors: IssueV1[];
  // Phase A-F extensions (from raw result, may not be in normalized envelope yet)
  confidence_tier?: ConfidenceTierV1;
  excluded_supplemental_pages?: ExcludedPageV1[];
  vision_perimeter_credits?: VisionCreditV1[];
  vision_credit_total_sf?: number;
  total_gross_sf_with_credits?: number;
}

// Categories the UI should surface under the Scope section
export const FOUNDATION_ISSUE_CATEGORIES = [
  'crawlspace_assumed',
  'crawlspace_detected',
  'slab_detected',
  'basement_detected',
  'crawlspace_single_page_mode',
] as const;
