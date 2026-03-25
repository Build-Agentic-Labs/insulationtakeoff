'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Check, ChevronRight, ZoomIn, ZoomOut, Maximize, Loader2, Sparkles } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { PageScore } from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PageSelectorProps {
  pdfUrl: string;
  totalPages: number;
  pageScores: PageScore[];
  isClassifying: boolean;
  classificationDone: boolean;
  onConfirm: () => void;
  onPdfLoaded?: (numPages: number) => void;
}

// Page type badge colors
const PAGE_TYPE_COLORS: Record<string, string> = {
  floor_plan: 'bg-green-900/50 text-green-400 border-green-700',
  elevation: 'bg-blue-900/50 text-blue-400 border-blue-700',
  foundation: 'bg-orange-900/50 text-orange-400 border-orange-700',
  section: 'bg-purple-900/50 text-purple-400 border-purple-700',
  schedule: 'bg-cyan-900/50 text-cyan-400 border-cyan-700',
  roof: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
  detail: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  site: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  title: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  electrical: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  plumbing: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  other: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};

export function PageSelector({
  pdfUrl,
  totalPages,
  pageScores,
  isClassifying,
  classificationDone,
  onConfirm,
  onPdfLoaded,
}: PageSelectorProps) {
  // Local selection state (synced to store only on confirm)
  const [localSelectedPages, setLocalSelectedPages] = useState<number[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageCount, setPageCount] = useState(totalPages);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfLoadedRef = useRef(false);
  const autoSelectedRef = useRef(false);

  const setPageScoresStore = useTakeoffStore((s) => s.setPageScores);

  const effectivePageCount = pageCount || totalPages;
  const pageIndices = Array.from({ length: effectivePageCount }, (_, i) => i);
  const isSelected = (idx: number) => localSelectedPages.includes(idx);

  // Auto-select AI-recommended pages when classification completes
  useEffect(() => {
    if (classificationDone && !autoSelectedRef.current && pageScores.length > 0) {
      autoSelectedRef.current = true;
      const aiPicked = pageScores
        .filter((s) => s.ai_selected)
        .map((s) => s.page_index);
      if (aiPicked.length > 0) {
        setLocalSelectedPages(aiPicked);
        setPreviewIdx(aiPicked[0]);
      }
    }
  }, [classificationDone, pageScores]);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 32);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitWidth = containerWidth > 0 ? Math.min(containerWidth, 1200) : 800;

  const togglePage = useCallback((idx: number) => {
    setLocalSelectedPages((prev) =>
      prev.includes(idx)
        ? prev.filter((p) => p !== idx)
        : [...prev, idx].sort((a, b) => a - b)
    );
  }, []);

  const handleConfirm = useCallback(() => {
    // Push page scores (with selections) into the store before confirming
    const scores = pageIndices.map((i) => {
      const cls = pageScores.find((s) => s.page_index === i);
      return {
        page_index: i,
        score: cls?.score ?? 0.5,
        label: cls?.label ?? `Page ${i + 1}`,
        ai_selected: localSelectedPages.includes(i),
      };
    });
    setPageScoresStore(scores);
    onConfirm();
  }, [pageIndices, pageScores, localSelectedPages, setPageScoresStore, onConfirm]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => Math.min(3, Math.max(0.2, z + delta)));
    }
  }, []);

  const handlePdfLoaded = useCallback((numPages: number) => {
    if (!pdfLoadedRef.current) {
      pdfLoadedRef.current = true;
      setPageCount(numPages);
      onPdfLoaded?.(numPages);
    }
  }, [onPdfLoaded]);

  // Current page classification info
  const currentPageScore = pageScores.find((s) => s.page_index === previewIdx);
  const currentLabel = currentPageScore?.label ?? `Page ${previewIdx + 1}`;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      <div className="flex flex-1 overflow-hidden">
        {/* Filmstrip */}
        <div className="w-36 flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/50 flex flex-col gap-2 py-3 px-2">
          {isClassifying && (
            <div className="flex items-center gap-1.5 px-1 mb-2 text-[10px] text-amber-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing pages…
            </div>
          )}
          {!isClassifying && classificationDone && (
            <div className="flex items-center gap-1.5 px-1 mb-2 text-[10px] text-green-400">
              <Sparkles className="w-3 h-3" />
              AI classified {pageScores.length} pages
            </div>
          )}
          {!classificationDone && !isClassifying && (
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest px-1 mb-1">Pages</div>
          )}

          {pageIndices.map((idx) => {
            const selected = isSelected(idx);
            const previewing = previewIdx === idx;
            const score = pageScores.find((s) => s.page_index === idx);
            const isFloorPlan = score?.ai_selected ?? false;
            const pageName = score?.label ?? `Page ${idx + 1}`;

            return (
              <button
                key={idx}
                onClick={() => setPreviewIdx(idx)}
                className={[
                  'relative rounded overflow-hidden flex-shrink-0 focus:outline-none transition-all',
                  previewing ? 'ring-2 ring-blue-500' : 'ring-1 ring-zinc-700 hover:ring-zinc-500',
                ].join(' ')}
              >
                <div className="bg-zinc-800">
                  <Document file={pdfUrl} loading={null} error={null}>
                    <Page
                      pageNumber={idx + 1}
                      width={115}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                </div>

                {/* Selected checkmark */}
                {selected && (
                  <>
                    <div className="absolute inset-0 border-2 border-green-500 rounded pointer-events-none" />
                    <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  </>
                )}

                {/* AI floor plan badge */}
                {isFloorPlan && !selected && (
                  <div className="absolute top-1 right-1 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center shadow">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                )}

                {/* Page name label */}
                <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/90 text-center text-[9px] py-0.5 px-0.5 truncate">
                  <span className={isFloorPlan ? 'text-green-400' : 'text-zinc-500'}>
                    {pageName}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-300 font-medium">{currentLabel}</span>
              {currentPageScore?.ai_selected && (
                <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-950 border border-green-800 rounded px-1.5 py-0.5">
                  <Sparkles className="w-2.5 h-2.5" />
                  Floor Plan
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom */}
              <div className="flex items-center gap-1 mr-3">
                <button
                  onClick={() => setZoom((z) => Math.max(0.2, z - 0.15))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-zinc-500 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoom(1.0)}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                  title="Fit to view"
                >
                  <Maximize className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Include toggle */}
              <button
                onClick={() => togglePage(previewIdx)}
                className={[
                  'px-4 py-1.5 text-sm rounded font-medium transition-colors',
                  isSelected(previewIdx)
                    ? 'bg-green-600 text-white hover:bg-green-500'
                    : 'bg-blue-600 text-white hover:bg-blue-500',
                ].join(' ')}
              >
                {isSelected(previewIdx) ? (
                  <span className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    Included — click to remove
                  </span>
                ) : (
                  'Include this page'
                )}
              </button>
            </div>
          </div>

          {/* PDF preview */}
          <div
            ref={containerRef}
            className="flex-1 overflow-auto bg-zinc-950"
            onWheel={handleWheel}
          >
            <div
              className="flex justify-center p-4"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
                width: `${100 / zoom}%`,
                minHeight: `${100 / zoom}%`,
              }}
            >
              <Document
                file={pdfUrl}
                onLoadSuccess={(pdf) => handlePdfLoaded(pdf.numPages)}
                loading={<div className="text-zinc-500 text-sm mt-16">Loading PDF…</div>}
                error={<div className="text-red-400 text-sm mt-16">Failed to load PDF.</div>}
              >
                <Page
                  pageNumber={previewIdx + 1}
                  width={fitWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="shadow-xl"
                />
              </Document>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900 px-6 py-3 flex items-center justify-between">
        <span className="text-sm text-zinc-400">
          {localSelectedPages.length === 0
            ? isClassifying
              ? 'AI is analyzing your pages — floor plans will be auto-selected…'
              : 'No pages selected — click "Include this page" on pages you need'
            : `${localSelectedPages.length} page${localSelectedPages.length !== 1 ? 's' : ''} selected: ${localSelectedPages.map((p) => {
                const name = pageScores.find((s) => s.page_index === p)?.label;
                return name ?? `Page ${p + 1}`;
              }).join(', ')}`}
        </span>

        <button
          onClick={handleConfirm}
          disabled={localSelectedPages.length === 0}
          className={[
            'flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors',
            localSelectedPages.length === 0
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-500',
          ].join(' ')}
        >
          Continue with {localSelectedPages.length} page{localSelectedPages.length !== 1 ? 's' : ''}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
