import { NextRequest, NextResponse } from 'next/server';
import { analyzeMultipleImages } from '@/lib/ai/claude-client';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import {
  buildSafeDoorVisionResult,
  DEFAULT_DOOR_TYPE,
  DOOR_DIMENSION_PROMPT,
  extractJsonObject,
  sanitizeDimension,
  sanitizeDoorDesignation,
  sanitizeDoorDimensionFormat,
  sanitizeDoorType,
  type DoorVisionResult,
} from '@/lib/takeoff/door-note-parser';

interface VisionRequestBody {
  images: string[];
}

const MAX_IMAGES = 2;
const MAX_IMAGE_BASE64_LENGTH = 4_000_000;

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
      DOOR_DIMENSION_PROMPT,
    );

    const jsonText = extractJsonObject(rawResponse);
    if (!jsonText) {
      return NextResponse.json<DoorVisionResult>({
        raw_text: '',
        width_ft: null,
        height_ft: null,
        opening_type: DEFAULT_DOOR_TYPE,
        designation_raw: null,
        designation_normalized: 'unknown',
        dimension_format: 'unknown',
        confidence: 0,
        disposition: 'ambiguous',
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return NextResponse.json<DoorVisionResult>({
        raw_text: '',
        width_ft: null,
        height_ft: null,
        opening_type: DEFAULT_DOOR_TYPE,
        designation_raw: null,
        designation_normalized: 'unknown',
        dimension_format: 'unknown',
        confidence: 0,
        disposition: 'ambiguous',
      });
    }

    return NextResponse.json<DoorVisionResult>(
      buildSafeDoorVisionResult(
        typeof parsed.raw_text === 'string' ? parsed.raw_text : '',
        sanitizeDimension(parsed.width_ft),
        sanitizeDimension(parsed.height_ft),
        sanitizeDoorType(parsed.opening_type),
        parsed.confidence,
        typeof parsed.designation_raw === 'string' ? parsed.designation_raw : null,
        sanitizeDoorDesignation(parsed.designation_normalized),
        sanitizeDoorDimensionFormat(parsed.dimension_format),
      ),
    );
  } catch (error) {
    const authResponse = authApiErrorResponse(error);
    if (authResponse.status !== 500) return authResponse;

    const message = error instanceof Error ? error.message : 'Unknown door vision error';
    console.error('[detect-door-dimensions] Vision request failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
