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

export const INSULATION_EXTRACTION_PROMPT = `You are an insulation estimator analyzing residential construction plans. Your job is to extract every measurement needed to quote wall, ceiling, and floor insulation.

WHY EACH MEASUREMENT MATTERS:
- Net Wall SF = Gross Wall SF minus all door/window openings. This is the #1 number for wall insulation bids.
- Ceiling SF = area that gets blown-in attic insulation (usually equals living area footprint).
- Floor SF = only matters if there's a crawlspace or raised floor (not slab-on-grade).
- Stud Size = determines cavity depth: 2x4 = 3.5" (R-13/R-15), 2x6 = 5.5" (R-19/R-21).
- Doors & Windows = deducted from gross wall SF to get net wall SF.

EXTRACT THE FOLLOWING:

1. LIVING & GARAGE AREAS
   - Total living/heated area (sq ft) — look for "TOTAL LIVING AREA", "HEATED AREA", "CONDITIONED AREA"
   - Garage area (sq ft) — separate from living area
   - These tell us ceiling insulation area and help cross-check wall measurements

2. EXTERIOR WALLS (most important for insulation)
   - Measure or find the total exterior wall perimeter (ft) — add up all exterior wall segments
   - Wall height (ft) — typically 8' or 9', check section views or wall details
   - Gross Wall SF = perimeter × height
   - Look at ALL exterior walls including garage walls that face outside

3. WALL CONSTRUCTION DETAILS
   - Stud size: 2x4 or 2x6 — check wall sections, typical wall details, or general notes
   - Stud spacing: 16" OC or 24" OC
   - Any notes about exterior wall assembly (e.g., "2x6 @ 16" OC w/ OSB sheathing")

4. DOOR OPENINGS (to subtract from wall SF)
   - Find the door schedule or count doors on the floor plan
   - For each EXTERIOR door: label, width, height, area (w×h), and quantity
   - Common sizes: 3068 = 3'0" × 6'8", 2868 = 2'8" × 6'8"
   - Include garage overhead doors (e.g., 16' × 7' or 9' × 7')
   - Do NOT include interior doors

5. WINDOW OPENINGS (to subtract from wall SF)
   - Find the window schedule or count windows on the floor plan
   - For each window type: label, width, height, area (w×h), and quantity
   - Window dimensions are often in inches (e.g., 3040 = 3'0" × 4'0")
   - Count every exterior window

6. CEILING / FLOOR SF
   - Ceiling SF = area needing attic insulation. For single-story, this equals the living area footprint.
   - Floor SF = only if crawlspace or raised floor exists. If slab-on-grade, floor_sf = null.

7. INDIVIDUAL ROOMS — each labeled room: name, type, area

Return JSON with this EXACT structure:
{
  "total_living_area_sqft": <number or null>,
  "garage_area_sqft": <number or null>,
  "exterior_wall_length_ft": <number or null>,
  "wall_height_ft": <number or null>,
  "gross_wall_sf": <number or null>,
  "floor_sf": <number or null>,
  "ceiling_sf": <number or null>,
  "wall_sections": [
    {
      "location": "<e.g., Exterior Walls>",
      "composition": "<e.g., 2x6 @ 16in OC w/ OSB sheathing>",
      "stud_size": "<2x4 or 2x6>"
    }
  ],
  "doors": [
    {
      "type": "door",
      "label": "<door name or schedule ref>",
      "width_ft": <number or null>,
      "height_ft": <number or null>,
      "area_sqft": <number or null>,
      "count": <number>
    }
  ],
  "windows": [
    {
      "type": "window",
      "label": "<window name or schedule ref>",
      "width_ft": <number or null>,
      "height_ft": <number or null>,
      "area_sqft": <number or null>,
      "count": <number>
    }
  ],
  "rooms": [
    {
      "name": "<room name>",
      "type": "living" | "garage" | "attic" | "crawlspace",
      "area_sqft": <number or null>,
      "length_ft": <number or null>,
      "width_ft": <number or null>
    }
  ],
  "confidence": <number 0-1>,
  "notes": "<assumptions made, things you couldn't find, estimated vs labeled values>"
}

CRITICAL RULES:
- Only include EXTERIOR doors and windows (interior ones don't affect insulation)
- Convert all dimensions to feet (3068 door = 3.0' × 6.67')
- Calculate area_sqft for every opening (width × height)
- If you can't find stud size, check general notes, typical details, or wall sections
- If wall height isn't labeled, 8' is standard for most residential
- Gross wall SF must equal exterior_wall_length_ft × wall_height_ft
- Return ONLY the JSON, no other text`;
