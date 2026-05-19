import { v4 as uuid } from 'uuid';
import {
  formatFeetInches,
  parseDimensionToFeet,
  type DoorCatalogItem,
  type DoorDimensionFormat,
  type OpeningScheduleItem,
  type OpeningType,
  type PageScore,
  type WindowCatalogItem,
} from '@/lib/types/takeoff';
import type { PageAnalysis } from '@/lib/types/takeoff-v2';

const COMMON_SCHEDULE_INCH_MIN = 12;
const COMMON_SCHEDULE_INCH_MAX = 240;
const DIMENSION_REVIEW_FLAGS = new Set([
  'missing_dimension',
  'missing_dimension_pair',
  'missing_size',
  'unparsed_dimension',
]);

export function normalizeOpeningTag(value: string | null | undefined): string | null {
  const cleaned = value
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/[._-]+/g, ' ')
    .toUpperCase();
  if (!cleaned) return null;

  const compact = cleaned.replace(/\s+/g, '');
  const numericLetter = compact.match(/^(\d{2,4})([A-Z])$/);
  if (numericLetter) return `${numericLetter[1]}.${numericLetter[2]}`;

  const numericLetterNumber = compact.match(/^(\d{2,4})([A-Z])(\d+)$/);
  if (numericLetterNumber) {
    return `${numericLetterNumber[1]}.${numericLetterNumber[2]}${numericLetterNumber[3]}`;
  }

  const letterNumber = compact.match(/^([A-Z]{1,3})(\d+[A-Z]?)$/);
  if (letterNumber) return `${letterNumber[1]}-${letterNumber[2]}`;

  const numericParts = cleaned.match(/^(\d{2,4})\s+([A-Z]\d*)$/);
  if (numericParts) return `${numericParts[1]}.${numericParts[2]}`;

  return cleaned.replace(/\s+/g, '-');
}

function normalizeDimensionText(value: string) {
  return value
    .trim()
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\s*(?:ft|feet)\b/gi, "'")
    .replace(/\s*(?:in|inch|inches)\b/gi, '"')
    .replace(/\s+/g, ' ');
}

function parseScheduleDimensionPart(
  value: string,
  contextHasExplicitUnit: boolean,
): { feet: number | null; flags: string[] } {
  const cleaned = normalizeDimensionText(value);
  const flags: string[] = [];
  if (!cleaned) return { feet: null, flags: ['missing_dimension'] };

  const slash = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slash) {
    const feet = Number(slash[1]);
    const inches = Number(slash[2]);
    if (Number.isFinite(feet) && Number.isFinite(inches) && inches < 12) {
      return { feet: feet + inches / 12, flags: ['slash_feet_inches'] };
    }
    return { feet: null, flags: ['ambiguous_slash_dimension'] };
  }

  const explicitInches = cleaned.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (explicitInches) {
    return { feet: Number(explicitInches[1]) / 12, flags };
  }

  if (/^\d+(?:\.\d+)?$/.test(cleaned) && !contextHasExplicitUnit) {
    const inches = Number(cleaned);
    if (
      Number.isFinite(inches) &&
      inches >= COMMON_SCHEDULE_INCH_MIN &&
      inches <= COMMON_SCHEDULE_INCH_MAX
    ) {
      return { feet: inches / 12, flags: ['unit_inferred_inches'] };
    }
    return { feet: null, flags: ['ambiguous_no_unit_dimension'] };
  }

  if (/^\d+(?:\.\d+)?$/.test(cleaned) && contextHasExplicitUnit) {
    const inches = Number(cleaned);
    if (
      Number.isFinite(inches) &&
      inches >= COMMON_SCHEDULE_INCH_MIN &&
      inches <= COMMON_SCHEDULE_INCH_MAX
    ) {
      return { feet: inches / 12, flags: ['unit_inferred_inches'] };
    }
  }

  const parsed = parseDimensionToFeet(cleaned);
  return parsed ? { feet: parsed, flags } : { feet: null, flags: ['unparsed_dimension'] };
}

export function parseOpeningScheduleSize(rawSize: string | null | undefined): {
  widthFt: number | null;
  heightFt: number | null;
  areaSf: number | null;
  reviewFlags: string[];
  dimensionFormat: DoorDimensionFormat;
} {
  const normalized = normalizeDimensionText(rawSize ?? '')
    .replace(/\s*(?:x|X|×|\bby\b)\s*/g, ' x ')
    .trim();

  if (!normalized) {
    return {
      widthFt: null,
      heightFt: null,
      areaSf: null,
      reviewFlags: ['missing_size'],
      dimensionFormat: 'unknown',
    };
  }

  const sizeParts = normalized.split(/\s+x\s+/i).filter(Boolean);
  const parts = sizeParts.length > 2 ? sizeParts.slice(0, 2) : sizeParts;
  if (parts.length !== 2) {
    const compact = normalized.match(/^(\d{2})(\d{2})$/);
  if (compact) {
      const widthFt = Number(compact[1][0]) + Number(compact[1][1]) / 12;
      const heightFt = Number(compact[2][0]) + Number(compact[2][1]) / 12;
      return {
        widthFt,
        heightFt,
        areaSf: widthFt * heightFt,
        reviewFlags: [],
        dimensionFormat: 'compact_code',
      };
    }

    return {
      widthFt: null,
      heightFt: null,
      areaSf: null,
      reviewFlags: ['missing_dimension_pair'],
      dimensionFormat: 'unknown',
    };
  }

  const contextHasExplicitUnit = /['"]/.test(normalized) || /\b(?:ft|feet|in|inches)\b/i.test(rawSize ?? '');
  const width = parseScheduleDimensionPart(parts[0], contextHasExplicitUnit);
  const height = parseScheduleDimensionPart(parts[1], contextHasExplicitUnit);
  const reviewFlags = Array.from(new Set([...width.flags, ...height.flags]));
  const widthFt = width.feet;
  const heightFt = height.feet;

  let dimensionFormat: DoorDimensionFormat = 'unknown';
  if (parts.some((part) => /^\s*\d+\s*\/\s*\d+\s*$/.test(part))) {
    dimensionFormat = 'slash_pair';
  } else if (contextHasExplicitUnit) {
    dimensionFormat = 'feet_inches_pair';
  } else if (reviewFlags.includes('unit_inferred_inches')) {
    dimensionFormat = 'dash_pair';
  }

  return {
    widthFt,
    heightFt,
    areaSf: widthFt && heightFt ? widthFt * heightFt : null,
    reviewFlags,
    dimensionFormat,
  };
}

function readStringField(value: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const current = value[name];
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return null;
}

function readNumberField(value: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const current = value[name];
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current === 'string' && current.trim() && Number.isFinite(Number(current))) {
      return Number(current);
    }
  }
  return null;
}

export function normalizeOpeningScheduleItems(
  value: unknown,
  sourcePageIndex?: number,
  limit = 80,
): OpeningScheduleItem[] {
  if (!Array.isArray(value)) return [];

  const items: OpeningScheduleItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const tag = readStringField(row, ['tag', 'tagNormalized', 'tag_normalized', 'type_id', 'window_no', 'door_no']);
    const tagNormalized = normalizeOpeningTag(
      readStringField(row, ['tagNormalized', 'tag_normalized']) ?? tag,
    );
    const rawSize = readStringField(row, ['rawSize', 'raw_size', 'size']) ?? '';
    const openingTypeText =
      readStringField(row, ['openingType', 'opening_type', 'kind', 'category']) ?? 'window';
    const openingType = /door/i.test(openingTypeText) ? 'door' : 'window';
    if (!tag || !tagNormalized || !rawSize) continue;

    const parsed = parseOpeningScheduleSize(rawSize);
    const modelWidth = readNumberField(row, ['widthFt', 'width_ft']);
    const modelHeight = readNumberField(row, ['heightFt', 'height_ft']);
    const widthFt = parsed.widthFt ?? modelWidth;
    const heightFt = parsed.heightFt ?? modelHeight;
    const modelFlags = Array.isArray(row.reviewFlags ?? row.review_flags)
      ? ((row.reviewFlags ?? row.review_flags) as unknown[]).filter(
          (flag): flag is string => typeof flag === 'string' && Boolean(flag.trim()),
        )
      : [];
    const reviewFlags = Array.from(new Set([...parsed.reviewFlags, ...modelFlags])).filter(
      (flag) => !(widthFt && heightFt && DIMENSION_REVIEW_FLAGS.has(flag)),
    );

    items.push({
      id:
        readStringField(row, ['id']) ??
        `schedule:${sourcePageIndex ?? 'unknown'}:${openingType}:${tagNormalized}`,
      openingType,
      tag,
      tagNormalized,
      room: readStringField(row, ['room', 'room_name']),
      rawSize,
      widthFt,
      heightFt,
      areaSf: widthFt && heightFt ? widthFt * heightFt : null,
      scheduleType: readStringField(row, ['scheduleType', 'schedule_type', 'type', 'type_description', 'description']),
      sourcePageIndex,
      confidence: Math.max(0, Math.min(1, readNumberField(row, ['confidence']) ?? 0.72)),
      reviewFlags,
      rawText: readStringField(row, ['rawText', 'raw_text']),
    });

    if (items.length >= limit) break;
  }

  const scoreItem = (item: OpeningScheduleItem) => {
    let score = item.confidence * 10;
    if (item.widthFt && item.heightFt) score += 10;
    if (/\s+(?:x|X|×)\s+/.test(item.rawSize)) score += 8;
    if (/\b(?:in|ft)\b|['"]/.test(item.rawSize)) score += 6;
    if (/^\d{4}$/.test(item.rawSize.trim())) score -= 5;
    score -= item.reviewFlags.length * 2;
    return score;
  };

  const byTag = new Map<string, OpeningScheduleItem>();
  for (const item of items) {
    const key = `${item.openingType}:${item.tagNormalized}`;
    const current = byTag.get(key);
    if (!current || scoreItem(item) > scoreItem(current)) {
      byTag.set(key, item);
    }
  }

  return Array.from(byTag.values());
}

function scheduleLabel(item: OpeningScheduleItem) {
  const size =
    item.widthFt && item.heightFt
      ? `${formatFeetInches(item.widthFt)} x ${formatFeetInches(item.heightFt)}`
      : item.rawSize;
  return `${item.tagNormalized} ${size}`.trim();
}

function sourceText(item: OpeningScheduleItem) {
  return [
    item.tagNormalized,
    item.rawSize,
    item.room ? `Room: ${item.room}` : null,
    item.scheduleType ? `Type: ${item.scheduleType}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function mapDoorType(scheduleType: string | null | undefined): Exclude<OpeningType, 'window'> {
  const value = scheduleType ?? '';
  if (/\bgarage|overhead\b/i.test(value)) return 'garage_door';
  if (/\bslid/i.test(value)) return 'sliding_door';
  if (/\bfrench\b/i.test(value)) return 'french_door';
  if (/\bopening|cased\b/i.test(value)) return 'door_opening';
  return 'door';
}

export function buildOpeningCatalogsFromScheduleItems(items: OpeningScheduleItem[]): {
  windowCatalog: WindowCatalogItem[];
  doorCatalog: DoorCatalogItem[];
} {
  const now = new Date().toISOString();
  const validItems = items.filter((item) => item.widthFt && item.heightFt);

  const windowCatalog = validItems
    .filter((item) => item.openingType === 'window')
    .map((item): WindowCatalogItem => ({
      id: item.id ?? uuid(),
      widthFt: item.widthFt ?? 0,
      heightFt: item.heightFt ?? 0,
      areaSf: item.areaSf ?? (item.widthFt ?? 0) * (item.heightFt ?? 0),
      label: scheduleLabel(item),
      tag: item.tag,
      tagNormalized: item.tagNormalized,
      room: item.room ?? null,
      rawSize: item.rawSize,
      scheduleType: item.scheduleType ?? null,
      confidence: item.confidence,
      reviewFlags: item.reviewFlags,
      source: 'vision_schedule',
      sourceText: sourceText(item),
      pageIndex: item.sourcePageIndex,
      captureCount: 0,
      createdAt: now,
      updatedAt: now,
    }));

  const doorCatalog = validItems
    .filter((item) => item.openingType === 'door')
    .map((item): DoorCatalogItem => ({
      id: item.id ?? uuid(),
      type: mapDoorType(item.scheduleType),
      widthFt: item.widthFt ?? 0,
      heightFt: item.heightFt ?? 0,
      areaSf: item.areaSf ?? (item.widthFt ?? 0) * (item.heightFt ?? 0),
      label: scheduleLabel(item),
      tag: item.tag,
      tagNormalized: item.tagNormalized,
      room: item.room ?? null,
      rawSize: item.rawSize,
      scheduleType: item.scheduleType ?? null,
      confidence: item.confidence,
      reviewFlags: item.reviewFlags,
      source: 'vision_schedule',
      sourceText: sourceText(item),
      designationRaw: item.scheduleType ?? null,
      designationNormalized: null,
      dimensionFormat: parseOpeningScheduleSize(item.rawSize).dimensionFormat,
      pageIndex: item.sourcePageIndex,
      captureCount: 0,
      createdAt: now,
      updatedAt: now,
    }));

  return { windowCatalog, doorCatalog };
}

export function collectOpeningScheduleItemsFromPageAnalysis(
  pageAnalysis: PageAnalysis[],
): OpeningScheduleItem[] {
  return pageAnalysis.flatMap((page) =>
    (page.scanExtracts?.opening_schedule_items ?? []).map((item) => ({
      ...item,
      sourcePageIndex: item.sourcePageIndex ?? page.pageIndex,
    })),
  );
}

export function collectOpeningScheduleItemsFromPageScores(
  pageScores: PageScore[],
): OpeningScheduleItem[] {
  return pageScores.flatMap((page) =>
    (page.scan_extracts?.opening_schedule_items ?? []).map((item) => ({
      ...item,
      sourcePageIndex: item.sourcePageIndex ?? page.page_index,
    })),
  );
}

export function findCatalogItemByTag<T extends { tagNormalized?: string | null }>(
  catalog: T[],
  tag: string,
): T | null {
  const normalized = normalizeOpeningTag(tag);
  if (!normalized) return null;
  return catalog.find((item) => item.tagNormalized === normalized) ?? null;
}
