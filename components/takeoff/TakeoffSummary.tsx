'use client';

import { ArrowRight, ChevronLeft, CirclePlus, Trash2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatFeetInches,
  type AssemblyScope,
  type Calibration,
  type OpeningType,
  type PdfPoint,
  type TakeoffSession,
} from '@/lib/types/takeoff';
import type { OpeningItemRecord, WorkspaceSummaryArea } from '@/lib/types/takeoff-v2';
import {
  buildAnticipatedZonesFromPageAnalysis,
  getPreferredWorkspaceSummary,
} from '@/lib/takeoff/workspace-v2';
import { computeSlopedAreaSf, formatRoofPitch } from '@/lib/takeoff/roof-pitch';
import {
  normalizeQuantity,
  sanitizeEstimateRows,
  type EstimateGroup,
  type EstimateUnit,
  type EstimateWorksheetRow,
} from '@/lib/quotes/estimate';

interface TakeoffSummaryProps {
  session: TakeoffSession;
  onBack: () => void;
  onContinue: () => void | Promise<void>;
}

type EstimateRow = EstimateWorksheetRow;

interface EstimateDeductionRow {
  id: string;
  parentId: string;
  label: string;
  quantity: number;
  areaSf: number;
}

type VisionZoneKey = 'exterior' | 'interior' | 'attic' | 'crawlspace';

const GROUP_ORDER: EstimateGroup[] = ['Walls', 'Floors', 'Ceilings', 'Specialty', 'Services', 'Custom'];

const GROUP_CODES: Record<EstimateGroup, string> = {
  Walls: '01',
  Floors: '02',
  Ceilings: '03',
  Specialty: '04',
  Services: '05',
  Custom: '06',
};

const STORAGE_PREFIX = 'takeoff-estimate-review:';

const SUMMARY_AREA_GROUPS: Partial<Record<WorkspaceSummaryArea['id'], EstimateGroup>> = {
  exterior_walls: 'Walls',
  garage_walls: 'Walls',
  basement_walls: 'Walls',
  knee_walls: 'Walls',
  crawlspace_floor: 'Floors',
  sound_floor: 'Floors',
  cantilever_floor: 'Floors',
  attic_ceiling: 'Ceilings',
  garage_ceiling: 'Ceilings',
  cathedral_ceiling: 'Ceilings',
  rim_joist: 'Specialty',
};

const OPENING_TYPE_LABELS: Record<OpeningType, string> = {
  door: 'Door',
  window: 'Window',
  garage_door: 'Garage Door',
  sliding_door: 'Sliding Door',
  french_door: 'French Door',
  door_opening: 'Door Opening',
};

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0';
}

function formatZoneSpec(
  insulationType?: string | null,
  rValue?: string | null,
  floorLabel?: string | null,
): string {
  const parts = [floorLabel?.trim(), insulationType?.trim(), rValue?.trim()].filter(
    (value, index, items) => Boolean(value) && items.indexOf(value) === index,
  );
  return parts.join(' · ');
}

function uniqueList(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, items) => items.indexOf(value) === index);
}

function estimateRowVisionScope(row: EstimateRow): VisionZoneKey | null {
  const normalizedLabel = row.label.toLowerCase();
  const normalizedId = row.id.toLowerCase();

  if (normalizedLabel.includes('crawlspace') || normalizedId.includes('crawlspace')) return 'crawlspace';
  if (normalizedLabel.includes('attic') || normalizedId.includes('attic')) return 'attic';
  if (row.group === 'Walls') return 'exterior';
  if (row.group === 'Floors') return 'crawlspace';
  if (row.group === 'Ceilings') return 'attic';
  return null;
}

function visionScopeForSummaryAreaId(id: WorkspaceSummaryArea['id']): VisionZoneKey | null {
  switch (id) {
    case 'exterior_walls':
    case 'garage_walls':
    case 'basement_walls':
    case 'knee_walls':
      return 'exterior';
    case 'attic_ceiling':
    case 'garage_ceiling':
    case 'cathedral_ceiling':
      return 'attic';
    case 'crawlspace_floor':
    case 'sound_floor':
    case 'cantilever_floor':
    case 'rim_joist':
      return 'crawlspace';
    default:
      return null;
  }
}

function firstSpecForScope(
  optionsByScope: Map<VisionZoneKey, string[]>,
  scope: VisionZoneKey | null,
): string {
  return scope ? optionsByScope.get(scope)?.[0] ?? '' : '';
}

function buildVisionSpecOptions(session: TakeoffSession): Map<VisionZoneKey, string[]> {
  const signals = buildAnticipatedZonesFromPageAnalysis(session.pageAnalysis ?? []);
  const optionsByScope = new Map<VisionZoneKey, string[]>();

  for (const signal of signals) {
    const options = uniqueList([
      ...signal.rValueDetails,
      ...signal.insulationTypes,
      ...signal.rValues,
      ...signal.wallFraming.map((value) => `${value} framing`),
      signal.insulationTypes[0] && signal.rValues[0]
        ? `${signal.insulationTypes[0]} · ${signal.rValues[0]}`
        : null,
      signal.wallFraming[0] && signal.rValues[0]
        ? `${signal.wallFraming[0]} framing · ${signal.rValues[0]}`
        : null,
      signal.wallFraming[0] && signal.insulationTypes[0] && signal.rValues[0]
        ? `${signal.wallFraming[0]} framing · ${signal.insulationTypes[0]} · ${signal.rValues[0]}`
        : null,
    ]);

    if (options.length > 0) {
      optionsByScope.set(signal.key, options);
    }
  }

  return optionsByScope;
}

function sameRow(a: EstimateRow, b: EstimateRow): boolean {
  return (
    a.group === b.group &&
    a.label === b.label &&
    a.quantity === b.quantity &&
    a.unit === b.unit &&
    a.spec === b.spec &&
    a.note === b.note &&
    a.source === b.source &&
    a.enabled === b.enabled
  );
}

function zonePolygonAreaSf(points: PdfPoint[], calibration: Calibration | undefined): number {
  if (!calibration || points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    sum += points[index].x * points[nextIndex].y - points[nextIndex].x * points[index].y;
  }
  const pdfArea = Math.abs(sum) / 2;
  return pdfArea / (calibration.pdfPointsPerFoot ** 2);
}

function summaryRowIdForWallScope(scope: AssemblyScope | undefined): string | null {
  switch (scope) {
    case 'exterior_wall_2x6':
    case 'exterior_wall_2x4':
      return 'summary:exterior_walls';
    case 'garage_wall':
      return 'summary:garage_walls';
    case 'basement_wall':
      return 'summary:basement_walls';
    case 'knee_wall':
      return 'summary:knee_walls';
    case 'rim_joist':
      return 'summary:rim_joist';
    default:
      return null;
  }
}

function formatOpeningDeductionLabel(
  opening: Pick<OpeningItemRecord, 'type' | 'widthFt' | 'heightFt' | 'label'>,
): string {
  const typeLabel = OPENING_TYPE_LABELS[opening.type];
  const explicitLabel = opening.label?.trim();

  if (explicitLabel) {
    const normalized = explicitLabel.toLowerCase();
    if (normalized.includes('window') || normalized.includes('door')) return explicitLabel;
    return `${typeLabel} ${explicitLabel}`;
  }

  if ((opening.widthFt ?? 0) > 0 && (opening.heightFt ?? 0) > 0) {
    return `${typeLabel} ${formatFeetInches(opening.widthFt ?? 0)} x ${formatFeetInches(opening.heightFt ?? 0)}`;
  }

  return typeLabel;
}

function buildOpeningDeductionMap(session: TakeoffSession): Map<string, EstimateDeductionRow[]> {
  const groupedByParent = new Map<string, Map<string, EstimateDeductionRow>>();
  const openingItems = session.openingItems ?? [];
  const wallRuns = session.wallRuns ?? [];
  if (!openingItems.length || !wallRuns.length) return new Map();

  const openingById = new Map(openingItems.map((item) => [item.id, item]));
  const openingsByWallRunId = new Map<string, OpeningItemRecord[]>();

  for (const item of openingItems) {
    if (!item.wallRunId) continue;
    const existing = openingsByWallRunId.get(item.wallRunId) ?? [];
    existing.push(item);
    openingsByWallRunId.set(item.wallRunId, existing);
  }

  for (const wallRun of wallRuns) {
    const parentId = summaryRowIdForWallScope(wallRun.assemblyScope);
    if (!parentId) continue;

    const resolvedOpenings =
      wallRun.openingIds.length > 0
        ? wallRun.openingIds
            .map((openingId) => openingById.get(openingId))
            .filter((opening): opening is OpeningItemRecord => Boolean(opening))
        : openingsByWallRunId.get(wallRun.id) ?? [];

    if (!resolvedOpenings.length) continue;

    const parentRows = groupedByParent.get(parentId) ?? new Map<string, EstimateDeductionRow>();

    for (const opening of resolvedOpenings) {
      const openingCount = Math.max(1, opening.quantity || 1);
      const areaSf = Math.max(0, (opening.widthFt ?? 0) * (opening.heightFt ?? 0) * openingCount);
      const label = formatOpeningDeductionLabel(opening);
      const groupKey = `${opening.type}:${opening.widthFt ?? ''}:${opening.heightFt ?? ''}:${label}`;

      const existing = parentRows.get(groupKey);
      if (existing) {
        existing.quantity += openingCount;
        existing.areaSf += areaSf;
        continue;
      }

      parentRows.set(groupKey, {
        id: `${parentId}:${groupKey}`,
        parentId,
        label,
        quantity: openingCount,
        areaSf,
      });
    }

    groupedByParent.set(parentId, parentRows);
  }

  return new Map(
    Array.from(groupedByParent.entries()).map(([parentId, rows]) => [
      parentId,
      Array.from(rows.values()).sort((left, right) => left.label.localeCompare(right.label)),
    ]),
  );
}

function buildDerivedEstimateRows(session: TakeoffSession): EstimateRow[] {
  const workspaceSummary = getPreferredWorkspaceSummary(session);
  const visionSpecOptions = buildVisionSpecOptions(session);
  const rows: EstimateRow[] = [];

  for (const area of workspaceSummary?.areas ?? []) {
    const group = SUMMARY_AREA_GROUPS[area.id];
    if (!group) continue;
    const quantity = normalizeQuantity(area.id === 'rim_joist' && area.lf ? area.lf : area.sqft);
    const unit: EstimateUnit = area.id === 'rim_joist' && area.lf ? 'LF' : 'SF';
    if (!(quantity > 0)) continue;

    rows.push({
      id: `summary:${area.id}`,
      group,
      label: area.label,
      quantity,
      unit,
      spec: firstSpecForScope(visionSpecOptions, visionScopeForSummaryAreaId(area.id)),
      note: area.description,
      source: 'takeoff',
      enabled: true,
    });
  }

  const hasSummaryRow = new Set(rows.map((row) => row.id));
  const zones = session.zones ?? [];

  for (const zone of zones) {
    if (zone.status !== 'confirmed') continue;

    const isCrawl = zone.zoneType === 'unconditioned_crawl';
    const isAttic = zone.zoneType === 'unconditioned_attic';
    if (!isCrawl && !isAttic) continue;

    const summaryId = isCrawl ? 'summary:crawlspace_floor' : 'summary:attic_ceiling';
    if (hasSummaryRow.has(summaryId)) continue;

    const calibration = session.calibrations[zone.pageIndex];
    const planAreaSf = zonePolygonAreaSf(zone.polygon, calibration);
    if (!(planAreaSf > 0)) continue;

    const isVaultedAttic = isAttic && zone.ceilingType === 'vaulted';
    const hasRoofPitch =
      typeof zone.roofPitchRise === 'number' &&
      Number.isFinite(zone.roofPitchRise) &&
      zone.roofPitchRise > 0 &&
      typeof zone.roofPitchRun === 'number' &&
      Number.isFinite(zone.roofPitchRun) &&
      zone.roofPitchRun > 0;
    if (isVaultedAttic && !hasRoofPitch) continue;

    const areaSf = isVaultedAttic
      ? computeSlopedAreaSf(planAreaSf, zone.roofPitchRise, zone.roofPitchRun)
      : planAreaSf;
    const pitchNote = isVaultedAttic && hasRoofPitch
      ? ` · ${formatRoofPitch(zone.roofPitchRise ?? 0, zone.roofPitchRun ?? 0)} pitch`
      : '';

    rows.push({
      id: `zone:${zone.id}`,
      group: isCrawl ? 'Floors' : 'Ceilings',
      label: zone.label,
      quantity: normalizeQuantity(areaSf),
      unit: 'SF',
      spec:
        formatZoneSpec(zone.insulationType, zone.rValue, zone.floorLabel) ||
        firstSpecForScope(visionSpecOptions, isCrawl ? 'crawlspace' : 'attic'),
      note: `${isCrawl ? 'Floor area' : isVaultedAttic ? 'Vaulted area' : 'Zone area'} traced on page ${zone.pageIndex + 1}${pitchNote}`,
      source: 'takeoff',
      enabled: true,
    });
  }

  return rows.sort((left, right) => {
    const groupDelta = GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group);
    if (groupDelta !== 0) return groupDelta;
    return left.label.localeCompare(right.label);
  });
}

function mergeRows(derivedRows: EstimateRow[], persistedRows: EstimateRow[]): EstimateRow[] {
  const derivedById = new Map(derivedRows.map((row) => [row.id, row]));
  const manualRows = persistedRows.filter((row) => row.source === 'manual');
  const mergedDerived = derivedRows.map((row) => {
    const persisted = persistedRows.find((item) => item.id === row.id && item.source === 'takeoff');
    return persisted
      ? {
          ...row,
          label: persisted.label?.trim() ? persisted.label : row.label,
          spec: persisted.spec?.trim() ? persisted.spec : row.spec,
          enabled: persisted.enabled,
        }
      : row;
  });

  return [...mergedDerived, ...manualRows].sort((left, right) => {
    const groupDelta = GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group);
    if (groupDelta !== 0) return groupDelta;
    return left.label.localeCompare(right.label);
  });
}

function GroupCard({
  group,
  rows,
  deductionsByParentId,
  visionSpecOptions,
  onUpdate,
  onAdd,
  onRemove,
  isFirst,
}: {
  group: EstimateGroup;
  rows: EstimateRow[];
  deductionsByParentId: Map<string, EstimateDeductionRow[]>;
  visionSpecOptions: Map<VisionZoneKey, string[]>;
  onUpdate: (id: string, patch: Partial<EstimateRow>) => void;
  onAdd: (group: EstimateGroup) => void;
  onRemove: (id: string) => void;
  isFirst: boolean;
}) {
  const sectionSubtotal = rows
    .filter((row) => row.enabled && row.unit === 'SF')
    .reduce((sum, row) => sum + row.quantity, 0);

  return (
    <section className={`${isFirst ? '' : 'border-t border-[var(--takeoff-line)]'} bg-white`}>
      <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <div className="takeoff-mono translate-y-px text-[12px] font-semibold uppercase leading-none tracking-[0.22em] text-[var(--takeoff-ink)]">
            {GROUP_CODES[group]} - {group}
          </div>
          <button
            onClick={() => onAdd(group)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)] transition-colors hover:bg-[var(--takeoff-paper)]"
            aria-label={`Add ${group} item`}
            title={`Add ${group} item`}
          >
            <CirclePlus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="translate-y-px text-sm font-semibold leading-none text-[var(--takeoff-text-muted)]">
          {sectionSubtotal > 0
            ? `${formatNumber(sectionSubtotal)} SF`
            : `${rows.length} item${rows.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-t border-[var(--takeoff-line)] px-4 py-4 text-[13px] text-[var(--takeoff-text-muted)]">
          No {group.toLowerCase()} items yet.
        </div>
      ) : (
        <div>
          {rows.map((row, rowIndex) => {
            const deductions = deductionsByParentId.get(row.id) ?? [];
            const visionScope = estimateRowVisionScope(row);
            const specOptions = visionScope ? visionSpecOptions.get(visionScope) ?? [] : [];
            const specListId = `estimate-spec-options-${row.id}`;
            return (
              <Fragment key={row.id}>
                <div
                  className="grid grid-cols-[44px_minmax(240px,1.4fr)_110px_84px_180px_minmax(240px,1fr)] border-t border-[var(--takeoff-line)] bg-white"
                >
                  <div className="flex items-center justify-center px-3 py-2 text-[12px] text-[var(--takeoff-text-muted)]">
                    {rowIndex + 1}
                  </div>

                  <div className="min-w-0 border-l border-[var(--takeoff-line)] px-3 py-2">
                    <input
                      value={row.label}
                      onChange={(event) => onUpdate(row.id, { label: event.target.value })}
                      className="w-full rounded-[10px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[13px] font-medium text-[var(--takeoff-ink)] focus:border-[var(--takeoff-line-strong)] focus:outline-none"
                    />
                  </div>

                  <label className="min-w-0 border-l border-[var(--takeoff-line)] px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={Number.isFinite(row.quantity) ? row.quantity : 0}
                      onChange={(event) =>
                        onUpdate(row.id, {
                          quantity: normalizeQuantity(
                            Number.parseFloat(event.target.value || '0') || 0,
                          ),
                        })
                      }
                      className="w-full rounded-[10px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-right text-[13px] text-[var(--takeoff-ink)] focus:border-[var(--takeoff-line-strong)] focus:outline-none"
                    />
                  </label>

                  <label className="min-w-0 border-l border-[var(--takeoff-line)] px-3 py-2">
                    <select
                      value={row.unit}
                      onChange={(event) =>
                        onUpdate(row.id, { unit: event.target.value as EstimateUnit })
                      }
                      className="w-full rounded-[10px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[13px] text-[var(--takeoff-ink)] focus:border-[var(--takeoff-line-strong)] focus:outline-none"
                    >
                      <option value="SF">SF</option>
                      <option value="LF">LF</option>
                      <option value="EA">EA</option>
                    </select>
                  </label>

                  <div className="border-l border-[var(--takeoff-line)] px-3 py-2">
                    <input
                      list={specOptions.length > 0 ? specListId : undefined}
                      value={row.spec}
                      onChange={(event) => onUpdate(row.id, { spec: event.target.value })}
                      placeholder={specOptions.length > 0 ? 'Select or type spec' : 'Spec or assembly'}
                      className="w-full rounded-[10px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[13px] text-[var(--takeoff-ink)] focus:border-[var(--takeoff-line-strong)] focus:outline-none"
                    />
                    {specOptions.length > 0 && (
                      <datalist id={specListId}>
                        {specOptions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    )}
                  </div>

                  <div className="flex items-center gap-2 border-l border-[var(--takeoff-line)] px-3 py-2">
                    <input
                      value={row.note}
                      onChange={(event) => onUpdate(row.id, { note: event.target.value })}
                      placeholder="Estimator note"
                      className="min-w-0 flex-1 rounded-[10px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-[12px] text-[var(--takeoff-text-muted)] focus:border-[var(--takeoff-line-strong)] focus:outline-none"
                    />
                    {row.source === 'manual' && (
                      <button
                        onClick={() => onRemove(row.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] transition-colors hover:border-[#ef4444]/30 hover:bg-[#fef2f2] hover:text-[#dc2626]"
                        aria-label={`Remove ${row.label || 'custom item'}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {deductions.map((deduction) => (
                  <div
                    key={deduction.id}
                    className="grid grid-cols-[44px_minmax(240px,1.4fr)_110px_84px_180px_minmax(240px,1fr)] border-t border-dashed border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]/35"
                  >
                    <div className="flex items-center justify-center px-3 py-1.5 text-[11px] text-[var(--takeoff-text-muted)]">
                      -
                    </div>

                    <div className="min-w-0 border-l border-[var(--takeoff-line)] px-3 py-1.5">
                      <div className="truncate text-[12px] text-[var(--takeoff-text-muted)]">
                        Less {deduction.label}
                      </div>
                    </div>

                    <div className="flex items-center justify-end border-l border-[var(--takeoff-line)] px-3 py-1.5 text-[12px] text-[var(--takeoff-text-muted)]">
                      {formatNumber(deduction.areaSf)}
                    </div>

                    <div className="flex items-center border-l border-[var(--takeoff-line)] px-3 py-1.5 text-[12px] text-[var(--takeoff-text-muted)]">
                      SF
                    </div>

                    <div className="flex items-center border-l border-[var(--takeoff-line)] px-3 py-1.5 text-[11px] text-[var(--takeoff-text-subtle)]">
                      Qty {formatNumber(deduction.quantity)}
                    </div>

                    <div className="flex items-center border-l border-[var(--takeoff-line)] px-3 py-1.5 text-[11px] text-[var(--takeoff-text-subtle)]">
                      Qty {formatNumber(deduction.quantity)} · deducted from wall net SF
                    </div>
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TakeoffSummary({
  session,
  onBack,
  onContinue,
}: TakeoffSummaryProps) {
  const storageKey = `${STORAGE_PREFIX}${session.id}`;
  const derivedRows = useMemo(() => buildDerivedEstimateRows(session), [session]);
  const deductionsByParentId = useMemo(() => buildOpeningDeductionMap(session), [session]);
  const visionSpecOptions = useMemo(() => buildVisionSpecOptions(session), [session]);
  const derivedRowById = useMemo(
    () => new Map(derivedRows.map((row) => [row.id, row])),
    [derivedRows],
  );

  const [estimateRows, setEstimateRows] = useState<EstimateRow[]>(derivedRows);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedRowsRef = useRef<string>('');
  const hydratedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const persistedRows = sanitizeEstimateRows(session.estimateRows);
    let nextRows = persistedRows.length > 0 ? mergeRows(derivedRows, persistedRows) : derivedRows;

    if (persistedRows.length === 0 && typeof window !== 'undefined') {
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        const legacyRows = sanitizeEstimateRows(saved ? JSON.parse(saved) : null);
        if (legacyRows.length > 0) {
          nextRows = mergeRows(derivedRows, legacyRows);
        }
      } catch {
        nextRows = derivedRows;
      }
    }

    setEstimateRows(nextRows);
    lastSavedRowsRef.current = JSON.stringify(nextRows);
    hydratedSessionIdRef.current = session.id;
    setSaveStatus('saved');
    setSaveError(null);
  }, [derivedRows, session.estimateRows, session.id, storageKey]);

  const persistEstimateRows = useCallback(
    async (rows: EstimateRow[]) => {
      setSaveStatus('saving');
      setSaveError(null);

      try {
        const response = await fetch(`/api/takeoff/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estimate_rows: rows }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: unknown } | null;
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save worksheet');
        }

        lastSavedRowsRef.current = JSON.stringify(rows);
        setSaveStatus('saved');
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save worksheet';
        setSaveStatus('error');
        setSaveError(message);
        return false;
      }
    },
    [session.id],
  );

  useEffect(() => {
    if (hydratedSessionIdRef.current !== session.id) return;

    const serializedRows = JSON.stringify(estimateRows);
    if (serializedRows === lastSavedRowsRef.current) return;

    setSaveStatus('saving');
    setSaveError(null);

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void persistEstimateRows(estimateRows);
    }, 800);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [estimateRows, persistEstimateRows, session.id]);

  const enabledRows = estimateRows.filter((row) => row.enabled);
  const enabledSf = enabledRows
    .filter((row) => row.unit === 'SF')
    .reduce((sum, row) => sum + row.quantity, 0);
  const enabledLf = enabledRows
    .filter((row) => row.unit === 'LF')
    .reduce((sum, row) => sum + row.quantity, 0);
  const enabledEa = enabledRows
    .filter((row) => row.unit === 'EA')
    .reduce((sum, row) => sum + row.quantity, 0);
  const adjustedRows = estimateRows.filter((row) => {
    const baseline = derivedRowById.get(row.id);
    return baseline ? !sameRow(row, baseline) : row.source === 'manual';
  });

  const groupedRows = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        rows: estimateRows.filter((row) => row.group === group),
      })),
    [estimateRows],
  );

  const updateRow = (id: string, patch: Partial<EstimateRow>) => {
    setEstimateRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const addManualRow = (group: EstimateGroup) => {
    const nextRow: EstimateRow = {
      id: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      group,
      label: '',
      quantity: 0,
      unit: 'SF',
      spec: '',
      note: '',
      source: 'manual',
      enabled: true,
    };
    setEstimateRows((current) => [...current, nextRow]);
  };

  const removeRow = (id: string) => {
    setEstimateRows((current) => current.filter((row) => row.id !== id));
  };

  const handleContinue = async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const ok = await persistEstimateRows(estimateRows);
    if (ok) {
      await onContinue();
    }
  };

  return (
    <div className="takeoff-shell takeoff-light-theme h-full overflow-hidden text-[var(--takeoff-ink)]">
      <div className="mx-auto flex h-full max-w-[1480px] flex-col px-6 py-6">
        <div className="mx-auto flex h-full w-full max-w-[1320px] flex-col overflow-hidden rounded-[20px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] shadow-[0_24px_70px_rgba(31,39,33,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--takeoff-line)] px-6 py-5">
            <div>
              <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                Estimate Verification
              </div>
              <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.04em] text-[var(--takeoff-ink)]">
                Review estimate worksheet
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-1.5 text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
                {formatNumber(enabledSf)} SF
                {enabledLf > 0 ? ` · ${formatNumber(enabledLf)} LF` : ''}
                {enabledEa > 0 ? ` · ${formatNumber(enabledEa)} EA` : ''}
              </div>
              <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
                {estimateRows.length} items
                {adjustedRows.length > 0 ? ` · ${adjustedRows.length} adjusted` : ''}
              </div>
              <div className={`takeoff-mono rounded-full border px-3 py-1.5 text-[10px] font-semibold ${
                saveStatus === 'error'
                  ? 'border-[#ef4444]/30 bg-[#fef2f2] text-[#dc2626]'
                  : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)]'
              }`}>
                {saveStatus === 'saving'
                  ? 'Saving worksheet'
                  : saveStatus === 'error'
                    ? 'Save failed'
                    : 'Worksheet saved'}
              </div>
              <button
                onClick={onBack}
                className="takeoff-mono inline-flex items-center gap-2 rounded-full border border-[var(--takeoff-line)] bg-white px-4 py-2 text-[12px] font-semibold text-[var(--takeoff-ink)] transition-colors hover:bg-[var(--takeoff-paper)]"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                onClick={handleContinue}
                disabled={saveStatus === 'saving'}
                className="takeoff-mono inline-flex items-center gap-2 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#202621]"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {saveError ? (
            <div className="border-b border-[#ef4444]/20 bg-[#fff7f7] px-6 py-2 text-[12px] text-[#b91c1c]">
              {saveError}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="overflow-hidden border border-[var(--takeoff-line)] bg-white">
              <div className="grid grid-cols-[44px_minmax(240px,1.4fr)_110px_84px_180px_minmax(240px,1fr)] border-b border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[10px] uppercase tracking-[0.18em] text-[var(--takeoff-text-subtle)]">
                <div className="px-3 py-3 text-center">#</div>
                <div className="border-l border-[var(--takeoff-line)] px-4 py-3">Description</div>
                <div className="border-l border-[var(--takeoff-line)] px-4 py-3 text-right">Qty</div>
                <div className="border-l border-[var(--takeoff-line)] px-4 py-3">Unit</div>
                <div className="border-l border-[var(--takeoff-line)] px-4 py-3">Spec</div>
                <div className="border-l border-[var(--takeoff-line)] px-4 py-3">Notes</div>
              </div>

              {groupedRows.map(({ group, rows }, index) => (
                <GroupCard
                  key={group}
                  group={group}
                  rows={rows}
                  deductionsByParentId={deductionsByParentId}
                  visionSpecOptions={visionSpecOptions}
                  onUpdate={updateRow}
                  onAdd={addManualRow}
                  onRemove={removeRow}
                  isFirst={index === 0}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
