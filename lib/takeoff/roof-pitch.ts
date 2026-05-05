export interface RoofPitch {
  rise: number;
  run: number;
}

export interface RoofPitchVisionResult {
  raw_text: string;
  rise: number | null;
  run: number | null;
  confidence: number;
  disposition: 'confirmed' | 'ambiguous' | 'invalid_target';
}

const ROOF_PITCH_CONFIDENCE_THRESHOLD = 0.82;
const MAX_PITCH_COMPONENT = 24;

function normalizeDigitToken(token: string) {
  return token
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

export function sanitizeRoofPitchComponent(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded <= 0 || rounded > MAX_PITCH_COMPONENT) return null;
  return rounded;
}

export function clampRoofPitchConfidence(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function sanitizeRoofPitchRawText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
}

export function normalizeRoofPitchText(rawText: string) {
  return sanitizeRoofPitchRawText(rawText)
    .toUpperCase()
    .replace(/[’`]/g, "'")
    .replace(/[\\]/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRoofPitchText(rawText: string): RoofPitch | null {
  const normalized = normalizeRoofPitchText(rawText);
  if (!normalized) return null;

  const slashMatch = normalized.match(/\b([0-9OQBSIL|]{1,2})\s*\/\s*([0-9OQBSIL|]{1,2})\b/);
  if (slashMatch) {
    const rise = Number(normalizeDigitToken(slashMatch[1]));
    const run = Number(normalizeDigitToken(slashMatch[2]));
    if (Number.isFinite(rise) && Number.isFinite(run) && rise > 0 && run > 0 && rise <= MAX_PITCH_COMPONENT && run <= MAX_PITCH_COMPONENT) {
      return { rise, run };
    }
  }

  const ratioMatch = normalized.match(/\b([0-9OQBSIL|]{1,2})\s*:\s*([0-9OQBSIL|]{1,2})\b/);
  if (ratioMatch) {
    const rise = Number(normalizeDigitToken(ratioMatch[1]));
    const run = Number(normalizeDigitToken(ratioMatch[2]));
    if (Number.isFinite(rise) && Number.isFinite(run) && rise > 0 && run > 0 && rise <= MAX_PITCH_COMPONENT && run <= MAX_PITCH_COMPONENT) {
      return { rise, run };
    }
  }

  const wordsMatch = normalized.match(
    /\b([0-9OQBSIL|]{1,2})\s*(?:IN|INCH|INCHES)?\s*(?:ON|IN)\s*([0-9OQBSIL|]{1,2})\b/,
  );
  if (wordsMatch) {
    const rise = Number(normalizeDigitToken(wordsMatch[1]));
    const run = Number(normalizeDigitToken(wordsMatch[2]));
    if (Number.isFinite(rise) && Number.isFinite(run) && rise > 0 && run > 0 && rise <= MAX_PITCH_COMPONENT && run <= MAX_PITCH_COMPONENT) {
      return { rise, run };
    }
  }

  return null;
}

export function formatRoofPitch(rise: number, run: number) {
  return `${Math.round(rise)}/${Math.round(run)}`;
}

export function roofPitchMultiplier(rise: number, run: number) {
  if (!Number.isFinite(rise) || !Number.isFinite(run) || rise <= 0 || run <= 0) {
    return 1;
  }

  return Math.sqrt(run * run + rise * rise) / run;
}

export function computeSlopedAreaSf(
  planAreaSf: number,
  rise: number | null | undefined,
  run: number | null | undefined,
) {
  if (!Number.isFinite(planAreaSf) || planAreaSf <= 0) return 0;
  if (
    typeof rise !== 'number' ||
    !Number.isFinite(rise) ||
    rise <= 0 ||
    typeof run !== 'number' ||
    !Number.isFinite(run) ||
    run <= 0
  ) {
    return planAreaSf;
  }

  return planAreaSf * roofPitchMultiplier(rise, run);
}

export function buildSafeRoofPitchResult(
  rawText: string,
  rise: number | null,
  run: number | null,
  confidence: unknown,
): RoofPitchVisionResult {
  const normalizedText = sanitizeRoofPitchRawText(rawText);
  const parsedPitch = parseRoofPitchText(normalizedText);
  const safeConfidence = clampRoofPitchConfidence(confidence);
  const safeRise = sanitizeRoofPitchComponent(rise);
  const safeRun = sanitizeRoofPitchComponent(run);

  if (!parsedPitch) {
    return {
      raw_text: normalizedText,
      rise: null,
      run: null,
      confidence: Math.min(safeConfidence, normalizedText ? 0.12 : 0.25),
      disposition: normalizedText ? 'invalid_target' : 'ambiguous',
    };
  }

  const resolvedRise = safeRise ?? parsedPitch.rise;
  const resolvedRun = safeRun ?? parsedPitch.run;
  const mismatchedPitch =
    safeRise !== null &&
    safeRun !== null &&
    (Math.abs(safeRise - parsedPitch.rise) > 0 || Math.abs(safeRun - parsedPitch.run) > 0);
  const resolvedConfidence = mismatchedPitch
    ? Math.min(safeConfidence, 0.45)
    : safeConfidence;

  return {
    raw_text: normalizedText,
    rise: resolvedRise,
    run: resolvedRun,
    confidence: resolvedConfidence,
    disposition:
      resolvedConfidence >= ROOF_PITCH_CONFIDENCE_THRESHOLD ? 'confirmed' : 'ambiguous',
  };
}
