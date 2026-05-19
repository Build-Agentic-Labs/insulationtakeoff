'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, HelpCircle, Loader2, Save } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { TakeoffAnalysisScreen } from '@/components/takeoff/TakeoffAnalysisScreen';
import { ToolbarConceptWorkspace } from '@/components/takeoff/ToolbarConceptWorkspace';
import { ZoneToolbarWorkspace } from '@/components/takeoff/ZoneToolbarWorkspace';
import { TakeoffSummary, type TakeoffSummaryHandle } from '@/components/takeoff/TakeoffSummary';
import { TakeoffGuideTour } from '@/components/takeoff/TakeoffGuideTour';
import { usePreventHistoryBack } from '@/components/takeoff/usePreventHistoryBack';
import { registerPersistedSessionRevision, saveSession } from '@/lib/takeoff/save-session';
import type {
  PageScanExtracts,
  PageScore,
  PageTakeoffRelevance,
  PageScanFlags,
  PageStopFlags,
  TakeoffSession,
} from '@/lib/types/takeoff';
import type { PageAnalysis, TakeoffView } from '@/lib/types/takeoff-v2';
import {
  buildInitialAiSuggestionsFromPageAnalysis,
  buildPageAnalysisFromPageScores,
  inferAiPageRoles,
  ensureTakeoffSessionWorkspace,
  mapTakeoffSessionRowToSession,
  takeoffSessionToApiPayload,
  type TakeoffSessionRowLike,
} from '@/lib/takeoff/workspace-v2';
import { getProjectWorkspaceHref, getQuoteHref, parseTakeoffRouteStep } from '@/lib/takeoff/navigation';
import { getProjectRefColumn, getProjectRouteRef } from '@/lib/projects/slug';
import {
  extractAirBarrierStrings,
  extractBaffleOrVentingStrings,
  extractRoofPitchStrings,
  extractVaporBarrierStrings,
  normalizePageScanExtracts,
  uniqueScanStrings,
} from '@/lib/takeoff/scan-extracts';
import {
  buildOpeningCatalogsFromScheduleItems,
  collectOpeningScheduleItemsFromPageScores,
  normalizeOpeningScheduleItems,
} from '@/lib/takeoff/opening-schedule';
import { getPublicAnalysisError } from '@/lib/takeoff/analysis-errors';

// Classification result from the API
interface PageClassification {
  page_index: number;
  page_type: string;
  secondary_page_types?: string[];
  page_name: string;
  takeoff_relevance?: PageTakeoffRelevance;
  has_dimensions: boolean;
  is_floor_plan: boolean;
  confidence: number;
  scan_flags?: PageScanFlags;
  stop_flags?: PageStopFlags;
  scan_extracts?: PageScanExtracts;
  scan_notes?: string[];
}

type VisionAnalysisStage =
  | 'idle'
  | 'loading_pdf'
  | 'rendering_pages'
  | 'classifying_pages'
  | 'extracting_details'
  | 'finalizing'
  | 'complete'
  | 'failed';

interface VisionAnalysisProgress {
  stage: VisionAnalysisStage;
  message: string;
  progress: number;
  renderedPages: number;
  totalPages: number;
  detailPagesCompleted: number;
  detailPagesTotal: number;
}

interface ClassifyPagesOptions {
  force?: boolean;
}

function hasMeaningfulClassificationResults(
  results: PageClassification[],
  totalPages: number,
) {
  if (!results.length || results.length !== totalPages) return false;

  return results.some((page) => {
    const pageName = page.page_name?.trim().toLowerCase() ?? '';
    const isGenericName = !pageName || pageName === `page ${page.page_index + 1}`.toLowerCase();
    const hasSignals =
      Boolean(page.scan_notes?.length) ||
      Object.values(page.scan_flags ?? {}).some(Boolean) ||
      Object.values(page.stop_flags ?? {}).some(Boolean) ||
      Boolean(page.scan_extracts?.r_values?.length) ||
      Boolean(page.scan_extracts?.insulation_types?.length) ||
      Boolean(page.scan_extracts?.window_sizes?.length) ||
      Boolean(page.scan_extracts?.opening_quantity_notes?.length) ||
      Boolean(page.scan_extracts?.opening_schedule_items?.length) ||
      Boolean(page.scan_extracts?.roof_pitches?.length) ||
      Boolean(page.scan_extracts?.vapor_barriers?.length) ||
      Boolean(page.scan_extracts?.air_barriers?.length) ||
      Boolean(page.scan_extracts?.baffles_or_venting?.length);

    return page.page_type !== 'other' || !isGenericName || hasSignals;
  });
}

function makeAnalysisProgress(
  overrides: Partial<VisionAnalysisProgress> & Pick<VisionAnalysisProgress, 'stage' | 'message'>
): VisionAnalysisProgress {
  return {
    stage: overrides.stage,
    message: overrides.message,
    progress: overrides.progress ?? 0,
    renderedPages: overrides.renderedPages ?? 0,
    totalPages: overrides.totalPages ?? 0,
    detailPagesCompleted: overrides.detailPagesCompleted ?? 0,
    detailPagesTotal: overrides.detailPagesTotal ?? 0,
  };
}

interface FragmentedDetailCompiled {
  derived_r_values?: string[];
  derived_insulation_types?: string[];
  wall_sections?: Array<Record<string, unknown>>;
  sections?: Array<Record<string, unknown>>;
  insulation_requirements?: Array<Record<string, unknown>>;
  insulation_callouts?: Array<Record<string, unknown>>;
  ceiling_insulation?: Array<Record<string, unknown>>;
  floor_insulation?: Array<Record<string, unknown>>;
  foundations?: Array<Record<string, unknown>>;
  window_schedule?: Array<Record<string, unknown>>;
  door_schedule?: Array<Record<string, unknown>>;
  opening_notes?: Array<Record<string, unknown> | string>;
  general_notes?: Array<Record<string, unknown> | string>;
  derived_roof_pitches?: string[];
  derived_vapor_barriers?: string[];
  derived_air_barriers?: string[];
  derived_baffles_or_venting?: string[];
}

interface FragmentedDetailResponse {
  compiled?: FragmentedDetailCompiled | null;
  fragments?: Array<unknown>;
}

interface OpeningReferenceResponse {
  window_schedule?: Array<Record<string, unknown>>;
  door_schedule?: Array<Record<string, unknown>>;
  opening_notes?: Array<Record<string, unknown> | string>;
}

const DETAIL_ENRICHMENT_PAGE_LIMIT = 6;
const CLASSIFICATION_BATCH_SIZE = 3;
const DETAIL_ENRICHMENT_PAGE_TYPES = new Set(['detail', 'section', 'schedule', 'elevation']);
const DETAIL_ENRICHMENT_TITLE_PATTERN =
  /\b(detail|section|sections|note|notes|schedule|window|door|elevation|wall|roof|ceiling|foundation|energy|insulation|spec)\b/i;

const uniqueStrings = uniqueScanStrings;

function locationMatches(
  location: string | null | undefined,
  patterns: RegExp[],
) {
  if (!location) return false;
  return patterns.some((pattern) => pattern.test(location));
}

function stringIncludesPatterns(
  value: string | null | undefined,
  patterns: RegExp[],
) {
  if (!value) return false;
  return patterns.some((pattern) => pattern.test(value));
}

function deriveZoneInsulationTypes(
  scopedValues: string[],
  scopedNotes: Array<string | null | undefined>,
) {
  return uniqueStrings([
    ...scopedValues.filter((value) =>
      stringIncludesPatterns(value, [/\bbatt\b/i, /\bspray\b/i, /\bcellulose\b/i, /\bfiberglass\b/i, /\bfoam\b/i]),
    ),
    ...scopedNotes.filter((value) =>
      stringIncludesPatterns(value, [/\bbatt\b/i, /\bspray\b/i, /\bcellulose\b/i, /\bfiberglass\b/i, /\bfoam\b/i]),
    ),
  ]);
}

function summarizeValues(values: string[], limit = 3) {
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} +${values.length - limit} more`;
}

function readStringValue(input: unknown): string | null {
  if (typeof input === 'string') return input.trim() || null;
  if (input && typeof input === 'object' && 'value' in input) {
    const value = (input as { value?: unknown }).value;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
  return null;
}

function readScheduleSizes(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return uniqueStrings(
    input.map((entry) =>
      entry && typeof entry === 'object' && 'size' in entry
        ? typeof (entry as { size?: unknown }).size === 'string'
          ? (entry as { size: string }).size
          : null
        : null
    )
  );
}

function readScheduleQuantityNotes(input: unknown, label: string) {
  if (!Array.isArray(input)) return [] as string[];

  return uniqueStrings(
    input.map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const quantity = (entry as { quantity?: unknown }).quantity;
      if (typeof quantity !== 'number' || quantity < 2) return null;

      const descriptor = readStringValue(
        (entry as { description?: unknown; type_description?: unknown; type_id?: unknown })
          .description ??
          (entry as { description?: unknown; type_description?: unknown; type_id?: unknown })
            .type_description ??
          (entry as { description?: unknown; type_description?: unknown; type_id?: unknown })
            .type_id
      );
      const size =
        typeof (entry as { size?: unknown }).size === 'string'
          ? (entry as { size: string }).size
          : null;

      return `${quantity}x ${descriptor ?? label}${size ? ` (${size})` : ''}`;
    })
  );
}

function readOpeningNotes(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return uniqueStrings(input.map((entry) => readStringValue(entry)));
}

function readOpeningScheduleItems(input: unknown, openingType: 'window' | 'door', sourcePageIndex?: number) {
  if (!Array.isArray(input)) return [];
  return normalizeOpeningScheduleItems(
    input.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const row = entry as Record<string, unknown>;
      return {
        ...row,
        openingType,
        tag: row.tag ?? row.type_id ?? row.window_no ?? row.door_no,
        rawSize: row.rawSize ?? row.raw_size ?? row.size,
        scheduleType:
          row.scheduleType ?? row.schedule_type ?? row.type ?? row.type_description ?? row.description,
      };
    }),
    sourcePageIndex,
  );
}

function dedupeOpeningScheduleItems(items: PageScanExtracts['opening_schedule_items']) {
  return normalizeOpeningScheduleItems(items ?? [], undefined, 160);
}

function openingReferenceToDetailData(
  data: OpeningReferenceResponse | null | undefined,
): FragmentedDetailResponse | null {
  if (!data) return null;
  return {
    compiled: {
      window_schedule: data.window_schedule ?? [],
      door_schedule: data.door_schedule ?? [],
      opening_notes: data.opening_notes ?? [],
    },
    fragments: [],
  };
}

function shouldRunOpeningSchedulePass(page: PageClassification) {
  return Boolean(
    page.page_type === 'schedule' ||
      page.scan_flags?.opening_info ||
      page.scan_extracts?.opening_evidence === 'tags_only' ||
      page.scan_extracts?.opening_schedule_items?.length ||
      page.scan_extracts?.window_sizes?.length ||
      page.scan_extracts?.opening_quantity_notes?.length,
  );
}

function detailRenderScale(page: PageClassification) {
  return shouldRunOpeningSchedulePass(page) ? 3.6 : 1.35;
}

async function extractPdfPageText(page: unknown) {
  const pageWithText = page as {
    getTextContent?: () => Promise<{
      items?: Array<{
        str?: string;
        transform?: number[];
      }>;
    }>;
  };
  if (typeof pageWithText.getTextContent !== 'function') return '';

  try {
    const content = await pageWithText.getTextContent();
    const items = (content.items ?? [])
      .map((item) => ({
        text: typeof item.str === 'string' ? item.str.trim() : '',
        x: Array.isArray(item.transform) ? Math.round(item.transform[4] ?? 0) : 0,
        y: Array.isArray(item.transform) ? Math.round(item.transform[5] ?? 0) : 0,
      }))
      .filter((item) => item.text);

    items.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
      return a.x - b.x;
    });

    const lines: string[] = [];
    let currentY: number | null = null;
    let currentLine: string[] = [];

    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) <= 3) {
        currentLine.push(item.text);
        currentY = currentY ?? item.y;
        continue;
      }
      lines.push(currentLine.join(' | '));
      currentLine = [item.text];
      currentY = item.y;
    }

    if (currentLine.length > 0) lines.push(currentLine.join(' | '));
    return lines.join('\n');
  } catch {
    return '';
  }
}

function mergeWindowCatalogs(
  existing: TakeoffSession['windowCatalog'] | undefined,
  incoming: TakeoffSession['windowCatalog'],
) {
  const byKey = new Map<string, NonNullable<TakeoffSession['windowCatalog']>[number]>();
  for (const item of existing ?? []) {
    byKey.set(item.tagNormalized ?? `${item.widthFt}:${item.heightFt}`, item);
  }
  for (const item of incoming ?? []) {
    byKey.set(item.tagNormalized ?? `${item.widthFt}:${item.heightFt}`, item);
  }
  return Array.from(byKey.values());
}

function mergeDoorCatalogs(
  existing: TakeoffSession['doorCatalog'] | undefined,
  incoming: TakeoffSession['doorCatalog'],
) {
  const byKey = new Map<string, NonNullable<TakeoffSession['doorCatalog']>[number]>();
  for (const item of existing ?? []) {
    byKey.set(item.tagNormalized ?? `${item.type}:${item.widthFt}:${item.heightFt}`, item);
  }
  for (const item of incoming ?? []) {
    byKey.set(item.tagNormalized ?? `${item.type}:${item.widthFt}:${item.heightFt}`, item);
  }
  return Array.from(byKey.values());
}

function extractWallFraming(value: unknown): string[] {
  if (typeof value === 'string') {
    const matches = value.match(/\b2x[46]\b/gi) ?? [];
    return uniqueStrings(matches.map((match) => match.toLowerCase()));
  }

  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => extractWallFraming(item)));
  }

  if (value && typeof value === 'object') {
    if ('framing' in value && typeof (value as { framing?: unknown }).framing === 'string') {
      return extractWallFraming((value as { framing: string }).framing);
    }
    return uniqueStrings(Object.values(value).flatMap((item) => extractWallFraming(item)));
  }

  return [];
}

function normalizeRValueToken(match: string): string | null {
  const normalized = match.replace(/\s+/g, '').replace(/^R\s*[-=]?\s*/i, '');
  const numeric = normalized.match(/^(\d+(?:\.\d+)?)/);
  if (numeric && Number(numeric[1]) <= 0) return null;
  return normalized ? `R-${normalized.toUpperCase()}` : null;
}

function extractRValueStrings(value: unknown): string[] {
  const bucket: string[] = [];

  const visit = (input: unknown) => {
    if (typeof input === 'string') {
      const matches = input.match(/R\s*[-=]?\s*\d+(?:\s*\+\s*\d+\s*ci)?/gi) ?? [];
      for (const match of matches) {
        const normalized = normalizeRValueToken(match);
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

function firstRValue(value: unknown): string | null {
  return extractRValueStrings(value)[0] ?? null;
}

function rValueNumber(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/R-(\d+)/i);
  return match ? Number(match[1]) : null;
}

function pickRepresentativeWallRValues(values: Array<string | null | undefined>) {
  const unique = uniqueStrings(values);
  if (unique.length <= 1) return unique;

  const sorted = [...unique].sort((a, b) => {
    const aValue = rValueNumber(a) ?? -Infinity;
    const bValue = rValueNumber(b) ?? -Infinity;
    return bValue - aValue;
  });

  return sorted.length > 0 ? [sorted[0]] : [];
}

function summarizeAtticContext(spec: string | null | undefined) {
  if (!spec) return null;
  if (/\bvault|vaulted|cathedral\b/i.test(spec)) return 'Vault';
  if (/\bflat\b/i.test(spec)) return 'Flat ceiling';
  if (/\bceiling\b/i.test(spec)) return 'Ceiling';
  if (/\broof\b/i.test(spec)) return 'Roof';
  if (/\battic\b/i.test(spec)) return 'Attic';
  return null;
}

function buildRValueDetail(rValue: string | null | undefined, context: string | null | undefined) {
  if (!rValue) return null;
  return context ? `${context}: ${rValue}` : rValue;
}

function extractContextualRValueDetails(
  value: unknown,
  contextResolver: (text: string) => string | null,
  fallbackContext?: string,
) {
  const details: string[] = [];

  const visit = (input: unknown) => {
    if (typeof input === 'string') {
      const matches = Array.from(
        input.matchAll(/R\s*[-=]?\s*\d+(?:\s*\+\s*\d+\s*ci)?/gi),
      );

      if (matches.length > 0) {
        matches.forEach((match, index) => {
          const nextIndex = matches[index + 1]?.index ?? input.length;
          const start = typeof match.index === 'number' ? match.index : 0;
          const clause = input.slice(start, nextIndex).trim();
          const rValue = normalizeRValueToken(match[0]);
          const context = contextResolver(clause) ?? fallbackContext ?? null;
          const detail = buildRValueDetail(rValue, context);
          if (detail && !details.includes(detail)) details.push(detail);
        });
        return;
      }

      const clauses = input
        .split(/[\n;]+/)
        .map((part) => part.trim())
        .filter(Boolean);

      clauses.forEach((clause) => {
        extractRValueStrings(clause).forEach((rValue) => {
          const context = contextResolver(clause) ?? fallbackContext ?? null;
          const detail = buildRValueDetail(rValue, context);
          if (detail && !details.includes(detail)) details.push(detail);
        });
      });
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
  return details;
}

function buildZoneHintsFromCompiled(compiled: FragmentedDetailCompiled | null | undefined) {
  if (!compiled) return undefined;

  const exteriorPatterns = [/\bwall\b/i, /\bexterior\b/i];
  const interiorPatterns = [/\binterior\b/i, /\bparty\b/i, /\bsound\b/i, /\bpartition\b/i, /\bcommon wall\b/i, /\bdemising\b/i];
  const atticPatterns = [/\battic\b/i, /\bceiling\b/i, /\broof\b/i, /\bvault/i, /\bcathedral\b/i];
  const crawlPatterns = [/\bcrawl/i, /\bfloor\b/i, /\bfoundation\b/i, /\bslab\b/i, /\bbasement\b/i, /\brim\b/i];

  const wallSections = compiled.wall_sections ?? [];
  const insulationRequirements = compiled.insulation_requirements ?? [];
  const insulationCallouts = compiled.insulation_callouts ?? [];
  const relevantFoundationEntries = (compiled.foundations ?? []).filter((entry) => {
    const insulation = typeof entry?.insulation === 'string' ? entry.insulation : null;
    return !insulation || !/\b(?:mechanical|duct|hvac)\b/i.test(insulation);
  });

  const exteriorWallSections = wallSections.filter((entry) => {
    const name =
      typeof entry?.name === 'string'
        ? entry.name
        : typeof entry?.source_label === 'string'
          ? entry.source_label
          : null;
    const notes = typeof entry?.notes === 'string' ? entry.notes : null;
    return (
      locationMatches(name, exteriorPatterns) ||
      locationMatches(notes, exteriorPatterns)
    );
  });

  const interiorWallSections = wallSections.filter((entry) => {
    const name =
      typeof entry?.name === 'string'
        ? entry.name
        : typeof entry?.source_label === 'string'
          ? entry.source_label
          : null;
    const notes = typeof entry?.notes === 'string' ? entry.notes : null;
    return locationMatches(name, interiorPatterns) || locationMatches(notes, interiorPatterns);
  });

  const exteriorRValues = pickRepresentativeWallRValues([
    ...exteriorWallSections.flatMap((entry) => [firstRValue(entry?.insulation_spec)]),
    ...insulationRequirements
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, exteriorPatterns),
      )
      .flatMap((entry) => [typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : null]),
  ]);

  const interiorRValues = pickRepresentativeWallRValues([
    ...interiorWallSections.flatMap((entry) => [firstRValue(entry?.insulation_spec)]),
    ...insulationRequirements
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, interiorPatterns),
      )
      .flatMap((entry) => [typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : null]),
  ]);

  const atticRValueDetails = uniqueStrings([
    ...(compiled.ceiling_insulation ?? []).flatMap((entry) => {
      const spec = typeof entry?.spec === 'string' ? entry.spec : null;
      const contextual = extractContextualRValueDetails(spec, summarizeAtticContext);
      if (contextual.length > 0) return contextual;

      return [
        buildRValueDetail(
          typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : firstRValue(spec),
          summarizeAtticContext(spec),
        ),
      ];
    }),
    ...insulationRequirements
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
      )
      .flatMap((entry) => [
        buildRValueDetail(
          typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : null,
          summarizeAtticContext(typeof entry?.location === 'string' ? entry.location : null),
        ),
      ]),
    ...insulationCallouts
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
      )
      .flatMap((entry) => [
        ...extractContextualRValueDetails(
          entry?.spec,
          summarizeAtticContext,
          summarizeAtticContext(typeof entry?.location === 'string' ? entry.location : null) ?? 'Attic',
        ),
      ]),
  ]);

  const atticRValues = uniqueStrings([
    ...(compiled.ceiling_insulation ?? []).flatMap((entry) => [
      ...extractRValueStrings(entry?.spec),
      ...(typeof entry?.r_value === 'number' ? [`R-${entry.r_value}`] : []),
    ]),
    ...insulationRequirements
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
      )
      .flatMap((entry) => [typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : null]),
    ...insulationCallouts
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
      )
      .flatMap((entry) => [firstRValue(entry?.spec)]),
  ]);

  const crawlRValueDetails = uniqueStrings([
    ...(compiled.floor_insulation ?? []).flatMap((entry) => [
      buildRValueDetail(
        typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : firstRValue(entry?.spec),
        'Floor',
      ),
    ]),
    ...relevantFoundationEntries.flatMap((entry) => [
      ...extractContextualRValueDetails(
        entry?.insulation,
        () => null,
        typeof entry?.type === 'string' ? entry.type : 'Foundation',
      ),
    ]),
    ...insulationRequirements
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, crawlPatterns),
      )
      .flatMap((entry) => [
        buildRValueDetail(
          typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : null,
          typeof entry?.location === 'string' ? entry.location : 'Floor/Foundation',
        ),
      ]),
  ]);

  const crawlRValues = uniqueStrings([
    ...(compiled.floor_insulation ?? []).flatMap((entry) => [
      typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : firstRValue(entry?.spec),
    ]),
    ...relevantFoundationEntries.flatMap((entry) => [
      firstRValue(entry?.insulation),
    ]),
    ...insulationRequirements
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, crawlPatterns),
      )
      .flatMap((entry) => [typeof entry?.r_value === 'number' ? `R-${entry.r_value}` : null]),
    ...insulationCallouts
      .filter((entry) =>
        locationMatches(typeof entry?.location === 'string' ? entry.location : null, crawlPatterns),
      )
      .flatMap((entry) => [firstRValue(entry?.spec)]),
  ]);

  const exteriorFraming = uniqueStrings(exteriorWallSections.flatMap((entry) => extractWallFraming(entry)));
  const interiorFraming = uniqueStrings(interiorWallSections.flatMap((entry) => extractWallFraming(entry)));
  const exteriorVaporBarriers = extractVaporBarrierStrings(exteriorWallSections);
  const interiorVaporBarriers = extractVaporBarrierStrings(interiorWallSections);
  const exteriorAirBarriers = extractAirBarrierStrings(exteriorWallSections);
  const atticRoofPitches = uniqueStrings([
    ...(compiled.derived_roof_pitches ?? []),
    ...extractRoofPitchStrings(compiled.sections ?? []),
  ]);
  const atticVaporBarriers = extractVaporBarrierStrings([
    ...(compiled.ceiling_insulation ?? []),
    ...(compiled.insulation_requirements ?? []).filter((entry) =>
      locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
    ),
    ...(compiled.insulation_callouts ?? []).filter((entry) =>
      locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
    ),
  ]);
  const atticAirBarriers = extractAirBarrierStrings([
    ...(compiled.ceiling_insulation ?? []),
    ...(compiled.insulation_requirements ?? []).filter((entry) =>
      locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
    ),
    ...(compiled.insulation_callouts ?? []).filter((entry) =>
      locationMatches(typeof entry?.location === 'string' ? entry.location : null, atticPatterns),
    ),
  ]);
  const atticBafflesOrVenting = uniqueStrings([
    ...(compiled.derived_baffles_or_venting ?? []),
    ...extractBaffleOrVentingStrings(compiled.ceiling_insulation ?? []),
  ]);
  const crawlVaporBarriers = extractVaporBarrierStrings([
    ...(compiled.floor_insulation ?? []),
    ...relevantFoundationEntries,
    ...(compiled.insulation_requirements ?? []).filter((entry) =>
      locationMatches(typeof entry?.location === 'string' ? entry.location : null, crawlPatterns),
    ),
  ]);
  const crawlAirBarriers = extractAirBarrierStrings([
    ...(compiled.floor_insulation ?? []),
    ...relevantFoundationEntries,
    ...(compiled.insulation_requirements ?? []).filter((entry) =>
      locationMatches(typeof entry?.location === 'string' ? entry.location : null, crawlPatterns),
    ),
  ]);

  const hints: NonNullable<PageScanExtracts['zone_hints']> = {};

  if (
    exteriorRValues.length > 0 ||
    exteriorFraming.length > 0 ||
    exteriorVaporBarriers.length > 0 ||
    exteriorAirBarriers.length > 0
  ) {
    const exteriorNotes = uniqueStrings(
      exteriorWallSections.flatMap((entry) => [
        typeof entry?.name === 'string' ? entry.name : null,
        typeof entry?.notes === 'string' ? entry.notes : null,
      ]),
    );
    hints.exterior = {
      r_values: exteriorRValues,
      r_value_details: exteriorRValues,
      insulation_types: deriveZoneInsulationTypes(
        exteriorRValues,
        exteriorNotes,
      ),
      wall_framing: exteriorFraming,
      vapor_barriers: exteriorVaporBarriers,
      air_barriers: exteriorAirBarriers,
      notes: exteriorNotes,
    };
  }

  if (interiorRValues.length > 0 || interiorFraming.length > 0 || interiorVaporBarriers.length > 0) {
    const interiorNotes = uniqueStrings(
      interiorWallSections.flatMap((entry) => [
        typeof entry?.name === 'string' ? entry.name : null,
        typeof entry?.notes === 'string' ? entry.notes : null,
      ]),
    );
    hints.interior = {
      r_values: interiorRValues,
      r_value_details: interiorRValues,
      insulation_types: deriveZoneInsulationTypes(
        interiorRValues,
        interiorNotes,
      ),
      wall_framing: interiorFraming,
      vapor_barriers: interiorVaporBarriers,
      notes: interiorNotes,
    };
  }

  if (
    atticRValues.length > 0 ||
    atticRoofPitches.length > 0 ||
    atticVaporBarriers.length > 0 ||
    atticAirBarriers.length > 0 ||
    atticBafflesOrVenting.length > 0
  ) {
    const atticNotes = uniqueStrings(
      (compiled.ceiling_insulation ?? []).map((entry) =>
        typeof entry?.spec === 'string' ? entry.spec : null,
      ),
    );
    hints.attic = {
      r_values: atticRValues,
      r_value_details: atticRValueDetails,
      insulation_types: deriveZoneInsulationTypes(
        atticRValues,
        atticNotes,
      ),
      roof_pitches: atticRoofPitches,
      vapor_barriers: atticVaporBarriers,
      air_barriers: atticAirBarriers,
      baffles_or_venting: atticBafflesOrVenting,
      notes: atticNotes,
    };
  }

  if (crawlRValues.length > 0 || crawlVaporBarriers.length > 0 || crawlAirBarriers.length > 0) {
    const crawlNotes = uniqueStrings([
      ...(compiled.floor_insulation ?? []).map((entry) =>
        typeof entry?.spec === 'string' ? entry.spec : null,
      ),
      ...relevantFoundationEntries.map((entry) =>
        typeof entry?.insulation === 'string' ? entry.insulation : null,
      ),
    ]);
    hints.crawlspace = {
      r_values: crawlRValues,
      r_value_details: crawlRValueDetails.length > 0 ? crawlRValueDetails : crawlRValues,
      insulation_types: deriveZoneInsulationTypes(
        crawlRValues,
        crawlNotes,
      ),
      vapor_barriers: crawlVaporBarriers,
      air_barriers: crawlAirBarriers,
      notes: crawlNotes,
    };
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
}

function shouldRunFragmentedDetailPass(page: PageClassification) {
  const title = `${page.page_name ?? ''} ${page.page_type ?? ''}`;
  return (
    DETAIL_ENRICHMENT_PAGE_TYPES.has(page.page_type) ||
    DETAIL_ENRICHMENT_TITLE_PATTERN.test(title) ||
    Boolean(
      page.scan_flags?.general_insulation_notes ||
        page.scan_flags?.wall_type_legend ||
        page.scan_flags?.exterior_wall_details ||
        page.scan_flags?.interior_wall_details ||
        page.scan_flags?.roof_ceiling_details ||
        page.scan_flags?.roof_pitch ||
        page.scan_flags?.floor_foundation_details ||
        page.scan_flags?.enlarged_sections ||
        page.scan_flags?.opening_info ||
        page.scan_flags?.material_specs ||
        page.scan_flags?.vapor_barrier ||
        page.scan_flags?.air_barrier ||
        page.scan_flags?.baffles_or_venting
    )
  );
}

function detailEnrichmentPriority(page: PageClassification) {
  let score = 0;
  if (page.page_type === 'detail') score += 6;
  if (page.page_type === 'section') score += 5;
  if (page.page_type === 'schedule') score += 4;
  if (page.page_type === 'elevation') score += 2;
  if (page.scan_flags?.general_insulation_notes) score += 6;
  if (page.scan_flags?.material_specs) score += 5;
  if (page.scan_flags?.wall_type_legend) score += 5;
  if (page.scan_flags?.roof_ceiling_details) score += 4;
  if (page.scan_flags?.roof_pitch) score += 5;
  if (page.scan_flags?.floor_foundation_details) score += 4;
  if (page.scan_flags?.vapor_barrier) score += 4;
  if (page.scan_flags?.air_barrier) score += 3;
  if (page.scan_flags?.baffles_or_venting) score += 3;
  if (page.scan_flags?.opening_info) score += 3;
  if (page.scan_flags?.height_references) score += 2;
  if (DETAIL_ENRICHMENT_TITLE_PATTERN.test(page.page_name ?? '')) score += 2;
  return score;
}

function mergeFragmentedDetailData(
  page: PageClassification,
  detailData: FragmentedDetailResponse | null,
): PageClassification {
  const compiled = detailData?.compiled;
  if (!compiled) return page;
  const extractedOpeningScheduleItems = [
    ...readOpeningScheduleItems(compiled.window_schedule, 'window', page.page_index),
    ...readOpeningScheduleItems(compiled.door_schedule, 'door', page.page_index),
  ];

  const nextExtracts: PageScanExtracts = {
    window_sizes: uniqueStrings([
      ...(page.scan_extracts?.window_sizes ?? []),
      ...readScheduleSizes(compiled.window_schedule),
    ]),
    opening_quantity_notes: uniqueStrings([
      ...(page.scan_extracts?.opening_quantity_notes ?? []),
      ...readScheduleQuantityNotes(compiled.window_schedule, 'window type'),
      ...readScheduleQuantityNotes(compiled.door_schedule, 'door type'),
      ...readOpeningNotes(compiled.opening_notes),
    ]),
    opening_evidence: page.scan_extracts?.opening_evidence,
    opening_schedule_items: dedupeOpeningScheduleItems([
      ...(page.scan_extracts?.opening_schedule_items ?? []),
      ...extractedOpeningScheduleItems,
    ]),
    insulation_types: uniqueStrings([
      ...(page.scan_extracts?.insulation_types ?? []),
      ...(compiled.derived_insulation_types ?? []),
    ]),
    r_values: uniqueStrings([
      ...(page.scan_extracts?.r_values ?? []),
      ...(compiled.derived_r_values ?? []),
    ]),
    roof_pitches: uniqueStrings([
      ...(page.scan_extracts?.roof_pitches ?? []),
      ...(compiled.derived_roof_pitches ?? []),
      ...extractRoofPitchStrings(compiled.sections ?? []),
    ]),
    vapor_barriers: uniqueStrings([
      ...(page.scan_extracts?.vapor_barriers ?? []),
      ...(compiled.derived_vapor_barriers ?? []),
      ...extractVaporBarrierStrings(compiled.wall_sections ?? []),
      ...extractVaporBarrierStrings(compiled.general_notes ?? []),
    ]),
    air_barriers: uniqueStrings([
      ...(page.scan_extracts?.air_barriers ?? []),
      ...(compiled.derived_air_barriers ?? []),
      ...extractAirBarrierStrings(compiled.general_notes ?? []),
      ...extractAirBarrierStrings(compiled.wall_sections ?? []),
    ]),
    baffles_or_venting: uniqueStrings([
      ...(page.scan_extracts?.baffles_or_venting ?? []),
      ...(compiled.derived_baffles_or_venting ?? []),
      ...extractBaffleOrVentingStrings(compiled.ceiling_insulation ?? []),
      ...extractBaffleOrVentingStrings(compiled.general_notes ?? []),
    ]),
    wall_framing: uniqueStrings([
      ...(page.scan_extracts?.wall_framing ?? []),
      ...extractWallFraming(compiled.wall_sections ?? []),
    ]),
    zone_hints: buildZoneHintsFromCompiled(compiled) ?? page.scan_extracts?.zone_hints,
  };

  const nextNotes = uniqueStrings([
    ...(page.scan_notes ?? []),
    detailData?.fragments?.length
      ? `Detail scan reviewed ${detailData.fragments.length} fragment${detailData.fragments.length === 1 ? '' : 's'}.`
      : null,
    nextExtracts.r_values.length
      ? `Extracted R-values: ${summarizeValues(nextExtracts.r_values, 4)}.`
      : null,
    nextExtracts.insulation_types.length
      ? `Explicit insulation types: ${summarizeValues(nextExtracts.insulation_types, 3)}.`
      : null,
    nextExtracts.roof_pitches.length
      ? `Roof pitch candidates: ${summarizeValues(nextExtracts.roof_pitches, 3)}.`
      : null,
    nextExtracts.vapor_barriers.length
      ? `Vapor barrier notes: ${summarizeValues(nextExtracts.vapor_barriers, 2)}.`
      : null,
    nextExtracts.air_barriers.length
      ? `Air barrier notes: ${summarizeValues(nextExtracts.air_barriers, 2)}.`
      : null,
    nextExtracts.baffles_or_venting.length
      ? `Baffle / venting notes: ${summarizeValues(nextExtracts.baffles_or_venting, 2)}.`
      : null,
    nextExtracts.wall_framing?.length
      ? `Wall framing: ${summarizeValues(nextExtracts.wall_framing, 3)}.`
      : null,
    nextExtracts.window_sizes.length
      ? `Window sizes found: ${summarizeValues(nextExtracts.window_sizes, 3)}.`
      : null,
    nextExtracts.opening_schedule_items?.length
      ? `Opening schedule rows found: ${nextExtracts.opening_schedule_items.length}.`
      : null,
    nextExtracts.opening_quantity_notes.length
      ? `Opening hints: ${summarizeValues(nextExtracts.opening_quantity_notes, 2)}.`
      : null,
  ]);

  return {
    ...page,
    scan_extracts: nextExtracts,
    scan_notes: nextNotes,
  };
}

function mergeClassifications(
  current: PageClassification[],
  incoming: PageClassification[],
) {
  const merged = new Map(current.map((page) => [page.page_index, page]));
  for (const page of incoming) {
    merged.set(page.page_index, page);
  }
  return Array.from(merged.values()).sort((a, b) => a.page_index - b.page_index);
}

function isGenericPageTitle(title: string | undefined, pageIndex: number): boolean {
  const normalized = title?.trim() ?? '';
  if (!normalized) return true;
  return normalized.toLowerCase() === `page ${pageIndex + 1}`.toLowerCase();
}

function mergePageAnalysisTitles(
  existing: PageAnalysis[],
  generated: PageAnalysis[],
): PageAnalysis[] {
  const existingByPage = new Map(existing.map((page) => [page.pageIndex, page]));

  return generated.map((page) => {
    const current = existingByPage.get(page.pageIndex);
    if (!current) return page;

    return {
      ...page,
      selectedByAi: current.selectedByAi,
      roles: current.roles.length > 0 ? current.roles : page.roles,
      aiRoles: current.aiRoles.length > 0 ? current.aiRoles : page.aiRoles,
      title: isGenericPageTitle(current.title, page.pageIndex) ? page.title : current.title,
      capabilities: current.capabilities.length > 0 ? current.capabilities : page.capabilities,
      notes: current.notes.length > 0 ? current.notes : page.notes,
      scanFlags: current.scanFlags ?? page.scanFlags,
      stopFlags: current.stopFlags ?? page.stopFlags,
      scanExtracts: normalizePageScanExtracts(current.scanExtracts ?? page.scanExtracts),
    };
  });
}

function syncPrimaryViewTitles(
  views: TakeoffView[] | undefined,
  pageAnalysis: PageAnalysis[],
): TakeoffView[] | undefined {
  if (!views?.length) return views;

  const titlesByPage = new Map(
    pageAnalysis.map((page) => [page.pageIndex, page.title.trim()]),
  );

  return views.map((view) => {
    if (!view.isPrimary) return view;

    const pageTitle = titlesByPage.get(view.pageIndex);
    if (!pageTitle) return view;

    const nextName = `${pageTitle} / Primary View`;
    const currentName = view.name?.trim() ?? '';
    const isGenericName =
      !currentName ||
      currentName === `Page ${view.pageIndex + 1}` ||
      currentName === `Page ${view.pageIndex + 1} / Primary View`;

    if (!isGenericName && currentName !== nextName) {
      return view;
    }

    return currentName === nextName ? view : { ...view, name: nextName };
  });
}

function buildPageScores(
  totalPages: number,
  classifications: PageClassification[],
): PageScore[] {
  return Array.from({ length: totalPages }, (_, i) => {
    const cls = classifications.find((c) => c.page_index === i);
    const aiRoles = inferAiPageRoles({
      page_type: cls?.page_type,
      is_floor_plan: cls?.is_floor_plan,
      takeoff_relevance: cls?.takeoff_relevance,
      scan_flags: cls?.scan_flags,
    });

    return {
      page_index: i,
      score: cls?.confidence ?? 0,
      label: cls?.page_name ?? `Page ${i + 1}`,
      ai_selected: aiRoles.length > 0,
      page_type: cls?.page_type ?? 'other',
      secondary_page_types: cls?.secondary_page_types ?? [],
      takeoff_relevance: cls?.takeoff_relevance,
      roles: aiRoles,
      ai_roles: aiRoles,
      scan_flags: cls?.scan_flags,
      stop_flags: cls?.stop_flags,
      scan_extracts: normalizePageScanExtracts(cls?.scan_extracts),
      scan_notes: cls?.scan_notes,
    };
  });
}

function totalPagesFromPageAnalysis(pageAnalysis: PageAnalysis[]) {
  if (pageAnalysis.length === 0) return 0;
  return Math.max(...pageAnalysis.map((page) => page.pageIndex)) + 1;
}

function takeoffRelevanceFromRoles(roles: PageScore['roles']): PageTakeoffRelevance {
  if (roles.includes('measurement')) return 'primary_measurement';
  if (roles.includes('evidence')) return 'supporting_evidence';
  return 'low_value';
}

function buildClassificationsFromPageAnalysis(pageAnalysis: PageAnalysis[]): PageClassification[] {
  return pageAnalysis.map((page) => {
    const takeoffRelevance = takeoffRelevanceFromRoles(page.roles);
    return {
      page_index: page.pageIndex,
      page_type: page.pageType ?? 'other',
      secondary_page_types: [],
      page_name: page.title || `Page ${page.pageIndex + 1}`,
      takeoff_relevance: takeoffRelevance,
      has_dimensions:
        Boolean(page.scanFlags?.dimensions) ||
        page.roles.includes('measurement') ||
        page.capabilities.some(
          (capability) =>
            capability.capability === 'wall_measurement' && capability.score >= 0.7,
        ),
      is_floor_plan:
        page.pageType === 'floor_plan' ||
        page.roles.includes('measurement') ||
        page.capabilities.some(
          (capability) =>
            capability.capability === 'wall_measurement' && capability.score >= 0.7,
        ),
      confidence: page.confidence,
      scan_flags: page.scanFlags,
      stop_flags: page.stopFlags,
      scan_extracts: normalizePageScanExtracts(page.scanExtracts),
      scan_notes: page.notes,
    };
  });
}

function resetTakeoffStore() {
  useTakeoffStore.setState({
    session: null,
    currentStep: 'analysis',
    pageScores: [],
    selectedPages: [],
    previewPageIndex: 0,
    activePageIndex: 0,
    activeViewId: null,
    tool: 'pointer',
    calibrationStep: 'idle',
    calibrationPointA: null,
    calibrationPointB: null,
    drawingPreset: 'wall',
    wallPreset: 'exterior_2x6',
    zonePreset: 'conditioned',
    surfacePreset: 'attic_floor',
    traceMode: 'linear',
    activeTraceId: null,
    activeTracePoints: [],
    selectedTraceId: null,
    selectedSegmentIndex: null,
    visionCache: {},
    visionLoading: {},
  });
}

export default function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectRef } = use(params);
  const router = useRouter();
  usePreventHistoryBack(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectRouteRef, setProjectRouteRef] = useState(projectRef);

  // ── Document state ──────────────────────────────────────────────────────────
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // ── AI classification state ─────────────────────────────────────────────────
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationDone, setClassificationDone] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<VisionAnalysisProgress | null>(null);
  const [classifications, setClassifications] = useState<PageClassification[]>([]);
  const [visionScanRunId, setVisionScanRunId] = useState(0);
  const classifyStartedRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSessionVersionRef = useRef<string | null>(null);

  // ── Store ───────────────────────────────────────────────────────────────────
  const currentStep = useTakeoffStore((s) => s.currentStep);
  const session = useTakeoffStore((s) => s.session);
  const setSession = useTakeoffStore((s) => s.setSession);
  const confirmPageSelection = useTakeoffStore((s) => s.confirmPageSelection);
  const setPageScoresStore = useTakeoffStore((s) => s.setPageScores);
  const setStep = useTakeoffStore((s) => s.setStep);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [guideReplaySignal, setGuideReplaySignal] = useState(0);
  const summaryRef = useRef<TakeoffSummaryHandle | null>(null);
  const [isSummaryContinuing, setIsSummaryContinuing] = useState(false);

  // ── Load document on mount ─────────────────────────────────────────────────
  useEffect(() => {
    async function loadDocument() {
      const requestedStep =
        typeof window === 'undefined'
          ? null
          : parseTakeoffRouteStep(new URLSearchParams(window.location.search).get('step'));

      resetTakeoffStore();
      setProjectId(null);
      setProjectRouteRef(projectRef);
      setClassifications([]);
      setClassificationDone(false);
      setClassificationError(null);
      setAnalysisProgress(null);
      setIsClassifying(false);
      setTotalPages(0);
      setVisionScanRunId(0);
      classifyStartedRef.current = false;

      try {
        const companyId = await getActiveCompanyId();
        const { data: projectData, error: projectError } = await supabase
          .from('projects')
          .select('id, slug')
          .eq(getProjectRefColumn(projectRef), projectRef)
          .eq('company_id', companyId)
          .single();

        if (projectError || !projectData) {
          throw projectError ?? new Error('Project not found');
        }

        const resolvedProjectId = projectData.id;
        setProjectId(resolvedProjectId);
        setProjectRouteRef(getProjectRouteRef(projectData));

        const { data: docs } = await supabase
          .from('documents')
          .select('id, file_url')
          .eq('project_id', resolvedProjectId)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (docs && docs.length > 0) {
          setPdfUrl(docs[0].file_url);
          setDocumentId(docs[0].id);

          const { data: existingSession } = await supabase
            .from('takeoff_sessions')
            .select('*')
            .eq('document_id', docs[0].id)
            .eq('company_id', companyId)
            .in('status', ['in_progress', 'calibrating', 'tracing', 'reviewing', 'completed'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingSession) {
            const resumedSession = mapTakeoffSessionRowToSession(
              existingSession as TakeoffSessionRowLike
            );
            registerPersistedSessionRevision(
              resumedSession.id,
              resumedSession.updatedAt,
            );
            const restoredStep = requestedStep ?? 'analysis';
            useTakeoffStore.setState({
              session: resumedSession,
              currentStep: restoredStep,
              selectedPages: resumedSession.selectedPages,
              activePageIndex:
                resumedSession.pageAnalysis?.find((page) => page.roles.includes('measurement'))
                  ?.pageIndex ??
                resumedSession.selectedPages[0] ??
                0,
              activeViewId:
                resumedSession.viewerState?.find(
                  (viewerState) =>
                    viewerState.pageIndex ===
                    (resumedSession.pageAnalysis?.find((page) => page.roles.includes('measurement'))
                      ?.pageIndex ??
                      resumedSession.selectedPages[0] ??
                      0)
                )?.activeViewId ??
                resumedSession.views?.[0]?.id ??
                null,
              tool: 'pointer',
              calibrationStep: 'idle',
            });

            if (resumedSession.pageAnalysis?.length) {
              const restoredClassifications = buildClassificationsFromPageAnalysis(
                resumedSession.pageAnalysis,
              );
              const restoredTotalPages =
                totalPagesFromPageAnalysis(resumedSession.pageAnalysis) ||
                restoredClassifications.length;

              setTotalPages(restoredTotalPages);
              setClassifications(restoredClassifications);
              setClassificationDone(true);
              setClassificationError(null);
              setAnalysisProgress(
                makeAnalysisProgress({
                  stage: 'complete',
                  message: 'Loaded saved vision results',
                  progress: 100,
                  renderedPages: restoredTotalPages,
                  totalPages: restoredTotalPages,
                }),
              );
              classifyStartedRef.current = true;
            }
          }
        }
      } catch (err) {
        console.error('[TakeoffPage] Failed to load document:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadDocument();
  }, [projectRef]);

  // ── Classify pages with Vision AI (cached per document) ─────────────────────
  const classifyPages = useCallback(async (url: string, options: ClassifyPagesOptions = {}) => {
    if (classifyStartedRef.current) return;
    classifyStartedRef.current = true;

    setClassificationError(null);
    setClassificationDone(false);
    setAnalysisProgress(
      makeAnalysisProgress({
        stage: 'loading_pdf',
        message: 'Opening the PDF and counting pages',
        progress: 4,
      })
    );

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const loadingTask = pdfjs.getDocument(url);
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      setTotalPages(numPages);
      const cacheKey = `takeoff_classify_v8_${documentId}_${numPages}`;

      try {
        if (options.force) {
          localStorage.removeItem(cacheKey);
        } else {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const results: PageClassification[] = JSON.parse(cached);
            if (hasMeaningfulClassificationResults(results, numPages)) {
              setClassifications(results);
              setClassificationDone(true);
              setAnalysisProgress(
                makeAnalysisProgress({
                  stage: 'complete',
                  message: 'Loaded cached vision results',
                  progress: 100,
                  totalPages: numPages,
                })
              );
              return;
            }
            localStorage.removeItem(cacheKey);
          }
        }
      } catch {}

      setIsClassifying(true);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'rendering_pages',
          message: `Rendering page previews (0/${numPages})`,
          progress: 8,
          totalPages: numPages,
        })
      );

      const pages: Array<{ image_base64: string }> = [];
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const base64 = canvas.toDataURL('image/jpeg', 0.6).replace(/^data:image\/jpeg;base64,/, '');
        pages.push({ image_base64: base64 });
        setAnalysisProgress(
          makeAnalysisProgress({
            stage: 'rendering_pages',
            message: `Rendering page previews (${i}/${numPages})`,
            progress: Math.min(40, Math.round(8 + (i / numPages) * 32)),
            renderedPages: i,
            totalPages: numPages,
          })
        );
      }

      let results: PageClassification[] = [];
      const totalBatches = Math.ceil(numPages / CLASSIFICATION_BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        const batchStart = batchIndex * CLASSIFICATION_BATCH_SIZE;
        const batchPages = pages.slice(batchStart, batchStart + CLASSIFICATION_BATCH_SIZE);
        const batchEnd = batchStart + batchPages.length;

        setAnalysisProgress(
          makeAnalysisProgress({
            stage: 'classifying_pages',
            message: `Classifying pages ${batchStart + 1}-${batchEnd} of ${numPages}`,
            progress: 48 + Math.round((batchIndex / totalBatches) * 18),
            renderedPages: numPages,
            totalPages: numPages,
          })
        );

        const response = await fetch('/api/takeoff/classify-pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages: batchPages }),
        });

        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          throw new Error(
            typeof failure?.error === 'string'
              ? failure.error
              : 'Vision analysis request failed.'
          );
        }

        const data = await response.json();
        const routeError = typeof data.error === 'string' ? data.error : null;
        if (routeError) {
          throw new Error(routeError);
        }

        const batchResults = (data.pages ?? []) as PageClassification[];
        if (!hasMeaningfulClassificationResults(batchResults, batchPages.length)) {
          throw new Error(`Vision analysis returned no usable results for pages ${batchStart + 1}-${batchEnd}.`);
        }

        const offsetResults = batchResults.map((page) => ({
          ...page,
          page_index: page.page_index + batchStart,
        }));

        results = mergeClassifications(results, offsetResults);
        setClassifications(results);

        setAnalysisProgress(
          makeAnalysisProgress({
            stage: 'classifying_pages',
            message: `Received page roles for ${results.length}/${numPages} pages`,
            progress: 54 + Math.round((results.length / numPages) * 16),
            renderedPages: numPages,
            totalPages: numPages,
          })
        );
      }

      if (!hasMeaningfulClassificationResults(results, numPages)) {
        throw new Error('Vision analysis returned no usable page results.');
      }

      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'classifying_pages',
          message: 'Interpreting classified page roles and evidence coverage',
          progress: 70,
          renderedPages: numPages,
          totalPages: numPages,
        })
      );

      const enrichmentCandidates = results
          .filter(shouldRunFragmentedDetailPass)
          .sort((a, b) => detailEnrichmentPriority(b) - detailEnrichmentPriority(a))
          .slice(0, DETAIL_ENRICHMENT_PAGE_LIMIT);

      if (enrichmentCandidates.length > 0) {
        let completedDetailPages = 0;

        setAnalysisProgress(
          makeAnalysisProgress({
            stage: 'extracting_details',
            message: `Extracting detail-sheet specs (0/${enrichmentCandidates.length})`,
            progress: 76,
            renderedPages: numPages,
            totalPages: numPages,
            detailPagesCompleted: 0,
            detailPagesTotal: enrichmentCandidates.length,
          })
        );

        for (const candidate of enrichmentCandidates) {
          try {
            const page = await pdf.getPage(candidate.page_index + 1);
            const viewport = page.getViewport({ scale: detailRenderScale(candidate) });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const pageText = shouldRunOpeningSchedulePass(candidate)
                ? await extractPdfPageText(page)
                : '';
              await page.render({ canvasContext: ctx, viewport }).promise;
              const imageBase64 = canvas
                .toDataURL('image/jpeg', shouldRunOpeningSchedulePass(candidate) ? 0.94 : 0.82)
                .replace(/^data:image\/jpeg;base64,/, '');

              const detailResponse = await fetch('/api/takeoff/analyze-page-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  image_base64: imageBase64,
                  page_type: 'fragmented_details',
                }),
              });

              if (detailResponse.ok) {
                const detailPayload = await detailResponse.json();
                const detailData = (detailPayload?.data ?? null) as FragmentedDetailResponse | null;
                results = results.map((pageResult) =>
                  pageResult.page_index === candidate.page_index
                    ? mergeFragmentedDetailData(pageResult, detailData)
                    : pageResult
                );
                setClassifications(results);
              }

              if (shouldRunOpeningSchedulePass(candidate)) {
                const openingResponse = await fetch('/api/takeoff/analyze-page-details', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    image_base64: imageBase64,
                    page_type: 'opening_schedule',
                    page_text: pageText,
                  }),
                });

                if (openingResponse.ok) {
                  const openingPayload = await openingResponse.json();
                  const openingDetailData = openingReferenceToDetailData(
                    (openingPayload?.data ?? null) as OpeningReferenceResponse | null,
                  );
                  results = results.map((pageResult) =>
                    pageResult.page_index === candidate.page_index
                      ? mergeFragmentedDetailData(pageResult, openingDetailData)
                      : pageResult
                  );
                  setClassifications(results);
                }
              }
            }
          } catch (detailErr) {
            console.warn(
              `[TakeoffPage] Detail enrichment failed for page ${candidate.page_index + 1}:`,
              detailErr
            );
          } finally {
            completedDetailPages += 1;
            setAnalysisProgress(
              makeAnalysisProgress({
                stage: 'extracting_details',
                message: `Extracting detail-sheet specs (${completedDetailPages}/${enrichmentCandidates.length})`,
                progress:
                  76 +
                  Math.round((completedDetailPages / enrichmentCandidates.length) * 16),
                renderedPages: numPages,
                totalPages: numPages,
                detailPagesCompleted: completedDetailPages,
                detailPagesTotal: enrichmentCandidates.length,
              })
            );
          }
        }
      }

      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'finalizing',
          message: 'Building the review-ready page set',
          progress: 96,
          renderedPages: numPages,
          totalPages: numPages,
          detailPagesCompleted: enrichmentCandidates.length,
          detailPagesTotal: enrichmentCandidates.length,
        })
      );

      setClassifications(results);
      setClassificationDone(true);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'complete',
          message: 'Vision analysis complete',
          progress: 100,
          renderedPages: numPages,
          totalPages: numPages,
          detailPagesCompleted: enrichmentCandidates.length,
          detailPagesTotal: enrichmentCandidates.length,
        })
      );

      try {
        localStorage.setItem(cacheKey, JSON.stringify(results));
      } catch {}
    } catch (err) {
      console.error('[TakeoffPage] Page classification failed:', err);
      const publicError = getPublicAnalysisError(err);
      setClassifications([]);
      setClassificationDone(false);
      setClassificationError(publicError);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'failed',
          message: publicError,
          progress: 0,
        })
      );
      classifyStartedRef.current = false;
    } finally {
      setIsClassifying(false);
    }
  }, [documentId]);

  const handleRetryVisionScan = useCallback(() => {
    if (!pdfUrl || !documentId || isClassifying) return;

    classifyStartedRef.current = false;
    setVisionScanRunId((value) => value + 1);
    setClassifications([]);
    setClassificationDone(false);
    setClassificationError(null);
    setPageScoresStore([]);
    void classifyPages(pdfUrl, { force: true });
  }, [classifyPages, documentId, isClassifying, pdfUrl, setPageScoresStore]);

  const handleRetryScheduleScan = useCallback(async () => {
    if (!pdfUrl || !documentId || isClassifying || classifications.length === 0) return;

    const candidates = classifications.filter(shouldRunOpeningSchedulePass);
    if (candidates.length === 0) return;

    setIsClassifying(true);
    setClassificationError(null);
    setAnalysisProgress(
      makeAnalysisProgress({
        stage: 'extracting_details',
        message: `Rerunning opening schedule extraction (0/${candidates.length})`,
        progress: 76,
        renderedPages: totalPages,
        totalPages,
        detailPagesCompleted: 0,
        detailPagesTotal: candidates.length,
      }),
    );

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const loadingTask = pdfjs.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      let nextResults = classifications;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const page = await pdf.getPage(candidate.page_index + 1);
        const pageText = await extractPdfPageText(page);
        const viewport = page.getViewport({ scale: detailRenderScale(candidate) });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        await page.render({ canvasContext: ctx, viewport }).promise;
        const imageBase64 = canvas
          .toDataURL('image/jpeg', 0.94)
          .replace(/^data:image\/jpeg;base64,/, '');

        const response = await fetch('/api/takeoff/analyze-page-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: imageBase64,
            page_type: 'opening_schedule',
            page_text: pageText,
          }),
        });

        if (response.ok) {
          const payload = await response.json();
          const openingDetailData = openingReferenceToDetailData(
            (payload?.data ?? null) as OpeningReferenceResponse | null,
          );
          nextResults = nextResults.map((pageResult) => {
            if (pageResult.page_index !== candidate.page_index) return pageResult;
            return mergeFragmentedDetailData(pageResult, openingDetailData);
          });
          setClassifications(nextResults);
        }

        setAnalysisProgress(
          makeAnalysisProgress({
            stage: 'extracting_details',
            message: `Rerunning opening schedule extraction (${index + 1}/${candidates.length})`,
            progress: 76 + Math.round(((index + 1) / candidates.length) * 20),
            renderedPages: numPages,
            totalPages: numPages,
            detailPagesCompleted: index + 1,
            detailPagesTotal: candidates.length,
          }),
        );
      }

      setClassifications(nextResults);
      setClassificationDone(true);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'complete',
          message: 'Opening schedule extraction complete',
          progress: 100,
          renderedPages: numPages,
          totalPages: numPages,
          detailPagesCompleted: candidates.length,
          detailPagesTotal: candidates.length,
        }),
      );

      try {
        localStorage.setItem(`takeoff_classify_v8_${documentId}_${numPages}`, JSON.stringify(nextResults));
      } catch {}
    } catch (err) {
      console.error('[TakeoffPage] Schedule extraction failed:', err);
      const publicError = getPublicAnalysisError(err);
      setClassificationError(publicError);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'failed',
          message: publicError,
          progress: 0,
        }),
      );
    } finally {
      setIsClassifying(false);
    }
  }, [classifications, documentId, isClassifying, pdfUrl, totalPages]);

  const handleAnalyzeScheduleCrop = useCallback(async (
    pageIndex: number,
    bbox: { x: number; y: number; width: number; height: number },
  ) => {
    if (!pdfUrl || !documentId || isClassifying || classifications.length === 0) return;

    setIsClassifying(true);
    setClassificationError(null);
    setAnalysisProgress(
      makeAnalysisProgress({
        stage: 'extracting_details',
        message: `Parsing schedule crop on page ${pageIndex + 1}`,
        progress: 82,
        renderedPages: totalPages,
        totalPages,
        detailPagesCompleted: 0,
        detailPagesTotal: 1,
      }),
    );

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const loadingTask = pdfjs.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(pageIndex + 1);
      const pageText = await extractPdfPageText(page);
      const viewport = page.getViewport({ scale: 4.2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not prepare schedule crop canvas.');

      await page.render({ canvasContext: ctx, viewport }).promise;

      const sourceX = Math.max(0, Math.round((bbox.x / 100) * canvas.width));
      const sourceY = Math.max(0, Math.round((bbox.y / 100) * canvas.height));
      const sourceWidth = Math.max(32, Math.round((bbox.width / 100) * canvas.width));
      const sourceHeight = Math.max(32, Math.round((bbox.height / 100) * canvas.height));
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = sourceWidth;
      cropCanvas.height = sourceHeight;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) throw new Error('Could not prepare cropped schedule image.');
      cropCtx.drawImage(
        canvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );

      const imageBase64 = cropCanvas
        .toDataURL('image/jpeg', 0.96)
        .replace(/^data:image\/jpeg;base64,/, '');

      const response = await fetch('/api/takeoff/analyze-page-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          page_type: 'opening_schedule',
          page_text: pageText,
        }),
      });

      if (!response.ok) throw new Error('Schedule crop parsing failed.');
      const payload = await response.json();
      const openingDetailData = openingReferenceToDetailData(
        (payload?.data ?? null) as OpeningReferenceResponse | null,
      );
      const nextResults = classifications.map((pageResult) => {
        if (pageResult.page_index !== pageIndex) return pageResult;
        return mergeFragmentedDetailData(pageResult, openingDetailData);
      });

      setClassifications(nextResults);
      setClassificationDone(true);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'complete',
          message: 'Schedule crop parsed',
          progress: 100,
          renderedPages: pdf.numPages,
          totalPages: pdf.numPages,
          detailPagesCompleted: 1,
          detailPagesTotal: 1,
        }),
      );

      try {
        localStorage.setItem(`takeoff_classify_v8_${documentId}_${pdf.numPages}`, JSON.stringify(nextResults));
      } catch {}
    } catch (err) {
      console.error('[TakeoffPage] Schedule crop parsing failed:', err);
      const publicError = getPublicAnalysisError(err);
      setClassificationError(publicError);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'failed',
          message: publicError,
          progress: 0,
        }),
      );
    } finally {
      setIsClassifying(false);
    }
  }, [classifications, documentId, isClassifying, pdfUrl, totalPages]);

  const handleAnalyzeScheduleCrops = useCallback(async (
    crops: Array<{ pageIndex: number; bbox: { x: number; y: number; width: number; height: number } }>,
  ) => {
    if (!pdfUrl || !documentId || isClassifying || classifications.length === 0 || crops.length === 0) return;

    setIsClassifying(true);
    setClassificationError(null);
    setAnalysisProgress(
      makeAnalysisProgress({
        stage: 'extracting_details',
        message: `Parsing schedule crops (0/${crops.length})`,
        progress: 82,
        renderedPages: totalPages,
        totalPages,
        detailPagesCompleted: 0,
        detailPagesTotal: crops.length,
      }),
    );

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const loadingTask = pdfjs.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      let nextResults = classifications;

      for (let index = 0; index < crops.length; index += 1) {
        const crop = crops[index];
        const page = await pdf.getPage(crop.pageIndex + 1);
        const pageText = await extractPdfPageText(page);
        const viewport = page.getViewport({ scale: 4.2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not prepare schedule crop canvas.');
        await page.render({ canvasContext: ctx, viewport }).promise;

        const sourceX = Math.max(0, Math.round((crop.bbox.x / 100) * canvas.width));
        const sourceY = Math.max(0, Math.round((crop.bbox.y / 100) * canvas.height));
        const sourceWidth = Math.max(32, Math.round((crop.bbox.width / 100) * canvas.width));
        const sourceHeight = Math.max(32, Math.round((crop.bbox.height / 100) * canvas.height));
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sourceWidth;
        cropCanvas.height = sourceHeight;
        const cropCtx = cropCanvas.getContext('2d');
        if (!cropCtx) throw new Error('Could not prepare cropped schedule image.');
        cropCtx.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

        const imageBase64 = cropCanvas
          .toDataURL('image/jpeg', 0.96)
          .replace(/^data:image\/jpeg;base64,/, '');

        const response = await fetch('/api/takeoff/analyze-page-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: imageBase64,
            page_type: 'opening_schedule',
            page_text: pageText,
          }),
        });

        if (!response.ok) throw new Error('Schedule crop parsing failed.');
        const payload = await response.json();
        const openingDetailData = openingReferenceToDetailData(
          (payload?.data ?? null) as OpeningReferenceResponse | null,
        );

        nextResults = nextResults.map((pageResult) => {
          if (pageResult.page_index !== crop.pageIndex) return pageResult;
          return mergeFragmentedDetailData(pageResult, openingDetailData);
        });
        setClassifications(nextResults);

        setAnalysisProgress(
          makeAnalysisProgress({
            stage: 'extracting_details',
            message: `Parsing schedule crops (${index + 1}/${crops.length})`,
            progress: 82 + Math.round(((index + 1) / crops.length) * 16),
            renderedPages: pdf.numPages,
            totalPages: pdf.numPages,
            detailPagesCompleted: index + 1,
            detailPagesTotal: crops.length,
          }),
        );
      }

      setClassifications(nextResults);
      setClassificationDone(true);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'complete',
          message: 'Schedule crops parsed',
          progress: 100,
          renderedPages: pdf.numPages,
          totalPages: pdf.numPages,
          detailPagesCompleted: crops.length,
          detailPagesTotal: crops.length,
        }),
      );

      try {
        localStorage.setItem(`takeoff_classify_v8_${documentId}_${pdf.numPages}`, JSON.stringify(nextResults));
      } catch {}
    } catch (err) {
      console.error('[TakeoffPage] Schedule crop parsing failed:', err);
      const publicError = getPublicAnalysisError(err);
      setClassificationError(publicError);
      setAnalysisProgress(
        makeAnalysisProgress({
          stage: 'failed',
          message: publicError,
          progress: 0,
        }),
      );
    } finally {
      setIsClassifying(false);
    }
  }, [classifications, documentId, isClassifying, pdfUrl, totalPages]);

  useEffect(() => {
    if (isLoading || !pdfUrl || !documentId) return;

    const currentSession = useTakeoffStore.getState().session;
    if (
      currentSession?.documentId === documentId &&
      currentSession.pageAnalysis?.length
    ) {
      return;
    }

    void classifyPages(pdfUrl);
  }, [classifyPages, documentId, isLoading, pdfUrl]);

  // ── Build PageScore array from classifications ─────────────────────────────
  const pageScores = buildPageScores(totalPages, classifications);

  useEffect(() => {
    if (!session || totalPages === 0 || classifications.length === 0) return;

    const currentStorePageScores = useTakeoffStore.getState().pageScores;
    const sourcePageScores = currentStorePageScores.length > 0 ? currentStorePageScores : pageScores;

    const generatedPageAnalysis = buildPageAnalysisFromPageScores({
      totalPages,
      pageScores: sourcePageScores,
    });
    const nextPageAnalysis = mergePageAnalysisTitles(session.pageAnalysis ?? [], generatedPageAnalysis);

    const currentSession = useTakeoffStore.getState().session;
    if (!currentSession || currentSession.id !== session.id) return;

    const nextViews = syncPrimaryViewTitles(currentSession.views, nextPageAnalysis);
    const pageAnalysisChanged =
      JSON.stringify(currentSession.pageAnalysis ?? []) !== JSON.stringify(nextPageAnalysis);
    const viewsChanged =
      JSON.stringify(currentSession.views ?? []) !== JSON.stringify(nextViews ?? []);

    if (!pageAnalysisChanged && !viewsChanged) return;

    useTakeoffStore.setState({
      session: ensureTakeoffSessionWorkspace({
        ...currentSession,
        pageAnalysis: nextPageAnalysis,
        views: nextViews,
        updatedAt: new Date().toISOString(),
      }),
    });
  }, [classifications, pageScores, session, totalPages]);

  // ── Page selection confirmed ───────────────────────────────────────────────
  const handleConfirmPageSelection = useCallback(async (confirmedPageScores?: PageScore[]) => {
    if (confirmedPageScores) {
      setPageScoresStore(confirmedPageScores);
    }

    const currentPageScores = confirmedPageScores ?? useTakeoffStore.getState().pageScores;
    const currentSelectedPages = currentPageScores
      .filter((page) => page.roles.length > 0)
      .map((page) => page.page_index);
    if (!projectId || !documentId || currentSelectedPages.length === 0) return;

    let sessionId = uuid();
    const pageAnalysis = buildPageAnalysisFromPageScores({
      totalPages,
      pageScores: currentPageScores,
    });
    const aiSuggestions = buildInitialAiSuggestionsFromPageAnalysis(pageAnalysis);
    const openingScheduleCatalogs = buildOpeningCatalogsFromScheduleItems(
      collectOpeningScheduleItemsFromPageScores(currentPageScores),
    );

    if (session && session.documentId === documentId && session.projectId === projectId) {
      const updatedSession = ensureTakeoffSessionWorkspace({
        ...session,
        selectedPages: currentSelectedPages,
        pageAnalysis,
        aiSuggestions,
        windowCatalog:
          openingScheduleCatalogs.windowCatalog.length > 0
            ? mergeWindowCatalogs(session.windowCatalog, openingScheduleCatalogs.windowCatalog)
            : session.windowCatalog,
        doorCatalog:
          openingScheduleCatalogs.doorCatalog.length > 0
            ? mergeDoorCatalogs(session.doorCatalog, openingScheduleCatalogs.doorCatalog)
            : session.doorCatalog,
        updatedAt: new Date().toISOString(),
      });

      setSession(updatedSession);
      confirmPageSelection();
      return;
    }

    // Create DB session (best effort)
    try {
      const seededSession = ensureTakeoffSessionWorkspace({
        id: sessionId,
        projectId,
        documentId,
        status: 'calibrating',
        measurementBasis: 'exterior_face',
        selectedPages: currentSelectedPages,
        calibrations: {},
        traces: [],
        classifications: [],
        windowCatalog: openingScheduleCatalogs.windowCatalog,
        doorCatalog: openingScheduleCatalogs.doorCatalog,
        pageAnalysis,
        aiSuggestions,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const response = await fetch('/api/takeoff/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          document_id: documentId,
          ...takeoffSessionToApiPayload(seededSession),
        }),
      });

      if (response.ok) {
        const sessionData = await response.json();
        sessionId = sessionData.id ?? sessionId;
        registerPersistedSessionRevision(
          sessionId,
          typeof sessionData.updated_at === 'string' ? sessionData.updated_at : null,
        );
      }
    } catch (err) {
      console.warn('[TakeoffPage] DB insert failed, using local session:', err);
    }

    // Create local session with new types
    const newSession: TakeoffSession = ensureTakeoffSessionWorkspace({
      id: sessionId,
      projectId,
      documentId,
      status: 'calibrating',
      measurementBasis: 'exterior_face',
      selectedPages: currentSelectedPages,
      calibrations: {},
      traces: [],
      classifications: [],
      windowCatalog: openingScheduleCatalogs.windowCatalog,
      doorCatalog: openingScheduleCatalogs.doorCatalog,
      pageAnalysis,
      aiSuggestions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    setSession(newSession);
    confirmPageSelection();
  }, [confirmPageSelection, documentId, projectId, session, setPageScoresStore, setSession, totalPages]);

  // ── Step label ─────────────────────────────────────────────────────────────
  const stepLabels: Record<string, string> = {
    'analysis': 'Step 1: Vision Analysis',
    'page-selection': 'Step 1: Vision Analysis',
    'zones': 'Step 2: Areas',
    'workspace': 'Step 3: Takeoff',
    'summary': 'Step 4: Review & Quote',
  };

  const flowStep = currentStep === 'page-selection' ? 'analysis' : currentStep;
  const flowSteps: Array<{
    key: 'analysis' | 'zones' | 'workspace' | 'summary';
    shortLabel: string;
    enabled: boolean;
  }> = [
    { key: 'analysis', shortLabel: 'Vision', enabled: true },
    { key: 'zones', shortLabel: 'Areas', enabled: Boolean(session) },
    { key: 'workspace', shortLabel: 'Takeoff', enabled: Boolean(session) },
    { key: 'summary', shortLabel: 'Review', enabled: Boolean(session) },
  ];

  const activeFlowIndex = flowSteps.findIndex((step) => step.key === flowStep);

  const goToStep = useCallback((step: 'analysis' | 'zones' | 'workspace' | 'summary') => {
    if (step !== 'analysis' && !session) return;
    setStep(step);
  }, [session, setStep]);

  const persistSession = useCallback(async (mode: 'manual' | 'auto' = 'manual') => {
    const currentSession = useTakeoffStore.getState().session;
    if (!currentSession) return;

    setIsSaving(true);
    const ok = await saveSession(currentSession);
    setIsSaving(false);

    if (ok && mode === 'manual') {
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2000);
    }
  }, []);

  const handleSave = useCallback(async () => {
    await persistSession('manual');
  }, [persistSession]);

  const handleHeaderBack = useCallback(() => {
    if (flowStep === 'summary') {
      setStep('workspace');
      return;
    }

    if (flowStep === 'workspace') {
      setStep('zones');
      return;
    }

    if (flowStep === 'zones') {
      setStep('analysis');
      return;
    }

    router.push(getProjectWorkspaceHref(projectRouteRef));
  }, [flowStep, projectRouteRef, router, setStep]);

  const handleHeaderNext = useCallback(() => {
    if (flowStep === 'analysis') {
      if (session && classificationDone && !classificationError && !isClassifying) {
        setStep('zones');
      }
      return;
    }

    if (flowStep === 'zones') {
      setStep('workspace');
      return;
    }

    if (flowStep === 'workspace') {
      setStep('summary');
    }
  }, [classificationDone, classificationError, flowStep, isClassifying, session, setStep]);

  const handleSummaryHeaderContinue = useCallback(async () => {
    if (isSummaryContinuing) return;

    setIsSummaryContinuing(true);
    try {
      await summaryRef.current?.continueToQuote();
    } finally {
      setIsSummaryContinuing(false);
    }
  }, [isSummaryContinuing]);

  useEffect(() => {
    if ((flowStep !== 'zones' && flowStep !== 'workspace') || !session) return;

    const currentVersion = `${session.id}:${session.updatedAt}`;
    const lastVersion = lastSessionVersionRef.current;

    if (!lastVersion || !lastVersion.startsWith(`${session.id}:`)) {
      lastSessionVersionRef.current = currentVersion;
      return;
    }

    if (lastVersion === currentVersion) return;
    lastSessionVersionRef.current = currentVersion;

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      void persistSession('auto');
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [flowStep, persistSession, session]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="takeoff-shell takeoff-light-theme flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--takeoff-line)]/40 border-t-[var(--takeoff-paper-strong)]" />
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="takeoff-shell takeoff-light-theme flex h-full items-center justify-center">
        <p className="text-sm text-[var(--takeoff-text-muted)]">No document found for this project.</p>
      </div>
    );
  }

    return (
      <div className="takeoff-shell takeoff-light-theme flex h-full flex-col">
      {/* Header */}
      <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.84)] px-5 py-3 text-[var(--takeoff-text)] backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={handleHeaderBack}
            className="flex items-center gap-1.5 rounded-[12px] border border-transparent px-3 py-1.5 text-[12px] font-medium text-[var(--takeoff-text-muted)] transition-colors hover:border-[var(--takeoff-line)] hover:bg-[rgba(255,255,255,0.7)] hover:text-[var(--takeoff-text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <div className="h-3.5 w-px bg-[var(--takeoff-line)]" />
          <h1 className="truncate text-[13px] font-semibold text-[var(--takeoff-text)]">
            Insulation Takeoff
          </h1>
        </div>

        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
          <div className="pointer-events-auto flex items-center" data-tour="takeoff-flow">
            {flowSteps.map((step, index) => {
              const active = step.key === flowStep;
              const completed = index < activeFlowIndex;
              const enabled = step.enabled;

              return (
                <div key={step.key} className="flex items-center">
                  <button
                    onClick={() => goToStep(step.key)}
                    disabled={!enabled}
                    data-tour={`takeoff-step-${step.key}`}
                    className={`flex items-center gap-2 rounded-[12px] border py-1 pl-1 pr-3 transition-[border-color,background-color,color,box-shadow] ${
                      active
                        ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white shadow-[0_8px_24px_rgba(31,39,33,0.14)]'
                        : completed
                          ? 'border-[var(--takeoff-line-strong)] bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                          : enabled
                            ? 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] hover:border-[var(--takeoff-line-strong)] hover:text-[var(--takeoff-ink)]'
                            : 'cursor-not-allowed border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-subtle)]'
                    }`}
                  >
                    <span
                      className={`takeoff-mono flex h-5 w-5 items-center justify-center rounded-[8px] border text-[9px] font-semibold ${
                        active
                          ? 'border-white/30 bg-white/10 text-white'
                          : completed
                            ? 'border-[var(--takeoff-line-strong)] bg-white text-[var(--takeoff-ink)]'
                            : enabled
                              ? 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-muted)]'
                              : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-subtle)]'
                      }`}
                    >
                      {completed ? <Check className="h-3 w-3" /> : index + 1}
                    </span>
                    <span className="takeoff-mono text-[10px] font-medium">
                      {step.shortLabel}
                    </span>
                  </button>
                  {index < flowSteps.length - 1 && (
                    <div
                      className={`mx-2 h-px w-5 ${
                        completed ? 'bg-[var(--takeoff-line-strong)]' : 'bg-[var(--takeoff-line)]'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setGuideReplaySignal((value) => value + 1)}
            className="takeoff-mono flex h-7 items-center gap-1 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-2.5 text-[8px] font-semibold text-[var(--takeoff-ink)] transition-colors hover:border-[var(--takeoff-line-strong)] hover:bg-[var(--takeoff-paper)]"
          >
            <HelpCircle className="h-2.5 w-2.5" />
            Guide
          </button>

          {flowStep === 'workspace' && session && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="takeoff-mono flex h-7 items-center gap-1 rounded-[12px] border border-[#2563eb] bg-[#2563eb] px-2.5 text-[8px] font-semibold text-white shadow-[0_8px_22px_rgba(37,99,235,0.18)] transition-[background-color,border-color,box-shadow] hover:border-[#1d4ed8] hover:bg-[#1d4ed8] hover:shadow-[0_10px_26px_rgba(29,78,216,0.22)] disabled:cursor-wait disabled:opacity-70"
            >
              {saveSuccess ? (
                <Check className="h-2.5 w-2.5" />
              ) : (
                <Save className="h-2.5 w-2.5" />
              )}
              {isSaving ? 'Saving…' : saveSuccess ? 'Saved' : 'Save Session'}
            </button>
          )}

          {flowStep === 'summary' ? (
            <button
              onClick={handleSummaryHeaderContinue}
              disabled={!session || isSummaryContinuing}
              className="takeoff-mono inline-flex h-8 items-center gap-1.5 rounded-[12px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3.5 text-[10px] font-semibold text-white shadow-[0_8px_24px_rgba(31,39,33,0.18)] transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-[1px] hover:bg-[#202621] hover:shadow-[0_10px_28px_rgba(31,39,33,0.22)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] disabled:shadow-none disabled:hover:translate-y-0"
            >
              {isSummaryContinuing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {isSummaryContinuing ? 'Saving...' : 'Continue'}
              {!isSummaryContinuing ? <ArrowRight className="h-3.5 w-3.5" /> : null}
            </button>
          ) : (
            <button
              onClick={handleHeaderNext}
              disabled={
                flowStep === 'analysis' &&
                (!session || isClassifying || !classificationDone || Boolean(classificationError))
              }
              className="takeoff-mono inline-flex h-8 items-center gap-1.5 rounded-[12px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3.5 text-[10px] font-semibold text-white shadow-[0_8px_24px_rgba(31,39,33,0.18)] transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-[1px] hover:bg-[#202621] hover:shadow-[0_10px_28px_rgba(31,39,33,0.22)] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)] disabled:shadow-none disabled:hover:translate-y-0"
            >
              Next step
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}

          {isClassifying && (
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-[var(--takeoff-warning)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI analyzing pages...
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {(currentStep === 'analysis' || currentStep === 'page-selection') && (
          <div className="h-full" data-tour="takeoff-content-analysis">
            <TakeoffAnalysisScreen
              key={visionScanRunId}
              pdfUrl={pdfUrl}
              totalPages={totalPages}
              pageScores={pageScores}
              isClassifying={isClassifying}
              classificationDone={classificationDone}
              classificationError={classificationError}
              analysisProgress={analysisProgress}
              onRetryScan={handleRetryVisionScan}
              onRetryScheduleScan={handleRetryScheduleScan}
              onAnalyzeScheduleCrop={handleAnalyzeScheduleCrop}
              onAnalyzeScheduleCrops={handleAnalyzeScheduleCrops}
              onContinue={handleConfirmPageSelection}
            />
          </div>
        )}

        {currentStep === 'zones' && session && (
          <div className="h-full" data-tour="takeoff-content-zones">
            <ZoneToolbarWorkspace pdfUrl={pdfUrl} />
          </div>
        )}

        {currentStep === 'workspace' && session && (
          <div className="h-full" data-tour="takeoff-content-workspace">
            <ToolbarConceptWorkspace pdfUrl={pdfUrl} />
          </div>
        )}

        {currentStep === 'summary' && session && (
          <div className="h-full" data-tour="takeoff-content-summary">
            <TakeoffSummary
              ref={summaryRef}
              session={session}
              onContinue={() => router.push(getQuoteHref(projectRouteRef, 'takeoff'))}
            />
          </div>
        )}
      </div>
      <TakeoffGuideTour
        currentStep={currentStep}
        sessionReady={Boolean(session)}
        replaySignal={guideReplaySignal}
        onGoToStep={goToStep}
      />
    </div>
  );
}
