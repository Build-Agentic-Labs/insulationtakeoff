import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

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

const PROMPTS = {
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

function renderPdfPage(pdfPath, pageNumber) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-detail-eval-'));
  const prefix = path.join(tmpDir, 'page');
  execFileSync(
    '/opt/homebrew/bin/pdftoppm',
    ['-jpeg', '-r', '120', '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, prefix],
    { stdio: 'ignore' },
  );

  const file = fs
    .readdirSync(tmpDir)
    .find((name) => name.endsWith('.jpg'));

  if (!file) {
    throw new Error(`Failed to render page ${pageNumber}`);
  }

  return fs.readFileSync(path.join(tmpDir, file)).toString('base64');
}

async function main() {
  const pdfPath = process.argv[2];
  const pageNumber = Number(process.argv[3] ?? '1');
  const pageType = process.argv[4] ?? 'construction_details';

  if (!pdfPath) {
    throw new Error(
      'Usage: node scripts/eval-page-detail-extraction.mjs <pdf-path> <page-number> <construction_details|building_sections|general_notes|opening_reference>',
    );
  }

  const env = readEnvFile('/Users/rosendolopez/evinsulation/Insulation/.env.local');
  const apiKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY missing from .env.local');
  }

  const prompt = PROMPTS[pageType];
  if (!prompt) {
    throw new Error(`Unsupported page type: ${pageType}`);
  }

  const imageBase64 = renderPdfPage(pdfPath, pageNumber);
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
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

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

  console.log(
    JSON.stringify(
      {
        pdf: path.basename(pdfPath),
        page_number: pageNumber,
        page_type: pageType,
        parsed,
        raw_preview: text.slice(0, 2000),
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
