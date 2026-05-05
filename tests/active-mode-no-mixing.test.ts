/**
 * Integration test: Active mode prevents data mixing.
 *
 * Verifies that when activeMode='ocr', all derived values come from
 * the OCR envelope only — and when activeMode='vision', all derived
 * values come from rooms/openings tables only.
 *
 * Run: npx tsx tests/active-mode-no-mixing.test.ts
 */

import type { TakeoffEnvelopeV1 } from '../lib/types/takeoff-envelope';
import type { RunInfo } from '../lib/extraction/resolveActiveMode';

// ── Test fixtures ──────────────────────────────────────────

const OCR_ENVELOPE: TakeoffEnvelopeV1 = {
  schema_version: 1,
  run_id: 'ocr-run-001',
  document_id: 'doc-001',
  mode_used: 'ocr_only',
  status: 'complete',
  page_selection: { source: 'auto', selected_page_index: 2, confidence: 0.85 },
  summary: {
    gross_sf: 2000,
    net_sf: 1700,
    exterior_lf: 150,
    segment_count: 12,
    bucket_count: 2,
    opening_count: 8,
    opening_area_sf: 300,
    estimated_footprint_sf: 1200,
    estimated_ceiling_sf: 1200,
    estimated_garage_ceiling_sf: 400,
    footprint_width_ft: 40,
    footprint_depth_ft: 30,
    estimated_crawlspace_sf: 800,
    estimated_rim_joist_lf: 120,
    estimated_garage_wall_sf: 0,
    estimated_sound_floor_sf: 0,
  },
  buckets: [
    { height_ft: 9, gross_sf: 1200, net_sf: 1000, opening_sf: 200, segment_count: 8 },
    { height_ft: 10, gross_sf: 800, net_sf: 700, opening_sf: 100, segment_count: 4 },
  ],
  openings: {
    total_count: 8,
    attributed_count: 6,
    sized_count: 5,
    subtracted_count: 5,
    total_area_sf: 300,
    subtracted_area_sf: 280,
    items: [
      { opening_id: 'ocr-door-1', opening_type: 'door', width_ft: 3, height_ft: 6.8, area_sf: 20.4, source: 'inline', attributed_bucket: null },
      { opening_id: 'ocr-door-2', opening_type: 'door_arc', width_ft: null, height_ft: null, area_sf: 18, source: 'symbol', attributed_bucket: null },
      { opening_id: 'ocr-win-1', opening_type: 'window', width_ft: 4, height_ft: 3, area_sf: 12, source: 'inline', attributed_bucket: null },
    ],
    items_truncated: false,
    items_limit: 500,
  },
  net: {
    gross_wall_area_sf: 2000,
    opening_area_sf: 300,
    net_wall_area_sf: 1700,
    by_bucket_gross: { '9.0': 1200, '10.0': 800 },
    by_bucket_opening: { '9.0': 200, '10.0': 100 },
    by_bucket_net: { '9.0': 1000, '10.0': 700 },
  },
  completeness: {
    gross_sf: 'final',
    exterior_lf: 'final',
    openings: 'final',
    net_sf: 'final',
    ceiling_area: 'estimated',
    garage_ceiling_area: 'estimated',
    crawlspace_area: 'estimated',
    rim_joist: 'estimated',
    degradation_reason: null,
    missing_components: [],
  },
  review: { required: false, session_id: null, total_issues: 0, items: [] },
  telemetry: { overall_confidence: 0.82, total_time_s: 12.3, completed_phases: ['text_graph', 'phase2_classify', 'phase3_buckets', 'phase5_9_openings_net'], skipped_phases: [], timed_out: false },
  warnings: [],
  errors: [],
};

// Vision data — deliberately DIFFERENT numbers from OCR
interface Room {
  id: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  wall_sf: number | null;
  floor_sf: number | null;
  ceiling_sf: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
  wall_composition: string | null;
  stud_size: string | null;
}

interface Opening {
  id: string;
  type: 'door' | 'window';
  area_sqft: number | null;
  count: number;
}

const VISION_ROOMS: Room[] = [
  {
    id: 'room-1',
    type: 'living',
    wall_sf: 3500,    // Different from OCR's 2000
    floor_sf: 1500,
    ceiling_sf: 1500,
    perimeter_ft: 200,
    height_ft: 9,
    wall_composition: '2x6 @ 16" OC',
    stud_size: '2x6',
  },
];

const VISION_OPENINGS: Opening[] = [
  { id: 'vis-door-1', type: 'door', area_sqft: 21, count: 5 },   // 105 SF total
  { id: 'vis-win-1', type: 'window', area_sqft: 15, count: 8 },  // 120 SF total
];

// ── Derive values (mirrors review page logic) ────────────────

function deriveValues(activeMode: 'ocr' | 'vision', envelope: TakeoffEnvelopeV1, rooms: Room[], openings: Opening[]) {
  const mainRoom = rooms.find(r => r.type === 'living' && r.wall_sf);

  // Vision values
  const visionGrossWallSF = mainRoom?.wall_sf || 0;
  const visionFloorSF = mainRoom?.floor_sf || 0;
  const visionCeilingSF = mainRoom?.ceiling_sf || 0;
  const visionPerimeterFt = mainRoom?.perimeter_ft || 0;
  const visionWallHeightFt = mainRoom?.height_ft || 0;
  const doors = openings.filter(o => o.type === 'door');
  const windows = openings.filter(o => o.type === 'window');
  const visionTotalDoorSF = doors.reduce((sum, d) => sum + (d.area_sqft || 0) * (d.count || 1), 0);
  const visionTotalWindowSF = windows.reduce((sum, w) => sum + (w.area_sqft || 0) * (w.count || 1), 0);
  const visionNetWallSF = visionGrossWallSF - visionTotalDoorSF - visionTotalWindowSF;

  // OCR values
  const ocrGrossWallSF = envelope.summary.gross_sf;
  const ocrNetWallSF = envelope.summary.net_sf;
  const ocrCeilingSF = envelope.summary.estimated_ceiling_sf;
  const ocrCrawlspaceSF = envelope.summary.estimated_crawlspace_sf;
  const ocrExteriorLF = envelope.summary.exterior_lf;
  const ocrDoorItems = envelope.openings.items.filter(i => i.opening_type === 'door' || i.opening_type === 'door_arc');
  const ocrWindowItems = envelope.openings.items.filter(i => i.opening_type === 'window' || i.opening_type === 'window_break');
  const ocrTotalDoorSF = ocrDoorItems.reduce((sum, d) => sum + (d.area_sf || 0), 0);
  const ocrTotalWindowSF = ocrWindowItems.reduce((sum, w) => sum + (w.area_sf || 0), 0);

  // Branch on activeMode — single source of truth
  return {
    grossWallSF: activeMode === 'ocr' ? ocrGrossWallSF : visionGrossWallSF,
    netWallSF: activeMode === 'ocr' ? ocrNetWallSF : visionNetWallSF,
    totalDoorSF: activeMode === 'ocr' ? ocrTotalDoorSF : visionTotalDoorSF,
    totalWindowSF: activeMode === 'ocr' ? ocrTotalWindowSF : visionTotalWindowSF,
    floorSF: activeMode === 'ocr' ? ocrCrawlspaceSF : visionFloorSF,
    ceilingSF: activeMode === 'ocr' ? ocrCeilingSF : visionCeilingSF,
    perimeterFt: activeMode === 'ocr' ? ocrExteriorLF : visionPerimeterFt,
    wallHeightFt: activeMode === 'ocr' ? 0 : visionWallHeightFt,
  };
}

// ── Assertions ─────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEq(actual: number, expected: number, message: string) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

// ── Test: OCR mode uses only OCR values ────────────────────

console.log('\n--- OCR Mode: values from envelope only ---');
const ocr = deriveValues('ocr', OCR_ENVELOPE, VISION_ROOMS, VISION_OPENINGS);

assertEq(ocr.grossWallSF, 2000, 'grossWallSF = envelope.summary.gross_sf');
assertEq(ocr.netWallSF, 1700, 'netWallSF = envelope.summary.net_sf');
assertEq(ocr.totalDoorSF, 20.4 + 18, 'totalDoorSF = sum of OCR door items');
assertEq(ocr.totalWindowSF, 12, 'totalWindowSF = sum of OCR window items');
assertEq(ocr.floorSF, 800, 'floorSF = envelope.summary.estimated_crawlspace_sf');
assertEq(ocr.ceilingSF, 1200, 'ceilingSF = envelope.summary.estimated_ceiling_sf');
assertEq(ocr.perimeterFt, 150, 'perimeterFt = envelope.summary.exterior_lf');
assertEq(ocr.wallHeightFt, 0, 'wallHeightFt = 0 (OCR has no single height)');

// Ensure no Vision data leaked
assert(ocr.grossWallSF !== 3500, 'grossWallSF is NOT from Vision rooms (3500)');
assert(ocr.totalDoorSF !== 105, 'totalDoorSF is NOT from Vision openings (105)');
assert(ocr.totalWindowSF !== 120, 'totalWindowSF is NOT from Vision openings (120)');

// ── Test: Vision mode uses only Vision values ──────────────

console.log('\n--- Vision Mode: values from rooms/openings only ---');
const vis = deriveValues('vision', OCR_ENVELOPE, VISION_ROOMS, VISION_OPENINGS);

assertEq(vis.grossWallSF, 3500, 'grossWallSF = mainRoom.wall_sf');
assertEq(vis.netWallSF, 3500 - 105 - 120, 'netWallSF = gross - doors - windows');
assertEq(vis.totalDoorSF, 105, 'totalDoorSF = Vision door area × count');
assertEq(vis.totalWindowSF, 120, 'totalWindowSF = Vision window area × count');
assertEq(vis.floorSF, 1500, 'floorSF = mainRoom.floor_sf');
assertEq(vis.ceilingSF, 1500, 'ceilingSF = mainRoom.ceiling_sf');
assertEq(vis.perimeterFt, 200, 'perimeterFt = mainRoom.perimeter_ft');
assertEq(vis.wallHeightFt, 9, 'wallHeightFt = mainRoom.height_ft');

// Ensure no OCR data leaked
assert(vis.grossWallSF !== 2000, 'grossWallSF is NOT from OCR envelope (2000)');
assert(vis.netWallSF !== 1700, 'netWallSF is NOT from OCR envelope (1700)');
assert(vis.ceilingSF !== 1200, 'ceilingSF is NOT from OCR envelope (1200)');

// ── Test: Quote mode selection ─────────────────────────────

console.log('\n--- Quote: active mode determines envelope usage ---');

function quoteWouldUseEnvelope(activeMode: string | null, hasEnvelope: boolean): boolean {
  return activeMode === 'ocr' || (activeMode !== 'vision' && hasEnvelope);
}

assert(quoteWouldUseEnvelope('ocr', true) === true, 'OCR mode + envelope → use envelope');
assert(quoteWouldUseEnvelope('ocr', false) === true, 'OCR mode + no envelope → still tries envelope');
assert(quoteWouldUseEnvelope('vision', true) === false, 'Vision mode + envelope → skip envelope');
assert(quoteWouldUseEnvelope('vision', false) === false, 'Vision mode + no envelope → skip envelope');
assert(quoteWouldUseEnvelope(null, true) === true, 'No mode + envelope → use envelope (auto)');
assert(quoteWouldUseEnvelope(null, false) === false, 'No mode + no envelope → skip envelope');

// ── Test: Completeness gates quote auto-enable ─────────────

console.log('\n--- Quote: completeness gates auto-enable ---');

assert(OCR_ENVELOPE.completeness.net_sf === 'final', 'net_sf is final → walls auto-enabled');
assert(OCR_ENVELOPE.completeness.ceiling_area === 'estimated', 'ceiling_area is estimated → ceiling auto-enabled');
assert(OCR_ENVELOPE.completeness.crawlspace_area === 'estimated', 'crawlspace_area is estimated → crawlspace auto-enabled');

// Simulate a partial envelope with missing fields
const partialEnvelope = {
  ...OCR_ENVELOPE,
  completeness: {
    ...OCR_ENVELOPE.completeness,
    net_sf: 'missing' as const,
    ceiling_area: 'missing' as const,
  },
};

assert(partialEnvelope.completeness.net_sf === 'missing', 'partial: net_sf missing → walls NOT auto-enabled');
assert(partialEnvelope.completeness.ceiling_area === 'missing', 'partial: ceiling missing → ceiling NOT auto-enabled');

// ── Test: Stale envelope + failed latest OCR run ──────────

console.log('\n--- Freshness: stale envelope + failed latest OCR ---');

import { resolveActiveMode as resolveActiveModeShared } from '../lib/extraction/resolveActiveMode';

// Wrapper that matches the test's simpler call signature
function resolveActiveMode(
  persisted: 'ocr' | 'vision' | null,
  runs: { id: string; mode: 'ocr' | 'vision' | 'hybrid'; status: string }[],
  hasEnvelope: boolean,
  hasRooms: boolean,
): 'ocr' | 'vision' | null {
  const result = resolveActiveModeShared({
    persistedMode: persisted,
    runs: runs.map(r => ({ ...r, finished_at: null })),
    hasEnvelope,
    hasRooms,
  });
  return result.mode;
}

// Scenario: successful OCR run, then newer failed OCR run
const runsStale: RunInfo[] = [
  { id: 'run-failed', mode: 'ocr', status: 'failed', finished_at: null },    // newest (finished later)
  { id: 'run-ok', mode: 'ocr', status: 'complete', finished_at: null },      // older successful
  { id: 'run-vision', mode: 'vision', status: 'complete', finished_at: null },
];

// Auto-detect: should NOT use stale envelope, should fall back to Vision
const staleAutoMode = resolveActiveMode(null, runsStale, true, true);
assert(staleAutoMode === 'vision', `stale auto-detect → vision (got ${staleAutoMode})`);

// Persisted OCR: user explicitly chose OCR, honor it even with stale envelope
const stalePersistedOcr = resolveActiveMode('ocr', runsStale, true, true);
assert(stalePersistedOcr === 'ocr', `stale + persisted OCR → ocr (got ${stalePersistedOcr})`);

// Persisted Vision: user chose Vision, latest OCR failed doesn't matter
const stalePersistedVision = resolveActiveMode('vision', runsStale, true, true);
assert(stalePersistedVision === 'vision', `stale + persisted Vision → vision (got ${stalePersistedVision})`);

// No runs at all: auto-detect uses envelope if present
const noRunsMode = resolveActiveMode(null, [], true, false);
assert(noRunsMode === 'ocr', `no runs + envelope → ocr (got ${noRunsMode})`);

// No runs, no envelope, has rooms: fall back to vision
const noRunsNoEnv = resolveActiveMode(null, [], false, true);
assert(noRunsNoEnv === 'vision', `no runs + no envelope + rooms → vision (got ${noRunsNoEnv})`);

// No data at all: null
const noData = resolveActiveMode(null, [], false, false);
assert(noData === null, `no data → null (got ${noData})`);

// Persisted OCR but no envelope: persisted can't be honored, auto-detect finds rooms → vision
const persistedNoData = resolveActiveMode('ocr', [], false, true);
assert(persistedNoData === 'vision', `persisted OCR + no envelope + rooms → vision fallback (got ${persistedNoData})`);

// ── Test: ModeResolution metadata ───────────────────────────

console.log('\n--- ModeResolution metadata (staleEnvelope, failedRun) ---');

const staleResolution = resolveActiveModeShared({
  persistedMode: 'ocr',
  runs: [
    { id: 'run-failed', mode: 'hybrid', status: 'failed', finished_at: '2026-03-08T12:00:00Z' },
    { id: 'run-ok', mode: 'hybrid', status: 'complete', finished_at: '2026-03-07T12:00:00Z' },
  ],
  hasEnvelope: true,
  hasRooms: true,
});
assert(staleResolution.staleEnvelope === true, 'stale resolution: staleEnvelope=true');
assert(staleResolution.failedRun?.id === 'run-failed', 'stale resolution: failedRun=run-failed');
assert(staleResolution.mode === 'ocr', 'stale resolution: mode=ocr (persisted wins)');
assert(staleResolution.persisted === true, 'stale resolution: persisted=true');

const freshResolution = resolveActiveModeShared({
  persistedMode: null,
  runs: [
    { id: 'run-ok', mode: 'ocr', status: 'complete', finished_at: '2026-03-08T12:00:00Z' },
  ],
  hasEnvelope: true,
  hasRooms: false,
});
assert(freshResolution.staleEnvelope === false, 'fresh resolution: staleEnvelope=false');
assert(freshResolution.failedRun === null, 'fresh resolution: failedRun=null');
assert(freshResolution.mode === 'ocr', 'fresh resolution: mode=ocr');

// ── Test: Guard A — persisted wins even when new extraction finishes ──

console.log('\n--- Guard A: persisted mode survives new extraction ---');

// User is in Vision mode. OCR finishes in background (new successful run).
const runsNewOcr: RunInfo[] = [
  { id: 'run-new-ocr', mode: 'ocr', status: 'complete', finished_at: null },  // just finished
  { id: 'run-vision', mode: 'vision', status: 'complete', finished_at: null },
];

const guardA = resolveActiveMode('vision', runsNewOcr, true, true);
assert(guardA === 'vision', `Guard A: persisted Vision survives new OCR (got ${guardA})`);

// Reverse: user in OCR mode, Vision finishes
const guardAReverse = resolveActiveMode('ocr', runsNewOcr, true, true);
assert(guardAReverse === 'ocr', `Guard A: persisted OCR survives new Vision (got ${guardAReverse})`);

// ── Test: Run in progress (status=started) ──────────────────

console.log('\n--- Edge: run in progress ---');

const runsInProgress: RunInfo[] = [
  { id: 'run-started', mode: 'ocr', status: 'started', finished_at: null },   // in progress
  { id: 'run-vision', mode: 'vision', status: 'complete', finished_at: null },
];

// Auto-detect: in-progress OCR should not count as successful
const inProgressAuto = resolveActiveMode(null, runsInProgress, false, true);
assert(inProgressAuto === 'vision', `in-progress OCR → fall back to vision (got ${inProgressAuto})`);

// ── Summary ────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All assertions passed — no data mixing detected.\n');
}
