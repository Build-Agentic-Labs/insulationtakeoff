import { NextRequest, NextResponse } from 'next/server';
import { analyzeMultipleImages } from '@/lib/ai/claude-client';
import {
  buildSafeRoofPitchResult,
  sanitizeRoofPitchComponent,
  type RoofPitchVisionResult,
} from '@/lib/takeoff/roof-pitch';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';

interface VisionRequestBody {
  images: string[];
}

const MAX_IMAGES = 2;
const MAX_IMAGE_BASE64_LENGTH = 4_000_000;

const ROOF_PITCH_PROMPT = `You are reading a cropped architectural blueprint note for a single roof pitch or roof slope callout.

You may receive two images:
1. The full crop the user selected.
2. A top-focused crop that emphasizes the text note.

Your job is to identify the roof pitch from the printed note.

Important rules:
- Focus on the printed roof pitch text itself, not nearby framing notes, beam sizes, member callouts, dimensions, or section labels.
- This tool is only for roof pitch or slope notes. Do not read room labels, wall dimensions, truss spacing, headers, or arbitrary blueprint text.
- Return raw_text as the shortest exact note snippet that contains the roof pitch.
- Common roof pitch notations include:
  - 7/12
  - 6/12
  - 4:12
  - 7 in 12
- If the crop does not contain exactly one roof pitch note, return rise and run as null.
- Never infer pitch from geometry alone.
- Be conservative. Only report confidence above 0.82 when the note is clearly legible and very likely correct.

Return ONLY valid JSON with this exact shape:
{
  "raw_text": "string",
  "rise": number | null,
  "run": number | null,
  "confidence": number
}

confidence must be between 0 and 1.
Do not return markdown.`;

function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export async function POST(request: NextRequest) {
  try {
    await requireServerCompanyId();
    const body = (await request.json()) as VisionRequestBody;
    const images = Array.isArray(body.images)
      ? body.images.filter((image): image is string => typeof image === 'string' && image.length > 0)
      : [];

    if (images.length === 0) {
      return NextResponse.json({ error: 'images array is required' }, { status: 400 });
    }

    if (images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `a maximum of ${MAX_IMAGES} images is allowed` }, { status: 400 });
    }

    if (images.some((image) => image.length > MAX_IMAGE_BASE64_LENGTH)) {
      return NextResponse.json({ error: 'image payload is too large' }, { status: 400 });
    }

    const rawResponse = await analyzeMultipleImages(
      images.map((data) => ({ data, mediaType: 'image/jpeg' })),
      ROOF_PITCH_PROMPT,
    );

    const jsonText = extractJsonObject(rawResponse);
    if (!jsonText) {
      return NextResponse.json<RoofPitchVisionResult>({
        raw_text: '',
        rise: null,
        run: null,
        confidence: 0,
        disposition: 'ambiguous',
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return NextResponse.json<RoofPitchVisionResult>({
        raw_text: '',
        rise: null,
        run: null,
        confidence: 0,
        disposition: 'ambiguous',
      });
    }

    return NextResponse.json<RoofPitchVisionResult>(
      buildSafeRoofPitchResult(
        typeof parsed.raw_text === 'string' ? parsed.raw_text : '',
        sanitizeRoofPitchComponent(parsed.rise),
        sanitizeRoofPitchComponent(parsed.run),
        parsed.confidence,
      ),
    );
  } catch (error) {
    const authResponse = authApiErrorResponse(error);
    if (authResponse.status !== 500) return authResponse;

    const message = error instanceof Error ? error.message : 'Unknown roof pitch vision error';
    console.error('[detect-roof-pitch] Vision request failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
