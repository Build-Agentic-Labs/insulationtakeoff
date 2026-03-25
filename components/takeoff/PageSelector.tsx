'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Check, ChevronRight, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PageSelectorProps {
  pdfUrl: string;
  totalPages: number;
  onConfirm: () => void;
  onPdfLoaded?: (numPages: number) => void;
}

export function PageSelector({ pdfUrl, totalPages, onConfirm, onPdfLoaded }: PageSelectorProps) {
  // Local state — NOT from the store for selection (avoids the reset bug)
  const [localSelectedPages, setLocalSelectedPages] = useState<number[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageCount, setPageCount] = useState(totalPages);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfLoadedRef = useRef(false);

  const effectivePageCount = pageCount || totalPages;
  const pageIndices = Array.from({ length: effectivePageCount }, (_, i) => i);
  const isSelected = (idx: number) => localSelectedPages.includes(idx);

  // Sync store on confirm (not on every toggle)
  const setPageScores = useTakeoffStore((s) => s.setPageScores);
  const confirmPageSelection = useTakeoffStore((s) => s.confirmPageSelection);

  // Measure preview container
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
    // Push selection into store only at confirm time
    const scores = pageIndices.map((i) => ({
      page_index: i,
      score: 0.5,
      label: `Page ${i + 1}`,
      ai_selected: localSelectedPages.includes(i),
    }));
    setPageScores(scores);
    onConfirm();
  }, [pageIndices, localSelectedPages, setPageScores, onConfirm]);

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

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      <div className="flex flex-1 overflow-hidden">
        {/* Filmstrip */}
        <div className="w-28 flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/50 flex flex-col gap-2 py-3 px-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest px-1 mb-1">Pages</div>
          {pageIndices.map((idx) => {
            const selected = isSelected(idx);
            const previewing = previewIdx === idx;

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
                      width={80}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                </div>

                {selected && (
                  <>
                    <div className="absolute inset-0 border-2 border-green-500 rounded pointer-events-none" />
                    <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  </>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/80 text-center text-zinc-400 text-[10px] py-0.5">
                  {idx + 1}
                </div>
              </button>
            );
          })}
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
            <span className="text-sm text-zinc-300 font-medium">
              Page {previewIdx + 1} of {effectivePageCount}
            </span>

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
            ? 'No pages selected — click "Include this page" on pages you need'
            : `${localSelectedPages.length} page${localSelectedPages.length !== 1 ? 's' : ''} selected: ${localSelectedPages.map((p) => p + 1).join(', ')}`}
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
