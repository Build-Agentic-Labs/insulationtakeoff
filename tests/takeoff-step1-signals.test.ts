import assert from 'node:assert/strict';
import {
  extractAirBarrierStrings,
  extractBaffleOrVentingStrings,
  extractRoofPitchStrings,
  extractVaporBarrierStrings,
  normalizePageScanExtracts,
} from '../lib/takeoff/scan-extracts';
import {
  buildPageAnalysisFromPageScores,
  getEvidenceRequirementStatuses,
} from '../lib/takeoff/workspace-v2';
import type { PageScanFlags, PageScore } from '../lib/types/takeoff';

function defaultFlags(overrides: Partial<PageScanFlags> = {}): PageScanFlags {
  return {
    sheet_index_revisions_scale: false,
    general_insulation_notes: false,
    wall_type_legend: false,
    exterior_wall_details: false,
    interior_wall_details: false,
    roof_ceiling_details: false,
    roof_pitch: false,
    floor_foundation_details: false,
    enlarged_sections: false,
    insulated_area_plan_views: false,
    dimensions: false,
    height_references: false,
    opening_info: false,
    room_names: false,
    material_specs: false,
    vapor_barrier: false,
    air_barrier: false,
    baffles_or_venting: false,
    symbols_and_keynotes: false,
    alternates_or_conflicts: false,
    ...overrides,
  };
}

const compiledDetailLike = {
  sections: [
    {
      name: 'Section A',
      roof_pitch: 'Roof pitch 7:12',
      notes: ['Vaulted ceiling slope is 7 in 12'],
    },
  ],
  wall_sections: [
    {
      name: 'Exterior wall',
      insulation_spec: 'R-21 kraft-faced batt insulation',
      notes: 'Install class II vapor retarder at warm side.',
    },
  ],
  ceiling_insulation: {
    spec: 'R=49 flat ceiling, R=38 vaults with attic baffles at soffit vents.',
  },
  general_notes: [
    'Continuous air barrier and air sealing required at envelope penetrations.',
    'Provide ridge vent and vent chutes where insulation meets roof deck.',
  ],
};

assert.deepEqual(extractRoofPitchStrings(compiledDetailLike), ['7/12']);
assert.equal(extractVaporBarrierStrings(compiledDetailLike).length > 0, true);
assert.equal(extractAirBarrierStrings(compiledDetailLike).length > 0, true);
assert.equal(extractBaffleOrVentingStrings(compiledDetailLike).length > 0, true);
assert.deepEqual(extractRoofPitchStrings('Revised rows 1, 2, 3, 4, 5, 6'), []);

assert.deepEqual(normalizePageScanExtracts({ r_values: ['R-21'] }), {
  window_sizes: [],
  opening_quantity_notes: [],
  insulation_types: [],
  r_values: ['R-21'],
  roof_pitches: [],
  vapor_barriers: [],
  air_barriers: [],
  baffles_or_venting: [],
  wall_framing: [],
  zone_hints: undefined,
});
assert.deepEqual(normalizePageScanExtracts({ r_values: ['R-0', 'R-21'] }).r_values, ['R-21']);

const pageScores: PageScore[] = [
  {
    page_index: 0,
    score: 0.96,
    label: 'Building Sections',
    ai_selected: true,
    page_type: 'section',
    roles: ['evidence'],
    ai_roles: ['evidence'],
    scan_flags: defaultFlags({
      roof_ceiling_details: true,
      roof_pitch: true,
      vapor_barrier: true,
      air_barrier: true,
    }),
    scan_extracts: normalizePageScanExtracts({
      r_values: ['R-38', 'R-49'],
      insulation_types: ['kraft-faced batt insulation'],
      roof_pitches: ['7/12'],
      vapor_barriers: ['class II vapor retarder at warm side'],
      air_barriers: ['continuous air barrier'],
      baffles_or_venting: ['attic baffles at soffit vents'],
    }),
    scan_notes: [],
  },
];

const pageAnalysis = buildPageAnalysisFromPageScores({
  totalPages: 1,
  pageScores,
});

const capabilities = new Map(
  pageAnalysis[0].capabilities.map((capability) => [capability.capability, capability.score]),
);

assert.equal((capabilities.get('roof_pitch') ?? 0) >= 0.9, true);
assert.equal((capabilities.get('vapor_barrier') ?? 0) >= 0.9, true);
assert.equal((capabilities.get('air_barrier') ?? 0) >= 0.9, true);

const evidenceStatuses = getEvidenceRequirementStatuses(pageAnalysis);
assert.equal(
  evidenceStatuses.find((status) => status.requirement === 'roof_pitch_reference')?.satisfied,
  true,
);
assert.equal(
  evidenceStatuses.find((status) => status.requirement === 'vapor_barrier_reference')?.satisfied,
  true,
);

console.log('takeoff-step1-signals eval passed');
