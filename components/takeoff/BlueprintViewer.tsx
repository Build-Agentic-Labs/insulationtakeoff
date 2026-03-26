'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface BlueprintViewerProps {
  pdfUrl: string;
  pageNumber: number; // 1-indexed
  children?: (dims: { width: number; height: number }) => React.ReactNode;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 5.0;
const ZOOM_STEP = 0.15;

export function BlueprintViewer({ pdfUrl, pageNumber, children }: BlueprintViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [scale, setScale] = useState(1.0);
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const dpr = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio, 2) : 2;

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setPdfDoc(null);

    pdfjsLib.getDocument(pdfUrl).promise.then((pdf) => {
      if (!cancelled) setPdfDoc(pdf);
    }).catch((err) => {
      if (!cancelled) console.error('[BlueprintViewer] PDF load error:', err);
    });

    return () => { cancelled = true; };
  }, [pdfUrl]);

  // Render page whenever pdfDoc, pageNumber, or scale changes
  useEffect(() => {
    if (!pdfDoc) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let cancelled = false;

    // Cancel previous render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDoc.getPage(pageNumber).then((page) => {
      if (cancelled) return;

      const baseViewport = page.getViewport({ scale: 1.0 });

      // Fit page to container width at scale=1.0
      const containerWidth = container.clientWidth - 48;
      const fitScale = Math.max(0.1, containerWidth / baseViewport.width);

      const effectiveScale = fitScale * scale;
      const viewport = page.getViewport({ scale: effectiveScale });

      // Canvas CSS size = viewport, canvas pixel size = viewport * dpr
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);

      setPageDims({ width: viewport.width, height: viewport.height });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const renderTask = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;

      renderTask.promise.then(() => {
        if (!cancelled) {
          setIsLoading(false);
          renderTaskRef.current = null;
        }
      }).catch((err: unknown) => {
        // Ignore cancellation errors
        if (err instanceof Error && err.message.includes('Rendering cancelled')) return;
        if (!cancelled) console.error('[BlueprintViewer] Render error:', err);
      });
    });

    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber, scale, dpr]);

  // Reset scale when page changes
  useEffect(() => {
    setScale(1.0);
    setIsLoading(true);
  }, [pageNumber]);

  // Wheel zoom (native listener to allow preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 100) / 100)));
      }
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, Math.round((s + ZOOM_STEP) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, Math.round((s - ZOOM_STEP) * 100) / 100));
  }, []);

  const fitToView = useCallback(() => setScale(1.0), []);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-zinc-100"
    >
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 rounded-full border-2 border-zinc-300 border-t-blue-500 animate-spin" />
            <span className="text-xs text-zinc-400">Loading blueprint…</span>
          </div>
        </div>
      )}

      {/* Canvas + overlay */}
      <div className="flex justify-center p-6 min-h-full">
        <div className="relative inline-block shadow-lg rounded">
          <canvas ref={canvasRef} className="block rounded" />

          {/* SVG overlay for drawing regions */}
          {pageDims.width > 0 && pageDims.height > 0 && children && (
            <div
              className="absolute top-0 left-0"
              style={{ width: pageDims.width, height: pageDims.height }}
            >
              {children(pageDims)}
            </div>
          )}
        </div>
      </div>

      {/* Floating zoom controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur border border-zinc-200 rounded-lg px-2 py-1 shadow-sm z-20">
        <button
          onClick={zoomOut}
          className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors text-lg font-medium"
        >
          −
        </button>
        <span className="text-xs text-zinc-500 w-12 text-center tabular-nums select-none">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors text-lg font-medium"
        >
          +
        </button>
        <div className="w-px h-4 bg-zinc-200 mx-1" />
        <button
          onClick={fitToView}
          className="px-2 h-7 flex items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
        >
          Fit
        </button>
      </div>
    </div>
  );
}
