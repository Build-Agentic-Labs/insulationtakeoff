# Calibrated Digital Takeoff — Implementation Spec (v2)

**Date:** March 26, 2026
**Status:** Approved for implementation
**Replaces:** UI-guided crop-and-OCR approach
**Revision:** v2 — incorporates review feedback (tiered calibration, itemized openings, measurement basis, computed-not-stored SF, expanded validation)

---

## Overview

Interactive takeoff where the user calibrates scale, traces wall perimeters, and the system calculates square footage from calibrated geometry. OCR is a helper, not the source of truth. All measurements are derived from PDF-space coordinates × calibrated scale factor.

---

## Business Goal: Residential Insulation Takeoff

The system produces a complete insulation takeoff for residential new construction. This covers **all insulation scopes** a contractor needs to quote, not just exterior walls.

### Insulation Scopes

| Scope | Measurement Type | Blueprint Source | Spec Example |
|-------|-----------------|-----------------|--------------|
| **Exterior Walls** | Linear trace × height = SF | Floor plan perimeter | R-21×15 Kraft Batt + Poly |
| **Garage Walls** (shared with conditioned space) | Linear trace × height = SF | Floor plan - garage perimeter | R-19×15 Kraft Batt + Poly |
| **Basement/Foundation Walls** | Linear trace × height = SF | Foundation plan or basement plan | R-19 Unfaced or Rigid Foam |
| **Attic/Ceiling Blow** | Area trace = SF | Floor plan footprint (top floor) | R-49 Blown Fiberglass/Cellulose |
| **Crawlspace Floor** | Area trace = SF | Foundation plan or floor plan | R-38×16 Unfaced Batt |
| **Garage Ceiling** (above conditioned space) | Area trace = SF | Floor plan - garage area | R-19 Blown or Batt |
| **Sound Floor** (between floors) | Area trace = SF | Floor plan - second floor area | R-19×15 Unfaced Batt |
| **Rim Joist / Band Board** | Linear trace × depth = SF | Floor plan perimeter | R-19 Batt or Spray Foam |
| **Knee Walls** | Linear trace × height = SF | Attic/roof section | R-21 Batt |
| **Cantilever Floors** | Area trace = SF | Floor plan - cantilever area | R-19 Batt |
| **Cathedral Ceiling** | Area trace = SF | Roof/ceiling plan | R-38 Dense Pack or Spray Foam |

### Measurement Modes Required

The system needs **two measurement modes** to cover all scopes:

1. **Linear mode** (walls, rim joist) — click-to-trace perimeter × height = SF
2. **Area mode** (attic, crawlspace, floors, ceilings) — click-to-trace polygon = SF (area computed from polygon vertices using the shoelace formula)

### Wall Types & Heights

Each traced wall segment needs classification:

| Wall Type | Typical Height | Insulation Spec |
|-----------|---------------|-----------------|
| Exterior 2×6 | 8', 9', 10', custom | R-21 Batt + Poly |
| Exterior 2×4 | 8', 9', 10' | R-13 or R-15 Batt |
| Garage (shared wall) | 8', 9', 10' | R-19 Batt + Poly |
| Basement | 8', 9' | R-19 or Rigid Foam |
| Knee Wall | 3'-6", 4', custom | R-21 Batt |

### Insulation Products

The quote system needs to know the product to price it. Common residential products:

| Product | Application | Unit |
|---------|------------|------|
| R-13×15 Kraft Batt | 2×4 walls | SF |
| R-15×15 Kraft Batt | 2×4 walls (higher R) | SF |
| R-19×15 Kraft Batt | Garage walls, floors | SF |
| R-21×15 Kraft Batt | 2×6 exterior walls | SF |
| R-38×16 Unfaced Batt | Crawlspace floors | SF |
| R-49 Blown (fiberglass) | Attic ceilings | SF |
| R-19 Blown (fiberglass) | Garage ceilings | SF |
| 6-mil Poly Vapor Barrier | Over exterior wall batts | SF (same as wall SF) |
| Spray Foam (open cell) | Rim joist, cathedral, custom | SF or Board Feet |
| Spray Foam (closed cell) | Foundation, rim joist | SF or Board Feet |
| Rigid Foam Board | Foundation exterior | SF |

### What the Gold Takeoff Looks Like (Gamache)

| Line Item | SF | Height | Spec |
|-----------|-----|--------|------|
| Ext Walls 9' | 1,872 | 9' | R-21×15+Poly |
| Ext Walls 10' | 2,650 | 10' | R-21×15+Poly |
| Garage Walls | 654 | 8' | R-19×15+Poly |
| Attic Blow | 3,576 | — | R-49 |
| Crawlspace | 1,187 | — | R-38×16 |
| Garage Ceiling | 1,588 | — | R-19 Blown |
| Sound Floor | 2,490 | — | R-19×15 |
| **Subtotal** | | | **$18,386** |

### Implications for the UI

1. **The tool selector needs both Linear and Area modes** — not just wall tracing
2. **Each traced item needs a "scope" classification** — exterior wall, attic, crawlspace, etc.
3. **Area traces need polygon area calculation** (shoelace formula), not just perimeter
4. **The summary must group by insulation line item**, matching the quote structure
5. **Product/spec assignment per scope** — either manual selection or auto from scope defaults
6. **Some scopes come from different pages** — attic from the floor plan footprint, crawlspace from the foundation plan

### What's In Scope for v1

| Scope | v1? | Notes |
|-------|-----|-------|
| Exterior walls (linear) | **Yes** | Core use case |
| Garage walls (linear) | **Yes** | Same tool, different classification |
| Basement walls (linear) | **Yes** | Same tool, different page |
| Attic blow (area) | **Phase 2** | Needs area mode |
| Crawlspace (area) | **Phase 2** | Needs area mode + foundation page |
| Garage ceiling (area) | **Phase 2** | Needs area mode |
| Sound floor (area) | **Phase 2** | Needs area mode |
| Rim joist (linear) | **Phase 2** | Same tool, small scope |
| Knee walls, cathedral, cantilever | **Phase 3** | Less common |

---

## Key Design Principles

1. **Calibration is a system, not a single step** — calibrate, verify, score confidence, allow recalibration, preserve audit trail
2. **Geometry is the source of truth** — wall lengths come from traced coordinates × scale factor, not OCR
3. **Derived values are computed, not stored** — `gross_sf`, `net_sf`, `length_ft` are always recomputed from geometry + metadata. Only geometry + classification + openings are canonical
4. **PDF-space coordinates** — all stored coordinates use PDF points (72 DPI), independent of zoom/render resolution
5. **OCR is a helper** — suggests dimension values and opening counts, never overrides user input

---

## Measurement Basis

Before tracing, the user selects what they are measuring. This is a session-level setting displayed prominently.

```
measurement_basis: 'exterior_face' | 'stud_line' | 'centerline' | 'sheathing_line'
```

**Default:** `exterior_face` (most common for insulation takeoff — measures the outside of the building envelope)

**UI:** Dropdown in the workspace header, with tooltip explaining each option:
- **Exterior face** — outside of sheathing/siding. Standard for insulation batt/blown.
- **Stud line** — face of framing. Used for spray foam or when framing dimensions are given.
- **Centerline** — wall centerline. Used when plans dimension to centerlines.
- **Sheathing line** — outside of sheathing, inside of siding.

This setting is stored on the session and displayed on the summary/quote.

---

## User Flow

### Step 1: Upload & Page Selection (existing)
- AI classifies pages → auto-selects floor plans
- User confirms page selection
- **No changes needed**

### Step 2: Scale Calibration (NEW — tiered)

#### Primary calibration (required)
1. Prompt: "Click two endpoints on a dimension you can read"
2. User clicks point A on one end of a dimension line
3. User clicks point B on the other end
4. Blue line drawn between A and B with distance in PDF-points shown
5. Input field: "What is this dimension?" — accepts: `14`, `14'`, `14'-0"`, `14.5`, `14'-6"`
6. System computes: `pdfPointsPerFoot = pdfDistance / feetValue`
7. Banner: "Primary calibration set ✓"

#### Verification calibration (recommended)
8. Prompt: "For best accuracy, verify with a second dimension (preferably far from the first)"
9. User clicks two more points on a different dimension
10. System computes a second `pdfPointsPerFoot`
11. **Variance check:**
    - If within ±1%: "High confidence ✓ — calibrations agree"
    - If 1-3%: "Good confidence — slight variance detected (X%)"
    - If >3%: "⚠ Warning — calibrations differ by X%. Page may be distorted, or one measurement may be off. Consider recalibrating."
12. System uses the average of both calibrations

#### Calibration data model
```typescript
interface Calibration {
  primary: {
    pointA: PdfPoint;          // { x, y } in PDF-space
    pointB: PdfPoint;
    pdfDistance: number;        // Distance in PDF points
    knownValueFt: number;      // User-entered value in feet
    dimensionText?: string;    // What the user read (e.g., "14'-0\"")
    timestamp: string;
  };
  verification?: {
    pointA: PdfPoint;
    pointB: PdfPoint;
    pdfDistance: number;
    knownValueFt: number;
    dimensionText?: string;
    timestamp: string;
  };
  pdfPointsPerFoot: number;    // Final computed value (average if verified)
  confidence: 'high' | 'good' | 'low';
  variancePercent?: number;
  pageIndex: number;
  history: Array<{             // Audit trail — previous calibrations
    pdfPointsPerFoot: number;
    timestamp: string;
    reason: string;            // "initial", "recalibrated", "verification"
  }>;
}
```

### Step 3: Wall Tracing (NEW)

#### Drawing mode
1. Toolbar: Pointer | Calibrate | Trace Wall | Zoom
2. Select "Trace Wall" → cursor becomes crosshair
3. Click to place first point on exterior wall corner
4. Click successive points along the wall perimeter
5. Each segment shows live calibrated length label (e.g., "24'-6"")
6. Lines drawn in blue with vertex dots, confirmed traces in green
7. Double-click or press Enter to finish a trace
8. User can trace multiple separate runs (main house, garage, etc.)

#### Editing operations
- **Move vertex:** click and drag an existing point
- **Insert point:** click on a segment midpoint to split it
- **Delete point:** select point → Backspace (merges adjacent segments)
- **Delete segment:** select → Delete key
- **Undo/redo:** Ctrl+Z / Ctrl+Shift+Z (point-level undo stack)
- **Lock trace:** after review, lock to prevent accidental edits
- **Unlock trace:** explicitly unlock to re-edit

#### Right panel: Segment list
For each segment in the active trace:
- Auto-label: "Wall 1", "Wall 2", ... (editable)
- Computed length (LF) — always derived from geometry × calibration
- Wall type dropdown: Exterior | Garage | Basement | Other
- Wall height: 8' | 9' | 10' | Custom (quick-pick + input)
- Openings summary: "2 doors, 1 window" (click to edit)
- Computed gross SF, net SF (derived, not editable)

#### Group operations
- Select multiple segments → batch assign wall type + height
- "Select all in trace" shortcut

### Step 4: Openings (itemized)

Per segment, the user adds opening items (not just counts):

```typescript
interface Opening {
  id: string;
  type: 'door' | 'window' | 'garage_door' | 'sliding_door';
  width_ft: number;           // Default: 3.0 for door, 3.0 for window
  height_ft: number;          // Default: 6.67 for door, 4.0 for window
  quantity: number;           // Default: 1
  area_sf: number;            // Computed: width × height × quantity
  label?: string;             // Optional: "Front Entry", "Kitchen Window"
}
```

**Default presets:**
| Type | Width | Height | Area |
|------|-------|--------|------|
| Standard door | 3'-0" | 6'-8" | 20.0 SF |
| Sliding door | 6'-0" | 6'-8" | 40.0 SF |
| Garage door | 16'-0" | 7'-0" | 112.0 SF |
| Standard window | 3'-0" | 4'-0" | 12.0 SF |
| Large window | 5'-0" | 4'-0" | 20.0 SF |

**UI:** Click "Add opening" on a segment → dropdown of presets → quantity picker → custom size override if needed.

**Summary shows both:** gross SF AND opening deductions separately (not blindly netted).

### Step 5: Summary & Quote

Confirmed segments grouped by wall type + height:

```
EXTERIOR WALLS — 9' HEIGHT
  Wall 1: 24'-6" × 9' = 220.5 gross SF - 32 opening SF = 188.5 net SF
  Wall 3: 14'-0" × 9' = 126.0 gross SF - 20 opening SF = 106.0 net SF
  Subtotal: 38'-6" LF, 346.5 gross SF, 294.5 net SF

EXTERIOR WALLS — 10' HEIGHT
  Wall 2: 32'-0" × 10' = 320.0 gross SF - 0 opening SF = 320.0 net SF
  ...

GARAGE WALLS — 8' HEIGHT
  ...

TOTALS
  Measurement basis: Exterior face
  Calibration confidence: High (±0.4% variance)
  Total gross SF: X,XXX
  Total opening deductions: XXX
  Total net SF: X,XXX
```

"Generate Quote →" feeds confirmed data to the assembly → installation items → pricing layers below.

---

## Four-Layer Architecture

The system is not just a measuring tool. It produces contractor-ready insulation bids.

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: MEASUREMENT                                │
│  Calibration, linear traces, area traces, openings   │
│  Output: geometry + classified segments              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Layer 2: ASSEMBLY CLASSIFICATION                    │
│  Maps geometry to building scopes                    │
│  (ext wall, garage wall, attic floor, crawl, etc.)   │
│  Output: assembly scopes with SF/LF quantities       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Layer 3: INSTALLATION LINE ITEMS                    │
│  Converts assemblies to quoteable rows               │
│  Includes: insulation field + accessories            │
│  (poly, baffles, foam/caulk, groundcover, etc.)      │
│  Output: line items with qty, unit, product           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Layer 4: PRICING                                    │
│  Unit price, labor piece rate, burden, margin         │
│  Output: contractor-ready bid with cost + profit      │
└─────────────────────────────────────────────────────┘
```

### Layer 2: Assembly Classification

Each traced segment or area is classified into a building assembly scope:

```typescript
type AssemblyScope =
  | 'exterior_wall_2x6'
  | 'exterior_wall_2x4'
  | 'garage_wall'
  | 'basement_wall'
  | 'knee_wall'
  | 'attic_floor'
  | 'crawlspace_floor'
  | 'garage_ceiling'
  | 'sound_floor'
  | 'rim_joist'
  | 'cathedral_ceiling'
  | 'cantilever_floor'
  | 'duct_wrap_zone'
  | 'groundcover_zone';

interface AssemblyItem {
  id: string;
  scope: AssemblyScope;
  source_trace_id: string;
  source_segment_indexes: number[];  // Which segments contribute
  measurement_type: 'linear' | 'area';
  quantity_sf: number;               // Derived from geometry
  quantity_lf?: number;              // For linear scopes
  wall_height_ft?: number;           // For wall scopes
  install_method: InstallMethod;
  notes: string[];                   // Field risk notes, special conditions
}

type InstallMethod =
  | 'batt_kraft'
  | 'batt_unfaced'
  | 'blown_fiberglass'
  | 'blown_cellulose'
  | 'spray_foam_open'
  | 'spray_foam_closed'
  | 'rigid_board'
  | 'dense_pack';
```

### Layer 3: Installation Line Items

Assemblies generate installation line items — both the insulation itself and required accessories:

```typescript
interface InstallationItem {
  id: string;
  scope_type:
    | 'insulation_field'     // The insulation body
    | 'vapor_barrier'        // Poly
    | 'ventilation_prep'     // Baffles / rafter vents
    | 'air_sealing'          // Foam & caulk
    | 'support_system'       // Insulation supports, netting
    | 'ground_cover'         // Crawlspace poly
    | 'foam_board'           // Headers, rim joist rigid
    | 'duct_wrap'            // Duct insulation
    | 'access_cover'         // Attic hatch cover
    | 'custom';
  source_assembly_id: string;
  product_spec: string;              // e.g., "R-21×15 Kraft"
  quantity: number;
  unit: 'SF' | 'LF' | 'EA' | 'BF' | 'LOT';
  note?: string;
}
```

**Generation rules (examples):**

| Assembly | Generates | Rule |
|----------|-----------|------|
| Exterior wall 2×6 | R-21 Batt (SF) + 6-mil Poly (SF) | Poly SF = wall SF |
| Attic floor | R-49 Blown (SF) + Baffles (EA) | Baffles = eave LF ÷ 14.5" bay spacing |
| Crawlspace floor | R-38 Batt (SF) + Supports (SF) + Groundcover (SF) | Groundcover = crawl area |
| Rim joist | Closed-cell spray foam (BF) or R-19 batt (LF) | BF = LF × joist depth × thickness |
| Garage ceiling | R-19 Blown (SF) | 1:1 from area trace |
| Any wall scope | Foam & caulk (LOT or EA) | Per penetration count or LOT |

### Layer 4: Pricing

```typescript
interface QuoteLineItem {
  installation_item_id: string;
  description: string;              // "R-21×15 Kraft Batt + Poly — Ext Walls 9'"
  quantity: number;
  unit: string;
  material_unit_price: number;
  labor_unit_price: number;
  material_total: number;            // Derived
  labor_total: number;               // Derived
  burden_pct: number;                // Payroll burden %
  overhead_pct: number;
  profit_pct: number;
  line_total: number;                // Derived
}
```

This matches the Gamache workbook structure: insulation body + accessories → pricing with material, labor, burden, cost, and profit columns.

### Assembly/Spec Configuration

Not hardcoded. Stored as contractor-level defaults:

```typescript
interface ContractorConfig {
  jurisdiction: string;              // "WA" — affects code requirements
  climate_zone: number;              // 4-5 for Pacific NW
  code_year: string;                 // "2021 IECC"
  default_specs: Record<AssemblyScope, {
    install_method: InstallMethod;
    product_spec: string;
    accessories: string[];           // Auto-generated items
  }>;
}
```

This keeps the takeoff reusable when a contractor changes brands, local specs, or code packages.

---

## Data Model

### Canonical (stored) vs. Derived (computed)

| Field | Canonical? | Notes |
|-------|-----------|-------|
| Point coordinates (PDF-space) | **Yes** | Source of truth for geometry |
| Calibration data | **Yes** | Scale factor + audit trail |
| Wall type per segment | **Yes** | User classification |
| Wall height per segment | **Yes** | User input |
| Openings per segment | **Yes** | User-entered items |
| Measurement basis | **Yes** | Session-level setting |
| `length_ft` | **Derived** | `pdfDistance(pointA, pointB) / pdfPointsPerFoot` |
| `gross_sf` | **Derived** | `length_ft × wall_height_ft` |
| `openings_sf` | **Derived** | `sum(opening.area_sf)` |
| `net_sf` | **Derived** | `gross_sf - openings_sf` |

**Rule:** When any input changes (geometry, calibration, height, openings), all derived values recompute automatically. Never read stale cached values.

### Store Types

```typescript
type PdfPoint = { x: number; y: number }; // PDF-space (72 DPI points)

type MeasurementBasis = 'exterior_face' | 'stud_line' | 'centerline' | 'sheathing_line';

// ── Unified Geometry ──────────────────────────────────────────────────────

// Both linear and area traces share a common base.
// Linear: points form a polyline (or closed polygon for perimeter).
//         Each segment (points[i] → points[i+1]) has independent classification.
// Area:   points form a closed polygon. Area computed via shoelace formula.
//         The entire trace has one classification (no per-segment split).

interface Trace {
  id: string;
  page_index: number;
  type: 'linear' | 'area';
  points: PdfPoint[];
  is_closed: boolean;            // Linear: true if perimeter loop. Area: always true.
  is_locked: boolean;
  label: string;                 // User-editable name: "Main House Perimeter", "Attic Area"
}

// ── Classification (general, not wall-specific) ───────────────────────────

// For linear traces: one classification per segment (points[i] → points[i+1])
// For area traces: one classification for the whole trace (segment_index = -1)

interface TraceClassification {
  trace_id: string;
  segment_index: number;         // -1 for area traces (whole-trace classification)
  label: string;                 // "North Wall", "Attic Area", etc.
  assembly_scope: AssemblyScope;
  wall_height_ft?: number;       // For linear/wall scopes only (null for area scopes)
  openings: Opening[];           // For linear/wall scopes only (empty for area)
  install_method: InstallMethod;
  notes: string[];               // Field risk notes, special conditions, QA flags
  manual_override_reason?: string; // If user overrode a generated value, record why
}

// ── Session ───────────────────────────────────────────────────────────────

interface TakeoffSession {
  id: string;
  project_id: string;
  document_id: string;
  status: 'calibrating' | 'tracing' | 'reviewing' | 'completed';
  measurement_basis: MeasurementBasis;
  selected_pages: number[];
  calibrations: Record<number, Calibration>;  // Per-page, keyed by page_index
  traces: Trace[];                             // Unified linear + area
  classifications: TraceClassification[];      // Separate from geometry
  contractor_config_id?: string;               // Link to contractor defaults
}

// ── Source Provenance ─────────────────────────────────────────────────────

// Every generated assembly item and installation item tracks where it came from.

interface SourceProvenance {
  trace_id: string;
  segment_index?: number;        // For linear segments
  page_index: number;
  generation_method: 'user_trace' | 'rule_generated' | 'manual_entry' | 'imported';
  rule_id?: string;              // If rule-generated, which rule
  confidence: 'high' | 'medium' | 'low';
}
```

### Derived Quantities

All quantities are computed, never stored as canonical truth:

```typescript
// For linear traces:
function segmentLength(trace: Trace, i: number, cal: Calibration): number {
  return pdfDistance(trace.points[i], trace.points[i + 1]) / cal.pdfPointsPerFoot;
}

// For area traces (shoelace formula):
function traceArea(trace: Trace, cal: Calibration): number {
  const pts = trace.points;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const areaPdfPoints = Math.abs(sum) / 2;
  return areaPdfPoints / (cal.pdfPointsPerFoot ** 2); // Convert to square feet
}

// Gross SF (walls): segmentLength × wall_height_ft
// Gross SF (area scopes): traceArea directly
// Net SF: gross - sum(opening.area_sf)
```

### Coordinate System

```
PDF Space (72 DPI points) ←→ Canvas Pixels ←→ CSS Pixels

cssToPageCoords(cssX, cssY) → PdfPoint
  - Accounts for: canvas offset, scroll position, zoom scale, DPR
  - Uses pdfjs viewport.convertToPdfPoint() when available

pageCoordsToCss(pdfX, pdfY) → { x, y }
  - Inverse of above

pdfDistance(a: PdfPoint, b: PdfPoint) → number
  - sqrt((b.x - a.x)² + (b.y - a.y)²)

calibratedLength(a: PdfPoint, b: PdfPoint, cal: Calibration) → number (feet)
  - pdfDistance(a, b) / cal.pdfPointsPerFoot
```

---

## Component Architecture

### New/Modified Components

```
components/takeoff/
├── BlueprintViewer.tsx          # UPGRADE: coordinate conversion, cursor modes, higher quality zoom
├── CalibrationOverlay.tsx       # NEW: Tiered calibration (primary + verification)
├── CalibrationBanner.tsx        # NEW: Shows scale, confidence, recalibrate button
├── WallTraceOverlay.tsx         # NEW: Polyline click-to-trace with editing
├── SegmentList.tsx              # NEW: Right panel segment cards
├── OpeningsEditor.tsx           # NEW: Itemized openings per segment
├── MeasurementBasisSelector.tsx # NEW: Dropdown in header
├── TakeoffSummary.tsx           # MODIFY: Grouped summary with audit info
├── PageSelector.tsx             # KEEP: unchanged
├── RunningTotal.tsx             # KEEP: reads from computed totals
└── BlueprintWorkspace.tsx       # MODIFY: Wire new components, new toolbar
```

### Preserved Abstractions (not UI, but internal)
- Region concept retained internally for future OCR hint crops and snap zones
- `analyze-region` API kept as optional helper endpoint

---

## Database Schema

```sql
ALTER TABLE takeoff_sessions
  ADD COLUMN measurement_basis TEXT DEFAULT 'exterior_face',
  ADD COLUMN calibrations JSONB DEFAULT '{}',
  ADD COLUMN traces JSONB DEFAULT '[]',
  ADD COLUMN classifications JSONB DEFAULT '[]';

-- calibrations: { "1": { primary: {...}, verification: {...}, pdfPointsPerFoot: 4.2, ... } }
-- traces: [{ id, page_index, points: [{x,y},...], is_closed, is_locked }]
-- classifications: [{ segment_index, label, wall_type, wall_height_ft, openings: [...] }]
```

---

## Implementation Order & Phase Boundaries

### What "ships" means per phase

| Phase | Ships? | What the user can do after this phase |
|-------|--------|---------------------------------------|
| 1 | **Yes — MVP** | Calibrate scale, trace walls, classify by scope + height, see SF totals, export quantities |
| 2 | **Yes — v1.0** | Also: area traces (attic/crawl/floor), itemized openings, measurement basis |
| 3 | Scaffolded | Assembly items generated from traces + default install items. Not full rule engine. |
| 4 | Scaffolded | Summary grouped by scope. Quote export as JSON/CSV. No pricing engine yet. |
| 5 | Polish | Vertex editing, undo/redo, lock/unlock, group ops |
| 6 | Future | OCR helper, layer stripping, snap-to-vector, rule engine, pricing |

### Phase 1: Measurement MVP (4-5 days)

**Goal:** User can calibrate, trace walls, classify segments, and see accurate SF totals.

1. **Types + store** — `Trace`, `TraceClassification`, `Calibration`, `TakeoffSession` (unified linear + area types from day 1, even though area UI comes in Phase 2)
2. **BlueprintViewer upgrades** — `cssToPageCoords()`, `pageCoordsToCss()`, crosshair cursor, quality at zoom
3. **Calibration system** — CalibrationOverlay (primary + verification), CalibrationBanner, variance check
4. **Linear tracing** — TraceOverlay (polyline click-to-trace, live calibrated length labels)
5. **Segment classification** — SegmentList (assembly scope dropdown, height picker, per-segment)
6. **Running total** — recomputed from geometry + classification (never stored)
7. **Workspace integration** — toolbar (pointer / calibrate / trace), page tabs, step flow
8. **Basic persistence** — save session to Supabase on "Save" or "Generate Quote"

**Exit criteria:** Trace the Gamache perimeter → total LF within ±2% of gold (555 LF).

### Phase 2: Area Mode + Openings (3 days)

**Goal:** Full measurement coverage — walls AND area scopes (attic, crawl, floors) + openings.

9. **Area tracing** — same TraceOverlay in 'area' mode (closed polygon, shoelace area calc, SF label)
10. **OpeningsEditor** — itemized openings with presets per segment (door, window, garage door, sliding)
11. **MeasurementBasisSelector** — session-level dropdown in workspace header
12. **Multi-page tracing** — traces on different pages, each with own calibration

**Exit criteria:** Complete Gamache takeoff (walls + attic + crawl + garage ceiling) matches gold within ±3%.

### Phase 3: Assembly + Line Items (3 days)

**Goal:** Traces generate structured assembly items and installation line items.

13. **Assembly classification engine** — maps traces to `AssemblyItem` objects
14. **Installation item generation** — assembly → field insulation + accessories (poly, baffles, foam/caulk, supports, groundcover). Simple rules, not a full engine.
15. **ContractorConfig** — defaults per assembly scope (jurisdiction, install method, product spec)
16. **Field notes** — per-classification notes for special conditions
17. **Source provenance** — every generated item tracks trace_id, page, generation method

### Phase 4: Summary + Export (2 days)

18. **TakeoffSummary** — grouped by assembly scope with gross/opening/net per tier + audit info
19. **Quote export** — JSON/CSV of line items (material quantities, not pricing yet)
20. **Session persistence** — full save/load with calibration + traces + classifications + items

### Phase 5: Editing & Polish (2 days)

21. **Vertex editing** — move, insert, delete points (recomputes all derived values)
22. **Undo/redo** — point-level undo stack
23. **Lock/unlock traces** — prevent accidental edits after review
24. **Group operations** — multi-select segments → batch assign scope + height

### Phase 6: Pricing + Enhancements (future)

25. **Pricing engine** — unit prices, labor, burden, overhead, profit per line item
26. **Rule-driven accessories** — baffles from rafter bay count, groundcover from crawl area
27. **Non-geometry quantities** — EA counts for attic hatches, fan boxes, penetrations
28. **OCR dimension helper** — suggest values near clicked text
29. **PDF layer stripping** — hide non-structural layers
30. **Snap to vector** — snap to PDF line endpoints
31. **Manual override tracking** — `manual_override_reason` on any generated value

---

## Validation Plan

### Test Buckets

| Bucket | Plan | Type | Expected Accuracy |
|--------|------|------|-------------------|
| 1. Clean vector | Gamache | CAD-exported, outlined text | ±1% |
| 2. Complex vector | Eddie | CAD-exported, multi-height | ±2% |
| 3. Vector with text | Chang | CAD-exported, embedded text | ±1% |
| 4. Dense vector | Kinloch | CAD-exported, complex layout | ±2% |

### Validation Criteria (per plan)

- [ ] Segment LF within ±2% of gold per wall section
- [ ] Total LF within ±2% of gold total
- [ ] Wall type assignment matches gold (exterior vs garage)
- [ ] Height assignment matches gold (8'/9'/10')
- [ ] Opening deductions within ±5% of gold
- [ ] Net SF within ±3% of gold
- [ ] Session saves/loads correctly (edit stability)
- [ ] Calibration confidence scores correctly (high/good/low)
- [ ] Recalibration updates all derived values
- [ ] Summary grouping matches gold bucket structure

### Gold Data (Gamache)

| Item | Gold LF | Gold SF | Height |
|------|---------|---------|--------|
| Exterior 9' | 208 | 1,872 | 9' |
| Exterior 10' | 265 | 2,650 | 10' |
| Garage 8' | 82 | 654 | 8' |
| **Total** | **555** | **5,176** | |

---

## Naming Conventions

| Old Name | New Name | Why |
|----------|----------|-----|
| `pixelsPerFoot` | `pdfPointsPerFoot` | Coordinates are in PDF-space, not pixels |
| `RegionOverlay` | `WallTraceOverlay` | No longer rectangle regions |
| `RegionCard` | Segment in `SegmentList` | Wall segments, not regions |
| `RegionModal` | Inline editing in `SegmentList` | No modal needed |
| `TakeoffRegion` | `WallTrace` + `SegmentClassification` | Geometry separated from classification |
