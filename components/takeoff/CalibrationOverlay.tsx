'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import { parseDimensionToFeet } from '@/lib/types/takeoff';
import type { PdfPoint } from '@/lib/types/takeoff';

interface CalibrationOverlayProps {
  viewerRef: React.RefObject<BlueprintViewerHandle | null>;
  pageWidth: number;
  pageHeight: number;
}

export function CalibrationOverlay({ viewerRef, pageWidth, pageHeight }: CalibrationOverlayProps) {
  const calibrationStep = useTakeoffStore((s) => s.calibrationStep);
  const pointA = useTakeoffStore((s) => s.calibrationPointA);
  const pointB = useTakeoffStore((s) => s.calibrationPointB);
  const setCalibrationPointA = useTakeoffStore((s) => s.setCalibrationPointA);
  const setCalibrationPointB = useTakeoffStore((s) => s.setCalibrationPointB);
  const confirmPrimaryCalibration = useTakeoffStore((s) => s.confirmPrimaryCalibration);
  const confirmVerificationCalibration = useTakeoffStore((s) => s.confirmVerificationCalibration);

  const [dimensionInput, setDimensionInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [snapPreview, setSnapPreview] = useState<{ pdf: PdfPoint; css: { x: number; y: number } } | null>(null);
  const [cursorPreview, setCursorPreview] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Track mouse for snap preview during calibration
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setCursorPreview({ x: e.clientX, y: e.clientY });
    const pdfPt = viewer.cssToPageCoords(e.clientX, e.clientY);
    if (!pdfPt) return;
    const snapped = viewer.snapToVector(pdfPt, {
      screenThresholdPx: 8,
      disabled: e.altKey,
      debugSource: 'calibrate-hover',
    });
    if (snapped !== pdfPt) {
      const snapCss = viewer.pageCoordsToCss(snapped.x, snapped.y);
      if (snapCss) {
        setSnapPreview({ pdf: snapped, css: snapCss });
        return;
      }
    }
    setSnapPreview(null);
  }, [viewerRef]);

  const handleMouseLeave = useCallback(() => {
    setCursorPreview(null);
    setSnapPreview(null);
  }, []);

  useEffect(() => {
    const loupeCanvas = loupeCanvasRef.current;
    const viewer = viewerRef.current;
    if (!loupeCanvas || !viewer) return;

    const sourceCanvas = viewer.getVisibleCanvasElement();
    const targetCssPoint = (() => {
      if (snapPreview) return snapPreview.css;
      if (!cursorPreview) return null;
      const pdfPoint = viewer.cssToPageCoords(cursorPreview.x, cursorPreview.y);
      if (!pdfPoint) return null;
      return viewer.pageCoordsToCss(pdfPoint.x, pdfPoint.y);
    })();

    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, loupeCanvas.width, loupeCanvas.height);

    if (!sourceCanvas || !targetCssPoint || pageWidth <= 0 || pageHeight <= 0) {
      return;
    }

    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;
    const sourceCenterX = (targetCssPoint.x / pageWidth) * sourceWidth;
    const sourceCenterY = (targetCssPoint.y / pageHeight) * sourceHeight;
    const sampleSize = 48;
    const halfSampleSize = sampleSize / 2;
    const sourceX = Math.max(0, Math.min(sourceWidth - sampleSize, sourceCenterX - halfSampleSize));
    const sourceY = Math.max(0, Math.min(sourceHeight - sampleSize, sourceCenterY - halfSampleSize));

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceCanvas, sourceX, sourceY, sampleSize, sampleSize, 0, 0, loupeCanvas.width, loupeCanvas.height);

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, loupeCanvas.width - 1.5, loupeCanvas.height - 1.5);

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.92)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(loupeCanvas.width / 2, 8);
    ctx.lineTo(loupeCanvas.width / 2, loupeCanvas.height - 8);
    ctx.moveTo(8, loupeCanvas.height / 2);
    ctx.lineTo(loupeCanvas.width - 8, loupeCanvas.height / 2);
    ctx.stroke();

    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(loupeCanvas.width / 2, loupeCanvas.height / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }, [cursorPreview, pageHeight, pageWidth, snapPreview, viewerRef]);

  // Focus the input when it appears
  useEffect(() => {
    if (
      (calibrationStep === 'primary_input' || calibrationStep === 'verify_input') &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [calibrationStep]);

  // Reset input between calibration phases
  useEffect(() => {
    setDimensionInput('');
    setInputError('');
  }, [calibrationStep]);

  // Click handler reads latest state from store to avoid stale closures
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent WallTraceOverlay from also handling this click

      const viewer = viewerRef.current;
      if (!viewer || viewer.isPanning()) return; // Ignore clicks while Space-panning

      const rawPdfPoint = viewer.cssToPageCoords(e.clientX, e.clientY);
      if (!rawPdfPoint) return;

      // Snap to nearest vector endpoint for precision (5 pts threshold)
      const pdfPoint = viewer.snapToVector(rawPdfPoint, {
        screenThresholdPx: 5,
        disabled: e.altKey,
        debugSource: 'calibrate-click',
      });

      // Read latest state directly from store (not from closure)
      const currentStep = useTakeoffStore.getState().calibrationStep;
      const currentA = useTakeoffStore.getState().calibrationPointA;

      if (currentStep === 'primary_a' || currentStep === 'verify_a') {
        if (!currentA) {
          setCalibrationPointA(pdfPoint);
        } else {
          setCalibrationPointB(pdfPoint);
        }
      }
    },
    [viewerRef, setCalibrationPointA, setCalibrationPointB]
  );

  const handleConfirm = useCallback(() => {
    const feet = parseDimensionToFeet(dimensionInput);
    if (!feet || feet <= 0) {
      setInputError('Enter a valid dimension (e.g., 14, 14\'-6")');
      return;
    }

    if (calibrationStep === 'primary_input') {
      confirmPrimaryCalibration(feet, dimensionInput);
    } else if (calibrationStep === 'verify_input') {
      confirmVerificationCalibration(feet, dimensionInput);
    }
  }, [dimensionInput, calibrationStep, confirmPrimaryCalibration, confirmVerificationCalibration]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
  }, [handleConfirm]);

  // Convert PDF points to CSS for rendering
  const toCss = useCallback((pdfX: number, pdfY: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return { x: 0, y: 0 };
    return viewer.pageCoordsToCss(pdfX, pdfY) ?? { x: 0, y: 0 };
  }, [viewerRef]);

  // Idle or done — don't render
  if (calibrationStep === 'idle' || calibrationStep === 'done') return null;

  // Determine instruction text
  const isVerifyPhase = calibrationStep.startsWith('verify');
  const isInputPhase = calibrationStep === 'primary_input' || calibrationStep === 'verify_input';

  // Render calibration line + dots
  const cssA = pointA ? toCss(pointA.x, pointA.y) : null;
  const cssB = pointB ? toCss(pointB.x, pointB.y) : null;
  const loupeStyle = (() => {
    if (!cursorPreview) return null;
    const viewerRect = viewerRef.current?.getViewportClientRect();
    if (!viewerRect) return null;
    const loupeWidth = 118;
    const loupeHeight = 118;
    const offsetX = 28;
    const offsetY = -28;
    const anchorX = cursorPreview.x;
    const anchorY = cursorPreview.y;
    let left = anchorX + offsetX;
    let top = anchorY + offsetY - loupeHeight;

    if (left + loupeWidth > viewerRect.right - 8) {
      left = anchorX - offsetX - loupeWidth;
    }
    if (left < viewerRect.left + 8) left = viewerRect.left + 8;
    if (top < viewerRect.top + 8) {
      top = anchorY + 20;
    }
    if (top + loupeHeight > viewerRect.bottom - 8) {
      top = Math.max(viewerRect.top + 8, viewerRect.bottom - loupeHeight - 8);
    }

    return { left, top, width: loupeWidth, height: loupeHeight, position: 'fixed' as const };
  })();
  const inputPopupStyle = (() => {
    if (!(isInputPhase && cssA && cssB)) return null;
    const viewerRect = viewerRef.current?.getViewportClientRect();
    if (!viewerRect) return null;
    return {
      left: viewerRect.left + 16,
      top: viewerRect.top + 16,
      position: 'fixed' as const,
    };
  })();
  return (
    <div
      className="absolute inset-0 pointer-events-auto cursor-none"
      style={{ width: pageWidth, height: pageHeight, overflow: 'hidden' }}
      onClick={handleOverlayClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* SVG layer for calibration line */}
      <svg
        className="absolute inset-0"
        width={pageWidth}
        height={pageHeight}
        style={{ pointerEvents: 'none' }}
      >
        {/* Point A */}
        {cssA && (
          <circle
            cx={cssA.x}
            cy={cssA.y}
            r={6}
            fill="#3b82f6"
            stroke="white"
            strokeWidth={2}
          />
        )}

        {/* Point B */}
        {cssB && (
          <circle
            cx={cssB.x}
            cy={cssB.y}
            r={6}
            fill="#3b82f6"
            stroke="white"
            strokeWidth={2}
          />
        )}

        {/* Line between A and B */}
        {cssA && cssB && (
          <>
            <line
              x1={cssA.x}
              y1={cssA.y}
              x2={cssB.x}
              y2={cssB.y}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
            {/* No midpoint label — it obscures the dimension text the user is trying to read */}
          </>
        )}

        {/* Snap-to-vector indicator */}
        {snapPreview && (
          <g>
            <circle
              cx={snapPreview.css.x} cy={snapPreview.css.y}
              r={10} fill="none" stroke="#3b82f6" strokeWidth={2} opacity={0.92}
            />
            <line x1={snapPreview.css.x - 20} y1={snapPreview.css.y} x2={snapPreview.css.x - 6} y2={snapPreview.css.y} stroke="#3b82f6" strokeWidth={2} opacity={0.92} />
            <line x1={snapPreview.css.x + 6} y1={snapPreview.css.y} x2={snapPreview.css.x + 20} y2={snapPreview.css.y} stroke="#3b82f6" strokeWidth={2} opacity={0.92} />
            <line x1={snapPreview.css.x} y1={snapPreview.css.y - 20} x2={snapPreview.css.x} y2={snapPreview.css.y - 6} stroke="#3b82f6" strokeWidth={2} opacity={0.92} />
            <line x1={snapPreview.css.x} y1={snapPreview.css.y + 6} x2={snapPreview.css.x} y2={snapPreview.css.y + 20} stroke="#3b82f6" strokeWidth={2} opacity={0.92} />
            <circle cx={snapPreview.css.x} cy={snapPreview.css.y} r={2.5} fill="#3b82f6" />
          </g>
        )}

        {!snapPreview && cursorPreview && (() => {
          const viewer = viewerRef.current;
          if (!viewer) return null;
          const cssPoint = viewer.cssToPageCoords(cursorPreview.x, cursorPreview.y);
          if (!cssPoint) return null;
          const css = viewer.pageCoordsToCss(cssPoint.x, cssPoint.y);
          if (!css) return null;
          return (
            <g opacity={0.9}>
              <circle
                cx={css.x}
                cy={css.y}
                r={9}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1.75}
              />
              <line x1={css.x - 18} y1={css.y} x2={css.x - 5} y2={css.y} stroke="#3b82f6" strokeWidth={1.75} />
              <line x1={css.x + 5} y1={css.y} x2={css.x + 18} y2={css.y} stroke="#3b82f6" strokeWidth={1.75} />
              <line x1={css.x} y1={css.y - 18} x2={css.x} y2={css.y - 5} stroke="#3b82f6" strokeWidth={1.75} />
              <line x1={css.x} y1={css.y + 5} x2={css.x} y2={css.y + 18} stroke="#3b82f6" strokeWidth={1.75} />
              <circle cx={css.x} cy={css.y} r={2.25} fill="#3b82f6" />
            </g>
          );
        })()}
      </svg>

      {loupeStyle && (
        <div
          className="absolute z-20 overflow-hidden rounded-[18px] border border-[rgba(59,130,246,0.24)] bg-[rgba(255,255,255,0.94)] p-1 shadow-[0_18px_32px_rgba(37,99,235,0.16)] backdrop-blur-md"
          style={loupeStyle}
        >
          <div className="takeoff-label mb-1 px-1 text-[8px] text-[#2563eb]">
            Precision view
          </div>
          <canvas
            ref={loupeCanvasRef}
            width={108}
            height={88}
            className="block h-[88px] w-[108px] rounded-[12px] bg-white"
          />
        </div>
      )}

      {/* Dimension input popup */}
      {isInputPhase && cssA && cssB && inputPopupStyle && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={inputPopupStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-[240px] rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.94)] p-3 text-[var(--takeoff-ink)] shadow-[0_20px_40px_rgba(15,16,17,0.14)] backdrop-blur-lg">
            <p className="takeoff-label mb-2 text-[10px] text-[var(--takeoff-text-subtle)]">
              {isVerifyPhase ? 'Verification dimension:' : 'What is this dimension?'}
            </p>
            <input
              ref={inputRef}
              type="text"
              value={dimensionInput}
              onChange={(e) => { setDimensionInput(e.target.value); setInputError(''); }}
              onKeyDown={handleKeyDown}
              placeholder={`e.g., 14, 14'-6"`}
              className="takeoff-mono w-full rounded-[14px] border border-[var(--takeoff-line)] bg-white px-3 py-2 text-sm text-[var(--takeoff-ink)] placeholder:text-[var(--takeoff-text-subtle)] focus:outline-none focus:ring-2 focus:ring-black/5"
            />
            {inputError && (
              <p className="mt-1 text-xs text-[var(--takeoff-accent)]">{inputError}</p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleConfirm}
                className="takeoff-mono flex-1 rounded-full border border-white bg-[var(--takeoff-paper-strong)] py-1.5 text-xs font-semibold text-[var(--takeoff-ink)] transition-colors hover:bg-[var(--takeoff-paper)]"
              >
                Confirm
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-[var(--takeoff-text-subtle)]">
              Enter the printed dimension exactly as shown to lock the page scale.
            </p>
          </div>
        </div>
      )}

      {/* No skip — verification is required */}
    </div>
  );
}
