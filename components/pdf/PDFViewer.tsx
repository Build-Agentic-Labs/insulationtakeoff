"use client";

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  highlights?: Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export function PDFViewer({
  url,
  initialPage = 1,
  onPageChange,
  highlights = [],
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [scale, setScale] = useState(0.6);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setIsLoading(false);
    setError(null);
  }

  function onDocumentLoadError(error: Error) {
    console.error('Error loading PDF:', error);
    setError('Failed to load PDF. Please try again.');
    setIsLoading(false);
  }

  function changePage(offset: number) {
    const newPage = pageNumber + offset;
    if (newPage >= 1 && newPage <= numPages) {
      setPageNumber(newPage);
      onPageChange?.(newPage);
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= numPages) {
      setPageNumber(page);
      onPageChange?.(page);
    }
  }

  function zoomIn() {
    setScale((prev) => Math.min(prev + 0.1, 2.0));
  }

  function zoomOut() {
    setScale((prev) => Math.max(prev - 0.1, 0.3));
  }

  const currentPageHighlights = highlights.filter((h) => h.page === pageNumber);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3 flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1 || isLoading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {pageNumber} of {numPages || '...'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages || isLoading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={zoomOut}
            disabled={scale <= 0.3}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm w-16 text-center">{Math.round(scale * 100)}%</span>
          <Button
            variant="outline"
            size="sm"
            onClick={zoomIn}
            disabled={scale >= 2.0}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 p-4">
        <div className="flex justify-center">
          {isLoading && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading PDF...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-destructive">{error}</p>
            </div>
          )}

          <div className="relative">
            <Document
              file={url}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading=""
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>

            {currentPageHighlights.map((highlight, index) => (
              <div
                key={index}
                className="absolute border-2 border-yellow-400 bg-yellow-400/20 pointer-events-none"
                style={{
                  left: `${highlight.x * scale}px`,
                  top: `${highlight.y * scale}px`,
                  width: `${highlight.width * scale}px`,
                  height: `${highlight.height * scale}px`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {numPages > 10 && (
        <div className="border-t px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Jump to page:</span>
            <input
              type="number"
              min={1}
              max={numPages}
              value={pageNumber}
              onChange={(e) => goToPage(parseInt(e.target.value))}
              className="w-20 px-2 py-1 border rounded text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
