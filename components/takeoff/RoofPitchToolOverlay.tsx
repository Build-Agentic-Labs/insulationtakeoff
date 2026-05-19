'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pdfjs } from 'react-pdf';
import { getReactPdfWorkerSrc } from '@/lib/pdf/pdfjs-worker';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import type { PdfPoint } from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = getReactPdfWorkerSrc();

type RoofPitchToolMode = 'idle' | 'capture';

interface CaptureResult {
  sourceText: string;
  detectedRise: number | null;
  detectedRun: number | null;
  confidence: number;
  confirmed: boolean;
  disposition: 'confirmed' | 'ambiguous' | 'invalid_target';
  detectionMethod: 'vision' | 'none';
}

interface RoofPitchToolOverlayProps {
  viewerRef: React.RefObject<BlueprintViewerHandle | null>;
  pageWidth: number;
  pageHeight: number;
  pdfUrl: string;
  mode: RoofPitchToolMode;
  onCaptureComplete: (result: CaptureResult) => void;
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

const pdfDocumentCache = new Map<string, Promise<PdfDocumentLike>>();
const ROOF_PITCH_CAPTURE_CONFIDENCE_THRESHOLD = 0.82;

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
    throw new Error('Could not create cropped roof pitch vision canvas context');
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
    throw new Error('Could not create roof pitch vision canvas context');
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

async function captureRoofPitchWithVision(
  pdfUrl: string,
  pageNumber: number,
  rect: PdfRect,
): Promise<CaptureResult> {
  const fullCanvas = await renderPdfRegionToCanvas(pdfUrl, pageNumber, rect);
  const topCanvas = cropCanvasVertical(fullCanvas, 0, 0.62);

  const response = await fetch('/api/takeoff/detect-roof-pitch', {
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
    throw new Error(`Vision roof pitch capture failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as {
    raw_text?: unknown;
    rise?: unknown;
    run?: unknown;
    confidence?: unknown;
    disposition?: unknown;
  };

  const rise =
    typeof result.rise === 'number' && Number.isFinite(result.rise)
      ? result.rise
      : null;
  const run =
    typeof result.run === 'number' && Number.isFinite(result.run)
      ? result.run
      : null;
  const sourceText = typeof result.raw_text === 'string' ? result.raw_text.trim() : '';
  const confidence =
    typeof result.confidence === 'number' && Number.isFinite(result.confidence)
      ? Math.max(0, Math.min(1, result.confidence))
      : 0;
  const confirmed =
    rise !== null &&
    run !== null &&
    confidence >= ROOF_PITCH_CAPTURE_CONFIDENCE_THRESHOLD;
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
    detectedRise: rise,
    detectedRun: run,
    confidence,
    confirmed,
    disposition,
    detectionMethod: rise || run || sourceText ? 'vision' : 'none',
  };
}

export function RoofPitchToolOverlay({
  viewerRef,
  pageWidth,
  pageHeight,
  pdfUrl,
  mode,
  onCaptureComplete,
}: RoofPitchToolOverlayProps) {
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);

  const captureStartRef = useRef<PdfPoint | null>(null);
  const captureGenerationRef = useRef(0);
  const completeTimerIdsRef = useRef<Set<number>>(new Set());
  const [draftCaptureRect, setDraftCaptureRect] = useState<PdfRect | null>(null);
  const [captureFeedbacks, setCaptureFeedbacks] = useState<CaptureFeedback[]>([]);
  const [isDraggingCapture, setIsDraggingCapture] = useState(false);

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
        const result = await captureRoofPitchWithVision(pdfUrl, activePageIndex + 1, nextRect);
        if (captureGenerationRef.current !== captureGeneration) {
          return;
        }

        if (result.confirmed) {
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
            onCaptureComplete(result);
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
        onCaptureComplete(result);
      } catch (error) {
        if (captureGenerationRef.current !== captureGeneration) {
          return;
        }
        console.error('[RoofPitchToolOverlay] Failed to capture roof pitch with vision:', error);
        setCaptureFeedbacks((current) =>
          current.map((feedback) =>
            feedback.id === captureId ? { ...feedback, phase: 'needs_review' } : feedback,
          ),
        );
        onCaptureComplete({
          sourceText: '',
          detectedRise: null,
          detectedRun: null,
          confidence: 0,
          confirmed: false,
          disposition: 'ambiguous',
          detectionMethod: 'none',
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

  const toCss = useCallback(
    (point: PdfPoint) => viewerRef.current?.pageCoordsToCss(point.x, point.y) ?? { x: 0, y: 0 },
    [viewerRef],
  );

  const isActive = mode === 'capture';
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

  if (!isActive && visibleCaptureFeedbacks.length === 0) {
    return null;
  }

  return (
    <div
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
          const needsReview = captureFeedback.phase === 'needs_review';
          const invalidTarget = captureFeedback.phase === 'invalid_target';
          const analyzing = captureFeedback.phase === 'analyzing';
          const confirmed = captureFeedback.phase === 'confirmed';
          const strokeColor = invalidTarget
            ? 'rgba(185,28,28,0.92)'
            : needsReview
              ? 'rgba(180,83,9,0.92)'
              : 'rgba(15,118,110,0.94)';
          const fillColor = invalidTarget
            ? 'rgba(239,68,68,0.12)'
            : needsReview
              ? 'rgba(245,158,11,0.14)'
              : 'rgba(20,184,166,0.12)';
          const badgeFill = invalidTarget
            ? 'rgba(254,242,242,0.98)'
            : needsReview
              ? 'rgba(255,251,235,0.98)'
              : 'rgba(240,253,250,0.98)';
          const badgeStroke = invalidTarget
            ? 'rgba(220,38,38,0.24)'
            : needsReview
              ? 'rgba(217,119,6,0.28)'
              : 'rgba(13,148,136,0.22)';
          const badgeText = invalidTarget
            ? '#b91c1c'
            : needsReview
              ? '#b45309'
              : '#0f766e';
          const scanFrameColor = 'rgba(45,212,191,0.56)';
          const scanEdgeColor = 'rgba(204,251,241,0.72)';
          const scanSweepFill = 'rgba(255,255,255,0.88)';
          const scanSweepStroke = 'rgba(20,184,166,0.96)';
          const scanGlowFilter = 'drop-shadow(0 0 16px rgba(45,212,191,0.42))';

          return (
            <g key={captureFeedback.id} style={{ pointerEvents: 'none' }}>
              <rect
                x={left}
                y={top}
                width={width}
                height={height}
                rx={8}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={2}
              />
              {(analyzing || confirmed) && (
                <>
                  <rect
                    x={left}
                    y={top}
                    width={width}
                    height={height}
                    rx={8}
                    fill="none"
                    stroke={scanFrameColor}
                    strokeWidth={1.5}
                    style={{ filter: scanGlowFilter }}
                  />
                  <line
                    x1={left + 10}
                    y1={top}
                    x2={left + width - 10}
                    y2={top}
                    stroke={scanEdgeColor}
                    strokeWidth={1.2}
                    strokeLinecap="round"
                  />
                  <line
                    x1={left + 10}
                    y1={top + height}
                    x2={left + width - 10}
                    y2={top + height}
                    stroke={scanEdgeColor}
                    strokeWidth={1.2}
                    strokeLinecap="round"
                  />
                  <rect
                    x={left + 6}
                    y={centerY - 6}
                    width={Math.max(18, width - 12)}
                    height={12}
                    rx={6}
                    fill={scanSweepFill}
                    stroke={scanSweepStroke}
                    strokeWidth={1}
                    opacity={analyzing ? 0.92 : 0.62}
                  />
                </>
              )}
              <circle
                cx={centerX}
                cy={centerY}
                r={badgeRadius}
                fill={badgeFill}
                stroke={badgeStroke}
                strokeWidth={1.5}
              />
              <text
                x={centerX}
                y={centerY + 3.5}
                textAnchor="middle"
                className="takeoff-mono"
                style={{ fill: badgeText, fontSize: 10, fontWeight: 700 }}
              >
                {confirmed ? 'OK' : needsReview ? '?' : invalidTarget ? '!' : '...'}
              </text>
            </g>
          );
        })}
      </svg>
      {isDraggingCapture && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[rgba(15,118,110,0.18)] bg-white/96 px-3 py-1 text-[10px] font-medium text-[#0f766e] shadow-[0_8px_24px_rgba(15,118,110,0.14)]"
          style={{ pointerEvents: 'none' }}
        >
          Drag around the roof pitch note
        </div>
      )}
      {isActive && !isDraggingCapture && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[rgba(15,118,110,0.18)] bg-white/96 px-3 py-1 text-[10px] font-medium text-[#0f766e] shadow-[0_8px_24px_rgba(15,118,110,0.14)]"
          style={{ pointerEvents: 'none' }}
        >
          Drag a box around the roof pitch note
        </div>
      )}
    </div>
  );
}
