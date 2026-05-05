'use client';

import type { RefObject } from 'react';
import { useTakeoffStore, type WallFillSide } from '@/lib/stores/takeoff-store';
import { getWallPreset } from '@/lib/takeoff/presets';
import type { PdfPoint, Trace } from '@/lib/types/takeoff';
import type { BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';

interface WallThicknessOverlayProps {
  viewerRef: RefObject<BlueprintViewerHandle | null>;
  pageWidth: number;
  pageHeight: number;
  defaultThicknessIn?: 4 | 6 | 8 | 10 | 12;
}

interface CanvasPoint {
  x: number;
  y: number;
}

function getWallBandPalette(thicknessIn: 4 | 6 | 8 | 10 | 12) {
  if (thicknessIn === 4) {
    return {
      activeFill: 'rgba(180, 83, 9, 0.26)',
      selectedFill: 'rgba(180, 83, 9, 0.2)',
      committedFill: 'rgba(180, 83, 9, 0.14)',
      activeStroke: 'rgba(146, 64, 14, 0.88)',
      selectedStroke: 'rgba(146, 64, 14, 0.72)',
      committedStroke: 'rgba(146, 64, 14, 0.54)',
    };
  }

  return {
    activeFill: 'rgba(127, 29, 29, 0.3)',
    selectedFill: 'rgba(127, 29, 29, 0.23)',
    committedFill: 'rgba(127, 29, 29, 0.17)',
    activeStroke: 'rgba(127, 29, 29, 0.9)',
    selectedStroke: 'rgba(127, 29, 29, 0.74)',
    committedStroke: 'rgba(127, 29, 29, 0.56)',
  };
}

function toPath(points: CanvasPoint[], close: boolean) {
  if (points.length === 0) return null;

  const commands = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`,
  );

  if (close && points.length > 2) {
    commands.push('Z');
  }

  return commands.join(' ');
}

function normalize(point: CanvasPoint) {
  const length = Math.hypot(point.x, point.y);
  if (length === 0) return null;
  return { x: point.x / length, y: point.y / length };
}

function polygonSignedArea(points: CanvasPoint[]) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function segmentNormal(
  from: CanvasPoint,
  to: CanvasPoint,
  interiorOnLeft: boolean,
) {
  const direction = normalize({ x: to.x - from.x, y: to.y - from.y });
  if (!direction) return null;

  return interiorOnLeft
    ? { x: -direction.y, y: direction.x }
    : { x: direction.y, y: -direction.x };
}

function offsetVertex(
  point: CanvasPoint,
  prevNormal: CanvasPoint,
  nextNormal: CanvasPoint,
  distance: number,
) {
  const miter = normalize({
    x: prevNormal.x + nextNormal.x,
    y: prevNormal.y + nextNormal.y,
  });

  if (!miter) {
    return {
      x: point.x + nextNormal.x * distance,
      y: point.y + nextNormal.y * distance,
    };
  }

  const projection = miter.x * nextNormal.x + miter.y * nextNormal.y;
  if (Math.abs(projection) < 0.2) {
    return {
      x: point.x + nextNormal.x * distance,
      y: point.y + nextNormal.y * distance,
    };
  }

  const scaledDistance = Math.min(distance / projection, distance * 4);
  return {
    x: point.x + miter.x * scaledDistance,
    y: point.y + miter.y * scaledDistance,
  };
}

function buildOffsetPath(
  points: CanvasPoint[],
  distance: number,
  interiorOnLeft: boolean,
  closed: boolean,
) {
  if (points.length < 2) return null;

  const segmentCount = closed ? points.length : points.length - 1;
  const normals: CanvasPoint[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const normal = segmentNormal(current, next, interiorOnLeft);
    if (!normal) return null;
    normals.push(normal);
  }

  const offsetPoints: CanvasPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];

    if (!closed && index === 0) {
      offsetPoints.push({
        x: point.x + normals[0].x * distance,
        y: point.y + normals[0].y * distance,
      });
      continue;
    }

    if (!closed && index === points.length - 1) {
      const lastNormal = normals[normals.length - 1];
      offsetPoints.push({
        x: point.x + lastNormal.x * distance,
        y: point.y + lastNormal.y * distance,
      });
      continue;
    }

    const prevNormal = normals[(index - 1 + normals.length) % normals.length];
    const nextNormal = normals[index % normals.length];
    offsetPoints.push(offsetVertex(point, prevNormal, nextNormal, distance));
  }

  return offsetPoints;
}

function buildBandGeometry(
  points: PdfPoint[],
  trace: Trace,
  toCss: (point: PdfPoint) => CanvasPoint | null,
  thicknessPx: number,
  fillSide: WallFillSide,
) {
  const cssPoints = points
    .map((point) => toCss(point))
    .filter((point): point is CanvasPoint => Boolean(point));

  if (cssPoints.length < 2) return null;

  const interiorOnLeft = trace.isClosed
    ? polygonSignedArea(cssPoints) > 0
    : fillSide === 'left';
  const innerPoints = buildOffsetPath(
    cssPoints,
    thicknessPx,
    interiorOnLeft,
    trace.isClosed,
  );

  if (!innerPoints) return null;

  if (trace.isClosed) {
    return {
      fillPath: `${toPath(cssPoints, true)} ${toPath(innerPoints, true)}`,
      fillRule: 'evenodd' as const,
      innerEdgePath: toPath(innerPoints, true),
    };
  }

  const bandPolygon = [
    ...cssPoints,
    ...innerPoints.slice().reverse(),
  ];

  return {
    fillPath: toPath(bandPolygon, true),
    fillRule: 'nonzero' as const,
    innerEdgePath: toPath(innerPoints, false),
  };
}

export function WallThicknessOverlay({
  viewerRef,
  pageWidth,
  pageHeight,
  defaultThicknessIn = 6,
}: WallThicknessOverlayProps) {
  const session = useTakeoffStore((state) => state.session);
  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const activeTraceId = useTakeoffStore((state) => state.activeTraceId);
  const activeTracePoints = useTakeoffStore((state) => state.activeTracePoints);
  const drawingPreset = useTakeoffStore((state) => state.drawingPreset);
  const getCalibration = useTakeoffStore((state) => state.getCalibration);
  const getVisibleTracesForPage = useTakeoffStore((state) => state.getVisibleTracesForPage);
  const selectedTraceId = useTakeoffStore((state) => state.selectedTraceId);
  const activeWallFillSide = useTakeoffStore((state) => state.activeWallFillSide);
  const tool = useTakeoffStore((state) => state.tool);
  const traceMode = useTakeoffStore((state) => state.traceMode);
  const wallPreset = useTakeoffStore((state) => state.wallPreset);

  const calibration = getCalibration();
  const viewer = viewerRef.current;

  if (!calibration || !viewer) {
    return null;
  }

  const wallRuns = new Map(
    (session?.wallRuns ?? []).map((wallRun) => [wallRun.id, wallRun]),
  );

  const pageTraces = getVisibleTracesForPage(activePageIndex).filter(
    (trace) => trace.type === 'linear' && trace.id !== activeTraceId,
  );

  const activeTrace =
    tool === 'trace' &&
    drawingPreset === 'wall' &&
    traceMode === 'linear' &&
    activeTraceId &&
    activeTracePoints.length > 1
      ? {
          id: activeTraceId,
          pageIndex: activePageIndex,
          type: 'linear' as const,
          points: activeTracePoints,
          isClosed: false,
          isLocked: false,
          label: 'Active wall',
        }
      : null;

  const toCss = (point: PdfPoint) => viewer.pageCoordsToCss(point.x, point.y);

  const thicknessToCss = (thicknessIn: number) => {
    const origin = viewer.pageCoordsToCss(0, 0);
    const offset = viewer.pageCoordsToCss(
      calibration.pdfPointsPerFoot * (thicknessIn / 12),
      0,
    );

    if (!origin || !offset) return 0;

    return Math.max(2, Math.abs(offset.x - origin.x));
  };

  const renderBand = (trace: Trace, isActive = false) => {
    const wallRun = wallRuns.get(trace.id);
    const thicknessIn = wallRun?.thicknessIn ?? (isActive ? getWallPreset(wallPreset).thicknessIn : defaultThicknessIn);
    const fillSide = wallRun?.fillSide ?? (isActive ? activeWallFillSide : 'left');
    const bandWidth = thicknessToCss(thicknessIn);
    const geometry = buildBandGeometry(trace.points, trace, toCss, bandWidth, fillSide);

    if (!geometry || bandWidth <= 0) {
      return null;
    }

    const isSelected = trace.id === selectedTraceId;
    const palette = getWallBandPalette(thicknessIn);
    const fillColor = isActive
      ? palette.activeFill
      : isSelected
        ? palette.selectedFill
        : palette.committedFill;
    const innerEdgeStroke = isActive
      ? palette.activeStroke
      : isSelected
        ? palette.selectedStroke
        : palette.committedStroke;

    return (
      <g key={`${trace.id}-${isActive ? 'active' : 'committed'}`}>
        <path
          d={geometry.fillPath ?? ''}
          fill={fillColor}
          fillRule={geometry.fillRule}
          style={{ pointerEvents: 'none' }}
        />
        {geometry.innerEdgePath && (
          <path
            d={geometry.innerEdgePath}
            fill="none"
            stroke={innerEdgeStroke}
            strokeWidth={Math.max(1.25, bandWidth * 0.1)}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </g>
    );
  };

  return (
    <svg
      className="absolute inset-0"
      width={pageWidth}
      height={pageHeight}
      shapeRendering="geometricPrecision"
      style={{ pointerEvents: 'none' }}
    >
      {pageTraces.map((trace) => renderBand(trace))}
      {activeTrace ? renderBand(activeTrace, true) : null}
    </svg>
  );
}
