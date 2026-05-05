'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pdfjs } from 'react-pdf';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import {
  openingAreaSf,
  type DoorDesignationNormalized,
  type DoorDimensionFormat,
  type Opening,
  type OpeningType,
  type PdfPoint,
  type Trace,
} from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type DoorToolMode = 'idle' | 'capture' | 'place';

interface DoorPreset {
  type: Exclude<OpeningType, 'window'>;
  widthFt: number;
  heightFt: number;
  label: string;
  sourceText?: string | null;
  designationRaw?: string | null;
  designationNormalized?: DoorDesignationNormalized | null;
  dimensionFormat?: DoorDimensionFormat | null;
}

interface CaptureResult {
  sourceText: string;
  detectedWidthFt: number | null;
  detectedHeightFt: number | null;
  detectedOpeningType: Exclude<OpeningType, 'window'>;
  designationRaw: string | null;
  designationNormalized: DoorDesignationNormalized;
  dimensionFormat: DoorDimensionFormat;
  confidence: number;
  confirmed: boolean;
  disposition: 'confirmed' | 'width_only' | 'ambiguous' | 'invalid_target';
  detectionMethod: 'vision' | 'none';
  markerPoint?: PdfPoint | null;
}

interface PlacementResult {
  traceId: string;
  segmentIndex: number;
  openingArea: number;
  openingCount: number;
}

interface DoorToolOverlayProps {
  viewerRef: React.RefObject<BlueprintViewerHandle | null>;
  pageWidth: number;
  pageHeight: number;
  pdfUrl: string;
  mode: DoorToolMode;
  preset: DoorPreset | null;
  traceIdFilter?: string | null;
  onCaptureComplete: (result: CaptureResult) => void;
  onPlacement: (result: PlacementResult) => void;
  scanMarkers?: Array<{
    id: string;
    pageIndex: number;
    wallRunId?: string | null;
    point: PdfPoint;
  }>;
}

interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfViewportLike {
  width: number;
  height: number;
}

interface PdfPageLike {
  getViewport: (options: { scale: number }) => PdfViewportLike;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
    transform?: number[];
  }) => { promise: Promise<void> };
}

interface PdfDocumentLike {
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
}

const pdfDocumentCache = new Map<string, Promise<PdfDocumentLike>>();
const DOOR_CAPTURE_CONFIDENCE_THRESHOLD = 0.82;

type CaptureFeedbackPhase =
  | 'draft'
  | 'analyzing'
  | 'confirmed'
  | 'needs_review'
  | 'invalid_target';

interface CaptureFeedback {
  rect: PdfRect;
  phase: CaptureFeedbackPhase;
}

function normalizeRect(a: PdfPoint, b: PdfPoint): PdfRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function cropCanvasVertical(
  sourceCanvas: HTMLCanvasElement,
  topRatio: number,
  bottomRatio: number,
): HTMLCanvasElement {
  const safeTop = Math.max(0, Math.min(0.98, topRatio));
  const safeBottom = Math.max(safeTop + 0.01, Math.min(1, bottomRatio));
  const y = Math.floor(sourceCanvas.height * safeTop);
  const height = Math.max(1, Math.ceil(sourceCanvas.height * (safeBottom - safeTop)));
  const target = createCanvas(sourceCanvas.width, height);
  const ctx = target.getContext('2d');

  if (!ctx) {
    throw new Error('Could not create cropped door vision canvas context');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(sourceCanvas, 0, y, sourceCanvas.width, height, 0, 0, sourceCanvas.width, height);
  return target;
}

function canvasToJpegBase64(canvas: HTMLCanvasElement, quality: number = 0.92) {
  return canvas.toDataURL('image/jpeg', quality).replace(/^data:image\/jpeg;base64,/, '');
}

async function getCachedPdfDocument(pdfUrl: string) {
  const existing = pdfDocumentCache.get(pdfUrl);
  if (existing) {
    return existing;
  }

  const next = pdfjs.getDocument(pdfUrl).promise as unknown as Promise<PdfDocumentLike>;
  pdfDocumentCache.set(pdfUrl, next);
  return next;
}

async function renderPdfRegionToCanvas(
  pdfUrl: string,
  pageNumber: number,
  rect: PdfRect,
): Promise<HTMLCanvasElement> {
  const pdf = await getCachedPdfDocument(pdfUrl);
  const page = await pdf.getPage(pageNumber);
  const renderScale = Math.min(4.5, Math.max(2.5, 1500 / Math.max(rect.width, rect.height, 1)));
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = createCanvas(rect.width * renderScale, rect.height * renderScale);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not create door vision canvas context');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -rect.x * renderScale, -rect.y * renderScale],
  }).promise;

  return canvas;
}

async function captureDoorWithVision(
  pdfUrl: string,
  pageNumber: number,
  rect: PdfRect,
): Promise<CaptureResult> {
  const fullCanvas = await renderPdfRegionToCanvas(pdfUrl, pageNumber, rect);
  const topCanvas = cropCanvasVertical(fullCanvas, 0, 0.62);

  const response = await fetch('/api/takeoff/detect-door-dimensions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images: [canvasToJpegBase64(fullCanvas), canvasToJpegBase64(topCanvas)],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision door capture failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as {
    raw_text?: unknown;
    width_ft?: unknown;
    height_ft?: unknown;
    opening_type?: unknown;
    designation_raw?: unknown;
    designation_normalized?: unknown;
    dimension_format?: unknown;
    confidence?: unknown;
    disposition?: unknown;
  };

  const widthFt =
    typeof result.width_ft === 'number' && Number.isFinite(result.width_ft)
      ? result.width_ft
      : null;
  const heightFt =
    typeof result.height_ft === 'number' && Number.isFinite(result.height_ft)
      ? result.height_ft
      : null;
  const sourceText = typeof result.raw_text === 'string' ? result.raw_text.trim() : '';
  const detectedOpeningType =
    result.opening_type === 'door' ||
    result.opening_type === 'french_door' ||
    result.opening_type === 'garage_door' ||
    result.opening_type === 'sliding_door' ||
    result.opening_type === 'door_opening'
      ? result.opening_type
      : 'door';
  const designationRaw =
    typeof result.designation_raw === 'string' && result.designation_raw.trim()
      ? result.designation_raw.trim()
      : null;
  const designationNormalized =
    result.designation_normalized === 'entry' ||
    result.designation_normalized === 'swing' ||
    result.designation_normalized === 'french' ||
    result.designation_normalized === 'pair_double' ||
    result.designation_normalized === 'sliding' ||
    result.designation_normalized === 'multi_slide' ||
    result.designation_normalized === 'garage_overhead' ||
    result.designation_normalized === 'rollup' ||
    result.designation_normalized === 'barn' ||
    result.designation_normalized === 'pocket' ||
    result.designation_normalized === 'bifold' ||
    result.designation_normalized === 'cased_opening' ||
    result.designation_normalized === 'service_man_door'
      ? result.designation_normalized
      : 'unknown';
  const dimensionFormat =
    result.dimension_format === 'compact_code' ||
    result.dimension_format === 'leaf_pair_compact' ||
    result.dimension_format === 'slash_pair' ||
    result.dimension_format === 'feet_inches_pair' ||
    result.dimension_format === 'dash_pair' ||
    result.dimension_format === 'feet_only_pair' ||
    result.dimension_format === 'width_only_compact' ||
    result.dimension_format === 'width_only_slash' ||
    result.dimension_format === 'width_only_feet_inches' ||
    result.dimension_format === 'width_only_dash' ||
    result.dimension_format === 'width_only_feet_only'
      ? result.dimension_format
      : 'unknown';
  const confidence =
    typeof result.confidence === 'number' && Number.isFinite(result.confidence)
      ? Math.max(0, Math.min(1, result.confidence))
      : 0;
  const disposition =
    result.disposition === 'confirmed' ||
    result.disposition === 'width_only' ||
    result.disposition === 'ambiguous' ||
    result.disposition === 'invalid_target'
      ? result.disposition
      : 'ambiguous';
  const confirmed =
    widthFt !== null &&
    heightFt !== null &&
    (disposition === 'width_only' || confidence >= DOOR_CAPTURE_CONFIDENCE_THRESHOLD);

  return {
    sourceText,
    detectedWidthFt: widthFt,
    detectedHeightFt: heightFt,
    detectedOpeningType,
    designationRaw,
    designationNormalized,
    dimensionFormat,
    confidence,
    confirmed,
    disposition,
    detectionMethod: widthFt || heightFt || sourceText ? 'vision' : 'none',
  };
}

function buildLinearSegments(trace: Trace) {
  if (trace.type !== 'linear' || trace.points.length < 2) {
    return [];
  }

  const segments = [];
  const segmentCount = trace.isClosed ? trace.points.length : trace.points.length - 1;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const start = trace.points[segmentIndex];
    const end =
      trace.isClosed && segmentIndex === trace.points.length - 1
        ? trace.points[0]
        : trace.points[segmentIndex + 1];

    if (!end) continue;

    segments.push({ traceId: trace.id, segmentIndex, start, end });
  }

  return segments;
}

export function DoorToolOverlay({
  viewerRef,
  pageWidth,
  pageHeight,
  pdfUrl,
  mode,
  preset,
  traceIdFilter = null,
  onCaptureComplete,
  onPlacement,
  scanMarkers = [],
}: DoorToolOverlayProps) {
  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const selectedSegmentIndex = useTakeoffStore((state) => state.selectedSegmentIndex);
  const getVisibleTracesForPage = useTakeoffStore((state) => state.getVisibleTracesForPage);
  const selectSegment = useTakeoffStore((state) => state.selectSegment);
  const setSegmentOpenings = useTakeoffStore((state) => state.setSegmentOpenings);

  const overlayRef = useRef<HTMLDivElement>(null);
  const captureStartRef = useRef<PdfPoint | null>(null);
  const completeTimerRef = useRef<number | null>(null);
  const [captureFeedback, setCaptureFeedback] = useState<CaptureFeedback | null>(null);
  const [isDraggingCapture, setIsDraggingCapture] = useState(false);

  const traces = useMemo(() => {
    if (mode !== 'place' || !session) {
      return [];
    }

    return getVisibleTracesForPage(activePageIndex).filter(
      (trace) => trace.type === 'linear' && (!traceIdFilter || trace.id === traceIdFilter),
    );
  }, [activePageIndex, getVisibleTracesForPage, mode, session, traceIdFilter]);
  const selectedKey =
    selectedTraceId !== null && selectedSegmentIndex !== null
      ? `${selectedTraceId}:${selectedSegmentIndex}`
      : null;

  useEffect(() => {
    if (mode === 'capture') return;
    if (completeTimerRef.current) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
    captureStartRef.current = null;
    setCaptureFeedback(null);
    setIsDraggingCapture(false);
  }, [mode]);

  useEffect(() => {
    return () => {
      if (completeTimerRef.current) {
        window.clearTimeout(completeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (mode !== 'capture') return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      const viewer = viewerRef.current;
      const start = captureStartRef.current;
      if (!viewer || !start) return;

      const nextPoint = viewer.cssToPageCoords(event.clientX, event.clientY);
      if (!nextPoint) return;
      setCaptureFeedback({ rect: normalizeRect(start, nextPoint), phase: 'draft' });
    };

    const handleWindowMouseUp = async (event: MouseEvent) => {
      const viewer = viewerRef.current;
      const start = captureStartRef.current;
      if (!viewer || !start) return;

      const end = viewer.cssToPageCoords(event.clientX, event.clientY);
      captureStartRef.current = null;
      setIsDraggingCapture(false);

      if (!end) {
        setCaptureFeedback(null);
        return;
      }

      const nextRect = normalizeRect(start, end);
      setCaptureFeedback({ rect: nextRect, phase: 'analyzing' });

      if (nextRect.width < 4 || nextRect.height < 4) {
        setCaptureFeedback(null);
        return;
      }

      try {
        const result = await captureDoorWithVision(pdfUrl, activePageIndex + 1, nextRect);
        const markerPoint = {
          x: nextRect.x + nextRect.width / 2,
          y: nextRect.y + nextRect.height / 2,
        };
        if (result.confirmed) {
          setCaptureFeedback({ rect: nextRect, phase: 'confirmed' });
          completeTimerRef.current = window.setTimeout(() => {
            completeTimerRef.current = null;
            setCaptureFeedback(null);
            onCaptureComplete({
              ...result,
              markerPoint,
            });
          }, 620);
          return;
        }

        setCaptureFeedback({
          rect: nextRect,
          phase: result.disposition === 'invalid_target' ? 'invalid_target' : 'needs_review',
        });
        onCaptureComplete({
          ...result,
          markerPoint,
        });
      } catch (error) {
        console.error('[DoorToolOverlay] Failed to capture door dimensions with vision:', error);
        setCaptureFeedback({ rect: nextRect, phase: 'needs_review' });
        onCaptureComplete({
          sourceText: '',
          detectedWidthFt: null,
          detectedHeightFt: null,
          detectedOpeningType: 'door',
          designationRaw: null,
          designationNormalized: 'unknown',
          dimensionFormat: 'unknown',
          confidence: 0,
          confirmed: false,
          disposition: 'ambiguous',
          detectionMethod: 'none',
          markerPoint: {
            x: nextRect.x + nextRect.width / 2,
            y: nextRect.y + nextRect.height / 2,
          },
        });
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [activePageIndex, mode, onCaptureComplete, pdfUrl, viewerRef]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (mode !== 'capture' || viewerRef.current?.isPanning()) return;
      if (captureFeedback?.phase === 'analyzing' || captureFeedback?.phase === 'confirmed') return;

      const viewer = viewerRef.current;
      if (!viewer) return;

      const start = viewer.cssToPageCoords(event.clientX, event.clientY);
      if (!start) return;

      event.preventDefault();
      event.stopPropagation();
      captureStartRef.current = start;
      setCaptureFeedback({
        rect: { x: start.x, y: start.y, width: 0, height: 0 },
        phase: 'draft',
      });
      setIsDraggingCapture(true);
    },
    [captureFeedback?.phase, mode, viewerRef],
  );

  const handleSegmentPlacement = useCallback(
    (traceId: string, segmentIndex: number) => {
      if (!preset || !session) return;

      const classification = session.classifications.find(
        (item) => item.traceId === traceId && item.segmentIndex === segmentIndex,
      );
      if (!classification) return;

      const openings = classification.openings ?? [];
      const existingMatch = openings.find(
        (opening) =>
          opening.type === preset.type &&
          Math.abs(opening.width_ft - preset.widthFt) < 0.01 &&
          Math.abs(opening.height_ft - preset.heightFt) < 0.01 &&
          (opening.label ?? '') === preset.label,
      );

      const nextOpenings = existingMatch
        ? openings.map((opening) =>
            opening.id === existingMatch.id
              ? { ...opening, quantity: opening.quantity + 1 }
              : opening,
          )
        : [
            ...openings,
            {
              id: crypto.randomUUID(),
              type: preset.type,
              width_ft: preset.widthFt,
              height_ft: preset.heightFt,
              quantity: 1,
              label: preset.label,
            } satisfies Opening,
          ];

      setSegmentOpenings(traceId, segmentIndex, nextOpenings);
      selectSegment(traceId, segmentIndex);

      const totalOpeningArea = nextOpenings.reduce((sum, opening) => sum + openingAreaSf(opening), 0);
      onPlacement({
        traceId,
        segmentIndex,
        openingArea: totalOpeningArea,
        openingCount: nextOpenings.reduce((sum, opening) => sum + opening.quantity, 0),
      });
    },
    [onPlacement, preset, selectSegment, session, setSegmentOpenings],
  );

  const toCss = useCallback(
    (point: PdfPoint) => viewerRef.current?.pageCoordsToCss(point.x, point.y) ?? { x: 0, y: 0 },
    [viewerRef],
  );

  const isActive = mode === 'capture' || mode === 'place';
  const captureRect = captureFeedback?.rect ?? null;
  const visibleScanMarkers = scanMarkers.filter(
    (marker) =>
      marker.pageIndex === activePageIndex &&
      (!traceIdFilter || marker.wallRunId === traceIdFilter),
  );

  if (!isActive && !captureRect && visibleScanMarkers.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ width: pageWidth, height: pageHeight, pointerEvents: isActive ? 'auto' : 'none' }}
      onMouseDown={handleMouseDown}
    >
      <svg
        className="absolute inset-0"
        width={pageWidth}
        height={pageHeight}
        style={{ pointerEvents: isActive ? 'auto' : 'none' }}
      >
        {mode === 'place' && preset && traces.flatMap((trace) =>
          buildLinearSegments(trace).map((segment) => {
            const start = toCss(segment.start);
            const end = toCss(segment.end);
            const key = `${segment.traceId}:${segment.segmentIndex}`;
            const isSelected = selectedKey === key;

            return (
              <g key={key}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={isSelected ? 'rgba(5,150,105,0.9)' : 'rgba(5,150,105,0.34)'}
                  strokeWidth={isSelected ? 4 : 2.5}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'none' }}
                />
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ cursor: 'copy', pointerEvents: 'stroke' }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleSegmentPlacement(segment.traceId, segment.segmentIndex);
                  }}
                />
              </g>
            );
          }),
        )}

        {visibleScanMarkers.map((marker) => {
          const markerCss = toCss(marker.point);

          return (
            <g key={marker.id} style={{ pointerEvents: 'none' }}>
              <circle
                cx={markerCss.x}
                cy={markerCss.y}
                r={14}
                fill="rgba(22,163,74,0.18)"
                stroke="rgba(22,163,74,0.92)"
                strokeWidth={2}
                style={{ filter: 'drop-shadow(0 0 10px rgba(22,163,74,0.28))' }}
              />
              <path
                d={`M ${markerCss.x - 5} ${markerCss.y} L ${markerCss.x - 1} ${markerCss.y + 4} L ${markerCss.x + 6} ${markerCss.y - 4}`}
                fill="none"
                stroke="rgba(22,163,74,0.98)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {captureRect && (() => {
          const topLeft = toCss({ x: captureRect.x, y: captureRect.y });
          const bottomRight = toCss({
            x: captureRect.x + captureRect.width,
            y: captureRect.y + captureRect.height,
          });
          const left = Math.min(topLeft.x, bottomRight.x);
          const top = Math.min(topLeft.y, bottomRight.y);
          const width = Math.abs(bottomRight.x - topLeft.x);
          const height = Math.abs(bottomRight.y - topLeft.y);
          const centerX = left + width / 2;
          const centerY = top + height / 2;
          const badgeRadius = Math.max(16, Math.min(22, Math.min(width, height) * 0.18));
          const badgeLeft = centerX - badgeRadius;
          const badgeTop = centerY - badgeRadius;
          const needsReview = captureFeedback?.phase === 'needs_review';
          const invalidTarget = captureFeedback?.phase === 'invalid_target';
          const analyzing = captureFeedback?.phase === 'analyzing';
          const confirmed = captureFeedback?.phase === 'confirmed';
          const strokeColor = invalidTarget
            ? 'rgba(185,28,28,0.92)'
            : needsReview
              ? 'rgba(180,83,9,0.92)'
              : 'rgba(5,150,105,0.95)';
          const fillColor = invalidTarget
            ? 'rgba(239,68,68,0.12)'
            : needsReview
              ? 'rgba(245,158,11,0.14)'
              : 'rgba(16,185,129,0.12)';
          const labelBg = invalidTarget
            ? 'rgba(254,242,242,0.97)'
            : needsReview
              ? 'rgba(255,251,235,0.96)'
              : 'rgba(236,253,245,0.96)';
          const labelStroke = invalidTarget
            ? 'rgba(220,38,38,0.24)'
            : needsReview
              ? 'rgba(217,119,6,0.28)'
              : 'rgba(5,150,105,0.22)';
          const labelText = invalidTarget
            ? '#b91c1c'
            : needsReview
              ? '#b45309'
              : '#047857';
          const scanFrameColor = 'rgba(16,185,129,0.52)';
          const scanEdgeColor = 'rgba(209,250,229,0.72)';
          const scanSweepFill = 'rgba(255,255,255,0.9)';
          const scanSweepStroke = 'rgba(16,185,129,0.96)';
          const scanGlowFilter = 'drop-shadow(0 0 16px rgba(16,185,129,0.42))';

          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={left}
                y={top}
                width={width}
                height={height}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={confirmed ? 2.6 : 2.2}
                strokeDasharray={needsReview || invalidTarget ? '10 5' : '8 4'}
                rx={8}
                style={{
                  filter: analyzing
                    ? 'drop-shadow(0 0 18px rgba(5,150,105,0.26))'
                    : invalidTarget
                      ? 'drop-shadow(0 0 12px rgba(220,38,38,0.18))'
                      : needsReview
                        ? 'drop-shadow(0 0 12px rgba(245,158,11,0.2))'
                        : undefined,
                }}
              >
                {analyzing && (
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;-24"
                    dur="0.7s"
                    repeatCount="indefinite"
                  />
                )}
              </rect>
              {analyzing && (
                <>
                  <rect
                    x={left - 3}
                    y={top - 3}
                    width={width + 6}
                    height={height + 6}
                    rx={11}
                    fill="none"
                    stroke={scanFrameColor}
                    strokeWidth={4}
                    style={{ filter: scanGlowFilter }}
                  >
                    <animate attributeName="opacity" values="0.2;0.85;0.2" dur="1.05s" repeatCount="indefinite" />
                    <animate attributeName="stroke-width" values="3.5;6;3.5" dur="1.05s" repeatCount="indefinite" />
                  </rect>
                  <rect
                    x={left + 8}
                    y={top + 10}
                    width={Math.max(0, width - 16)}
                    height={12}
                    rx={6}
                    fill={scanSweepFill}
                    stroke={scanSweepStroke}
                    strokeWidth={1.2}
                    style={{ filter: 'drop-shadow(0 0 18px rgba(167,243,208,0.9))' }}
                  >
                    <animate attributeName="y" values={`${top + 10};${top + Math.max(10, height - 18)};${top + 10}`} dur="1.35s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0;1;0" dur="1.35s" repeatCount="indefinite" />
                  </rect>
                  <rect
                    x={left + 14}
                    y={top + 6}
                    width={Math.max(0, width - 28)}
                    height={Math.max(0, height - 12)}
                    rx={7}
                    fill="none"
                    stroke={scanEdgeColor}
                    strokeWidth={1.6}
                    strokeDasharray="14 10"
                  >
                    <animate attributeName="stroke-dashoffset" values="0;48" dur="1.4s" repeatCount="indefinite" />
                  </rect>
                </>
              )}
              {(isDraggingCapture || analyzing || needsReview || invalidTarget) && (
                <g>
                  <rect
                    x={centerX - 112}
                    y={top - 30}
                    width={224}
                    height={22}
                    rx={11}
                    fill={labelBg}
                    stroke={labelStroke}
                  />
                  <text
                    x={centerX}
                    y={top - 15}
                    textAnchor="middle"
                    fill={labelText}
                    fontSize={11}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                    className="select-none"
                  >
                    {invalidTarget
                      ? 'Not a door size note'
                      : needsReview
                        ? 'Type door size manually'
                        : analyzing
                          ? 'Vision is reading this door'
                          : 'Capture door size'}
                  </text>
                </g>
              )}
              {confirmed && (
                <>
                  <rect x={left} y={top} width={width} height={height} fill={fillColor} stroke={strokeColor} strokeWidth={2.4} rx={8}>
                    <animate attributeName="x" from={String(left)} to={String(badgeLeft)} dur="0.34s" fill="freeze" />
                    <animate attributeName="y" from={String(top)} to={String(badgeTop)} dur="0.34s" fill="freeze" />
                    <animate attributeName="width" from={String(width)} to={String(badgeRadius * 2)} dur="0.34s" fill="freeze" />
                    <animate attributeName="height" from={String(height)} to={String(badgeRadius * 2)} dur="0.34s" fill="freeze" />
                    <animate attributeName="opacity" from="0.95" to="0" dur="0.34s" fill="freeze" />
                  </rect>
                  <circle cx={centerX} cy={centerY} r={badgeRadius * 0.9} fill="none" stroke="rgba(16,185,129,0.5)" strokeWidth={3} opacity={0}>
                    <animate attributeName="opacity" values="0;0.95;0" dur="0.55s" fill="freeze" />
                    <animate attributeName="r" values={`${badgeRadius * 0.85};${badgeRadius * 1.7};${badgeRadius * 2.1}`} dur="0.55s" fill="freeze" />
                    <animate attributeName="stroke-width" values="3.4;1.8;0.8" dur="0.55s" fill="freeze" />
                  </circle>
                  <circle cx={centerX} cy={centerY} r={badgeRadius} fill="rgba(16,185,129,0.96)" stroke="rgba(255,255,255,0.92)" strokeWidth={2.4}>
                    <animate attributeName="r" values={`6;${badgeRadius * 1.18};${badgeRadius}`} dur="0.34s" fill="freeze" />
                    <animate attributeName="opacity" from="0" to="1" dur="0.18s" fill="freeze" />
                  </circle>
                  <path
                    d={`M ${centerX - badgeRadius * 0.42} ${centerY + badgeRadius * 0.02} L ${centerX - badgeRadius * 0.1} ${centerY + badgeRadius * 0.34} L ${centerX + badgeRadius * 0.48} ${centerY - badgeRadius * 0.28}`}
                    fill="none"
                    stroke="white"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="32"
                    strokeDashoffset="32"
                  >
                    <animate attributeName="stroke-dashoffset" from="32" to="0" dur="0.22s" begin="0.12s" fill="freeze" />
                    <animate attributeName="opacity" from="0" to="1" dur="0.18s" begin="0.08s" fill="freeze" />
                  </path>
                </>
              )}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
