import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/ai/claude-client';
import type { PageScanExtracts, PageScanFlags, PageStopFlags } from '@/lib/types/takeoff';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import { getPublicAnalysisError } from '@/lib/takeoff/analysis-errors';
import { normalizePageScanExtracts } from '@/lib/takeoff/scan-extracts';

export const maxDuration = 120;

const DEFAULT_SCAN_FLAGS: PageScanFlags = {
  sheet_index_revisions_scale: false,
  general_insulation_notes: false,
  wall_type_legend: false,
  exterior_wall_details: false,
  interior_wall_details: false,
  roof_ceiling_details: false,
  roof_pitch: false,
  floor_foundation_details: false,
  enlarged_sections: false,
  insulated_area_plan_views: false,
  dimensions: false,
  height_references: false,
  opening_info: false,
  room_names: false,
  material_specs: false,
  vapor_barrier: false,
  air_barrier: false,
  baffles_or_venting: false,
  symbols_and_keynotes: false,
  alternates_or_conflicts: false,
};

const DEFAULT_STOP_FLAGS: PageStopFlags = {
  missing_assembly_definition: false,
  missing_dimensions_or_heights: false,
  missing_opening_identification: false,
  conflicting_specs: false,
  missing_unusual_condition_details: false,
};

const DEFAULT_SCAN_EXTRACTS: PageScanExtracts = {
  window_sizes: [],
  opening_quantity_notes: [],
  opening_schedule_items: [],
  insulation_types: [],
  r_values: [],
  roof_pitches: [],
  vapor_barriers: [],
  air_barriers: [],
  baffles_or_venting: [],
};

function hasRValueEvidenceContext(
  flags: PageScanFlags,
  extracts: PageScanExtracts,
) {
  return Boolean(
    flags.general_insulation_notes ||
      flags.wall_type_legend ||
      flags.exterior_wall_details ||
      flags.interior_wall_details ||
      flags.roof_ceiling_details ||
      flags.floor_foundation_details ||
      flags.material_specs ||
      flags.vapor_barrier ||
      flags.air_barrier ||
      flags.baffles_or_venting ||
      extracts.insulation_types.length ||
      extracts.vapor_barriers.length ||
      extracts.air_barriers.length ||
      extracts.baffles_or_venting.length,
  );
}

const CLASSIFY_PROMPT = `You are an expert architectural blueprint analyst. I'm showing you thumbnail images of pages from a residential construction blueprint set.

This is for an INSULATION INSTALLATION takeoff, not a generic drawing index.
Your job is to qualify which sheets matter for:
- exterior/interior wall measurement support
- wall height confirmation
- roof / ceiling / floor / foundation insulation scope
- window and door deductions
- insulation assembly, thickness, R-value, and spec lookup

The estimator stays in control of measurements. Vision should find relevant sheets, evidence pages, and qualitative clues. Do not pretend a page is useful for insulation takeoff unless the sheet actually helps measurement, opening deductions, or insulation assembly/spec lookup.

For EACH page (numbered starting from 1), determine:
1. **page_type**: What kind of drawing is this?
   - "floor_plan" — shows room layout, walls, doors, windows with dimensions (MOST USEFUL for insulation takeoff)
   - "elevation" — side view of the building exterior
   - "section" — cross-section cut through the building
   - "foundation" — foundation/footing plan
   - "roof" — roof plan or roof framing plan showing roof / ceiling geometry
   - "site" — site plan showing lot, setbacks, utilities
   - "schedule" — tables of doors, windows, finishes
   - "detail" — construction details, callouts
   - "title" — title block, cover sheet
   - "electrical" — electrical plan
   - "plumbing" — plumbing plan
   - "other" — anything else

2. **secondary_page_types**: optional array with up to 2 secondary page types if the sheet is mixed (example: an elevation sheet that also includes building sections). Use only values from the page_type list above.

3. **page_name**: Extract the actual title/name printed on the drawing (e.g., "MAIN FLOOR PLAN", "LOWER LEVEL", "WEST ELEVATION"). If no title is visible, describe it briefly.

4. **takeoff_relevance**: choose exactly one:
   - "primary_measurement" — directly useful for measurement or major quantity collection
   - "supporting_evidence" — not measured directly, but useful for wall heights, assemblies, schedules, qualitative insulation info, or framing/structural context that helps define insulation scope
   - "low_value" — mostly not useful for insulation takeoff

5. **has_dimensions**: Does this page show wall dimensions (dimension strings like 14'-0", 9'-0", etc.)? true/false

6. **is_floor_plan**: Is this a floor plan useful for measuring exterior wall lengths? true/false. Only floor plans with visible dimension chains are useful.

7. **confidence**: How confident are you in the classification and takeoff usefulness? 0.0-1.0
   - Use 0.90+ only when the page title and visible content are both very clear.
   - Use 0.70-0.89 when the page is probably right but mixed or partially legible.
   - Use below 0.70 when the sheet is ambiguous, partial, or hard to read.

8. **scan_flags**: mark whether this page contains any of the following insulation-takeoff inputs:
   - sheet_index_revisions_scale
   - general_insulation_notes
   - wall_type_legend
   - exterior_wall_details
	   - interior_wall_details
	   - roof_ceiling_details
	   - roof_pitch
	   - floor_foundation_details
	   - enlarged_sections
	   - insulated_area_plan_views
	   - dimensions
   - height_references
   - opening_info
	   - room_names
	   - material_specs
	   - vapor_barrier
	   - air_barrier
	   - baffles_or_venting
	   - symbols_and_keynotes
	   - alternates_or_conflicts

9. **stop_flags**: mark whether this page indicates one of these stop conditions:
   - missing_assembly_definition
   - missing_dimensions_or_heights
   - missing_opening_identification
   - conflicting_specs
   - missing_unusual_condition_details

10. **scan_extracts**: attempt to extract explicit takeoff attributes that are VISIBLE on this page:
   - window_sizes: array of opening size strings when visible (examples: "3050", "3068", "2ft-6in x 4ft-0in")
	   - opening_quantity_notes: array of short notes about repeated openings, counts, or schedule quantity hints when visible
	   - opening_evidence: for floor plans only, choose one of "direct_dimensions", "tags_only", "unlabeled", or "no_opening_evidence"
	     - "direct_dimensions" means opening sizes are printed on the plan, like 3050, 3068, 24in x 80in, 2ft-0in x 6ft-8in
	     - "tags_only" means openings have labels or IDs like 101B, 101.B, W-2, D3, but the plan does not show sizes
	     - "unlabeled" means window/door openings are visible but neither size nor clear tag can be read
	     - "no_opening_evidence" means there is no useful visible opening information
	   - opening_schedule_items: array of visible door/window schedule rows. Use this on schedule/table pages and on detail pages with clear schedule rows. Each row must include:
	     {
	       "openingType": "window" or "door",
	       "tag": exact visible tag such as "101.B", "W-2", or "D3",
	       "room": visible room name or null,
	       "rawSize": exact visible size converted to JSON-safe text such as "24in x 80in", "36 x 56", "2ft-0in x 6ft-8in", or "3/0 x 5/6",
	       "scheduleType": visible type/description such as "FIXED", "CASEMENT", or "SOLID CORE",
	       "confidence": 0.0-1.0,
	       "reviewFlags": short flags such as "hard_to_read", "missing_size", "ambiguous_units"
	     }
	   - insulation_types: array of explicit insulation material/type mentions (examples: "batt insulation", "open-cell spray foam", "blown cellulose")
	   - r_values: array of explicit R-value strings (examples: "R-19", "R-38", "R-13 + 5ci")
	   - roof_pitches: array of explicit roof pitch/slope strings when visible (examples: "7/12", "6:12", "4 in 12")
	   - vapor_barriers: array of explicit vapor barrier / vapor retarder / faced insulation notes when visible
	   - air_barriers: array of explicit air barrier or air sealing notes when visible
	   - baffles_or_venting: array of explicit attic baffle, vent chute, soffit vent, ridge vent, or ventilation notes when visible
	   Use empty arrays when not visible. Do not infer values that are not on the page.
   IMPORTANT: return JSON-safe strings only. Do not include raw inch quote characters inside strings. Convert feet/inches to text like "2ft-6in x 4ft-0in" instead of using double quotes.

11. **scan_notes**: short plain-language findings from this page, max 3 bullets as strings. Keep them concrete and insulation-takeoff oriented.

Important guidance:
- Favor sheets that help the estimator complete Exterior, Interior, Attic, or Crawlspace insulation tasks.
- Treat plan-view floor plans, foundation plans, and roof plans with usable geometry as "primary_measurement" when they can support direct quantity collection for exterior walls, crawlspace/floor areas, or attic/ceiling areas.
- A sheet titled or clearly drawn as a FRAMING PLAN is NOT automatically a roof page. A "MAIN FLOOR FRAMING PLAN" or floor joist framing sheet should usually be "other" unless it clearly shows roof / ceiling geometry relevant to attic takeoff.
- Structural framing plans that do not support direct measurement can still be "supporting_evidence" when they help explain roof, ceiling, floor, or unusual framing conditions that affect insulation scope. Use "low_value" only when the sheet adds little or no insulation-takeoff value.
- A "ROOF FRAMING PLAN" with a full roof outline, overhangs, ridges, hips, valleys, or other roof-area geometry should still be classified as "roof" and is often "primary_measurement" for attic / ceiling scope.
- Elevations and sections are useful when they provide wall heights, floor-to-floor heights, or unusual-condition details.
- Details and schedules are useful when they reveal insulation assemblies, opening sizes, or product/spec information.
- When a door/window schedule or elevation shows explicit opening sizes, try to capture those exact sizes in **scan_extracts.window_sizes** and note repeated types in **scan_extracts.opening_quantity_notes**.
- When a floor plan uses opening tags without sizes, mark **scan_extracts.opening_evidence** as "tags_only"; that means a matching window/door schedule is required for the opening catalog. Do not treat tags-only as direct dimensions.
- When a schedule table is visible, extract as many readable rows as possible into **scan_extracts.opening_schedule_items**. Preserve the exact tag and raw size. Do not invent missing rows or guess unreadable dimensions.
- If a schedule row has no unit marks, keep the raw size exactly (for example "36 x 56") and add "ambiguous_units" to reviewFlags when uncertain.
	- When a note, section, detail, or schedule shows insulation materials, R-values, roof pitch, vapor barrier, air barrier, or attic venting/baffle requirements, capture them exactly in the matching **scan_extracts** arrays.
- Electrical, plumbing, and unrelated coordination sheets should usually be "low_value" unless they clearly include takeoff-relevant dimensions or notes.
- For **has_dimensions** and **scan_flags.dimensions**, only mark true when the page contains geometry the estimator could actually use for takeoff quantities:
  - exterior wall lengths
  - major offsets
  - roof / ceiling / foundation / crawlspace extents
  - clearly measurable opening sizes
  Do NOT mark true just because a sheet has scattered callouts, small detail dimensions, or general elevation annotations.
- For **is_floor_plan**, only mark true when the page is an architectural plan view the estimator could actually use to measure exterior wall lengths. A framing plan is usually NOT a floor plan for this purpose.
- For **interior_wall_details**, only mark true when the sheet explicitly includes interior wall assembly information or notes tied to acoustic / thermal insulation. A normal floor plan with interior partitions is NOT enough.
	- For **general_insulation_notes** and **material_specs**, only mark true when insulation-specific notes are actually visible, such as R-values, batt/blown/spray foam references, thickness, density, facer, vapor barrier / retarder, air barrier / air sealing, roof pitch tied to sloped ceiling work, attic baffles, or code/spec language tied to insulation.
- For **wall_type_legend**, only mark true when the sheet clearly contains named wall types or assembly labels that the estimator could use to distinguish insulation conditions. Generic detail callouts are NOT enough.
- A detail sheet may legitimately have **exterior_wall_details**, **roof_ceiling_details**, or **floor_foundation_details** true while **general_insulation_notes**, **wall_type_legend**, and **material_specs** remain false. Structural details alone do NOT satisfy insulation assembly/spec evidence.
- Typical framing, stemwall, bearing, roof structure, and generic construction details without insulation callouts should NOT trigger **general_insulation_notes** or **material_specs**.
- For **room_names**, only mark true when room labels are part of a plan or elevation that helps define insulated scope. Do NOT mark electrical or coordination sheets true just because room labels appear incidentally.
- On electrical, plumbing, or other coordination sheets, keep **room_names** false unless the page is still genuinely useful for insulation scope review.
- Be strict about assembly evidence. Do not infer wall details or specs from generic framing information alone.
- Be conservative. It is better to mark a page as supporting evidence than to overstate it as a primary measurement page.

Return ONLY a valid JSON array, one object per page in order:
[
  {
    "page_number": 1,
    "page_type": "...",
    "secondary_page_types": ["section"],
    "page_name": "...",
    "takeoff_relevance": "supporting_evidence",
    "has_dimensions": true,
    "is_floor_plan": false,
    "confidence": 0.95,
    "scan_flags": {
      "sheet_index_revisions_scale": false,
      "general_insulation_notes": false,
      "wall_type_legend": false,
	      "exterior_wall_details": true,
	      "interior_wall_details": false,
	      "roof_ceiling_details": false,
	      "roof_pitch": false,
	      "floor_foundation_details": false,
	      "enlarged_sections": true,
	      "insulated_area_plan_views": false,
      "dimensions": false,
      "height_references": true,
      "opening_info": false,
	      "room_names": false,
	      "material_specs": false,
	      "vapor_barrier": true,
	      "air_barrier": false,
	      "baffles_or_venting": false,
	      "symbols_and_keynotes": true,
	      "alternates_or_conflicts": false
    },
    "stop_flags": {
      "missing_assembly_definition": false,
      "missing_dimensions_or_heights": false,
      "missing_opening_identification": false,
      "conflicting_specs": false,
      "missing_unusual_condition_details": false
    },
	    "scan_extracts": {
	      "window_sizes": [],
	      "opening_quantity_notes": [],
	      "opening_evidence": "no_opening_evidence",
	      "opening_schedule_items": [],
	      "insulation_types": ["R-21 batt insulation"],
	      "r_values": ["R-21"],
	      "roof_pitches": [],
	      "vapor_barriers": ["poly vapor retarder"],
	      "air_barriers": [],
	      "baffles_or_venting": []
	    },
    "scan_notes": ["Exterior wall section with batt insulation note", "Wall height reference visible"]
  },
  ...
]`;

export async function POST(request: NextRequest) {
  try {
    await requireServerCompanyId();
    const { pages } = await request.json();

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { error: 'pages array with base64 images is required' },
        { status: 400 }
      );
    }

    // Build content array: all page thumbnails + the classification prompt
    // @ts-expect-error Anthropic SDK type mismatch
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (let i = 0; i < pages.length; i++) {
      content.push({
        type: 'text',
        text: `--- Page ${i + 1} ---`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: pages[i].image_base64,
        },
      });
    }

    content.push({
      type: 'text',
      text: CLASSIFY_PROMPT,
    });

    const message = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content }],
    });

    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({
        pages: [],
        error: 'Could not parse classification response',
      });
    }

    let classified: Array<{
      page_number: number;
      page_type: string;
      secondary_page_types?: string[];
      page_name: string;
      takeoff_relevance?: 'primary_measurement' | 'supporting_evidence' | 'low_value';
      has_dimensions: boolean;
      is_floor_plan: boolean;
      confidence: number;
      scan_flags?: Partial<PageScanFlags>;
      stop_flags?: Partial<PageStopFlags>;
      scan_extracts?: Partial<PageScanExtracts>;
      scan_notes?: string[];
    }>;

    try {
      classified = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({
        pages: [],
        error: 'Failed to parse classification JSON',
      });
    }

    // Validate and normalize
    const results = classified.map((p, i) => {
      const scanFlags: PageScanFlags = {
        ...DEFAULT_SCAN_FLAGS,
        ...(p.scan_flags ?? {}),
        dimensions: p.has_dimensions ?? p.scan_flags?.dimensions ?? false,
      };
      const scanExtracts = normalizePageScanExtracts(
        { ...DEFAULT_SCAN_EXTRACTS, ...(p.scan_extracts ?? {}) },
        {
          window_sizes: 12,
          opening_quantity_notes: 8,
          opening_schedule_items: 80,
          insulation_types: 8,
          r_values: 8,
          roof_pitches: 8,
          vapor_barriers: 8,
          air_barriers: 8,
          baffles_or_venting: 8,
        },
      );
      scanExtracts.opening_schedule_items = (scanExtracts.opening_schedule_items ?? []).map(
        (item) => ({
          ...item,
          sourcePageIndex: item.sourcePageIndex ?? (p.page_number ?? i + 1) - 1,
        }),
      );

      if (!hasRValueEvidenceContext(scanFlags, scanExtracts)) {
        scanExtracts.r_values = [];
      }

      return {
        page_index: (p.page_number ?? i + 1) - 1,
        page_type: p.page_type ?? 'other',
        secondary_page_types: Array.isArray(p.secondary_page_types)
          ? p.secondary_page_types.slice(0, 2)
          : [],
        page_name: p.page_name ?? `Page ${i + 1}`,
        takeoff_relevance: p.takeoff_relevance ?? 'low_value',
        has_dimensions: p.has_dimensions ?? false,
        is_floor_plan: p.is_floor_plan ?? false,
        confidence: Math.min(1, Math.max(0, p.confidence ?? 0.5)),
        scan_flags: scanFlags,
        stop_flags: {
        ...DEFAULT_STOP_FLAGS,
        ...(p.stop_flags ?? {}),
        },
        scan_extracts: scanExtracts,
        scan_notes: Array.isArray(p.scan_notes) ? p.scan_notes.slice(0, 3) : [],
      };
    });

    return NextResponse.json({ pages: results });
  } catch (error: any) {
    const authResponse = authApiErrorResponse(error);
    if (authResponse.status !== 500) return authResponse;

    console.error('Page classification error:', error);
    return NextResponse.json(
      { error: getPublicAnalysisError(error), pages: [] },
      { status: 500 }
    );
  }
}
