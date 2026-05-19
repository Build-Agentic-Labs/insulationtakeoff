'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  Check,
  ChevronRight,
  Expand,
  FileSearch,
  Loader2,
  RefreshCw,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import { BlueprintViewer } from '@/components/takeoff/BlueprintViewer';
import { getReactPdfWorkerSrc } from '@/lib/pdf/pdfjs-worker';
import {
  buildPageAnalysisFromPageScores,
  getEvidenceRequirementStatuses,
} from '@/lib/takeoff/workspace-v2';
import { getPublicAnalysisError } from '@/lib/takeoff/analysis-errors';
import {
  getCachedPdfThumbnail,
  makePdfThumbnailCacheKey,
  setCachedPdfThumbnail,
} from '@/lib/takeoff/pdf-thumbnail-cache';
import type { PageScore, PageRole } from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = getReactPdfWorkerSrc();

const ROLE_ORDER: PageRole[] = ['measurement', 'evidence'];
const PREVIEW_MOTION_MS = 320;
const THUMBNAIL_MIN_HEIGHT = 170;
const THUMBNAIL_MAX_HEIGHT = 360;

interface PreviewOriginRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScheduleCropTarget {
  id: string;
  pageIndex: number;
  pageLabel: string;
  bbox: CropBox;
}

type OpeningCatalogRow = NonNullable<NonNullable<PageScore['scan_extracts']>['opening_schedule_items']>[number];

interface TakeoffAnalysisScreenProps {
  pdfUrl: string;
  documentId: string | null;
  totalPages: number;
  pageScores: PageScore[];
  isClassifying: boolean;
  classificationDone: boolean;
  classificationError: string | null;
  analysisProgress: {
    stage: string;
    message: string;
    progress: number;
    renderedPages: number;
    totalPages: number;
    detailPagesCompleted: number;
    detailPagesTotal: number;
  } | null;
  onRetryScan: () => void;
  onRetryScheduleScan: () => void;
  onAnalyzeScheduleCrop: (pageIndex: number, bbox: CropBox) => void;
  onAnalyzeScheduleCrops: (crops: Array<{ pageIndex: number; bbox: CropBox }>) => void;
  onContinue: (scores: PageScore[]) => void | Promise<void>;
}

function roleLabel(role: PageRole) {
  return role === 'measurement' ? 'Primary Takeoff' : 'Support Page';
}

function normalizeRoles(roles: PageRole[]) {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

function mergeLocalScores(
  effectivePageCount: number,
  incomingScores: PageScore[],
  existingScores: PageScore[],
): PageScore[] {
  return Array.from({ length: effectivePageCount }, (_, pageIndex) => {
    const incoming = incomingScores.find((score) => score.page_index === pageIndex);
    const existing = existingScores.find((score) => score.page_index === pageIndex);
    const nextRoles =
      existing && (existing.roles.length > 0 || existing.ai_roles.length > 0)
        ? existing.roles
        : incoming?.roles?.length
          ? incoming.roles
          : incoming?.ai_roles ?? [];

    return {
      page_index: pageIndex,
      score: incoming?.score ?? existing?.score ?? 0.5,
      label: incoming?.label ?? existing?.label ?? `Page ${pageIndex + 1}`,
      ai_selected: incoming?.ai_selected ?? existing?.ai_selected ?? false,
      page_type: incoming?.page_type ?? existing?.page_type,
      secondary_page_types: incoming?.secondary_page_types ?? existing?.secondary_page_types ?? [],
      takeoff_relevance: incoming?.takeoff_relevance ?? existing?.takeoff_relevance,
      roles: normalizeRoles(nextRoles),
      ai_roles: normalizeRoles(incoming?.ai_roles ?? existing?.ai_roles ?? []),
      scan_flags: incoming?.scan_flags ?? existing?.scan_flags,
      stop_flags: incoming?.stop_flags ?? existing?.stop_flags,
      scan_extracts: incoming?.scan_extracts ?? existing?.scan_extracts,
      scan_notes: incoming?.scan_notes ?? existing?.scan_notes,
    };
  });
}

function RoleToggle({
  role,
  active,
  onClick,
}: {
  role: PageRole;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
        active
          ? 'border-[#47644a] bg-[#47644a] text-white'
          : 'border-[#c6d0c3] bg-[#edf3ea] text-[#4d6150] hover:bg-[#e1e9dd]'
      }`}
    >
      {role === 'measurement' ? 'Primary Takeoff' : 'Support Page'}
    </button>
  );
}

function summarize(values: string[] | undefined, limit = 3) {
  if (!values?.length) return null;
  const compact = values.map(compactSignalValue);
  if (compact.length <= limit) return compact.join(', ');
  return `${compact.slice(0, limit).join(', ')} +${compact.length - limit} more`;
}

function compactSignalValue(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) return normalized;

  const labeledMatch = normalized.match(
    /\b(?:vapou?r\s+barrier|vapou?r\s+retarder|air\s+barrier|air\s+sealing|baffles?|vent(?:ing|ilation)?|soffit\s+vents?|ridge\s+vents?)\b[^.;]*/i,
  );
  const source = labeledMatch?.[0]?.trim() || normalized;
  return source.length <= 72 ? source : `${source.slice(0, 69).trim()}...`;
}

function hasExtractedSignals(page: PageScore) {
  return Boolean(
    page.scan_extracts?.r_values?.length ||
      page.scan_extracts?.insulation_types?.length ||
      page.scan_extracts?.window_sizes?.length ||
      page.scan_extracts?.opening_quantity_notes?.length ||
      page.scan_extracts?.opening_schedule_items?.length ||
      page.scan_extracts?.roof_pitches?.length ||
      page.scan_extracts?.vapor_barriers?.length ||
      page.scan_extracts?.air_barriers?.length ||
      page.scan_extracts?.baffles_or_venting?.length ||
      page.scan_extracts?.wall_framing?.length,
  );
}

function displayOpeningReviewFlags(flags: string[]) {
  const labels: Record<string, string> = {
    unit_inferred_inches: 'Units inferred as inches',
    ambiguous_units: 'Units need review',
    ambiguous_no_unit_dimension: 'Units need review',
    ambiguous_slash_dimension: 'Slash size needs review',
    unparsed_dimension: 'Size needs review',
    missing_dimension_pair: 'Missing width or height',
    missing_size: 'Missing size',
  };

  return Array.from(
    new Set(
      flags
        .filter((flag) => flag !== 'compact_code_review' && flag !== 'slash_feet_inches')
        .map((flag) => labels[flag] ?? flag.replace(/_/g, ' '))
        .filter(Boolean),
    ),
  );
}

function SignalLine({
  label,
  values,
  limit = 3,
}: {
  label: string;
  values?: string[];
  limit?: number;
}) {
  const value = summarize(values, limit);
  if (!value) return null;
  return (
    <div className="text-[11px] leading-5 text-[#47644a]" title={values?.join('\n')}>
      <span className="font-medium text-[#314634]">{label}:</span> {value}
    </div>
  );
}

function ZoneHintSummary({ page }: { page: PageScore }) {
  const zoneHints = page.scan_extracts?.zone_hints;
  if (!zoneHints) return null;

  const entries = [
    ['Exterior', zoneHints.exterior],
    ['Interior', zoneHints.interior],
    ['Attic', zoneHints.attic],
    ['Crawl', zoneHints.crawlspace],
  ] as const;

  const summaries = entries
    .map(([label, hint]) => {
      if (!hint) return null;
      const values = [
        ...(hint.r_value_details ?? hint.r_values ?? []).slice(0, 2),
        ...(hint.insulation_types ?? []).slice(0, 1),
        ...(hint.wall_framing ?? []).slice(0, 1),
        ...(hint.roof_pitches ?? []).slice(0, 1).map((pitch) => `pitch ${pitch}`),
        ...(hint.vapor_barriers ?? []).slice(0, 1).map(() => 'vapor'),
        ...(hint.air_barriers ?? []).slice(0, 1).map(() => 'air seal'),
      ];
      if (values.length === 0) return null;
      return `${label}: ${values.join(', ')}`;
    })
    .filter((value): value is string => Boolean(value));

  if (summaries.length === 0) return null;

  return (
    <div className="rounded-[12px] border border-[#d8e3d4] bg-[#f4f8f1] px-3 py-2 text-[11px] leading-5 text-[#47644a]">
      {summaries.slice(0, 3).join(' · ')}
    </div>
  );
}

function ThumbnailPreview({
  cacheScope,
  pdfUrl,
  pageNumber,
  selected,
  renderPreview = true,
  onSelect,
  onAspectRatio,
  aspectRatio,
}: {
  cacheScope: string;
  pdfUrl: string;
  pageNumber: number;
  selected: boolean;
  renderPreview?: boolean;
  onSelect: (rect: PreviewOriginRect) => void;
  onAspectRatio: (ratio: number) => void;
  aspectRatio: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailWidth, setThumbnailWidth] = useState(240);
  const [cachedThumbnail, setCachedThumbnail] = useState<string | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);
  const cacheKey = useMemo(
    () => makePdfThumbnailCacheKey(cacheScope, pageNumber, thumbnailWidth),
    [cacheScope, pageNumber, thumbnailWidth],
  );
  const reservedPreviewHeight = aspectRatio
    ? Math.max(
        THUMBNAIL_MIN_HEIGHT,
        Math.min(
          THUMBNAIL_MAX_HEIGHT,
          Math.round(thumbnailWidth / Math.max(0.35, Math.min(2.5, aspectRatio))),
        ),
      )
    : THUMBNAIL_MIN_HEIGHT;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      const nextWidth = Math.max(180, Math.floor(element.clientWidth - 8));
      setThumbnailWidth(nextWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCacheChecked(false);
    setCachedThumbnail(null);

    if (!renderPreview) {
      setCacheChecked(true);
      return () => {
        cancelled = true;
      };
    }

    getCachedPdfThumbnail(cacheKey).then((dataUrl) => {
      if (cancelled) return;
      setCachedThumbnail(dataUrl);
      setCacheChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, renderPreview]);

  const cacheRenderedThumbnail = useCallback(() => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;

    requestAnimationFrame(() => {
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        void setCachedPdfThumbnail(cacheKey, dataUrl);
      } catch {
        // A failed thumbnail cache should not affect page selection.
      }
    });
  }, [cacheKey]);

  return (
    <button
      type="button"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSelect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }}
      className={`group relative flex w-full min-h-[170px] items-center justify-center overflow-hidden rounded-[12px] border bg-white px-1 py-1 text-left transition-colors ${
        selected
          ? 'border-[#47644a] shadow-[0_0_0_2px_rgba(71,100,74,0.14)]'
          : 'border-[var(--takeoff-line)] hover:border-[#9eb29d]'
      }`}
      aria-label={`Select page ${pageNumber} preview`}
    >
      <div ref={containerRef} className="relative flex w-full items-center justify-center overflow-hidden">
        {renderPreview && cachedThumbnail ? (
          <img
            src={cachedThumbnail}
            alt={`Page ${pageNumber} preview`}
            className="block max-h-[360px] w-full object-contain"
            draggable={false}
          />
        ) : renderPreview && cacheChecked ? (
          <Page
            pageNumber={pageNumber}
            width={thumbnailWidth}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onLoadSuccess={(page) => {
              const sourceWidth =
                typeof page.originalWidth === 'number' ? page.originalWidth : page.width;
              const sourceHeight =
                typeof page.originalHeight === 'number' ? page.originalHeight : page.height;

              if (typeof sourceWidth === 'number' && typeof sourceHeight === 'number' && sourceHeight > 0) {
                onAspectRatio(sourceWidth / sourceHeight);
              }
            }}
            onRenderSuccess={cacheRenderedThumbnail}
            loading={
              <div
                className="takeoff-blueprint-loading-dots takeoff-dot-grid relative w-full overflow-hidden bg-[var(--takeoff-canvas)]"
                style={{ height: reservedPreviewHeight }}
                aria-label="Preparing preview"
              >
                <div className="takeoff-thumbnail-sheen absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent" />
              </div>
            }
          />
        ) : (
          <div
            className="takeoff-blueprint-loading-dots takeoff-dot-grid relative w-full overflow-hidden bg-[var(--takeoff-canvas)]"
            style={{ height: reservedPreviewHeight }}
            aria-label={renderPreview ? 'Checking saved preview' : 'Preparing preview'}
          >
            <div className="takeoff-thumbnail-sheen absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent" />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-[rgba(23,33,28,0.12)] bg-[rgba(255,255,255,0.92)] px-2 py-1 text-[9px] font-medium text-[var(--takeoff-text-muted)] opacity-0 shadow-[0_8px_18px_rgba(31,39,33,0.08)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Expand className="h-3 w-3" />
        Quick check
      </div>
    </button>
  );
}

function ExpandedPagePreview({
  pdfUrl,
  pageNumber,
  isClosing,
  originRect,
  initialAspectRatio,
  onClose,
}: {
  pdfUrl: string;
  pageNumber: number;
  isClosing: boolean;
  originRect: PreviewOriginRect | null;
  initialAspectRatio: number | null;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState(() => {
    if (typeof window === 'undefined') {
      return { width: 1200, height: 800 };
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  const [pageAspectRatio, setPageAspectRatio] = useState<number | null>(initialAspectRatio);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (initialAspectRatio && !pageAspectRatio) {
      setPageAspectRatio(initialAspectRatio);
    }
  }, [initialAspectRatio, pageAspectRatio]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof window === 'undefined') return;

    const updateSize = () => {
      setContainerSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();

    const raf = window.requestAnimationFrame(() => setIsVisible(true));
    window.addEventListener('resize', updateSize);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const pageWidth = useMemo(() => {
    const availableWidth = Math.max(120, containerSize.width - 32);
    const availableHeight = Math.max(120, containerSize.height - 32);

    if (!pageAspectRatio) {
      return availableWidth;
    }

    return Math.max(120, Math.min(availableWidth, availableHeight * pageAspectRatio));
  }, [containerSize.height, containerSize.width, pageAspectRatio]);

  const showPreview = isVisible && !isClosing;
  const previewHeight = pageAspectRatio ? pageWidth / pageAspectRatio : pageWidth;
  const motionStyle = useMemo(() => {
    if (!originRect) {
      return {
        transform: showPreview
          ? 'translate3d(0, 0, 0) scale(1)'
          : 'translate3d(0, 10px, 0) scale(0.985)',
        opacity: showPreview ? 1 : 0,
      };
    }

    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    const originCenterX = originRect.left + originRect.width / 2;
    const originCenterY = originRect.top + originRect.height / 2;
    const deltaX = originCenterX - viewportCenterX;
    const deltaY = originCenterY - viewportCenterY;
    const scale = Math.max(
      0.2,
      Math.min(originRect.width / Math.max(pageWidth, 1), originRect.height / Math.max(previewHeight, 1))
    );

    return {
      transform: showPreview
        ? 'translate3d(0, 0, 0) scale(1)'
        : `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scale})`,
      opacity: showPreview ? 1 : 0,
    };
  }, [originRect, pageWidth, previewHeight, showPreview]);

  return (
    <div className="fixed inset-0 z-[80] bg-transparent" onClick={onClose}>
      <div ref={containerRef} className="h-full w-full overflow-hidden px-4 py-4">
        <div className="flex h-full items-center justify-center">
          <div
            className="transform-gpu overflow-hidden rounded-[8px] border border-[rgba(23,33,28,0.12)] bg-white transition-[transform,opacity,box-shadow] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform"
            style={motionStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="relative overflow-hidden bg-white"
              style={{ width: pageWidth, height: previewHeight }}
            >
              <BlueprintViewer
                key={`expanded-preview-${pageNumber}`}
                pdfUrl={pdfUrl}
                pageNumber={pageNumber}
                cursorMode="default"
                viewportInset={0}
                workspacePadding={0}
                minScale={1}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleCropModal({
  pdfUrl,
  pageIndex,
  pages,
  onCancel,
  onAnalyzeAll,
}: {
  pdfUrl: string;
  pageIndex: number;
  pages: Array<{ pageIndex: number; label: string }>;
  onCancel: () => void;
  onAnalyzeAll: (crops: ScheduleCropTarget[]) => void | Promise<void>;
}) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropIdCounterRef = useRef(0);
  const [activePageIndex, setActivePageIndex] = useState(pageIndex);
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [savedCrops, setSavedCrops] = useState<ScheduleCropTarget[]>([]);
  const [cropMode, setCropMode] = useState(true);
  const [spacePanning, setSpacePanning] = useState(false);
  const [isParsingCrops, setIsParsingCrops] = useState(false);
  const activePage = pages.find((page) => page.pageIndex === activePageIndex) ?? {
    pageIndex: activePageIndex,
    label: `Page ${activePageIndex + 1}`,
  };
  const activePageSavedCrops = savedCrops.filter((item) => item.pageIndex === activePageIndex);
  const saveCrop = (box: CropBox) => {
    if (box.width < 4 || box.height < 4) return;
    cropIdCounterRef.current += 1;
    setSavedCrops((current) => [
      ...current,
      {
        id: `${activePageIndex}:${cropIdCounterRef.current}`,
        pageIndex: activePageIndex,
        pageLabel: activePage.label,
        bbox: { ...box },
      },
    ]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.code === 'Space' && !event.repeat) {
        setSpacePanning(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanning(false);
    };
    const handleBlur = () => setSpacePanning(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [onCancel]);

  const pointForEvent = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const drawingEnabled = cropMode && !spacePanning;

  return (
    <div className="fixed inset-0 z-[90] bg-transparent px-5 py-5">
      <button
        type="button"
        onClick={onCancel}
        disabled={isParsingCrops}
        className="absolute right-7 top-7 z-[2] flex h-8 w-8 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[16px] font-semibold leading-none text-[var(--takeoff-ink)] shadow-[0_10px_24px_rgba(0,0,0,0.12)]"
        aria-label="Close schedule selection window"
      >
        ×
      </button>
      <div className="mx-auto flex h-full max-w-[1280px] flex-col overflow-hidden rounded-[12px] border border-[rgba(255,255,255,0.16)] bg-white shadow-[0_32px_100px_rgba(0,0,0,0.28)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--takeoff-line)] px-4 py-3">
          <div>
            <div className="text-[13px] font-medium text-[var(--takeoff-ink)]">Select schedule tables</div>
            <div className="mt-0.5 text-[10px] text-[var(--takeoff-text-muted)]">
              Drag around each schedule table to add it. Hold Space to pan, then read all selected tables.
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={activePageIndex}
              onChange={(event) => {
                setActivePageIndex(Number(event.target.value));
                setCrop(null);
              }}
              className="h-8 rounded-full border border-[var(--takeoff-line)] bg-white px-3 text-[10px] font-semibold text-[var(--takeoff-ink)]"
            >
              {pages.map((page) => (
                <option key={page.pageIndex} value={page.pageIndex}>
                  {page.label || `Page ${page.pageIndex + 1}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isParsingCrops}
              onClick={() => {
                setCropMode((current) => !current);
                setCrop(null);
              }}
              className={`h-8 rounded-full border px-3 text-[10px] font-semibold ${
                cropMode
                  ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
                  : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-ink)]'
              }`}
            >
              {cropMode ? 'Select tables' : 'Pan / zoom'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isParsingCrops}
              className="h-8 shrink-0 rounded-full border border-[var(--takeoff-line-strong)] bg-white px-3 text-[10px] font-semibold text-[var(--takeoff-ink)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isParsingCrops || savedCrops.length === 0}
              onClick={() => {
                setSavedCrops((current) => current.slice(0, -1));
                setCrop(null);
              }}
              className="h-8 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
            >
              Undo
            </button>
            <button
              type="button"
              disabled={isParsingCrops || savedCrops.length === 0}
              onClick={async () => {
                if (savedCrops.length === 0) return;
                setIsParsingCrops(true);
                try {
                  await onAnalyzeAll(savedCrops);
                } finally {
                  setIsParsingCrops(false);
                }
              }}
              className="h-8 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
            >
              {isParsingCrops ? (
                <>
                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                  Reading
                </>
              ) : (
                <>Read {savedCrops.length || ''} table{savedCrops.length === 1 ? '' : 's'}</>
              )}
            </button>
          </div>
        </div>
        {savedCrops.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--takeoff-line)] bg-[rgba(246,248,242,0.74)] px-4 py-2">
            <span className="takeoff-mono text-[9px] uppercase tracking-[0.12em] text-[var(--takeoff-text-subtle)]">
              Selected tables
            </span>
            {savedCrops.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSavedCrops((current) => current.filter((cropItem) => cropItem.id !== item.id))}
                className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2 py-1 text-[8px] font-semibold text-[var(--takeoff-ink)]"
                title="Click to remove"
              >
                {index + 1}. {item.pageLabel}
              </button>
            ))}
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--takeoff-paper)]">
          {isParsingCrops && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-30 w-[min(360px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] border border-[var(--takeoff-line)] bg-white px-4 py-3 shadow-[0_18px_48px_rgba(15,16,17,0.16)]">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--takeoff-ink)]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-[var(--takeoff-ink)]">Reading schedule tables</div>
                  <div className="mt-0.5 text-[10px] text-[var(--takeoff-text-muted)]">
                    Reading {savedCrops.length} selected table{savedCrops.length === 1 ? '' : 's'}.
                  </div>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--takeoff-paper)]">
                <div className="h-full w-1/2 animate-[takeoff-progress-slide_1.2s_ease-in-out_infinite] rounded-full bg-[var(--takeoff-ink)]" />
              </div>
            </div>
          )}
          <BlueprintViewer
            key={`schedule-crop-viewer-${activePageIndex}`}
            pdfUrl={pdfUrl}
            pageNumber={activePageIndex + 1}
            cursorMode={drawingEnabled ? 'crosshair' : 'default'}
            viewportInset={0}
            workspacePadding={0}
            minScale={0.6}
          >
            {() => (
              <div className="absolute inset-0 select-none">
                <div
                  className={`absolute inset-0 z-10 ${drawingEnabled && !isParsingCrops ? 'pointer-events-auto' : 'pointer-events-none'}`}
                  onPointerDown={(event) => {
                    if (!drawingEnabled || isParsingCrops) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const point = pointForEvent(event);
                    dragStartRef.current = point;
                    setCrop({ x: point.x, y: point.y, width: 0, height: 0 });
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const start = dragStartRef.current;
                    if (!drawingEnabled || isParsingCrops || !start) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const point = pointForEvent(event);
                    setCrop({
                      x: Math.min(start.x, point.x),
                      y: Math.min(start.y, point.y),
                      width: Math.abs(point.x - start.x),
                      height: Math.abs(point.y - start.y),
                    });
                  }}
                  onPointerUp={(event) => {
                    if (!drawingEnabled || isParsingCrops) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const start = dragStartRef.current;
                    const point = pointForEvent(event);
                    if (start) {
                      saveCrop({
                        x: Math.min(start.x, point.x),
                        y: Math.min(start.y, point.y),
                        width: Math.abs(point.x - start.x),
                        height: Math.abs(point.y - start.y),
                      });
                    }
                    dragStartRef.current = null;
                    setCrop(null);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  onPointerCancel={(event) => {
                    dragStartRef.current = null;
                    setCrop(null);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                />
                <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible">
                  {activePageSavedCrops.map((item) => {
                    const cropNumber = savedCrops.findIndex((saved) => saved.id === item.id) + 1;
                    return (
                      <g key={item.id}>
                        <rect
                          x={`${item.bbox.x}%`}
                          y={`${item.bbox.y}%`}
                          width={`${item.bbox.width}%`}
                          height={`${item.bbox.height}%`}
                          fill="rgba(49,95,58,0.14)"
                          stroke="#315f3a"
                          strokeWidth="2"
                        />
                        <rect
                          x={`${item.bbox.x + 0.4}%`}
                          y={`${item.bbox.y + 0.4}%`}
                          width="18"
                          height="14"
                          rx="7"
                          fill="#315f3a"
                        />
                        <text
                          x={`${item.bbox.x + 1.3}%`}
                          y={`${item.bbox.y + 1.9}%`}
                          fill="white"
                          fontSize="10"
                          fontWeight="700"
                          dominantBaseline="middle"
                        >
                          {cropNumber}
                        </text>
                      </g>
                    );
                  })}
                  {crop && (
                    <rect
                      x={`${crop.x}%`}
                      y={`${crop.y}%`}
                      width={`${crop.width}%`}
                      height={`${crop.height}%`}
                      fill="rgba(29,78,216,0.14)"
                      stroke="#1d4ed8"
                      strokeWidth="2"
                    />
                  )}
                </svg>
              </div>
            )}
          </BlueprintViewer>
        </div>
      </div>
    </div>
  );
}

function OpeningCatalogModal({
  rows,
  onClose,
}: {
  rows: OpeningCatalogRow[];
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] bg-[rgba(16,22,18,0.22)] px-5 py-5">
      <div className="mx-auto flex h-full max-w-[1120px] flex-col overflow-hidden rounded-[14px] border border-[rgba(23,33,28,0.14)] bg-white shadow-[0_32px_100px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--takeoff-line)] px-5 py-4">
          <div>
            <div className="text-[15px] font-semibold text-[var(--takeoff-ink)]">Opening catalog</div>
            <div className="mt-1 text-[11px] leading-4 text-[var(--takeoff-text-muted)]">
              Window and door schedule rows captured from the selected plan sheets.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="takeoff-mono rounded-full border border-[#c6d0c3] bg-[#edf3ea] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#47644a]">
              {rows.length} row{rows.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white text-[16px] font-semibold leading-none text-[var(--takeoff-ink)]"
              aria-label="Close opening catalog"
            >
              ×
            </button>
          </div>
        </div>
        <div className="takeoff-hide-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--takeoff-paper)] p-4">
          <div className="overflow-hidden rounded-[12px] border border-[var(--takeoff-line)] bg-white">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-[rgba(246,248,242,0.96)]">
                <tr className="takeoff-mono border-b border-[var(--takeoff-line)] text-[8px] uppercase tracking-[0.14em] text-[var(--takeoff-text-subtle)]">
                  <th className="px-3 py-2 font-semibold">Tag</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Size</th>
                  <th className="px-3 py-2 font-semibold">Room</th>
                  <th className="px-3 py-2 font-semibold">Schedule Type</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Confidence</th>
                  <th className="px-3 py-2 font-semibold">Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const reviewFlags = displayOpeningReviewFlags(item.reviewFlags);
                  return (
                    <tr
                      key={`${item.openingType}:${item.tagNormalized}:${item.sourcePageIndex ?? 'page'}:${item.rawSize}`}
                      className="border-b border-[var(--takeoff-line)] last:border-b-0"
                    >
                      <td className="takeoff-mono px-3 py-2 text-[11px] font-semibold text-[var(--takeoff-ink)]">
                        {item.tagNormalized || item.tag}
                      </td>
                      <td className="px-3 py-2">
                        <span className="takeoff-mono rounded-full border border-[#c6d0c3] bg-[#edf3ea] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#47644a]">
                          {item.openingType}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[var(--takeoff-ink)]">
                        {item.rawSize || 'No size read'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[var(--takeoff-text-muted)]">
                        {item.room || '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[var(--takeoff-text-muted)]">
                        {item.scheduleType || '—'}
                      </td>
                      <td className="takeoff-mono px-3 py-2 text-[9px] text-[var(--takeoff-text-subtle)]">
                        {item.sourcePageIndex !== undefined ? `Page ${item.sourcePageIndex + 1}` : 'Source'}
                      </td>
                      <td className="takeoff-mono px-3 py-2 text-[9px] text-[var(--takeoff-text-subtle)]">
                        {Math.round(item.confidence * 100)}%
                      </td>
                      <td className="px-3 py-2 text-[10px] leading-4 text-[var(--takeoff-warning)]">
                        {reviewFlags.length > 0 ? reviewFlags.join(', ') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function pageIsPending(page: PageScore) {
  const genericName = (page.label ?? '').trim().toLowerCase() === `page ${page.page_index + 1}`.toLowerCase();
  const hasSignals =
    page.roles.length > 0 ||
    Boolean(page.scan_notes?.length) ||
    Object.values(page.scan_flags ?? {}).some(Boolean) ||
    Object.values(page.stop_flags ?? {}).some(Boolean) ||
    hasExtractedSignals(page);

  return page.page_type === 'other' && genericName && !hasSignals;
}

function AnalysisPageCard({
  cacheScope,
  pdfUrl,
  page,
  pending,
  selectedForPreview,
  renderThumbnail = true,
  onSelectPreview,
  onAspectRatio,
  aspectRatio,
  onToggleRole,
  onClearRoles,
}: {
  cacheScope: string;
  pdfUrl: string;
  page: PageScore;
  pending: boolean;
  selectedForPreview: boolean;
  renderThumbnail?: boolean;
  onSelectPreview: (pageIndex: number, rect: PreviewOriginRect) => void;
  onAspectRatio: (pageIndex: number, ratio: number) => void;
  aspectRatio: number | null;
  onToggleRole: (pageIndex: number, role: PageRole) => void;
  onClearRoles: (pageIndex: number) => void;
}) {
  const hasAiSuggestion = page.ai_roles.length > 0;
  const selectionSummary =
    page.roles.length > 0 ? page.roles.map(roleLabel).join(' + ') : 'Not selected yet';

  return (
    <div
      className={`relative overflow-hidden rounded-[18px] border bg-white shadow-[0_14px_30px_rgba(31,39,33,0.08)] ${
        pending
          ? 'takeoff-ai-card-glow border-[#d8c08a]'
          : 'border-[var(--takeoff-line)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--takeoff-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--takeoff-ink)]">
            {page.label || `Page ${page.page_index + 1}`}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--takeoff-text-subtle)]">
            Page {page.page_index + 1}
            {page.page_type ? ` · ${page.page_type.replace(/_/g, ' ')}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {pending ? (
            <span className="takeoff-mono rounded-full border border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--takeoff-warning)]">
              Scanning
            </span>
          ) : hasAiSuggestion ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#bfd0be] bg-[#edf5e8] px-2 py-0.5 text-[9px] font-medium text-[#47644a]">
              <Sparkles className="h-2.5 w-2.5" />
              AI selected
            </span>
          ) : page.roles.length > 0 ? (
            <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--takeoff-text-subtle)]">
              Manual
            </span>
          ) : (
            <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--takeoff-text-subtle)]">
              Not used yet
            </span>
          )}
        </div>
      </div>

      <div className="relative bg-[var(--takeoff-paper)] p-3">
        <ThumbnailPreview
          cacheScope={cacheScope}
          pdfUrl={pdfUrl}
          pageNumber={page.page_index + 1}
          selected={selectedForPreview}
          renderPreview={renderThumbnail}
          onSelect={(rect) => onSelectPreview(page.page_index, rect)}
          onAspectRatio={(ratio) => onAspectRatio(page.page_index, ratio)}
          aspectRatio={aspectRatio}
        />
        {pending && (
          <div className="pointer-events-none absolute inset-3 rounded-[12px] border border-[#d4a843]/25 shadow-[inset_0_0_32px_rgba(212,168,67,0.1)]" />
        )}
      </div>

      <div className="space-y-1 px-4 pb-4">
        {pending && (
          <div className="text-[11px] text-[var(--takeoff-warning)]">
            Waiting on model output for this page…
          </div>
        )}
        {page.scan_notes?.[0] && (
          <div className="text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
            {page.scan_notes[0]}
          </div>
        )}
        {!hasAiSuggestion && page.roles.length > 0 && (
          <div className="rounded-[12px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
            Added manually: {selectionSummary}
          </div>
        )}
        <ZoneHintSummary page={page} />
        <SignalLine label="R-values" values={page.scan_extracts?.r_values} limit={4} />
        <SignalLine label="Insulation" values={page.scan_extracts?.insulation_types} limit={3} />
        <SignalLine label="Roof pitch" values={page.scan_extracts?.roof_pitches} limit={3} />
        <SignalLine label="Vapor" values={page.scan_extracts?.vapor_barriers} limit={2} />
        <SignalLine label="Air barrier" values={page.scan_extracts?.air_barriers} limit={2} />
        <SignalLine label="Baffles / venting" values={page.scan_extracts?.baffles_or_venting} limit={2} />
        <SignalLine label="Window sizes" values={page.scan_extracts?.window_sizes} limit={3} />
        <SignalLine label="Opening hints" values={page.scan_extracts?.opening_quantity_notes} limit={2} />
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--takeoff-line)] pt-3">
          <div className="w-full text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--takeoff-text-subtle)]">
            Use for takeoff
          </div>
          <RoleToggle
            role="measurement"
            active={page.roles.includes('measurement')}
            onClick={() => onToggleRole(page.page_index, 'measurement')}
          />
          <RoleToggle
            role="evidence"
            active={page.roles.includes('evidence')}
            onClick={() => onToggleRole(page.page_index, 'evidence')}
          />
          <button
            onClick={() => onClearRoles(page.page_index)}
            className="rounded-full border border-[#c6d0c3] bg-[#edf3ea] px-2.5 py-1 text-[10px] font-medium text-[#4d6150] transition-colors hover:bg-[#e1e9dd]"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function VisionPageSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-white shadow-[0_14px_30px_rgba(31,39,33,0.06)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--takeoff-line)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="h-3 w-3/5 animate-pulse rounded-full bg-[#dfe7dc]" />
              <div className="mt-2 h-2 w-1/3 animate-pulse rounded-full bg-[#e8eee4]" />
            </div>
            <div className="h-5 w-16 animate-pulse rounded-full bg-[#edf3ea]" />
          </div>
          <div className="bg-[var(--takeoff-paper)] p-3">
            <div className="takeoff-blueprint-loading-dots takeoff-dot-grid flex h-[180px] items-center justify-center rounded-[12px] border border-[var(--takeoff-line)] bg-[var(--takeoff-canvas)]">
              <div className="h-16 w-24 animate-pulse rounded-[8px] border border-[#d8e1d4] bg-white/70" />
            </div>
          </div>
          <div className="space-y-2 px-4 pb-4">
            <div className="h-2.5 w-full animate-pulse rounded-full bg-[#e5ece1]" />
            <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-[#edf3ea]" />
            <div className="mt-3 flex gap-2 border-t border-[var(--takeoff-line)] pt-3">
              <div className="h-6 w-24 animate-pulse rounded-full bg-[#e5ece1]" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-[#edf3ea]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TakeoffAnalysisScreen({
  pdfUrl,
  documentId,
  totalPages,
  pageScores,
  isClassifying,
  classificationDone,
  classificationError,
  analysisProgress,
  onRetryScan,
  onRetryScheduleScan,
  onAnalyzeScheduleCrop,
  onAnalyzeScheduleCrops,
  onContinue,
}: TakeoffAnalysisScreenProps) {
  const [localPageScores, setLocalPageScores] = useState<PageScore[]>([]);
  const [selectedPreviewPage, setSelectedPreviewPage] = useState<number | null>(null);
  const [expandedPreviewPage, setExpandedPreviewPage] = useState<number | null>(null);
  const [expandedPreviewClosing, setExpandedPreviewClosing] = useState(false);
  const [previewOriginRect, setPreviewOriginRect] = useState<PreviewOriginRect | null>(null);
  const [previewAspectRatios, setPreviewAspectRatios] = useState<Record<number, number>>({});
  const [openingCatalogModalOpen, setOpeningCatalogModalOpen] = useState(false);
  const [scheduleCropPageIndex, setScheduleCropPageIndex] = useState<number | null>(null);
  const [isContinuingToZones, setIsContinuingToZones] = useState(false);
  const closePreviewTimeoutRef = useRef<number | null>(null);

  const effectivePageCount = totalPages || pageScores.length;

  useEffect(() => {
    if (effectivePageCount === 0) return;
    setLocalPageScores((prev) => mergeLocalScores(effectivePageCount, pageScores, prev));
  }, [effectivePageCount, pageScores]);

  useEffect(() => {
    if (selectedPreviewPage !== null && selectedPreviewPage < effectivePageCount) return;
    if (effectivePageCount > 0) {
      setSelectedPreviewPage(0);
    }
  }, [effectivePageCount, selectedPreviewPage]);

  const effectiveScores = useMemo(
    () =>
      localPageScores.length
        ? localPageScores
        : mergeLocalScores(effectivePageCount, pageScores, []),
    [effectivePageCount, localPageScores, pageScores]
  );

  const selectedPages = effectiveScores.filter((page) => page.roles.length > 0);
  const measurementPages = selectedPages.filter((page) => page.roles.includes('measurement'));
  const evidencePages = selectedPages.filter((page) => page.roles.includes('evidence'));
  const aiSelectedPages = effectiveScores.filter((page) => page.ai_roles.length > 0);
  const pageAnalysis = buildPageAnalysisFromPageScores({
    totalPages: effectivePageCount,
    pageScores: effectiveScores,
  });
  const evidenceStatuses = getEvidenceRequirementStatuses(pageAnalysis);
  const requiredGaps = evidenceStatuses.filter(
    (status) => status.severity === 'required' && !status.satisfied
  );
  const analyzedPages = effectiveScores.filter((page) => page.label || page.page_type);
  const displayPages = (effectiveScores.length > 0 ? effectiveScores : analyzedPages).slice(
    0,
    effectivePageCount || analyzedPages.length
  );
  const blockingPages = effectiveScores.filter((page) =>
    Object.values(page.stop_flags ?? {}).some(Boolean)
  );
  const detailExtractPages = effectiveScores.filter(hasExtractedSignals);
  const openingScheduleRows = pageAnalysis.flatMap(
    (page) => page.scanExtracts?.opening_schedule_items ?? [],
  );
  const openingCatalogRows = [...openingScheduleRows].sort((left, right) => {
    if (left.openingType !== right.openingType) {
      return left.openingType === 'window' ? -1 : 1;
    }
    return left.tagNormalized.localeCompare(right.tagNormalized, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
  const openingSchedulePageIndexes = useMemo(
    () =>
      new Set(
        openingScheduleRows
          .map((row) => row.sourcePageIndex)
          .filter((pageIndex): pageIndex is number => typeof pageIndex === 'number'),
      ),
    [openingScheduleRows],
  );
  const openingTagsOnlyPages = pageAnalysis.filter(
    (page) => page.roles.includes('measurement') && page.scanExtracts?.opening_evidence === 'tags_only',
  );
  const openingUnlabeledPages = pageAnalysis.filter(
    (page) =>
      page.roles.includes('measurement') &&
      (page.scanExtracts?.opening_evidence === 'unlabeled' ||
        page.scanExtracts?.opening_evidence === 'no_opening_evidence'),
  );
  const openingScheduleSamples = openingScheduleRows
    .slice(0, 5)
    .map((item) => item.tagNormalized)
    .filter(Boolean);
  const scheduleCropPage =
    scheduleCropPageIndex !== null
      ? (displayPages.find((page) => page.page_index === scheduleCropPageIndex) ?? null)
      : null;
  const scheduleCropPages = displayPages
    .filter((page) =>
      page.page_type === 'schedule' || openingSchedulePageIndexes.has(page.page_index),
    )
    .map((page) => ({
      pageIndex: page.page_index,
      label: page.label || `Page ${page.page_index + 1}`,
    }));
  const firstSchedulePageIndex =
    pageAnalysis.find((page) => page.pageType === 'schedule')?.pageIndex ??
    openingScheduleRows.find((row) => row.sourcePageIndex !== undefined)?.sourcePageIndex ??
    null;
  const displayRequirementLabels: Record<string, string> = {
    measurement_page: 'Primary takeoff page',
    wall_height_reference: 'Sections / elevations',
    insulation_details: 'Insulation details / specs',
    roof_pitch_reference: 'Roof pitch',
    vapor_barrier_reference: 'Vapor / air barrier',
    opening_schedule: 'Opening schedule',
  };
  const thumbnailCacheScope = documentId ? `document:${documentId}` : `url:${pdfUrl.split('#')[0]?.split('?')[0] ?? pdfUrl}`;
  const renderPageCards = (renderThumbnails: boolean) => (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {displayPages.map((page) => (
        <AnalysisPageCard
          key={page.page_index}
          cacheScope={thumbnailCacheScope}
          pdfUrl={pdfUrl}
          page={page}
          pending={isClassifying && pageIsPending(page)}
          selectedForPreview={selectedPreviewPage === page.page_index}
          renderThumbnail={renderThumbnails}
          onSelectPreview={(pageIndex, rect) => {
            setSelectedPreviewPage(pageIndex);
            setPreviewOriginRect(rect);
          }}
          onAspectRatio={(pageIndex, ratio) => {
            setPreviewAspectRatios((prev) =>
              prev[pageIndex] === ratio ? prev : { ...prev, [pageIndex]: ratio }
            );
          }}
          aspectRatio={previewAspectRatios[page.page_index] ?? null}
          onToggleRole={toggleRole}
          onClearRoles={clearRoles}
        />
      ))}
    </div>
  );

  const toggleRole = useCallback((pageIndex: number, role: PageRole) => {
    setLocalPageScores((prev) =>
      prev.map((score) =>
        score.page_index === pageIndex
          ? {
              ...score,
              roles: normalizeRoles(
                score.roles.includes(role)
                  ? score.roles.filter((currentRole) => currentRole !== role)
                  : [...score.roles, role]
              ),
            }
          : score
      )
    );
  }, []);

  const clearRoles = useCallback((pageIndex: number) => {
    setLocalPageScores((prev) =>
      prev.map((score) =>
        score.page_index === pageIndex ? { ...score, roles: [] } : score
      )
    );
  }, []);

  const closeExpandedPreview = useCallback(() => {
    if (expandedPreviewPage === null || expandedPreviewClosing) return;
    setExpandedPreviewClosing(true);

    if (closePreviewTimeoutRef.current !== null) {
      window.clearTimeout(closePreviewTimeoutRef.current);
    }

    closePreviewTimeoutRef.current = window.setTimeout(() => {
      setExpandedPreviewPage(null);
      setExpandedPreviewClosing(false);
      closePreviewTimeoutRef.current = null;
    }, PREVIEW_MOTION_MS);
  }, [expandedPreviewClosing, expandedPreviewPage]);

  useEffect(() => {
    return () => {
      if (closePreviewTimeoutRef.current !== null) {
        window.clearTimeout(closePreviewTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isTypingTarget) return;

      if (event.key === 'Escape' && expandedPreviewPage !== null) {
        event.preventDefault();
        closeExpandedPreview();
        return;
      }

      if (event.code === 'Space' && expandedPreviewPage !== null) {
        event.preventDefault();
        closeExpandedPreview();
        return;
      }

      if (event.code === 'Space' && selectedPreviewPage !== null && expandedPreviewPage === null) {
        event.preventDefault();
        const selectedPage = displayPages.find((page) => page.page_index === selectedPreviewPage);
        const selectedIsSchedule =
          selectedPage?.page_type === 'schedule' ||
          (selectedPage ? openingSchedulePageIndexes.has(selectedPage.page_index) : false);
        if (selectedIsSchedule) {
          setScheduleCropPageIndex(selectedPreviewPage);
          return;
        }
        setExpandedPreviewClosing(false);
        setExpandedPreviewPage(selectedPreviewPage);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeExpandedPreview, displayPages, expandedPreviewPage, openingSchedulePageIndexes, selectedPreviewPage]);

  const stepOrder = [
    'loading_pdf',
    'rendering_pages',
    'classifying_pages',
    'extracting_details',
    'finalizing',
    'complete',
  ];

  function stepState(step: 'loading_pdf' | 'rendering_pages' | 'classifying_pages' | 'extracting_details' | 'finalizing') {
    if (classificationError || analysisProgress?.stage === 'failed') return 'failed' as const;
    const currentIndex = stepOrder.indexOf((analysisProgress?.stage as string) || 'idle');
    const targetIndex = stepOrder.indexOf(step);
    if (analysisProgress?.stage === 'complete') return 'complete' as const;
    if (currentIndex > targetIndex) return 'complete' as const;
    if (currentIndex === targetIndex) return 'active' as const;
    return 'pending' as const;
  }

  const progressValue = Math.max(0, Math.min(100, analysisProgress?.progress ?? 0));
  const progressMessage = classificationError
    ? getPublicAnalysisError(classificationError)
    : analysisProgress?.message ?? 'Preparing vision analysis';
  const isReadingOpeningTables =
    isClassifying &&
    !classificationError &&
    analysisProgress?.stage === 'extracting_details' &&
    /schedule|table|opening/i.test(analysisProgress.message);
  const showLoadingStatus = isClassifying && !classificationError && !isReadingOpeningTables;
  const showCompletedReview =
    classificationDone && !classificationError && (!isClassifying || isReadingOpeningTables);
  const renderedSummary =
    analysisProgress?.totalPages
      ? `${analysisProgress.renderedPages}/${analysisProgress.totalPages}`
      : `${totalPages || pageScores.length}`;
  const detailSummary =
    analysisProgress?.detailPagesTotal
      ? `${analysisProgress.detailPagesCompleted}/${analysisProgress.detailPagesTotal}`
      : detailExtractPages.length > 0
        ? `${detailExtractPages.length}`
        : '0';

  return (
    <div className="takeoff-shell takeoff-light-theme flex h-full bg-[radial-gradient(circle_at_top,rgba(233,239,229,0.7),rgba(248,249,245,0.95)_58%,rgba(250,250,247,1)_100%)] px-4 py-4 sm:px-6">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] p-4 shadow-[0_28px_80px_rgba(35,44,34,0.08)] backdrop-blur-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--takeoff-line)] pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-medium tracking-[-0.035em] text-[var(--takeoff-ink)]">
                {isClassifying
                  ? 'Scanning plan set'
                  : classificationError
                    ? 'Vision scan failed'
                    : 'Review detected pages'}
              </h2>
              <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--takeoff-text-subtle)]">
                Step 1
              </span>
            </div>
            {(showLoadingStatus || classificationError) && (
              <div className="mt-1 max-w-[44rem] truncate text-[12px] text-[var(--takeoff-text-muted)]">
                {progressMessage}
              </div>
            )}
          </div>

          <div className="takeoff-mono flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--takeoff-text-subtle)]">
            <span className="rounded-full border border-[var(--takeoff-line)] bg-white px-2 py-1">
              {effectivePageCount} pages
            </span>
            <span className="rounded-full border border-[var(--takeoff-line)] bg-white px-2 py-1">
              {aiSelectedPages.length} selected
            </span>
            <span className="rounded-full border border-[var(--takeoff-line)] bg-white px-2 py-1">
              {detailExtractPages.length} details
            </span>
            <button
              type="button"
              onClick={onRetryScan}
              disabled={isClassifying}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--takeoff-line-strong)] bg-white px-2.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--takeoff-ink)] transition-colors hover:border-[#9eb29d] hover:bg-[var(--takeoff-paper)] disabled:cursor-wait disabled:border-[var(--takeoff-line)] disabled:text-[var(--takeoff-text-subtle)]"
            >
              <RefreshCw className={`h-3 w-3 ${isClassifying ? 'animate-spin' : ''}`} />
              {isClassifying ? 'Scanning' : classificationError ? 'Retry scan' : 'Rerun vision'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(246,248,242,0.85)] p-4"
            data-tour="vision-page-cards"
          >
            <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--takeoff-ink)]">
              <FileSearch className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
              Detected page set
            </div>

            <div className="takeoff-hide-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {displayPages.length > 0 ? (
                <Document
                  file={pdfUrl}
                  loading={renderPageCards(false)}
                  error={renderPageCards(false)}
                >
                  <>
                    {renderPageCards(true)}

                    {expandedPreviewPage !== null && (
                      <ExpandedPagePreview
                        pdfUrl={pdfUrl}
                        pageNumber={expandedPreviewPage + 1}
                        isClosing={expandedPreviewClosing}
                        originRect={previewOriginRect}
                        initialAspectRatio={previewAspectRatios[expandedPreviewPage] ?? null}
                        onClose={closeExpandedPreview}
                      />
                    )}
                  </>
                </Document>
              ) : (
                classificationError ? (
                  <div className="rounded-[14px] border border-dashed border-[var(--takeoff-line)] bg-white px-4 py-5 text-[12px] text-[var(--takeoff-text-muted)]">
                    Vision analysis failed: {progressMessage}
                  </div>
                ) : (
                  <VisionPageSkeletonGrid count={Math.min(6, Math.max(3, effectivePageCount || totalPages || 6))} />
                )
              )}
            </div>
          </div>

          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-white"
            data-tour="vision-ai-review"
          >
            <div className="border-b border-[var(--takeoff-line)] px-3 py-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--takeoff-ink)]">
                <ScanSearch className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
                {showLoadingStatus
                  ? 'Analysis status'
                  : classificationError
                    ? 'Analysis issue'
                    : 'Vision review'}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
              <div
                className={
                  showCompletedReview
                    ? 'takeoff-hide-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1'
                    : 'takeoff-hide-scrollbar min-h-0 flex-1 overflow-y-auto pr-1'
                }
              >
                {showLoadingStatus ? (
                  <>
                    <div className="rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">
                          Vision scan in progress
                        </div>
                        <div className="takeoff-mono text-[10px] text-[var(--takeoff-text-subtle)]">
                          {progressValue}%
                        </div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgba(23,33,28,0.08)]">
                        <div
                          className="h-full rounded-full bg-[var(--takeoff-ink)] transition-[width] duration-500"
                          style={{ width: `${progressValue}%` }}
                        />
                      </div>
                      <div className="mt-2 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                        {progressMessage}
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {[
                        {
                          key: 'loading_pdf' as const,
                          label: 'Open the PDF and count pages',
                          detail: `${totalPages || analysisProgress?.totalPages || pageScores.length || 0} pages detected`,
                        },
                        {
                          key: 'rendering_pages' as const,
                          label: 'Render page previews for the model',
                          detail: `${renderedSummary} previews prepared`,
                        },
                        {
                          key: 'classifying_pages' as const,
                          label: 'Classify titles, roles, and support pages',
                          detail: 'Sheet names, primary pages, and support-page roles',
                        },
                        {
                          key: 'extracting_details' as const,
                          label: 'Extract detail-sheet specs and opening hints',
                          detail:
                            analysisProgress?.detailPagesTotal
                              ? `${detailSummary} targeted detail pages processed`
                              : 'Only runs on pages likely to contain specs or schedules',
                        },
                        {
                          key: 'finalizing' as const,
                          label: 'Build the review-ready page set',
                          detail: 'Preparing the validation view',
                        },
                      ].map((item) => {
                        const status = stepState(item.key);
                        return (
                          <div
                            key={item.key}
                            className="flex items-center gap-3 rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-3"
                          >
                            {status === 'active' ? (
                              <Loader2 className="h-4 w-4 animate-spin text-[var(--takeoff-warning)]" />
                            ) : status === 'complete' ? (
                              <Check className="h-4 w-4 text-[var(--takeoff-ink)]" />
                            ) : status === 'failed' ? (
                              <div className="h-2.5 w-2.5 rounded-full bg-[var(--takeoff-warning)]" />
                            ) : (
                              <div className="h-2.5 w-2.5 rounded-full bg-[var(--takeoff-line)]" />
                            )}
                            <div className="min-w-0">
                              <div className="text-[12px] text-[var(--takeoff-ink)]">{item.label}</div>
                              <div className="mt-0.5 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                                {item.detail}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : classificationError ? (
                  <div className="rounded-[14px] border border-[var(--takeoff-warning)]/35 bg-[rgba(212,168,67,0.08)] px-4 py-4">
                    <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">Analysis failed</div>
                    <p className="mt-2 text-[12px] leading-6 text-[var(--takeoff-text-muted)]">
                      {progressMessage}
                    </p>
                  </div>
                ) : showCompletedReview ? (
                  <div className="rounded-[12px] border border-[#d6e2d1] bg-[#f5f9f2] px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-medium text-[var(--takeoff-ink)]">
                        Vision results ready
                      </div>
                      <span className="takeoff-mono rounded-full border border-[#bfd0be] bg-[#edf5e8] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#47644a]">
                        Review mode
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                      The model has finished scanning the plan set. Review the suggested page roles, adjust anything that looks wrong, and continue once the primary takeoff and support pages look right.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <div className="rounded-[10px] border border-[var(--takeoff-line)] bg-white px-2.5 py-1.5">
                        <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Primary</div>
                        <div className="takeoff-mono mt-0.5 text-[13px] text-[var(--takeoff-ink)]">{measurementPages.length}</div>
                      </div>
                      <div className="rounded-[10px] border border-[var(--takeoff-line)] bg-white px-2.5 py-1.5">
                        <div className="takeoff-label text-[8px] text-[var(--takeoff-text-subtle)]">Support</div>
                        <div className="takeoff-mono mt-0.5 text-[13px] text-[var(--takeoff-ink)]">{evidencePages.length}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {blockingPages.length > 0 && (
                  <div className={`${showCompletedReview ? '' : 'mt-5'} rounded-[12px] border border-[var(--takeoff-warning)]/35 bg-[rgba(212,168,67,0.08)] px-3 py-3`}>
                    <div className="text-[10px] font-medium text-[var(--takeoff-ink)]">
                      Potential stop conditions detected
                    </div>
                    <p className="mt-1.5 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                      {blockingPages.length} page{blockingPages.length === 1 ? '' : 's'} may be missing critical insulation-takeoff inputs or show conflicting information.
                    </p>
                  </div>
                )}

                {(openingTagsOnlyPages.length > 0 ||
                  openingUnlabeledPages.length > 0 ||
                  openingScheduleRows.length > 0 ||
                  isReadingOpeningTables) && (
                  <div className={`${showCompletedReview ? '' : 'mt-3'} rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 py-3`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-medium text-[var(--takeoff-ink)]">
                          Opening catalog
                        </div>
                        <div className="mt-1 text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                          {openingTagsOnlyPages.length > 0
                            ? 'Floor plan uses opening tags but no dimensions. Window/Door schedule required.'
                            : openingUnlabeledPages.length > 0
                              ? 'Openings need estimator review because labels or dimensions were not reliable.'
                              : 'Opening schedule found.'}
                        </div>
                      </div>
                    </div>
                    {isReadingOpeningTables && (
                      <div className="mt-2 rounded-[10px] border border-[#d8e3d4] bg-[#f4f8f1] px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#47644a]" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-medium text-[var(--takeoff-ink)]">
                              Reading selected tables
                            </div>
                            <div className="mt-0.5 text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                              {progressMessage}
                            </div>
                          </div>
                          <span className="takeoff-mono text-[9px] text-[var(--takeoff-text-subtle)]">
                            {progressValue}%
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                          <div
                            className="h-full rounded-full bg-[#47644a] transition-[width] duration-500"
                            style={{ width: `${progressValue}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {openingScheduleSamples.length > 0 ? (
                        <div className="takeoff-mono text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                          Sample tags: {openingScheduleSamples.join(', ')}
                        </div>
                      ) : (
                        <div className="takeoff-mono text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                          No schedule rows extracted yet.
                        </div>
                      )}
                      {(openingCatalogRows.length > 0 || firstSchedulePageIndex !== null) && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (firstSchedulePageIndex !== null) {
                                setScheduleCropPageIndex(firstSchedulePageIndex);
                              } else {
                                onRetryScheduleScan();
                              }
                            }}
                            disabled={isClassifying}
                            className="takeoff-mono inline-flex items-center gap-1 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--takeoff-ink)] disabled:cursor-wait disabled:text-[var(--takeoff-text-subtle)]"
                          >
                            <Expand className="h-3 w-3" />
                            Select
                          </button>
                          {openingCatalogRows.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setOpeningCatalogModalOpen(true)}
                              className="takeoff-mono inline-flex items-center gap-1 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--takeoff-ink)]"
                            >
                              View
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className={`${showCompletedReview ? '' : 'mt-3'} rounded-[12px] border border-[var(--takeoff-line)] bg-[rgba(246,248,242,0.78)] px-3 py-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium text-[var(--takeoff-ink)]">
                      Support coverage
                    </div>
                    <div className="takeoff-mono text-[9px] text-[var(--takeoff-text-subtle)]">
                      {requiredGaps.length === 0
                        ? 'Ready'
                        : `${requiredGaps.length} required gap${requiredGaps.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {evidenceStatuses.map((status) => (
                      <div
                        key={status.requirement}
                        className="rounded-[10px] border border-[var(--takeoff-line)] bg-white px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-medium text-[var(--takeoff-ink)]">
                              {displayRequirementLabels[status.requirement] ?? status.label}
                            </div>
                            <div className="mt-0.5 text-[9px] leading-4 text-[var(--takeoff-text-muted)]">
                              {status.pageIndexes.length > 0
                                ? `Pages ${status.pageIndexes.map((pageIndex) => pageIndex + 1).join(', ')}`
                                : status.description}
                            </div>
                          </div>
                          <span
                            className={`takeoff-mono rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${
                              status.satisfied
                                ? 'border-[#47644a] bg-[#eaf1e4] text-[#47644a]'
                                : status.severity === 'required'
                                  ? 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
                                  : 'border-[#c6d0c3] bg-[#edf3ea] text-[#6f8070]'
                            }`}
                          >
                            {status.satisfied ? 'covered' : status.severity}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 shrink-0 border-t border-[var(--takeoff-line)] pt-3">
                <div className="mb-2 text-[10px] leading-5 text-[var(--takeoff-text-muted)]">
                  {measurementPages.length === 0 ? (
                    'Assign at least one primary takeoff page before continuing to zones.'
                  ) : (
                    <>
                      {selectedPages.length} reviewed page{selectedPages.length === 1 ? '' : 's'} ·{' '}
                      {measurementPages.length} primary · {evidencePages.length} support
                      {requiredGaps.length > 0
                        ? ` · ${requiredGaps.length} required gap${requiredGaps.length === 1 ? '' : 's'}`
                        : ''}
                    </>
                  )}
                </div>
                <button
                  onClick={async () => {
                    if (isContinuingToZones) return;
                    setIsContinuingToZones(true);
                    try {
                      await onContinue(effectiveScores);
                    } finally {
                      setIsContinuingToZones(false);
                    }
                  }}
                  disabled={
                    isContinuingToZones ||
                    !classificationDone ||
                    Boolean(classificationError) ||
                    measurementPages.length === 0
                  }
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#202621] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
                >
                  {isContinuingToZones ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Preparing Areas
                    </>
                  ) : (
                    <>
                      Continue to Zones
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
      {scheduleCropPage && (
        <ScheduleCropModal
          pdfUrl={pdfUrl}
          pageIndex={scheduleCropPage.page_index}
          pages={
            scheduleCropPages.length > 0
              ? scheduleCropPages
              : [{ pageIndex: scheduleCropPage.page_index, label: scheduleCropPage.label || `Page ${scheduleCropPage.page_index + 1}` }]
          }
          onCancel={() => setScheduleCropPageIndex(null)}
          onAnalyzeAll={(crops) => {
            setScheduleCropPageIndex(null);
            void onAnalyzeScheduleCrops(crops.map((item) => ({ pageIndex: item.pageIndex, bbox: item.bbox })));
          }}
        />
      )}
      {openingCatalogModalOpen && openingCatalogRows.length > 0 && (
        <OpeningCatalogModal
          rows={openingCatalogRows}
          onClose={() => setOpeningCatalogModalOpen(false)}
        />
      )}
    </div>
  );
}
