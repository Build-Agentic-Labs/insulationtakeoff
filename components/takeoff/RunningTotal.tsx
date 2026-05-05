'use client';

import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { AssemblyScope } from '@/lib/types/takeoff';
import { buildWallRunSuggestionsForView } from '@/lib/takeoff/zone-classifier';

interface RunningTotalProps {
  onOpenReview: () => void;
  showReviewAction?: boolean;
}

const SCOPE_LABELS: Partial<Record<AssemblyScope, string>> = {
  exterior_wall_2x6: 'Ext 2x6',
  exterior_wall_2x4: 'Ext 2x4',
  garage_wall: 'Garage',
  basement_wall: 'Basement',
  knee_wall: 'Knee Wall',
  attic_floor: 'Attic',
  crawlspace_floor: 'Crawl',
  garage_ceiling: 'Gar Ceil',
  sound_floor: 'Sound Flr',
  cathedral_ceiling: 'Cathedral',
  cantilever_floor: 'Cantilever',
};

function parseScopeKey(key: string): { scope: string; height: number } {
  const lastUnderscore = key.lastIndexOf('_');
  const height = parseFloat(key.slice(lastUnderscore + 1));
  const scope = key.slice(0, lastUnderscore);
  return { scope, height: isNaN(height) ? 0 : height };
}

export function RunningTotal({ onOpenReview, showReviewAction = true }: RunningTotalProps) {
  // Derive totals from session to avoid stale computed references
  const session = useTakeoffStore((s) => s.session);
  const activePageIndex = useTakeoffStore((s) => s.activePageIndex);
  const activeViewId = useTakeoffStore((s) => s.activeViewId);
  const getDerivedSegments = useTakeoffStore((s) => s.getDerivedSegments);
  const getDerivedAreas = useTakeoffStore((s) => s.getDerivedAreas);
  const getCalibration = useTakeoffStore((s) => s.getCalibration);
  const getVisibleTracesForPage = useTakeoffStore((s) => s.getVisibleTracesForPage);

  const cal = getCalibration();
  const segments = getDerivedSegments();
  const areas = getDerivedAreas();

  if (!cal || (segments.length === 0 && areas.length === 0)) {
    return (
      <div className="shrink-0 border-t border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.92)] px-5 py-4">
        <p className="takeoff-mono text-center text-[11px] text-[var(--takeoff-text-muted)]">
          {!cal ? 'Calibrate to start' : 'Trace walls or areas to see totals'}
        </p>
      </div>
    );
  }

  // Compute totals
  let totalLf = 0;
  let grossSf = 0;
  let netSf = 0;
  const byScope: Record<string, { lf: number; grossSf: number; netSf: number; count: number }> = {};

  for (const seg of segments) {
    totalLf += seg.lengthFt;
    grossSf += seg.grossSf;
    netSf += seg.netSf;

    const scopeKey = seg.classification
      ? `${seg.classification.assemblyScope}_${seg.classification.wallHeightFt ?? 0}`
      : 'unclassified_0';

    if (!byScope[scopeKey]) {
      byScope[scopeKey] = { lf: 0, grossSf: 0, netSf: 0, count: 0 };
    }
    byScope[scopeKey].lf += seg.lengthFt;
    byScope[scopeKey].grossSf += seg.grossSf;
    byScope[scopeKey].netSf += seg.netSf;
    byScope[scopeKey].count += 1;
  }

  for (const area of areas) {
    grossSf += area.areaSf;
    netSf += area.areaSf;

    const scopeKey = area.classification
      ? `${area.classification.assemblyScope}_0`
      : 'unclassified_0';

    if (!byScope[scopeKey]) {
      byScope[scopeKey] = { lf: 0, grossSf: 0, netSf: 0, count: 0 };
    }
    byScope[scopeKey].grossSf += area.areaSf;
    byScope[scopeKey].netSf += area.areaSf;
    byScope[scopeKey].count += 1;
  }

  const traceCount = getVisibleTracesForPage(activePageIndex).length;
  const wallMetricsByTraceId = segments.reduce<Record<string, { lf: number; sf: number }>>((acc, segment) => {
    const current = acc[segment.traceId] ?? { lf: 0, sf: 0 };
    current.lf += segment.lengthFt;
    current.sf += segment.netSf;
    acc[segment.traceId] = current;
    return acc;
  }, {});

  const scopeEntries = Object.entries(byScope).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="shrink-0 space-y-3 border-t border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.92)] px-5 py-5">
      {/* Scope breakdown */}
      {scopeEntries.map(([key, data]) => {
        const { scope, height } = parseScopeKey(key);
        const label = SCOPE_LABELS[scope as AssemblyScope] ?? scope;
        const isAreaScope = data.lf === 0 && data.netSf > 0;
        return (
          <div key={key} className="flex items-center justify-between text-[10px]">
            <span className="takeoff-label text-[var(--takeoff-text-muted)]">
              {label} {height > 0 ? `${height}'` : ''}
            </span>
            <span className="takeoff-mono text-[var(--takeoff-ink)]">
              {isAreaScope
                ? `${Math.round(data.netSf).toLocaleString()} SF`
                : `${Math.round(data.lf)} LF / ${Math.round(data.netSf)} SF`}
            </span>
          </div>
        );
      })}

      {/* Divider + totals */}
      <div className="border-t border-[var(--takeoff-line)] pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="takeoff-label text-[var(--takeoff-text-muted)]">Total</span>
          <div className="text-right">
            <div className="takeoff-mono text-[22px] font-semibold text-[var(--takeoff-ink)]">
              {Math.round(totalLf)} LF
            </div>
            <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
              {Math.round(grossSf)} gross / {Math.round(netSf)} net SF
            </div>
          </div>
        </div>
        <div className="takeoff-mono mt-1 text-[10px] text-[var(--takeoff-text-subtle)]">
          {traceCount} trace{traceCount !== 1 ? 's' : ''} ·{' '}
          {segments.length} segment{segments.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Review button */}
      {/* Zone-based insulation breakdown */}
      {(() => {
        if (!session) return null;
        const suggestions = buildWallRunSuggestionsForView(session, activePageIndex, activeViewId);
        if (suggestions.length === 0) return null;

        const summary = suggestions.reduce(
          (acc, suggestion) => {
            const metrics = wallMetricsByTraceId[suggestion.wallRunId] ?? { lf: 0, sf: 0 };
            const key =
              suggestion.reviewFlags.length > 0
                ? 'review'
                : suggestion.assemblyScope === 'garage_wall'
                  ? 'garage'
                  : suggestion.assemblyScope === 'basement_wall'
                    ? 'basement'
                    : suggestion.assemblyScope === 'knee_wall'
                      ? 'knee'
                      : 'exterior';

            acc[key].lf += metrics.lf;
            acc[key].sf += metrics.sf;
            return acc;
          },
          {
            exterior: { lf: 0, sf: 0 },
            garage: { lf: 0, sf: 0 },
            basement: { lf: 0, sf: 0 },
            knee: { lf: 0, sf: 0 },
            review: { lf: 0, sf: 0 },
          }
        );

        return (
          <div className="space-y-2 border-t border-[var(--takeoff-line)] pt-3">
            <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-muted)]">Zone Suggestions</div>
            {summary.exterior.lf > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="takeoff-label text-[var(--takeoff-text-muted)]">Exterior walls</span>
                <span className="takeoff-mono text-[var(--takeoff-ink)]">{Math.round(summary.exterior.lf)} LF / {Math.round(summary.exterior.sf)} SF</span>
              </div>
            )}
            {summary.garage.lf > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="takeoff-label text-[var(--takeoff-text-muted)]">Garage shared</span>
                <span className="takeoff-mono text-[var(--takeoff-ink)]">{Math.round(summary.garage.lf)} LF / {Math.round(summary.garage.sf)} SF</span>
              </div>
            )}
            {summary.basement.lf > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="takeoff-label text-[var(--takeoff-text-muted)]">Foundation walls</span>
                <span className="takeoff-mono text-[var(--takeoff-ink)]">{Math.round(summary.basement.lf)} LF / {Math.round(summary.basement.sf)} SF</span>
              </div>
            )}
            {summary.knee.lf > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="takeoff-label text-[var(--takeoff-text-muted)]">Knee walls</span>
                <span className="takeoff-mono text-[var(--takeoff-ink)]">{Math.round(summary.knee.lf)} LF / {Math.round(summary.knee.sf)} SF</span>
              </div>
            )}
            {summary.review.lf > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="takeoff-label text-[var(--takeoff-warning)]">Needs review</span>
                <span className="takeoff-mono text-[var(--takeoff-warning)]">{Math.round(summary.review.lf)} LF / {Math.round(summary.review.sf)} SF</span>
              </div>
            )}
          </div>
        );
      })()}

      {showReviewAction && (
        <button
          onClick={onOpenReview}
          disabled={segments.length === 0 && areas.length === 0}
          className="takeoff-mono mt-2 w-full rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#202621] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
        >
          Review Takeoff
        </button>
      )}
    </div>
  );
}
