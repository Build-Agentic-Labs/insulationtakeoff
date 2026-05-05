'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import type { BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import { getWallPreset } from '@/lib/takeoff/presets';
import { computeSlopedAreaSf, formatRoofPitch } from '@/lib/takeoff/roof-pitch';
import { buildRoofPitchColorMap, resolveAreaZoneColor } from '@/lib/takeoff/area-colors';
import { pdfDistance, formatFeetInches, traceAreaSf, isUnconditioned } from '@/lib/types/takeoff';
import type { PdfPoint, Trace } from '@/lib/types/takeoff';
import { syncWorkspaceObjectsFromTraceData } from '@/lib/takeoff/workspace-v2';

interface WallTraceOverlayProps {
  viewerRef: React.RefObject<BlueprintViewerHandle | null>;
  pageWidth: number;
  pageHeight: number;
  focusedZoneTraceId?: string | null;
  pdfUrl?: string;
  suppressMeasurementLabels?: boolean;
  roofSectionMode?: boolean;
}

interface DragPointState {
  kind: 'active' | 'committed';
  traceId: string | null;
  pointIndex: number;
}

interface OrthogonalSnapPreview {
  startPdf: PdfPoint;
  snappedPdf: PdfPoint;
  axis: 'horizontal' | 'vertical';
}

const ORTHOGONAL_SNAP_THRESHOLD_PX = 12;

function getPolygonArea(points: PdfPoint[]) {
  if (points.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return Math.abs(sum) / 2;
}

function isPointInPolygon(point: PdfPoint, polygon: PdfPoint[]) {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function normalizeVector(point: { x: number; y: number }) {
  const length = Math.hypot(point.x, point.y);
  if (length === 0) return null;
  return {
    x: point.x / length,
    y: point.y / length,
  };
}

function getActiveWallPreviewColor(thicknessIn: 4 | 6 | 8 | 10 | 12) {
  return thicknessIn === 4 ? '#92400e' : '#7f1d1d';
}

const HIDE_MEASUREMENT_LABELS_AT_SCALE = 0.85;

export function WallTraceOverlay({
  viewerRef,
  pageWidth,
  pageHeight,
  focusedZoneTraceId = null,
  pdfUrl,
  suppressMeasurementLabels = false,
  roofSectionMode = false,
}: WallTraceOverlayProps) {
  const drawingPreset = useTakeoffStore((s) => s.drawingPreset);
  const session = useTakeoffStore((s) => s.session);
  const tool = useTakeoffStore((s) => s.tool);
  const traceMode = useTakeoffStore((s) => s.traceMode);
  const calibrationStep = useTakeoffStore((s) => s.calibrationStep);
  const wallPreset = useTakeoffStore((s) => s.wallPreset);
  const activeWallFillSide = useTakeoffStore((s) => s.activeWallFillSide);
  const activeTracePoints = useTakeoffStore((s) => s.activeTracePoints);
  const activeTraceId = useTakeoffStore((s) => s.activeTraceId);
  const addTracePoint = useTakeoffStore((s) => s.addTracePoint);
  const removeLastTracePoint = useTakeoffStore((s) => s.removeLastTracePoint);
  const updateActiveTracePoint = useTakeoffStore((s) => s.updateActiveTracePoint);
  const finishTrace = useTakeoffStore((s) => s.finishTrace);
  const toggleActiveWallFillSide = useTakeoffStore((s) => s.toggleActiveWallFillSide);
  const deleteTrace = useTakeoffStore((s) => s.deleteTrace);
  const deleteTraceSegment = useTakeoffStore((s) => s.deleteTraceSegment);
  const updateTracePoint = useTakeoffStore((s) => s.updateTracePoint);
  const getCalibration = useTakeoffStore((s) => s.getCalibration);
  const getVisibleTracesForPage = useTakeoffStore((s) => s.getVisibleTracesForPage);
  const activePageIndex = useTakeoffStore((s) => s.activePageIndex);
  const selectedTraceId = useTakeoffStore((s) => s.selectedTraceId);
  const selectedSegmentIndex = useTakeoffStore((s) => s.selectedSegmentIndex);
  const selectTrace = useTakeoffStore((s) => s.selectTrace);
  const selectSegment = useTakeoffStore((s) => s.selectSegment);
  const handleEscape = useTakeoffStore((s) => s.handleEscape);

  const [cursorPdfPos, setCursorPdfPos] = useState<PdfPoint | null>(null);
  const [snapPreviewPdfPos, setSnapPreviewPdfPos] = useState<PdfPoint | null>(null);
  const [orthPreview, setOrthPreview] = useState<OrthogonalSnapPreview | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [dragPoint, setDragPoint] = useState<DragPointState | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const instructionChipClass =
    'takeoff-mono pointer-events-none absolute left-1/2 top-3 z-30 max-w-[min(90vw,40rem)] -translate-x-1/2 rounded-full border border-black/10 bg-[rgba(255,255,255,0.96)] px-4 py-2 text-center text-xs font-medium text-[var(--takeoff-ink)] shadow-[0_14px_28px_rgba(15,16,17,0.12)]';

  // Forward wheel events to the scroll container so trackpad panning works through the overlay
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      // Don't forward if it's a zoom gesture (Ctrl/Cmd+wheel)
      if (e.ctrlKey || e.metaKey) return;

      // Let the event bubble up naturally by not calling preventDefault
      // The overlay doesn't need wheel events, so just make it pass through
    };

    // Use passive listener so we don't block scrolling
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const cal = getCalibration();
  const wallRuns = new Map((session?.wallRuns ?? []).map((wallRun) => [wallRun.id, wallRun]));
  const surfaces = new Map((session?.surfaces ?? []).map((surface) => [surface.id, surface]));
  const zones = new Map((session?.zones ?? []).map((zone) => [zone.id, zone]));
  const roofPitchColorByKey = buildRoofPitchColorMap(session?.zones ?? []);
  const selectedTrace = selectedTraceId
    ? session?.traces.find((trace) => trace.id === selectedTraceId) ?? null
    : null;
  const committedTraces = getVisibleTracesForPage(activePageIndex).filter(
    (trace) => trace.id !== activeTraceId
  );

  const selectAreaTraceAtPoint = useCallback((pdfPoint: PdfPoint) => {
    const hitTrace = committedTraces
      .filter((trace) => {
        if (!trace.zone || trace.points.length < 3) return false;
        if (!trace.isClosed && trace.type !== 'area') return false;
        return isPointInPolygon(pdfPoint, trace.points);
      })
      .sort((a, b) => getPolygonArea(a.points) - getPolygonArea(b.points))[0];

    if (!hitTrace) return false;

    selectTrace(hitTrace.id);
    return true;
  }, [committedTraces, selectTrace]);

  useEffect(() => {
    if (!dragPoint) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isPanning()) return;

      const rawPdfPoint = viewer.cssToPageCoords(e.clientX, e.clientY);
      if (!rawPdfPoint) return;

      const pdfPoint = viewer.snapToVector(rawPdfPoint, {
        screenThresholdPx: 5,
        disabled: e.altKey,
        debugSource: 'trace-drag',
      });
      if (dragPoint.kind === 'active') {
        updateActiveTracePoint(dragPoint.pointIndex, pdfPoint);
      } else if (dragPoint.traceId) {
        updateTracePoint(dragPoint.traceId, dragPoint.pointIndex, pdfPoint);
      }

      setCursorPdfPos(pdfPoint);

      dragMovedRef.current = true;
    };

    const handleWindowMouseUp = () => {
      if (dragMovedRef.current) {
        suppressNextClickRef.current = true;
      }
      dragMovedRef.current = false;
      setDragPoint(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragPoint, updateActiveTracePoint, updateTracePoint, viewerRef]);

  const resolveTraceAssistPoint = useCallback((
    rawPdfPoint: PdfPoint,
    vectorThresholdPx: number,
    disableAssist: boolean = false,
    debugSource: string = 'trace-hover',
  ) => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return {
        point: rawPdfPoint,
        vectorPoint: null as PdfPoint | null,
        orthPreview: null as OrthogonalSnapPreview | null,
      };
    }

    if (disableAssist) {
      viewer.snapToVector(rawPdfPoint, {
        screenThresholdPx: vectorThresholdPx,
        disabled: true,
        debugSource,
      });
      return {
        point: rawPdfPoint,
        vectorPoint: null as PdfPoint | null,
        orthPreview: null as OrthogonalSnapPreview | null,
      };
    }

    const vectorPoint = viewer.snapToVector(rawPdfPoint, {
      screenThresholdPx: vectorThresholdPx,
      debugSource,
    });
    if (vectorPoint !== rawPdfPoint) {
      return {
        point: vectorPoint,
        vectorPoint,
        orthPreview: null as OrthogonalSnapPreview | null,
      };
    }

    if (tool !== 'trace' || activeTracePoints.length === 0) {
      return {
        point: rawPdfPoint,
        vectorPoint: null as PdfPoint | null,
        orthPreview: null as OrthogonalSnapPreview | null,
      };
    }

    const anchor = activeTracePoints[activeTracePoints.length - 1];
    const anchorCss = viewer.pageCoordsToCss(anchor.x, anchor.y);
    const pointCss = viewer.pageCoordsToCss(rawPdfPoint.x, rawPdfPoint.y);
    if (!anchorCss || !pointCss) {
      return {
        point: rawPdfPoint,
        vectorPoint: null as PdfPoint | null,
        orthPreview: null as OrthogonalSnapPreview | null,
      };
    }

    const deltaX = pointCss.x - anchorCss.x;
    const deltaY = pointCss.y - anchorCss.y;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    let axis: OrthogonalSnapPreview['axis'] | null = null;
    if (absDeltaX <= ORTHOGONAL_SNAP_THRESHOLD_PX && absDeltaY <= ORTHOGONAL_SNAP_THRESHOLD_PX) {
      axis = absDeltaX <= absDeltaY ? 'vertical' : 'horizontal';
    } else if (absDeltaX <= ORTHOGONAL_SNAP_THRESHOLD_PX) {
      axis = 'vertical';
    } else if (absDeltaY <= ORTHOGONAL_SNAP_THRESHOLD_PX) {
      axis = 'horizontal';
    }

    if (!axis) {
      return {
        point: rawPdfPoint,
        vectorPoint: null as PdfPoint | null,
        orthPreview: null as OrthogonalSnapPreview | null,
      };
    }

    const snappedPoint =
      axis === 'vertical'
        ? { x: anchor.x, y: rawPdfPoint.y }
        : { x: rawPdfPoint.x, y: anchor.y };

    return {
      point: snappedPoint,
      vectorPoint: null as PdfPoint | null,
      orthPreview: {
        startPdf: anchor,
        snappedPdf: snappedPoint,
        axis,
      },
    };
  }, [activeTracePoints, tool, viewerRef]);

  const beginPointDrag = useCallback(
    (e: React.MouseEvent, nextDragPoint: DragPointState) => {
      if (viewerRef.current?.isPanning()) return;

      e.preventDefault();
      e.stopPropagation();

      dragMovedRef.current = false;
      setSnapPreviewPdfPos(null);
      setOrthPreview(null);
      if (nextDragPoint.kind === 'committed' && nextDragPoint.traceId) {
        selectTrace(nextDragPoint.traceId);
      }
      setDragPoint(nextDragPoint);
    },
    [selectTrace, viewerRef],
  );

  // Track mouse for rubber-band line + snap preview
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragPoint) return;

    const viewer = viewerRef.current;
    if (!viewer) return;

    const pdfPt = viewer.cssToPageCoords(e.clientX, e.clientY);
    if (!pdfPt) return;

    if (tool === 'trace') {
      const { point, vectorPoint, orthPreview: nextOrthPreview } = resolveTraceAssistPoint(
        pdfPt,
        8,
        e.altKey,
        'trace-hover',
      );
      setCursorPdfPos(point);
      setSnapPreviewPdfPos(vectorPoint);
      setOrthPreview(nextOrthPreview);
    } else if (tool === 'calibrate') {
      const snapped = viewer.snapToVector(pdfPt, {
        screenThresholdPx: 8,
        disabled: e.altKey,
        debugSource: 'calibrate-hover',
      });
      setSnapPreviewPdfPos(snapped !== pdfPt ? snapped : null);
      setOrthPreview(null);
    } else {
      setSnapPreviewPdfPos(null);
      setOrthPreview(null);
      setCursorPdfPos(null);
    }
  }, [dragPoint, resolveTraceAssistPoint, tool, viewerRef]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    // Ignore clicks while Space-panning
    if (viewerRef.current?.isPanning()) return;

    // Handle trace mode clicks
    if (tool === 'trace') {
      const viewer = viewerRef.current;
      if (!viewer) return;

      const rawPdfPoint = viewer.cssToPageCoords(e.clientX, e.clientY);
      if (!rawPdfPoint) return;

      // Vector endpoint snap has priority; otherwise wall traces can lock to a
      // 90-degree continuation from the last placed point.
      const { point: pdfPoint } = resolveTraceAssistPoint(rawPdfPoint, 5, e.altKey, 'trace-click');

      const currentPoints = useTakeoffStore.getState().activeTracePoints;

      // Snap-to-close: if clicking near the first point and we have enough points, close the trace
      if (currentPoints.length >= 3) {
        const firstPt = currentPoints[0];
        // Compare in PDF space
        const distPdf = pdfDistance(pdfPoint, firstPt);

        // Also compare in screen space using the event coordinates directly
        // This avoids any issues with coordinate conversion round-trips
        const wrapperEl = (e.currentTarget as HTMLElement).closest('[class*="inline-block"]') || e.currentTarget;
        const wrapperRect = wrapperEl.getBoundingClientRect();
        const firstCss = viewer.pageCoordsToCss(firstPt.x, firstPt.y);
        let screenDist = Infinity;
        if (firstCss) {
          // firstCss is relative to the wrapper; convert to viewport coords
          const firstScreenX = wrapperRect.left + firstCss.x;
          const firstScreenY = wrapperRect.top + firstCss.y;
          const dx = e.clientX - firstScreenX;
          const dy = e.clientY - firstScreenY;
          screenDist = Math.sqrt(dx * dx + dy * dy);
        }

        // Close if within 25px on screen OR 30 PDF points
        if (screenDist < 25 || distPdf < 30) {
          finishTrace(true);
          return;
        }
      }

      addTracePoint(pdfPoint);
      return;
    }

    // Handle auto-detect mode — click inside a room to auto-trace
    if (tool === 'auto_detect' && pdfUrl && !autoDetecting) {
      const viewer = viewerRef.current;
      if (!viewer) return;

      const pdfPoint = viewer.cssToPageCoords(e.clientX, e.clientY);
      if (!pdfPoint) return;

      setAutoDetecting(true);

      fetch('/api/takeoff/detect-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdf_url: pdfUrl,
          page_index: activePageIndex,
          click_x: pdfPoint.x,
          click_y: pdfPoint.y,
          dilation_px: 5,
        }),
      })
        .then((res) => res.json())
        .then((result) => {
          if (result.success && result.points?.length >= 3) {
            // Create a trace from the detected points
            const store = useTakeoffStore.getState();
            if (!store.session) return;

            const traceId = crypto.randomUUID();
            const points: PdfPoint[] = result.points.map((p: { x: number; y: number }) => ({
              x: p.x,
              y: p.y,
            }));

            const newTrace: Trace = {
              id: traceId,
              pageIndex: activePageIndex,
              type: 'linear',
              points,
              isClosed: true,
              isLocked: false,
              label: `Auto ${store.session.traces.length + 1}`,
            };

            // Create default classifications for each segment (closed = points.length segments)
            const classifications = points.map((_, i) => ({
              traceId,
              segmentIndex: i,
              label: `Wall ${i + 1}`,
              assemblyScope: 'exterior_wall_2x6' as const,
              wallHeightFt: undefined,
              openings: [],
              installMethod: 'batt_kraft' as const,
              notes: [],
            }));

            useTakeoffStore.setState({
              session: syncWorkspaceObjectsFromTraceData({
                ...store.session,
                traces: [...store.session.traces, newTrace],
                classifications: [...store.session.classifications, ...classifications],
                updatedAt: new Date().toISOString(),
              }),
              selectedTraceId: traceId,
            });
          } else {
            console.warn('[AutoDetect]', result.error || 'No room found');
          }
        })
        .catch((err) => console.error('[AutoDetect] Failed:', err))
        .finally(() => setAutoDetecting(false));

      return;
    }

    // Handle pointer mode — click on trace/segment to select
    if (tool === 'pointer') {
      const viewer = viewerRef.current;
      const pdfPoint = viewer?.cssToPageCoords(e.clientX, e.clientY);

      if (pdfPoint && selectAreaTraceAtPoint(pdfPoint)) {
        return;
      }

      // Click on true empty space deselects
      selectTrace(null);
    }
  }, [tool, viewerRef, pdfUrl, activePageIndex, addTracePoint, finishTrace, selectTrace, autoDetecting, resolveTraceAssistPoint, selectAreaTraceAtPoint]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const minPoints = traceMode === 'area' ? 3 : 2;
    const currentPoints = useTakeoffStore.getState().activeTracePoints;
    if (tool === 'trace' && currentPoints.length >= minPoints) {
      e.preventDefault();
      e.stopPropagation();
      finishTrace();
    }
  }, [tool, traceMode, finishTrace]);

  // Keyboard shortcuts
  useEffect(() => {
    const minPoints = traceMode === 'area' ? 3 : 2;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.closest('[contenteditable="true"]'));

      if (isEditableTarget) {
        return;
      }

      if (e.key === 'Enter' && tool === 'trace' && activeTracePoints.length >= minPoints) {
        e.preventDefault();
        finishTrace();
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && tool === 'trace' && activeTracePoints.length > 0) {
        e.preventDefault();
        removeLastTracePoint();
      }
      if (
        e.key === 'Tab' &&
        tool === 'trace' &&
        drawingPreset === 'wall' &&
        traceMode === 'linear'
      ) {
        e.preventDefault();
        toggleActiveWallFillSide();
      }
      if (
        (e.key === 'Backspace' || e.key === 'Delete') &&
        tool === 'pointer' &&
        selectedTraceId
      ) {
        e.preventDefault();
        if (
          selectedSegmentIndex !== null &&
          selectedTrace?.type === 'linear' &&
          !selectedTrace.isClosed
        ) {
          deleteTraceSegment(selectedTraceId, selectedSegmentIndex);
        } else {
          deleteTrace(selectedTraceId);
        }
      }
      if (
        e.key === 'Escape' &&
        (
          tool !== 'pointer' ||
          calibrationStep !== 'idle' && calibrationStep !== 'done' ||
          selectedTraceId !== null ||
          selectedSegmentIndex !== null
        )
      ) {
        e.preventDefault();
        handleEscape();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    tool,
    activeTracePoints.length,
    calibrationStep,
    deleteTrace,
    deleteTraceSegment,
    drawingPreset,
    finishTrace,
    handleEscape,
    removeLastTracePoint,
    selectedSegmentIndex,
    selectedTraceId,
    selectedTrace,
    toggleActiveWallFillSide,
    traceMode,
  ]);

  // Convert PDF point to CSS for rendering
  const toCss = useCallback((pt: PdfPoint) => {
    const viewer = viewerRef.current;
    if (!viewer) return { x: 0, y: 0 };
    return viewer.pageCoordsToCss(pt.x, pt.y) ?? { x: 0, y: 0 };
  }, [viewerRef]);

  const cursorPos = cursorPdfPos ? toCss(cursorPdfPos) : null;
  const snapPreview = snapPreviewPdfPos
    ? { pdf: snapPreviewPdfPos, css: toCss(snapPreviewPdfPos) }
    : null;
  const orthPreviewCss = orthPreview
    ? {
        start: toCss(orthPreview.startPdf),
        end: toCss(orthPreview.snappedPdf),
        axis: orthPreview.axis,
      }
    : null;
  const isViewerZooming = viewerRef.current?.isZooming() ?? false;
  const viewerScale = viewerRef.current?.getScale() ?? 1;
  const hideMeasurementLabels =
    suppressMeasurementLabels ||
    isViewerZooming ||
    viewerScale <= HIDE_MEASUREMENT_LABELS_AT_SCALE + 0.001;
  const suppressCommittedZoneMeasurements = tool === 'trace' && drawingPreset === 'zone';

  // Render a single trace as SVG elements
  const renderTrace = (trace: Trace, isActive: boolean) => {
    if (trace.points.length < 1) return null;

    const isArea = trace.type === 'area';
    const isTraceSelected = trace.id === selectedTraceId;
    const isFocusedZone = focusedZoneTraceId === trace.id;
    const wallRun = wallRuns.get(trace.id);
    const surface = surfaces.get(trace.id);
    const zoneObject = zones.get(trace.id);
    const zone = trace.zone;
    const zoneColor = zone
      ? resolveAreaZoneColor(zoneObject ?? { zoneType: zone }, roofPitchColorByKey)
      : null;
    const isRoofSection = surface?.assemblyScope === 'cathedral_ceiling';
    const isRoofSectionDraft = isActive && roofSectionMode && drawingPreset === 'surface';
    const isRoofSectionDisplay = isRoofSection || isRoofSectionDraft;
    const roofPitchLabel =
      isRoofSection && surface?.roofPitchRise && surface?.roofPitchRun
        ? formatRoofPitch(surface.roofPitchRise, surface.roofPitchRun)
        : '';

    const strokeColor = isRoofSectionDisplay
      ? isTraceSelected || isActive
        ? '#0f766e'
        : '#0f766e'
      : isActive
        ? (isArea ? '#8b5cf6' : '#3b82f6')
        : trace.isEnvelope
          ? '#1d4ed8'
          : zoneColor
            ? zoneColor.stroke
            : isTraceSelected
              ? (isArea ? '#7c3aed' : '#2563eb')
              : (isArea ? '#a855f7' : '#16a34a');
    const fillColor = isRoofSectionDisplay
      ? isTraceSelected || isActive
        ? '#14b8a6'
        : '#5eead4'
      : isActive
        ? (isArea ? '#8b5cf6' : '#3b82f6')
        : zoneColor
          ? zoneColor.fill
          : isTraceSelected
            ? (isArea ? '#7c3aed' : '#2563eb')
            : (isArea ? '#a855f7' : '#16a34a');
    const isWallTrace = !isArea && (isActive || Boolean(wallRun));
    const traceFillSide = isActive ? activeWallFillSide : wallRun?.fillSide ?? 'left';

    const getSegmentLabelLayout = (
      startPdf: PdfPoint,
      endPdf: PdfPoint,
      startCss: { x: number; y: number },
      endCss: { x: number; y: number },
    ) => {
      if (!cal) return null;

      const lengthFt = pdfDistance(startPdf, endPdf) / cal.pdfPointsPerFoot;
      const lengthLabel = formatFeetInches(lengthFt);
      const dx = endCss.x - startCss.x;
      const dy = endCss.y - startCss.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!lengthLabel || len === 0) return null;

      const midX = (startCss.x + endCss.x) / 2;
      const midY = (startCss.y + endCss.y) / 2;
      const labelNormal = isWallTrace
        ? traceFillSide === 'left'
          ? { x: dy / len, y: -dx / len }
          : { x: -dy / len, y: dx / len }
        : { x: -dy / len, y: dx / len };
      const labelWidth = Math.max(46, lengthLabel.length * 7.5 + 14);
      const labelHeight = 20;
      const baseLabelOffset = isWallTrace ? 24 : 14;
      const labelOffset =
        len < labelWidth
          ? baseLabelOffset + Math.min(18, (labelWidth - len) * 0.35)
          : baseLabelOffset;

      return {
        lengthLabel,
        labelX: midX + labelNormal.x * labelOffset,
        labelY: midY + labelNormal.y * labelOffset,
        labelWidth,
        labelHeight,
      };
    };

    const renderSegmentLengthLabel = (
      key: string,
      startPdf: PdfPoint,
      endPdf: PdfPoint,
      startCss: { x: number; y: number },
      endCss: { x: number; y: number },
      color: string,
    ) => {
      if (hideMeasurementLabels) return null;
      if (!isActive && suppressCommittedZoneMeasurements && trace.zone) return null;
      if (roofSectionMode && (isRoofSection || (trace.zone && isFocusedZone))) return null;
      const label = getSegmentLabelLayout(startPdf, endPdf, startCss, endCss);
      if (!label) return null;

      return (
        <g key={key}>
          <rect
            x={label.labelX - label.labelWidth / 2}
            y={label.labelY - label.labelHeight / 2}
            width={label.labelWidth}
            height={label.labelHeight}
            rx={6}
            fill="rgba(255,255,255,0.92)"
            stroke="rgba(255,255,255,0.98)"
            strokeWidth={1}
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={label.labelX}
            y={label.labelY}
            textAnchor="middle"
            dominantBaseline="central"
            fill={color}
            fontSize={13}
            fontWeight={700}
            fontFamily="ui-monospace, monospace"
            style={{ pointerEvents: 'none' }}
            className="select-none"
          >
            {label.lengthLabel}
          </text>
        </g>
      );
    };

    // Build polygon points string for area fills
    const polygonPoints = trace.points.map((pt) => {
      const css = toCss(pt);
      return `${css.x},${css.y}`;
    }).join(' ');

    // Area label (SF) at centroid
    let areaLabel = '';
    if (isArea && cal && trace.points.length >= 3) {
      const planSf = traceAreaSf(trace, cal);
      const isVaultedAtticZone =
        zoneObject?.zoneType === 'unconditioned_attic' && zoneObject.ceilingType === 'vaulted';
      const hasZoneRoofPitch =
        typeof zoneObject?.roofPitchRise === 'number' &&
        Number.isFinite(zoneObject.roofPitchRise) &&
        zoneObject.roofPitchRise > 0 &&
        typeof zoneObject.roofPitchRun === 'number' &&
        Number.isFinite(zoneObject.roofPitchRun) &&
        zoneObject.roofPitchRun > 0;

      if (isVaultedAtticZone) {
        areaLabel = hasZoneRoofPitch
          ? `${Math.round(
              computeSlopedAreaSf(planSf, zoneObject.roofPitchRise, zoneObject.roofPitchRun),
            ).toLocaleString()} SF`
          : '';
      } else {
        areaLabel =
          roofSectionMode && isRoofSection
            ? `${Math.round(planSf).toLocaleString()} SF plan`
            : `${Math.round(planSf).toLocaleString()} SF`;
      }
    }
    const zoneNameLabel = trace.zone && trace.label ? trace.label : '';
    const centroid = trace.points.length >= 3 ? toCss({
      x: trace.points.reduce((s, p) => s + p.x, 0) / trace.points.length,
      y: trace.points.reduce((s, p) => s + p.y, 0) / trace.points.length,
    }) : null;

    return (
      <g key={trace.id}>
        {/* Polygon fill for closed traces (area traces + zone-classified rooms) */}
        {trace.points.length >= 3 && (trace.isClosed || isArea) && (() => {
          const zone = trace.zone;
          const zoneColor = zone
            ? resolveAreaZoneColor(zoneObject ?? { zoneType: zone }, roofPitchColorByKey)
            : null;
          const useFill = isArea || (trace.isClosed && zone);
          if (!useFill) return null;

          const polyFill = zoneColor?.fill ?? fillColor;
          const baseOpacity = isRoofSection
            ? roofSectionMode
              ? isTraceSelected
                ? 0.18
                : 0.035
              : isTraceSelected
                ? 0.14
                : 0.06
            : roofSectionMode && trace.zone && isFocusedZone
              ? 0.04
              : trace.isEnvelope
                ? 0.08
                : isUnconditioned(zone ?? 'conditioned')
                  ? 0.2
                  : 0.1;
          const opacity =
            roofSectionMode && trace.zone && isFocusedZone
              ? Math.min(baseOpacity + 0.02, 0.08)
              : isFocusedZone
                ? Math.min(baseOpacity + 0.08, 0.28)
                : baseOpacity;

          return (
            <polygon
              points={polygonPoints}
              fill={polyFill}
              fillOpacity={opacity}
              stroke={trace.isEnvelope ? '#1d4ed8' : 'none'}
              strokeWidth={trace.isEnvelope ? 2 : 0}
              strokeDasharray={trace.isEnvelope ? '8 4' : undefined}
              style={{ pointerEvents: 'none' }}
            />
          );
        })()}

        {trace.points.length >= 3 && trace.isClosed && isFocusedZone && zoneColor && (
          <polygon
            points={polygonPoints}
            fill="none"
            stroke={zoneColor.stroke}
            strokeWidth={roofSectionMode ? 3 : 4}
            strokeOpacity={roofSectionMode ? 0.26 : 0.45}
            strokeDasharray={roofSectionMode ? '10 8' : undefined}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {trace.points.length >= 3 && isRoofSection && (
          <polygon
            points={polygonPoints}
            fill="none"
            stroke={strokeColor}
            strokeWidth={isTraceSelected ? 3.5 : roofSectionMode ? 2.25 : 3}
            strokeOpacity={isTraceSelected ? 0.95 : roofSectionMode ? 0.84 : 0.76}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Area / zone label at centroid */}
        {(isArea && centroid && (areaLabel || zoneNameLabel)) && (
          <>
            {(() => {
              const roofSectionPrimaryLabel =
                roofSectionMode && isRoofSection ? roofPitchLabel || 'Roof section' : '';
              const primaryLabel = zoneNameLabel || roofSectionPrimaryLabel || areaLabel;
              const secondaryLabel =
                zoneNameLabel && areaLabel
                  ? areaLabel
                  : roofSectionPrimaryLabel && areaLabel
                    ? areaLabel
                    : '';
              const labelWidth = Math.max(
                86,
                primaryLabel.length * 7.6 + 18,
                secondaryLabel.length > 0 ? secondaryLabel.length * 7.2 + 18 : 0,
              );
              const labelHeight = secondaryLabel ? 34 : 20;
              return (
                <>
                  <rect
                    x={centroid.x - labelWidth / 2}
                    y={centroid.y - labelHeight / 2}
                    width={labelWidth}
                    height={labelHeight}
                    rx={6}
                    fill="white"
                    fillOpacity={0.88}
                    style={{ pointerEvents: 'none' }}
                  />
                  <text
                    x={centroid.x}
                    y={secondaryLabel ? centroid.y - 4 : centroid.y + 4}
                    textAnchor="middle"
                    fill={strokeColor}
                    fontSize={secondaryLabel ? 12 : 13}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                    style={{ pointerEvents: 'none' }}
                    className="select-none"
                  >
                    {primaryLabel}
                  </text>
                  {secondaryLabel && (
                    <text
                      x={centroid.x}
                      y={centroid.y + 11}
                      textAnchor="middle"
                      fill={strokeColor}
                      fontSize={11}
                      fontWeight={700}
                      fontFamily="ui-monospace, monospace"
                      style={{ pointerEvents: 'none' }}
                      className="select-none"
                    >
                      {secondaryLabel}
                    </text>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* Segments */}
        {trace.points.map((pt, i) => {
          if (i >= trace.points.length - 1) return null;
          const next = trace.points[i + 1];
          const a = toCss(pt);
          const b = toCss(next);

          const isSegmentSelected = isTraceSelected && selectedSegmentIndex === i;
          const segStroke = isSegmentSelected ? '#1d4ed8' : strokeColor;
          const segWidth = isSegmentSelected ? 4 : isRoofSection ? (isTraceSelected ? 3.5 : 2.25) : isFocusedZone ? 4 : 3;

          return (
            <g key={`seg-${i}`}>
              {/* Clickable hit area (wider, invisible) — only in pointer mode */}
              {tool === 'pointer' && (
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSegment(trace.id, i);
                  }}
                />
              )}
              {/* Visible line */}
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={segStroke}
                strokeWidth={segWidth}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              {renderSegmentLengthLabel(`seg-label-${i}`, pt, next, a, b, segStroke)}
            </g>
          );
        })}

        {/* Close segment (if closed) */}
        {trace.isClosed && trace.points.length > 2 && (() => {
          const closeSegmentIndex = trace.points.length - 1;
          const lastPdf = trace.points[trace.points.length - 1];
          const firstPdf = trace.points[0];
          const last = toCss(lastPdf);
          const first = toCss(firstPdf);
          const isCloseSegmentSelected = isTraceSelected && selectedSegmentIndex === closeSegmentIndex;
          const closeSegStroke = isCloseSegmentSelected ? '#1d4ed8' : strokeColor;
          return (
            <g>
              {tool === 'pointer' && (
                <line
                  x1={last.x} y1={last.y} x2={first.x} y2={first.y}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectTrace(trace.id);
                    selectSegment(trace.id, closeSegmentIndex);
                  }}
                />
              )}
              <line
                x1={last.x} y1={last.y} x2={first.x} y2={first.y}
                stroke={closeSegStroke}
                strokeWidth={isCloseSegmentSelected ? 4 : isRoofSection ? (isTraceSelected ? 3.5 : 2.25) : isFocusedZone ? 4 : 3}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              {renderSegmentLengthLabel('close-seg-label', lastPdf, firstPdf, last, first, closeSegStroke)}
            </g>
          );
        })()}

        {/* Vertex dots */}
        {!isViewerZooming && (isActive || isTraceSelected) && trace.points.map((pt, i) => {
          const css = toCss(pt);
          const isDraggable = isActive || (tool === 'pointer' && isTraceSelected);

          return (
            <circle
              key={`v-${i}`}
              cx={css.x} cy={css.y}
              r={isDraggable ? 6 : 5}
              fill={isDraggable ? 'white' : fillColor}
              stroke={isDraggable ? strokeColor : 'white'}
              strokeWidth={isDraggable ? 2.5 : 2}
              style={{
                pointerEvents: isDraggable ? 'auto' : 'none',
                cursor: isDraggable ? (dragPoint ? 'grabbing' : 'grab') : undefined,
              }}
              onMouseDown={isDraggable ? (e) => beginPointDrag(e, {
                kind: isActive ? 'active' : 'committed',
                traceId: isActive ? null : trace.id,
                pointIndex: i,
              }) : undefined}
            >
              {isDraggable && <title>Drag to fine-tune point</title>}
            </circle>
          );
        })}
      </g>
    );
  };

  // Build active trace object for rendering
  const activeTrace: Trace | null = activeTraceId && activeTracePoints.length > 0
    ? {
        id: activeTraceId,
        pageIndex: activePageIndex,
        type: traceMode,
        points: activeTracePoints,
        isClosed: traceMode === 'area',
        isLocked: false,
        label: 'Drawing...',
      }
    : null;

  // Rubber-band line from last active point to cursor
  const lastActivePoint = activeTracePoints.length > 0
    ? toCss(activeTracePoints[activeTracePoints.length - 1])
    : null;

  let rubberBandLabel = '';
  if (lastActivePoint && cursorPdfPos && cal && activeTracePoints.length > 0) {
    const lastPdf = activeTracePoints[activeTracePoints.length - 1];
    const dist = pdfDistance(lastPdf, cursorPdfPos) / cal.pdfPointsPerFoot;
    rubberBandLabel = formatFeetInches(dist);
  }

  const fillDirectionPreview = (() => {
    const previewTarget = snapPreview?.css ?? cursorPos;
    if (
      tool !== 'trace' ||
      drawingPreset !== 'wall' ||
      traceMode !== 'linear' ||
      !lastActivePoint ||
      !previewTarget
    ) {
      return null;
    }

    const tangent = normalizeVector({
      x: previewTarget.x - lastActivePoint.x,
      y: previewTarget.y - lastActivePoint.y,
    });
    if (!tangent) return null;

    const normal =
      activeWallFillSide === 'left'
        ? {
            x: -tangent.y,
            y: tangent.x,
          }
        : {
            x: tangent.y,
            y: -tangent.x,
          };
    const tailOffset = 14;
    const arrowLength = 18;
    const tip = {
      x: previewTarget.x + normal.x * (tailOffset + arrowLength),
      y: previewTarget.y + normal.y * (tailOffset + arrowLength),
    };
    const tail = {
      x: previewTarget.x + normal.x * tailOffset,
      y: previewTarget.y + normal.y * tailOffset,
    };
    const headLeft = {
      x: tip.x - normal.x * 6 + tangent.x * 5,
      y: tip.y - normal.y * 6 + tangent.y * 5,
    };
    const headRight = {
      x: tip.x - normal.x * 6 - tangent.x * 5,
      y: tip.y - normal.y * 6 - tangent.y * 5,
    };

    return {
      color: getActiveWallPreviewColor(getWallPreset(wallPreset).thicknessIn),
      tail,
      tip,
      headLeft,
      headRight,
    };
  })();

  const isInteractive = tool === 'trace' || tool === 'pointer' || tool === 'auto_detect';

  return (
    <div
      className="absolute inset-0"
      ref={overlayRef}
      style={{
        width: pageWidth,
        height: pageHeight,
        pointerEvents: isInteractive ? 'auto' : 'none',
        overflow: 'hidden', // Prevent overlay from being a scroll target
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
    >
      <svg
        className="absolute inset-0"
        width={pageWidth}
        height={pageHeight}
        shapeRendering="geometricPrecision"
        style={{ pointerEvents: 'auto' }}
      >
        {/* Exterior fill — shaded area OUTSIDE the envelope to show "outdoors" */}
        {(() => {
          const envelope = committedTraces.find((t) => t.isEnvelope && t.isClosed && t.points.length >= 3);
          if (!envelope) return null;

          // Build an SVG path: outer rectangle (page border) + inner cutout (envelope)
          // Using evenodd fill rule: the area between outer and inner is filled
          const outerPath = `M 0,0 L ${pageWidth},0 L ${pageWidth},${pageHeight} L 0,${pageHeight} Z`;

          const envelopeCssPoints = envelope.points.map((pt) => toCss(pt));
          const innerPath = envelopeCssPoints.map((pt, i) =>
            `${i === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`
          ).join(' ') + ' Z';

          return (
            <path
              d={`${outerPath} ${innerPath}`}
              fillRule="evenodd"
              fill="#64748b"
              fillOpacity={0.12}
              stroke="none"
              style={{ pointerEvents: 'none' }}
            />
          );
        })()}

        {/* Committed traces */}
        {committedTraces.map((trace) => renderTrace(trace, false))}

        {/* Active trace being drawn */}
        {activeTrace && renderTrace(activeTrace, true)}

        {/* Rubber-band line */}
        {lastActivePoint && cursorPos && tool === 'trace' && (
          <g>
            <line
              x1={lastActivePoint.x}
              y1={lastActivePoint.y}
              x2={cursorPos.x}
              y2={cursorPos.y}
              stroke="#3b82f6"
              strokeWidth={3}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
            {rubberBandLabel && !hideMeasurementLabels && (
              <text
                x={(lastActivePoint.x + cursorPos.x) / 2}
                y={(lastActivePoint.y + cursorPos.y) / 2 - 10}
                textAnchor="middle"
                fill="#3b82f6"
                fontSize={13}
                fontWeight={600}
                fontFamily="ui-monospace, monospace"
                opacity={0.9}
                className="select-none"
              >
                {rubberBandLabel}
              </text>
            )}
          </g>
        )}

        {fillDirectionPreview && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={fillDirectionPreview.tail.x}
              y1={fillDirectionPreview.tail.y}
              x2={fillDirectionPreview.tip.x}
              y2={fillDirectionPreview.tip.y}
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={5}
              strokeLinecap="round"
            />
            <line
              x1={fillDirectionPreview.tail.x}
              y1={fillDirectionPreview.tail.y}
              x2={fillDirectionPreview.tip.x}
              y2={fillDirectionPreview.tip.y}
              stroke={fillDirectionPreview.color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <polygon
              points={[
                `${fillDirectionPreview.tip.x},${fillDirectionPreview.tip.y}`,
                `${fillDirectionPreview.headLeft.x},${fillDirectionPreview.headLeft.y}`,
                `${fillDirectionPreview.headRight.x},${fillDirectionPreview.headRight.y}`,
              ].join(' ')}
              fill="rgba(255,255,255,0.92)"
            />
            <polygon
              points={[
                `${fillDirectionPreview.tip.x},${fillDirectionPreview.tip.y}`,
                `${fillDirectionPreview.headLeft.x},${fillDirectionPreview.headLeft.y}`,
                `${fillDirectionPreview.headRight.x},${fillDirectionPreview.headRight.y}`,
              ].join(' ')}
              fill={fillDirectionPreview.color}
            />
          </g>
        )}

        {orthPreviewCss && !snapPreview && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={orthPreviewCss.start.x}
              y1={orthPreviewCss.start.y}
              x2={orthPreviewCss.end.x}
              y2={orthPreviewCss.end.y}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              opacity={0.6}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={orthPreviewCss.end.x - 5}
              y={orthPreviewCss.end.y - 5}
              width={10}
              height={10}
              rx={2}
              fill="rgba(255,255,255,0.92)"
              stroke="#f59e0b"
              strokeWidth={1.5}
            />
            <text
              x={orthPreviewCss.end.x}
              y={orthPreviewCss.end.y - 12}
              textAnchor="middle"
              fill="#f59e0b"
              fontSize={10}
              fontWeight={700}
              fontFamily="ui-monospace, monospace"
              className="select-none"
            >
              90°
            </text>
          </g>
        )}

        {/* Snap-to-vector indicator: crosshair at nearest vector endpoint */}
        {snapPreview && (tool === 'trace' || tool === 'calibrate') && (
          <g>
            {/* Outer ring */}
            <circle
              cx={snapPreview.css.x}
              cy={snapPreview.css.y}
              r={8}
              fill="none"
              stroke="#10b981"
              strokeWidth={1.5}
              opacity={0.8}
            />
            {/* Crosshair lines */}
            <line
              x1={snapPreview.css.x - 12} y1={snapPreview.css.y}
              x2={snapPreview.css.x - 4} y2={snapPreview.css.y}
              stroke="#10b981" strokeWidth={1.5} opacity={0.8}
            />
            <line
              x1={snapPreview.css.x + 4} y1={snapPreview.css.y}
              x2={snapPreview.css.x + 12} y2={snapPreview.css.y}
              stroke="#10b981" strokeWidth={1.5} opacity={0.8}
            />
            <line
              x1={snapPreview.css.x} y1={snapPreview.css.y - 12}
              x2={snapPreview.css.x} y2={snapPreview.css.y - 4}
              stroke="#10b981" strokeWidth={1.5} opacity={0.8}
            />
            <line
              x1={snapPreview.css.x} y1={snapPreview.css.y + 4}
              x2={snapPreview.css.x} y2={snapPreview.css.y + 12}
              stroke="#10b981" strokeWidth={1.5} opacity={0.8}
            />
            {/* Center dot */}
            <circle
              cx={snapPreview.css.x}
              cy={snapPreview.css.y}
              r={2}
              fill="#10b981"
            />
          </g>
        )}

        {/* Snap-to-close indicator: highlight first point when cursor is near */}
        {tool === 'trace' && activeTracePoints.length >= 3 && cursorPdfPos && (() => {
          const firstPt = activeTracePoints[0];
          const cssFirst = toCss(firstPt);
          const cssCursor = cursorPos;
          if (!cssCursor) return null;

          // Use CSS distance for the visual indicator (reliable)
          const dx = cssFirst.x - cssCursor.x;
          const dy = cssFirst.y - cssCursor.y;
          const cssDist = Math.sqrt(dx * dx + dy * dy);
          if (cssDist > 40) return null;

          const opacity = Math.max(0.3, 1 - cssDist / 40);
          const isSnappable = cssDist < 25;

          return (
            <>
              <circle
                cx={cssFirst.x}
                cy={cssFirst.y}
                r={12}
                fill="#f59e0b"
                fillOpacity={0.15}
                stroke="#f59e0b"
                strokeWidth={2.5}
                opacity={opacity}
              />
              {isSnappable && (
                <text
                  x={cssFirst.x}
                  y={cssFirst.y - 18}
                  textAnchor="middle"
                  fill="#f59e0b"
                  fontSize={10}
                  fontWeight={600}
                  className="select-none"
                >
                  Click to close
                </text>
              )}
            </>
          );
        })()}
      </svg>

      {/* Active trace instructions */}
      {tool === 'trace' && activeTracePoints.length === 0 && !dragPoint && (
        <div className={instructionChipClass}>
          {traceMode === 'area'
            ? 'Click to place first point of the area boundary — after that, near-horizontal and vertical moves snap to 90°'
            : `Click to place first point on a wall corner — fill side defaults to ${activeWallFillSide}, Tab flips it once you start previewing the segment, Alt places a free point`}
        </div>
      )}
      {tool === 'trace' && activeTracePoints.length >= 1 && activeTracePoints.length < (traceMode === 'area' ? 3 : 2) && !dragPoint && (
        <div className={instructionChipClass}>
          {traceMode === 'area'
            ? `Click to outline the area — near-horizontal and vertical moves snap to 90°, hold Alt to ignore snap, need at least 3 points (${activeTracePoints.length}/3)`
            : `Click along the wall perimeter — near-horizontal and vertical moves snap to 90°, the arrow shows the fill side (${activeWallFillSide}), Tab flips it, Alt ignores snap, Backspace undoes`}
        </div>
      )}
      {tool === 'trace' && activeTracePoints.length >= (traceMode === 'area' ? 3 : 2) && !dragPoint && (
        <div className={instructionChipClass}>
          {traceMode === 'area'
            ? `Keep outlining — 90° snap stays active, hold Alt to place a free point, drag points to fine-tune, double-click or Enter to close (${activeTracePoints.length} points)`
            : `Keep clicking — 90° snap stays active, Tab flips fill side (${activeWallFillSide}), hold Alt to place a free point, drag points to fine-tune, double-click or Enter to finish (${activeTracePoints.length} points)`}
        </div>
      )}
      {tool === 'pointer' && selectedTraceId && !dragPoint && (
        <div className={instructionChipClass}>
          Selected wall: drag a point to fine-tune it. Click another wall segment or endpoint to switch selection.
        </div>
      )}
      {dragPoint && (
        <div className={instructionChipClass}>
          Release to save the adjusted point.
        </div>
      )}

      {/* Auto-detect instructions */}
      {tool === 'auto_detect' && !autoDetecting && (
        <div className={instructionChipClass}>
          Click inside a room to auto-detect its boundary
        </div>
      )}
      {tool === 'auto_detect' && autoDetecting && (
        <div className={`${instructionChipClass} flex items-center gap-2`}>
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--takeoff-ink)] border-t-transparent" />
          Detecting room boundary...
        </div>
      )}
    </div>
  );
}
