'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, PencilLine, Trash2 } from 'lucide-react';
import { OpeningsEditor } from '@/components/takeoff/OpeningsEditor';
import { useTakeoffStore, type DerivedSegment } from '@/lib/stores/takeoff-store';
import { buildWallRunSuggestionsForView } from '@/lib/takeoff/zone-classifier';
import {
  type AssemblyScope,
  formatFeetInches,
  traceAreaSf,
  traceTotalLf,
  type Calibration,
  type PdfPoint,
  type Trace,
  type ZoneType,
  ZONE_LABELS,
} from '@/lib/types/takeoff';
import { SURFACE_PRESET_OPTIONS, WALL_PRESET_OPTIONS } from '@/lib/takeoff/presets';
import type {
  Surface as TakeoffSurface,
  WallRun,
  Zone as TakeoffZone,
} from '@/lib/types/takeoff-v2';

const FRAMING_OPTIONS: Array<NonNullable<WallRun['framingType']>> = [
  '2x4',
  '2x6',
  'cmu',
  'icf',
  'other',
];

const THICKNESS_OPTIONS: WallRun['thicknessIn'][] = [4, 6, 8, 10, 12];
const MIXED_WALL_SCOPE_VALUE = '__mixed_wall_scope__';

const ZONE_OPTIONS: ZoneType[] = [
  'conditioned',
  'unconditioned_garage',
  'unconditioned_attic',
  'unconditioned_crawl',
  'unconditioned_storage',
];

interface WallMetrics {
  totalLf: number;
  grossSf: number;
  netSf: number;
  openingSf: number;
  openingCount: number;
  segmentCount: number;
}

interface SurfaceMetrics {
  areaSf: number;
  perimeterLf: number;
}

function polygonAreaSf(points: PdfPoint[], calibration: Calibration): number {
  if (points.length < 3) return 0;
  const trace: Trace = {
    id: 'polygon-metrics',
    pageIndex: 0,
    type: 'area',
    points,
    isClosed: true,
    isLocked: true,
    label: 'Polygon',
  };
  return traceAreaSf(trace, calibration);
}

function polygonPerimeterLf(points: PdfPoint[], calibration: Calibration): number {
  const trace: Trace = {
    id: 'polygon-metrics',
    pageIndex: 0,
    type: 'area',
    points,
    isClosed: true,
    isLocked: true,
    label: 'Polygon',
  };
  return traceTotalLf(trace, calibration);
}

function formatReviewFlag(flag: string): string {
  return flag.replace(/_/g, ' ');
}

function FamilyHeader({
  title,
  count,
  description,
  action,
}: {
  title: string;
  count: number;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
          {title}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--takeoff-text-muted)]">
          {description}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] font-medium text-[var(--takeoff-ink)]">
          {count}
        </div>
        {action}
      </div>
    </div>
  );
}

function scopeLabel(scope: AssemblyScope | undefined): string {
  switch (scope) {
    case 'exterior_wall_2x4':
      return 'Exterior 2x4';
    case 'exterior_wall_2x6':
      return 'Exterior 2x6';
    case 'garage_wall':
      return 'Garage Shared';
    case 'basement_wall':
      return 'Foundation Wall';
    case 'knee_wall':
      return 'Knee Wall';
    default:
      return 'Needs Review';
  }
}

function ObjectActions({
  onContinue,
  onDelete,
}: {
  onContinue: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onContinue}
        className="takeoff-mono inline-flex items-center gap-1 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-ink)] transition-colors hover:border-[#9eb29d] hover:bg-white"
      >
        <PencilLine className="h-3 w-3" />
        Edit geometry
      </button>
      <button
        onClick={onDelete}
        className="takeoff-mono inline-flex items-center gap-1 rounded-full border border-[var(--takeoff-accent)]/30 bg-[rgba(215,25,33,0.08)] px-3 py-1.5 text-[10px] font-medium text-[var(--takeoff-accent)] transition-colors hover:border-[var(--takeoff-accent)]/50"
      >
        <Trash2 className="h-3 w-3" />
        Remove
      </button>
    </div>
  );
}

function ZoneCard({
  zone,
  isEnvelope,
  areaSf,
  perimeterLf,
  isSelected,
  onSelect,
  onContinue,
  onDelete,
  onUpdate,
}: {
  zone: TakeoffZone;
  isEnvelope: boolean;
  areaSf: number;
  perimeterLf: number;
  isSelected: boolean;
  onSelect: () => void;
  onContinue: () => void;
  onDelete: () => void;
  onUpdate: (updates: {
    label?: string;
    zoneType?: ZoneType;
    floorLabel?: string | null;
    defaultCeilingHeightFt?: number | null;
    status?: TakeoffZone['status'];
    isEnvelope?: boolean;
  }) => void;
}) {
  return (
    <div
      className={`rounded-[22px] border px-4 py-4 ${
        isSelected
          ? 'border-[var(--takeoff-line-strong)] bg-white'
          : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]'
      }`}
    >
      <button onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
              Area
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--takeoff-ink)]">
              {zone.label}
            </div>
          </div>
          <div className="text-right">
            <div className="takeoff-mono text-[15px] font-semibold text-[var(--takeoff-ink)]">
              {Math.round(areaSf).toLocaleString()} SF
            </div>
            <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
              {formatFeetInches(perimeterLf)}
            </div>
          </div>
        </div>
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Label
          </span>
          <input
            value={zone.label}
            onChange={(event) => onUpdate({ label: event.target.value })}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Area Type
          </span>
          <select
            value={zone.zoneType}
            onChange={(event) => onUpdate({ zoneType: event.target.value as ZoneType })}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            {ZONE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {ZONE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Status
          </span>
          <select
            value={zone.status}
            onChange={(event) => onUpdate({ status: event.target.value as TakeoffZone['status'] })}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Floor / Level
          </span>
          <input
            value={zone.floorLabel ?? ''}
            placeholder="Main floor"
            onChange={(event) => onUpdate({ floorLabel: event.target.value || null })}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Default Height
          </span>
          <input
            type="number"
            min="0"
            step="0.25"
            value={zone.defaultCeilingHeightFt ?? ''}
            placeholder="9"
            onChange={(event) =>
              {
                const nextValue = Number.parseFloat(event.target.value);
                onUpdate({
                  defaultCeilingHeightFt:
                    event.target.value === '' || !Number.isFinite(nextValue) ? null : nextValue,
                });
              }
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--takeoff-text-muted)]">
        <input
          type="checkbox"
          checked={zone.status === 'confirmed'}
          onChange={() =>
            onUpdate({
              status: zone.status === 'confirmed' ? 'draft' : 'confirmed',
            })
          }
          className="h-3.5 w-3.5 rounded border-[var(--takeoff-line-strong)] bg-white text-[var(--takeoff-ink)] focus:ring-black/5"
        />
        Confirmed area
      </label>

      <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--takeoff-text-muted)]">
        <input
          type="checkbox"
          checked={isEnvelope}
          onChange={(event) => onUpdate({ isEnvelope: event.target.checked })}
          className="h-3.5 w-3.5 rounded border-[var(--takeoff-line-strong)] bg-white text-[var(--takeoff-ink)] focus:ring-black/5"
        />
        Envelope / reference area
      </label>

      <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-relaxed text-[var(--takeoff-text-muted)]">
        Areas define thermal context, floor/level context, and default height context. They guide adjacency and later wall defaults, but do not bill area by themselves.
      </div>

      <div className="mt-3">
        <ObjectActions onContinue={onContinue} onDelete={onDelete} />
      </div>
    </div>
  );
}

function WallRunCard({
  wallRun,
  metrics,
  segments,
  zoneOptions,
  isSelected,
  onSelect,
  onContinue,
  onDelete,
  onUpdate,
}: {
  wallRun: WallRun;
  metrics: WallMetrics;
  segments: DerivedSegment[];
  zoneOptions: Array<{ id: string; label: string }>;
  isSelected: boolean;
  onSelect: () => void;
  onContinue: () => void;
  onDelete: () => void;
  onUpdate: (updates: {
    label?: string;
    assemblyScope?: WallRun['assemblyScope'];
    heightFt?: number;
    thicknessIn?: WallRun['thicknessIn'];
    framingType?: WallRun['framingType'];
    sideAZoneId?: string;
    sideBZoneId?: string;
    reviewFlags?: string[];
  }) => void;
}) {
  const [showSegments, setShowSegments] = useState(false);
  const hasMixedSegmentScope = wallRun.reviewFlags.includes('mixed_segment_scope');
  const hasMixedSegmentHeight = wallRun.reviewFlags.includes('mixed_segment_height');

  return (
    <div
      className={`rounded-[22px] border px-4 py-4 ${
        isSelected
          ? 'border-[var(--takeoff-line-strong)] bg-white'
          : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]'
      }`}
    >
      <button onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
              Wall Run
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--takeoff-ink)]">
              {wallRun.label}
            </div>
          </div>
          <div className="text-right">
            <div className="takeoff-mono text-[15px] font-semibold text-[var(--takeoff-ink)]">
              {formatFeetInches(metrics.totalLf)}
            </div>
            <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
              {Math.round(metrics.netSf).toLocaleString()} net SF
            </div>
          </div>
        </div>
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Label
          </span>
          <input
            value={wallRun.label}
            onChange={(event) => onUpdate({ label: event.target.value })}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Assembly
          </span>
          <select
            value={wallRun.assemblyScope ?? MIXED_WALL_SCOPE_VALUE}
            onChange={(event) =>
              event.target.value === MIXED_WALL_SCOPE_VALUE
                ? undefined
                : onUpdate({ assemblyScope: event.target.value as WallRun['assemblyScope'] })
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            {hasMixedSegmentScope && (
              <option value={MIXED_WALL_SCOPE_VALUE}>
                Mixed by segment
              </option>
            )}
            {WALL_PRESET_OPTIONS.map((preset) => (
              <option key={preset.key} value={preset.scope}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Height
          </span>
          <input
            type="number"
            min="1"
            max="30"
            step="0.1"
            value={wallRun.heightFt ?? ''}
            placeholder={hasMixedSegmentHeight ? 'Mixed by segment' : 'Set height'}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) {
                onUpdate({ heightFt: value });
              }
            }}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <div className="col-span-2 space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Thickness
          </span>
          <div className="flex flex-wrap gap-1.5">
            {THICKNESS_OPTIONS.map((thickness) => (
              <button
                key={thickness}
                onClick={() => onUpdate({ thicknessIn: thickness })}
                className={`takeoff-mono rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  wallRun.thicknessIn === thickness
                    ? 'border-[var(--takeoff-ink)] bg-white text-[var(--takeoff-ink)]'
                    : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-muted)]'
                }`}
              >
                {thickness}"
              </button>
            ))}
          </div>
        </div>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Framing
          </span>
          <select
            value={wallRun.framingType ?? 'other'}
            onChange={(event) =>
              onUpdate({ framingType: event.target.value as WallRun['framingType'] })
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            {FRAMING_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Height Source
          </span>
          <div className="takeoff-mono rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-text-muted)]">
            {wallRun.heightSource.replace(/_/g, ' ')}
          </div>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Side A
          </span>
          <select
            value={wallRun.sideAZoneId ?? ''}
            onChange={(event) =>
              onUpdate({ sideAZoneId: event.target.value || undefined })
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            <option value="">Outside / unset</option>
            {zoneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Side B
          </span>
          <select
            value={wallRun.sideBZoneId ?? ''}
            onChange={(event) =>
              onUpdate({ sideBZoneId: event.target.value || undefined })
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            <option value="">Outside / unset</option>
            {zoneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] text-[var(--takeoff-text-muted)]">
        <div>
          <div className="takeoff-label text-[10px] text-[var(--takeoff-text-subtle)]">Segments</div>
          <div className="takeoff-mono mt-1 font-semibold text-[var(--takeoff-ink)]">{metrics.segmentCount}</div>
        </div>
        <div>
          <div className="takeoff-label text-[10px] text-[var(--takeoff-text-subtle)]">Openings</div>
          <div className="takeoff-mono mt-1 font-semibold text-[var(--takeoff-ink)]">{metrics.openingCount}</div>
        </div>
        <div>
          <div className="takeoff-label text-[10px] text-[var(--takeoff-text-subtle)]">Gross</div>
          <div className="takeoff-mono mt-1 font-semibold text-[var(--takeoff-ink)]">
            {Math.round(metrics.grossSf).toLocaleString()} SF
          </div>
        </div>
        <div>
          <div className="takeoff-label text-[10px] text-[var(--takeoff-text-subtle)]">Openings SF</div>
          <div className="takeoff-mono mt-1 font-semibold text-[var(--takeoff-ink)]">
            {Math.round(metrics.openingSf).toLocaleString()} SF
          </div>
        </div>
      </div>

      {wallRun.reviewFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {wallRun.reviewFlags.map((flag) => (
            <span
              key={flag}
              className="takeoff-mono rounded-full border border-[var(--takeoff-warning)]/35 bg-[rgba(212,168,67,0.08)] px-2.5 py-1 text-[10px] font-medium text-[var(--takeoff-warning)]"
            >
              {formatReviewFlag(flag)}
            </span>
          ))}
        </div>
      )}

      {segments.length > 0 && (
        <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
          <button
            onClick={() => setShowSegments((value) => !value)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-[var(--takeoff-ink)]"
          >
            <span>Segment details and openings</span>
            {showSegments ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showSegments && (
            <div className="space-y-2 border-t border-[var(--takeoff-line)] px-3 py-3">
              {segments.map((segment) => (
                <div key={`${segment.traceId}-${segment.segmentIndex}`} className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="takeoff-label text-[10px] font-medium text-[var(--takeoff-text-muted)]">
                      Segment {segment.segmentIndex + 1}
                    </div>
                    <div className="takeoff-mono text-[11px] text-[var(--takeoff-ink)]">
                      {formatFeetInches(segment.lengthFt)}
                    </div>
                  </div>
                  <div className="mt-2">
                    <OpeningsEditor
                      traceId={segment.traceId}
                      segmentIndex={segment.segmentIndex}
                      openings={segment.classification?.openings ?? []}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <ObjectActions onContinue={onContinue} onDelete={onDelete} />
      </div>
    </div>
  );
}

function SurfaceCard({
  surface,
  metrics,
  isSelected,
  onSelect,
  onContinue,
  onDelete,
  onUpdate,
}: {
  surface: TakeoffSurface;
  metrics: SurfaceMetrics;
  isSelected: boolean;
  onSelect: () => void;
  onContinue: () => void;
  onDelete: () => void;
  onUpdate: (updates: {
    label?: string;
    assemblyScope?: TakeoffSurface['assemblyScope'];
    status?: TakeoffSurface['status'];
  }) => void;
}) {
  return (
    <div
      className={`rounded-[22px] border px-4 py-4 ${
        isSelected
          ? 'border-[var(--takeoff-line-strong)] bg-white'
          : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]'
      }`}
    >
      <button onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
              Surface
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--takeoff-ink)]">
              {surface.label}
            </div>
          </div>
          <div className="text-right">
            <div className="takeoff-mono text-[15px] font-semibold text-[var(--takeoff-ink)]">
              {Math.round(metrics.areaSf).toLocaleString()} SF
            </div>
            <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
              {formatFeetInches(metrics.perimeterLf)}
            </div>
          </div>
        </div>
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Label
          </span>
          <input
            value={surface.label}
            onChange={(event) => onUpdate({ label: event.target.value })}
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Assembly
          </span>
          <select
            value={surface.assemblyScope}
            onChange={(event) =>
              onUpdate({
                assemblyScope: event.target.value as TakeoffSurface['assemblyScope'],
              })
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            {SURFACE_PRESET_OPTIONS.map((preset) => (
              <option key={preset.key} value={preset.scope}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
            Status
          </span>
          <select
            value={surface.status}
            onChange={(event) =>
              onUpdate({ status: event.target.value as TakeoffSurface['status'] })
            }
            className="w-full rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] focus:outline-none focus:ring-2 focus:ring-black/5"
          >
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
      </div>

      <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-relaxed text-[var(--takeoff-text-muted)]">
        Surface scopes feed attic, crawlspace, garage ceiling, and other area-based insulation quantities directly into the quote summary.
      </div>

      <div className="mt-3">
        <ObjectActions onContinue={onContinue} onDelete={onDelete} />
      </div>
    </div>
  );
}

export function SegmentList() {
  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const activeViewId = useTakeoffStore((state) => state.activeViewId);
  const drawingPreset = useTakeoffStore((state) => state.drawingPreset);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const startTrace = useTakeoffStore((state) => state.startTrace);
  const continueTrace = useTakeoffStore((state) => state.continueTrace);
  const deleteTrace = useTakeoffStore((state) => state.deleteTrace);
  const selectTrace = useTakeoffStore((state) => state.selectTrace);
  const updateZoneObject = useTakeoffStore((state) => state.updateZoneObject);
  const updateWallRunObject = useTakeoffStore((state) => state.updateWallRunObject);
  const updateSurfaceObject = useTakeoffStore((state) => state.updateSurfaceObject);
  const applyWallSuggestionsForActiveView = useTakeoffStore((state) => state.applyWallSuggestionsForActiveView);
  const getCalibration = useTakeoffStore((state) => state.getCalibration);
  const getDerivedSegments = useTakeoffStore((state) => state.getDerivedSegments);
  const getDerivedAreas = useTakeoffStore((state) => state.getDerivedAreas);

  const calibration = getCalibration();
  const segments = getDerivedSegments();
  const areas = getDerivedAreas();

  if (!calibration) {
    return (
      <div className="mt-6 space-y-3 px-2 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)]">
          <svg className="h-5 w-5 text-[var(--takeoff-warning)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[var(--takeoff-ink)]">Calibrate first</p>
        <p className="text-xs leading-relaxed text-[var(--takeoff-text-muted)]">
          Measure two known dimensions and verify the page before any object contributes to the takeoff.
        </p>
      </div>
    );
  }

  const zones = (session?.zones ?? []).filter(
    (zone) => zone.pageIndex === activePageIndex && (!activeViewId || zone.viewId === activeViewId)
  );
  const wallRuns = (session?.wallRuns ?? []).filter(
    (wallRun) => wallRun.pageIndex === activePageIndex && (!activeViewId || wallRun.viewId === activeViewId)
  );
  const surfaces = (session?.surfaces ?? []).filter(
    (surface) => surface.pageIndex === activePageIndex && (!activeViewId || surface.viewId === activeViewId)
  );
  const wallSuggestions =
    session
      ? buildWallRunSuggestionsForView(session, activePageIndex, activeViewId)
      : [];

  const totalObjects = zones.length + wallRuns.length + surfaces.length;

  if (totalObjects === 0) {
    return (
      <div className="mt-6 space-y-3 px-2 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
          <svg className="h-5 w-5 text-[var(--takeoff-ink)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[var(--takeoff-ink)]">Start the active view</p>
        <p className="text-xs leading-relaxed text-[var(--takeoff-text-muted)]">
          {drawingPreset === 'zone'
            ? 'Draw takeoff areas so the takeoff has real adjacency context.'
            : drawingPreset === 'surface'
              ? 'Draw surface objects for attic, crawlspace, and ceiling scopes.'
              : 'Draw wall runs, then review assembly, height, framing, and openings here.'}
        </p>
        <button
          onClick={() => startTrace()}
          className="takeoff-mono mt-2 w-full rounded-full border border-white bg-[var(--takeoff-paper-strong)] py-3 text-[11px] font-semibold text-[var(--takeoff-ink)] transition-colors hover:bg-[var(--takeoff-paper)]"
        >
          Start Tracing
        </button>
      </div>
    );
  }

  const wallMetricsById = new Map<string, WallMetrics>();
  for (const segment of segments) {
    const current = wallMetricsById.get(segment.traceId) ?? {
      totalLf: 0,
      grossSf: 0,
      netSf: 0,
      openingSf: 0,
      openingCount: 0,
      segmentCount: 0,
    };
    current.totalLf += segment.lengthFt;
    current.grossSf += segment.grossSf;
    current.netSf += segment.netSf;
    current.openingSf += segment.openingsSf;
    current.openingCount += segment.classification?.openings.length ?? 0;
    current.segmentCount += 1;
    wallMetricsById.set(segment.traceId, current);
  }

  const areaMetricsById = new Map<string, SurfaceMetrics>();
  for (const area of areas) {
    areaMetricsById.set(area.traceId, {
      areaSf: area.areaSf,
      perimeterLf: area.perimeterLf,
    });
  }

  const zoneOptions = zones.map((zone) => ({
    id: zone.id,
    label: zone.label,
  }));

  const suggestionBuckets = wallSuggestions.reduce<Record<string, number>>((acc, suggestion) => {
    const key = suggestion.assemblyScope ?? 'review';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const unresolvedSuggestions = wallSuggestions.filter((suggestion) => suggestion.reviewFlags.length > 0).length;

  return (
    <div className="space-y-5">
      {zones.length > 0 && (
        <section className="space-y-3">
          <FamilyHeader
            title="Areas"
            count={zones.length}
            description="Confirm takeoff areas before classifying walls."
          />
          <div className="space-y-3">
            {zones.map((zone) => {
              const areaSf = polygonAreaSf(zone.polygon, calibration);
              const perimeterLf = polygonPerimeterLf(zone.polygon, calibration);
              const trace = session?.traces.find((item) => item.id === zone.id);
              return (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  isEnvelope={Boolean(trace?.isEnvelope)}
                  areaSf={areaSf}
                  perimeterLf={perimeterLf}
                  isSelected={selectedTraceId === zone.id}
                  onSelect={() => selectTrace(zone.id)}
                  onContinue={() => continueTrace(zone.id)}
                  onDelete={() => deleteTrace(zone.id)}
                  onUpdate={(updates) => updateZoneObject(zone.id, updates)}
                />
              );
            })}
          </div>
        </section>
      )}

      {wallRuns.length > 0 && (
        <section className="space-y-3">
          {zones.length > 0 && wallSuggestions.length > 0 && (
            <div className="rounded-[22px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">
                    Area Suggestions
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--takeoff-text-muted)]">
                    Use touching areas to assign side A / side B and suggest wall scope for the active view.
                  </p>
                </div>
                <button
                  onClick={() => applyWallSuggestionsForActiveView()}
                  className="takeoff-mono rounded-full border border-white bg-[var(--takeoff-paper-strong)] px-3 py-2 text-[10px] font-semibold text-[var(--takeoff-ink)] transition-colors hover:bg-[var(--takeoff-paper)]"
                >
                  Suggest from areas
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(suggestionBuckets).map(([scope, count]) => (
                  <div
                    key={scope}
                    className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] font-medium text-[var(--takeoff-ink)]"
                  >
                    {count} {scopeLabel(scope as AssemblyScope | undefined)}
                  </div>
                ))}
                {unresolvedSuggestions > 0 && (
                  <div className="takeoff-mono rounded-full border border-[var(--takeoff-warning)]/35 bg-[rgba(212,168,67,0.08)] px-2.5 py-1 text-[10px] font-medium text-[var(--takeoff-warning)]">
                    {unresolvedSuggestions} need review
                  </div>
                )}
              </div>
            </div>
          )}

          <FamilyHeader
            title="Wall Runs"
            count={wallRuns.length}
            description="Review the billable objects directly instead of thinking in raw line segments."
          />
          <div className="space-y-3">
            {wallRuns.map((wallRun) => (
              <WallRunCard
                key={wallRun.id}
                wallRun={wallRun}
                metrics={
                  wallMetricsById.get(wallRun.id) ?? {
                    totalLf: 0,
                    grossSf: 0,
                    netSf: 0,
                    openingSf: 0,
                    openingCount: 0,
                    segmentCount: 0,
                  }
                }
                segments={segments.filter((segment) => segment.traceId === wallRun.id)}
                zoneOptions={zoneOptions}
                isSelected={selectedTraceId === wallRun.id}
                onSelect={() => selectTrace(wallRun.id)}
                onContinue={() => continueTrace(wallRun.id)}
                onDelete={() => deleteTrace(wallRun.id)}
                onUpdate={(updates) => updateWallRunObject(wallRun.id, updates)}
              />
            ))}
          </div>
        </section>
      )}

      {surfaces.length > 0 && (
        <section className="space-y-3">
          <FamilyHeader
            title="Surfaces"
            count={surfaces.length}
            description="Use surface objects for attic, crawlspace, ceiling, and floor-related scope."
          />
          <div className="space-y-3">
            {surfaces.map((surface) => {
              const fallbackMetrics = {
                areaSf: polygonAreaSf(surface.polygon, calibration),
                perimeterLf: polygonPerimeterLf(surface.polygon, calibration),
              };
              return (
                <SurfaceCard
                  key={surface.id}
                  surface={surface}
                  metrics={areaMetricsById.get(surface.id) ?? fallbackMetrics}
                  isSelected={selectedTraceId === surface.id}
                  onSelect={() => selectTrace(surface.id)}
                  onContinue={() => continueTrace(surface.id)}
                  onDelete={() => deleteTrace(surface.id)}
                  onUpdate={(updates) => updateSurfaceObject(surface.id, updates)}
                />
              );
            })}
          </div>
        </section>
      )}

      <button
        onClick={() => startTrace()}
        className="takeoff-mono w-full rounded-full border border-dashed border-[var(--takeoff-line)] py-3 text-[11px] font-medium text-[var(--takeoff-text-muted)] transition-colors hover:border-[#9eb29d] hover:bg-[var(--takeoff-paper)]"
      >
        {drawingPreset === 'zone'
          ? '+ Add another area'
          : drawingPreset === 'surface'
            ? '+ Add another surface'
            : '+ Add another wall run'}
      </button>
    </div>
  );
}
