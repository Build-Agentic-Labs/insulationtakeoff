'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface BlueprintViewerProps {
  pdfUrl: string;
  pageNumber: number; // 1-indexed
  children?: (dims: { width: number; height: number }) => React.ReactNode;
}

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 5.0;
const ZOOM_FACTOR = 0.1;

export function BlueprintViewer({ pdfUrl, pageNumber, children }: BlueprintViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [view, setView] = useState<ViewState>({ scale: 1.0, offsetX: 0, offsetY: 0 });
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  // Device pixel ratio for sharp rendering
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 2;

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    pdfjsLib.getDocument(pdfUrl).promise.then((pdf) => {
      if (!cancelled) {
        pdfDocRef.current = pdf;
        // Trigger render
        setView((v) => ({ ...v }));
      }
    });

    return () => { cancelled = true; };
  }, [pdfUrl]);

  // Render the current page at current scale
  useEffect(() => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container) return;

    let cancelled = false;

    // Cancel any in-progress render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return;

      // Get the base viewport (scale 1.0) to know the page's native dimensions
      const baseViewport = page.getViewport({ scale: 1.0 });

      // Fit the page to the container width at scale 1.0
      const containerWidth = container.clientWidth - 48; // padding
      const fitScale = containerWidth / baseViewport.width;

      // Apply user zoom on top of fit scale
      const effectiveScale = fitScale * view.scale;
      const viewport = page.getViewport({ scale: effectiveScale });

      // Set canvas size: CSS size = viewport size, actual pixels = viewport * dpr
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);

      setPageDims({ width: viewport.width, height: viewport.height });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Scale the canvas context for high DPI
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });

      renderTaskRef.current = renderTask;

      renderTask.promise.then(() => {
        if (!cancelled) {
          setIsLoading(false);
          renderTaskRef.current = null;
        }
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message !== 'Rendering cancelled') {
          console.error('PDF render error:', err);
        }
      });
    });

    return () => { cancelled = true; };
  }, [pageNumber, view.scale, dpr]);

  // Fit to container when page changes
  useEffect(() => {
    setView({ scale: 1.0, offsetX: 0, offsetY: 0 });
  }, [pageNumber]);

  // Wheel zoom — zooms toward cursor position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Always intercept Ctrl/Meta+wheel to prevent browser zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -ZOOM_FACTOR : ZOOM_FACTOR;
        setView((prev) => {
          const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale + delta));
          return { ...prev, scale: newScale };
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan with middle mouse button or when holding space
    // For left click, let the SVG overlay handle it (drawing)
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      };
    }
  }, [view.offsetX, view.offsetY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setView((prev) => ({
      ...prev,
      offsetX: panStartRef.current.offsetX + dx,
      offsetY: panStartRef.current.offsetY + dy,
    }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Zoom controls (exposed via toolbar)
  const zoomIn = useCallback(() => {
    setView((prev) => ({
      ...prev,
      scale: Math.min(MAX_SCALE, Math.round((prev.scale + 0.15) * 100) / 100),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setView((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.round((prev.scale - 0.15) * 100) / 100),
    }));
  }, []);

  const fitToView = useCallback(() => {
    setView({ scale: 1.0, offsetX: 0, offsetY: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-zinc-100"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isPanning ? 'grabbing' : undefined }}
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

      {/* Canvas + overlay container */}
      <div
        className="flex justify-center p-6 min-h-full"
        style={{
          transform: `translate(${view.offsetX}px, ${view.offsetY}px)`,
        }}
      >
        <div className="relative inline-block shadow-lg rounded">
          <canvas ref={canvasRef} className="block rounded" />

          {/* SVG overlay for regions — exact same size as the rendered canvas */}
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

      {/* Zoom controls bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur border border-zinc-200 rounded-lg px-2 py-1 shadow-sm z-20">
        <button
          onClick={zoomOut}
          className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors text-lg font-medium"
          title="Zoom out"
        >
          −
        </button>
        <span className="text-xs text-zinc-500 w-12 text-center tabular-nums select-none">
          {Math.round(view.scale * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors text-lg font-medium"
          title="Zoom in"
        >
          +
        </button>
        <div className="w-px h-4 bg-zinc-200 mx-1" />
        <button
          onClick={fitToView}
          className="px-2 h-7 flex items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
          title="Fit to view"
        >
          Fit
        </button>
      </div>
    </div>
  );
}
