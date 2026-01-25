export interface ExtractedRoom {
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  length_ft: number | null;
  width_ft: number | null;
}

export interface FloorPlanData {
  living_area_sqft: number | null;
  garage_area_sqft: number | null;
  wall_height_ft: number | null;
  rooms: ExtractedRoom[];
  perimeter_ft: number | null;
  confidence: number;
}

export interface WallHeight {
  location: string;
  height_ft: number;
}

export interface SectionViewData {
  wall_heights: WallHeight[];
  floor_to_floor_height_ft: number | null;
  ceiling_height_ft: number | null;
  confidence: number;
}

export interface RoofPlanData {
  attic_area_sqft: number | null;
  ceiling_area_sqft: number | null;
  confidence: number;
}

export interface PageClassification {
  type: 'floor_plan' | 'section' | 'roof_plan' | 'elevation' | 'detail' | 'other';
  confidence: number;
  description: string;
}

export function parseJSON<T>(text: string): T | null {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : text;

    return JSON.parse(jsonText.trim());
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    console.error('Text:', text);
    return null;
  }
}

export function parseFloorPlanResponse(response: string): FloorPlanData | null {
  return parseJSON<FloorPlanData>(response);
}

export function parseSectionViewResponse(response: string): SectionViewData | null {
  return parseJSON<SectionViewData>(response);
}

export function parseRoofPlanResponse(response: string): RoofPlanData | null {
  return parseJSON<RoofPlanData>(response);
}

export function parsePageClassification(response: string): PageClassification | null {
  return parseJSON<PageClassification>(response);
}

export function validateFloorPlanData(data: FloorPlanData): boolean {
  if (data.confidence < 0.3) {
    return false;
  }

  // At least one of these should be present
  return (
    data.living_area_sqft !== null ||
    data.garage_area_sqft !== null ||
    data.rooms.length > 0
  );
}

export function validateSectionViewData(data: SectionViewData): boolean {
  if (data.confidence < 0.3) {
    return false;
  }

  return (
    data.wall_heights.length > 0 ||
    data.floor_to_floor_height_ft !== null ||
    data.ceiling_height_ft !== null
  );
}

export function validateRoofPlanData(data: RoofPlanData): boolean {
  if (data.confidence < 0.3) {
    return false;
  }

  return (
    data.attic_area_sqft !== null ||
    data.ceiling_area_sqft !== null
  );
}
