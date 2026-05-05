/**
 * Snap point system for PDF vector endpoints.
 * Fetches intersection points from the server-side PyMuPDF extraction,
 * which recursively processes all XObject forms and returns points where
 * 2+ significant lines meet (wall corners, dimension junctions, etc.).
 */

import type { PdfPoint } from '@/lib/types/takeoff';

export interface SnapPointData {
  x: number;
  y: number;
  connections: number;
}

export interface SnapPoint extends PdfPoint {
  connections: number;
}

export interface SnapPointSet {
  points: SnapPoint[];
  rawData: SnapPointData[];
  pageWidth: number;
  pageHeight: number;
  totalLines: number;
  significantLines: number;
}

export interface SnapCandidateDebug {
  point: SnapPoint;
  dist: number;
}

export interface SnapDecision {
  point: SnapPoint | null;
  reason: 'snapped' | 'no_candidates' | 'ambiguous_cluster';
  thresholdPts: number;
  nearestDistance: number | null;
  nearestOverall: SnapCandidateDebug | null;
  candidateCount: number;
  topCandidates: SnapCandidateDebug[];
  bestCandidate: SnapCandidateDebug | null;
  runnerUpCandidate: SnapCandidateDebug | null;
  connectionPreferenceWindowPts: number;
  ambiguityDistanceDeltaPts: number;
  ambiguitySeparationPts: number;
  ambiguousCluster: boolean;
  distanceDelta: number | null;
  candidateSeparation: number | null;
}

/**
 * Fetch vector snap points from the server for a given PDF page.
 * Returns intersection points where 2+ significant lines meet.
 */
export async function fetchSnapPoints(
  pdfUrl: string,
  pageIndex: number,
): Promise<SnapPointSet | null> {
  if (
    pdfUrl.startsWith('blob:') ||
    pdfUrl.startsWith('data:') ||
    pdfUrl.startsWith('file:')
  ) {
    return null;
  }

  try {
    const response = await fetch('/api/takeoff/snap-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: pdfUrl,
        page_index: pageIndex,
        min_line_length: 10,
        min_connections: 2,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Coordinates are already in page space (Y-down).
    const points: SnapPoint[] = data.snap_points.map((sp: SnapPointData) => ({
      x: sp.x,
      y: sp.y,
      connections: sp.connections,
    }));

    return {
      points,
      rawData: data.snap_points,
      pageWidth: data.page_width,
      pageHeight: data.page_height,
      totalLines: data.total_lines,
      significantLines: data.significant_lines,
    };
  } catch (err) {
    console.error('[Snap] Failed to fetch snap points:', err);
    return null;
  }
}

/**
 * Find the nearest snap point to a given PDF coordinate.
 * Returns null if no point is within the threshold.
 */
export function resolveSnapDecision(
  target: PdfPoint,
  snapPoints: SnapPoint[],
  options:
    | number
    | {
        thresholdPts: number;
        connectionPreferenceWindowPts?: number;
        ambiguityDistanceDeltaPts?: number;
        ambiguitySeparationPts?: number;
      },
): SnapDecision {
  const thresholdPts =
    typeof options === 'number' ? options : options.thresholdPts;
  const connectionPreferenceWindowPts =
    typeof options === 'number'
      ? Math.max(1.5, thresholdPts * 0.35)
      : options.connectionPreferenceWindowPts ?? Math.max(1.5, thresholdPts * 0.35);
  const ambiguityDistanceDeltaPts =
    typeof options === 'number'
      ? Math.max(0.75, thresholdPts * 0.14)
      : options.ambiguityDistanceDeltaPts ?? Math.max(0.75, thresholdPts * 0.14);
  const ambiguitySeparationPts =
    typeof options === 'number'
      ? Math.max(6, thresholdPts * 1.6)
      : options.ambiguitySeparationPts ?? Math.max(6, thresholdPts * 1.6);

  let nearestOverall: SnapCandidateDebug | null = null;
  const candidates = snapPoints
    .map((point) => {
      const dx = point.x - target.x;
      const dy = point.y - target.y;
      const candidate = {
        point,
        dist: Math.sqrt(dx * dx + dy * dy),
      };
      if (!nearestOverall || candidate.dist < nearestOverall.dist) {
        nearestOverall = candidate;
      }
      return candidate;
    })
    .filter((candidate) => candidate.dist <= thresholdPts);

  if (candidates.length === 0) {
    return {
      point: null,
      reason: 'no_candidates',
      thresholdPts,
      nearestDistance: null,
      nearestOverall,
      candidateCount: 0,
      topCandidates: [],
      bestCandidate: null,
      runnerUpCandidate: null,
      connectionPreferenceWindowPts,
      ambiguityDistanceDeltaPts,
      ambiguitySeparationPts,
      ambiguousCluster: false,
      distanceDelta: null,
      candidateSeparation: null,
    };
  }

  const nearestDistance = Math.min(...candidates.map((candidate) => candidate.dist));
  const ranked = [...candidates].sort((left, right) => {
    const leftInPreferenceWindow = left.dist <= nearestDistance + connectionPreferenceWindowPts;
    const rightInPreferenceWindow = right.dist <= nearestDistance + connectionPreferenceWindowPts;

    if (
      leftInPreferenceWindow &&
      rightInPreferenceWindow &&
      left.point.connections !== right.point.connections
    ) {
      return right.point.connections - left.point.connections;
    }

    if (left.dist !== right.dist) {
      return left.dist - right.dist;
    }

    return right.point.connections - left.point.connections;
  });

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!runnerUp) {
    return {
      point: best.point,
      reason: 'snapped',
      thresholdPts,
      nearestDistance,
      nearestOverall,
      candidateCount: candidates.length,
      topCandidates: ranked.slice(0, 3),
      bestCandidate: best,
      runnerUpCandidate: null,
      connectionPreferenceWindowPts,
      ambiguityDistanceDeltaPts,
      ambiguitySeparationPts,
      ambiguousCluster: false,
      distanceDelta: null,
      candidateSeparation: null,
    };
  }

  const distanceDelta = Math.abs(best.dist - runnerUp.dist);
  const candidateSeparation = Math.hypot(
    best.point.x - runnerUp.point.x,
    best.point.y - runnerUp.point.y,
  );
  const isAmbiguousCluster =
    best.point.connections === runnerUp.point.connections &&
    distanceDelta <= ambiguityDistanceDeltaPts &&
    candidateSeparation <= ambiguitySeparationPts;

  return {
    point: isAmbiguousCluster ? null : best.point,
    reason: isAmbiguousCluster ? 'ambiguous_cluster' : 'snapped',
    thresholdPts,
    nearestDistance,
    nearestOverall,
    candidateCount: candidates.length,
    topCandidates: ranked.slice(0, 3),
    bestCandidate: best,
    runnerUpCandidate: runnerUp,
    connectionPreferenceWindowPts,
    ambiguityDistanceDeltaPts,
    ambiguitySeparationPts,
    ambiguousCluster: isAmbiguousCluster,
    distanceDelta,
    candidateSeparation,
  };
}

export function findNearestSnapPoint(
  target: PdfPoint,
  snapPoints: SnapPoint[],
  options:
    | number
    | {
        thresholdPts: number;
        connectionPreferenceWindowPts?: number;
        ambiguityDistanceDeltaPts?: number;
        ambiguitySeparationPts?: number;
      },
): SnapPoint | null {
  return resolveSnapDecision(target, snapPoints, options).point;
}
