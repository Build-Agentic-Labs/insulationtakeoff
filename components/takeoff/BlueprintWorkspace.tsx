'use client';

import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2 } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BBox, RegionAnalysisResult, TakeoffRegion } from '@/lib/types/takeoff';
import RegionOverlay from '@/components/takeoff/RegionOverlay';
import { RegionCard } from '@/components/takeoff/RegionCard';
import { RegionModal } from '@/components/takeoff/RegionModal';
import { RunningTotal } from '@/components/takeoff/RunningTotal';
import { ToolBar } from '@/components/takeoff/ToolBar';

// Set the pdf.js worker once at module level
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlueprintWorkspaceProps {
  pdfUrl: string;
  documentId: string;
  sessionId: string;
  onGenerateQuote: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCALE_STEP = 0.2;
const SCALE_MIN = 0.3;
const SCALE_MAX = 3.0;
const DEFAULT_SCALE = 1.0;

// Native PDF page dimensions used for the SVG viewBox
const PDF_PAGE_WIDTH = 816;
const PDF_PAGE_HEIGHT = 1056;

// ─── Component ────────────────────────────────────────────────────────────────

export function BlueprintWorkspace({
  pdfUrl,
  documentId,
  sessionId,
  onGenerateQuote,
}: BlueprintWorkspaceProps) {
  const selectedPages = useTakeoffStore((s) => s.selectedPages);
  const activePageIndex = useTakeoffStore((s) => s.activePageIndex);
  const setActivePage = useTakeoffStore((s) => s.setActivePage);
  const setTool = useTakeoffStore((s) => s.setTool);
  const modalRegionId = useTakeoffStore((s) => s.modalRegionId);
  const openModal = useTakeoffStore((s) => s.openModal);
  const addRegion = useTakeoffStore((s) => s.addRegion);
  const visionLoading = useTakeoffStore((s) => s.visionLoading);
  const getRegionsForPage = useTakeoffStore((s) => s.getRegionsForPage);

  const [scale, setScale] = useState<number>(DEFAULT_SCALE);

  const pageRegions = getRegionsForPage(activePageIndex);
  const isVisionLoading = Boolean(visionLoading[activePageIndex]);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(SCALE_MAX, Math.round((prev + SCALE_STEP) * 10) / 10));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(SCALE_MIN, Math.round((prev - SCALE_STEP) * 10) / 10));
  }, []);

  // ── Region interactions ───────────────────────────────────────────────────

  const handleRegionClick = useCallback(
    (regionId: string) => {
      openModal(regionId);
    },
    [openModal]
  );

  const handleRegionDrawn = useCallback(
    (bbox: BBox) => {
      const regionCount = getRegionsForPage(activePageIndex).length;
      const newRegion: TakeoffRegion = {
        id: uuid(),
        session_id: sessionId,
        page_index: activePageIndex,
        label: `Region ${regionCount + 1}`,
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
    [activePageIndex, sessionId, getRegionsForPage, addRegion, openModal]
  );

  // ── Vision analysis ───────────────────────────────────────────────────────

  const handleAnalyzeRegion = useCallback(
    async (regionId: string): Promise<RegionAnalysisResult> => {
      const session = useTakeoffStore.getState().session;
      const region = session?.regions.find((r) => r.id === regionId);
      if (!region) throw new Error('Region not found');

      const response = await fetch('/api/takeoff/analyze-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          page_index: region.page_index,
          bbox: region.bbox,
          dpi: 150,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Region analysis failed');
      }

      return response.json() as Promise<RegionAnalysisResult>;
    },
    [documentId]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-zinc-950">
      {/* ── Left: blueprint area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar: page tabs + toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
          {/* Page tabs */}
          <div className="flex items-center gap-1">
            {selectedPages.map((pageIndex) => {
              const isActive = pageIndex === activePageIndex;
              return (
                <button
                  key={pageIndex}
                  onClick={() => setActivePage(pageIndex)}
                  className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-400 border-blue-600/40'
                      : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  Page {pageIndex + 1}
                </button>
              );
            })}
          </div>

          {/* Toolbar */}
          <ToolBar onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
        </div>

        {/* Blueprint canvas */}
        <div className="flex-1 overflow-auto flex items-center justify-center bg-zinc-950 p-6">
          <div
            className="relative"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
          >
            <Document
              file={pdfUrl}
              loading={
                <div className="flex items-center justify-center w-[816px] h-[400px]">
                  <Loader2 className="h-8 w-8 text-zinc-500 animate-spin" />
                </div>
              }
            >
              <div className="relative">
                <Page
                  pageNumber={activePageIndex + 1}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  width={PDF_PAGE_WIDTH}
                />

                {/* Region overlay — positioned on top of the page */}
                <div className="absolute inset-0">
                  <RegionOverlay
                    pageWidth={PDF_PAGE_WIDTH}
                    pageHeight={PDF_PAGE_HEIGHT}
                    regions={pageRegions}
                    onRegionClick={handleRegionClick}
                    onRegionDrawn={handleRegionDrawn}
                  />
                </div>

                {/* Vision loading spinner overlay */}
                {isVisionLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/60 backdrop-blur-[1px] rounded">
                    <Loader2 className="h-8 w-8 text-blue-400 animate-spin mb-2" />
                    <p className="text-xs text-zinc-400">Analyzing blueprint…</p>
                  </div>
                )}
              </div>
            </Document>
          </div>
        </div>
      </div>

      {/* ── Right: regions panel ──────────────────────────────────────────── */}
      <div className="w-[240px] flex flex-col border-l border-zinc-800 bg-zinc-900/40 shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Wall Regions
          </h2>
        </div>

        {/* Region list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {pageRegions.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center mt-6">
              No regions on this page yet.
            </p>
          ) : (
            pageRegions.map((region) => (
              <RegionCard
                key={region.id}
                region={region}
                onClick={() => openModal(region.id)}
              />
            ))
          )}
        </div>

        {/* Draw custom region */}
        <div className="px-3 py-2 border-t border-zinc-800 shrink-0">
          <button
            onClick={() => setTool('rectangle')}
            className="w-full text-xs font-medium text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg py-2 transition-colors"
          >
            + Draw custom region
          </button>
        </div>

        {/* Spacer absorbed by flex-1 above; RunningTotal pinned to bottom */}
        <RunningTotal onGenerateQuote={onGenerateQuote} />
      </div>

      {/* ── Region modal ──────────────────────────────────────────────────── */}
      {modalRegionId !== null && (
        <RegionModal
          regionId={modalRegionId}
          onAnalyze={handleAnalyzeRegion}
        />
      )}
    </div>
  );
}
