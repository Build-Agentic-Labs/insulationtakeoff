# EV Insulation — System Overview & Current State

**Date:** March 26, 2026
**Author:** Claude (generated for Rosendo Lopez)

---

## 1. What We're Building

An AI-assisted insulation takeoff system that replaces manual blueprint measurement with an interactive workflow: **AI reads the blueprints, the user confirms the numbers.**

Two components:
- **Insulation/** — Next.js web app (upload PDFs, review extractions, generate quotes)
- **pdfengine/** — Python ML pipeline (extract blueprint data → building model → takeoff calculations)

---

## 2. The Problem

Insulation contractors need to measure exterior wall square footage from architectural blueprints to generate quotes. Today this is done manually with a scale ruler and calculator — it takes 30-60 minutes per plan and is error-prone.

Our automated OCR pipeline (Phases 1-10) achieves ±35% accuracy on test plans. The core difficulty is **attribution**: the pipeline can detect dimensions like `14'-0"` and `9'-0"` on a page, but correctly deciding which dimensions belong to which exterior wall, at which height, requires spatial reasoning that pure OCR struggles with.

---

## 3. The Solution: UI-Guided Takeoff

Instead of full automation, we split the work:

| Task | Who Does It | Why |
|------|-------------|-----|
| Classify which pages are floor plans | **AI (Vision)** | Claude excels at page-level understanding |
| Identify where exterior walls are | **User** | User draws rectangles — they know the building |
| Read dimensions within a wall region | **AI (OCR)** | PaddleOCR is accurate on focused, cropped areas |
| Confirm wall height | **User** | Quick pick from 8'/9'/10' buttons |
| Detect doors and windows | **AI (OCR)** | Opening detection on small regions is reliable |
| Calculate net SF | **System** | Simple math: length × height - openings |
| Generate the quote | **System** | Existing quote generation, unchanged |

**Target time:** 10-15 minutes per plan (vs. 30-60 manual, vs. unreliable full automation)

---

## 4. User Flow (5 Steps)

### Step 1: Upload PDF
Existing flow, unchanged. User drag-drops a blueprint PDF → Supabase storage.

### Step 2: Select Pages
- AI Vision classifies all pages in one API call (~9 seconds)
- Identifies floor plans, elevations, sections, schedules, etc.
- Extracts actual page titles from the drawings (e.g., "MAIN FLOOR PLAN")
- Auto-selects floor plans with dimension chains
- User confirms or adjusts selection
- **Classification is cached** in localStorage — instant on revisit

### Step 3: Draw Wall Regions
- Blueprint renders in a high-quality PDF viewer (pdfjs canvas, not react-pdf)
- User draws rectangles around each exterior wall section
- Each rectangle = one "wall region" (e.g., "North Wall", "Garage East")
- Right panel shows region cards with status
- Zoom controls (Ctrl+wheel, buttons) and scroll navigation

### Step 4: Confirm Each Region
- Click a region → analysis modal opens
- Backend crops that rectangle from the PDF and runs OCR
- Modal shows:
  - **Detected dimensions** (e.g., `14'-0"`, `9'-0"`) with toggle to include/exclude
  - **Wall height** quick-pick (8'/9'/10') or custom entry
  - **Doors and windows** with subtracted area
  - **Net SF** = (sum of selected dimensions) × height − openings
- User confirms → region turns green, running total updates

### Step 5: Generate Quote
- All confirmed regions feed into quote generation
- Output grouped by wall height tier (matching existing TakeoffEnvelopeV1 schema)

---

## 5. Current Implementation Status

### What's Working (as of March 26)

| Feature | Status | Notes |
|---------|--------|-------|
| Page classification (Vision AI) | **Working** | Classifies 10 pages in ~9s, cached in localStorage |
| Page selector (filmstrip + preview) | **Working** | Auto-selects floor plans, zoom, include/exclude |
| Blueprint viewer | **Working** | Custom pdfjs canvas renderer, Ctrl+wheel zoom |
| Region drawing (SVG overlay) | **Built** | Rectangle tool draws on blueprint |
| Region cards (right panel) | **Built** | Shows region list with status |
| Region analysis modal | **Built** | Shows mock OCR data, height picker, openings |
| Running total | **Built** | Accumulates confirmed SF |
| Supabase tables | **Migrated** | takeoff_sessions + takeoff_regions |
| Mock analyze-region API | **Working** | Returns fake but realistic OCR data |
| Backend RegionPipelineAdapter | **Written** | Python code ready, not deployed |

### What's Not Working / Needs Fixing

| Issue | Severity | Notes |
|-------|----------|-------|
| PDF viewer crashes at high zoom | **High** | Canvas size exceeds browser limits despite caps |
| Drawing cursor offset | **Medium** | SVG coordinates don't perfectly match mouse position |
| Region analysis returns mock data only | **Expected** | pdfengine backend not deployed yet |
| No session persistence on refresh | **Medium** | Zustand state lost on page refresh |
| No quote integration | **Low** | "Generate Quote" navigates but doesn't pass data |

### What We Intentionally Removed

| Feature | Why Removed |
|---------|-------------|
| Auto region detection (Vision AI suggesting wall boxes) | Inaccurate — Vision can't draw precise bounding boxes on architectural plans. User draws better. |
| analyze-page API route (wall region suggestions) | No longer needed — user draws manually |

---

## 6. Architecture

### Frontend Stack
- **Next.js 16.1.4** (React 19, App Router)
- **Zustand 5** for takeoff session state
- **pdfjs-dist 4.9** for PDF rendering (direct canvas API)
- **Supabase JS** for database
- **@anthropic-ai/sdk** for Vision API calls
- **Tailwind 3** with light theme

### Backend Stack (pdfengine)
- **Python 3.9+**, FastAPI
- **PyMuPDF** (fitz) for PDF rendering + cropping
- **PaddleOCR** for text detection
- **OpenCV 4.13** for image processing
- **Pydantic v2** for data models

### Database (Supabase)
```
takeoff_sessions
├── id (UUID, PK)
├── project_id → projects
├── document_id → documents
├── status: in_progress | completed | abandoned
├── selected_pages: INTEGER[]
├── created_at, updated_at

takeoff_regions
├── id (UUID, PK)
├── session_id → takeoff_sessions
├── page_index, label, wall_type, source, status
├── bbox (JSONB: {x, y, width, height} as %)
├── wall_length_lf, wall_height_ft, gross_sf, net_sf
├── openings (JSONB), raw_ocr_result (JSONB)
├── confirmed_at, created_at
```

### Data Flow

```
User uploads PDF
        │
        ▼
┌─ Step 2: Page Selection ──────────────────────┐
│  Frontend renders thumbnails via pdfjs          │
│  POST /api/takeoff/classify-pages              │
│  → Claude Vision classifies all pages          │
│  → Auto-selects floor plans                    │
│  → Cached in localStorage                      │
└───────────────┬────────────────────────────────┘
                │
                ▼
┌─ Step 3: Draw Regions ────────────────────────┐
│  BlueprintViewer renders PDF at high quality   │
│  User draws rectangles on exterior walls       │
│  Each rectangle → TakeoffRegion in store       │
└───────────────┬────────────────────────────────┘
                │ (user clicks region)
                ▼
┌─ Step 4: Analyze & Confirm ───────────────────┐
│  POST /api/takeoff/analyze-region              │
│  → Frontend sends document_id + bbox           │
│  → Backend crops PDF at 150 DPI (PyMuPDF)      │
│  → PaddleOCR detects text in crop              │
│  → DimensionParser extracts measurements       │
│  → HeightNoteParser finds wall height          │
│  → OpeningDetector finds doors/windows         │
│  → Returns: dims, height, openings, net SF     │
│  User reviews, edits if needed, confirms       │
│  Running total accumulates                     │
└───────────────┬────────────────────────────────┘
                │ (all regions confirmed)
                ▼
┌─ Step 5: Generate Quote ──────────────────────┐
│  Confirmed regions → TakeoffEnvelopeV1         │
│  Grouped by height tier (8'/9'/10')            │
│  Feeds into existing quote generation          │
└────────────────────────────────────────────────┘
```

---

## 7. The Existing OCR Pipeline (Phases 1-10)

The automated pipeline remains in the codebase and is fully functional. It's not used by the new UI-guided workflow but represents significant engineering work that informs the region analyzer.

| Phase | What It Does | Status |
|-------|-------------|--------|
| 1 | OCR spike, text graph building | Complete |
| 2+3 | Dimension classification, height bucketing | Complete |
| 4 | Cross-page section correlation | Complete |
| 5 | Opening detection + net calculation | Complete |
| 6A/6B | Symbol detection + schedule enrichment | Complete |
| 7 | Production hardening (cache, benchmark, review queue) | Complete |
| 8 | NET takeoff accuracy (wall-band attribution) | Complete |
| 9 | Permissive detection + NET subtraction | Complete |
| 10 | Adaptive banding + fallback caps | Complete |

**Key insight:** The pipeline's individual components (DimensionParser, HeightNoteParser, OpeningDetector) are accurate when given focused input. The RegionPipelineAdapter reuses these components on small cropped images, bypassing the hard problems of full-page spatial reasoning.

### Gold Takeoff (Gamache — the answer key)

| Item | SF | Height |
|------|----|--------|
| Ext Walls 9' | 1,872 | 9' |
| Ext Walls 10' | 2,650 | 10' |
| Garage Walls | 654 | 8' |
| Attic Blow | 3,576 | — |
| Crawlspace | 1,187 | — |
| Garage Ceiling | 1,588 | — |
| Sound Floor | 2,490 | — |
| **Subtotal** | **$18,386** | |

---

## 8. Goals & Success Criteria

### Short-term (This Sprint)

1. **Fix the PDF viewer** — sharp at all zoom levels, no crashes, accurate cursor for drawing
2. **Test full flow with mock data** — draw region → see analysis → confirm → running total
3. **Deploy pdfengine backend** — real OCR analysis instead of mock data
4. **Wire quote generation** — confirmed regions feed into existing quote page

### Medium-term (Next 2 Weeks)

1. **Session persistence** — survive page refresh, resume incomplete takeoffs
2. **Accuracy validation** — compare UI-guided results against Gamache gold data
3. **Multi-page support** — switch between floor plan pages, regions per page
4. **Height detection improvements** — better HeightNoteParser for cropped regions

### Long-term (Month+)

1. **AI-assisted drawing** — after user draws first 2-3 regions, AI suggests the rest based on the pattern
2. **Attic/crawlspace/ceiling regions** — extend beyond exterior walls
3. **Template learning** — similar house layouts get pre-populated regions
4. **Production deployment** — Vercel (frontend) + managed API (backend)
5. **Multi-user** — auth, per-user sessions, team collaboration

---

## 9. Key Technical Decisions

### Why pdfjs Canvas Instead of react-pdf

react-pdf wraps pdfjs with React components (`<Document>`, `<Page>`). This adds a layer that:
- Re-renders the entire component tree on zoom (slow, blurry)
- Doesn't expose the canvas for coordinate calculations
- Makes SVG overlay alignment unreliable

Our `BlueprintViewer` uses pdfjs directly:
- Renders to a raw `<canvas>` with controlled DPR
- SVG overlay is positioned with exact pixel dimensions from the canvas
- Zoom re-renders at native resolution (always sharp)

### Why User Draws Instead of AI Detecting

Vision AI (Claude Sonnet) was tested for wall region detection. Results:
- 15-16 regions per page (should be 4-6)
- Boxes overlap, cover interior walls
- Duplicate names
- Bounding boxes imprecise (±10% off actual wall positions)

Vision AI excels at **understanding** (page classification, text reading) but struggles at **precise spatial localization** on complex architectural drawings. Users can identify exterior walls instantly; AI measures what's inside.

### Why Mock Mode for Development

`PDFENGINE_URL` empty → `/api/takeoff/analyze-region` returns realistic fake data:
- Random wall length (8-38 LF)
- Random height (8'/9'/10')
- Random doors/windows with realistic sizes
- Proper gross/net SF calculations

This lets the full UI be developed and tested without running the Python backend.

### Why localStorage for Classification Cache

The `classify-pages` call takes ~9 seconds (10 page thumbnails → Claude Vision). Caching in localStorage keyed by `documentId + pageCount`:
- Instant on revisit (0ms vs 9s)
- Persists across browser sessions
- Invalidated if document changes (different ID)
- No server-side caching needed for this data

---

## 10. File Map

### Frontend (Key Files)

```
Insulation/
├── app/projects/[id]/takeoff/page.tsx      # Main orchestrator
├── components/takeoff/
│   ├── PageSelector.tsx                     # Step 2: page filmstrip
│   ├── BlueprintViewer.tsx                  # pdfjs canvas viewer
│   ├── BlueprintWorkspace.tsx               # Step 3: viewer + panel
│   ├── RegionOverlay.tsx                    # SVG drawing overlay
│   ├── RegionCard.tsx                       # Region list item
│   ├── RegionModal.tsx                      # Step 4: analysis review
│   ├── RunningTotal.tsx                     # SF accumulator
│   └── ToolBar.tsx                          # Tool buttons
├── lib/stores/takeoff-store.ts              # Zustand session state
├── lib/types/takeoff.ts                     # All TypeScript types
├── app/api/takeoff/
│   ├── classify-pages/route.ts              # Vision: page classification
│   ├── analyze-region/route.ts              # OCR proxy (mock or pdfengine)
│   ├── analyze-page/route.ts                # Vision: wall detection (unused)
│   └── sessions/[id]/regions/route.ts       # Region CRUD
└── supabase/migrations/
    └── 20260323000001_add_takeoff_tables.sql
```

### Backend (Key Files)

```
pdfengine/
├── packages/shared/src/models/region_models.py   # Pydantic DTOs
├── packages/ml/src/pipeline/region_adapter.py     # RegionPipelineAdapter
├── packages/ml/src/pipeline/ocr_adapter.py        # Full pipeline (Phases 2-9)
├── packages/ml/src/text/ocr_engine.py             # PaddleOCR wrapper
├── packages/ml/src/text/dimension_parser.py       # Dimension parsing
├── packages/ml/src/dimensions/opening_detector.py # Opening detection
├── apps/api/src/routes/takeoff.py                 # POST /takeoff/analyze-region
└── apps/api/src/main.py                           # FastAPI app + router registration
```

---

## 11. Extraction Architecture — Source-Priority Pipeline

### Validated Finding (March 26, 2026)

Analysis of our actual plan corpus reveals the extraction landscape:

| Plans | Vector Geometry? | Embedded Text? | OCR Required? |
|-------|-----------------|----------------|---------------|
| Gamache, Haas, Eddie, Kinloch (4/6) | Yes — 15K-21K drawing paths | **No** — text drawn as line strokes | **Yes** — only way to read dimensions |
| Chang, Onica (2/6) | Yes | **Yes** — 1,300+ extractable words | Optional — text extractable directly |

**Key insight:** Most residential blueprint PDFs have text outlined as vector strokes (common when AutoCAD exports without the original architectural fonts). This means OCR is not a fallback — it is the primary extraction path for the majority of real-world plans.

### Corrected Extraction Hierarchy

The theoretically optimal hierarchy (BIM → vector text → OCR) doesn't match our reality. Our corrected hierarchy based on actual data:

```
1. User-guided region selection         ← always (our core UX)
2. OCR on the cropped region            ← primary for ~70% of plans
3. Embedded text extraction (when available) ← enhancement for ~30% of plans
4. Vector geometry measurement          ← future R&D upgrade
5. User confirmation                    ← always (the trust gate)
```

### Phased Roadmap

**v1 — Ship Now (Current Sprint)**
- User draws regions → OCR reads crop → user confirms → quote
- This is the right architecture and should ship first
- Already better than full-page OCR (±35% accuracy → user-confirmed accuracy)

**v1.1 — Quick Win (Next Sprint)**
- Add `page.get_text("words")` pre-check in `region_adapter.py`
- For plans with embedded text (Chang, Onica), extract dimensions directly before OCR
- Free accuracy boost on ~30% of plans, ~2-3 days of work
- No UX changes needed — transparent to the user

**v2 — Vector Geometry R&D (Month+)**
- Explore `page.get_drawings()` for direct wall measurement
- 63,000 line segments on Gamache floor plan — wall geometry is in there
- Challenges: separating walls from fixtures, hatching, furniture, text strokes
- Requires geometric filtering (line width, connectivity, length) or ML classification
- Potential to eliminate OCR for measurement entirely on vector PDFs
- **This is the real competitive advantage** — no competitor does vector-geometry-aware AI takeoff on residential plans

**v3 — Advanced Capabilities (Quarter+)**
- Scale calibration from known dimensions (enables geometric measurement)
- Non-wall region modes (attic area, crawlspace, ceiling SF, count/symbol)
- Template learning (similar house layouts get pre-populated regions)
- Full vector wall detection and perimeter inference

### What the Market Does

| Tool | Approach | Accuracy Model |
|------|----------|---------------|
| Autodesk Takeoff | Calibrated digital measurement + manual | Human-dependent |
| Bluebeam Revu | Scale calibration + linear/area tools | Human-dependent |
| ConstructConnect | AI as "head start" + human review | AI-assisted |
| Togal.AI | AI detect/measure/count + validation | AI-assisted |
| **EV Insulation (v1)** | **User draws + OCR reads + user confirms** | **AI-assisted, user-guided** |
| **EV Insulation (v2 target)** | **Source-priority: text → OCR → geometry** | **Source-aware AI** |

**Market signal:** AI speeds takeoff, but trusted accuracy still comes from calibrated geometry and estimator review. Our user-guided approach aligns with this reality.

### Architectural Principle

**"OCR-primary, source-aware extraction."**

Each region analyzer should try, in order:
1. Check for extractable text (`page.get_text("words")`)
2. If not, use OCR (PaddleOCR on cropped image)
3. Optionally inspect vector drawings for measurement candidates
4. Always keep user confirmation as the final gate

---

## 12. Open Questions

1. **Should we persist regions to Supabase on every confirm, or batch at the end?** Currently batch — regions are only in Zustand until "Generate Quote".

2. **How should we handle multi-story plans?** The Gamache plan has a basement floor plan (Page 4). Should each floor be a separate takeoff session or one session with regions on multiple pages?

3. **What about non-wall insulation?** Attic blow, crawlspace, garage ceiling, sound floor — these aren't wall regions. Do we need a different UI for flat-area takeoffs?

4. **When do we deploy pdfengine?** The Python backend has the new routes but needs to be deployed to a server where PaddleOCR can run. What's the deployment target?

5. **Do we need to keep the old extraction flow?** The project page still has "Re-Extract Data" and "Review Data" buttons that use the automated pipeline. Should these coexist with the new takeoff flow?
