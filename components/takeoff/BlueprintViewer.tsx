'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface BlueprintViewerProps {
  pdfUrl: string;
  pageNumber: number;
  children?: (dims: { width: number; height: number }) => React.ReactNode;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.1;

// Max canvas pixels (width * height). Safari caps at ~268M, Chrome at ~16384 per side.
// We use a conservative budget that works on all browsers including mobile Safari.
const MAX_CANVAS_AREA = 16_000_000; // 16M pixels — safe everywhere
const MAX_CANVAS_SIDE = 8000;

export function BlueprintViewer({ pdfUrl, pageNumber, children }: BlueprintViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [scale, setScale] = useState(1.0);
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Load PDF
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

  // Render page
  useEffect(() => {
    if (!pdfDoc) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let cancelled = false;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDoc.getPage(pageNumber).then((page) => {
      if (cancelled) return;

      const baseVp = page.getViewport({ scale: 1.0 });

      // CSS dimensions: fit to container at scale=1, then apply zoom
      const containerWidth = Math.max(container.clientWidth - 48, 400);
      const fitScale = containerWidth / baseVp.width;
      const cssWidth = Math.round(baseVp.width * fitScale * scale);
      const cssHeight = Math.round(baseVp.height * fitScale * scale);

      // Canvas pixel dimensions: start at 2x CSS (retina), then clamp
      let pixelWidth = cssWidth * 2;
      let pixelHeight = cssHeight * 2;

      // Clamp per-side
      if (pixelWidth > MAX_CANVAS_SIDE) {
        const ratio = MAX_CANVAS_SIDE / pixelWidth;
        pixelWidth = MAX_CANVAS_SIDE;
        pixelHeight = Math.round(pixelHeight * ratio);
      }
      if (pixelHeight > MAX_CANVAS_SIDE) {
        const ratio = MAX_CANVAS_SIDE / pixelHeight;
        pixelHeight = MAX_CANVAS_SIDE;
        pixelWidth = Math.round(pixelWidth * ratio);
      }

      // Clamp total area
      const area = pixelWidth * pixelHeight;
      if (area > MAX_CANVAS_AREA) {
        const shrink = Math.sqrt(MAX_CANVAS_AREA / area);
        pixelWidth = Math.floor(pixelWidth * shrink);
        pixelHeight = Math.floor(pixelHeight * shrink);
      }

      // Set canvas sizes
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;

      setPageDims({ width: cssWidth, height: cssHeight });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Render: pdfjs viewport matches the pixel dimensions exactly
      const renderVp = page.getViewport({ scale: pixelWidth / baseVp.width });

      const renderTask = page.render({ canvasContext: ctx, viewport: renderVp });
      renderTaskRef.current = renderTask;

      renderTask.promise.then(() => {
        if (!cancelled) {
          setIsLoading(false);
          renderTaskRef.current = null;
        }
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('Rendering cancelled')) return;
        if (!cancelled) console.error('[BlueprintViewer] Render error:', err);
      });
    });

    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber, scale]);

  // Reset on page change
  useEffect(() => {
    setScale(1.0);
    setIsLoading(true);
  }, [pageNumber]);

  // Ctrl+wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale((s) => {
          const next = Math.round((s + delta) * 100) / 100;
          return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        });
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
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 rounded-full border-2 border-zinc-300 border-t-blue-500 animate-spin" />
            <span className="text-xs text-zinc-400">Loading blueprint…</span>
          </div>
        </div>
      )}

      <div className="flex justify-center p-6 min-h-full">
        <div className="relative inline-block shadow-lg rounded">
          <canvas ref={canvasRef} className="block rounded" />

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

      {/* Zoom controls */}
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
