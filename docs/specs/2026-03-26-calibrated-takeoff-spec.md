# Calibrated Digital Takeoff — Implementation Spec

**Date:** March 26, 2026
**Status:** Approved for implementation
**Replaces:** UI-guided crop-and-OCR approach

---

## Overview

Interactive takeoff where the user calibrates scale, traces wall perimeters, and the system calculates square footage from calibrated pixel geometry. OCR is a helper, not the source of truth.

## User Flow

### Step 1: Upload & Page Selection (existing)
- AI classifies pages → auto-selects floor plans
- User confirms page selection
- **No changes needed** — this works

### Step 2: Scale Calibration (NEW)
1. Prompt: "Click two endpoints on a dimension you can read"
2. User clicks point A on one end of a dimension line
3. User clicks point B on the other end
4. Blue line drawn between A and B with pixel distance shown
5. Input field appears: "What is this dimension?"
6. User types `14` (feet) or `14'-0"` (feet-inches)
7. System computes: `pixelsPerFoot = pixelDistance / feetValue`
8. Display: "Scale set: 1/4" = 1'-0" (4.2 px/ft)" or similar
9. Green checkmark, "Scale calibrated ✓"
10. User can recalibrate at any time

**Technical details:**
- All coordinates stored in PDF-space (72 DPI points), not pixel-space
- Scale survives zoom changes because PDF coordinates are zoom-independent
- Per-page calibration stored in Zustand + persisted to Supabase
- Parse feet-inches input: accept `14`, `14'`, `14'-0"`, `14.5`, `14'-6"`

### Step 3: Wall Tracing (NEW)
1. Toolbar shows: Pointer | Trace Wall | Zoom controls
2. User selects "Trace Wall" tool
3. Click to place first point on exterior wall corner
4. Click successive points along the wall perimeter
5. Each segment shows live calibrated length label (e.g., "24'-6"")
6. Lines drawn in blue, confirmed segments in green
7. Right panel shows segment list with:
   - Segment label (auto: "Wall 1", "Wall 2", ...)
   - Calibrated length (LF)
   - Wall type dropdown: Exterior 9' | Exterior 10' | Garage 8' | Custom
8. Double-click or press Enter to finish a trace
9. User can trace multiple separate runs (e.g., main house + garage)

**Technical details:**
- Points stored as PDF-space coordinates (x, y in 72 DPI points)
- Length = sqrt((x2-x1)² + (y2-y1)²) / pixelsPerFoot
- Polyline rendering on SVG overlay
- Each segment independently classified by wall type + height
- Undo last point: Backspace/Ctrl+Z
- Delete segment: click segment → Delete key

### Step 4: Openings (simplified)
1. Per wall segment or per trace, user enters:
   - Number of doors (default size: 3'×6'8" = 20.4 SF each)
   - Number of windows (default size: 3'×4' = 12 SF each)
   - Or custom sizes
2. System subtracts opening area from gross SF
3. Optional: OCR helper suggests opening counts from nearby text

### Step 5: Summary & Quote
1. Confirmed segments grouped by wall type + height:
   - Exterior 9': X segments, Y LF, Z gross SF, W net SF
   - Exterior 10': ...
   - Garage 8': ...
2. Total gross SF, total openings SF, total net SF
3. "Generate Quote →" feeds into existing quote page

---

## Component Architecture

### New/Modified Components

```
components/takeoff/
├── BlueprintViewer.tsx          # UPGRADE: PDF-space coordinates, crosshair cursor
├── CalibrationOverlay.tsx       # NEW: Two-point click + dimension input
├── WallTraceOverlay.tsx         # NEW: Polyline click-to-trace
├── SegmentList.tsx              # NEW: Right panel segment cards with type/height
├── OpeningsEditor.tsx           # NEW: Door/window count per segment
├── CalibrationBanner.tsx        # NEW: Shows current scale, recalibrate button
├── PageSelector.tsx             # KEEP: unchanged
├── RunningTotal.tsx             # KEEP: reads from confirmed segments
└── TakeoffSummary.tsx           # MODIFY: group by wall type + height
```

### Removed Components
```
├── RegionOverlay.tsx            # REMOVE: replaced by WallTraceOverlay
├── RegionCard.tsx               # REMOVE: replaced by SegmentList
├── RegionModal.tsx              # REMOVE: no modal needed
├── ToolBar.tsx                  # REMOVE: integrated into workspace header
```

### Store Changes (takeoff-store.ts)

```typescript
// New state
calibration: {
  pointA: { x: number; y: number } | null;  // PDF-space coords
  pointB: { x: number; y: number } | null;
  pixelsPerFoot: number | null;
  isCalibrated: boolean;
} | null;

// Wall trace state
traces: WallTrace[];           // Multiple independent traces
activeTraceId: string | null;
currentTool: 'pointer' | 'calibrate' | 'trace';

// Types
interface WallTrace {
  id: string;
  page_index: number;
  points: Array<{ x: number; y: number }>;  // PDF-space
  segments: WallSegment[];
  is_closed: boolean;
}

interface WallSegment {
  id: string;
  trace_id: string;
  start_point: { x: number; y: number };
  end_point: { x: number; y: number };
  length_ft: number;           // Calibrated
  wall_type: 'exterior' | 'garage' | 'basement' | 'other';
  wall_height_ft: number;
  doors: number;
  windows: number;
  door_size_sf: number;        // Default 20.4
  window_size_sf: number;      // Default 12.0
  gross_sf: number;            // length × height
  net_sf: number;              // gross - openings
}
```

### Coordinate System

```
PDF Space (72 DPI points) ←→ Canvas Pixels ←→ CSS Pixels

PDF → Canvas: multiply by (canvasPixels / pdfPoints)
Canvas → CSS: divide by devicePixelRatio
CSS → PDF: inverse of above

All stored coordinates are in PDF space.
Calibration pixelsPerFoot is in PDF space.
This means zoom changes don't invalidate calibration.
```

---

## BlueprintViewer Upgrades

1. **Expose PDF-space coordinate conversion**
   - `cssToPageCoords(cssX, cssY)` → `{ x, y }` in PDF points
   - `pageCoordsToCss(pageX, pageY)` → `{ x, y }` in CSS pixels
   - Based on the current viewport transform from pdfjs

2. **Render at higher quality when zoomed**
   - Increase canvas pixel budget for calibration accuracy
   - At 200% zoom, render at 4x CSS (not 2x) for crisp dimension text

3. **Cursor modes**
   - `pointer` — default arrow
   - `calibrate` — crosshair with tooltip "Click first calibration point"
   - `trace` — crosshair with tooltip "Click to place point"

4. **Scroll-to-zoom on the PDF only**
   - Already implemented with native wheel listener + preventDefault

---

## Database Schema Changes

```sql
-- Add calibration and trace data to takeoff_sessions
ALTER TABLE takeoff_sessions
  ADD COLUMN calibration JSONB DEFAULT NULL,
  ADD COLUMN traces JSONB DEFAULT '[]';

-- calibration: { pointA, pointB, pixelsPerFoot, pageIndex }
-- traces: array of WallTrace objects with segments
```

---

## API Changes

### Removed
- `POST /api/takeoff/analyze-page` — no longer needed
- `POST /api/takeoff/analyze-region` — no longer primary (kept as optional OCR helper)

### Modified
- `POST /api/takeoff/sessions` — include calibration + traces in body
- `PUT /api/takeoff/sessions/[id]` — update calibration + traces

### New (optional, v1.1)
- `POST /api/takeoff/ocr-hint` — send a small crop, return OCR dimension suggestion

---

## Implementation Order

### Phase 1: Core Measurement (3-4 days)
1. **BlueprintViewer upgrades** — coordinate conversion, cursor modes
2. **CalibrationOverlay** — two-point click + dimension input
3. **WallTraceOverlay** — polyline tracing with live lengths
4. **SegmentList** — right panel with type/height per segment
5. **Store updates** — calibration + trace state
6. **Workspace integration** — wire everything together

### Phase 2: Polish (1-2 days)
7. **OpeningsEditor** — door/window count per segment
8. **Summary view** — grouped by type + height
9. **Session persistence** — save calibration + traces to Supabase
10. **Quote wiring** — feed confirmed data to quote page

### Phase 3: Enhancements (future)
11. **OCR dimension helper** — suggest values when clicking near text
12. **PDF layer stripping** — hide non-structural layers
13. **Snap to vector** — snap points to PDF line endpoints
14. **Undo/redo** — full undo stack for point placement

---

## Accuracy Target

**Gamache gold data:**
| Item | Gold LF | Gold SF | Height |
|------|---------|---------|--------|
| Exterior 9' | 208 | 1,872 | 9' |
| Exterior 10' | 265 | 2,650 | 10' |
| Garage 8' | 82 | 654 | 8' |

**Target:** Within ±2% of gold values using calibrated measurement on the vector PDF.

**Validation:** After building, manually trace the Gamache perimeter and compare measured LF against gold values.
