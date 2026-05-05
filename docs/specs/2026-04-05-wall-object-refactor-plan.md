# EV Insulation Wall-Object Refactor Plan

**Date:** April 5, 2026
**Branch:** `codex/wall-object-refactor`
**Source backup:** `/Users/rosendolopez/evinsulation/Insulation_backup_2026-04-05`

## 1. Why This Refactor Exists

The current repo contains three overlapping takeoff models:

1. **Legacy OCR extraction**
   - `app/api/extract/route.ts`
   - `app/projects/[id]/extract/page.tsx`
   - `app/projects/[id]/review/page.tsx`
   - `app/projects/[id]/quote/page.tsx`
   - `rooms`, `openings`, `extraction_runs`, `takeoff_envelope`

2. **Region-based guided takeoff**
   - `takeoff_regions`
   - `RegionCard`, `RegionModal`, `RegionOverlay`

3. **New calibrated trace workflow**
   - `app/projects/[id]/takeoff/page.tsx`
   - `lib/stores/takeoff-store.ts`
   - `BlueprintViewer`, `CalibrationOverlay`, `WallTraceOverlay`
   - `takeoff_sessions.calibrations / traces / classifications`

These systems conflict conceptually and technically:

- Quote generation still reads legacy `rooms` plus OCR envelope data.
- The new calibrated workflow is not the system of record.
- The current trace model is too low-level for wall assembly takeoff.
- The repo is carrying legacy routes and state that obscure the product direction.

## 2. Product Decision

**Commit to a calibrated, wall-object-based takeoff system.**

AI will:

- rename pages from title blocks
- score page capabilities
- suggest useful pages
- suggest zones, wall runs, heights, wall types, and openings
- flag conflicts and missing scope

Humans will:

- confirm page set
- calibrate pages
- define or approve zones
- define or approve wall runs and surfaces
- confirm openings, heights, and assemblies
- sign off on the completed scope

**Final measurement source of truth:** calibrated human-confirmed geometry.

## 3. Target Domain Model

The new system should stop treating `rooms` or raw trace segments as the main estimating object.

### 3.1 Primary objects

- `SourcePage`
- `Calibration`
- `TakeoffView`
- `Zone`
- `WallRun`
- `Surface`
- `OpeningItem`
- `AssemblyAssignment`
- `CompletionChecklist`
- `AiSuggestion`

### 3.2 Definitions

#### SourcePage

One real PDF page from the document.

Responsibilities:

- page title
- page capability scores
- page-level notes
- calibration
- viewer metadata

#### TakeoffView

A scoped overlay on a source page.

Purpose:

- solve clutter without duplicating the actual PDF page
- allow multiple passes on the same page:
  - `Exterior Walls`
  - `Garage Shared Walls`
  - `Crawlspace Floor`
  - `Attic Floor`

#### Zone

Spatial area used for adjacency and assembly classification.

Examples:

- conditioned
- garage
- attic
- crawlspace
- storage
- outside

#### WallRun

The primary takeoff object.

Suggested shape:

```ts
type WallRun = {
  id: string
  sourcePageId: string
  viewId: string
  path: PdfPoint[]
  measurementBasis: 'centerline' | 'exterior_face' | 'interior_face' | 'stud_line'
  thicknessIn: 4 | 6 | 8 | 10 | 12
  framingType?: '2x4' | '2x6' | 'cmu' | 'icf' | 'other'
  sideAZoneId?: string
  sideBZoneId?: string
  heightFt?: number
  heightSource: 'manual' | 'ai_note' | 'default' | 'inherited'
  assemblyScope?: string
  openings: string[]
  aiSuggestionId?: string
  confidence: {
    geometry: number
    zoning: number
    assembly: number
  }
  reviewFlags: string[]
}
```

#### Surface

Used for area-based scopes.

Examples:

- attic floor
- crawlspace floor
- garage ceiling
- sound floor
- cathedral ceiling
- cantilever floor

#### CompletionChecklist

Defines whether the takeoff is actually done.

Examples:

- exterior walls reviewed
- garage shared walls reviewed
- attic scope reviewed
- crawlspace scope reviewed
- openings reviewed
- heights reviewed
- assemblies reviewed

## 4. Interaction Model

### 4.1 Core workflow

1. Upload document
2. AI renames pages and scores capabilities
3. User confirms page set
4. User calibrates each relevant page twice
5. User creates one or more takeoff views per page
6. User defines zones first
7. User draws wall runs and surfaces with presets
8. AI suggests heights, openings, and wall types
9. System builds quantities from confirmed geometry
10. User reviews checklist and generates quote

### 4.2 Tool library

Do not create a flat toolbar with dozens of domain-specific buttons.

Use a small set of base tools plus presets.

#### Core creation / edit tools

- `Select`
- `Calibrate`
- `Zone`
- `Wall`
- `Surface`
- `Opening`
- `Inspect`

These are the primary object-making tools available during the takeoff.

Responsibilities:

- `Select`
  - pick an existing zone, wall run, surface, or opening
  - move between objects without changing mode
  - reveal the contextual inspector
- `Calibrate`
  - place the two calibration points
  - confirm the real-world measurement
  - re-run calibration when needed
- `Zone`
  - draw or edit adjacency areas such as conditioned, garage, attic, crawlspace
- `Wall`
  - draw wall runs as the primary linear estimating object
  - assign side A / side B zones
  - confirm basis, thickness, framing type, and height
- `Surface`
  - draw area-based scopes such as attic floor, crawlspace floor, cathedral ceiling
- `Opening`
  - place, edit, accept, or reject windows, doors, garage doors, and other subtractive items
- `Inspect`
  - review the selected object in detail
  - edit metadata, review flags, AI suggestions, and assembly assignment

#### Persistent viewer / navigation tools

These are always available regardless of the active drawing mode:

- `Page picker`
  - switch between source pages in the selected document
- `View switcher`
  - move between takeoff views on the same source page
  - duplicate a view without duplicating the source PDF page
- `Zoom in / zoom out`
  - standard zoom controls for precision work
- `Fit / reset view`
  - return quickly to a sane framing of the page
- `Pan`
  - drag / spacebar pan while preserving the current active tool
- `Ghost other views`
  - optionally show muted context from other takeoff views on the same page
- `AI hint visibility`
  - show / hide suggested zones, openings, heights, or review flags

#### Contextual object actions

These should not live as permanent top-level buttons. They appear inside the inspector or on the selected object:

- `Rename object`
- `Apply preset`
- `Accept AI suggestion`
- `Reject AI suggestion`
- `Duplicate object`
- `Delete object`
- `Adjust points / handles`
- `Split wall run`
- `Merge / reconnect wall run`
- `Assign side zones`
- `Set measurement basis`
- `Set wall thickness / framing type`
- `Set height source`
- `Review flags`
- `Assembly assignment`

#### Workflow / completion controls

These are not drawing tools, but they are still part of the takeoff tool set available to the estimator:

- `Pages`
  - confirm the document page set
- `Calibrate`
  - verify each relevant page is calibrated
- `Views`
  - create or rename scoped takeoff views
- `Zones`
  - confirm adjacency coverage
- `Walls`
  - confirm all wall-run scope for the active view
- `Surfaces`
  - confirm all area-based insulation scope
- `Openings`
  - review subtractive openings and door/window items
- `Review`
  - completion checklist, missing-scope warnings, and quote readiness

#### Presets panel

Examples:

- Zone presets:
  - Conditioned
  - Garage
  - Attic
  - Crawlspace
  - Storage
- Wall presets:
  - Exterior 2x6
  - Exterior 2x4
  - Garage shared
  - Basement wall
  - Knee wall
  - Sound wall
- Surface presets:
  - Attic floor
  - Crawlspace floor
  - Garage ceiling
  - Cathedral ceiling
  - Cantilever floor
- Opening presets:
  - Window
  - Door
  - Sliding door
  - Garage door

#### Availability by workflow step

Not every tool should feel active at the same time.

- `Page confirmation step`
  - page picker
  - page capability review
  - include / exclude actions
- `Calibration step`
  - calibrate
  - zoom / pan / fit / reset
  - page picker
- `View setup step`
  - view switcher
  - duplicate view
  - ghost other views
- `Zone pass`
  - select
  - zone
  - inspect
  - zone presets
- `Wall pass`
  - select
  - wall
  - inspect
  - wall presets
  - AI wall / height suggestions
- `Surface pass`
  - select
  - surface
  - inspect
  - surface presets
- `Opening pass`
  - select
  - opening
  - inspect
  - opening presets
  - AI opening suggestions
- `Review / quote step`
  - checklist
  - review flags
  - missing-scope warnings
  - assembly assignment
  - quote generation

### 4.3 Multiple views on the same source page

Do not duplicate the PDF page itself.

Instead, duplicate the **takeoff view**:

- same `SourcePage`
- same calibration
- separate overlay objects
- separate completion scope
- optional ghosted context from other views

This keeps one geometric truth while removing visual clutter.

## 5. AI Role

### 5.1 AI should do

- title block extraction
- page capability scoring
- recommended page selection
- suggested zone polygons
- suggested wall runs
- height-note extraction
- wall-type / framing-note extraction
- opening suggestions
- missing-scope warnings

### 5.2 AI should not do

- final dimensional truth
- final assembly truth
- autonomous takeoff totals without user confirmation
- full-room-perimeter takeoff that is directly billable

### 5.3 New page capability prompt

Replace broad floor-plan selection with a capability matrix per page:

- exterior wall measurement usefulness
- conditioned/unconditioned zoning usefulness
- wall height usefulness
- opening schedule usefulness
- wall type / framing usefulness
- attic / roof insulation usefulness
- crawlspace / floor insulation usefulness
- garage / basement usefulness
- spec / code usefulness

The selected page set should cover all required capabilities with the fewest pages.

## 6. Persistence Strategy

### 6.1 Immediate refactor approach

Do **not** delete existing legacy columns or tables yet.

Keep `takeoff_sessions` as the session anchor, but add new JSONB columns for the wall-object workspace:

- `page_analysis`
- `views`
- `zones`
- `wall_runs`
- `surfaces`
- `opening_items`
- `completion_checklist`
- `ai_suggestions`
- `viewer_state`

Keep these existing columns but mark them as legacy:

- `traces`
- `classifications`
- `takeoff_regions`

### 6.2 Why JSONB first

Advantages:

- fastest path to shipping the new system
- fewer migrations during rapid iteration
- easier to version the workspace schema
- easier to capture training data

Future option:

- move high-volume entities like wall runs and openings into normalized tables after the model stabilizes

### 6.3 Session schema versioning

Add:

- `workspace_schema_version`
- `workflow_version`

This will let the app migrate older sessions safely.

## 7. Viewer Plan

The PDF viewer is foundational. It must be treated as infrastructure, not feature code.

### 7.1 Keep

- `components/takeoff/BlueprintViewer.tsx`
- `lib/pdf/extract-vectors.ts`

These are a better starting point than `components/pdf/PDFViewer.tsx`.

### 7.2 Replace / consolidate

- retire `components/pdf/PDFViewer.tsx` as the main takeoff viewer
- evolve `BlueprintViewer` into the shared robust canvas viewer

### 7.3 Viewer requirements

- exact round-trip coordinate conversion
- fit-to-view and cursor-centered zoom
- stable high zoom without canvas crashes
- cached snap points per page
- page metadata caching
- keyboard panning
- view state persistence per page
- optional ghost layers for other takeoff views
- optional AI hint overlays

### 7.4 Engineering tasks

- extract coordinate transform logic into `lib/pdf/geometry.ts`
- add round-trip tests for:
  - `css -> pdf -> css`
  - page scale changes
  - page switch resets
- add viewer state persistence per source page
- add snap point cache keyed by `documentId + pageIndex`
- split render and interaction layers cleanly

## 8. Repo Inventory: Keep / Replace / Fence Off

### 8.1 Keep and evolve

- `app/projects/[id]/takeoff/page.tsx`
- `components/takeoff/BlueprintViewer.tsx`
- `components/takeoff/CalibrationOverlay.tsx`
- `components/takeoff/CalibrationBanner.tsx`
- `lib/pdf/extract-vectors.ts`
- `lib/pdf/crop-trace-region.ts`
- `app/api/takeoff/classify-pages/route.ts`
- `app/api/takeoff/analyze-page-details/route.ts`
- `app/api/takeoff/sessions/route.ts`
- `app/api/takeoff/sessions/[id]/route.ts`
- `lib/stores/takeoff-store.ts` as a temporary home, but it must be rewritten
- `supabase/migrations/20260323000001_add_takeoff_tables.sql`
- `supabase/migrations/20260330000001_add_calibrated_takeoff_columns.sql`

### 8.2 Replace with new architecture

- `components/takeoff/ToolBar.tsx`
- `components/takeoff/SegmentList.tsx`
- `components/takeoff/RunningTotal.tsx`
- `components/takeoff/WallTraceOverlay.tsx`
- `components/takeoff/BlueprintWorkspace.tsx`
- `lib/takeoff/zone-classifier.ts`
- `lib/stores/takeoff-store.ts`

### 8.3 Fence off as legacy

- `app/api/extract/route.ts`
- `app/api/extract-ocr/route.ts`
- `app/projects/[id]/extract/page.tsx`
- `app/projects/[id]/review/page.tsx`
- `lib/ai/prompts.ts`
- `lib/ai/parsers.ts`
- `lib/calculations/insulation.ts`
- `lib/extraction/resolveActiveMode.ts`
- `rooms`, `openings`, `measurements`, `takeoff_envelope` usage as primary quote inputs
- `components/takeoff/RegionCard.tsx`
- `components/takeoff/RegionModal.tsx`
- `components/takeoff/RegionOverlay.tsx`
- `takeoff_regions` as primary workflow storage

### 8.4 Legacy policy

Do not delete legacy code yet.

Instead:

- mark old routes/components as legacy in code comments and docs
- remove them from the main user path
- stop adding new features to them

## 9. Quote Integration Plan

The quote page must stop reading the old extraction model as the primary source.

### 9.1 Current issue

`app/projects/[id]/quote/page.tsx` reads:

- `rooms`
- `extraction_runs`
- `documents.takeoff_envelope`

This bypasses the new takeoff session entirely.

### 9.2 Target

`quote/page.tsx` should load the latest completed or in-review takeoff session and build quote areas from:

- wall runs
- surfaces
- openings
- assembly assignments
- completion checklist

### 9.3 Migration path

Phase 1:

- support quote generation from `takeoff_sessions` only for the new takeoff route
- keep legacy OCR quote logic behind fallback behavior

Phase 2:

- move quote page to a unified domain adapter:
  - `legacyExtraction -> QuoteInput`
  - `wallObjectTakeoff -> QuoteInput`

Phase 3:

- make wall-object takeoff the default path

## 10. Training Data Plan

The new manual workflow should intentionally produce structured training data.

Store:

- source page capability scores
- chosen pages vs rejected pages
- AI page suggestions vs user selection
- AI zone suggestions vs final zones
- AI wall suggestions vs final wall runs
- AI openings vs confirmed openings
- AI height suggestions vs confirmed heights
- final assembly assignments
- completion checklist state

This creates high-quality supervision for future automation.

## 11. Concrete Build Phases

### Phase 0: Stabilize the current branch

Goals:

- no data loss
- clean typecheck
- safe persistence

Tasks:

- fix trace-continue / cancel data loss in `lib/stores/takeoff-store.ts`
- repair `npx tsc --noEmit`
- add resume-last-session behavior to `app/projects/[id]/takeoff/page.tsx`
- disable or hide `AI Rooms` as a billable measurement path

### Phase 1: Introduce the new workspace schema

Goals:

- make the new domain explicit
- stop building on `traces/classifications` as the future model

Tasks:

- add migration for new `takeoff_sessions` JSONB fields
- create `lib/types/takeoff-v2.ts`
- add adapters:
  - `legacyTraceSession -> v2 workspace`
  - `v2 workspace -> quote input`

### Phase 2: Rebuild the store

Goals:

- store should reflect the product model directly

New store slices:

- session
- source pages
- calibrations
- views
- zones
- wall runs
- surfaces
- openings
- checklist
- viewer state
- ai suggestions

Tasks:

- replace `lib/stores/takeoff-store.ts`
- add derived selectors for:
  - wall quantities
  - surface quantities
  - assembly totals
  - missing scope

### Phase 3: Rebuild the workspace shell

Goals:

- guided workflow
- less clutter

Replace `BlueprintWorkspace.tsx` with:

- left rail: source pages + capability/status
- center: viewer
- right rail: task-oriented inspector

Primary task tabs:

- Pages
- Calibrate
- Views
- Zones
- Walls
- Surfaces
- Openings
- Review

### Phase 4: Replace drawing tools

Goals:

- move from low-level trace segments to domain objects

Tasks:

- zone drawing overlay
- wall-run drawing overlay
- surface drawing overlay
- opening placement tool
- preset panel
- per-view visibility and ghosting

### Phase 5: Quote integration

Goals:

- the new takeoff route actually powers quoting

Tasks:

- build `lib/takeoff/to-quote-input.ts`
- update `app/projects/[id]/quote/page.tsx`
- show source-of-truth badge:
  - `Wall Object Takeoff`
  - `Legacy OCR`

### Phase 6: Legacy containment

Goals:

- reduce confusion

Tasks:

- remove legacy extraction routes from primary navigation
- mark OCR/review flow as legacy
- keep the code for reference only
- update docs and project page CTAs to point to the new route

## 12. First Implementation Slice

Build this first before broader UI work:

1. stabilize current branch
2. add session resume
3. introduce v2 workspace schema
4. build `TakeoffView` support
5. add `Zone` entities
6. add `WallRun` entities
7. drive quote totals from the session

That sequence produces a usable spine before deeper automation.

## 13. Non-Goals for the First Refactor Pass

- full automatic wall detection
- perfect AI opening detection
- normalized relational schema for every takeoff object
- deleting all legacy code
- rewriting the Python `pdfengine` first

## 14. Success Criteria

This refactor is successful when:

- the takeoff route owns the quote inputs
- the viewer is stable at all supported zoom levels
- the user can work in multiple scoped views on the same page
- the system distinguishes zones, walls, surfaces, and openings cleanly
- a finished takeoff is defined by a completion checklist, not by ad hoc traced segments
- every confirmed object can be used as training data
