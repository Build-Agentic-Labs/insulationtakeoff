'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Expand,
  FileSearch,
  Loader2,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import { BlueprintViewer } from '@/components/takeoff/BlueprintViewer';
import {
  buildPageAnalysisFromPageScores,
  getEvidenceRequirementStatuses,
} from '@/lib/takeoff/workspace-v2';
import type { PageScore, PageRole } from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const ROLE_ORDER: PageRole[] = ['measurement', 'evidence'];
const PREVIEW_MOTION_MS = 320;

interface PreviewOriginRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TakeoffAnalysisScreenProps {
  pdfUrl: string;
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
  onContinue: (scores: PageScore[]) => void;
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
      page.scan_extracts?.roof_pitches?.length ||
      page.scan_extracts?.vapor_barriers?.length ||
      page.scan_extracts?.air_barriers?.length ||
      page.scan_extracts?.baffles_or_venting?.length ||
      page.scan_extracts?.wall_framing?.length,
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
  pageNumber,
  selected,
  renderPreview = true,
  onSelect,
  onAspectRatio,
}: {
  pageNumber: number;
  selected: boolean;
  renderPreview?: boolean;
  onSelect: (rect: PreviewOriginRect) => void;
  onAspectRatio: (ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailWidth, setThumbnailWidth] = useState(240);

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
      <div ref={containerRef} className="flex w-full items-center justify-center overflow-hidden">
        {renderPreview ? (
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
            loading={
              <div className="takeoff-blueprint-loading-dots takeoff-dot-grid flex h-[170px] w-full items-center justify-center bg-[var(--takeoff-canvas)] text-[11px] text-[var(--takeoff-text-subtle)]">
                Preparing preview
              </div>
            }
          />
        ) : (
          <div className="takeoff-blueprint-loading-dots takeoff-dot-grid flex h-[170px] w-full items-center justify-center bg-[var(--takeoff-canvas)] text-[11px] text-[var(--takeoff-text-subtle)]">
            Preparing preview
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
  page,
  pending,
  selectedForPreview,
  renderThumbnail = true,
  onSelectPreview,
  onAspectRatio,
  onToggleRole,
  onClearRoles,
}: {
  page: PageScore;
  pending: boolean;
  selectedForPreview: boolean;
  renderThumbnail?: boolean;
  onSelectPreview: (pageIndex: number, rect: PreviewOriginRect) => void;
  onAspectRatio: (pageIndex: number, ratio: number) => void;
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
          pageNumber={page.page_index + 1}
          selected={selectedForPreview}
          renderPreview={renderThumbnail}
          onSelect={(rect) => onSelectPreview(page.page_index, rect)}
          onAspectRatio={(ratio) => onAspectRatio(page.page_index, ratio)}
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

export function TakeoffAnalysisScreen({
  pdfUrl,
  totalPages,
  pageScores,
  isClassifying,
  classificationDone,
  classificationError,
  analysisProgress,
  onContinue,
}: TakeoffAnalysisScreenProps) {
  const [localPageScores, setLocalPageScores] = useState<PageScore[]>([]);
  const [selectedPreviewPage, setSelectedPreviewPage] = useState<number | null>(null);
  const [expandedPreviewPage, setExpandedPreviewPage] = useState<number | null>(null);
  const [expandedPreviewClosing, setExpandedPreviewClosing] = useState(false);
  const [previewOriginRect, setPreviewOriginRect] = useState<PreviewOriginRect | null>(null);
  const [previewAspectRatios, setPreviewAspectRatios] = useState<Record<number, number>>({});
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
  const displayRequirementLabels: Record<string, string> = {
    measurement_page: 'Primary takeoff page',
    wall_height_reference: 'Sections / elevations',
    insulation_details: 'Insulation details / specs',
    roof_pitch_reference: 'Roof pitch',
    vapor_barrier_reference: 'Vapor / air barrier',
    opening_schedule: 'Opening schedule',
  };
  const renderPageCards = (renderThumbnails: boolean) => (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {displayPages.map((page) => (
        <AnalysisPageCard
          key={page.page_index}
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
        setExpandedPreviewClosing(false);
        setExpandedPreviewPage(selectedPreviewPage);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeExpandedPreview, expandedPreviewPage, selectedPreviewPage]);

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
    ? classificationError
    : analysisProgress?.message ?? 'Preparing vision analysis';
  const showLoadingStatus = isClassifying && !classificationError;
  const showCompletedReview = classificationDone && !isClassifying && !classificationError;
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
          </div>
        </div>

        <div className="mt-3 grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(246,248,242,0.85)] p-4">
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
                <div className="rounded-[14px] border border-dashed border-[var(--takeoff-line)] bg-white px-4 py-5 text-[12px] text-[var(--takeoff-text-muted)]">
                  {classificationError
                    ? `Vision analysis failed: ${classificationError}`
                    : 'Page analysis results will appear here as soon as the scan completes.'}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-white">
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
                    ? 'flex flex-1 flex-col gap-2.5'
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

              <div className="mt-3 border-t border-[var(--takeoff-line)] pt-3">
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
                  onClick={() => onContinue(effectiveScores)}
                  disabled={!classificationDone || Boolean(classificationError) || measurementPages.length === 0}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#202621] disabled:cursor-not-allowed disabled:border-[var(--takeoff-line)] disabled:bg-[var(--takeoff-paper)] disabled:text-[var(--takeoff-text-subtle)]"
                >
                  Continue to Zones
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
