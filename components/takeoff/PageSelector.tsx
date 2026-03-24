'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Check, SkipForward, ChevronRight } from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';

// Configure PDF.js worker
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
  const pageScores = useTakeoffStore((s) => s.pageScores);
  const togglePage = useTakeoffStore((s) => s.togglePage);
  const setPreviewPage = useTakeoffStore((s) => s.setPreviewPage);

  // Track page count from the PDF itself (handles totalPages=0 on first render)
  const [loadedPageCount, setLoadedPageCount] = useState(totalPages);
  const effectivePageCount = loadedPageCount || totalPages;

  const isSelected = (pageIndex: number) => selectedPages.includes(pageIndex);
  const isAiPicked = (pageIndex: number) =>
    pageScores.find((s) => s.page_index === pageIndex)?.ai_selected ?? false;

  const pageIndices = Array.from({ length: effectivePageCount }, (_, i) => i);

  function handleInclude() {
    if (!isSelected(previewPageIndex)) {
      togglePage(previewPageIndex);
    }
  }

  function handleSkip() {
    if (isSelected(previewPageIndex)) {
      togglePage(previewPageIndex);
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      {/* Main content: filmstrip + preview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: filmstrip */}
        <div className="w-28 flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900 flex flex-col gap-2 py-3 px-2">
          {pageIndices.map((pageIndex) => {
            const selected = isSelected(pageIndex);
            const aiPicked = isAiPicked(pageIndex);
            const isPreviewing = previewPageIndex === pageIndex;

            return (
              <button
                key={pageIndex}
                onClick={() => setPreviewPage(pageIndex)}
                className={[
                  'relative rounded overflow-hidden flex-shrink-0 focus:outline-none',
                  'transition-all duration-150',
                  isPreviewing
                    ? 'ring-2 ring-blue-500'
                    : 'ring-1 ring-zinc-700 hover:ring-zinc-500',
                ].join(' ')}
              >
                {/* Thumbnail */}
                <div className="bg-zinc-800">
                  <Document file={pdfUrl} loading={null} error={null}>
                    <Page
                      pageNumber={pageIndex + 1}
                      width={80}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                </div>

                {/* Selected overlay */}
                {selected && (
                  <div className="absolute inset-0 border-2 border-blue-500 rounded pointer-events-none" />
                )}

                {/* AI badge */}
                {aiPicked && (
                  <div className="absolute top-1 right-1 w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center shadow">
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  </div>
                )}

                {/* Page number label */}
                <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/70 text-center text-zinc-400 text-[10px] py-0.5">
                  {pageIndex + 1}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Preview header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">
                Page {previewPageIndex + 1}
              </span>
              {isAiPicked(previewPageIndex) && (
                <span className="flex items-center gap-1 text-xs text-blue-400 bg-blue-950 border border-blue-800 rounded px-1.5 py-0.5">
                  <Check className="w-3 h-3" strokeWidth={2.5} />
                  AI recommended
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleInclude}
                disabled={isSelected(previewPageIndex)}
                className={[
                  'px-3 py-1.5 text-xs rounded font-medium transition-colors',
                  isSelected(previewPageIndex)
                    ? 'bg-blue-600 text-white cursor-default'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-blue-600 hover:text-white border border-zinc-700',
                ].join(' ')}
              >
                {isSelected(previewPageIndex) ? (
                  <span className="flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Included
                  </span>
                ) : (
                  'Include'
                )}
              </button>

              <button
                onClick={handleSkip}
                disabled={!isSelected(previewPageIndex)}
                className={[
                  'px-3 py-1.5 text-xs rounded font-medium transition-colors',
                  !isSelected(previewPageIndex)
                    ? 'bg-zinc-900 text-zinc-600 cursor-default border border-zinc-800'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700',
                ].join(' ')}
              >
                <span className="flex items-center gap-1">
                  <SkipForward className="w-3 h-3" />
                  Skip
                </span>
              </button>
            </div>
          </div>

          {/* Preview render area */}
          <div className="flex-1 overflow-auto bg-zinc-950 flex justify-center items-start p-4">
            <Document
              file={pdfUrl}
              onLoadSuccess={(pdf) => {
                setLoadedPageCount(pdf.numPages);
                onPdfLoaded?.(pdf.numPages);
              }}
              loading={
                <div className="text-zinc-500 text-sm mt-16">Loading PDF…</div>
              }
              error={
                <div className="text-red-400 text-sm mt-16">Failed to load PDF.</div>
              }
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

      {/* Bottom action bar */}
      <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900 px-6 py-3 flex items-center justify-between">
        <span className="text-sm text-zinc-400">
          {selectedPages.length === 0
            ? 'No pages selected'
            : `${selectedPages.length} page${selectedPages.length === 1 ? '' : 's'} selected`}
        </span>

        <button
          onClick={onConfirm}
          disabled={selectedPages.length === 0}
          className={[
            'flex items-center gap-2 px-4 py-2 rounded font-medium text-sm transition-colors',
            selectedPages.length === 0
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-500',
          ].join(' ')}
        >
          Continue with {selectedPages.length} page{selectedPages.length === 1 ? '' : 's'}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
