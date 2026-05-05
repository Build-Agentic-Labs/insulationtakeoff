import assert from 'node:assert/strict';
import {
  buildQuoteLineItemFromEstimateRow,
  calculateQuoteTotals,
  normalizeQuoteLineItems,
  parseRValueNumber,
  sanitizeEstimateRows,
} from '../lib/quotes/estimate';
import { buildWorkspaceSummaryFromSession } from '../lib/takeoff/workspace-v2';
import type { TakeoffSession } from '../lib/types/takeoff';

const now = new Date('2026-04-29T12:00:00Z').toISOString();

function baseSession(overrides: Partial<TakeoffSession> = {}): TakeoffSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    documentId: 'document-1',
    status: 'tracing',
    measurementBasis: 'exterior_face',
    selectedPages: [0],
    calibrations: {
      0: {
        primary: {
          pointA: { x: 0, y: 0 },
          pointB: { x: 100, y: 0 },
          pdfDistance: 100,
          knownValueFt: 10,
          timestamp: now,
        },
        pdfPointsPerFoot: 10,
        confidence: 'high',
        pageIndex: 0,
        history: [{ pdfPointsPerFoot: 10, timestamp: now, reason: 'test' }],
      },
    },
    traces: [
      {
        id: 'wall-1',
        pageIndex: 0,
        type: 'linear',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        isClosed: false,
        isLocked: false,
        label: 'Wall 1',
      },
    ],
    classifications: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const missingHeightSummary = buildWorkspaceSummaryFromSession(
  baseSession({
    classifications: [
      {
        traceId: 'wall-1',
        segmentIndex: 0,
        label: 'Exterior',
        assemblyScope: 'exterior_wall_2x6',
        wallHeightFt: undefined,
        openings: [],
        installMethod: 'batt_kraft',
        notes: [],
      },
    ],
  }),
);

assert.equal(missingHeightSummary?.totals.netSf, 0, 'wall segments without verified height are not priced with a hidden default');
assert.equal(missingHeightSummary?.areas.length, 0, 'missing-height wall segments do not seed quote rows');

const verifiedHeightSummary = buildWorkspaceSummaryFromSession(
  baseSession({
    classifications: [
      {
        traceId: 'wall-1',
        segmentIndex: 0,
        label: 'Exterior',
        assemblyScope: 'exterior_wall_2x6',
        wallHeightFt: 8,
        openings: [],
        installMethod: 'batt_kraft',
        notes: [],
      },
    ],
  }),
);

assert.equal(verifiedHeightSummary?.totals.netSf, 80, 'verified wall height drives wall square footage');
assert.equal(verifiedHeightSummary?.areas[0]?.sqft, 80, 'workspace summary exposes verified wall SF');

const rows = sanitizeEstimateRows([
  {
    id: 'summary:rim_joist',
    group: 'Specialty',
    label: 'Rim Joist Insulation',
    quantity: 120,
    unit: 'LF',
    spec: 'R-21 closed-cell spray foam',
    note: 'Verified from takeoff',
    source: 'takeoff',
    enabled: true,
  },
]);

assert.equal(rows[0].unit, 'LF', 'worksheet persistence preserves LF unit');
assert.equal(parseRValueNumber(rows[0].spec), 21, 'R-value is parsed from estimator spec');

const lineItem = buildQuoteLineItemFromEstimateRow(rows[0], 2.5);
assert.equal(lineItem.unit, 'LF', 'quote line item keeps LF unit');
assert.equal(lineItem.quantity, 120, 'quote line item keeps original quantity');
assert.equal(lineItem.totalCost, 300, 'quote line item total uses quantity times unit price');

const normalized = normalizeQuoteLineItems([
  lineItem,
  {
    id: 'summary:attic_ceiling',
    area: 'Attic Ceiling',
    quantity: 1000,
    unit: 'SF',
    pricePerUnit: 1.25,
    totalCost: 1,
  },
]);
const totals = calculateQuoteTotals(normalized, 25);

assert.equal(totals.totalLf, 120, 'totals keep LF separate from SF');
assert.equal(totals.totalSf, 1000, 'totals keep SF separate from LF');
assert.equal(totals.quantityLabel, '1,000 SF / 120 LF', 'quantity label displays mixed units');
assert.equal(totals.subtotal, 1550, 'server-side totals recompute from line items');
assert.equal(totals.totalCost, 1575, 'server-side totals include tax');

console.log('quote-workflow eval passed');
