'use client';

import { useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BBox, RegionAnalysisResult, TakeoffRegion } from '@/lib/types/takeoff';
import { BlueprintViewer } from '@/components/takeoff/BlueprintViewer';
import RegionOverlay from '@/components/takeoff/RegionOverlay';
import { RegionCard } from '@/components/takeoff/RegionCard';
import { RegionModal } from '@/components/takeoff/RegionModal';
import { RunningTotal } from '@/components/takeoff/RunningTotal';

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
  const selectedPages = useTakeoffStore((s) => s.selectedPages);
  const activePageIndex = useTakeoffStore((s) => s.activePageIndex);
  const setActivePage = useTakeoffStore((s) => s.setActivePage);
  const setTool = useTakeoffStore((s) => s.setTool);
  const modalRegionId = useTakeoffStore((s) => s.modalRegionId);
  const openModal = useTakeoffStore((s) => s.openModal);
  const addRegion = useTakeoffStore((s) => s.addRegion);
  const visionLoading = useTakeoffStore((s) => s.visionLoading);
  const getRegionsForPage = useTakeoffStore((s) => s.getRegionsForPage);

  const pageRegions = getRegionsForPage(activePageIndex);
  const isVisionLoading = Boolean(visionLoading[activePageIndex]);

  const handleRegionClick = useCallback(
    (regionId: string) => openModal(regionId),
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

  return (
    <div className="flex h-full bg-white">
      {/* Left: blueprint */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Page tabs */}
        <div className="flex items-center px-3 py-2 border-b border-zinc-200 bg-zinc-50 shrink-0 gap-1">
          {selectedPages.map((pageIndex) => {
            const isActive = pageIndex === activePageIndex;
            return (
              <button
                key={pageIndex}
                onClick={() => setActivePage(pageIndex)}
                className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 border-blue-300'
                    : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-700 hover:border-zinc-200'
                }`}
              >
                Page {pageIndex + 1}
              </button>
            );
          })}
        </div>

        {/* Blueprint viewer with region overlay */}
        <BlueprintViewer pdfUrl={pdfUrl} pageNumber={activePageIndex + 1}>
          {(dims) => (
            <>
              <RegionOverlay
                pageWidth={dims.width}
                pageHeight={dims.height}
                regions={pageRegions}
                onRegionClick={handleRegionClick}
                onRegionDrawn={handleRegionDrawn}
              />
              {isVisionLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-[1px] rounded">
                  <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-2" />
                  <p className="text-xs text-zinc-500">Analyzing blueprint…</p>
                </div>
              )}
            </>
          )}
        </BlueprintViewer>
      </div>

      {/* Right: regions panel */}
      <div className="w-[260px] flex flex-col border-l border-zinc-200 bg-zinc-50 shrink-0">
        <div className="px-4 py-3 border-b border-zinc-200 shrink-0">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Wall Regions
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {pageRegions.length === 0 ? (
            <div className="text-center mt-6 px-2 space-y-3">
              <div className="w-10 h-10 mx-auto bg-blue-50 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4l2 2h4a1 1 0 011 1v2M4 5v14a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-4l-2-2H5a1 1 0 00-1 1z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-700">Draw wall regions</p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Draw a rectangle around each exterior wall section. AI will read the dimensions inside each region.
              </p>
              <button
                onClick={() => setTool('rectangle')}
                className="mt-2 w-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-2.5 transition-colors shadow-sm"
              >
                Start Drawing
              </button>
            </div>
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

        {pageRegions.length > 0 && (
          <div className="px-3 py-2 border-t border-zinc-200 shrink-0">
            <button
              onClick={() => setTool('rectangle')}
              className="w-full text-xs font-medium text-blue-600 hover:text-blue-700 border border-dashed border-blue-200 hover:border-blue-300 rounded-lg py-2 transition-colors"
            >
              + Draw another region
            </button>
          </div>
        )}

        <RunningTotal onGenerateQuote={onGenerateQuote} />
      </div>

      {modalRegionId !== null && (
        <RegionModal
          regionId={modalRegionId}
          onAnalyze={handleAnalyzeRegion}
        />
      )}
    </div>
  );
}
