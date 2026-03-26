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

export function PageSelector({
  pdfUrl,
  totalPages,
  pageScores,
  isClassifying,
  classificationDone,
  onConfirm,
  onPdfLoaded,
}: PageSelectorProps) {
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

  // Use native event listener for wheel zoom (React onWheel is passive, can't preventDefault)
  const previewContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.min(3, Math.max(0.2, z + delta)));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handlePdfLoaded = useCallback((numPages: number) => {
    if (!pdfLoadedRef.current) {
      pdfLoadedRef.current = true;
      setPageCount(numPages);
      onPdfLoaded?.(numPages);
    }
  }, [onPdfLoaded]);

  const currentPageScore = pageScores.find((s) => s.page_index === previewIdx);
  const currentLabel = currentPageScore?.label ?? `Page ${previewIdx + 1}`;

  return (
    <div className="flex flex-col h-full bg-white text-zinc-900">
      <div className="flex flex-1 overflow-hidden">
        {/* Filmstrip */}
        <div className="w-36 flex-shrink-0 border-r border-zinc-200 overflow-y-auto bg-zinc-50 flex flex-col gap-2 py-3 px-2">
          {isClassifying && (
            <div className="flex items-center gap-1.5 px-1 mb-2 text-[10px] text-amber-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing pages…
            </div>
          )}
          {!isClassifying && classificationDone && (
            <div className="flex items-center gap-1.5 px-1 mb-2 text-[10px] text-green-600">
              <Sparkles className="w-3 h-3" />
              AI classified {pageScores.length} pages
            </div>
          )}
          {!classificationDone && !isClassifying && (
            <div className="text-[9px] text-zinc-400 uppercase tracking-widest px-1 mb-1">Pages</div>
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
                  'relative rounded-lg overflow-hidden flex-shrink-0 focus:outline-none transition-all',
                  previewing ? 'ring-2 ring-blue-500 shadow-md' : 'ring-1 ring-zinc-200 hover:ring-zinc-400 shadow-sm',
                ].join(' ')}
              >
                <div className="bg-white">
                  <Document file={pdfUrl} loading={null} error={null}>
                    <Page
                      pageNumber={idx + 1}
                      width={115}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                </div>

                {selected && (
                  <>
                    <div className="absolute inset-0 border-2 border-green-500 rounded-lg pointer-events-none" />
                    <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  </>
                )}

                {isFloorPlan && !selected && (
                  <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-white/90 text-center text-[9px] py-0.5 px-0.5 truncate border-t border-zinc-100">
                  <span className={isFloorPlan ? 'text-green-700 font-medium' : 'text-zinc-500'}>
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
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 bg-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-800 font-medium">{currentLabel}</span>
              {currentPageScore?.ai_selected && (
                <span className="flex items-center gap-1 text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                  <Sparkles className="w-2.5 h-2.5" />
                  Floor Plan
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 mr-3">
                <button
                  onClick={() => setZoom((z) => Math.max(0.2, z - 0.15))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-100 border border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-zinc-500 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-100 border border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoom(1.0)}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-100 border border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 transition-colors"
                  title="Fit to view"
                >
                  <Maximize className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={() => togglePage(previewIdx)}
                className={[
                  'px-4 py-1.5 text-sm rounded-lg font-medium transition-colors shadow-sm',
                  isSelected(previewIdx)
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-blue-600 text-white hover:bg-blue-700',
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
            ref={(el) => {
              // Assign both refs to the same element
              (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
              (previewContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className="flex-1 overflow-auto bg-zinc-100"
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
                loading={<div className="text-zinc-400 text-sm mt-16">Loading PDF…</div>}
                error={<div className="text-red-500 text-sm mt-16">Failed to load PDF.</div>}
              >
                <Page
                  pageNumber={previewIdx + 1}
                  width={fitWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="shadow-xl rounded-lg"
                />
              </Document>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-zinc-200 bg-white px-6 py-3 flex items-center justify-between">
        <span className="text-sm text-zinc-500">
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
            'flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm',
            localSelectedPages.length === 0
              ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700',
          ].join(' ')}
        >
          Continue with {localSelectedPages.length} page{localSelectedPages.length !== 1 ? 's' : ''}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
