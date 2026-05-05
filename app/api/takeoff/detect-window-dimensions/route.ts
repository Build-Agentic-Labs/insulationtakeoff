import { NextRequest, NextResponse } from 'next/server';
import { analyzeMultipleImages } from '@/lib/ai/claude-client';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';

interface VisionRequestBody {
  images: string[];
}

interface WindowVisionResult {
  raw_text: string;
  width_ft: number | null;
  height_ft: number | null;
  confidence: number;
  disposition: 'confirmed' | 'ambiguous' | 'invalid_target';
}

interface ParsedWindowTextDimensions {
  widthFt: number;
  heightFt: number;
}

const MAX_IMAGES = 2;
const MAX_IMAGE_BASE64_LENGTH = 4_000_000;
const WINDOW_DIMENSION_TOLERANCE_FT = 0.2;
const WINDOW_DESIGNATION_PATTERN =
  '(?:FIX|FIXED|FX|SL|SLIDER|SLIDING|XO|XOX|OX|OXO|SH|SINGLE(?:\\s+HUNG)?|DH|DOUBLE(?:\\s+HUNG)?|SC|AW|AWN|AWNING|CS|CASE|CASEMENT|CSMT|OBS|OBSCURE|PICT(?:URE)?|PW|TRANSOM|TR|GL)';
const WINDOW_SUFFIX_PATTERN = `(?:${WINDOW_DESIGNATION_PATTERN}|[A-Z]{2,6})`;
const WINDOW_DESIGNATION_CONTEXT_RE = new RegExp(`\\b${WINDOW_SUFFIX_PATTERN}\\b`, 'i');

const WINDOW_DIMENSION_PROMPT = `You are reading a cropped architectural blueprint note for a single window opening.

You may receive two images:
1. The full crop the user selected.
2. A top-focused crop that emphasizes the text note.

Your job is to identify the intended window width and height from the note.

Important rules:
- Focus on the printed note itself, not the wall linework, sash lines, leaders, or nearby geometry.
- This tool is only for compact window size callouts. Do not read general notes, room labels, wall dimensions, door tags, headers, schedules, or arbitrary blueprint text.
- Return raw_text as the shortest exact note snippet that contains the window size code and any immediately adjacent designation words.
- Common window size notations include:
  - 6'0 x 5'0 SL
  - 6/0 x 5/0 SL
  - 2/8 x 4/0 SH
  - 6 x 5
  - 6050
  - 2840
- Window designations may appear after the size and can be abbreviated or spelled out. Common examples include:
  - SL, SLIDER, SLIDING
  - XO, XOX, OX, OXO
  - SH, SINGLE HUNG
  - DH, DOUBLE HUNG
  - SC
  - TS
  - FIX, FIXED, FX
  - CASE, CASEMENT, CS
  - AWN, AWNING, AW
  - OBS, OBSCURE
  - PICTURE, PW
  - TRANSOM, TR
- Short designation suffixes may be attached directly to the size with no space, for example 2050SC or 6044TS.
- If the suffix is an unfamiliar 2-6 letter window designation but the compact size code is clear, still extract the dimensions.
- You should still extract the size even when one of those designations is present.
- The designation itself does not need to be normalized into a separate field, but raw_text should preserve it when it is part of the note.
- Notes may also appear as 30x50 FIX, 30-50 FIX, 3050 DH, 2050SC, 6044TS, 2840 AWN, 24/24 OBS, or 6'0 x 5'0 CASEMENT.
- If the crop does not contain exactly one compact window size note, return width_ft and height_ft as null.
- Never infer a window size from nearby geometry, leaders, wall lengths, room sizes, or surrounding context.
- If the note says 6/0, width_ft should be 6.0.
- If the note says 6050, width_ft should be 6.0 and height_ft should be 5.0.
- If the note says 2040, width_ft should be 2.0 and height_ft should be 4.0.
- If the note says 2050SC, width_ft should be 2.0 and height_ft should be 5.0.
- If the note says 6044TS, width_ft should be 6.0 and height_ft should be 4.333.
- If the note says 2840, width_ft should be 2.667 and height_ft should be 4.0.
- Width and height must be returned in decimal feet.
- If you are not confident, set width_ft and height_ft to null.
- Be conservative. Only report a confidence above 0.82 when the note is clearly legible and the dimensions are very likely correct.

Return ONLY valid JSON with this exact shape:
{
  "raw_text": "string",
  "width_ft": number | null,
  "height_ft": number | null,
  "confidence": number
}

confidence must be between 0 and 1.
Do not return markdown.`;

function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function clampConfidence(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeDimension(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 20) return null;
  return Math.round(value * 1000) / 1000;
}

function sanitizeRawText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
}

function normalizeWindowText(rawText: string) {
  return rawText
    .toUpperCase()
    .replace(/[’`]/g, "'")
    .replace(/[°º⁰]/g, '0')
    .replace(/[OQ]/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeetAndInches(feet: string, inches: string) {
  const feetValue = Number(feet);
  const inchesValue = Number(inches);

  if (!Number.isFinite(feetValue) || !Number.isFinite(inchesValue)) return null;
  if (feetValue < 0 || inchesValue < 0 || inchesValue >= 12) return null;

  return Math.round((feetValue + inchesValue / 12) * 1000) / 1000;
}

function parseWindowCompactCodeToken(token: string) {
  const normalized = token.replace(/\s+/g, '');
  if (!/^\d{2}$/.test(normalized)) return null;
  return parseFeetAndInches(normalized[0], normalized[1]);
}

function parseWindowDimensionToken(token: string) {
  const normalized = token.replace(/\s+/g, '');

  if (/^\d$/.test(normalized)) {
    return Number(normalized);
  }

  const compactCodeMatch = normalized.match(/^(\d{2})$/);
  if (compactCodeMatch) {
    if (compactCodeMatch[1].endsWith('0')) {
      return Number(compactCodeMatch[1][0]);
    }
    return parseWindowCompactCodeToken(compactCodeMatch[1]);
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d)$/);
  if (slashMatch) {
    return parseFeetAndInches(slashMatch[1], slashMatch[2]);
  }

  const primeMatch = normalized.match(/^(\d{1,2})'\s*(\d)"?$/);
  if (primeMatch) {
    return parseFeetAndInches(primeMatch[1], primeMatch[2]);
  }

  const feetOnlyPrimeMatch = normalized.match(/^(\d{1,2})'0"?$/);
  if (feetOnlyPrimeMatch) {
    return Number(feetOnlyPrimeMatch[1]);
  }

  return null;
}

function parseWindowSizeFromRawText(rawText: string): ParsedWindowTextDimensions | null {
  const normalized = normalizeWindowText(rawText);

  const compactWithDesignationMatch = normalized.match(
    new RegExp(`\\b(\\d{2})(\\d{2})(?:\\s*(?:${WINDOW_SUFFIX_PATTERN}))?\\b`),
  );
  if (compactWithDesignationMatch) {
    const widthFt = parseWindowCompactCodeToken(compactWithDesignationMatch[1]);
    const heightFt = parseWindowCompactCodeToken(compactWithDesignationMatch[2]);

    if (widthFt !== null && heightFt !== null) {
      return {
        widthFt,
        heightFt,
      };
    }
  }

  const compactMatch = normalized.match(/\b(\d{2})(\d{2})\b/);
  if (compactMatch) {
    const widthFt = parseWindowCompactCodeToken(compactMatch[1]);
    const heightFt = parseWindowCompactCodeToken(compactMatch[2]);

    if (widthFt === null || heightFt === null) {
      return null;
    }

    return {
      widthFt,
      heightFt,
    };
  }

  const dashMatch = normalized.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
  if (dashMatch && WINDOW_DESIGNATION_CONTEXT_RE.test(normalized)) {
    const widthFt = parseWindowDimensionToken(dashMatch[1]);
    const heightFt = parseWindowDimensionToken(dashMatch[2]);

    if (widthFt !== null && heightFt !== null) {
      return {
        widthFt,
        heightFt,
      };
    }
  }

  const pairedMatch = normalized.match(
    new RegExp(
      `\\b([0-9]{1,2}(?:\\/[0-9]|'[0-9]"?'?|0)?)\\s*[X×]\\s*([0-9]{1,2}(?:\\/[0-9]|'[0-9]"?'?|0)?)(?:\\s*(?:${WINDOW_SUFFIX_PATTERN}))?\\b`,
    ),
  );
  if (!pairedMatch) {
    return null;
  }

  const widthFt = parseWindowDimensionToken(pairedMatch[1]);
  const heightFt = parseWindowDimensionToken(pairedMatch[2]);

  if (widthFt === null || heightFt === null) {
    return null;
  }

  return { widthFt, heightFt };
}

function buildSafeVisionResult(
  rawText: string,
  widthFt: number | null,
  heightFt: number | null,
  confidence: unknown,
): WindowVisionResult {
  const normalizedText = sanitizeRawText(rawText);
  const safeConfidence = clampConfidence(confidence);
  const parsedTextDimensions = parseWindowSizeFromRawText(normalizedText);

  if (!parsedTextDimensions) {
    return {
      raw_text: normalizedText,
      width_ft: null,
      height_ft: null,
      confidence: Math.min(safeConfidence, normalizedText ? 0.1 : 0.25),
      disposition: normalizedText ? 'invalid_target' : 'ambiguous',
    };
  }

  if (widthFt === null || heightFt === null) {
    return {
      raw_text: normalizedText,
      width_ft: null,
      height_ft: null,
      confidence: Math.min(safeConfidence, 0.35),
      disposition: 'ambiguous',
    };
  }

  const widthMatches = Math.abs(parsedTextDimensions.widthFt - widthFt) <= WINDOW_DIMENSION_TOLERANCE_FT;
  const heightMatches = Math.abs(parsedTextDimensions.heightFt - heightFt) <= WINDOW_DIMENSION_TOLERANCE_FT;

  if (!widthMatches || !heightMatches) {
    return {
      raw_text: normalizedText,
      width_ft: null,
      height_ft: null,
      confidence: Math.min(safeConfidence, 0.2),
      disposition: 'ambiguous',
    };
  }

  return {
    raw_text: normalizedText,
    width_ft: widthFt,
    height_ft: heightFt,
    confidence: safeConfidence,
    disposition: 'confirmed',
  };
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
      WINDOW_DIMENSION_PROMPT,
    );

    const jsonText = extractJsonObject(rawResponse);
    if (!jsonText) {
      return NextResponse.json<WindowVisionResult>({
        raw_text: '',
        width_ft: null,
        height_ft: null,
        confidence: 0,
        disposition: 'ambiguous',
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return NextResponse.json<WindowVisionResult>({
        raw_text: '',
        width_ft: null,
        height_ft: null,
        confidence: 0,
        disposition: 'ambiguous',
      });
    }

    return NextResponse.json<WindowVisionResult>(
      buildSafeVisionResult(
        typeof parsed.raw_text === 'string' ? parsed.raw_text : '',
        sanitizeDimension(parsed.width_ft),
        sanitizeDimension(parsed.height_ft),
        parsed.confidence,
      ),
    );
  } catch (error) {
    const authResponse = authApiErrorResponse(error);
    if (authResponse.status !== 500) return authResponse;

    const message = error instanceof Error ? error.message : 'Unknown vision error';
    console.error('[detect-window-dimensions] Vision request failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
