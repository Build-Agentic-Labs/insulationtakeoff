'use client';

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PdfPoint } from '@/lib/types/takeoff';
import {
  fetchSnapPoints,
  resolveSnapDecision,
  type SnapCandidateDebug,
  type SnapDecision,
  type SnapPointSet,
} from '@/lib/pdf/extract-vectors';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface BlueprintViewerHandle {
  cssToPageCoords: (clientX: number, clientY: number) => PdfPoint | null;
  pageCoordsToCss: (pdfX: number, pdfY: number) => { x: number; y: number } | null;
  pageCoordsToRenderCss: (pdfX: number, pdfY: number) => { x: number; y: number } | null;
  getVisibleCanvasElement: () => HTMLCanvasElement | null;
  getViewportClientRect: () => DOMRect | null;
  getScale: () => number;
  getPageDims: () => { width: number; height: number };
  isZooming: () => boolean;
  isPanning: () => boolean;
  snapToVector: (
    point: PdfPoint,
    options?:
      | number
      | {
          screenThresholdPx?: number;
          pdfThresholdPts?: number;
          disabled?: boolean;
          debugSource?: string;
        },
  ) => PdfPoint;
  getSnapStats: () => { pointCount: number; lineCount: number } | null;
}

interface BlueprintViewerProps {
  pdfUrl: string;
  pageNumber: number;
  cursorMode?: 'default' | 'crosshair' | 'none';
  disableLeftMousePan?: boolean;
  viewportInset?: number;
  workspacePadding?: number;
  minScale?: number;
  children?: (dims: { width: number; height: number }) => React.ReactNode;
}

export interface SnapDebugEntry {
  timestamp: number;
  source: string;
  outcome: 'snapped' | 'no_snap_data' | 'disabled' | SnapDecision['reason'];
  pageNumber: number;
  totalSnapPoints: number;
  significantLines: number;
  thresholdPts: number | null;
  screenThresholdPx: number | null;
  target: PdfPoint;
  snappedPoint: PdfPoint | null;
  nearestKnown: SnapCandidateDebug | null;
  candidateCount: number;
  topCandidates: Array<{
    x: number;
    y: number;
    connections: number;
    dist: number;
  }>;
  bestCandidate: {
    x: number;
    y: number;
    connections: number;
    dist: number;
  } | null;
  runnerUpCandidate: {
    x: number;
    y: number;
    connections: number;
    dist: number;
  } | null;
  distanceDelta: number | null;
  candidateSeparation: number | null;
}

function emitTakeoffGestureDebug(detail: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('takeoff-gesture-debug', {
      detail: {
        timestamp: Date.now(),
        ...detail,
      },
    }),
  );
}

function emitTakeoffSnapDebug(detail: SnapDebugEntry) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('takeoff-snap-debug', {
      detail,
    }),
  );
}

type RasterLayerKey = 'primary' | 'secondary';

const MIN_SCALE = 0.85;
const MAX_SCALE = 6.5;
const MAX_RASTER_SCALE = 5.25;
const MAX_RASTER_RENDER_DIM = 8192;
const MIN_RASTER_RENDER_SCALE = 1;
const ZOOM_REFERENCE_SCALE = 0.85;
const ZOOM_REFERENCE_STEP = 0.12;
const ZOOM_STEP_MULTIPLIER = (ZOOM_REFERENCE_SCALE + ZOOM_REFERENCE_STEP) / ZOOM_REFERENCE_SCALE;
const PINCH_ZOOM_SENSITIVITY = 0.012;
const RASTER_COMMIT_DELAY_MS = 80;
const RASTER_FADE_DURATION_MS = 160;
const WORKSPACE_PADDING = 64;
const VIEWPORT_INSET = 24;

function BlueprintLoadingSkeleton() {
  return (
    <div className="takeoff-blueprint-loading-dots takeoff-dot-grid flex h-full w-full items-center justify-center overflow-hidden bg-[var(--takeoff-canvas)]">
      <div className="flex items-center gap-2 rounded-full border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.72)] px-3 py-1.5 shadow-[0_10px_24px_rgba(31,39,33,0.08)] backdrop-blur-sm">
        <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--takeoff-ink)]" />
        <span className="takeoff-mono text-[10px] text-[var(--takeoff-text-muted)]">
          Loading blueprint
        </span>
      </div>
    </div>
  );
}

export const BlueprintViewer = forwardRef<BlueprintViewerHandle, BlueprintViewerProps>(
  function BlueprintViewer({
    pdfUrl,
    pageNumber,
    cursorMode = 'default',
    disableLeftMousePan = false,
    viewportInset = VIEWPORT_INSET,
    workspacePadding = WORKSPACE_PADDING,
    minScale = MIN_SCALE,
    children,
  }, ref) {
    const clampScale = useCallback((nextScale: number) => {
      return Math.min(MAX_SCALE, Math.max(minScale, nextScale));
    }, [minScale]);

    const getNextZoomScale = useCallback((currentScale: number, direction: 1 | -1) => {
      const rawNext =
        direction > 0
          ? currentScale * ZOOM_STEP_MULTIPLIER
          : currentScale / ZOOM_STEP_MULTIPLIER;
      const roundedNext = Math.round(rawNext * 100) / 100;
      return clampScale(roundedNext);
    }, [clampScale]);

    const getNextPinchZoomScale = useCallback((currentScale: number, deltaY: number) => {
      return clampScale(currentScale * Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY));
    }, [clampScale]);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasWrapperRef = useRef<HTMLDivElement>(null);
    const primaryRasterLayerRef = useRef<HTMLDivElement>(null);
    const secondaryRasterLayerRef = useRef<HTMLDivElement>(null);
    const layoutStateRef = useRef({
      pageWidth: 0,
      pageHeight: 0,
      renderedWidth: 0,
      renderedHeight: 0,
    });
    const interactionStateRef = useRef({
      scale: 1,
      isZooming: false,
      isPanning: false,
    });
    const pendingViewportRef = useRef<{ scale: number; scrollLeft: number; scrollTop: number } | null>(null);
    const shouldAutoFitOnLoadRef = useRef(true);
    const rasterCommitTimerRef = useRef<number | null>(null);
    const rasterFadeTimerRef = useRef<number | null>(null);
    const lastWheelEventRef = useRef<{ time: number; action: 'zoom' | 'pan' | 'ctrl-zoom' | 'pinch-zoom' } | null>(null);
    const panSessionRef = useRef<{
      active: boolean;
      candidate: boolean;
      startX: number;
      startY: number;
      scrollLeft: number;
      scrollTop: number;
    } | null>(null);
    const suppressClickRef = useRef(false);
    const viewportRef = useRef<{ baseWidth: number; baseHeight: number; fitScale: number } | null>(null);
    const snapPointsRef = useRef<SnapPointSet | null>(null);

    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [basePageSize, setBasePageSize] = useState<{ width: number; height: number } | null>(null);
    const [scale, setScale] = useState(1);
    const [visibleRasterLayer, setVisibleRasterLayer] = useState<RasterLayerKey>('primary');
    const [stagingRasterLayer, setStagingRasterLayer] = useState<RasterLayerKey | null>(null);
    const [fadingRasterLayer, setFadingRasterLayer] = useState<RasterLayerKey | null>(null);
    const [rasterLayerScales, setRasterLayerScales] = useState<Record<RasterLayerKey, number>>({
      primary: 1,
      secondary: 1,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [spacePanMode, setSpacePanMode] = useState(false);
    const [isDraggingPan, setIsDraggingPan] = useState(false);
    const [renderError, setRenderError] = useState<string | null>(null);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerSize({
            width: Math.max(entry.contentRect.width - viewportInset, 400),
            height: Math.max(entry.contentRect.height - viewportInset, 320),
          });
        }
      });

      observer.observe(el);
      return () => observer.disconnect();
    }, [viewportInset]);

    const fitWidth = containerSize.width > 0 ? containerSize.width : 800;
    const fitHeight = containerSize.height > 0 ? containerSize.height : 1000;
    const availableFitWidth = Math.max(fitWidth - workspacePadding * 2, 200);
    const availableFitHeight = Math.max(fitHeight - workspacePadding * 2, 200);
    // Default to fit-width so plan sheets stay readable and vertically scrollable.
    const fitScale = basePageSize
      ? availableFitWidth / basePageSize.width
      : 1;
    const maxSafeRasterScale = basePageSize
      ? Math.max(
          MIN_RASTER_RENDER_SCALE,
          Math.min(
            MAX_SCALE,
            MAX_RASTER_SCALE,
            MAX_RASTER_RENDER_DIM / Math.max(basePageSize.width * fitScale, 1),
            MAX_RASTER_RENDER_DIM / Math.max(basePageSize.height * fitScale, 1)
          )
        )
      : MAX_SCALE;
    const getRasterRenderScale = useCallback((targetScale: number) => {
      const roundedScale = Math.round(Math.min(Math.max(targetScale, MIN_RASTER_RENDER_SCALE), maxSafeRasterScale) * 100) / 100;
      return Math.min(MAX_SCALE, Math.max(MIN_RASTER_RENDER_SCALE, roundedScale));
    }, [maxSafeRasterScale]);
    const displayWidth = Math.max(
      200,
      (basePageSize ? basePageSize.width * fitScale : fitWidth) * scale
    );
    const pageWidth = displayWidth;
    const pageHeight = basePageSize ? basePageSize.height * fitScale * scale : 0;
    const primaryRasterScale = rasterLayerScales.primary;
    const secondaryRasterScale = rasterLayerScales.secondary;
    const getRenderedWidthForScale = (targetScale: number) =>
      Math.max(
        200,
        Math.round((basePageSize ? basePageSize.width * fitScale : fitWidth) * targetScale)
      );
    const getRenderedHeightForScale = (targetScale: number) =>
      basePageSize ? Math.round(basePageSize.height * fitScale * targetScale) : 0;
    const rasterScale = rasterLayerScales[visibleRasterLayer];
    const renderedWidth = getRenderedWidthForScale(rasterScale);
    const renderedHeight = getRenderedHeightForScale(rasterScale);
    const workspaceWidth = Math.max(containerSize.width + workspacePadding * 2, pageWidth + workspacePadding * 2);
    const workspaceHeight = Math.max(containerSize.height + workspacePadding * 2, pageHeight + workspacePadding * 2);
    const pageLeft = (workspaceWidth - pageWidth) / 2;
    const pageTop = (workspaceHeight - pageHeight) / 2;
    const primaryRenderedWidth = getRenderedWidthForScale(primaryRasterScale);
    const primaryRenderedHeight = getRenderedHeightForScale(primaryRasterScale);
    const secondaryRenderedWidth = getRenderedWidthForScale(secondaryRasterScale);
    const secondaryRenderedHeight = getRenderedHeightForScale(secondaryRasterScale);
    const primaryLiveZoomRatio = primaryRenderedWidth > 0 ? pageWidth / primaryRenderedWidth : 1;
    const secondaryLiveZoomRatio =
      secondaryRenderedWidth > 0 ? pageWidth / secondaryRenderedWidth : 1;
    const targetRasterScale = getRasterRenderScale(scale);
    const isZooming =
      Math.abs(rasterScale - targetRasterScale) >= 0.001 ||
      stagingRasterLayer !== null ||
      fadingRasterLayer !== null;

    layoutStateRef.current = {
      pageWidth,
      pageHeight,
      renderedWidth,
      renderedHeight,
    };

    useEffect(() => {
      if (!viewportRef.current || !basePageSize) return;
      viewportRef.current = {
        ...viewportRef.current,
        baseWidth: basePageSize.width,
        baseHeight: basePageSize.height,
        fitScale,
      };
    }, [basePageSize, fitScale]);

    useEffect(() => {
      return () => {
        if (rasterCommitTimerRef.current) {
          window.clearTimeout(rasterCommitTimerRef.current);
        }
        if (rasterFadeTimerRef.current) {
          window.clearTimeout(rasterFadeTimerRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!basePageSize) return;
      if (Math.abs(rasterScale - targetRasterScale) < 0.001) return;

      if (rasterCommitTimerRef.current) {
        window.clearTimeout(rasterCommitTimerRef.current);
      }

      rasterCommitTimerRef.current = window.setTimeout(() => {
        rasterCommitTimerRef.current = null;
        const nextLayer: RasterLayerKey =
          visibleRasterLayer === 'primary' ? 'secondary' : 'primary';
        setRasterLayerScales((current) => ({
          ...current,
          [nextLayer]: targetRasterScale,
        }));
        setStagingRasterLayer(nextLayer);
      }, RASTER_COMMIT_DELAY_MS);

      return () => {
        if (rasterCommitTimerRef.current) {
          window.clearTimeout(rasterCommitTimerRef.current);
          rasterCommitTimerRef.current = null;
        }
      };
    }, [basePageSize, rasterScale, scale, targetRasterScale, visibleRasterLayer]);

    const getFitPageScale = useCallback((baseWidth: number, baseHeight: number) => {
      const widthScale = availableFitWidth / baseWidth;
      const heightScale = availableFitHeight / baseHeight;
      const fitPageScale = Math.min(widthScale, heightScale);
      return Math.min(MAX_SCALE, Math.max(minScale, fitPageScale / widthScale));
    }, [availableFitHeight, availableFitWidth, minScale]);

    const getCenteredViewport = useCallback((
      targetScale: number,
      dims: { width: number; height: number },
      baseFitScaleValue: number = fitScale
    ) => {
      const el = containerRef.current;
      if (!el) {
        return { scrollLeft: 0, scrollTop: 0 };
      }

      const targetPageWidth = Math.max(200, dims.width * baseFitScaleValue * targetScale);
      const targetPageHeight = Math.max(200, dims.height * baseFitScaleValue * targetScale);
      const targetWorkspaceWidth = Math.max(containerSize.width + workspacePadding * 2, targetPageWidth + workspacePadding * 2);
      const targetWorkspaceHeight = Math.max(containerSize.height + workspacePadding * 2, targetPageHeight + workspacePadding * 2);

      return {
        scrollLeft: Math.max(0, (targetWorkspaceWidth - el.clientWidth) / 2),
        scrollTop: Math.max(0, (targetWorkspaceHeight - el.clientHeight) / 2),
      };
    }, [containerSize.height, containerSize.width, fitScale, workspacePadding]);

    const getTargetLayout = useCallback((
      targetScale: number,
      dims: { width: number; height: number },
      baseFitScaleValue: number
    ) => {
      const targetPageWidth = Math.max(200, dims.width * baseFitScaleValue * targetScale);
      const targetPageHeight = Math.max(200, dims.height * baseFitScaleValue * targetScale);
      const targetWorkspaceWidth = Math.max(
        containerSize.width + workspacePadding * 2,
        targetPageWidth + workspacePadding * 2
      );
      const targetWorkspaceHeight = Math.max(
        containerSize.height + workspacePadding * 2,
        targetPageHeight + workspacePadding * 2
      );

      return {
        pageWidth: targetPageWidth,
        pageHeight: targetPageHeight,
        workspaceWidth: targetWorkspaceWidth,
        workspaceHeight: targetWorkspaceHeight,
        pageLeft: (targetWorkspaceWidth - targetPageWidth) / 2,
        pageTop: (targetWorkspaceHeight - targetPageHeight) / 2,
      };
    }, [containerSize.height, containerSize.width, workspacePadding]);

    const cssToPageCoords = useCallback((clientX: number, clientY: number): PdfPoint | null => {
      const wrapper = canvasWrapperRef.current;
      const vp = viewportRef.current;
      if (!wrapper || !vp) return null;

      const rect = wrapper.getBoundingClientRect();
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      const scaleX = rect.width / vp.baseWidth;
      const scaleY = rect.height / vp.baseHeight;

      return {
        x: cssX / scaleX,
        y: cssY / scaleY,
      };
    }, []);

    const pageCoordsToCss = useCallback((pdfX: number, pdfY: number): { x: number; y: number } | null => {
      const vp = viewportRef.current;
      if (!vp) return null;

      const { pageWidth: currentPageWidth, pageHeight: currentPageHeight } = layoutStateRef.current;
      const scaleX = currentPageWidth / vp.baseWidth;
      const scaleY = currentPageHeight / vp.baseHeight;
      return {
        x: pdfX * scaleX,
        y: pdfY * scaleY,
      };
    }, []);

    const pageCoordsToRenderCss = useCallback((pdfX: number, pdfY: number): { x: number; y: number } | null => {
      const vp = viewportRef.current;
      if (!vp) return null;

      const { renderedWidth: currentRenderedWidth, renderedHeight: currentRenderedHeight } = layoutStateRef.current;
      const scaleX = currentRenderedWidth / vp.baseWidth;
      const scaleY = currentRenderedHeight / vp.baseHeight;
      return {
        x: pdfX * scaleX,
        y: pdfY * scaleY,
      };
    }, []);

    const getPdfThresholdForScreenPixels = useCallback((screenPixels: number) => {
      const vp = viewportRef.current;
      if (!vp) return screenPixels;

      const { pageWidth: currentPageWidth, pageHeight: currentPageHeight } = layoutStateRef.current;
      if (currentPageWidth <= 0 || currentPageHeight <= 0) {
        return screenPixels;
      }

      const pdfPerCssPixelX = vp.baseWidth / currentPageWidth;
      const pdfPerCssPixelY = vp.baseHeight / currentPageHeight;
      return screenPixels * Math.max(pdfPerCssPixelX, pdfPerCssPixelY);
    }, []);

    useEffect(() => {
      let cancelled = false;
      snapPointsRef.current = null;

      (async () => {
        try {
          const snapData = await fetchSnapPoints(pdfUrl, pageNumber - 1);
          if (!cancelled) {
            snapPointsRef.current = snapData;
          }
        } catch (err) {
          if (!cancelled) {
            snapPointsRef.current = null;
          }
          console.error('[Snap] Failed to load snap points:', err);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [pdfUrl, pageNumber]);

    useEffect(() => {
      viewportRef.current = null;
      shouldAutoFitOnLoadRef.current = true;
      setBasePageSize(null);
      setScale(1);
      setVisibleRasterLayer('primary');
      setStagingRasterLayer(null);
      setFadingRasterLayer(null);
      setRasterLayerScales({ primary: 1, secondary: 1 });
      setIsLoading(true);
      setRenderError(null);
      pendingViewportRef.current = null;
      snapPointsRef.current = null;
      if (rasterCommitTimerRef.current) {
        window.clearTimeout(rasterCommitTimerRef.current);
        rasterCommitTimerRef.current = null;
      }
      if (rasterFadeTimerRef.current) {
        window.clearTimeout(rasterFadeTimerRef.current);
        rasterFadeTimerRef.current = null;
      }
    }, [pageNumber, pdfUrl]);

    const zoomAtPoint = useCallback((
      clientX: number,
      clientY: number,
      getTargetScale: (prevScale: number) => number,
    ) => {
      const el = containerRef.current;
      const wrapper = canvasWrapperRef.current;
      if (!el) return;

      setScale((prevScale) => {
        const requestedScale = getTargetScale(prevScale);
        const newScale = clampScale(requestedScale);
        if (Math.abs(newScale - prevScale) < 0.001) return prevScale;

        const rect = el.getBoundingClientRect();
        const cursorX = clientX - rect.left;
        const cursorY = clientY - rect.top;
        const viewport = viewportRef.current;
        const wrapperRect = wrapper?.getBoundingClientRect() ?? null;
        const pdfPoint =
          viewport && wrapperRect
            ? {
                x: ((clientX - wrapperRect.left) / wrapperRect.width) * viewport.baseWidth,
                y: ((clientY - wrapperRect.top) / wrapperRect.height) * viewport.baseHeight,
              }
            : null;

        if (viewport && pdfPoint) {
          const nextLayout = getTargetLayout(
            newScale,
            { width: viewport.baseWidth, height: viewport.baseHeight },
            viewport.fitScale
          );
          const nextScaleX = nextLayout.pageWidth / viewport.baseWidth;
          const nextScaleY = nextLayout.pageHeight / viewport.baseHeight;
          const nextScrollLeft = nextLayout.pageLeft + pdfPoint.x * nextScaleX - cursorX;
          const nextScrollTop = nextLayout.pageTop + pdfPoint.y * nextScaleY - cursorY;
          const maxScrollLeft = Math.max(0, nextLayout.workspaceWidth - el.clientWidth);
          const maxScrollTop = Math.max(0, nextLayout.workspaceHeight - el.clientHeight);

          pendingViewportRef.current = {
            scale: newScale,
            scrollLeft: Math.max(0, Math.min(maxScrollLeft, nextScrollLeft)),
            scrollTop: Math.max(0, Math.min(maxScrollTop, nextScrollTop)),
          };
          return newScale;
        }

        const contentX = el.scrollLeft + cursorX;
        const contentY = el.scrollTop + cursorY;
        const ratio = newScale / prevScale;

        pendingViewportRef.current = {
          scale: newScale,
          scrollLeft: contentX * ratio - cursorX,
          scrollTop: contentY * ratio - cursorY,
        };

        return newScale;
      });
    }, [clampScale, getTargetLayout]);

    const isLikelyMouseWheelZoomGesture = useCallback((event: WheelEvent) => {
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      const sourceCapabilities = (event as WheelEvent & {
        sourceCapabilities?: { firesTouchEvents?: boolean } | null;
      }).sourceCapabilities;

      if (absY === 0) {
        return false;
      }

      if (event.ctrlKey || event.metaKey) {
        return false;
      }

      // On Mac trackpads, ordinary two-finger pan also arrives as pixel-mode
      // wheel input. Do not start zoom from those events. Trackpad zoom is
      // handled separately through the pinch path.
      if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        return false;
      }

      // Trackpads often surface wheel events but still advertise that they are
      // touch-like input. Never start wheel-zoom from those.
      if (sourceCapabilities?.firesTouchEvents) {
        return false;
      }

      // Some physical wheels report a small horizontal jitter. Allow a tiny
      // amount so those events do not fall through into pan behavior.
      if (absX > Math.max(6, absY * 0.35)) {
        return false;
      }

      // Traditional mouse wheels usually report line/page deltas or large,
      // discrete vertical steps. Trackpads tend to produce smaller pixel deltas
      // and often include diagonal movement.
      if (
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ||
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ) {
        return true;
      }

      return false;
    }, []);

    const isLikelyTrackpadPinchGesture = useCallback((event: WheelEvent) => {
      const lastWheelEvent = lastWheelEventRef.current;
      const sinceLastWheel = lastWheelEvent ? event.timeStamp - lastWheelEvent.time : Number.POSITIVE_INFINITY;

      if (!(event.ctrlKey || event.metaKey)) {
        return false;
      }

      if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        return false;
      }

      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);

      if (absX > Math.max(4, absY * 0.35)) {
        return false;
      }

      if (
        lastWheelEvent?.action === 'pinch-zoom' &&
        sinceLastWheel <= 220 &&
        absY >= 1
      ) {
        return true;
      }

      if (absY < 5) {
        return false;
      }

      return true;
    }, []);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const isInsideViewport = (event: WheelEvent) => {
        const rect = el.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      };

      const isInsideWheelGuard = (event: WheelEvent) => {
        const target = event.target;
        return target instanceof Element && Boolean(target.closest('[data-takeoff-wheel-guard="true"]'));
      };

      const handler = (e: WheelEvent) => {
        if (isInsideWheelGuard(e)) {
          return;
        }

        if (!isInsideViewport(e)) {
          return;
        }

        if (isLikelyTrackpadPinchGesture(e)) {
          e.preventDefault();
          e.stopPropagation();
          const nextScale = getNextPinchZoomScale(interactionStateRef.current.scale, e.deltaY);
          zoomAtPoint(e.clientX, e.clientY, (prevScale) =>
            getNextPinchZoomScale(prevScale, e.deltaY),
          );
          lastWheelEventRef.current = { time: e.timeStamp, action: 'pinch-zoom' };
          emitTakeoffGestureDebug({
            source: 'viewer',
            action: 'pinch-zoom',
            deltaMode: e.deltaMode,
            deltaX: Number(e.deltaX.toFixed(2)),
            deltaY: Number(e.deltaY.toFixed(2)),
            wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? null,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            firesTouchEvents:
              (
                e as WheelEvent & {
                  sourceCapabilities?: { firesTouchEvents?: boolean } | null;
                }
              ).sourceCapabilities?.firesTouchEvents ?? null,
            scaleBefore: interactionStateRef.current.scale,
            scaleAfter: nextScale,
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop,
          });
          return;
        }

        if ((e.ctrlKey || e.metaKey) && e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
          e.preventDefault();
          e.stopPropagation();
          const nextScale = getNextZoomScale(interactionStateRef.current.scale, e.deltaY > 0 ? -1 : 1);
          zoomAtPoint(e.clientX, e.clientY, (prevScale) =>
            getNextZoomScale(prevScale, e.deltaY > 0 ? -1 : 1),
          );
          lastWheelEventRef.current = { time: e.timeStamp, action: 'ctrl-zoom' };
          emitTakeoffGestureDebug({
            source: 'viewer',
            action: 'ctrl-zoom',
            deltaMode: e.deltaMode,
            deltaX: Number(e.deltaX.toFixed(2)),
            deltaY: Number(e.deltaY.toFixed(2)),
            wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? null,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            firesTouchEvents:
              (
                e as WheelEvent & {
                  sourceCapabilities?: { firesTouchEvents?: boolean } | null;
                }
              ).sourceCapabilities?.firesTouchEvents ?? null,
            scaleBefore: interactionStateRef.current.scale,
            scaleAfter: nextScale,
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop,
          });
          return;
        }

        if (isLikelyMouseWheelZoomGesture(e)) {
          e.preventDefault();
          e.stopPropagation();
          const nextScale = getNextZoomScale(interactionStateRef.current.scale, e.deltaY > 0 ? -1 : 1);
          zoomAtPoint(e.clientX, e.clientY, (prevScale) =>
            getNextZoomScale(prevScale, e.deltaY > 0 ? -1 : 1),
          );
          lastWheelEventRef.current = { time: e.timeStamp, action: 'zoom' };
          emitTakeoffGestureDebug({
            source: 'viewer',
            action: 'zoom',
            deltaMode: e.deltaMode,
            deltaX: Number(e.deltaX.toFixed(2)),
            deltaY: Number(e.deltaY.toFixed(2)),
            wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? null,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            firesTouchEvents:
              (
                e as WheelEvent & {
                  sourceCapabilities?: { firesTouchEvents?: boolean } | null;
                }
              ).sourceCapabilities?.firesTouchEvents ?? null,
            scaleBefore: interactionStateRef.current.scale,
            scaleAfter: nextScale,
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop,
          });
          return;
        }

        // Consume trackpad and wheel pan gestures inside the blueprint viewport so
        // horizontal edge swipes do not bubble up into browser back/forward navigation.
        if (e.deltaX !== 0 || e.deltaY !== 0) {
          const scrollLeftBefore = el.scrollLeft;
          const scrollTopBefore = el.scrollTop;
          e.preventDefault();
          e.stopPropagation();
          el.scrollLeft += e.deltaX;
          el.scrollTop += e.deltaY;
          lastWheelEventRef.current = { time: e.timeStamp, action: 'pan' };
          emitTakeoffGestureDebug({
            source: 'viewer',
            action: 'pan',
            deltaMode: e.deltaMode,
            deltaX: Number(e.deltaX.toFixed(2)),
            deltaY: Number(e.deltaY.toFixed(2)),
            wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? null,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            firesTouchEvents:
              (
                e as WheelEvent & {
                  sourceCapabilities?: { firesTouchEvents?: boolean } | null;
                }
              ).sourceCapabilities?.firesTouchEvents ?? null,
            scaleBefore: interactionStateRef.current.scale,
            scaleAfter: interactionStateRef.current.scale,
            scrollLeftBefore,
            scrollLeftAfter: el.scrollLeft,
            scrollTopBefore,
            scrollTopAfter: el.scrollTop,
          });
        }
      };

      window.addEventListener('wheel', handler, { passive: false, capture: true });
      return () => window.removeEventListener('wheel', handler, { capture: true });
    }, [getNextPinchZoomScale, getNextZoomScale, isLikelyMouseWheelZoomGesture, isLikelyTrackpadPinchGesture, zoomAtPoint]);

    const zoomFromViewportCenter = useCallback((direction: 1 | -1) => {
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, (prevScale) =>
        getNextZoomScale(prevScale, direction),
      );
    }, [getNextZoomScale, zoomAtPoint]);

    const zoomIn = useCallback(() => {
      zoomFromViewportCenter(1);
    }, [zoomFromViewportCenter]);

    const zoomOut = useCallback(() => {
      zoomFromViewportCenter(-1);
    }, [zoomFromViewportCenter]);

    const fitToView = useCallback(() => {
      if (!basePageSize) return;

      const targetScale = getFitPageScale(basePageSize.width, basePageSize.height);
      const { scrollLeft: targetScrollLeft, scrollTop: targetScrollTop } = getCenteredViewport(targetScale, basePageSize);
      const el = containerRef.current;

      if (Math.abs(scale - targetScale) < 0.01) {
        pendingViewportRef.current = {
          scale: targetScale,
          scrollLeft: targetScrollLeft,
          scrollTop: targetScrollTop,
        };
        requestAnimationFrame(() => {
          if (!el) return;
          el.scrollLeft = targetScrollLeft;
          el.scrollTop = targetScrollTop;
          pendingViewportRef.current = null;
        });
        return;
      }

      pendingViewportRef.current = {
        scale: targetScale,
        scrollLeft: targetScrollLeft,
        scrollTop: targetScrollTop,
      };
      setScale(targetScale);
    }, [basePageSize, getCenteredViewport, getFitPageScale, scale]);

    const isPanning = spacePanMode || isDraggingPan;
    interactionStateRef.current = {
      scale,
      isZooming,
      isPanning,
    };

    useEffect(() => {
      const down = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          setSpacePanMode(true);
        }
      };
      const up = (e: KeyboardEvent) => {
        if (e.code === 'Space') setSpacePanMode(false);
      };

      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      return () => {
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
      };
    }, []);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const handleMouseDown = (e: MouseEvent) => {
        const immediatePan =
          e.button === 1 ||
          (e.button === 0 && (spacePanMode || (!disableLeftMousePan && cursorMode === 'default')));
        const candidatePan =
          e.button === 0 &&
          !spacePanMode &&
          !disableLeftMousePan &&
          cursorMode !== 'default' &&
          scale > 1;

        if (!immediatePan && !candidatePan) return;

        if (immediatePan) {
          e.preventDefault();
          e.stopPropagation();
        }

        panSessionRef.current = {
          active: immediatePan,
          candidate: candidatePan,
          startX: e.clientX,
          startY: e.clientY,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
        };

        if (immediatePan) {
          setIsDraggingPan(true);
        }
      };

      const handleWindowMouseMove = (e: MouseEvent) => {
        const panSession = panSessionRef.current;
        if (!panSession) return;

        if (!panSession.active && panSession.candidate) {
          const dx = e.clientX - panSession.startX;
          const dy = e.clientY - panSession.startY;
          if (Math.hypot(dx, dy) < 6) {
            return;
          }

          panSession.active = true;
          panSession.candidate = false;
          suppressClickRef.current = true;
          setIsDraggingPan(true);
        }

        if (!panSession.active) return;

        const dx = e.clientX - panSession.startX;
        const dy = e.clientY - panSession.startY;
        el.scrollLeft = panSession.scrollLeft - dx;
        el.scrollTop = panSession.scrollTop - dy;
      };

      const stopPanning = () => {
        if (!panSessionRef.current) return;
        panSessionRef.current = null;
        setIsDraggingPan(false);
      };

      const preventAutoScroll = (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      };

      const suppressClickAfterPan = (e: MouseEvent) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      };

      el.addEventListener('mousedown', handleMouseDown, true);
      el.addEventListener('click', suppressClickAfterPan, true);
      el.addEventListener('auxclick', preventAutoScroll, true);
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', stopPanning);
      window.addEventListener('blur', stopPanning);

      return () => {
        el.removeEventListener('mousedown', handleMouseDown, true);
        el.removeEventListener('click', suppressClickAfterPan, true);
        el.removeEventListener('auxclick', preventAutoScroll, true);
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', stopPanning);
        window.removeEventListener('blur', stopPanning);
      };
    }, [cursorMode, disableLeftMousePan, scale, spacePanMode]);

    useLayoutEffect(() => {
      const el = containerRef.current;
      const pending = pendingViewportRef.current;
      if (!el || !pending || pending.scale !== scale) return;

      el.scrollLeft = pending.scrollLeft;
      el.scrollTop = pending.scrollTop;
      pendingViewportRef.current = null;
    }, [pageHeight, pageWidth, scale]);

    const snapToVector = useCallback((
      point: PdfPoint,
      options:
        | number
        | {
            screenThresholdPx?: number;
            pdfThresholdPts?: number;
            disabled?: boolean;
            debugSource?: string;
          } = 5,
    ): PdfPoint => {
      const snap = snapPointsRef.current;

      const resolvedOptions =
        typeof options === 'number' ? { screenThresholdPx: options } : options;
      const screenThresholdPx = resolvedOptions.screenThresholdPx ?? 5;
      const thresholdPts =
        resolvedOptions.pdfThresholdPts ??
        getPdfThresholdForScreenPixels(screenThresholdPx);
      const emitDebug = (
        outcome: SnapDebugEntry['outcome'],
        decision: SnapDecision | null = null,
      ) => {
        if (!resolvedOptions.debugSource) return;
        emitTakeoffSnapDebug({
          timestamp: Date.now(),
          source: resolvedOptions.debugSource,
          outcome,
          pageNumber,
          totalSnapPoints: snap?.points.length ?? 0,
          significantLines: snap?.significantLines ?? 0,
          thresholdPts: decision?.thresholdPts ?? thresholdPts ?? null,
          screenThresholdPx,
          target: point,
          snappedPoint: decision?.point ?? null,
          nearestKnown: decision?.nearestOverall ?? null,
          candidateCount: decision?.candidateCount ?? 0,
          topCandidates:
            decision?.topCandidates.map((candidate) => ({
              x: candidate.point.x,
              y: candidate.point.y,
              connections: candidate.point.connections,
              dist: candidate.dist,
            })) ?? [],
          bestCandidate: decision?.bestCandidate
            ? {
                x: decision.bestCandidate.point.x,
                y: decision.bestCandidate.point.y,
                connections: decision.bestCandidate.point.connections,
                dist: decision.bestCandidate.dist,
              }
            : null,
          runnerUpCandidate: decision?.runnerUpCandidate
            ? {
                x: decision.runnerUpCandidate.point.x,
                y: decision.runnerUpCandidate.point.y,
                connections: decision.runnerUpCandidate.point.connections,
                dist: decision.runnerUpCandidate.dist,
              }
            : null,
          distanceDelta: decision?.distanceDelta ?? null,
          candidateSeparation: decision?.candidateSeparation ?? null,
        });
      };

      if (!snap) {
        emitDebug('no_snap_data');
        return point;
      }
      if (resolvedOptions.disabled) {
        emitDebug('disabled');
        return point;
      }

      const decision = resolveSnapDecision(point, snap.points, {
        thresholdPts,
        connectionPreferenceWindowPts: getPdfThresholdForScreenPixels(
          Math.max(2, screenThresholdPx * 0.6),
        ),
        ambiguityDistanceDeltaPts: getPdfThresholdForScreenPixels(
          Math.max(1.25, screenThresholdPx * 0.22),
        ),
        ambiguitySeparationPts: getPdfThresholdForScreenPixels(
          Math.max(8, screenThresholdPx * 1.75),
        ),
      });
      emitDebug(decision.reason, decision);
      return decision.point ?? point;
    }, [getPdfThresholdForScreenPixels]);
    useImperativeHandle(ref, () => ({
      cssToPageCoords,
      pageCoordsToCss,
      pageCoordsToRenderCss,
      getVisibleCanvasElement: () => {
        const layer =
          visibleRasterLayer === 'primary'
            ? primaryRasterLayerRef.current
            : secondaryRasterLayerRef.current;
        return layer?.querySelector('canvas') ?? null;
      },
      getViewportClientRect: () => containerRef.current?.getBoundingClientRect() ?? null,
      getScale: () => interactionStateRef.current.scale,
      getPageDims: () => ({
        width: layoutStateRef.current.pageWidth,
        height: layoutStateRef.current.pageHeight,
      }),
      isZooming: () => interactionStateRef.current.isZooming,
      isPanning: () => interactionStateRef.current.isPanning,
      snapToVector,
      getSnapStats: () => {
        const snap = snapPointsRef.current;
        return snap ? { pointCount: snap.points.length, lineCount: snap.significantLines } : null;
      },
    }), [cssToPageCoords, pageCoordsToCss, pageCoordsToRenderCss, snapToVector, visibleRasterLayer]);

    const cursorClass = isDraggingPan
      ? 'cursor-grabbing'
      : isPanning || (cursorMode === 'default' && !disableLeftMousePan)
      ? 'cursor-grab'
      : cursorMode === 'crosshair'
      ? 'cursor-crosshair'
      : cursorMode === 'none'
      ? 'cursor-none'
      : '';

    const handlePageLoadSuccess = useCallback((page: {
      getViewport: (options: { scale: number }) => { width: number; height: number };
    }) => {
      const baseVp = page.getViewport({ scale: 1 });
      const previousViewport = viewportRef.current;
      const isNewBasePage =
        !previousViewport ||
        previousViewport.baseWidth !== baseVp.width ||
        previousViewport.baseHeight !== baseVp.height;
      const nextFitScale = availableFitWidth / baseVp.width;

      if (isNewBasePage) {
        setBasePageSize({ width: baseVp.width, height: baseVp.height });
      }

      viewportRef.current = {
        baseWidth: baseVp.width,
        baseHeight: baseVp.height,
        fitScale: nextFitScale,
      };

      if (shouldAutoFitOnLoadRef.current) {
        const targetScale = getFitPageScale(baseVp.width, baseVp.height);
        const { scrollLeft, scrollTop } = getCenteredViewport(targetScale, {
          width: baseVp.width,
          height: baseVp.height,
        }, nextFitScale);
        pendingViewportRef.current = {
          scale: targetScale,
          scrollLeft,
          scrollTop,
        };
        shouldAutoFitOnLoadRef.current = false;
        setVisibleRasterLayer('primary');
        setStagingRasterLayer(null);
        const initialRasterScale = getRasterRenderScale(targetScale);
        setRasterLayerScales({ primary: initialRasterScale, secondary: initialRasterScale });
        setScale(targetScale);
      }

      setIsLoading(false);
      setRenderError(null);
    }, [availableFitWidth, getCenteredViewport, getFitPageScale, getRasterRenderScale]);

    const handleRenderError = useCallback((error: Error) => {
      console.error('[BlueprintViewer] Render error:', error);
      setRenderError('Failed to render PDF page.');
      setIsLoading(false);
    }, []);

    const handleStagedRenderSuccess = useCallback((layer: RasterLayerKey) => {
      if (stagingRasterLayer !== layer) return;
      const previousVisible = visibleRasterLayer;
      if (previousVisible !== layer) {
        setFadingRasterLayer(previousVisible);
        if (rasterFadeTimerRef.current) {
          window.clearTimeout(rasterFadeTimerRef.current);
        }
        rasterFadeTimerRef.current = window.setTimeout(() => {
          rasterFadeTimerRef.current = null;
          setFadingRasterLayer((current) => (current === previousVisible ? null : current));
        }, RASTER_FADE_DURATION_MS);
      }
      setVisibleRasterLayer(layer);
      setStagingRasterLayer(null);
    }, [stagingRasterLayer, visibleRasterLayer]);

    const handleDocumentError = useCallback((error: Error) => {
      console.error('[BlueprintViewer] Document error:', error);
      setRenderError('Failed to load PDF.');
      setIsLoading(false);
    }, []);

    return (
      <div className="relative h-full min-h-0 w-full bg-[rgba(15,16,17,0.03)]">
        {(isLoading || renderError) && (
          <div className="absolute inset-0 z-10">
            {isLoading ? (
              <BlueprintLoadingSkeleton />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[rgba(15,16,17,0.04)]">
                <span className="takeoff-mono text-xs text-[var(--takeoff-accent)]">{renderError}</span>
              </div>
            )}
          </div>
        )}

        <div
          ref={containerRef}
          className={`takeoff-hide-scrollbar relative h-full min-h-0 w-full overflow-auto ${cursorClass}`}
          style={{
            overscrollBehaviorX: 'none',
            overscrollBehaviorY: 'none',
            scrollbarGutter: 'stable both-edges',
          }}
        >
          <div
            className="relative"
            style={{
              width: workspaceWidth,
              height: workspaceHeight,
            }}
          >
            <div
              ref={canvasWrapperRef}
              className="absolute rounded-[8px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper-strong)] shadow-[0_18px_40px_rgba(15,16,17,0.12)]"
              style={{
                left: pageLeft,
                top: pageTop,
                width: pageWidth,
                minHeight: pageHeight || undefined,
              }}
            >
              <div
                className="absolute left-0 top-0 overflow-hidden rounded-[8px]"
                style={{ width: pageWidth, height: pageHeight || undefined }}
              >
                <Document file={pdfUrl} loading={null} error={null} onLoadError={handleDocumentError}>
                  {(visibleRasterLayer === 'primary' ||
                    stagingRasterLayer === 'primary' ||
                    fadingRasterLayer === 'primary') && (
                    <div
                      ref={primaryRasterLayerRef}
                      className="absolute left-0 top-0 overflow-hidden rounded-[8px] transition-opacity"
                      style={{
                        width: primaryRenderedWidth,
                        height: primaryRenderedHeight || undefined,
                        opacity: visibleRasterLayer === 'primary' ? 1 : 0,
                        transform: `scale(${primaryLiveZoomRatio})`,
                        transformOrigin: 'top left',
                        transitionDuration: `${RASTER_FADE_DURATION_MS}ms`,
                        pointerEvents: 'none',
                        willChange:
                          visibleRasterLayer === 'primary' && rasterScale === scale
                            ? 'auto'
                            : 'transform, opacity',
                      }}
                      aria-hidden={visibleRasterLayer !== 'primary'}
                    >
                      <Page
                        key={`${pdfUrl}:${pageNumber}:primary:${primaryRasterScale}`}
                        pageNumber={pageNumber}
                        width={primaryRenderedWidth}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        loading={null}
                        onLoadSuccess={handlePageLoadSuccess}
                        onRenderSuccess={() => handleStagedRenderSuccess('primary')}
                        onRenderError={handleRenderError}
                        className="overflow-hidden rounded-[8px]"
                      />
                    </div>
                  )}

                  {(visibleRasterLayer === 'secondary' ||
                    stagingRasterLayer === 'secondary' ||
                    fadingRasterLayer === 'secondary') && (
                    <div
                      ref={secondaryRasterLayerRef}
                      className="absolute left-0 top-0 overflow-hidden rounded-[8px] transition-opacity"
                      style={{
                        width: secondaryRenderedWidth,
                        height: secondaryRenderedHeight || undefined,
                        opacity: visibleRasterLayer === 'secondary' ? 1 : 0,
                        transform: `scale(${secondaryLiveZoomRatio})`,
                        transformOrigin: 'top left',
                        transitionDuration: `${RASTER_FADE_DURATION_MS}ms`,
                        pointerEvents: 'none',
                        willChange:
                          visibleRasterLayer === 'secondary' && rasterScale === scale
                            ? 'auto'
                            : 'transform, opacity',
                      }}
                      aria-hidden={visibleRasterLayer !== 'secondary'}
                    >
                      <Page
                        key={`${pdfUrl}:${pageNumber}:secondary:${secondaryRasterScale}`}
                        pageNumber={pageNumber}
                        width={secondaryRenderedWidth}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        loading={null}
                        onLoadSuccess={handlePageLoadSuccess}
                        onRenderSuccess={() => handleStagedRenderSuccess('secondary')}
                        onRenderError={handleRenderError}
                        className="overflow-hidden rounded-[8px]"
                      />
                    </div>
                  )}
                </Document>
              </div>

              {pageWidth > 0 && pageHeight > 0 && children && (
                <div
                  className={`absolute top-0 left-0 ${isPanning ? 'pointer-events-none' : ''}`}
                  style={{
                    width: pageWidth,
                    height: pageHeight || undefined,
                    willChange: 'auto',
                  }}
                >
                  {children({ width: pageWidth, height: pageHeight })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-black/8 bg-[rgba(255,255,255,0.78)] px-1.5 py-0.5 text-[var(--takeoff-ink)] shadow-[0_10px_20px_rgba(15,16,17,0.08)] backdrop-blur-md">
            <button
              onClick={zoomOut}
              className="flex h-6 w-6 items-center justify-center rounded-full text-base font-medium text-[var(--takeoff-text-subtle)] transition-colors hover:bg-black/[0.04] hover:text-[var(--takeoff-ink)]"
            >
              −
            </button>
            <span className="takeoff-mono w-10 select-none text-center text-[11px] text-[var(--takeoff-text-muted)]">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="flex h-6 w-6 items-center justify-center rounded-full text-base font-medium text-[var(--takeoff-text-subtle)] transition-colors hover:bg-black/[0.04] hover:text-[var(--takeoff-ink)]"
            >
              +
            </button>
            <div className="mx-1 h-3.5 w-px bg-black/8" />
            <button
              onClick={fitToView}
              className="takeoff-mono flex h-6 items-center justify-center rounded-full px-2 text-[11px] text-[var(--takeoff-text-subtle)] transition-colors hover:bg-black/[0.04] hover:text-[var(--takeoff-ink)]"
            >
              Fit
            </button>
          </div>
        </div>

      </div>
    );
  }
);
