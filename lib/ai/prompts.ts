export const FLOOR_PLAN_PROMPT = `You are analyzing an architectural floor plan to extract insulation-related measurements.

Please analyze this image and extract the following information:

1. Total living area square footage (often labeled as "TOTAL LIVING AREA" or similar)
2. Garage area square footage (if present)
3. Individual room dimensions (length x width in feet)
4. Any labeled square footage for specific rooms
5. Overall building perimeter measurements

Return your response as a JSON object with this structure:
{
  "living_area_sqft": number | null,
  "garage_area_sqft": number | null,
  "rooms": [
    {
      "name": string,
      "type": "living" | "garage" | "attic" | "crawlspace",
      "area_sqft": number | null,
      "length_ft": number | null,
      "width_ft": number | null
    }
  ],
  "perimeter_ft": number | null,
  "confidence": number (0-1)
}

Important:
- Only extract measurements that are clearly visible and labeled
- Use null for any values you cannot determine with confidence
- The confidence score should reflect how certain you are about the extracted data
- If this doesn't appear to be a floor plan, return an empty rooms array`;

export const SECTION_VIEW_PROMPT = `You are analyzing an architectural section view to extract wall height measurements.

Please analyze this image and extract the following information:

1. Wall heights (from floor to ceiling)
2. Floor-to-floor heights
3. Ceiling heights
4. Any labeled vertical dimensions

Return your response as a JSON object with this structure:
{
  "wall_heights": [
    {
      "location": string (e.g., "Main Floor", "Second Floor"),
      "height_ft": number
    }
  ],
  "floor_to_floor_height_ft": number | null,
  "ceiling_height_ft": number | null,
  "confidence": number (0-1)
}

Important:
- Only extract measurements that are clearly visible and labeled
- Convert all measurements to feet (if they're in inches, divide by 12)
- Use null for any values you cannot determine with confidence
- If this doesn't appear to be a section view, return an empty wall_heights array`;

export const ROOF_PLAN_PROMPT = `You are analyzing an architectural roof plan to extract attic/ceiling area measurements.

Please analyze this image and extract the following information:

1. Total roof area or attic area square footage
2. Ceiling area that would require insulation
3. Any labeled dimensions or areas

Return your response as a JSON object with this structure:
{
  "attic_area_sqft": number | null,
  "ceiling_area_sqft": number | null,
  "confidence": number (0-1)
}

Important:
- Only extract measurements that are clearly visible and labeled
- Use null for any values you cannot determine with confidence
- The attic area is typically the area that needs ceiling/attic insulation
- If this doesn't appear to be a roof plan, return all null values`;

export const PAGE_CLASSIFICATION_PROMPT = `Analyze this architectural drawing and classify what type of drawing it is.

Possible types:
- "floor_plan": Shows the layout of rooms from a top-down view
- "section": Shows a vertical cut-through view of the building
- "roof_plan": Shows the roof layout from above
- "elevation": Shows an exterior view of the building
- "detail": Shows specific construction details
- "other": Any other type of drawing

Return your response as a JSON object:
{
  "type": "floor_plan" | "section" | "roof_plan" | "elevation" | "detail" | "other",
  "confidence": number (0-1),
  "description": string (brief description of what you see)
}`;

export function getExtractionPrompt(pageType: string): string {
  switch (pageType) {
    case 'floor_plan':
      return FLOOR_PLAN_PROMPT;
    case 'section':
      return SECTION_VIEW_PROMPT;
    case 'roof_plan':
      return ROOF_PLAN_PROMPT;
    default:
      return FLOOR_PLAN_PROMPT; // Default to floor plan
  }
}
