# UI-Guided Insulation Takeoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive takeoff workflow where AI suggests wall regions on blueprint pages, the user confirms each one, and OCR measures the confirmed regions precisely.

**Architecture:** Next.js app with Zustand state management. PDF rendered via react-pdf with SVG overlay for regions. Vision AI (Claude) identifies wall regions; pdfengine OCR pipeline analyzes cropped regions server-side. Results persist to Supabase.

**Tech Stack:** Next.js 16, React 19, react-pdf 9, Zustand 5, Tailwind 3, Supabase, Claude Vision API, pdfengine OCR pipeline (Python/PyMuPDF/PaddleOCR)

**Spec:** `docs/specs/2026-03-23-ui-guided-takeoff-design.md`

---

## File Structure

### New Files (Frontend — `Insulation/`)

```
app/projects/[id]/takeoff/
  page.tsx                          # Main takeoff workflow page (Step 2-5 orchestrator)

components/takeoff/
  PageSelector.tsx                  # Filmstrip + preview (Step 2)
  BlueprintWorkspace.tsx            # Blueprint-dominant layout with region overlays (Step 3)
  RegionOverlay.tsx                 # SVG overlay for drawing/displaying regions on PDF
  RegionCard.tsx                    # Right panel card per region
  RegionModal.tsx                   # Stacked analysis modal (Step 4)
  RunningTotal.tsx                  # Running total footer in right panel
  TakeoffSummary.tsx                # Final summary before quote (Step 5)
  ToolBar.tsx                       # Pointer / rectangle-draw / zoom tools

lib/stores/
  takeoff-store.ts                  # Zustand store for takeoff session state

lib/types/
  takeoff.ts                        # TypeScript types for regions, sessions, analysis results

api/takeoff/
  analyze-page/route.ts             # POST — Vision AI region suggestions
  analyze-region/route.ts           # POST — OCR pipeline on cropped region
  sessions/route.ts                 # GET/POST — takeoff session CRUD
  sessions/[id]/regions/route.ts    # GET/POST/PUT — region CRUD

supabase/migrations/
  20260323000001_add_takeoff_tables.sql  # takeoff_sessions + takeoff_regions tables
```

### New Files (Backend — `pdfengine/`)

```
packages/ml/src/pipeline/
  region_adapter.py                 # RegionPipelineAdapter — OCR on cropped images

packages/shared/src/models/
  region_models.py                  # RegionAnalysisResult, DetectedDimension, DetectedOpening

apps/api/src/routes/
  takeoff.py                        # /takeoff/analyze-page, /takeoff/analyze-region endpoints

tests/unit/
  test_region_adapter.py            # Unit tests for RegionPipelineAdapter

tests/integration/
  test_region_adapter_gamache.py    # Integration test with Gamache crop
```

### Modified Files

```
Insulation/app/projects/[id]/page.tsx    # Add "Start Takeoff" button linking to /takeoff
pdfengine/apps/api/src/main.py           # Register takeoff router
```

---

## Task 1: Database Schema — Takeoff Tables

**Files:**
- Create: `Insulation/supabase/migrations/20260323000001_add_takeoff_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Takeoff sessions: one per document being analyzed
CREATE TABLE takeoff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  selected_pages INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Takeoff regions: one per wall section analyzed
CREATE TABLE takeoff_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES takeoff_sessions(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  wall_type TEXT NOT NULL DEFAULT 'exterior'
    CHECK (wall_type IN ('exterior', 'garage', 'basement', 'other')),
  source TEXT NOT NULL DEFAULT 'ai'
    CHECK (source IN ('ai', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'analyzing', 'confirmed', 'rejected')),
  bbox JSONB NOT NULL, -- {x, y, width, height} as % of page (0-100)
  wall_length_lf REAL,
  wall_height_ft REAL,
  gross_sf REAL,
  net_sf REAL,
  openings JSONB DEFAULT '[]',
  raw_ocr_result JSONB,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_takeoff_sessions_project ON takeoff_sessions(project_id);
CREATE INDEX idx_takeoff_sessions_document ON takeoff_sessions(document_id);
CREATE INDEX idx_takeoff_regions_session ON takeoff_regions(session_id);

-- RLS (permissive for now, matching existing pattern)
ALTER TABLE takeoff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_takeoff_sessions" ON takeoff_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_takeoff_regions" ON takeoff_regions FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger (reuse existing pattern)
CREATE OR REPLACE FUNCTION update_takeoff_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_takeoff_sessions_updated_at
  BEFORE UPDATE ON takeoff_sessions
  FOR EACH ROW EXECUTE FUNCTION update_takeoff_updated_at();
```

- [ ] **Step 2: Apply migration**

Run: `cd Insulation && npx supabase db push` (or apply via Supabase dashboard)
Expected: Tables created, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260323000001_add_takeoff_tables.sql
git commit -m "feat: add takeoff_sessions and takeoff_regions tables"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `Insulation/lib/types/takeoff.ts`

- [ ] **Step 1: Define types**

```typescript
// lib/types/takeoff.ts

export interface BBox {
  x: number;      // % of page width (0-100)
  y: number;      // % of page height (0-100)
  width: number;  // % of page width
  height: number; // % of page height
}

export type WallType = 'exterior' | 'garage' | 'basement' | 'other';
export type RegionSource = 'ai' | 'manual';
export type RegionStatus = 'pending' | 'analyzing' | 'confirmed' | 'rejected';
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface DetectedDimension {
  id: string;
  value_ft: number;
  raw_text: string;
  confidence: number;
  position: { x: number; y: number }; // % coordinates within crop
  selected: boolean; // user toggle — included in wall length sum
}

export interface DetectedOpening {
  id: string;
  type: 'door' | 'window';
  width_ft: number;
  height_ft: number;
  area_sf: number;
  confidence: number;
  label: string; // e.g., "Door 3'0\" × 6'8\""
}

export interface RegionAnalysisResult {
  detected_dimensions: DetectedDimension[];
  suggested_wall_length_lf: number;
  detected_height_ft: number | null;
  openings: DetectedOpening[];
  gross_sf: number;
  net_sf: number;
  confidence: number;
}

export interface TakeoffRegion {
  id: string;
  session_id: string;
  page_index: number;
  label: string;
  wall_type: WallType;
  source: RegionSource;
  status: RegionStatus;
  bbox: BBox;
  wall_length_lf: number | null;
  wall_height_ft: number | null;
  gross_sf: number | null;
  net_sf: number | null;
  openings: DetectedOpening[];
  analysis_result: RegionAnalysisResult | null;
  confirmed_at: string | null;
}

export interface TakeoffSession {
  id: string;
  project_id: string;
  document_id: string;
  status: SessionStatus;
  selected_pages: number[];
  regions: TakeoffRegion[];
  created_at: string;
  updated_at: string;
}

export interface VisionRegionSuggestion {
  label: string;
  wall_type: WallType;
  bbox: BBox;
}

export interface PageScore {
  page_index: number;
  score: number;
  label: string; // e.g., "Main Floor Plan"
  ai_selected: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types/takeoff.ts
git commit -m "feat: add TypeScript types for takeoff workflow"
```

---

## Task 3: Zustand Store

**Files:**
- Create: `Insulation/lib/stores/takeoff-store.ts`

- [ ] **Step 1: Create the store**

```typescript
// lib/stores/takeoff-store.ts
import { create } from 'zustand';
import type {
  TakeoffSession,
  TakeoffRegion,
  RegionStatus,
  VisionRegionSuggestion,
  RegionAnalysisResult,
  PageScore,
  BBox,
  WallType,
} from '@/lib/types/takeoff';

interface TakeoffState {
  // Session
  session: TakeoffSession | null;
  currentStep: 'page-selection' | 'workspace' | 'summary';

  // Page selection
  pageScores: PageScore[];
  selectedPages: number[];
  previewPageIndex: number;

  // Workspace
  activePageIndex: number;
  activeRegionId: string | null;
  modalRegionId: string | null; // region being reviewed in modal
  isDrawing: boolean;
  tool: 'pointer' | 'rectangle';

  // Vision cache: keyed by pageIndex
  visionCache: Record<number, VisionRegionSuggestion[]>;
  visionLoading: Record<number, boolean>;

  // Actions — session
  setSession: (session: TakeoffSession) => void;
  setStep: (step: TakeoffState['currentStep']) => void;

  // Actions — page selection
  setPageScores: (scores: PageScore[]) => void;
  togglePage: (pageIndex: number) => void;
  setPreviewPage: (pageIndex: number) => void;
  confirmPageSelection: () => void;

  // Actions — workspace
  setActivePage: (pageIndex: number) => void;
  setTool: (tool: 'pointer' | 'rectangle') => void;
  setDrawing: (drawing: boolean) => void;

  // Actions — regions
  addRegion: (region: TakeoffRegion) => void;
  updateRegionStatus: (regionId: string, status: RegionStatus) => void;
  confirmRegion: (regionId: string, data: {
    wall_length_lf: number;
    wall_height_ft: number;
    gross_sf: number;
    net_sf: number;
    openings: TakeoffRegion['openings'];
  }) => void;
  rejectRegion: (regionId: string) => void;
  openModal: (regionId: string) => void;
  closeModal: () => void;

  // Actions — vision
  setVisionResults: (pageIndex: number, regions: VisionRegionSuggestion[]) => void;
  setVisionLoading: (pageIndex: number, loading: boolean) => void;

  // Computed
  getRegionsForPage: (pageIndex: number) => TakeoffRegion[];
  getConfirmedRegions: () => TakeoffRegion[];
  getRunningTotal: () => { gross_sf: number; net_sf: number; region_count: number; confirmed_count: number };
}

export const useTakeoffStore = create<TakeoffState>((set, get) => ({
  session: null,
  currentStep: 'page-selection',
  pageScores: [],
  selectedPages: [],
  previewPageIndex: 0,
  activePageIndex: 0,
  activeRegionId: null,
  modalRegionId: null,
  isDrawing: false,
  tool: 'pointer',
  visionCache: {},
  visionLoading: {},

  setSession: (session) => set({ session }),
  setStep: (step) => set({ currentStep: step }),

  setPageScores: (scores) => set({
    pageScores: scores,
    selectedPages: scores.filter((s) => s.ai_selected).map((s) => s.page_index),
    previewPageIndex: scores.find((s) => s.ai_selected)?.page_index ?? 0,
  }),

  togglePage: (pageIndex) => set((state) => {
    const selected = state.selectedPages.includes(pageIndex)
      ? state.selectedPages.filter((p) => p !== pageIndex)
      : [...state.selectedPages, pageIndex].sort((a, b) => a - b);
    return { selectedPages: selected };
  }),

  setPreviewPage: (pageIndex) => set({ previewPageIndex: pageIndex }),

  confirmPageSelection: () => set((state) => ({
    currentStep: 'workspace',
    activePageIndex: state.selectedPages[0] ?? 0,
  })),

  setActivePage: (pageIndex) => set({ activePageIndex: pageIndex }),
  setTool: (tool) => set({ tool }),
  setDrawing: (drawing) => set({ isDrawing: drawing }),

  addRegion: (region) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: [...state.session.regions, region],
      },
    };
  }),

  updateRegionStatus: (regionId, status) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: state.session.regions.map((r) =>
          r.id === regionId ? { ...r, status } : r
        ),
      },
    };
  }),

  confirmRegion: (regionId, data) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: state.session.regions.map((r) =>
          r.id === regionId
            ? {
                ...r,
                status: 'confirmed' as const,
                wall_length_lf: data.wall_length_lf,
                wall_height_ft: data.wall_height_ft,
                gross_sf: data.gross_sf,
                net_sf: data.net_sf,
                openings: data.openings,
                confirmed_at: new Date().toISOString(),
              }
            : r
        ),
      },
      modalRegionId: null,
    };
  }),

  rejectRegion: (regionId) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: state.session.regions.map((r) =>
          r.id === regionId ? { ...r, status: 'rejected' as const } : r
        ),
      },
      modalRegionId: null,
    };
  }),

  openModal: (regionId) => set({ modalRegionId: regionId }),
  closeModal: () => set({ modalRegionId: null }),

  setVisionResults: (pageIndex, regions) => set((state) => ({
    visionCache: { ...state.visionCache, [pageIndex]: regions },
    visionLoading: { ...state.visionLoading, [pageIndex]: false },
  })),

  setVisionLoading: (pageIndex, loading) => set((state) => ({
    visionLoading: { ...state.visionLoading, [pageIndex]: loading },
  })),

  getRegionsForPage: (pageIndex) => {
    const session = get().session;
    if (!session) return [];
    return session.regions.filter((r) => r.page_index === pageIndex && r.status !== 'rejected');
  },

  getConfirmedRegions: () => {
    const session = get().session;
    if (!session) return [];
    return session.regions.filter((r) => r.status === 'confirmed');
  },

  getRunningTotal: () => {
    const confirmed = get().getConfirmedRegions();
    return {
      gross_sf: confirmed.reduce((sum, r) => sum + (r.gross_sf ?? 0), 0),
      net_sf: confirmed.reduce((sum, r) => sum + (r.net_sf ?? 0), 0),
      region_count: get().session?.regions.filter((r) => r.status !== 'rejected').length ?? 0,
      confirmed_count: confirmed.length,
    };
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add lib/stores/takeoff-store.ts
git commit -m "feat: add Zustand store for takeoff session state"
```

---

## Task 4: Page Selector Component

**Files:**
- Create: `Insulation/components/takeoff/PageSelector.tsx`

- [ ] **Step 1: Build the filmstrip + preview component**

```tsx
// components/takeoff/PageSelector.tsx
'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { CheckCircle2, X } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PageSelectorProps {
  pdfUrl: string;
  totalPages: number;
  onConfirm: () => void;
  onPdfLoaded?: (numPages: number) => void;
}

export function PageSelector({ pdfUrl, totalPages, onConfirm, onPdfLoaded }: PageSelectorProps) {
  const {
    pageScores,
    selectedPages,
    previewPageIndex,
    togglePage,
    setPreviewPage,
  } = useTakeoffStore();

  const isSelected = (idx: number) => selectedPages.includes(idx);
  const score = (idx: number) => pageScores.find((s) => s.page_index === idx);

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Filmstrip */}
      <div className="w-[100px] bg-zinc-950 border-r border-zinc-800 p-2 overflow-y-auto flex flex-col gap-2">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider px-1 mb-1">
          Pages
        </div>
        {Array.from({ length: totalPages }, (_, i) => (
          <button
            key={i}
            onClick={() => setPreviewPage(i)}
            className={`relative rounded border-2 overflow-hidden transition-all ${
              previewPageIndex === i
                ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-950'
                : ''
            } ${
              isSelected(i)
                ? 'border-blue-600'
                : 'border-zinc-800 opacity-50 hover:opacity-75'
            }`}
          >
            {isSelected(i) && (
              <div className="absolute top-1 right-1 z-10 w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-white" />
              </div>
            )}
            {score(i)?.ai_selected && (
              <div className="absolute top-1 left-1 z-10 text-[7px] bg-blue-600 text-white px-1 rounded">
                AI
              </div>
            )}
            <div className="h-[60px] bg-zinc-900 flex items-center justify-center">
              <Document file={pdfUrl} loading={null}>
                <Page
                  pageNumber={i + 1}
                  width={80}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </Document>
            </div>
            <div className="px-1 py-0.5 bg-zinc-900 border-t border-zinc-800">
              <div className={`text-[9px] truncate ${isSelected(i) ? 'text-blue-400' : 'text-zinc-600'}`}>
                {score(i)?.label ?? `Page ${i + 1}`}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Preview */}
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center">
          <div>
            <div className="text-sm text-white font-medium">
              Page {previewPageIndex + 1} — {score(previewPageIndex)?.label ?? 'Unknown'}
            </div>
            {score(previewPageIndex)?.ai_selected && (
              <div className="text-xs text-blue-400 mt-0.5">
                {Math.round((score(previewPageIndex)?.score ?? 0) * 100)}% confidence — insulation-relevant
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (isSelected(previewPageIndex)) togglePage(previewPageIndex);
              }}
              className={`px-3 py-1.5 text-xs rounded border ${
                !isSelected(previewPageIndex)
                  ? 'border-zinc-700 text-zinc-500 cursor-default'
                  : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
              }`}
            >
              Skip
            </button>
            <button
              onClick={() => {
                if (!isSelected(previewPageIndex)) togglePage(previewPageIndex);
              }}
              className={`px-3 py-1.5 text-xs rounded ${
                isSelected(previewPageIndex)
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-blue-600 hover:text-white'
              }`}
            >
              {isSelected(previewPageIndex) ? 'Included ✓' : 'Include'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center bg-zinc-900 p-4">
          <Document
            file={pdfUrl}
            loading={<div className="text-zinc-600">Loading...</div>}
            onLoadSuccess={(pdf) => onPdfLoaded?.(pdf.numPages)}
          >
            <Page
              pageNumber={previewPageIndex + 1}
              className="shadow-2xl"
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        </div>

        {/* Bottom action bar */}
        <div className="px-4 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-between items-center">
          <div className="text-xs text-zinc-500">
            {selectedPages.length} page{selectedPages.length !== 1 ? 's' : ''} selected
          </div>
          <button
            onClick={onConfirm}
            disabled={selectedPages.length === 0}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue with {selectedPages.length} page{selectedPages.length !== 1 ? 's' : ''} →
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/takeoff/PageSelector.tsx
git commit -m "feat: add PageSelector filmstrip + preview component"
```

---

## Task 5: Region Overlay (SVG)

**Files:**
- Create: `Insulation/components/takeoff/RegionOverlay.tsx`

- [ ] **Step 1: Build SVG overlay for drawing and displaying regions**

```tsx
// components/takeoff/RegionOverlay.tsx
'use client';

import { useRef, useState, useCallback } from 'react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BBox, TakeoffRegion } from '@/lib/types/takeoff';

interface RegionOverlayProps {
  pageWidth: number;
  pageHeight: number;
  regions: TakeoffRegion[];
  onRegionClick: (regionId: string) => void;
  onRegionDrawn: (bbox: BBox) => void;
}

export function RegionOverlay({
  pageWidth,
  pageHeight,
  regions,
  onRegionClick,
  onRegionDrawn,
}: RegionOverlayProps) {
  const { tool, isDrawing, setDrawing } = useTakeoffStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  const toPercent = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (tool !== 'rectangle') return;
      const pos = toPercent(e.clientX, e.clientY);
      setDrawStart(pos);
      setDrawCurrent(pos);
      setDrawing(true);
    },
    [tool, toPercent, setDrawing]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing || !drawStart) return;
      setDrawCurrent(toPercent(e.clientX, e.clientY));
    },
    [isDrawing, drawStart, toPercent]
  );

  const handleMouseUp = useCallback(() => {
    if (!drawStart || !drawCurrent) {
      setDrawing(false);
      return;
    }
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const width = Math.abs(drawCurrent.x - drawStart.x);
    const height = Math.abs(drawCurrent.y - drawStart.y);

    // Minimum size: 3% in each dimension
    if (width > 3 && height > 3) {
      onRegionDrawn({ x, y, width, height });
    }

    setDrawStart(null);
    setDrawCurrent(null);
    setDrawing(false);
  }, [drawStart, drawCurrent, onRegionDrawn, setDrawing]);

  const regionColor = (status: TakeoffRegion['status']) => {
    switch (status) {
      case 'confirmed': return { stroke: '#22c55e', fill: '#22c55e08', dash: 'none' };
      case 'analyzing': return { stroke: '#f59e0b', fill: '#f59e0b08', dash: '6 3' };
      case 'pending': return { stroke: '#3b82f6', fill: '#3b82f608', dash: '6 3' };
      default: return { stroke: '#666', fill: 'none', dash: '4 4' };
    }
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: tool === 'rectangle' ? 'crosshair' : 'default' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Existing regions */}
      {regions.map((region) => {
        const color = regionColor(region.status);
        return (
          <g
            key={region.id}
            onClick={(e) => {
              e.stopPropagation();
              if (tool === 'pointer') onRegionClick(region.id);
            }}
            style={{ cursor: tool === 'pointer' ? 'pointer' : 'crosshair' }}
          >
            <rect
              x={`${region.bbox.x}%`}
              y={`${region.bbox.y}%`}
              width={`${region.bbox.width}%`}
              height={`${region.bbox.height}%`}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={2}
              strokeDasharray={color.dash}
              rx={2}
            />
            {/* Label */}
            <foreignObject
              x={`${region.bbox.x}%`}
              y={`${region.bbox.y - 3}%`}
              width={`${Math.max(region.bbox.width, 15)}%`}
              height="3%"
            >
              <div className="text-[9px] px-1 rounded truncate"
                style={{
                  color: color.stroke,
                  backgroundColor: `${color.stroke}22`,
                }}>
                {region.status === 'confirmed' ? '✓ ' : ''}
                {region.label}
                {region.net_sf != null ? ` — ${Math.round(region.net_sf)} SF` : ''}
              </div>
            </foreignObject>
          </g>
        );
      })}

      {/* Drawing preview */}
      {drawStart && drawCurrent && (
        <rect
          x={`${Math.min(drawStart.x, drawCurrent.x)}%`}
          y={`${Math.min(drawStart.y, drawCurrent.y)}%`}
          width={`${Math.abs(drawCurrent.x - drawStart.x)}%`}
          height={`${Math.abs(drawCurrent.y - drawStart.y)}%`}
          fill="#3b82f608"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="6 3"
          rx={2}
        />
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/takeoff/RegionOverlay.tsx
git commit -m "feat: add RegionOverlay SVG for drawing and displaying regions"
```

---

## Task 6: Region Card + Running Total

**Files:**
- Create: `Insulation/components/takeoff/RegionCard.tsx`
- Create: `Insulation/components/takeoff/RunningTotal.tsx`

- [ ] **Step 1: Build RegionCard**

```tsx
// components/takeoff/RegionCard.tsx
'use client';

import type { TakeoffRegion } from '@/lib/types/takeoff';

interface RegionCardProps {
  region: TakeoffRegion;
  onClick: () => void;
}

export function RegionCard({ region, onClick }: RegionCardProps) {
  const isConfirmed = region.status === 'confirmed';
  const isPending = region.status === 'pending';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        isConfirmed
          ? 'bg-zinc-900 border-green-500/30'
          : 'bg-zinc-900 border-blue-500/30 hover:border-blue-500/60'
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-zinc-200 font-medium">{region.label}</span>
        {isConfirmed ? (
          <span className="text-[10px] text-green-500 bg-green-500/10 px-2 py-0.5 rounded">✓ Done</span>
        ) : (
          <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">Analyze →</span>
        )}
      </div>
      {isConfirmed && region.net_sf != null ? (
        <>
          <div className="text-xs text-zinc-500">
            {region.wall_length_lf} LF × {region.wall_height_ft}'
          </div>
          <div className="text-base text-white font-semibold mt-1">
            {Math.round(region.net_sf).toLocaleString()} SF
          </div>
          {region.openings.length > 0 && (
            <div className="text-[10px] text-zinc-600 mt-0.5">
              {region.openings.length} opening{region.openings.length > 1 ? 's' : ''} subtracted
            </div>
          )}
        </>
      ) : (
        <div className="text-[10px] text-zinc-600 mt-0.5">
          {region.source === 'ai' ? 'AI detected' : 'Manual'} • not yet confirmed
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Build RunningTotal**

```tsx
// components/takeoff/RunningTotal.tsx
'use client';

import { useTakeoffStore } from '@/lib/stores/takeoff-store';

interface RunningTotalProps {
  onGenerateQuote: () => void;
}

export function RunningTotal({ onGenerateQuote }: RunningTotalProps) {
  const { net_sf, region_count, confirmed_count } = useTakeoffStore(
    (s) => s.getRunningTotal()
  );

  const progress = region_count > 0 ? (confirmed_count / region_count) * 100 : 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
      <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
        Running Total
      </div>
      <div className="text-2xl text-white font-bold mt-1">
        {Math.round(net_sf).toLocaleString()} SF
      </div>
      <div className="text-xs text-zinc-500 mt-0.5">
        {confirmed_count} of {region_count} regions confirmed
      </div>
      <div className="h-1 bg-zinc-800 rounded-full mt-2">
        <div
          className="h-1 bg-green-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <button
        onClick={onGenerateQuote}
        disabled={confirmed_count === 0}
        className="w-full mt-3 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Generate Quote →
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/takeoff/RegionCard.tsx components/takeoff/RunningTotal.tsx
git commit -m "feat: add RegionCard and RunningTotal components"
```

---

## Task 7: Region Analysis Modal

**Files:**
- Create: `Insulation/components/takeoff/RegionModal.tsx`

- [ ] **Step 1: Build the stacked modal**

```tsx
// components/takeoff/RegionModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { RegionAnalysisResult, DetectedOpening } from '@/lib/types/takeoff';

interface RegionModalProps {
  regionId: string;
  onAnalyze: (regionId: string) => Promise<RegionAnalysisResult>;
}

const HEIGHT_OPTIONS = [8, 9, 10] as const;

export function RegionModal({ regionId, onAnalyze }: RegionModalProps) {
  const { session, confirmRegion, rejectRegion, closeModal } = useTakeoffStore();
  const region = session?.regions.find((r) => r.id === regionId);

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<RegionAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable state
  const [wallLength, setWallLength] = useState(0);
  const [wallHeight, setWallHeight] = useState<number | null>(null);
  const [customHeight, setCustomHeight] = useState('');
  const [openings, setOpenings] = useState<DetectedOpening[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    onAnalyze(regionId)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setWallLength(res.suggested_wall_length_lf);
        setWallHeight(res.detected_height_ft);
        setOpenings(res.openings);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? 'Analysis failed');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [regionId, onAnalyze]);

  if (!region) return null;

  const effectiveHeight = wallHeight ?? 0;
  const grossSf = wallLength * effectiveHeight;
  const openingsSf = openings.reduce((sum, o) => sum + o.area_sf, 0);
  const netSf = Math.max(0, grossSf - openingsSf);

  const handleConfirm = () => {
    if (!wallHeight) return;
    confirmRegion(regionId, {
      wall_length_lf: wallLength,
      wall_height_ft: wallHeight,
      gross_sf: grossSf,
      net_sf: netSf,
      openings,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] max-h-[90vh] bg-zinc-900 border border-zinc-700 rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex justify-between items-center">
          <div>
            <div className="text-sm text-white font-semibold">{region.label}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {region.source === 'ai' ? 'AI-detected' : 'Manual'} region
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => rejectRegion(regionId)}
              className="text-[10px] text-red-400 border border-red-400/30 px-2 py-1 rounded hover:bg-red-400/10"
            >
              Reject
            </button>
            <button onClick={closeModal} className="text-zinc-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <div className="text-sm text-zinc-400">Analyzing region...</div>
              <div className="text-[10px] text-zinc-600">Running OCR on cropped area</div>
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <div className="text-sm text-red-400">{error}</div>
              <button
                onClick={() => { setLoading(true); onAnalyze(regionId).then(setResult).catch((e) => setError(e.message)); }}
                className="mt-3 text-xs text-blue-400 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-zinc-800 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-zinc-500 uppercase">Length</div>
                  {editing ? (
                    <input
                      type="number"
                      value={wallLength}
                      onChange={(e) => setWallLength(Number(e.target.value))}
                      className="w-full bg-zinc-700 text-white text-center text-lg font-semibold rounded mt-1 px-1 py-0.5"
                    />
                  ) : (
                    <div className="text-lg text-white font-semibold">{Math.round(wallLength)} LF</div>
                  )}
                </div>
                <div className="bg-zinc-800 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-zinc-500 uppercase">Height</div>
                  <div className="text-lg text-white font-semibold">
                    {wallHeight ? `${wallHeight}'` : '—'}
                  </div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-zinc-500 uppercase">Gross</div>
                  <div className="text-lg text-white font-semibold">
                    {wallHeight ? Math.round(grossSf).toLocaleString() : '—'}
                  </div>
                </div>
              </div>

              {/* Height selector */}
              <div className="mb-4">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                  Wall Height {!result?.detected_height_ft && '(not detected — please select)'}
                </div>
                <div className="flex gap-2">
                  {HEIGHT_OPTIONS.map((h) => (
                    <button
                      key={h}
                      onClick={() => { setWallHeight(h); setCustomHeight(''); }}
                      className={`flex-1 py-1.5 rounded text-sm ${
                        wallHeight === h
                          ? 'bg-blue-600/30 border border-blue-500 text-blue-400'
                          : 'bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-white'
                      }`}
                    >
                      {h}'
                    </button>
                  ))}
                  <div className="flex-1">
                    <input
                      type="number"
                      placeholder="Custom"
                      value={customHeight}
                      onChange={(e) => {
                        setCustomHeight(e.target.value);
                        const v = Number(e.target.value);
                        if (v > 0) setWallHeight(v);
                      }}
                      className="w-full py-1.5 px-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-600 text-center"
                    />
                  </div>
                </div>
              </div>

              {/* Openings */}
              <div className="mb-4">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                  Openings ({openings.length} found)
                </div>
                <div className="flex flex-col gap-1">
                  {openings.map((o) => (
                    <div key={o.id} className="flex justify-between items-center px-2 py-1.5 bg-zinc-800 rounded">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{o.type === 'door' ? '🚪' : '▢'}</span>
                        <span className="text-xs text-zinc-300">{o.label}</span>
                      </div>
                      <span className="text-xs text-red-400">−{Math.round(o.area_sf)} SF</span>
                    </div>
                  ))}
                </div>
                {openings.length > 0 && (
                  <div className="flex justify-between mt-2 pt-2 border-t border-zinc-800">
                    <span className="text-[10px] text-zinc-500">Total opening area</span>
                    <span className="text-xs text-red-400 font-medium">
                      −{Math.round(openingsSf)} SF
                    </span>
                  </div>
                )}
              </div>

              {/* NET result */}
              {wallHeight && (
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-zinc-500 uppercase">Net Insulation Area</div>
                  <div className="text-2xl text-green-500 font-bold">
                    {Math.round(netSf).toLocaleString()} SF
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {Math.round(grossSf).toLocaleString()} gross − {Math.round(openingsSf)} openings
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div className="px-4 py-3 border-t border-zinc-800 flex gap-2">
            <button
              onClick={() => setEditing(!editing)}
              className="flex-1 py-2 border border-zinc-700 text-zinc-400 rounded-lg text-sm hover:text-white hover:border-zinc-500"
            >
              {editing ? 'Done Editing' : 'Edit Values'}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!wallHeight}
              className="flex-[2] py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm{netSf > 0 ? ` (${Math.round(netSf).toLocaleString()} SF)` : ''} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/takeoff/RegionModal.tsx
git commit -m "feat: add RegionModal for per-region analysis review"
```

---

## Task 8: Blueprint Workspace

**Files:**
- Create: `Insulation/components/takeoff/BlueprintWorkspace.tsx`
- Create: `Insulation/components/takeoff/ToolBar.tsx`

- [ ] **Step 1: Build ToolBar**

```tsx
// components/takeoff/ToolBar.tsx
'use client';

import { MousePointer2, Square, ZoomIn, ZoomOut } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';

interface ToolBarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function ToolBar({ onZoomIn, onZoomOut }: ToolBarProps) {
  const { tool, setTool } = useTakeoffStore();

  const tools = [
    { id: 'pointer' as const, icon: MousePointer2, label: 'Select' },
    { id: 'rectangle' as const, icon: Square, label: 'Draw region' },
  ];

  return (
    <div className="flex items-center gap-1">
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          title={t.label}
          className={`w-7 h-7 flex items-center justify-center rounded ${
            tool === t.id
              ? 'bg-blue-600/20 border border-blue-500 text-blue-400'
              : 'bg-zinc-900 border border-zinc-700 text-zinc-500 hover:text-white'
          }`}
        >
          <t.icon className="w-3.5 h-3.5" />
        </button>
      ))}
      <div className="w-px h-5 bg-zinc-700 mx-1" />
      <button onClick={onZoomIn} className="w-7 h-7 flex items-center justify-center rounded bg-zinc-900 border border-zinc-700 text-zinc-500 hover:text-white">
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
      <button onClick={onZoomOut} className="w-7 h-7 flex items-center justify-center rounded bg-zinc-900 border border-zinc-700 text-zinc-500 hover:text-white">
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Build BlueprintWorkspace**

```tsx
// components/takeoff/BlueprintWorkspace.tsx
'use client';

import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { RegionOverlay } from './RegionOverlay';
import { RegionCard } from './RegionCard';
import { RegionModal } from './RegionModal';
import { RunningTotal } from './RunningTotal';
import { ToolBar } from './ToolBar';
import type { BBox, RegionAnalysisResult, TakeoffRegion } from '@/lib/types/takeoff';
import { v4 as uuid } from 'uuid';
import { Loader2 } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface BlueprintWorkspaceProps {
  pdfUrl: string;
  documentId: string;
  sessionId: string;
  onGenerateQuote: () => void;
}

export function BlueprintWorkspace({
  pdfUrl,
  documentId,
  sessionId,
  onGenerateQuote,
}: BlueprintWorkspaceProps) {
  const {
    selectedPages,
    activePageIndex,
    setActivePage,
    modalRegionId,
    openModal,
    closeModal,
    addRegion,
    visionLoading,
    session,
  } = useTakeoffStore();

  const [scale, setScale] = useState(1.0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  const regions = useTakeoffStore((s) => s.getRegionsForPage(activePageIndex));
  const isVisionLoading = visionLoading[activePageIndex] ?? false;

  const handleRegionDrawn = useCallback(
    (bbox: BBox) => {
      const newRegion: TakeoffRegion = {
        id: uuid(),
        session_id: sessionId,
        page_index: activePageIndex,
        label: `Custom region`,
        wall_type: 'exterior',
        source: 'manual',
        status: 'pending',
        bbox,
        wall_length_lf: null,
        wall_height_ft: null,
        gross_sf: null,
        net_sf: null,
        openings: [],
        analysis_result: null,
        confirmed_at: null,
      };
      addRegion(newRegion);
      openModal(newRegion.id);
    },
    [activePageIndex, sessionId, addRegion, openModal]
  );

  const handleAnalyzeRegion = useCallback(
    async (regionId: string): Promise<RegionAnalysisResult> => {
      const region = session?.regions.find((r) => r.id === regionId);
      if (!region) throw new Error('Region not found');

      const res = await fetch('/api/takeoff/analyze-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          page_index: region.page_index,
          bbox: region.bbox,
          dpi: 150,
        }),
      });
      if (!res.ok) throw new Error(`Analysis failed: ${res.statusText}`);
      return res.json();
    },
    [documentId, session]
  );

  return (
    <div className="flex h-full bg-zinc-950">
      {/* Blueprint area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar: page tabs + tools */}
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-950 border-b border-zinc-800">
          <div className="flex gap-1">
            {selectedPages.map((pageIdx) => (
              <button
                key={pageIdx}
                onClick={() => setActivePage(pageIdx)}
                className={`px-3 py-1 text-xs rounded ${
                  activePageIndex === pageIdx
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-600/40'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Page {pageIdx + 1}
              </button>
            ))}
          </div>
          <ToolBar
            onZoomIn={() => setScale((s) => Math.min(s + 0.2, 3))}
            onZoomOut={() => setScale((s) => Math.max(s - 0.2, 0.3))}
          />
        </div>

        {/* Blueprint canvas */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-zinc-900/50">
          <div className="relative" style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
            <Document file={pdfUrl} loading={null}>
              <Page
                pageNumber={activePageIndex + 1}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                onLoadSuccess={(page) => setPageSize({ width: page.width, height: page.height })}
              />
            </Document>
            {/* Region overlay on top of PDF */}
            <RegionOverlay
              pageWidth={pageSize.width}
              pageHeight={pageSize.height}
              regions={regions}
              onRegionClick={(id) => openModal(id)}
              onRegionDrawn={handleRegionDrawn}
            />
            {/* Vision loading indicator */}
            {isVisionLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded">
                <div className="flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-lg border border-zinc-700">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  <span className="text-xs text-zinc-400">AI analyzing page...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-[240px] bg-zinc-950 border-l border-zinc-800 flex flex-col p-3 gap-2 overflow-y-auto">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
          Wall Regions
        </div>

        {regions.map((region) => (
          <RegionCard
            key={region.id}
            region={region}
            onClick={() => openModal(region.id)}
          />
        ))}

        {/* Add custom region hint */}
        <button
          onClick={() => useTakeoffStore.getState().setTool('rectangle')}
          className="w-full py-2 border border-dashed border-zinc-700 rounded-lg text-xs text-zinc-600 hover:text-zinc-400 hover:border-zinc-500"
        >
          + Draw custom region
        </button>

        <div className="flex-1" />

        <RunningTotal onGenerateQuote={onGenerateQuote} />
      </div>

      {/* Modal */}
      {modalRegionId && (
        <RegionModal
          regionId={modalRegionId}
          onAnalyze={handleAnalyzeRegion}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/takeoff/BlueprintWorkspace.tsx components/takeoff/ToolBar.tsx
git commit -m "feat: add BlueprintWorkspace with region overlay and right panel"
```

---

## Task 9: Vision AI API Route

**Files:**
- Create: `Insulation/app/api/takeoff/analyze-page/route.ts`

- [ ] **Step 1: Build the Vision analysis endpoint**

```typescript
// app/api/takeoff/analyze-page/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VISION_PROMPT = `You are analyzing a residential construction floor plan for insulation takeoff.

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
All bbox values are percentages (0-100) relative to the page dimensions.`;

export async function POST(request: NextRequest) {
  try {
    const { image_base64, page_index } = await request.json();

    if (!image_base64) {
      return NextResponse.json({ error: 'image_base64 required' }, { status: 400 });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: image_base64 },
            },
            { type: 'text', text: VISION_PROMPT },
          ],
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ regions: [], error: 'No JSON found in response' });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate each region
    const regions = parsed
      .filter((r: any) => r.bbox && typeof r.bbox.x === 'number')
      .map((r: any) => ({
        label: String(r.label ?? 'Unknown wall'),
        wall_type: r.wall_type === 'garage' ? 'garage' : 'exterior',
        bbox: {
          x: Math.max(0, Math.min(100, Number(r.bbox.x))),
          y: Math.max(0, Math.min(100, Number(r.bbox.y))),
          width: Math.max(1, Math.min(100, Number(r.bbox.width))),
          height: Math.max(1, Math.min(100, Number(r.bbox.height))),
        },
      }));

    return NextResponse.json({ regions, page_index });
  } catch (err: any) {
    console.error('Vision analysis error:', err);
    return NextResponse.json({ regions: [], error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/takeoff/analyze-page/route.ts
git commit -m "feat: add Vision AI endpoint for wall region suggestions"
```

---

## Task 10: OCR Region Analysis API Route

**Files:**
- Create: `Insulation/app/api/takeoff/analyze-region/route.ts`

- [ ] **Step 1: Build the OCR analysis proxy endpoint**

This route sends the crop request to the pdfengine backend. The pdfengine's `RegionPipelineAdapter` (Task 12) handles the actual OCR + parsing.

```typescript
// app/api/takeoff/analyze-region/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const PDFENGINE_URL = process.env.PDFENGINE_URL ?? 'http://178.104.21.251:8000';

export async function POST(request: NextRequest) {
  try {
    const { document_id, page_index, bbox, dpi = 150 } = await request.json();

    if (!document_id || page_index == null || !bbox) {
      return NextResponse.json(
        { error: 'document_id, page_index, and bbox required' },
        { status: 400 }
      );
    }

    // Get document PDF URL from Supabase
    const supabase = supabaseAdmin;
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('file_url')
      .eq('id', document_id)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Call pdfengine region analysis endpoint
    const res = await fetch(`${PDFENGINE_URL}/takeoff/analyze-region`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: doc.file_url,
        page_index,
        bbox,
        dpi,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `pdfengine error: ${errText}` },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Region analysis error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/takeoff/analyze-region/route.ts
git commit -m "feat: add OCR region analysis proxy endpoint"
```

---

## Task 11: Main Takeoff Page

**Files:**
- Create: `Insulation/app/projects/[id]/takeoff/page.tsx`
- Modify: `Insulation/app/projects/[id]/page.tsx` — add "Start Takeoff" link

- [ ] **Step 1: Build the takeoff page orchestrator**

```tsx
// app/projects/[id]/takeoff/page.tsx
'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageSelector } from '@/components/takeoff/PageSelector';
import { BlueprintWorkspace } from '@/components/takeoff/BlueprintWorkspace';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { supabase } from '@/lib/supabase/client';
import type { VisionRegionSuggestion, TakeoffRegion, PageScore } from '@/lib/types/takeoff';
import { v4 as uuid } from 'uuid';

export default function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  // supabase imported from '@/lib/supabase/client' at top of file

  const {
    currentStep,
    setStep,
    setPageScores,
    selectedPages,
    confirmPageSelection,
    setSession,
    setVisionResults,
    setVisionLoading,
    addRegion,
    session,
  } = useTakeoffStore();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);

  // totalPages is set by PageSelector's onLoadSuccess callback (see below)

  // Load project document
  useEffect(() => {
    async function load() {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, file_url')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (docs && docs.length > 0) {
        setPdfUrl(docs[0].file_url);
        setDocumentId(docs[0].id);
      }
    }
    load();
  }, [projectId, supabase]);

  // Initialize page scores (simple version — treat all pages as candidates)
  useEffect(() => {
    if (!totalPages) return;
    const scores: PageScore[] = Array.from({ length: totalPages }, (_, i) => ({
      page_index: i,
      score: 0.5,
      label: `Page ${i + 1}`,
      ai_selected: false, // Will be updated by page scorer API later
    }));
    setPageScores(scores);
  }, [totalPages, setPageScores]);

  // When pages are confirmed, create session and trigger Vision analysis
  const handlePagesConfirmed = useCallback(async () => {
    if (!documentId) return;

    // Create session in DB
    const { data: sessionData } = await supabase
      .from('takeoff_sessions')
      .insert({
        project_id: projectId,
        document_id: documentId,
        status: 'in_progress',
        selected_pages: selectedPages,
      })
      .select()
      .single();

    if (sessionData) {
      setSession({
        ...sessionData,
        regions: [],
      });
    }

    confirmPageSelection();

    // Trigger Vision analysis on first selected page
    if (selectedPages.length > 0) {
      triggerVisionAnalysis(selectedPages[0], sessionData?.id);
    }
  }, [documentId, projectId, selectedPages, confirmPageSelection, setSession, supabase]);

  const triggerVisionAnalysis = useCallback(
    async (pageIndex: number, sessionId?: string) => {
      if (!pdfUrl) return;
      setVisionLoading(pageIndex, true);

      try {
        // Render page to image client-side for Vision API
        const { pdfjs } = await import('react-pdf');
        const pdf = await pdfjs.getDocument(pdfUrl).promise;
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const imageBase64 = canvas.toDataURL('image/png').split(',')[1];

        const res = await fetch('/api/takeoff/analyze-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: imageBase64, page_index: pageIndex }),
        });

        const data = await res.json();
        const suggestions: VisionRegionSuggestion[] = data.regions ?? [];
        setVisionResults(pageIndex, suggestions);

        // Add regions to session
        const sid = sessionId ?? session?.id;
        if (sid) {
          for (const s of suggestions) {
            const region: TakeoffRegion = {
              id: uuid(),
              session_id: sid,
              page_index: pageIndex,
              label: s.label,
              wall_type: s.wall_type,
              source: 'ai',
              status: 'pending',
              bbox: s.bbox,
              wall_length_lf: null,
              wall_height_ft: null,
              gross_sf: null,
              net_sf: null,
              openings: [],
              analysis_result: null,
              confirmed_at: null,
            };
            addRegion(region);
          }
        }
      } catch (err) {
        console.error('Vision analysis error:', err);
        setVisionResults(pageIndex, []);
      }
    },
    [pdfUrl, session, setVisionLoading, setVisionResults, addRegion]
  );

  if (!pdfUrl || !documentId) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-500">
        Loading document...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Minimal header */}
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="text-zinc-500 hover:text-white text-sm"
          >
            ← Back
          </button>
          <div className="text-sm text-white font-medium">Insulation Takeoff</div>
        </div>
        <div className="flex items-center gap-2">
          {currentStep !== 'page-selection' && (
            <div className="text-xs text-zinc-600">
              Step {currentStep === 'workspace' ? '2' : '3'} of 3
            </div>
          )}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0">
        {currentStep === 'page-selection' && (
          <PageSelector
            pdfUrl={pdfUrl}
            totalPages={totalPages}
            onConfirm={handlePagesConfirmed}
            onPdfLoaded={(numPages) => setTotalPages(numPages)}
          />
        )}
        {currentStep === 'workspace' && session && (
          <BlueprintWorkspace
            pdfUrl={pdfUrl}
            documentId={documentId}
            sessionId={session.id}
            onGenerateQuote={() => router.push(`/projects/${projectId}/quote`)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Start Takeoff" button to project detail page**

Open `app/projects/[id]/page.tsx` and add a link/button to `/projects/${id}/takeoff` alongside the existing extract button.

- [ ] **Step 3: Commit**

```bash
git add app/projects/[id]/takeoff/page.tsx
git commit -m "feat: add main takeoff page orchestrating the full workflow"
```

---

## Task 12: Backend — RegionPipelineAdapter (pdfengine)

**Files:**
- Create: `pdfengine/packages/ml/src/pipeline/region_adapter.py`
- Create: `pdfengine/packages/shared/src/models/region_models.py`
- Create: `pdfengine/apps/api/src/routes/takeoff.py`
- Modify: `pdfengine/apps/api/src/main.py` — register router

- [ ] **Step 1: Define region models**

```python
# packages/shared/src/models/region_models.py
"""Data models for region-based takeoff analysis."""
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class DetectedDimension(BaseModel):
    """A single dimension value found in the cropped region."""
    id: str
    value_ft: float
    raw_text: str
    confidence: float
    position_x_pct: float  # % position within crop
    position_y_pct: float
    selected: bool = True  # default: included in wall length sum


class DetectedOpening(BaseModel):
    """A door or window detected in the cropped region."""
    id: str
    type: Literal["door", "window"]
    width_ft: float
    height_ft: float
    area_sf: float
    confidence: float
    label: str


class RegionAnalysisResult(BaseModel):
    """Result of OCR analysis on a cropped blueprint region."""
    detected_dimensions: List[DetectedDimension] = Field(default_factory=list)
    suggested_wall_length_lf: float = 0.0
    detected_height_ft: Optional[float] = None
    openings: List[DetectedOpening] = Field(default_factory=list)
    gross_sf: float = 0.0
    net_sf: float = 0.0
    confidence: float = 0.0
    token_count: int = 0
```

- [ ] **Step 2: Build RegionPipelineAdapter**

```python
# packages/ml/src/pipeline/region_adapter.py
"""Region-scoped OCR pipeline adapter.

Takes a cropped blueprint image, runs OCR + dimension parsing,
and returns structured measurements for user review.
"""
import uuid
import time
from pathlib import Path
from typing import Optional
from PIL import Image

from packages.ml.src.text.ocr_engine import PaddleOCREngine
from packages.ml.src.text.dimension_parser import DimensionParser
from packages.ml.src.text.height_note_parser import HeightNoteParser
from packages.ml.src.dimensions.opening_detector import OpeningDetector
from packages.shared.src.models.region_models import (
    RegionAnalysisResult,
    DetectedDimension,
    DetectedOpening,
)


class RegionPipelineAdapter:
    """Analyze a cropped blueprint region for wall measurements."""

    def __init__(self):
        self._ocr_engine = PaddleOCREngine()
        self._dim_parser = DimensionParser()
        self._height_parser = HeightNoteParser()

    def analyze(
        self,
        image: Image.Image,
        dpi: int = 150,
        page_index: int = 0,
    ) -> RegionAnalysisResult:
        """Run OCR pipeline on a cropped region image.

        Args:
            image: PIL Image of the cropped region
            dpi: Resolution the image was rendered at
            page_index: Source page index (for metadata)

        Returns:
            RegionAnalysisResult with detected dimensions, height, openings
        """
        width_px, height_px = image.size

        # Stage 1: OCR
        tokens = self._ocr_engine.detect(image)
        if not tokens:
            return RegionAnalysisResult(token_count=0, confidence=0.0)

        # Stage 2: Parse dimensions from all tokens
        detected_dims: list[DetectedDimension] = []
        for token in tokens:
            parsed = self._dim_parser.parse(token.text)
            if parsed and parsed.total_decimal_ft > 0:
                # Position as % of crop
                cx = (token.bbox_px[0] + token.bbox_px[2]) / 2
                cy = (token.bbox_px[1] + token.bbox_px[3]) / 2
                detected_dims.append(DetectedDimension(
                    id=str(uuid.uuid4())[:8],
                    value_ft=parsed.total_decimal_ft,
                    raw_text=token.text,
                    confidence=parsed.confidence,
                    position_x_pct=(cx / width_px) * 100,
                    position_y_pct=(cy / height_px) * 100,
                    selected=True,
                ))

        # Stage 3: Detect height annotations
        detected_height: Optional[float] = None
        for token in tokens:
            height_note = self._height_parser.parse(token.text)
            if height_note:
                detected_height = height_note.height_ft
                break  # Take first valid height note

        # Stage 4: Detect openings
        openings_list: list[DetectedOpening] = []
        try:
            # OpeningDetector expects dicts, not TextToken objects
            ocr_token_dicts = [
                {"text": t.text, "bbox_px": t.bbox_px, "confidence": t.confidence}
                for t in tokens
            ]
            # We don't have segment data for a crop — pass empty
            # OpeningDetector in permissive mode will still find
            # opening codes from OCR text
            detector = OpeningDetector()
            openings_result = detector.detect_openings(
                ocr_tokens=ocr_token_dicts,
                segments=[],
                dpi=dpi,
                page_index=page_index,
                spatial_gate="permissive",
            )
            for i, opening in enumerate(openings_result.openings):
                # Use detected dims if available, otherwise use standard defaults
                is_door = opening.kind in ('door', 'garage_door')
                w_ft = opening.width_ft if opening.width_ft else (3.0 if is_door else 4.0)
                h_ft = opening.height_ft if opening.height_ft else (6.67 if is_door else 4.0)
                openings_list.append(DetectedOpening(
                    id=str(uuid.uuid4())[:8],
                    type='door' if opening.kind == 'door' else 'window',
                    width_ft=w_ft,
                    height_ft=h_ft,
                    area_sf=w_ft * h_ft,
                    confidence=opening.confidence,
                    label=f"{'Door' if opening.kind == 'door' else 'Window'} {w_ft}' × {h_ft}'",
                ))
        except Exception as e:
            # Opening detection is optional — don't fail the whole analysis
            pass

        # Compute totals
        selected_dims = [d for d in detected_dims if d.selected]
        wall_length = sum(d.value_ft for d in selected_dims)
        gross_sf = wall_length * (detected_height or 0)
        opening_sf = sum(o.area_sf for o in openings_list)
        net_sf = max(0, gross_sf - opening_sf)

        # Overall confidence
        dim_conf = sum(d.confidence for d in selected_dims) / max(len(selected_dims), 1)
        confidence = dim_conf * (0.9 if detected_height else 0.5)

        return RegionAnalysisResult(
            detected_dimensions=detected_dims,
            suggested_wall_length_lf=wall_length,
            detected_height_ft=detected_height,
            openings=openings_list,
            gross_sf=gross_sf,
            net_sf=net_sf,
            confidence=round(confidence, 3),
            token_count=len(tokens),
        )
```

- [ ] **Step 3: Build the API route**

```python
# apps/api/src/routes/takeoff.py
"""Takeoff analysis endpoints."""
import io
import fitz  # PyMuPDF
import requests
from PIL import Image
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from packages.ml.src.pipeline.region_adapter import RegionPipelineAdapter

router = APIRouter(prefix="/takeoff", tags=["takeoff"])

_adapter: Optional[RegionPipelineAdapter] = None

def _get_adapter() -> RegionPipelineAdapter:
    global _adapter
    if _adapter is None:
        _adapter = RegionPipelineAdapter()
    return _adapter


class BBoxRequest(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


class AnalyzeRegionRequest(BaseModel):
    pdf_url: str
    page_index: int = 0
    bbox: BBoxRequest
    dpi: int = 150


@router.post("/analyze-region")
async def analyze_region(req: AnalyzeRegionRequest):
    """Crop a region from a PDF page and run OCR analysis."""
    try:
        # Download PDF
        pdf_response = requests.get(req.pdf_url, timeout=30)
        pdf_response.raise_for_status()
        pdf_bytes = pdf_response.content

        # Open with PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if req.page_index >= len(doc):
            raise HTTPException(status_code=400, detail=f"Page {req.page_index} does not exist")

        page = doc[req.page_index]

        # Render full page at target DPI
        zoom = req.dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        full_width = pix.width
        full_height = pix.height

        # Convert to PIL Image
        img_data = pix.tobytes("png")
        full_image = Image.open(io.BytesIO(img_data))

        # Crop to bbox (% coordinates → pixels)
        left = int(full_width * req.bbox.x / 100)
        top = int(full_height * req.bbox.y / 100)
        right = int(full_width * (req.bbox.x + req.bbox.width) / 100)
        bottom = int(full_height * (req.bbox.y + req.bbox.height) / 100)

        cropped = full_image.crop((left, top, right, bottom))

        doc.close()

        # Run analysis
        adapter = _get_adapter()
        result = adapter.analyze(
            image=cropped,
            dpi=req.dpi,
            page_index=req.page_index,
        )

        return result.model_dump()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 4: Register the router in main.py**

Add to `pdfengine/apps/api/src/main.py`:
```python
from apps.api.src.routes.takeoff import router as takeoff_router
app.include_router(takeoff_router)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/rosendolopez/evinsulation/pdfengine
git add packages/shared/src/models/region_models.py packages/ml/src/pipeline/region_adapter.py apps/api/src/routes/takeoff.py apps/api/src/main.py
git commit -m "feat: add RegionPipelineAdapter and takeoff API endpoint"
```

---

## Task 13: Backend Unit Tests

**Files:**
- Create: `pdfengine/tests/unit/test_region_adapter.py`

- [ ] **Step 1: Write unit tests for RegionPipelineAdapter**

```python
# tests/unit/test_region_adapter.py
"""Unit tests for RegionPipelineAdapter."""
import pytest
from unittest.mock import MagicMock, patch
from PIL import Image

from packages.ml.src.pipeline.region_adapter import RegionPipelineAdapter
from packages.shared.src.models.region_models import RegionAnalysisResult


class TestRegionPipelineAdapter:
    """Tests for the region adapter."""

    def test_empty_image_returns_zero_tokens(self):
        """An image with no text should return empty result."""
        adapter = RegionPipelineAdapter()
        # Create a blank white image
        img = Image.new("RGB", (200, 100), "white")
        result = adapter.analyze(img, dpi=150)
        assert isinstance(result, RegionAnalysisResult)
        assert result.suggested_wall_length_lf == 0.0
        assert result.detected_height_ft is None
        assert len(result.openings) == 0

    def test_result_model_serialization(self):
        """RegionAnalysisResult should serialize to dict cleanly."""
        result = RegionAnalysisResult(
            suggested_wall_length_lf=142.0,
            detected_height_ft=9.0,
            gross_sf=1278.0,
            net_sf=1208.0,
            confidence=0.85,
            token_count=25,
        )
        d = result.model_dump()
        assert d["suggested_wall_length_lf"] == 142.0
        assert d["detected_height_ft"] == 9.0
        assert d["net_sf"] == 1208.0

    def test_analyze_returns_dimensions_when_found(self):
        """When OCR finds dimension text, they should appear in detected_dimensions."""
        adapter = RegionPipelineAdapter()
        # Mock OCR to return a dimension token
        mock_token = MagicMock()
        mock_token.text = "32'-6\""
        mock_token.bbox_px = (10, 10, 100, 30)
        mock_token.confidence = 0.95

        with patch.object(adapter._ocr_engine, 'detect', return_value=[mock_token]):
            with patch.object(adapter._text_graph_builder, 'build', return_value=MagicMock()):
                result = adapter.analyze(Image.new("RGB", (200, 100), "white"))

        assert len(result.detected_dimensions) >= 1
        assert result.suggested_wall_length_lf > 0
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/rosendolopez/evinsulation/pdfengine && source venv/bin/activate && python3 -m pytest tests/unit/test_region_adapter.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/test_region_adapter.py
git commit -m "test: add unit tests for RegionPipelineAdapter"
```

---

## Task 14: Session Persistence API Routes

**Files:**
- Create: `Insulation/app/api/takeoff/sessions/route.ts`
- Create: `Insulation/app/api/takeoff/sessions/[id]/regions/route.ts`

- [ ] **Step 1: Build session CRUD**

```typescript
// app/api/takeoff/sessions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = supabaseAdmin;
  const body = await request.json();

  const { data, error } = await supabase
    .from('takeoff_sessions')
    .insert({
      project_id: body.project_id,
      document_id: body.document_id,
      selected_pages: body.selected_pages ?? [],
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET(request: NextRequest) {
  const supabase = supabaseAdmin;
  const documentId = request.nextUrl.searchParams.get('document_id');

  if (!documentId) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  // Find in_progress session for this document
  const { data, error } = await supabase
    .from('takeoff_sessions')
    .select('*, takeoff_regions(*)')
    .eq('document_id', documentId)
    .eq('status', 'in_progress')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) return NextResponse.json({ session: null });
  return NextResponse.json({ session: data });
}
```

- [ ] **Step 2: Build region CRUD**

```typescript
// app/api/takeoff/sessions/[id]/regions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = supabaseAdmin;
  const body = await request.json();

  const { data, error } = await supabase
    .from('takeoff_regions')
    .insert({ ...body, session_id: sessionId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = supabaseAdmin;
  const body = await request.json();
  const regionId = request.nextUrl.searchParams.get('region_id');

  if (!regionId) {
    return NextResponse.json({ error: 'region_id required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('takeoff_regions')
    .update(body)
    .eq('id', regionId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/takeoff/sessions/route.ts app/api/takeoff/sessions/\[id\]/regions/route.ts
git commit -m "feat: add takeoff session and region persistence API routes"
```

---

## Task 15: Wire "Start Takeoff" into Project Page

**Files:**
- Modify: `Insulation/app/projects/[id]/page.tsx`

- [ ] **Step 1: Add takeoff link to project detail page**

Find the section with existing action buttons (Extract, Review, Quote) and add:

```tsx
<Link
  href={`/projects/${id}/takeoff`}
  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500"
>
  Start Takeoff →
</Link>
```

- [ ] **Step 2: Commit**

```bash
git add app/projects/[id]/page.tsx
git commit -m "feat: add Start Takeoff button to project detail page"
```

---

## Task 16: Install Missing Dependencies

**Files:**
- Modify: `Insulation/package.json`

- [ ] **Step 1: Install uuid for region ID generation**

Run: `cd /Users/rosendolopez/evinsulation/Insulation && npm install uuid && npm install -D @types/uuid`

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add uuid dependency for region ID generation"
```

---

## Summary

| Task | Component | Status |
|------|-----------|--------|
| 1 | Database schema (takeoff_sessions, takeoff_regions) | |
| 2 | TypeScript types | |
| 3 | Zustand store | |
| 4 | PageSelector component | |
| 5 | RegionOverlay (SVG drawing) | |
| 6 | RegionCard + RunningTotal | |
| 7 | RegionModal (analysis review) | |
| 8 | BlueprintWorkspace + ToolBar | |
| 9 | Vision AI API route | |
| 10 | OCR region analysis API proxy | |
| 11 | Main takeoff page orchestrator | |
| 12 | Backend RegionPipelineAdapter + API | |
| 13 | Backend unit tests | |
| 14 | Session persistence API routes | |
| 15 | Wire into project page | |
| 16 | Install dependencies | |

**Execution order:** Tasks 16 first (deps), then 1-2 (schema + types), then 3 (store), then 4-8 (frontend components), then 9-10 (API routes), then 11 (orchestrator page), then 12-13 (backend), then 14-15 (persistence + wiring).
