# UI-Guided Insulation Takeoff — Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Author:** Rosendo + Claude

## Problem

The fully-automated OCR pipeline (Phases 1-10) produces ~±35% accuracy on unfamiliar plans. The core issues are structural:
- Exterior vs. interior wall classification is unreliable (centroid proximity model)
- Height bucket distribution depends on sparse ceiling height annotations
- NET insulation subtraction is near-zero (opening attribution confidence too low)
- Each plan needs per-plan tuning that doesn't scale

Estimators currently spend 1-2 hours doing takeoffs manually. A 10-15 minute guided interactive tool that produces accurate results is commercially viable.

## Solution

Replace the fully-automated "upload and wait" flow with an **AI-suggests, user-confirms** interactive workflow:

1. AI identifies relevant pages and wall regions
2. User confirms or adjusts each region
3. OCR runs on confirmed, cropped regions (scoped input = higher accuracy)
4. Results accumulate into a running takeoff total
5. Quote generation uses user-verified data

This eliminates the hardest ML problems (exterior classification, height guessing) by putting the human in the loop for spatial reasoning, while keeping the ML for precise measurement extraction.

## User Flow (5 Steps)

### Step 1: Upload PDF
- Identical to current flow (drag-drop, Supabase storage)
- No changes needed

### Step 2: Page Selection (Filmstrip + Preview)
- **Layout:** Vertical filmstrip of page thumbnails on the left, full-size preview on the right
- **AI pre-selection:** `FloorPlanPageScorer` (existing, Milestone 4) ranks pages by floor plan likelihood. Pages above confidence threshold are pre-selected with blue borders and "AI pick" badge
- **User action:** Click each thumbnail to preview full-size, then "Include" or "Skip"
- **Controls:** Include/Skip buttons on the preview header
- **Output:** List of selected page indices passed to Step 3
- **Background:** While user reviews pages, trigger Vision analysis (Step 3) on the first AI-selected page to minimize wait time

### Step 3: AI Suggests Wall Regions
- **Trigger:** Runs on each selected page (Vision AI call)
- **Method:** Send full page image to Claude Vision with a prompt like: "Identify all exterior wall sections on this floor plan. Return bounding box coordinates and a label for each (e.g., 'North wall', 'South wall')."
- **Display:** Blueprint-dominant layout (~70% of screen). AI-suggested regions shown as blue dashed rectangles on the blueprint. Right panel lists regions as cards.
- **Tools bar:** Top-right of blueprint area. Pointer (default), rectangle draw (for custom regions), zoom +/−
- **User can:**
  - Click a suggested region card → triggers Step 4 (region analysis modal)
  - Draw a custom region with the rectangle tool → also triggers Step 4
  - Dismiss/delete an AI suggestion they disagree with
- **Region states:** Pending (blue dashed), Analyzing (pulsing), Confirmed (green solid), Rejected (hidden)
- **Page tabs:** Along the top, one per selected page. Green checkmark when all regions on a page are confirmed.

### Step 4: Confirm Each Region (Stacked Modal)
- **Trigger:** User clicks a region (either AI-suggested or manually drawn)
- **Backend:** Crop the blueprint image to the region bounding box → run OCR pipeline (Phases 2-9) on the cropped image → return measurements
- **Processing time:** ~3-5 seconds per region (OCR on small crop)
- **Modal layout:** Narrow stacked card, centered overlay with dimmed blueprint behind
  - **Header:** Region name (e.g., "North Exterior Wall"), region X of N, close/skip/reject buttons
  - **Cropped preview:** The cropped blueprint section with detected dimensions highlighted (green badges) and detected openings highlighted (door = amber, window = blue)
  - **Stats grid:** 3-column compact grid showing Length (LF), Height, and Gross SF
  - **Height selector:** Quick-pick buttons (8', 9', 10', Custom) — AI pre-selects based on HeightNoteParser detection
  - **Openings list:** Each detected door/window with dimensions and subtracted SF. "Add opening manually" button at bottom.
  - **NET result:** Large green number showing net insulation SF (gross − openings)
  - **Footer:** "Edit Values" button (opens inline editing for LF override, height override, opening edits) and "Confirm →" button
- **On confirm:** Region turns green on blueprint, card in right panel updates with confirmed SF, running total increments
- **On edit:** Inline fields become editable (LF input, height selector, add/remove openings). Re-calculates NET in real-time.
- **On reject:** Region is removed from the list, no SF added

### Step 5: Generate Quote
- **Trigger:** User clicks "Generate Quote" button (available once ≥1 region is confirmed)
- **Display:** Takeoff summary table showing all confirmed regions grouped by height bucket, with location, type (R-value), basis, and SF
- **Aggregation:** Regions from all pages combined. Same height buckets merged (e.g., all 9' walls across pages sum together)
- **Output:** Same `TakeoffEnvelopeV1` schema, populated with user-confirmed data
- **Quote generation:** Existing quote page + `@react-pdf/renderer` — unchanged, just fed with better data

## Architecture

### Frontend (Insulation/ Next.js app)

**New pages/components:**
- `app/projects/[id]/takeoff/page.tsx` — Main takeoff workflow (replaces current extract page as primary flow)
- `components/takeoff/PageSelector.tsx` — Filmstrip + preview (Step 2)
- `components/takeoff/BlueprintWorkspace.tsx` — Blueprint-dominant layout with region overlays (Step 3)
- `components/takeoff/RegionOverlay.tsx` — SVG/canvas overlay for drawing and displaying regions on the PDF
- `components/takeoff/RegionCard.tsx` — Right panel card for each region
- `components/takeoff/RegionModal.tsx` — Stacked analysis modal (Step 4)
- `components/takeoff/RunningTotal.tsx` — Bottom of right panel, accumulates confirmed SF
- `components/takeoff/TakeoffSummary.tsx` — Final summary before quote (Step 5)

**Key libraries needed:**
- `react-pdf` (already installed) — PDF rendering
- Canvas/SVG overlay for region drawing — custom implementation on top of react-pdf
- No new heavy dependencies expected

**State management:**
- Zustand store (already installed) for takeoff session state:
  - Selected pages
  - Regions per page (with status: pending/analyzing/confirmed/rejected)
  - Confirmed measurements per region
  - Running totals

### Backend (pdfengine/)

**New API endpoints:**
- `POST /api/takeoff/analyze-page` — Send page image to Vision AI, return suggested region bounding boxes
- `POST /api/takeoff/analyze-region` — Send cropped region image, run OCR pipeline, return measurements

**New adapter:**
- `packages/ml/src/pipeline/region_adapter.py` — `RegionPipelineAdapter`
  - Takes: cropped image (PIL Image or bytes), DPI, region metadata (label, wall_type)
  - **Two-stage pipeline:**
    1. **OCR stage:** Call `PaddleOCREngine.detect()` directly on the cropped image → produces raw `TextToken[]` list. Build `TextGraph` from tokens via `TextGraphBuilder`.
    2. **Parse stage:** Run `DimensionParser` on the TextGraph to extract `DimensionEntity[]`. Run `HeightNoteParser` to detect height annotations. Run `OpeningDetector` (permissive mode) for doors/windows. Calculate NET via `NetInsulationCalculator`.
  - **Wall length calculation:** Sum all horizontal dimension entities found in the crop. Present ALL detected dimensions to the user in the modal (not just a sum) — the user confirms which ones represent wall length. The modal shows each dimension token with its value and position, and the user can toggle on/off. Default: all dimensions selected. This avoids the risk of including window dims or interior dims in the sum.
  - Returns: `RegionAnalysisResult` with fields:
    - `detected_dimensions: list[DimensionValue]` — all parsed dimensions with positions
    - `suggested_wall_length_lf: float` — sum of all detected dims (user can adjust)
    - `detected_height_ft: float | None` — from HeightNoteParser, may be None if no annotation in crop
    - `openings: list[DetectedOpening]` — doors/windows with dimensions
    - `gross_sf: float` — suggested_wall_length_lf × height (requires user-confirmed height)
    - `net_sf: float` — gross minus opening areas
    - `confidence: float`
    - `raw_tokens: list[TextToken]` — for debugging
  - Skips: ExteriorWallClassifier, HeightBucketCalculator, HeightZoneBuilder, cross-page SectionCorrelator, WallBandAttributor

**Image cropping (server-side):**
- Cropping is done **server-side** via PyMuPDF (`fitz`) for consistent quality
- Client sends: document_id, page_index, bbox (% coordinates)
- Server: loads PDF → renders page at 150 DPI → crops to bbox → passes to RegionPipelineAdapter
- 150 DPI matches the existing pipeline's standard; crop resolution is independent of client zoom level

**Reused pipeline components (unchanged):**
- `PaddleOCREngine` — OCR on cropped region (called directly, not via OCRPipelineAdapter)
- `TextGraphBuilder` — Build TextGraph from raw tokens
- `DimensionParser` — Parse dimension text from TextGraph
- `HeightNoteParser` — Find height annotations (may return None on tight crops — see note below)
- `OpeningDetector` (permissive mode) — Find doors/windows
- `NetInsulationCalculator` — Gross minus openings
- `TakeoffEnvelopeV1` — Output schema for final aggregation

**Height detection caveat:** Ceiling height annotations (e.g., "9'-0\" CLG") are often in room centers, not near exterior walls. The HeightNoteParser may frequently return None on wall-focused crops. This is expected — the modal's height quick-pick buttons (8'/9'/10'/Custom) default to "unset" when no annotation is found, and the user must select. This is the correct UX: the user knows the ceiling height from the plans.

**Not used in this flow:**
- `ExteriorWallClassifier` — User decides what's exterior
- `HeightBucketCalculator` — User confirms height per region
- `HeightZoneBuilder` — Not needed when user sets height
- `OCRPipelineAdapter` — Designed for full-page; RegionPipelineAdapter replaces it for crops
- Cross-page `SectionCorrelator` — Single-region scope
- `WallBandAttributor` — Openings are within the cropped region, direct attribution

### Database (Supabase)

**New table: `takeoff_sessions`**
```sql
CREATE TABLE takeoff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress, completed, abandoned
  selected_pages INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Auto-save: session row created on page selection confirm, updated_at bumped on each region confirm.
-- Resume: on page load, check for in_progress session for this document. If found, restore state.
```

**New table: `takeoff_regions`**
```sql
CREATE TABLE takeoff_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES takeoff_sessions(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  label TEXT NOT NULL, -- 'North Exterior Wall', etc.
  wall_type TEXT NOT NULL DEFAULT 'exterior', -- 'exterior', 'garage', 'basement', 'other'
  source TEXT NOT NULL DEFAULT 'ai', -- 'ai' or 'manual'
  status TEXT NOT NULL DEFAULT 'pending', -- pending, analyzing, confirmed, rejected
  bbox JSONB NOT NULL, -- {x, y, width, height} as % of page dimensions
  wall_length_lf REAL,
  wall_height_ft REAL,
  gross_sf REAL,
  net_sf REAL,
  openings JSONB DEFAULT '[]', -- [{type, width_ft, height_ft, area_sf}]
  raw_ocr_result JSONB, -- Full OCR pipeline output for debugging
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Existing tables — no changes needed.**

### Vision AI Integration (Step 3)

**Prompt:**
```
You are analyzing a residential construction floor plan for insulation takeoff.

Identify all EXTERIOR wall sections visible on this floor plan page. For each wall section, provide:
1. A descriptive label (e.g., "North exterior wall", "Garage west wall")
2. A wall_type: "exterior" for main building walls, "garage" for garage walls
3. A bounding box as percentage coordinates: {x: %, y: %, width: %, height: %}

Rules:
- Only identify EXTERIOR walls (walls on the perimeter of the building)
- Include garage walls as separate regions with wall_type "garage"
- Do NOT include interior partition walls
- Each wall section should be a rectangular region that contains the wall and its nearby dimension annotations
- Make bounding boxes generous — include dimension chains and opening annotations near the wall

Return ONLY a JSON array matching this exact schema, no other text:
[{"label": "string", "wall_type": "exterior|garage", "bbox": {"x": number, "y": number, "width": number, "height": number}}]
All bbox values are percentages (0-100) relative to the page dimensions.
```

**Response contract (Pydantic):**
```python
class VisionBBox(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)

class VisionRegionSuggestion(BaseModel):
    label: str
    wall_type: Literal["exterior", "garage"] = "exterior"
    bbox: VisionBBox

class VisionPageAnalysis(BaseModel):
    regions: list[VisionRegionSuggestion]
```

**Validation & retry:** Parse response as JSON, validate against `VisionPageAnalysis`. If parsing fails, retry once with a simpler prompt. If second attempt fails, return empty regions list — user falls back to manual drawing. Log all Vision responses for debugging.

**Prefetch behavior (Step 2 → Step 3 overlap):** Vision analysis is triggered on the first AI-selected page as soon as page selection begins. Results are cached in the Zustand store keyed by `(document_id, page_index)`. If the user de-selects that page, the cached result is simply ignored (not deleted — it's cheap). If the user opens a page that hasn't been prefetched yet, the Vision call fires on demand with a loading spinner on the blueprint.

## What This Doesn't Change

- **Existing extract flow** (`/projects/[id]/extract`) — kept as-is for backward compatibility. The new takeoff page is a separate route.
- **Quote generation** — identical, just receives better input data
- **pdfengine ML code** — no changes to existing modules. New `RegionPipelineAdapter` composes existing components.
- **Database schema** — additive only (new tables), no migration of existing tables

## Success Criteria

- Estimator can complete a full takeoff in <15 minutes
- When user correctly identifies exterior wall regions and confirms heights, OCR-measured dimensions are within ±10% of gold takeoff
- Works on unknown plans without per-plan configuration
- Running total visible at all times during the workflow
- User can override any AI measurement
- All confirmed data feeds into existing quote pipeline

## Risk & Mitigations

| Risk | Mitigation |
|------|-----------|
| Vision AI region suggestions are poor | User can always draw custom regions; AI suggestions are optional accelerators |
| OCR on small crops produces different results than full-page | Test with Gamache crops first; adjust DPI/preprocessing if needed |
| Region drawing UX is hard to build | Start with simple rectangle tool only; lasso/polygon can come later |
| Users don't trust AI suggestions | Show confidence %, allow easy dismiss, make manual drawing prominent |
| Performance: Vision + OCR per region adds up | Vision runs once per page during page selection; OCR is ~3-5s per region, acceptable |
| Height annotations not in crop | HeightNoteParser may return None; modal defaults to "unset" — user picks from 8'/9'/10'/Custom |
| Crop includes non-wall dimensions (windows, interior) | Modal shows ALL detected dimensions individually; user toggles which count toward wall length |
| Browser closed mid-workflow | Auto-save to DB on each region confirm; resume in_progress session on reload |
| New API endpoints lack auth | Use same Supabase auth middleware as existing routes |

## Implementation Phases (High Level)

1. **Phase A: Page Selector** — Filmstrip + preview component, page scoring integration
2. **Phase B: Blueprint Workspace** — PDF viewer with region overlay (SVG), right panel with region cards, running total
3. **Phase C: Region Drawing** — Rectangle draw tool on blueprint canvas
4. **Phase D: Vision Region Suggestions** — API endpoint + Claude Vision integration, render suggestions as overlays
5. **Phase E: Region Analysis Modal** — Crop + OCR pipeline adapter, stacked modal with results, confirm/edit/reject
6. **Phase F: Takeoff Aggregation** — Cross-page accumulation, height bucket grouping, TakeoffEnvelopeV1 output
7. **Phase G: Database + Persistence** — takeoff_sessions + takeoff_regions tables, save/resume workflow
8. **Phase H: Polish** — Loading states, error handling, mobile considerations, keyboard shortcuts
