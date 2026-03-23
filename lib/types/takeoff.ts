export interface BBox {
  x: number;      // % of page width (0-100)
  y: number;      // % of page height (0-100)
  width: number;  // % of page width
  height: number; // % of page height
}

export type WallType = 'exterior' | 'garage' | 'basement' | 'other';
export type RegionSource = 'ai' | 'manual';
export type RegionStatus = 'pending' | 'analyzing' | 'confirmed' | 'rejected';
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface DetectedDimension {
  id: string;
  value_ft: number;
  raw_text: string;
  confidence: number;
  position: { x: number; y: number };
  selected: boolean;
}

export interface DetectedOpening {
  id: string;
  type: 'door' | 'window';
  width_ft: number;
  height_ft: number;
  area_sf: number;
  confidence: number;
  label: string;
}

export interface RegionAnalysisResult {
  detected_dimensions: DetectedDimension[];
  suggested_wall_length_lf: number;
  detected_height_ft: number | null;
  openings: DetectedOpening[];
  gross_sf: number;
  net_sf: number;
  confidence: number;
}

export interface TakeoffRegion {
  id: string;
  session_id: string;
  page_index: number;
  label: string;
  wall_type: WallType;
  source: RegionSource;
  status: RegionStatus;
  bbox: BBox;
  wall_length_lf: number | null;
  wall_height_ft: number | null;
  gross_sf: number | null;
  net_sf: number | null;
  openings: DetectedOpening[];
  analysis_result: RegionAnalysisResult | null;
  confirmed_at: string | null;
}

export interface TakeoffSession {
  id: string;
  project_id: string;
  document_id: string;
  status: SessionStatus;
  selected_pages: number[];
  regions: TakeoffRegion[];
  created_at: string;
  updated_at: string;
}

export interface VisionRegionSuggestion {
  label: string;
  wall_type: WallType;
  bbox: BBox;
}

export interface PageScore {
  page_index: number;
  score: number;
  label: string;
  ai_selected: boolean;
}
