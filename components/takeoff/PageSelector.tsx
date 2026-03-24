'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Check, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PageSelectorProps {
  pdfUrl: string;
  totalPages: number;
  onConfirm: () => void;
  onPdfLoaded?: (numPages: number) => void;
}

export function PageSelector({ pdfUrl, totalPages, onConfirm, onPdfLoaded }: PageSelectorProps) {
  const selectedPages = useTakeoffStore((s) => s.selectedPages);
  const previewPageIndex = useTakeoffStore((s) => s.previewPageIndex);
  const togglePage = useTakeoffStore((s) => s.togglePage);
  const setPreviewPage = useTakeoffStore((s) => s.setPreviewPage);

  const [loadedPageCount, setLoadedPageCount] = useState(totalPages);
  const [zoom, setZoom] = useState(1.0);
  const effectivePageCount = loadedPageCount || totalPages;

  const isSelected = (idx: number) => selectedPages.includes(idx);
  const pageIndices = Array.from({ length: effectivePageCount }, (_, i) => i);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      <div className="flex flex-1 overflow-hidden">
        {/* Filmstrip */}
        <div className="w-28 flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/50 flex flex-col gap-2 py-3 px-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest px-1 mb-1">Pages</div>
          {pageIndices.map((idx) => {
            const selected = isSelected(idx);
            const previewing = previewPageIndex === idx;

            return (
              <button
                key={idx}
                onClick={() => setPreviewPage(idx)}
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

                {/* Selected checkmark */}
                {selected && (
                  <>
                    <div className="absolute inset-0 border-2 border-green-500 rounded pointer-events-none" />
                    <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  </>
                )}

                {/* Page number */}
                <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/80 text-center text-zinc-400 text-[10px] py-0.5">
                  {idx + 1}
                </div>
              </button>
            );
          })}
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with controls */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
            <span className="text-sm text-zinc-300 font-medium">
              Page {previewPageIndex + 1} of {effectivePageCount}
            </span>

            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <div className="flex items-center gap-1 mr-3">
                <button
                  onClick={() => setZoom((z) => Math.max(0.3, z - 0.25))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white"
                  title="Zoom out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-zinc-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white"
                  title="Zoom in"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoom(1.0)}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white"
                  title="Reset zoom"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Include/Exclude toggle */}
              <button
                onClick={() => togglePage(previewPageIndex)}
                className={[
                  'px-4 py-1.5 text-sm rounded font-medium transition-colors',
                  isSelected(previewPageIndex)
                    ? 'bg-green-600 text-white hover:bg-green-500'
                    : 'bg-blue-600 text-white hover:bg-blue-500',
                ].join(' ')}
              >
                {isSelected(previewPageIndex) ? (
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

          {/* PDF preview with zoom */}
          <div className="flex-1 overflow-auto bg-zinc-950 flex justify-center items-start p-4">
            <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
              <Document
                file={pdfUrl}
                onLoadSuccess={(pdf) => {
                  setLoadedPageCount(pdf.numPages);
                  onPdfLoaded?.(pdf.numPages);
                }}
                loading={<div className="text-zinc-500 text-sm mt-16">Loading PDF…</div>}
                error={<div className="text-red-400 text-sm mt-16">Failed to load PDF.</div>}
              >
                <Page
                  pageNumber={previewPageIndex + 1}
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
          {selectedPages.length === 0
            ? 'No pages selected — click "Include this page" on pages you need'
            : `${selectedPages.length} page${selectedPages.length !== 1 ? 's' : ''} selected: ${selectedPages.map((p) => p + 1).join(', ')}`}
        </span>

        <button
          onClick={onConfirm}
          disabled={selectedPages.length === 0}
          className={[
            'flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors',
            selectedPages.length === 0
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-500',
          ].join(' ')}
        >
          Continue with {selectedPages.length} page{selectedPages.length !== 1 ? 's' : ''}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
