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

"Generate Quote →" feeds confirmed data to existing quote page.

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

interface WallTrace {
  id: string;
  page_index: number;
  points: PdfPoint[];
  is_closed: boolean;
  is_locked: boolean;
}

interface SegmentClassification {
  segment_index: number;       // Index into trace.points (segment = points[i] → points[i+1])
  label: string;               // "Wall 1", or user-edited name
  wall_type: 'exterior' | 'garage' | 'basement' | 'other';
  wall_height_ft: number;
  openings: Opening[];
}

interface TakeoffSession {
  id: string;
  project_id: string;
  document_id: string;
  status: 'calibrating' | 'tracing' | 'reviewing' | 'completed';
  measurement_basis: MeasurementBasis;
  selected_pages: number[];
  calibrations: Record<number, Calibration>;  // Per-page, keyed by page_index
  traces: WallTrace[];
  classifications: SegmentClassification[];   // Separate from geometry
}
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

## Implementation Order

### Phase 1: Core Measurement (4-5 days)
1. **BlueprintViewer upgrades** — `cssToPageCoords`, `pageCoordsToCss`, cursor modes, quality at zoom
2. **Calibration system** — CalibrationOverlay (primary + verification), CalibrationBanner, variance check
3. **Wall tracing** — WallTraceOverlay (click-to-trace polyline, live length labels)
4. **Segment classification** — SegmentList (wall type, height, per-segment)
5. **Store redesign** — new TakeoffSession model with calibration + traces + classifications
6. **Workspace integration** — wire components, toolbar, step flow

### Phase 2: Openings & Summary (2 days)
7. **OpeningsEditor** — itemized openings with presets
8. **MeasurementBasisSelector** — session-level setting
9. **TakeoffSummary** — grouped display with audit trail
10. **Session persistence** — save to Supabase

### Phase 3: Editing & Polish (2 days)
11. **Vertex editing** — move, insert, delete points
12. **Undo/redo** — point-level undo stack
13. **Lock/unlock traces** — prevent accidental edits
14. **Group operations** — batch assign type + height
15. **Quote wiring** — feed to existing quote page

### Phase 4: Enhancements (future)
16. **OCR dimension helper** — suggest values near clicked text
17. **PDF layer stripping** — hide non-structural layers
18. **Snap to vector** — snap to PDF line endpoints
19. **Multi-scale page support** — detect and handle detail callouts

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
