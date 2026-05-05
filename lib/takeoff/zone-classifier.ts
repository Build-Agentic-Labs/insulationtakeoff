/**
 * Zone-based wall insulation helpers.
 *
 * This file still supports the legacy trace-based summary, but it now also
 * powers the wall-object workflow by suggesting zone adjacency and assembly
 * assignments for persisted wall runs.
 */

import type { TakeoffSession, Trace, PdfPoint, AssemblyScope, ZoneType } from '@/lib/types/takeoff';
import type { WallRun, Zone } from '@/lib/types/takeoff-v2';
import { pdfDistance } from '@/lib/types/takeoff';

export type WallInsulationType =
  | 'exterior'           // Envelope wall facing outside — full exterior insulation
  | 'garage_shared'      // Wall between conditioned space and garage
  | 'storage_shared'     // Wall between conditioned space and storage
  | 'crawl_shared'       // Wall between conditioned space and crawlspace
  | 'none';              // No insulation needed (unconditioned exterior, or conditioned-to-conditioned)

export interface ClassifiedWall {
  traceId: string;
  segmentIndex: number;
  insulationType: WallInsulationType;
  assemblyScope: AssemblyScope;
  reason: string;
}

export interface WallRunZoneSuggestion {
  wallRunId: string;
  assemblyScope?: AssemblyScope;
  sideAZoneId?: string;
  sideBZoneId?: string;
  touchingZoneIds: string[];
  touchingZoneTypes: ZoneType[];
  confidence: number;
  reviewFlags: string[];
  reason: string;
}

/**
 * Proximity threshold for detecting shared walls (in PDF points).
 * Two wall segments within this distance are considered "shared" (same wall, different sides).
 */
const SHARED_WALL_THRESHOLD = 20; // ~1.1 feet — accounts for wall thickness

/**
 * Check if two line segments are approximately parallel and close together (shared wall).
 */
export function segmentsAreShared(
  a1: PdfPoint, a2: PdfPoint,
  b1: PdfPoint, b2: PdfPoint,
  threshold: number,
): boolean {
  // Check if midpoints are close
  const midA = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  const midB = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
  const midDist = pdfDistance(midA, midB);
  if (midDist > threshold * 3) return false; // Quick reject

  // Check if endpoints are close to the other segment
  const distA1toB = pointToSegmentDistance(a1, b1, b2);
  const distA2toB = pointToSegmentDistance(a2, b1, b2);
  const distB1toA = pointToSegmentDistance(b1, a1, a2);
  const distB2toA = pointToSegmentDistance(b2, a1, a2);

  const minDist = Math.min(distA1toB, distA2toB, distB1toA, distB2toA);
  if (minDist > threshold) return false;

  // Check overlap — segments must run roughly parallel
  const lenA = pdfDistance(a1, a2);
  const lenB = pdfDistance(b1, b2);
  if (lenA < 5 || lenB < 5) return false;

  // Dot product of direction vectors (should be close to ±1 for parallel)
  const dxA = (a2.x - a1.x) / lenA;
  const dyA = (a2.y - a1.y) / lenA;
  const dxB = (b2.x - b1.x) / lenB;
  const dyB = (b2.y - b1.y) / lenB;
  const dot = Math.abs(dxA * dxB + dyA * dyB);

  return dot > 0.8; // Within ~37° of parallel
}

export function pointToSegmentDistance(p: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return pdfDistance(p, a);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return pdfDistance(p, proj);
}

/**
 * Get segment endpoints for a trace (handles closed traces).
 */
function getSegmentPoints(trace: Trace, segIndex: number): [PdfPoint, PdfPoint] {
  const isClosing = trace.isClosed && segIndex === trace.points.length - 1;
  const a = trace.points[segIndex];
  const b = isClosing ? trace.points[0] : trace.points[segIndex + 1];
  return [a, b];
}

function segmentCount(trace: Trace): number {
  return trace.isClosed ? trace.points.length : trace.points.length - 1;
}

function wallRunSegmentCount(wallRun: WallRun): number {
  return Math.max(0, wallRun.path.length - 1);
}

function getWallRunSegmentPoints(wallRun: WallRun, segmentIndex: number): [PdfPoint, PdfPoint] | null {
  const a = wallRun.path[segmentIndex];
  const b = wallRun.path[segmentIndex + 1];
  if (!a || !b) return null;
  return [a, b];
}

function getZoneEdgePoints(zone: Zone, edgeIndex: number): [PdfPoint, PdfPoint] | null {
  if (zone.polygon.length < 3) return null;
  const a = zone.polygon[edgeIndex];
  const b = zone.polygon[(edgeIndex + 1) % zone.polygon.length];
  if (!a || !b) return null;
  return [a, b];
}

function wallRunExteriorScope(wallRun: WallRun): AssemblyScope {
  return wallRun.thicknessIn <= 4 ? 'exterior_wall_2x4' : 'exterior_wall_2x6';
}

function zoneTouchOverlap(wallRun: WallRun, zone: Zone): number {
  let overlap = 0;

  for (let wallSegmentIndex = 0; wallSegmentIndex < wallRunSegmentCount(wallRun); wallSegmentIndex += 1) {
    const wallSegment = getWallRunSegmentPoints(wallRun, wallSegmentIndex);
    if (!wallSegment) continue;

    for (let zoneEdgeIndex = 0; zoneEdgeIndex < zone.polygon.length; zoneEdgeIndex += 1) {
      const zoneEdge = getZoneEdgePoints(zone, zoneEdgeIndex);
      if (!zoneEdge) continue;

      if (segmentsAreShared(wallSegment[0], wallSegment[1], zoneEdge[0], zoneEdge[1], SHARED_WALL_THRESHOLD)) {
        overlap += Math.min(
          pdfDistance(wallSegment[0], wallSegment[1]),
          pdfDistance(zoneEdge[0], zoneEdge[1]),
        );
      }
    }
  }

  return overlap;
}

function resolveSuggestedAssemblyScope(
  wallRun: WallRun,
  primaryZone: Zone | undefined,
  secondaryZone: Zone | undefined,
): { assemblyScope?: AssemblyScope; reviewFlags: string[]; reason: string } {
  const reviewFlags: string[] = [];

  if (!primaryZone && !secondaryZone) {
    return {
      reviewFlags: ['no_zone_overlap'],
      reason: 'No touching zones were found near this wall run.',
    };
  }

  const conditionedZone =
    primaryZone?.zoneType === 'conditioned'
      ? primaryZone
      : secondaryZone?.zoneType === 'conditioned'
        ? secondaryZone
        : undefined;
  const nonConditionedZone =
    primaryZone && primaryZone.zoneType !== 'conditioned'
      ? primaryZone
      : secondaryZone && secondaryZone.zoneType !== 'conditioned'
        ? secondaryZone
        : undefined;

  if (conditionedZone && !nonConditionedZone) {
    return {
      assemblyScope: wallRunExteriorScope(wallRun),
      reviewFlags,
      reason: `Exterior wall inferred from conditioned zone "${conditionedZone.label}".`,
    };
  }

  if (!conditionedZone && nonConditionedZone && !secondaryZone) {
    return {
      reviewFlags: ['unconditioned_only_wall'],
      reason: `Wall only touches unconditioned zone "${nonConditionedZone.label}".`,
    };
  }

  if (conditionedZone && nonConditionedZone) {
    switch (nonConditionedZone.zoneType) {
      case 'unconditioned_garage':
        return {
          assemblyScope: 'garage_wall',
          reviewFlags,
          reason: `Garage-shared wall inferred from "${conditionedZone.label}" and "${nonConditionedZone.label}".`,
        };
      case 'unconditioned_attic':
        return {
          assemblyScope: 'knee_wall',
          reviewFlags,
          reason: `Knee wall inferred from "${conditionedZone.label}" and attic zone "${nonConditionedZone.label}".`,
        };
      case 'unconditioned_crawl':
        return {
          assemblyScope: 'basement_wall',
          reviewFlags,
          reason: `Foundation wall inferred from "${conditionedZone.label}" and crawl zone "${nonConditionedZone.label}".`,
        };
      case 'unconditioned_storage':
        return {
          reviewFlags: ['unsupported_zone_pair'],
          reason: `Shared wall with storage zone "${nonConditionedZone.label}" needs estimator review.`,
        };
      default:
        return {
          reviewFlags: ['unsupported_zone_pair'],
          reason: 'Zone pairing needs estimator review.',
        };
    }
  }

  return {
    reviewFlags: ['conditioned_to_conditioned_wall'],
    reason: 'Wall appears to separate conditioned zones and may not need insulation scope.',
  };
}

export function buildWallRunSuggestionsForView(
  session: TakeoffSession,
  pageIndex: number,
  viewId?: string | null,
): WallRunZoneSuggestion[] {
  const wallRuns = (session.wallRuns ?? []).filter(
    (wallRun) => wallRun.pageIndex === pageIndex && (!viewId || wallRun.viewId === viewId)
  );
  const zones = (session.zones ?? []).filter(
    (zone) => zone.pageIndex === pageIndex && (!viewId || zone.viewId === viewId)
  );

  if (wallRuns.length === 0 || zones.length === 0) {
    return [];
  }

  return wallRuns.map((wallRun) => {
    const touchingZones = zones
      .map((zone) => ({
        zone,
        overlap: zoneTouchOverlap(wallRun, zone),
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);

    const topZones = touchingZones.slice(0, 2);
    const primaryZone = topZones[0]?.zone;
    const secondaryZone = topZones[1]?.zone;
    const assignment = resolveSuggestedAssemblyScope(wallRun, primaryZone, secondaryZone);

    const reviewFlags = [...assignment.reviewFlags];
    if (touchingZones.length > 2) {
      reviewFlags.push('mixed_zone_adjacency');
    }

    return {
      wallRunId: wallRun.id,
      assemblyScope: assignment.assemblyScope,
      sideAZoneId: primaryZone?.id,
      sideBZoneId: secondaryZone?.id,
      touchingZoneIds: topZones.map((entry) => entry.zone.id),
      touchingZoneTypes: topZones.map((entry) => entry.zone.zoneType),
      confidence:
        topZones.length === 0
          ? 0
          : topZones.length === 1
            ? 0.72
            : Math.min(0.95, 0.55 + Math.min(0.4, topZones[0].overlap / 200)),
      reviewFlags: Array.from(new Set(reviewFlags)),
      reason:
        touchingZones.length > 2
          ? `${assignment.reason} Multiple zones touch this wall run, so it should be verified.`
          : assignment.reason,
    };
  });
}

/**
 * Classify all wall segments based on zone adjacency.
 */
export function classifyWalls(traces: Trace[]): ClassifiedWall[] {
  const envelope = traces.find((t) => t.isEnvelope);
  const unconditioned = traces.filter((t) => t.zone && t.zone !== 'conditioned' && !t.isEnvelope);
  const results: ClassifiedWall[] = [];

  if (!envelope) {
    // No envelope — can't classify
    return results;
  }

  // Classify each envelope segment
  const envSegCount = segmentCount(envelope);
  for (let i = 0; i < envSegCount; i++) {
    const [a1, a2] = getSegmentPoints(envelope, i);

    // Check if this envelope segment is shared with any unconditioned zone
    let sharedZone: ZoneType | null = null;
    let sharedTraceId: string | null = null;

    for (const zone of unconditioned) {
      const zoneSegCount = segmentCount(zone);
      for (let j = 0; j < zoneSegCount; j++) {
        const [b1, b2] = getSegmentPoints(zone, j);
        if (segmentsAreShared(a1, a2, b1, b2, SHARED_WALL_THRESHOLD)) {
          sharedZone = zone.zone!;
          sharedTraceId = zone.id;
          break;
        }
      }
      if (sharedZone) break;
    }

    if (sharedZone) {
      // Envelope wall shared with unconditioned zone
      const insulationType: WallInsulationType =
        sharedZone === 'unconditioned_garage' ? 'garage_shared' :
        sharedZone === 'unconditioned_storage' ? 'storage_shared' :
        sharedZone === 'unconditioned_crawl' ? 'crawl_shared' : 'none';

      const scope: AssemblyScope =
        sharedZone === 'unconditioned_garage' ? 'garage_wall' : 'exterior_wall_2x6';

      results.push({
        traceId: envelope.id,
        segmentIndex: i,
        insulationType,
        assemblyScope: scope,
        reason: `Shared wall with ${sharedZone}`,
      });
    } else {
      // Pure exterior wall
      results.push({
        traceId: envelope.id,
        segmentIndex: i,
        insulationType: 'exterior',
        assemblyScope: 'exterior_wall_2x6',
        reason: 'Exterior envelope wall',
      });
    }
  }

  // Classify each unconditioned zone segment
  for (const zone of unconditioned) {
    const zoneSegCount = segmentCount(zone);
    for (let i = 0; i < zoneSegCount; i++) {
      const [a1, a2] = getSegmentPoints(zone, i);

      // Check if shared with envelope
      let isSharedWithEnvelope = false;
      for (let j = 0; j < envSegCount; j++) {
        const [b1, b2] = getSegmentPoints(envelope, j);
        if (segmentsAreShared(a1, a2, b1, b2, SHARED_WALL_THRESHOLD)) {
          isSharedWithEnvelope = true;
          break;
        }
      }

      if (isSharedWithEnvelope) {
        // This side of the shared wall — insulation applied from conditioned side
        // (already counted on the envelope side, so mark as shared)
        results.push({
          traceId: zone.id,
          segmentIndex: i,
          insulationType: 'none',
          assemblyScope: 'garage_wall',
          reason: 'Shared with envelope (insulation on conditioned side)',
        });
      } else {
        // Unconditioned zone exterior wall — no insulation
        results.push({
          traceId: zone.id,
          segmentIndex: i,
          insulationType: 'none',
          assemblyScope: 'garage_wall',
          reason: 'Unconditioned exterior — no insulation',
        });
      }
    }
  }

  return results;
}

/**
 * Summarize zone classification results.
 */
export function summarizeZoneClassification(
  walls: ClassifiedWall[],
  getSegmentLength: (traceId: string, segIndex: number) => number,
  getSegmentHeight: (traceId: string, segIndex: number) => number,
): {
  exterior: { lf: number; sf: number };
  garageShared: { lf: number; sf: number };
  storageShared: { lf: number; sf: number };
  noInsulation: { lf: number; sf: number };
} {
  const result = {
    exterior: { lf: 0, sf: 0 },
    garageShared: { lf: 0, sf: 0 },
    storageShared: { lf: 0, sf: 0 },
    noInsulation: { lf: 0, sf: 0 },
  };

  for (const wall of walls) {
    const lf = getSegmentLength(wall.traceId, wall.segmentIndex);
    const height = getSegmentHeight(wall.traceId, wall.segmentIndex);
    const sf = lf * height;

    switch (wall.insulationType) {
      case 'exterior':
        result.exterior.lf += lf;
        result.exterior.sf += sf;
        break;
      case 'garage_shared':
        result.garageShared.lf += lf;
        result.garageShared.sf += sf;
        break;
      case 'storage_shared':
        result.storageShared.lf += lf;
        result.storageShared.sf += sf;
        break;
      case 'none':
        result.noInsulation.lf += lf;
        result.noInsulation.sf += sf;
        break;
    }
  }

  return result;
}
