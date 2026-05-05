import type {
  DoorDesignationNormalized,
  DoorDimensionFormat,
  OpeningType,
} from '@/lib/types/takeoff';

export interface DoorVisionResult {
  raw_text: string;
  width_ft: number | null;
  height_ft: number | null;
  opening_type: Exclude<OpeningType, 'window'>;
  designation_raw: string | null;
  designation_normalized: DoorDesignationNormalized;
  dimension_format: DoorDimensionFormat;
  confidence: number;
  disposition: 'confirmed' | 'width_only' | 'ambiguous' | 'invalid_target';
}

export const DEFAULT_DOOR_TYPE: Exclude<OpeningType, 'window'> = 'door';
export const DEFAULT_STANDARD_DOOR_HEIGHT_FT = 6.667;

const DOOR_DIMENSION_TOLERANCE_FT = 0.2;
const PRIME_CHARS = `'"’\`′`;
const DOUBLE_PRIME_CHARS = `"'”″`;
const DIGIT_LIKE_CHARS = '0-9OQBSIL|';
const WIDTH_ONLY_CONTEXT_RE =
  /\b(FRENCH|PAIR|DOUBLE(?:\s+DOOR|\s+DR)?|DBL(?:\s+DOOR|\s+DR)?|METAL|WOOD|HM|H\.?M\.?|DOOR|DR|ENTRY|FRAME|JAMB|C\.?\s*O\.?|OPENING|SC|SELF|CLOSING|RATED|MIN\.?|FIRE|WINDOW\/DOOR|DOOR WALL|WALL SYSTEM|MULTI(?:-|\s)?SLIDE|STACK(?:ED)?|SLID(?:ER|ING)?|SGD|PATIO|POCKET|BARN|BIFOLD|BI(?:-|\s)?FOLD|SERVICE|MAN\s+DOOR|PERSONNEL|ROLL(?:-|\s)?UP|OVHD|OHD|O\/H|OH|OVERHEAD|GARAGE|SECTIONAL)\b/i;

const DOOR_DESIGNATION_PATTERNS: Array<{
  normalized: DoorDesignationNormalized;
  openingType: Exclude<OpeningType, 'window'>;
  pattern: RegExp;
}> = [
  {
    normalized: 'multi_slide',
    openingType: 'sliding_door',
    pattern:
      /\b(WINDOW\/DOOR|DOOR WALL|WALL SYSTEM|MULTI(?:-|\s)?SLIDE|MULTISLIDE|STACK(?:ED)?(?:\s+DOOR|\s+SLIDER)?|PANEL(?:\s+DOOR)?)\b/i,
  },
  {
    normalized: 'rollup',
    openingType: 'garage_door',
    pattern: /\b(ROLL(?:-|\s)?UP|COILING)\b/i,
  },
  {
    normalized: 'garage_overhead',
    openingType: 'garage_door',
    pattern: /\b(O\/H|OH|OVHD|OHD|OVERHEAD|GARAGE|SECTIONAL)\b/i,
  },
  {
    normalized: 'french',
    openingType: 'french_door',
    pattern: /\bFRENCH\b/i,
  },
  {
    normalized: 'pair_double',
    openingType: 'door',
    pattern: /\b(PAIR|DOUBLE(?:\s+DOOR|\s+DR)?|DBL(?:\s+DOOR|\s+DR)?|DOUBLE)\b/i,
  },
  {
    normalized: 'sliding',
    openingType: 'sliding_door',
    pattern: /\b(SLID(?:ER|ING)?|SGD|PATIO)\b/i,
  },
  {
    normalized: 'pocket',
    openingType: 'door',
    pattern: /\bPOCKET\b/i,
  },
  {
    normalized: 'barn',
    openingType: 'door',
    pattern: /\bBARN\b/i,
  },
  {
    normalized: 'bifold',
    openingType: 'door',
    pattern: /\b(BIFOLD|BI(?:-|\s)?FOLD)\b/i,
  },
  {
    normalized: 'cased_opening',
    openingType: 'door_opening',
    pattern: /\b(C\.?\s*O\.?|CASE(?:D)?\s+OPENING|OPENING)\b/i,
  },
  {
    normalized: 'service_man_door',
    openingType: 'door',
    pattern: /\b(MAN\s+DOOR|SERVICE|PERSONNEL)\b/i,
  },
  {
    normalized: 'entry',
    openingType: 'door',
    pattern: /\bENTRY\b/i,
  },
  {
    normalized: 'swing',
    openingType: 'door',
    pattern: /\bSWING\b/i,
  },
];

export const DOOR_DIMENSION_PROMPT = `You are reading a cropped architectural blueprint note for a single door opening.

You may receive two images:
1. The full crop the user selected.
2. A top-focused crop that emphasizes the text note.

Your job is to identify the intended door width, height, opening type, designation, and note format from the printed note.

Important rules:
- Focus on the printed note itself, not the wall linework, swings, nearby geometry, room names, or schedule tables.
- This tool is only for compact door size callouts. Do not read room labels, window tags, wall dimensions, headers, schedules, keynote text, or arbitrary blueprint notes.
- Return raw_text as the shortest exact note snippet that contains the size and any immediately adjacent designation words.
- Common full-size door notations include:
  - 3068
  - 3080
  - 2868 HM
  - 2/8 x 6/8
  - 3'0 x 6'8
  - 3'-0" x 6'-8"
  - 3-0 x 6-8
  - 16'0 x 7'0 OH
  - 16 x 7 OHD
  - 2-3068 DBL
  - 6068 FRENCH
- Common width-only notes include:
  - C.O. 3068
  - 3'0 METAL
  - 3'-0" HM
  - 60 FRENCH
  - 30 SC SELF CLOSING 20 MIN. RATED
  - 16'0 WINDOW/DOOR WALL SYSTEM
- Door designation words may appear as ENTRY, SWING, FRENCH, PAIR, DOUBLE, DBL, SLIDING, SGD, O/H, OH, OVHD, OHD, OVERHEAD, GARAGE, ROLL-UP, BARN, POCKET, BIFOLD, C.O., CASED OPENING, SERVICE, or MAN DOOR.
- Preserve the designation words in raw_text. If a designation is visible, also return it in designation_raw and normalize it into designation_normalized.
- dimension_format must be one of:
  - compact_code
  - leaf_pair_compact
  - slash_pair
  - feet_inches_pair
  - dash_pair
  - feet_only_pair
  - width_only_compact
  - width_only_slash
  - width_only_feet_inches
  - width_only_dash
  - width_only_feet_only
  - unknown
- designation_normalized must be one of:
  - entry
  - swing
  - french
  - pair_double
  - sliding
  - multi_slide
  - garage_overhead
  - rollup
  - barn
  - pocket
  - bifold
  - cased_opening
  - service_man_door
  - unknown
- opening_type must be one of:
  - door
  - french_door
  - garage_door
  - sliding_door
  - door_opening
- Interpret 3068 as width_ft = 3.0 and height_ft = 6.667.
- Interpret 3080 as width_ft = 3.0 and height_ft = 8.0.
- Interpret 60 FRENCH as a width-only note for a 6'0" French door. Return width_ft = 6.0 and height_ft = null.
- Interpret 2-3068 DBL as two 3'0" leaves, so the overall width is 6.0 and the height is 6.667.
- Ignore material and fire-rating qualifiers like METAL, WOOD, HM, SC, SELF CLOSING, RATED, and 20 MIN. when extracting size.
- If the crop does not contain exactly one compact door size note, return width_ft and height_ft as null and dimension_format as "unknown".
- Never infer a door size from nearby geometry or surrounding context.
- Be conservative. Only report confidence above 0.82 when the note is clearly legible and the dimensions are very likely correct.

Return ONLY valid JSON with this exact shape:
{
  "raw_text": "string",
  "width_ft": number | null,
  "height_ft": number | null,
  "opening_type": "door" | "french_door" | "garage_door" | "sliding_door" | "door_opening",
  "designation_raw": "string | null",
  "designation_normalized": "entry" | "swing" | "french" | "pair_double" | "sliding" | "multi_slide" | "garage_overhead" | "rollup" | "barn" | "pocket" | "bifold" | "cased_opening" | "service_man_door" | "unknown",
  "dimension_format": "compact_code" | "leaf_pair_compact" | "slash_pair" | "feet_inches_pair" | "dash_pair" | "feet_only_pair" | "width_only_compact" | "width_only_slash" | "width_only_feet_inches" | "width_only_dash" | "width_only_feet_only" | "unknown",
  "confidence": number
}

confidence must be between 0 and 1.
Do not return markdown.`;

interface ParsedDoorDimensions {
  widthFt: number;
  heightFt: number;
  format: DoorDimensionFormat;
}

interface ParsedDoorWidthOnly {
  widthFt: number;
  format: DoorDimensionFormat;
}

interface ParsedDoorDesignation {
  raw: string | null;
  normalized: DoorDesignationNormalized;
  openingType: Exclude<OpeningType, 'window'>;
}

export function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export function clampConfidence(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function sanitizeDimension(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 30) return null;
  return Math.round(value * 1000) / 1000;
}

export function sanitizeRawText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 96);
}

export function sanitizeDoorType(value: unknown): Exclude<OpeningType, 'window'> {
  switch (value) {
    case 'door':
    case 'french_door':
    case 'garage_door':
    case 'sliding_door':
    case 'door_opening':
      return value;
    default:
      return DEFAULT_DOOR_TYPE;
  }
}

export function sanitizeDoorDesignation(
  value: unknown,
): DoorDesignationNormalized {
  switch (value) {
    case 'entry':
    case 'swing':
    case 'french':
    case 'pair_double':
    case 'sliding':
    case 'multi_slide':
    case 'garage_overhead':
    case 'rollup':
    case 'barn':
    case 'pocket':
    case 'bifold':
    case 'cased_opening':
    case 'service_man_door':
      return value;
    default:
      return 'unknown';
  }
}

export function sanitizeDoorDimensionFormat(
  value: unknown,
): DoorDimensionFormat {
  switch (value) {
    case 'compact_code':
    case 'leaf_pair_compact':
    case 'slash_pair':
    case 'feet_inches_pair':
    case 'dash_pair':
    case 'feet_only_pair':
    case 'width_only_compact':
    case 'width_only_slash':
    case 'width_only_feet_inches':
    case 'width_only_dash':
    case 'width_only_feet_only':
      return value;
    default:
      return 'unknown';
  }
}

function normalizeDoorText(rawText: string) {
  return rawText
    .toUpperCase()
    .replace(/[’`′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[°º⁰]/g, '0')
    .replace(/[OQ]/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDigitToken(token: string) {
  return token
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[B]/g, '8')
    .replace(/[S]/g, '5')
    .replace(/[IL|]/g, '1');
}

function parseFeetAndInches(feet: string, inches: string) {
  const feetValue = Number(normalizeDigitToken(feet));
  const inchesValue = Number(normalizeDigitToken(inches));

  if (!Number.isFinite(feetValue) || !Number.isFinite(inchesValue)) return null;
  if (feetValue < 0 || inchesValue < 0 || inchesValue >= 12) return null;

  return Math.round((feetValue + inchesValue / 12) * 1000) / 1000;
}

function parseCompactFeetCode(token: string) {
  const normalized = normalizeDigitToken(token.replace(/\s+/g, ''));
  if (!/^\d{2}$/.test(normalized)) return null;
  return parseFeetAndInches(normalized[0], normalized[1]);
}

function parsePairCompactWidth(normalized: string) {
  const prefixMatch = normalized.match(
    new RegExp(`\\b2\\s*[-X]\\s*([${DIGIT_LIKE_CHARS}]{2})([${DIGIT_LIKE_CHARS}]{2})\\b`),
  );
  if (prefixMatch) {
    const leafWidthFt = parseCompactFeetCode(prefixMatch[1]);
    const heightFt = parseFeetAndInches(prefixMatch[2][0], prefixMatch[2][1]);
    if (leafWidthFt !== null && heightFt !== null) {
      return {
        widthFt: Math.round(leafWidthFt * 2 * 1000) / 1000,
        heightFt,
        format: 'leaf_pair_compact' as const,
      };
    }
  }

  const suffixMatch = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{2})([${DIGIT_LIKE_CHARS}]{2})\\s*(PAIR|DOUBLE(?:\\s+DOOR|\\s+DR)?|DBL(?:\\s+DOOR|\\s+DR)?)\\b`,
    ),
  );
  if (suffixMatch) {
    const leafWidthFt = parseCompactFeetCode(suffixMatch[1]);
    const heightFt = parseFeetAndInches(suffixMatch[2][0], suffixMatch[2][1]);
    if (leafWidthFt !== null && heightFt !== null) {
      return {
        widthFt: Math.round(leafWidthFt * 2 * 1000) / 1000,
        heightFt,
        format: 'leaf_pair_compact' as const,
      };
    }
  }

  return null;
}

function parseDoorSizeFromRawText(rawText: string): ParsedDoorDimensions | null {
  const normalized = normalizeDoorText(rawText);

  const pairCompact = parsePairCompactWidth(normalized);
  if (pairCompact) {
    return pairCompact;
  }

  const compactMatch = normalized.match(
    new RegExp(`\\b([${DIGIT_LIKE_CHARS}]{2})([${DIGIT_LIKE_CHARS}]{2})\\b`),
  );
  if (compactMatch) {
    const widthFt = parseCompactFeetCode(compactMatch[1]);
    const heightFt = parseFeetAndInches(compactMatch[2][0], compactMatch[2][1]);
    if (widthFt !== null && heightFt !== null) {
      return { widthFt, heightFt, format: 'compact_code' };
    }
  }

  const slashMatch = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{1,2})\\/([${DIGIT_LIKE_CHARS}]{1,2})\\s*[X×]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\/([${DIGIT_LIKE_CHARS}]{1,2})\\b`,
    ),
  );
  if (slashMatch) {
    const widthFt = parseFeetAndInches(slashMatch[1], slashMatch[2]);
    const heightFt = parseFeetAndInches(slashMatch[3], slashMatch[4]);
    if (widthFt !== null && heightFt !== null) {
      return { widthFt, heightFt, format: 'slash_pair' };
    }
  }

  const dashPair = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{1,2})\\s*[-–]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\s*[X×]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\s*[-–]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\b`,
    ),
  );
  if (dashPair) {
    const widthFt = parseFeetAndInches(dashPair[1], dashPair[2]);
    const heightFt = parseFeetAndInches(dashPair[3], dashPair[4]);
    if (widthFt !== null && heightFt !== null) {
      return { widthFt, heightFt, format: 'dash_pair' };
    }
  }

  const feetInchesPair = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{1,2})\\s*[${PRIME_CHARS}]?\\s*[- ]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\s*[${DOUBLE_PRIME_CHARS}]?\\s*[X×]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\s*[${PRIME_CHARS}]?\\s*[- ]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\s*[${DOUBLE_PRIME_CHARS}]?\\b`,
    ),
  );
  if (feetInchesPair) {
    const widthFt = parseFeetAndInches(feetInchesPair[1], feetInchesPair[2]);
    const heightFt = parseFeetAndInches(feetInchesPair[3], feetInchesPair[4]);
    if (widthFt !== null && heightFt !== null) {
      return { widthFt, heightFt, format: 'feet_inches_pair' };
    }
  }

  const feetOnlyPair = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{1,2})(?:\\s*[${PRIME_CHARS}]0?\\s*[${DOUBLE_PRIME_CHARS}]?)?\\s*[X×]\\s*([${DIGIT_LIKE_CHARS}]{1,2})(?:\\s*[${PRIME_CHARS}]0?\\s*[${DOUBLE_PRIME_CHARS}]?)?\\b`,
    ),
  );
  if (feetOnlyPair) {
    const widthFt = Number(feetOnlyPair[1]);
    const heightFt = Number(feetOnlyPair[2]);
    if (
      Number.isFinite(widthFt) &&
      Number.isFinite(heightFt) &&
      widthFt > 0 &&
      heightFt >= 6 &&
      heightFt <= 20
    ) {
      return { widthFt, heightFt, format: 'feet_only_pair' };
    }
  }

  return null;
}

function parseDoorWidthOnlyFromRawText(rawText: string): ParsedDoorWidthOnly | null {
  const normalized = normalizeDoorText(rawText);
  if (!normalized || /[X×]/.test(normalized)) {
    return null;
  }

  if (!WIDTH_ONLY_CONTEXT_RE.test(normalized)) {
    return null;
  }

  const compactMatch = normalized.match(new RegExp(`\\b([${DIGIT_LIKE_CHARS}]{2})\\b`));
  if (compactMatch) {
    const widthFt = parseCompactFeetCode(compactMatch[1]);
    if (widthFt !== null) {
      return { widthFt, format: 'width_only_compact' };
    }
  }

  const slashMatch = normalized.match(
    new RegExp(`\\b([${DIGIT_LIKE_CHARS}]{1,2})\\/([${DIGIT_LIKE_CHARS}]{1,2})\\b`),
  );
  if (slashMatch) {
    const widthFt = parseFeetAndInches(slashMatch[1], slashMatch[2]);
    if (widthFt !== null) {
      return { widthFt, format: 'width_only_slash' };
    }
  }

  const dashMatch = normalized.match(
    new RegExp(`\\b([${DIGIT_LIKE_CHARS}]{1,2})\\s*[-–]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\b`),
  );
  if (dashMatch) {
    const widthFt = parseFeetAndInches(dashMatch[1], dashMatch[2]);
    if (widthFt !== null) {
      return { widthFt, format: 'width_only_dash' };
    }
  }

  const feetInchesMatch = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{1,2})\\s*[${PRIME_CHARS}]?\\s*[- ]\\s*([${DIGIT_LIKE_CHARS}]{1,2})\\s*[${DOUBLE_PRIME_CHARS}]?\\b`,
    ),
  );
  if (feetInchesMatch) {
    const widthFt = parseFeetAndInches(feetInchesMatch[1], feetInchesMatch[2]);
    if (widthFt !== null) {
      return { widthFt, format: 'width_only_feet_inches' };
    }
  }

  const feetOnlyMatch = normalized.match(
    new RegExp(
      `\\b([${DIGIT_LIKE_CHARS}]{1,2})(?:\\s*[${PRIME_CHARS}]0?\\s*[${DOUBLE_PRIME_CHARS}]?)\\b`,
    ),
  );
  if (feetOnlyMatch) {
    const widthFt = Number(feetOnlyMatch[1]);
    if (Number.isFinite(widthFt) && widthFt > 0 && widthFt <= 12) {
      return { widthFt, format: 'width_only_feet_only' };
    }
  }

  return null;
}

function inferDoorDesignationFromRawText(
  rawText: string,
  fallbackType: Exclude<OpeningType, 'window'>,
): ParsedDoorDesignation {
  for (const designation of DOOR_DESIGNATION_PATTERNS) {
    const match = rawText.match(designation.pattern);
    if (match) {
      return {
        raw: match[0].trim(),
        normalized: designation.normalized,
        openingType: designation.openingType,
      };
    }
  }

  switch (fallbackType) {
    case 'french_door':
      return { raw: null, normalized: 'french', openingType: fallbackType };
    case 'garage_door':
      return { raw: null, normalized: 'garage_overhead', openingType: fallbackType };
    case 'sliding_door':
      return { raw: null, normalized: 'sliding', openingType: fallbackType };
    case 'door_opening':
      return { raw: null, normalized: 'cased_opening', openingType: fallbackType };
    default:
      return { raw: null, normalized: 'unknown', openingType: fallbackType };
  }
}

function inferDoorOpeningType(
  designation: ParsedDoorDesignation,
  fallbackType: Exclude<OpeningType, 'window'>,
): Exclude<OpeningType, 'window'> {
  if (designation.normalized !== 'unknown') {
    return designation.openingType;
  }
  return fallbackType;
}

export function buildSafeDoorVisionResult(
  rawText: string,
  widthFt: number | null,
  heightFt: number | null,
  openingType: Exclude<OpeningType, 'window'>,
  confidence: unknown,
  designationRaw: unknown = null,
  designationNormalized: unknown = null,
  dimensionFormat: unknown = null,
): DoorVisionResult {
  const normalizedText = sanitizeRawText(rawText);
  const safeConfidence = clampConfidence(confidence);
  const parsedTextDimensions = parseDoorSizeFromRawText(normalizedText);
  const parsedWidthOnly = parseDoorWidthOnlyFromRawText(normalizedText);
  const normalizedDesignation = inferDoorDesignationFromRawText(
    normalizedText,
    openingType,
  );
  const designationFromModel = sanitizeDoorDesignation(designationNormalized);
  const normalizedType = inferDoorOpeningType(normalizedDesignation, openingType);
  const safeDesignationRaw =
    typeof designationRaw === 'string' && designationRaw.trim()
      ? designationRaw.trim().slice(0, 48)
      : normalizedDesignation.raw;
  const safeDesignationNormalized =
    normalizedDesignation.normalized !== 'unknown'
      ? normalizedDesignation.normalized
      : designationFromModel;
  const safeDimensionFormat =
    parsedTextDimensions?.format ??
    parsedWidthOnly?.format ??
    sanitizeDoorDimensionFormat(dimensionFormat);

  if (parsedTextDimensions) {
    const parsedWidth = parsedTextDimensions.widthFt;
    const parsedHeight = parsedTextDimensions.heightFt;

    if (widthFt !== null && heightFt !== null) {
      const widthMatches = Math.abs(parsedWidth - widthFt) <= DOOR_DIMENSION_TOLERANCE_FT;
      const heightMatches = Math.abs(parsedHeight - heightFt) <= DOOR_DIMENSION_TOLERANCE_FT;

      if (!widthMatches || !heightMatches) {
        return {
          raw_text: normalizedText,
          width_ft: null,
          height_ft: null,
          opening_type: normalizedType,
          designation_raw: safeDesignationRaw,
          designation_normalized: safeDesignationNormalized,
          dimension_format: safeDimensionFormat,
          confidence: Math.min(safeConfidence, 0.25),
          disposition: 'ambiguous',
        };
      }
    }

    return {
      raw_text: normalizedText,
      width_ft: parsedWidth,
      height_ft: parsedHeight,
      opening_type: normalizedType,
      designation_raw: safeDesignationRaw,
      designation_normalized: safeDesignationNormalized,
      dimension_format: safeDimensionFormat,
      confidence:
        widthFt !== null && heightFt !== null
          ? Math.max(0.84, safeConfidence)
          : Math.max(0.83, Math.min(0.9, safeConfidence || 0.83)),
      disposition: 'confirmed',
    };
  }

  if (parsedWidthOnly) {
    const safeWidthOnlyValue = widthFt ?? parsedWidthOnly.widthFt;
    const widthOnlyMatches =
      widthFt === null ||
      Math.abs(parsedWidthOnly.widthFt - safeWidthOnlyValue) <= DOOR_DIMENSION_TOLERANCE_FT;

    if (widthOnlyMatches && normalizedType !== 'garage_door') {
      return {
        raw_text: normalizedText,
        width_ft: safeWidthOnlyValue,
        height_ft: DEFAULT_STANDARD_DOOR_HEIGHT_FT,
        opening_type: normalizedType,
        designation_raw: safeDesignationRaw,
        designation_normalized: safeDesignationNormalized,
        dimension_format: safeDimensionFormat,
        confidence: Math.max(0.82, Math.min(0.9, safeConfidence || 0.82)),
        disposition: 'width_only',
      };
    }
  }

  return {
    raw_text: normalizedText,
    width_ft: null,
    height_ft: null,
    opening_type: normalizedType,
    designation_raw: safeDesignationRaw,
    designation_normalized: safeDesignationNormalized,
    dimension_format: safeDimensionFormat,
    confidence: Math.min(safeConfidence, normalizedText ? 0.1 : 0.25),
    disposition: normalizedText ? 'invalid_target' : 'ambiguous',
  };
}
