import type { PageScanExtracts } from '@/lib/types/takeoff';

function readStringArray(value: unknown, limit?: number) {
  const strings = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
  return typeof limit === 'number' ? strings.slice(0, limit) : strings;
}

function readRValueArray(value: unknown, limit?: number) {
  const strings = readStringArray(value)
    .map((item) => item.replace(/\s+/g, '').replace(/^R\s*[-=]?\s*/i, 'R-'))
    .filter((item) => {
      const match = item.match(/^R-(\d+(?:\.\d+)?)(?:\+\d+CI)?$/i);
      return match ? Number(match[1]) > 0 : false;
    });
  return typeof limit === 'number' ? strings.slice(0, limit) : strings;
}

export function normalizePageScanExtracts(
  value: Partial<PageScanExtracts> | null | undefined,
  limits: Partial<Record<keyof PageScanExtracts, number>> = {},
): PageScanExtracts {
  return {
    window_sizes: readStringArray(value?.window_sizes, limits.window_sizes),
    opening_quantity_notes: readStringArray(
      value?.opening_quantity_notes,
      limits.opening_quantity_notes,
    ),
    insulation_types: readStringArray(value?.insulation_types, limits.insulation_types),
    r_values: readRValueArray(value?.r_values, limits.r_values),
    roof_pitches: readStringArray(value?.roof_pitches, limits.roof_pitches),
    vapor_barriers: readStringArray(value?.vapor_barriers, limits.vapor_barriers),
    air_barriers: readStringArray(value?.air_barriers, limits.air_barriers),
    baffles_or_venting: readStringArray(
      value?.baffles_or_venting,
      limits.baffles_or_venting,
    ),
    wall_framing: readStringArray(value?.wall_framing, limits.wall_framing),
    zone_hints: value?.zone_hints,
  };
}

export function uniqueScanStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeRoofPitch(match: string) {
  const cleaned = match
    .replace(/\b(?:roof\s*)?(?:pitch|slope)\b\s*[:=]?\s*/i, '')
    .replace(/\s+in\s+/i, '/')
    .replace(/\s*:\s*/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .trim();

  const pitch = cleaned.match(/\b(\d+(?:\.\d+)?)\/(12)\b/);
  return pitch ? `${pitch[1]}/${pitch[2]}` : null;
}

export function extractRoofPitchStrings(value: unknown): string[] {
  const bucket: string[] = [];

  const visit = (input: unknown) => {
    if (typeof input === 'string') {
      const matches = input.match(
        /\b(?:(?:roof\s*)?(?:pitch|slope)\s*[:=]?\s*)?\d+(?:\.\d+)?\s*(?:\/|:|\s+in\s+)\s*12\b/gi,
      ) ?? [];
      for (const match of matches) {
        const normalized = normalizeRoofPitch(match);
        if (normalized && !bucket.includes(normalized)) bucket.push(normalized);
      }
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (input && typeof input === 'object') {
      Object.values(input).forEach(visit);
    }
  };

  visit(value);
  return bucket;
}

function collectMatchingStrings(value: unknown, patterns: RegExp[]) {
  const bucket: string[] = [];

  const compactMatch = (input: string, pattern: RegExp) => {
    const normalized = input.replace(/\s+/g, ' ').trim();
    const clauses = normalized
      .split(/(?<=[.;:])\s+|\n+|,\s+(?=[A-Z][A-Z\s/]+:)/)
      .map((part) => part.trim())
      .filter(Boolean);

    const matchClause = clauses.find((clause) => pattern.test(clause));
    const source = matchClause ?? normalized;
    if (source.length <= 120) return source;

    const match = source.match(pattern);
    const index = match?.index ?? 0;
    const start = Math.max(0, index - 36);
    const end = Math.min(source.length, index + (match?.[0]?.length ?? 0) + 76);
    return `${start > 0 ? '...' : ''}${source.slice(start, end).trim()}${end < source.length ? '...' : ''}`;
  };

  const visit = (input: unknown) => {
    if (typeof input === 'string') {
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          bucket.push(compactMatch(input, pattern));
          break;
        }
      }
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (input && typeof input === 'object') {
      Object.values(input).forEach(visit);
    }
  };

  visit(value);
  return uniqueScanStrings(bucket);
}

export function extractVaporBarrierStrings(value: unknown) {
  return collectMatchingStrings(value, [
    /\bvapou?r\s+(?:barrier|retarder)\b/i,
    /\bpoly(?:ethylene)?\b/i,
    /\bkraft[-\s]?faced\b/i,
    /\bfaced\s+(?:batt|insulation)\b/i,
    /\bclass\s+[i1]{1,2,3}\s+vapou?r\b/i,
  ]);
}

export function extractAirBarrierStrings(value: unknown) {
  return collectMatchingStrings(value, [
    /\bair\s+(?:barrier|seal|sealing)\b/i,
    /\bsealed\s+(?:air|attic|crawl|envelope)\b/i,
    /\bcaulk(?:ing)?\b/i,
    /\bweather\s*barrier\b/i,
  ]);
}

export function extractBaffleOrVentingStrings(value: unknown) {
  return collectMatchingStrings(value, [
    /\bbaffle\b/i,
    /\bvent(?:ing|ilation)?\b/i,
    /\bsoffit\s+vent\b/i,
    /\bridge\s+vent\b/i,
    /\bvent\s+chute\b/i,
    /\bnet\s+free\s+vent/i,
  ]);
}
