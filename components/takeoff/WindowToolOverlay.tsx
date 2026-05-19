'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pdfjs } from 'react-pdf';
import { getReactPdfWorkerSrc } from '@/lib/pdf/pdfjs-worker';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import { openingAreaSf, type Opening, type PdfPoint, type Trace } from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = getReactPdfWorkerSrc();

type WindowToolMode = 'idle' | 'capture' | 'place';

interface WindowPreset {
  widthFt: number;
  heightFt: number;
  label: string;
  sourceText?: string | null;
}

interface CaptureResult {
  sourceText: string;
  detectedWidthFt: number | null;
  detectedHeightFt: number | null;
  confidence: number;
  confirmed: boolean;
  disposition: 'confirmed' | 'ambiguous' | 'invalid_target';
  detectionMethod: 'vision' | 'none';
  markerPoint?: PdfPoint | null;
}

interface PlacementResult {
  traceId: string;
  segmentIndex: number;
  openingArea: number;
  openingCount: number;
}

interface WindowToolOverlayProps {
  viewerRef: React.RefObject<BlueprintViewerHandle | null>;
  pageWidth: number;
  pageHeight: number;
  pdfUrl: string;
  mode: WindowToolMode;
  preset: WindowPreset | null;
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
const WINDOW_CAPTURE_CONFIDENCE_THRESHOLD = 0.82;

type CaptureFeedbackPhase =
  | 'draft'
  | 'analyzing'
  | 'confirmed'
  | 'needs_review'
  | 'invalid_target';

interface CaptureFeedback {
  id: string;
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
    throw new Error('Could not create cropped vision canvas context');
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
    throw new Error('Could not create vision canvas context');
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

async function captureWindowWithVision(
  pdfUrl: string,
  pageNumber: number,
  rect: PdfRect,
): Promise<CaptureResult> {
  const fullCanvas = await renderPdfRegionToCanvas(pdfUrl, pageNumber, rect);
  const topCanvas = cropCanvasVertical(fullCanvas, 0, 0.58);

  const response = await fetch('/api/takeoff/detect-window-dimensions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      images: [
        canvasToJpegBase64(fullCanvas),
        canvasToJpegBase64(topCanvas),
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision window capture failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as {
    raw_text?: unknown;
    width_ft?: unknown;
    height_ft?: unknown;
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
  const confidence =
    typeof result.confidence === 'number' && Number.isFinite(result.confidence)
      ? Math.max(0, Math.min(1, result.confidence))
      : 0;
  const confirmed = widthFt !== null &&
    heightFt !== null &&
    confidence >= WINDOW_CAPTURE_CONFIDENCE_THRESHOLD;
  const disposition =
    result.disposition === 'confirmed' ||
    result.disposition === 'ambiguous' ||
    result.disposition === 'invalid_target'
      ? result.disposition
      : confirmed
        ? 'confirmed'
        : 'ambiguous';

  return {
    sourceText,
    detectedWidthFt: widthFt,
    detectedHeightFt: heightFt,
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

    segments.push({
      traceId: trace.id,
      segmentIndex,
      start,
      end,
    });
  }

  return segments;
}

export function WindowToolOverlay({
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
}: WindowToolOverlayProps) {
  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const selectedSegmentIndex = useTakeoffStore((state) => state.selectedSegmentIndex);
  const getVisibleTracesForPage = useTakeoffStore((state) => state.getVisibleTracesForPage);
  const selectSegment = useTakeoffStore((state) => state.selectSegment);
  const setSegmentOpenings = useTakeoffStore((state) => state.setSegmentOpenings);

  const overlayRef = useRef<HTMLDivElement>(null);
  const captureStartRef = useRef<PdfPoint | null>(null);
  const captureGenerationRef = useRef(0);
  const completeTimerIdsRef = useRef<Set<number>>(new Set());
  const [draftCaptureRect, setDraftCaptureRect] = useState<PdfRect | null>(null);
  const [captureFeedbacks, setCaptureFeedbacks] = useState<CaptureFeedback[]>([]);
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

    captureGenerationRef.current += 1;
    for (const timerId of completeTimerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    completeTimerIdsRef.current.clear();
    captureStartRef.current = null;
    setDraftCaptureRect(null);
    setCaptureFeedbacks([]);
    setIsDraggingCapture(false);
  }, [mode]);

  useEffect(() => {
    const timerIds = completeTimerIdsRef.current;
    return () => {
      captureGenerationRef.current += 1;
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
      timerIds.clear();
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
      setDraftCaptureRect(normalizeRect(start, nextPoint));
    };

    const handleWindowMouseUp = async (event: MouseEvent) => {
      const viewer = viewerRef.current;
      const start = captureStartRef.current;
      if (!viewer || !start) return;

      const end = viewer.cssToPageCoords(event.clientX, event.clientY);
      captureStartRef.current = null;
      setIsDraggingCapture(false);

      if (!end) {
        setDraftCaptureRect(null);
        return;
      }

      const nextRect = normalizeRect(start, end);
      const captureId = crypto.randomUUID();
      const captureGeneration = captureGenerationRef.current;
      setDraftCaptureRect(null);

      if (nextRect.width < 4 || nextRect.height < 4) {
        return;
      }

      setCaptureFeedbacks((current) => [
        ...current,
        {
          id: captureId,
          rect: nextRect,
          phase: 'analyzing',
        },
      ]);

      try {
        const result = await captureWindowWithVision(pdfUrl, activePageIndex + 1, nextRect);
        if (captureGenerationRef.current !== captureGeneration) {
          return;
        }

        if (result.confirmed) {
          const markerPoint = {
            x: nextRect.x + nextRect.width / 2,
            y: nextRect.y + nextRect.height / 2,
          };

          setCaptureFeedbacks((current) =>
            current.map((feedback) =>
              feedback.id === captureId ? { ...feedback, phase: 'confirmed' } : feedback,
            ),
          );
          const timerId = window.setTimeout(() => {
            completeTimerIdsRef.current.delete(timerId);
            if (captureGenerationRef.current !== captureGeneration) {
              return;
            }
            setCaptureFeedbacks((current) =>
              current.filter((feedback) => feedback.id !== captureId),
            );
            onCaptureComplete({
              ...result,
              markerPoint,
            });
          }, 620);
          completeTimerIdsRef.current.add(timerId);
          return;
        }

        setCaptureFeedbacks((current) =>
          current.map((feedback) =>
            feedback.id === captureId
              ? {
                  ...feedback,
                  phase:
                    result.disposition === 'invalid_target' ? 'invalid_target' : 'needs_review',
                }
              : feedback,
          ),
        );
        onCaptureComplete({
          ...result,
          markerPoint: {
            x: nextRect.x + nextRect.width / 2,
            y: nextRect.y + nextRect.height / 2,
          },
        });
      } catch (error) {
        if (captureGenerationRef.current !== captureGeneration) {
          return;
        }
        console.error('[WindowToolOverlay] Failed to capture window dimensions with vision:', error);
        setCaptureFeedbacks((current) =>
          current.map((feedback) =>
            feedback.id === captureId ? { ...feedback, phase: 'needs_review' } : feedback,
          ),
        );
        onCaptureComplete({
          sourceText: '',
          detectedWidthFt: null,
          detectedHeightFt: null,
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

      const viewer = viewerRef.current;
      if (!viewer) return;

      const start = viewer.cssToPageCoords(event.clientX, event.clientY);
      if (!start) return;

      event.preventDefault();
      event.stopPropagation();
      captureStartRef.current = start;
      setDraftCaptureRect({ x: start.x, y: start.y, width: 0, height: 0 });
      setIsDraggingCapture(true);
    },
    [mode, viewerRef],
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
          opening.type === 'window' &&
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
              type: 'window',
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
  const visibleScanMarkers = scanMarkers.filter(
    (marker) =>
      marker.pageIndex === activePageIndex &&
      (!traceIdFilter || marker.wallRunId === traceIdFilter),
  );
  const visibleCaptureFeedbacks = useMemo(() => {
    if (!draftCaptureRect) {
      return captureFeedbacks;
    }

    return [
      {
        id: 'draft',
        rect: draftCaptureRect,
        phase: 'draft' as const,
      },
      ...captureFeedbacks,
    ];
  }, [captureFeedbacks, draftCaptureRect]);

  if (!isActive && visibleCaptureFeedbacks.length === 0 && visibleScanMarkers.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{
        width: pageWidth,
        height: pageHeight,
        pointerEvents: isActive ? 'auto' : 'none',
      }}
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
                  stroke={isSelected ? 'rgba(217,119,6,0.9)' : 'rgba(217,119,6,0.34)'}
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

        {visibleCaptureFeedbacks.map((captureFeedback) => {
          const captureRect = captureFeedback.rect;
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
              : 'rgba(37,99,235,0.95)';
          const fillColor = invalidTarget
            ? 'rgba(239,68,68,0.12)'
            : needsReview
              ? 'rgba(245,158,11,0.14)'
              : 'rgba(37,99,235,0.12)';
          const labelBg = invalidTarget
            ? 'rgba(254,242,242,0.97)'
            : needsReview
              ? 'rgba(255,251,235,0.96)'
              : 'rgba(239,246,255,0.96)';
          const labelStroke = invalidTarget
            ? 'rgba(220,38,38,0.24)'
            : needsReview
              ? 'rgba(217,119,6,0.28)'
              : 'rgba(37,99,235,0.22)';
          const labelText = invalidTarget
            ? '#b91c1c'
            : needsReview
              ? '#b45309'
              : '#1d4ed8';
          const scanFrameColor = 'rgba(34,211,238,0.52)';
          const scanEdgeColor = 'rgba(207,250,254,0.72)';
          const scanSweepFill = 'rgba(255,255,255,0.88)';
          const scanSweepStroke = 'rgba(56,189,248,0.96)';
          const scanGlowFilter = 'drop-shadow(0 0 16px rgba(34,211,238,0.42))';

          return (
            <g key={captureFeedback.id} style={{ pointerEvents: 'none' }}>
              <rect
                x={left}
                y={top}
                width={width}
                height={height}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={confirmed ? 2.6 : 2.2}
                strokeDasharray={needsReview ? '10 5' : '8 4'}
                rx={8}
                style={{
                  filter: analyzing
                    ? 'drop-shadow(0 0 18px rgba(37,99,235,0.26))'
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
                    <animate
                      attributeName="opacity"
                      values="0.2;0.85;0.2"
                      dur="1.05s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="stroke-width"
                      values="3.5;6;3.5"
                      dur="1.05s"
                      repeatCount="indefinite"
                    />
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
                    style={{
                      filter: 'drop-shadow(0 0 18px rgba(186,230,253,0.9))',
                    }}
                  >
                    <animate
                      attributeName="y"
                      values={`${top + 10};${top + Math.max(10, height - 18)};${top + 10}`}
                      dur="1.35s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;1;0"
                      dur="1.35s"
                      repeatCount="indefinite"
                    />
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
                    <animate
                      attributeName="stroke-dashoffset"
                      values="0;48"
                      dur="1.4s"
                      repeatCount="indefinite"
                    />
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
                      ? 'Manual window entry'
                      : needsReview
                        ? 'Type width + height manually'
                        : analyzing
                        ? 'Vision is reading this window'
                        : 'Capture window size'}
                  </text>
                </g>
              )}
              {confirmed && (
                <>
                  <rect
                    x={left}
                    y={top}
                    width={width}
                    height={height}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={2.4}
                    rx={8}
                  >
                    <animate attributeName="x" from={String(left)} to={String(badgeLeft)} dur="0.34s" fill="freeze" />
                    <animate attributeName="y" from={String(top)} to={String(badgeTop)} dur="0.34s" fill="freeze" />
                    <animate attributeName="width" from={String(width)} to={String(badgeRadius * 2)} dur="0.34s" fill="freeze" />
                    <animate attributeName="height" from={String(height)} to={String(badgeRadius * 2)} dur="0.34s" fill="freeze" />
                    <animate attributeName="opacity" from="0.95" to="0" dur="0.34s" fill="freeze" />
                  </rect>
                  <circle
                    cx={centerX}
                    cy={centerY}
                    r={badgeRadius * 0.9}
                    fill="none"
                    stroke="rgba(16,185,129,0.5)"
                    strokeWidth={3}
                    opacity={0}
                  >
                    <animate attributeName="opacity" values="0;0.95;0" dur="0.55s" fill="freeze" />
                    <animate
                      attributeName="r"
                      values={`${badgeRadius * 0.85};${badgeRadius * 1.7};${badgeRadius * 2.1}`}
                      dur="0.55s"
                      fill="freeze"
                    />
                    <animate attributeName="stroke-width" values="3.4;1.8;0.8" dur="0.55s" fill="freeze" />
                  </circle>
                  <circle
                    cx={centerX}
                    cy={centerY}
                    r={badgeRadius}
                    fill="rgba(16,185,129,0.96)"
                    stroke="rgba(255,255,255,0.92)"
                    strokeWidth={2.4}
                  >
                    <animate
                      attributeName="r"
                      values={`6;${badgeRadius * 1.18};${badgeRadius}`}
                      dur="0.34s"
                      fill="freeze"
                    />
                    <animate attributeName="opacity" from="0" to="1" dur="0.18s" fill="freeze" />
                  </circle>
                  <circle
                    cx={centerX - badgeRadius * 0.95}
                    cy={centerY - badgeRadius * 0.82}
                    r="2.4"
                    fill="rgba(255,255,255,0.95)"
                    opacity={0}
                  >
                    <animate attributeName="opacity" values="0;0.9;0" dur="0.42s" begin="0.12s" fill="freeze" />
                    <animate attributeName="r" values="1.6;3.4;1.4" dur="0.42s" begin="0.12s" fill="freeze" />
                  </circle>
                  <circle
                    cx={centerX + badgeRadius * 0.88}
                    cy={centerY - badgeRadius * 0.56}
                    r="2"
                    fill="rgba(209,250,229,0.98)"
                    opacity={0}
                  >
                    <animate attributeName="opacity" values="0;0.8;0" dur="0.38s" begin="0.18s" fill="freeze" />
                    <animate attributeName="r" values="1.2;3;1.2" dur="0.38s" begin="0.18s" fill="freeze" />
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
        })}
      </svg>
    </div>
  );
}
