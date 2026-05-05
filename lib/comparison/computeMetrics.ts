import { supabaseAdmin } from '@/lib/supabase/server';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';

/**
 * Comparison metrics between OCR (envelope) and Vision (rooms/openings).
 * Stored in extraction_runs.metrics_json.
 */
export interface ComparisonMetrics {
  compared_at: string;
  ocr_run_id: string | null;
  vision_run_id: string | null;

  // Scope deltas (OCR - Vision). Positive = OCR higher.
  gross_sf_delta: number | null;
  ceiling_sf_delta: number | null;
  floor_sf_delta: number | null;
  garage_sf_delta: number | null;

  // Opening deltas
  door_count_delta: number | null;
  window_count_delta: number | null;
  total_opening_sf_delta: number | null;

  // OCR-only fields (Vision doesn't produce these)
  ocr_crawlspace_sf: number | null;
  ocr_rim_joist_lf: number | null;
  ocr_net_sf: number | null;

  // Confidence
  ocr_confidence: number | null;
  vision_confidence: number | null;

  // Agreement score: 0–1, higher = more agreement
  agreement_score: number;
}

interface VisionSummary {
  gross_wall_sf: number;
  ceiling_sf: number;
  floor_sf: number;
  garage_sf: number;
  door_count: number;
  window_count: number;
  total_opening_sf: number;
  confidence: number;
}

/**
 * Extract Vision summary from rooms + openings tables for a project.
 */
async function getVisionSummary(projectId: string, companyId: string): Promise<VisionSummary | null> {
  const { data: rooms } = await supabaseAdmin
    .from('rooms')
    .select('type, area_sqft, wall_sf, ceiling_sf, floor_sf')
    .eq('project_id', projectId)
    .eq('company_id', companyId);

  const { data: openings } = await supabaseAdmin
    .from('openings')
    .select('type, area_sqft, count')
    .eq('project_id', projectId)
    .eq('company_id', companyId);

  if (!rooms || rooms.length === 0) return null;

  const livingRooms = rooms.filter(r => r.type === 'living');
  const garageRooms = rooms.filter(r => r.type === 'garage');

  const grossWallSf = livingRooms.reduce((s, r) => s + (r.wall_sf || 0), 0);
  const ceilingSf = livingRooms.reduce((s, r) => s + (r.ceiling_sf || 0), 0);
  const floorSf = livingRooms.reduce((s, r) => s + (r.floor_sf || 0), 0);
  const garageSf = garageRooms.reduce((s, r) => s + (r.area_sqft || 0), 0);

  const doors = (openings || []).filter(o => o.type === 'door');
  const windows = (openings || []).filter(o => o.type === 'window');
  const doorCount = doors.reduce((s, d) => s + (d.count || 1), 0);
  const windowCount = windows.reduce((s, w) => s + (w.count || 1), 0);
  const totalOpeningSf = (openings || []).reduce(
    (s, o) => s + (o.area_sqft || 0) * (o.count || 1), 0
  );

  return {
    gross_wall_sf: grossWallSf,
    ceiling_sf: ceilingSf,
    floor_sf: floorSf,
    garage_sf: garageSf,
    door_count: doorCount,
    window_count: windowCount,
    total_opening_sf: totalOpeningSf,
    confidence: 0.85, // Vision doesn't store per-extraction confidence on rooms
  };
}

/**
 * Extract OCR summary from the latest envelope for a project.
 */
async function getOcrEnvelope(projectId: string, companyId: string): Promise<TakeoffEnvelopeV1 | null> {
  const { data } = await supabaseAdmin
    .from('documents')
    .select('takeoff_envelope')
    .eq('project_id', projectId)
    .eq('company_id', companyId)
    .not('takeoff_envelope', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  return (data?.[0]?.takeoff_envelope as unknown as TakeoffEnvelopeV1) ?? null;
}

/**
 * Compute agreement score from deltas. Higher = more agreement.
 * Uses relative error on non-zero values, averaged.
 */
function computeAgreement(deltas: (number | null)[], references: (number | null)[]): number {
  let totalError = 0;
  let count = 0;

  for (let i = 0; i < deltas.length; i++) {
    const delta = deltas[i];
    const ref = references[i];
    if (delta === null || ref === null || ref === 0) continue;
    totalError += Math.abs(delta) / Math.abs(ref);
    count++;
  }

  if (count === 0) return 0.5; // no data to compare
  const avgError = totalError / count;
  // Clamp: 0% error → 1.0, 100%+ error → 0.0
  return Math.max(0, Math.min(1, 1 - avgError));
}

/**
 * Compute comparison metrics between OCR and Vision for a project.
 * Called after either extraction completes, if both data sources exist.
 *
 * Returns null if only one source is available.
 */
export async function computeComparisonMetrics(
  companyId: string,
  projectId: string,
  currentMode: 'ocr' | 'vision' | 'hybrid',
  currentRunId: string,
): Promise<ComparisonMetrics | null> {
  const [envelope, visionSummary] = await Promise.all([
    getOcrEnvelope(projectId, companyId),
    getVisionSummary(projectId, companyId),
  ]);

  if (!envelope || !visionSummary) return null;

  const ocrSummary = envelope.summary;

  const grossDelta = ocrSummary.gross_sf - visionSummary.gross_wall_sf;
  const ceilingDelta = ocrSummary.estimated_ceiling_sf - visionSummary.ceiling_sf;
  const floorDelta = (ocrSummary.estimated_crawlspace_sf || 0) - visionSummary.floor_sf;
  const garageDelta = (ocrSummary.estimated_garage_ceiling_sf || 0) - visionSummary.garage_sf;
  const doorDelta = ocrSummary.opening_count - visionSummary.door_count - visionSummary.window_count;
  const openingSfDelta = ocrSummary.opening_area_sf - visionSummary.total_opening_sf;

  // Find the other run (if any)
  const otherMode = currentMode === 'vision' ? 'ocr' : 'vision';
  const { data: otherRuns } = await supabaseAdmin
    .from('extraction_runs')
    .select('id')
    .eq('company_id', companyId)
    .eq('project_id', projectId)
    .in('mode', otherMode === 'ocr' ? ['ocr', 'hybrid'] : ['vision'])
    .in('status', ['complete', 'review'])
    .order('created_at', { ascending: false })
    .limit(1);
  const otherRunId = otherRuns?.[0]?.id ?? null;

  const deltas = [grossDelta, ceilingDelta, floorDelta, garageDelta, openingSfDelta];
  const refs = [
    visionSummary.gross_wall_sf,
    visionSummary.ceiling_sf,
    visionSummary.floor_sf,
    visionSummary.garage_sf,
    visionSummary.total_opening_sf,
  ];

  return {
    compared_at: new Date().toISOString(),
    ocr_run_id: currentMode === 'vision' ? otherRunId : currentRunId,
    vision_run_id: currentMode === 'vision' ? currentRunId : otherRunId,
    gross_sf_delta: grossDelta,
    ceiling_sf_delta: ceilingDelta,
    floor_sf_delta: floorDelta,
    garage_sf_delta: garageDelta,
    door_count_delta: doorDelta,
    window_count_delta: null, // OCR doesn't separate door/window counts
    total_opening_sf_delta: openingSfDelta,
    ocr_crawlspace_sf: ocrSummary.estimated_crawlspace_sf || null,
    ocr_rim_joist_lf: ocrSummary.estimated_rim_joist_lf || null,
    ocr_net_sf: ocrSummary.net_sf || null,
    ocr_confidence: envelope.telemetry.overall_confidence,
    vision_confidence: visionSummary.confidence,
    agreement_score: computeAgreement(deltas, refs),
  };
}
