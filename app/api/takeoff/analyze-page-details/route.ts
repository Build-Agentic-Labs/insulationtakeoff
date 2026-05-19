import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getAnthropicClient } from '@/lib/ai/claude-client';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import {
  extractAirBarrierStrings,
  extractBaffleOrVentingStrings,
  extractRoofPitchStrings,
  extractVaporBarrierStrings,
} from '@/lib/takeoff/scan-extracts';

export const maxDuration = 120;

type DetailPageType =
  | 'construction_details'
  | 'building_sections'
  | 'general_notes'
  | 'opening_reference'
  | 'opening_schedule'
  | 'floor_plan_region'
  | 'fragmented_details';

type FragmentPromptType = Exclude<DetailPageType, 'fragmented_details'>;

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetailFragment {
  id: string;
  label: string;
  fragment_type: FragmentPromptType;
  confidence: number;
  bbox: BBox;
}

const FRAGMENT_PROMPT_TYPES: FragmentPromptType[] = [
  'construction_details',
  'building_sections',
  'general_notes',
  'opening_reference',
];

const prompts: Record<FragmentPromptType, string> = {
  construction_details: `This is a Construction Details page from a residential blueprint. Extract ALL information you can find about:
- Wall assemblies (framing type, insulation spec, vapor barrier, sheathing)
- Ceiling/attic insulation specifications
- Roof pitch/slope notes that affect sloped or cathedral ceiling takeoff
- Attic baffles, vent chutes, soffit vents, ridge vents, or ventilation requirements
- Floor insulation specifications
- Foundation details
- Any R-value callouts
- Window/door schedules if present
- Energy code references
- Any notes about insulation, air sealing, or vapor barriers

Only capture insulation information that is explicitly visible. Do not infer R-values or insulation types from generic construction details.
If a ceiling or attic note contains multiple contextual values, preserve every explicit attic value in the spec text, for example "R=49 at flat ceiling and R=38 at vaults". Do not collapse multiple attic R-values into one or drop the secondary vault/cathedral value.
For all opening sizes, return JSON-safe size strings like "3050", "24in x 80in", "36 x 56", "3/0 x 5/6", or "2ft-6in x 6ft-8in". Do not use raw inch quote characters in JSON values.
For window and door schedule rows, preserve the visible tag/type ID exactly, the room when shown, the exact raw size, and the visible type/description. Do not guess unreadable rows.

Return as JSON:
{
  "wall_sections": [{"name": "string", "framing": "2x4 or 2x6", "insulation_spec": "R-value and type", "vapor_barrier": true/false, "notes": "string"}],
  "ceiling_insulation": {"spec": "string", "r_value": number, "roof_pitch": "string", "baffles_or_venting": "string"},
  "floor_insulation": {"spec": "string", "r_value": number},
  "foundation": {"type": "string", "insulation": "string"},
  "window_schedule": [{"type_id": "string", "room": "string or null", "size": "JSON-safe size string", "type_description": "string", "quantity": number, "confidence": number}],
  "door_schedule": [{"type_id": "string", "room": "string or null", "size": "JSON-safe size string", "type_description": "string", "quantity": number, "confidence": number}],
  "general_notes": ["string"],
  "energy_code": "string",
  "climate_zone": number
}
Only include fields you can actually read. If something is not visible, omit it.`,

  building_sections: `This is a Building Sections page from a residential blueprint. Extract:
- Wall heights at different locations
- Ceiling heights
- Roof pitch/slope
- Attic baffles, vent chutes, and roof/ceiling ventilation notes
- Foundation depth
- Floor-to-floor heights
- Any insulation callouts visible in the sections
- Wall assembly layers visible in section cuts

Only capture insulation information that is explicitly visible. If the section is structural only, leave insulation fields empty.

Return as JSON:
{
  "sections": [{"name": "string", "wall_height_ft": number, "ceiling_height_ft": number, "roof_pitch": "string", "notes": ["string"]}],
  "insulation_callouts": [{"location": "string", "spec": "string"}],
  "heights": [{"location": "string", "height_ft": number}]
}`,

  floor_plan_region: `This is a cropped region from a residential floor plan showing ONE room that has been traced/outlined by the user. Focus ONLY on the primary room in the center of the image — ignore adjacent rooms, hallways, or closets that may be partially visible at the edges.

Extract ONLY what you can read for the PRIMARY room:
- Room name/label
- Room dimensions
- Ceiling height if noted
- Floor material/finish
- Openings in this room's walls
- Wall type indicators if noted

Use JSON-safe size strings like "2ft-6in x 6ft-8in". Do not use raw inch quote characters in JSON values.

Return ONLY valid JSON:
{
  "room_name": "string",
  "dimensions": "WxD string",
  "ceiling_height_ft": number or null,
  "floor_material": "string or null",
  "openings": [{"type": "door|window|sliding_door", "size": "WxH or null", "tag": "string or null", "wall": "string or null", "quantity": 1}],
  "wall_type": "2x6 or 2x4 or null",
  "notes": ["string"]
}`,

  general_notes: `This is a General Notes or specifications page from a residential blueprint. Extract:
- Energy code version
- Climate zone
- Insulation requirements by location (walls, ceiling, floor, foundation)
- Vapor barrier requirements
- Air sealing requirements
- Attic baffle / ventilation requirements
- Window/door U-factor or performance requirements
- Any R-value tables

Only capture insulation requirements and window performance values that are explicitly visible on the page.

Return as JSON:
{
  "energy_code": "string",
  "climate_zone": number,
  "insulation_requirements": [{"location": "string", "r_value": number, "type": "string"}],
  "vapor_barrier": "string",
  "air_sealing_notes": ["string"],
  "baffles_or_venting": ["string"],
  "window_requirements": "string",
  "general_notes": ["string"]
}`,

  opening_reference: `This is a residential blueprint page that may contain windows, doors, elevations, schedules, or plan-view opening references.

Extract ONLY opening information that is explicitly visible:
- window or door tags / type IDs
- explicit sizes
- repeated quantity hints
- opening descriptions or schedule labels

Use JSON-safe size strings like "3050", "24in x 80in", "36 x 56", "3/0 x 5/6", or "2ft-6in x 4ft-0in". Do not use raw inch quote characters in JSON values.
Do not guess sizes or quantities that are not clearly shown.
For schedule tables, read across the same row and pair the tag/type ID with its SIZE column value. Do not use values from another row.
Do not return a schedule row unless both the tag/type ID and the size are readable. If the tag is readable but the size is not, put a short explanation in opening_notes instead.
If the table has many repeated rows, preserve each visible row with its own tag and size; do not collapse rows by type.

Return as JSON:
{
  "window_schedule": [{"type_id": "string or null", "room": "string or null", "size": "string or null", "description": "string or null", "quantity": number or null, "confidence": number}],
  "door_schedule": [{"type_id": "string or null", "room": "string or null", "size": "string or null", "description": "string or null", "quantity": number or null, "confidence": number}],
  "opening_notes": ["string"],
  "count_confidence": "high|medium|low"
}
Only include values you can actually read.`,

  opening_schedule: `This is a HIGH-RESOLUTION image of a residential blueprint schedule sheet. Your only job is to transcribe WINDOW and DOOR schedule table rows accurately.

Read table columns row-by-row. Common column names include:
- WINDOW NO., DOOR NO., MARK, TAG, TYPE, ID
- ROOM
- SIZE
- TYPE or DESCRIPTION
- SASHES, SILL HEIGHT, TEMPERED, REMARKS

Critical rules:
- The SIZE column is authoritative. For example, if row 101.A has SIZE 24in x 80in, return exactly "24in x 80in" for 101.A.
- Do NOT convert a schedule size into a compact code. Do NOT return "2040" for a row that says 24in x 80in.
- Do NOT infer size from tag, type, room, nearby graphics, or another row.
- Do NOT use values from another row. Each output row must pair the tag with the SIZE on the same horizontal table row.
- Do NOT return a row unless BOTH tag and size are readable.
- If a tag is readable but its size is not readable, put a note in opening_notes instead of returning the row.
- Preserve repeated rows separately when they have different tags.
- Convert raw inch quote marks to JSON-safe "in" text, for example 24" x 80" becomes "24in x 80in".
- Preserve no-unit table values exactly, for example "36 x 56".

Return ONLY valid JSON:
{
  "window_schedule": [{"type_id": "101.A", "room": "FOYER", "size": "24in x 80in", "description": "FIXED", "quantity": 1, "confidence": 0.0}],
  "door_schedule": [{"type_id": "D1", "room": "ENTRY", "size": "3ft-0in x 6ft-8in", "description": "string or null", "quantity": 1, "confidence": 0.0}],
  "opening_notes": ["string"]
}

Only include values visible in the table.`,
};

const FRAGMENT_DETECTION_PROMPT = `You are analyzing a residential blueprint page that may contain multiple detail boxes, note boxes, schedules, or section views.

Identify the most important insulation-takeoff fragments on this page. A fragment should be a self-contained text/diagram block that can be cropped and analyzed independently.

For each fragment, return:
1. label: short visible title or best description
2. fragment_type: one of "construction_details", "building_sections", "general_notes", "opening_reference"
3. confidence: 0.0-1.0
4. bbox: crop rectangle as percentages of the full image
   - x: left
   - y: top
   - width
   - height

Rules:
- Return at most 8 fragments.
- Prefer note boxes and detail views that contain insulation assemblies, R-values, wall sections, roof/ceiling/floor details, schedules, or opening references.
- Avoid returning the entire page as one fragment.
- Avoid heavy overlap. If two fragments overlap a lot, keep the tighter one.
- Bounding boxes should be generous enough to include the text and associated diagram.
- If the page does not have useful sub-fragments, return [].

Return ONLY a valid JSON array:
[
  {
    "label": "Exterior Wall Construction",
    "fragment_type": "construction_details",
    "confidence": 0.92,
    "bbox": { "x": 4.2, "y": 6.1, "width": 22.8, "height": 17.4 }
  }
]`;

async function callVisionWithImage(
  imageBase64: string,
  prompt: string,
  maxTokens = 4096,
) {
  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

function extractJsonBlock(text: string, shape: 'array' | 'object') {
  const match =
    shape === 'array' ? text.match(/\[[\s\S]*\]/) : text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return match[0];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampBBox(bbox: Partial<BBox> | undefined): BBox | null {
  if (!bbox) return null;
  if (
    typeof bbox.x !== 'number' ||
    typeof bbox.y !== 'number' ||
    typeof bbox.width !== 'number' ||
    typeof bbox.height !== 'number'
  ) {
    return null;
  }

  const looksNormalized =
    bbox.x <= 1 &&
    bbox.y <= 1 &&
    bbox.width <= 1 &&
    bbox.height <= 1;

  const scale = looksNormalized ? 100 : 1;

  return {
    x: clamp(bbox.x * scale, 0, 100),
    y: clamp(bbox.y * scale, 0, 100),
    width: clamp(bbox.width * scale, 1, 100),
    height: clamp(bbox.height * scale, 1, 100),
  };
}

function iou(a: BBox, b: BBox) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const intersectionWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const intersectionHeight = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = intersectionWidth * intersectionHeight;
  if (intersection === 0) return 0;

  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

async function cropImageBase64(imageBase64: string, bbox: BBox) {
  const inputBuffer = Buffer.from(imageBase64, 'base64');
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions for crop');
  }

  const rawLeft = Math.max(0, Math.round((bbox.x / 100) * metadata.width));
  const rawTop = Math.max(0, Math.round((bbox.y / 100) * metadata.height));
  const rawWidth = Math.max(
    32,
    Math.min(metadata.width - rawLeft, Math.round((bbox.width / 100) * metadata.width)),
  );
  const rawHeight = Math.max(
    32,
    Math.min(metadata.height - rawTop, Math.round((bbox.height / 100) * metadata.height)),
  );

  const padX = Math.max(24, Math.round(rawWidth * 0.08));
  const padY = Math.max(24, Math.round(rawHeight * 0.08));
  const left = Math.max(0, rawLeft - padX);
  const top = Math.max(0, rawTop - padY);
  const right = Math.min(metadata.width, rawLeft + rawWidth + padX);
  const bottom = Math.min(metadata.height, rawTop + rawHeight + padY);
  const width = Math.max(32, right - left);
  const height = Math.max(32, bottom - top);

  const croppedBuffer = await sharp(inputBuffer)
    .extract({ left, top, width, height })
    .jpeg({ quality: 92 })
    .toBuffer();

  return croppedBuffer.toString('base64');
}

async function analyzeSinglePromptType(
  imageBase64: string,
  pageType: FragmentPromptType,
  pageText?: string | null,
) {
  const textLayer =
    pageText && pageText.trim()
      ? `\n\nPDF TEXT LAYER FOR THIS PAGE:\n${pageText.trim().slice(0, 20000)}\n\nWhen the PDF text layer and image disagree, prefer the PDF text layer for exact schedule row text and use the image only to understand table structure.`
      : '';
  const prompt = `${prompts[pageType]}${textLayer}`;
  const raw = await callVisionWithImage(imageBase64, prompt, pageType === 'opening_schedule' ? 8192 : 4096);
  const jsonBlock = extractJsonBlock(raw, 'object');
  if (!jsonBlock) {
    return { data: null, raw };
  }

  try {
    return { data: JSON.parse(jsonBlock), raw };
  } catch {
    return { data: null, raw };
  }
}

async function detectDetailFragments(imageBase64: string) {
  const raw = await callVisionWithImage(imageBase64, FRAGMENT_DETECTION_PROMPT, 2048);
  const jsonBlock = extractJsonBlock(raw, 'array');
  if (!jsonBlock) {
    return { fragments: [] as DetailFragment[], raw };
  }

  let parsed: Array<{
    label?: string;
    fragment_type?: string;
    confidence?: number;
    bbox?: Partial<BBox>;
  }> = [];

  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return { fragments: [] as DetailFragment[], raw };
  }

  const validated: DetailFragment[] = [];
  for (const candidate of parsed) {
    if (
      !candidate.label ||
      typeof candidate.label !== 'string' ||
      !candidate.fragment_type ||
      !FRAGMENT_PROMPT_TYPES.includes(candidate.fragment_type as FragmentPromptType)
    ) {
      continue;
    }

    const bbox = clampBBox(candidate.bbox);
    if (!bbox) continue;

    const fragment: DetailFragment = {
      id: crypto.randomUUID(),
      label: candidate.label.trim(),
      fragment_type: candidate.fragment_type as FragmentPromptType,
      confidence: clamp(candidate.confidence ?? 0.6, 0, 1),
      bbox,
    };

    const overlapsExisting = validated.some((existing) => iou(existing.bbox, fragment.bbox) > 0.7);
    if (overlapsExisting) continue;

    validated.push(fragment);
    if (validated.length >= 8) break;
  }

  validated.sort((a, b) => {
    if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
    return a.bbox.x - b.bbox.x;
  });

  return { fragments: validated, raw };
}

function pushUniqueString(target: string[], value: unknown) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!target.includes(trimmed)) target.push(trimmed);
}

function normalizeRValueToken(match: string) {
  const cleaned = match.replace(/\s+/g, '');
  const normalized = cleaned.replace(/^R\s*[-=]?\s*/i, '');
  const numeric = normalized.match(/^(\d+(?:\.\d+)?)/);
  if (numeric && Number(numeric[1]) <= 0) return null;
  return normalized ? `R-${normalized.toUpperCase()}` : null;
}

function hasInsulationRValueContext(input: string) {
  return /\b(?:insulat|batt|blown|cellulose|fiberglass|mineral\s*wool|rockwool|spray\s*foam|rigid|foam\s*board|wall|ceiling|attic|vault|cathedral|floor|foundation|crawl|slab|rim|thermal|energy|vapor|air\s*barrier|baffle|venting)\b/i.test(input);
}

function collectRValueStrings(input: unknown, bucket: string[]) {
  if (typeof input === 'string') {
    if (!hasInsulationRValueContext(input)) return;

    const matches = input.match(/R\s*[-=]?\s*\d+(?:\s*\+\s*\d+\s*ci)?/gi) ?? [];
    for (const match of matches) {
      const normalized = normalizeRValueToken(match);
      pushUniqueString(bucket, normalized);
    }
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) collectRValueStrings(item, bucket);
    return;
  }

  if (input && typeof input === 'object') {
    for (const value of Object.values(input)) collectRValueStrings(value, bucket);
  }
}

function collectInsulationTypeStrings(input: unknown, bucket: string[]) {
  const patterns = [
    /\b(?:batt insulation|kraft-faced batt|unfaced batt|faced batt|batt|blown cellulose|blown fiberglass|blown-in blanket|loose-fill|loose fill|dense-pack|dense pack|spray foam|open-cell spray foam|closed-cell spray foam|rigid board|foam board|cellulose|fiberglass|mineral wool|rockwool)\b/gi,
  ];

  if (typeof input === 'string') {
    for (const pattern of patterns) {
      const matches = input.match(pattern) ?? [];
      for (const match of matches) {
        pushUniqueString(bucket, match.toLowerCase());
      }
    }
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) collectInsulationTypeStrings(item, bucket);
    return;
  }

  if (input && typeof input === 'object') {
    for (const value of Object.values(input)) collectInsulationTypeStrings(value, bucket);
  }
}

function compileFragmentAnalyses(
  pageType: DetailPageType,
  fragments: Array<{
    fragment: DetailFragment;
    data: Record<string, unknown> | null;
  }>,
) {
  if (pageType !== 'fragmented_details') {
    return null;
  }

  const compiled = {
    wall_sections: [] as Array<Record<string, unknown>>,
    sections: [] as Array<Record<string, unknown>>,
    heights: [] as Array<Record<string, unknown>>,
    insulation_callouts: [] as Array<Record<string, unknown>>,
    insulation_requirements: [] as Array<Record<string, unknown>>,
    ceiling_insulation: [] as Array<Record<string, unknown>>,
    floor_insulation: [] as Array<Record<string, unknown>>,
    foundations: [] as Array<Record<string, unknown>>,
    window_schedule: [] as Array<Record<string, unknown>>,
    door_schedule: [] as Array<Record<string, unknown>>,
    opening_notes: [] as Array<Record<string, unknown>>,
    general_notes: [] as Array<Record<string, unknown>>,
    derived_r_values: [] as string[],
    derived_insulation_types: [] as string[],
    derived_roof_pitches: [] as string[],
    derived_vapor_barriers: [] as string[],
    derived_air_barriers: [] as string[],
    derived_baffles_or_venting: [] as string[],
  };

  for (const item of fragments) {
    const data = item.data;
    if (!data) continue;

    const sourceMeta = {
      source_fragment_id: item.fragment.id,
      source_label: item.fragment.label,
      source_bbox: item.fragment.bbox,
      source_type: item.fragment.fragment_type,
    };

    const attachSource = (entry: unknown) =>
      entry && typeof entry === 'object'
        ? { ...(entry as Record<string, unknown>), ...sourceMeta }
        : { value: entry, ...sourceMeta };

    for (const section of Array.isArray(data.wall_sections) ? data.wall_sections : []) {
      compiled.wall_sections.push(attachSource(section));
    }

    for (const section of Array.isArray(data.sections) ? data.sections : []) {
      compiled.sections.push(attachSource(section));
    }

    for (const height of Array.isArray(data.heights) ? data.heights : []) {
      compiled.heights.push(attachSource(height));
    }

    for (const callout of Array.isArray(data.insulation_callouts) ? data.insulation_callouts : []) {
      compiled.insulation_callouts.push(attachSource(callout));
    }

    for (
      const requirement of Array.isArray(data.insulation_requirements)
        ? data.insulation_requirements
        : []
    ) {
      compiled.insulation_requirements.push(attachSource(requirement));
    }

    if (data.ceiling_insulation && typeof data.ceiling_insulation === 'object') {
      compiled.ceiling_insulation.push(attachSource(data.ceiling_insulation));
    }

    if (data.floor_insulation && typeof data.floor_insulation === 'object') {
      compiled.floor_insulation.push(attachSource(data.floor_insulation));
    }

    if (data.foundation && typeof data.foundation === 'object') {
      compiled.foundations.push(attachSource(data.foundation));
    }

    for (const windowItem of Array.isArray(data.window_schedule) ? data.window_schedule : []) {
      compiled.window_schedule.push(attachSource(windowItem));
    }

    for (const doorItem of Array.isArray(data.door_schedule) ? data.door_schedule : []) {
      compiled.door_schedule.push(attachSource(doorItem));
    }

    for (const note of Array.isArray(data.opening_notes) ? data.opening_notes : []) {
      compiled.opening_notes.push(attachSource(note));
    }

    for (const note of Array.isArray(data.general_notes) ? data.general_notes : []) {
      compiled.general_notes.push(attachSource(note));
    }

    collectRValueStrings(data, compiled.derived_r_values);
    collectInsulationTypeStrings(data, compiled.derived_insulation_types);
    for (const value of extractRoofPitchStrings(data)) pushUniqueString(compiled.derived_roof_pitches, value);
    for (const value of extractVaporBarrierStrings(data)) pushUniqueString(compiled.derived_vapor_barriers, value);
    for (const value of extractAirBarrierStrings(data)) pushUniqueString(compiled.derived_air_barriers, value);
    for (const value of extractBaffleOrVentingStrings(data)) {
      pushUniqueString(compiled.derived_baffles_or_venting, value);
    }
  }

  return compiled;
}

async function analyzeFragmentedDetails(imageBase64: string) {
  const detection = await detectDetailFragments(imageBase64);
  const fragmentResults = [];

  for (const fragment of detection.fragments) {
    const cropBase64 = await cropImageBase64(imageBase64, fragment.bbox);
    const analyzed = await analyzeSinglePromptType(cropBase64, fragment.fragment_type);
    fragmentResults.push({
      fragment,
      data: analyzed.data as Record<string, unknown> | null,
      raw: analyzed.raw,
    });
  }

  return {
    detection_raw: detection.raw,
    fragments: fragmentResults,
    compiled: compileFragmentAnalyses('fragmented_details', fragmentResults),
  };
}

/**
 * POST /api/takeoff/analyze-page-details
 * Send a blueprint page image to Claude Vision to extract construction specs,
 * schedules, and details.
 */
export async function POST(request: NextRequest) {
  try {
    await requireServerCompanyId();
    const body = await request.json();
    const { image_base64, page_type, page_text } = body as {
      image_base64: string;
      page_type: DetailPageType;
      page_text?: string | null;
    };

    if (!image_base64) {
      return NextResponse.json({ error: 'image_base64 required' }, { status: 400 });
    }

    if (page_type === 'fragmented_details') {
      const fragmented = await analyzeFragmentedDetails(image_base64);
      return NextResponse.json({ success: true, data: fragmented });
    }

    const analyzed = await analyzeSinglePromptType(image_base64, page_type, page_text);
    return NextResponse.json({ success: true, data: analyzed.data, raw: analyzed.raw });
  } catch (err) {
    const authResponse = authApiErrorResponse(err);
    if (authResponse.status !== 500) return authResponse;

    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[takeoff/analyze-page-details] failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
