// @ts-nocheck
'use client';

import { useRef, useState, useCallback, memo } from 'react';
import type { BBox, TakeoffRegion } from '@/lib/types/takeoff';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegionOverlayProps {
  pageWidth: number;
  pageHeight: number;
  regions: TakeoffRegion[];
  onRegionClick: (regionId: string) => void;
  onRegionDrawn: (bbox: BBox) => void;
}

interface DragState {
  startX: number; // % of SVG width
  startY: number; // % of SVG height
}

interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionShapeProps {
  region: TakeoffRegion;
  svgWidth: number;
  svgHeight: number;
  isPointerTool: boolean;
  onRegionClick: (regionId: string) => void;
}

// ─── Module-level constants (hoisted outside component) ───────────────────────

const STATUS_STYLES: Record<
  TakeoffRegion['status'],
  { fill: string; stroke: string; strokeDasharray?: string; fillOpacity: number }
> = {
  confirmed: {
    fill: '#22c55e',
    stroke: '#22c55e',
    fillOpacity: 0.15,
  },
  pending: {
    fill: '#3b82f6',
    stroke: '#3b82f6',
    strokeDasharray: '6 3',
    fillOpacity: 0.12,
  },
  analyzing: {
    fill: '#f59e0b',
    stroke: '#f59e0b',
    strokeDasharray: '6 3',
    fillOpacity: 0.12,
  },
  rejected: {
    fill: 'transparent',
    stroke: 'transparent',
    fillOpacity: 0,
  },
};

const LABEL_HEIGHT = 18;
const LABEL_FONT_SIZE = 10;
const LABEL_PADDING_X = 6;
const LABEL_CHAR_WIDTH = LABEL_FONT_SIZE * 0.6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function bboxToSvgRect(bbox: BBox, svgWidth: number, svgHeight: number) {
  return {
    x: r2((bbox.x / 100) * svgWidth),
    y: r2((bbox.y / 100) * svgHeight),
    width: r2((bbox.width / 100) * svgWidth),
    height: r2((bbox.height / 100) * svgHeight),
  };
}

function getSvgPoint(
  e: React.MouseEvent<SVGSVGElement>,
  svgEl: SVGSVGElement
): { pctX: number; pctY: number } {
  const domRect = svgEl.getBoundingClientRect();
  const pctX = ((e.clientX - domRect.left) / domRect.width) * 100;
  const pctY = ((e.clientY - domRect.top) / domRect.height) * 100;
  return {
    pctX: Math.max(0, Math.min(100, pctX)),
    pctY: Math.max(0, Math.min(100, pctY)),
  };
}

// ─── RegionShape sub-component ────────────────────────────────────────────────
// Extracted to prevent inline handlers from causing full-overlay re-renders.

const RegionShape = memo(function RegionShape({
  region,
  svgWidth,
  svgHeight,
  isPointerTool,
  onRegionClick,
}: RegionShapeProps) {
  const [isHovered, setIsHovered] = useState(false);

  const styles = STATUS_STYLES[region.status];
  const rect = bboxToSvgRect(region.bbox, svgWidth, svgHeight);

  const labelText =
    region.status === 'confirmed' && region.net_sf != null
      ? `${region.label} · ${Math.round(region.net_sf)} SF`
      : region.label;

  const labelWidth = r2(labelText.length * LABEL_CHAR_WIDTH + LABEL_PADDING_X * 2);
  const labelY = r2(Math.max(0, rect.y - LABEL_HEIGHT - 2));

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isPointerTool) {
        e.stopPropagation();
        onRegionClick(region.id);
      }
    },
    [isPointerTool, onRegionClick, region.id]
  );

  return (
    <g
      style={{ cursor: isPointerTool ? 'pointer' : 'default' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Region rectangle */}
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill={styles.fill}
        fillOpacity={isHovered ? r2(styles.fillOpacity * 1.8) : styles.fillOpacity}
        stroke={styles.stroke}
        strokeWidth={isHovered ? 2 : 1.5}
        strokeDasharray={styles.strokeDasharray}
      />

      {/* Label background */}
      <rect
        x={rect.x}
        y={labelY}
        width={labelWidth}
        height={LABEL_HEIGHT}
        rx={3}
        fill={styles.stroke}
        fillOpacity={0.85}
      />

      {/* Label text */}
      <foreignObject
        x={rect.x}
        y={labelY}
        width={labelWidth}
        height={LABEL_HEIGHT}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: `${LABEL_HEIGHT}px`,
            paddingLeft: `${LABEL_PADDING_X}px`,
            paddingRight: `${LABEL_PADDING_X}px`,
            fontSize: `${LABEL_FONT_SIZE}px`,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontWeight: 600,
            color: '#ffffff',
            whiteSpace: 'nowrap',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          {labelText}
        </div>
      </foreignObject>
    </g>
  );
});

// ─── RegionOverlay ────────────────────────────────────────────────────────────

export default function RegionOverlay({
  pageWidth,
  pageHeight,
  regions,
  onRegionClick,
  onRegionDrawn,
}: RegionOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<PreviewRect | null>(null);

  // Subscribe to tool for cursor styling (rendered value).
  // setDrawing is stable (Zustand action refs never change).
  const tool = useTakeoffStore((s) => s.tool);
  const setDrawing = useTakeoffStore((s) => s.setDrawing);

  // Keep a ref to tool so event handlers never capture stale values
  // without adding tool to every useCallback dep array (avoids re-binding
  // handlers on every tool change since they already read from the ref).
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (toolRef.current !== 'rectangle' || !svgRef.current) return;
      e.preventDefault();
      const { pctX, pctY } = getSvgPoint(e, svgRef.current);
      dragRef.current = { startX: pctX, startY: pctY };
      setDrawing(true);
      setPreview({
        x: r2((pctX / 100) * pageWidth),
        y: r2((pctY / 100) * pageHeight),
        width: 0,
        height: 0,
      });
    },
    [pageWidth, pageHeight, setDrawing]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (toolRef.current !== 'rectangle' || !dragRef.current || !svgRef.current) return;
      const { pctX, pctY } = getSvgPoint(e, svgRef.current);
      const { startX, startY } = dragRef.current;

      const x = Math.min(startX, pctX);
      const y = Math.min(startY, pctY);
      const w = Math.abs(pctX - startX);
      const h = Math.abs(pctY - startY);

      setPreview({
        x: r2((x / 100) * pageWidth),
        y: r2((y / 100) * pageHeight),
        width: r2((w / 100) * pageWidth),
        height: r2((h / 100) * pageHeight),
      });
    },
    [pageWidth, pageHeight]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (toolRef.current !== 'rectangle' || !dragRef.current || !svgRef.current) return;

      const { pctX, pctY } = getSvgPoint(e, svgRef.current);
      const { startX, startY } = dragRef.current;

      const x = Math.min(startX, pctX);
      const y = Math.min(startY, pctY);
      const width = Math.abs(pctX - startX);
      const height = Math.abs(pctY - startY);

      dragRef.current = null;
      setDrawing(false);
      setPreview(null);

      if (width > 3 && height > 3) {
        onRegionDrawn({ x, y, width, height });
      }
    },
    [setDrawing, onRegionDrawn]
  );

  const handleMouseLeave = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      setDrawing(false);
      setPreview(null);
    }
  }, [setDrawing]);

  const isPointerTool = tool === 'pointer';
  const cursor = tool === 'rectangle' ? 'crosshair' : 'default';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      className="absolute inset-0 w-full h-full"
      style={{ cursor }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {regions.map((region) =>
        region.status === 'rejected' ? null : (
          <RegionShape
            key={region.id}
            region={region}
            svgWidth={pageWidth}
            svgHeight={pageHeight}
            isPointerTool={isPointerTool}
            onRegionClick={onRegionClick}
          />
        )
      )}

      {/* Preview rectangle while drawing */}
      {preview !== null && preview.width > 0 && preview.height > 0 && (
        <rect
          x={preview.x}
          y={preview.y}
          width={preview.width}
          height={preview.height}
          fill="#3b82f6"
          fillOpacity={0.1}
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="6 3"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}
