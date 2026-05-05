import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

function readEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
      }),
  );
}

const FRAGMENT_PROMPT_TYPES = [
  'construction_details',
  'building_sections',
  'general_notes',
  'opening_reference',
];

const prompts = {
  construction_details: `This is a Construction Details page from a residential blueprint. Extract ALL information you can find about:
- Wall assemblies (framing type, insulation spec, vapor barrier, sheathing)
- Ceiling/attic insulation specifications
- Floor insulation specifications
- Foundation details
- Any R-value callouts
- Window/door schedules if present
- Energy code references
- Any notes about insulation, air sealing, or vapor barriers

Only capture insulation information that is explicitly visible. Do not infer R-values or insulation types from generic construction details.
For all opening sizes, return JSON-safe size strings like "3050" or "2ft-6in x 6ft-8in". Do not use raw inch quote characters in JSON values.

Return as JSON:
{
  "wall_sections": [{"name": "string", "framing": "2x4 or 2x6", "insulation_spec": "R-value and type", "vapor_barrier": true/false, "notes": "string"}],
  "ceiling_insulation": {"spec": "string", "r_value": number},
  "floor_insulation": {"spec": "string", "r_value": number},
  "foundation": {"type": "string", "insulation": "string"},
  "window_schedule": [{"type_id": "string", "size": "JSON-safe size string", "type_description": "string", "quantity": number}],
  "door_schedule": [{"type_id": "string", "size": "JSON-safe size string", "type_description": "string", "quantity": number}],
  "general_notes": ["string"],
  "energy_code": "string",
  "climate_zone": number
}
Only include fields you can actually read. If something is not visible, omit it.`,

  building_sections: `This is a Building Sections page from a residential blueprint. Extract:
- Wall heights at different locations
- Ceiling heights
- Roof pitch/slope
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

  general_notes: `This is a General Notes or specifications page from a residential blueprint. Extract:
- Energy code version
- Climate zone
- Insulation requirements by location (walls, ceiling, floor, foundation)
- Vapor barrier requirements
- Air sealing requirements
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
  "window_requirements": "string",
  "general_notes": ["string"]
}`,

  opening_reference: `This is a residential blueprint page that may contain windows, doors, elevations, schedules, or plan-view opening references.

Extract ONLY opening information that is explicitly visible:
- window or door tags / type IDs
- explicit sizes
- repeated quantity hints
- opening descriptions or schedule labels

Use JSON-safe size strings like "3050" or "2ft-6in x 4ft-0in". Do not use raw inch quote characters in JSON values.
Do not guess sizes or quantities that are not clearly shown.

Return as JSON:
{
  "window_schedule": [{"type_id": "string or null", "size": "string or null", "description": "string or null", "quantity": number or null}],
  "door_schedule": [{"type_id": "string or null", "size": "string or null", "description": "string or null", "quantity": number or null}],
  "opening_notes": ["string"],
  "count_confidence": "high|medium|low"
}
Only include values you can actually read.`,
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

Return ONLY a valid JSON array.`;

function extractJsonBlock(text, shape) {
  const match =
    shape === 'array' ? text.match(/\[[\s\S]*\]/) : text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampBBox(bbox) {
  if (
    !bbox ||
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

function iou(a, b) {
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

function pushUniqueString(target, value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed || target.includes(trimmed)) return;
  target.push(trimmed);
}

function collectRValueStrings(input, bucket) {
  if (typeof input === 'string') {
    const matches = input.match(/R-\d+(?:\s*\+\s*\d+\s*ci)?/gi) ?? [];
    for (const match of matches) pushUniqueString(bucket, match.replace(/\s+/g, ' ').toUpperCase());
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

function collectInsulationTypeStrings(input, bucket) {
  const pattern =
    /\b(?:batt insulation|batt|blown cellulose|blown fiberglass|spray foam|open-cell spray foam|closed-cell spray foam|rigid board|foam board|cellulose|fiberglass|mineral wool)\b/gi;

  if (typeof input === 'string') {
    const matches = input.match(pattern) ?? [];
    for (const match of matches) pushUniqueString(bucket, match.toLowerCase());
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

function compileFragmentAnalyses(fragments) {
  const compiled = {
    wall_sections: [],
    sections: [],
    heights: [],
    insulation_callouts: [],
    insulation_requirements: [],
    ceiling_insulation: [],
    floor_insulation: [],
    foundations: [],
    window_schedule: [],
    door_schedule: [],
    opening_notes: [],
    general_notes: [],
    derived_r_values: [],
    derived_insulation_types: [],
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

    const attachSource = (entry) =>
      entry && typeof entry === 'object' ? { ...entry, ...sourceMeta } : { value: entry, ...sourceMeta };

    for (const value of Array.isArray(data.wall_sections) ? data.wall_sections : []) compiled.wall_sections.push(attachSource(value));
    for (const value of Array.isArray(data.sections) ? data.sections : []) compiled.sections.push(attachSource(value));
    for (const value of Array.isArray(data.heights) ? data.heights : []) compiled.heights.push(attachSource(value));
    for (const value of Array.isArray(data.insulation_callouts) ? data.insulation_callouts : []) compiled.insulation_callouts.push(attachSource(value));
    for (const value of Array.isArray(data.insulation_requirements) ? data.insulation_requirements : []) compiled.insulation_requirements.push(attachSource(value));
    if (data.ceiling_insulation && typeof data.ceiling_insulation === 'object') compiled.ceiling_insulation.push(attachSource(data.ceiling_insulation));
    if (data.floor_insulation && typeof data.floor_insulation === 'object') compiled.floor_insulation.push(attachSource(data.floor_insulation));
    if (data.foundation && typeof data.foundation === 'object') compiled.foundations.push(attachSource(data.foundation));
    for (const value of Array.isArray(data.window_schedule) ? data.window_schedule : []) compiled.window_schedule.push(attachSource(value));
    for (const value of Array.isArray(data.door_schedule) ? data.door_schedule : []) compiled.door_schedule.push(attachSource(value));
    for (const value of Array.isArray(data.opening_notes) ? data.opening_notes : []) compiled.opening_notes.push(attachSource(value));
    for (const value of Array.isArray(data.general_notes) ? data.general_notes : []) compiled.general_notes.push(attachSource(value));

    collectRValueStrings(data, compiled.derived_r_values);
    collectInsulationTypeStrings(data, compiled.derived_insulation_types);
  }

  return compiled;
}

async function callVisionWithImage(anthropic, imageBase64, prompt, maxTokens = 4096) {
  const response = await anthropic.messages.create({
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

  return response.content[0]?.type === 'text' ? response.content[0].text : '';
}

function renderPdfPage(pdfPath, pageNumber) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-fragmented-eval-'));
  const prefix = path.join(tmpDir, 'page');
  execFileSync(
    '/opt/homebrew/bin/pdftoppm',
    ['-jpeg', '-r', '160', '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, prefix],
    { stdio: 'ignore' },
  );
  const file = fs.readdirSync(tmpDir).find((name) => name.endsWith('.jpg'));
  if (!file) throw new Error(`Failed to render page ${pageNumber}`);
  return fs.readFileSync(path.join(tmpDir, file)).toString('base64');
}

async function cropImageBase64(imageBase64, bbox) {
  const inputBuffer = Buffer.from(imageBase64, 'base64');
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Could not read image dimensions for crop');

  const left = Math.max(0, Math.round((bbox.x / 100) * metadata.width));
  const top = Math.max(0, Math.round((bbox.y / 100) * metadata.height));
  const width = Math.max(32, Math.min(metadata.width - left, Math.round((bbox.width / 100) * metadata.width)));
  const height = Math.max(32, Math.min(metadata.height - top, Math.round((bbox.height / 100) * metadata.height)));

  const cropped = await sharp(inputBuffer)
    .extract({ left, top, width, height })
    .jpeg({ quality: 92 })
    .toBuffer();

  return cropped.toString('base64');
}

async function main() {
  const pdfPath = process.argv[2];
  const pageNumber = Number(process.argv[3] ?? '1');
  const maxFragments = Number(process.argv[4] ?? '3');
  if (!pdfPath) {
    throw new Error('Usage: node scripts/eval-fragmented-page-details.mjs <pdf-path> <page-number> [max-fragments]');
  }

  const env = readEnvFile('/Users/rosendolopez/evinsulation/Insulation/.env.local');
  const apiKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const anthropic = new Anthropic({ apiKey });
  const pageImageBase64 = renderPdfPage(pdfPath, pageNumber);

  const detectionRaw = await callVisionWithImage(anthropic, pageImageBase64, FRAGMENT_DETECTION_PROMPT, 2048);
  const detectionBlock = extractJsonBlock(detectionRaw, 'array');
  const candidates = detectionBlock ? JSON.parse(detectionBlock) : [];

  const fragments = [];
  for (const candidate of candidates) {
    if (
      !candidate.label ||
      typeof candidate.label !== 'string' ||
      !FRAGMENT_PROMPT_TYPES.includes(candidate.fragment_type)
    ) {
      continue;
    }

    const bbox = clampBBox(candidate.bbox);
    if (!bbox) continue;

    const fragment = {
      id: crypto.randomUUID(),
      label: candidate.label.trim(),
      fragment_type: candidate.fragment_type,
      confidence: clamp(candidate.confidence ?? 0.6, 0, 1),
      bbox,
    };

    if (fragments.some((existing) => iou(existing.bbox, fragment.bbox) > 0.7)) continue;
    fragments.push(fragment);
    if (fragments.length >= maxFragments) break;
  }

  const fragmentResults = [];
  for (const fragment of fragments) {
    const cropBase64 = await cropImageBase64(pageImageBase64, fragment.bbox);
    const raw = await callVisionWithImage(anthropic, cropBase64, prompts[fragment.fragment_type], 4096);
    const jsonBlock = extractJsonBlock(raw, 'object');
    let data = null;
    if (jsonBlock) {
      try {
        data = JSON.parse(jsonBlock);
      } catch {
        data = null;
      }
    }

    fragmentResults.push({
      fragment,
      data,
      raw_preview: raw.slice(0, 1200),
    });
  }

  const compiled = compileFragmentAnalyses(fragmentResults);

  console.log(
    JSON.stringify(
      {
        pdf: path.basename(pdfPath),
        page_number: pageNumber,
        max_fragments: maxFragments,
        detection_raw_preview: detectionRaw.slice(0, 1200),
        fragments: fragmentResults,
        compiled,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
