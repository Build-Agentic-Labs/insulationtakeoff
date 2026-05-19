'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Loader2,
  Maximize,
  Sparkles,
  Tag,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import {
  buildPageAnalysisFromPageScores,
  getEvidenceRequirementStatuses,
} from '@/lib/takeoff/workspace-v2';
import { getPublicAnalysisError } from '@/lib/takeoff/analysis-errors';
import type { PageRole, PageScore } from '@/lib/types/takeoff';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const ROLE_ORDER: PageRole[] = ['measurement', 'evidence'];

interface PageSelectorProps {
  pdfUrl: string;
  totalPages: number;
  pageScores: PageScore[];
  isClassifying: boolean;
  classificationDone: boolean;
  classificationError: string | null;
  onConfirm: () => void;
}

function normalizeRoles(roles: PageRole[]) {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

function summarize(values: string[] | undefined, limit = 3) {
  if (!values?.length) return null;
  const compact = values.map(compactSignalValue);
  if (compact.length <= limit) return compact.join(', ');
  return `${compact.slice(0, limit).join(', ')} +${compact.length - limit} more`;
}

function compactSignalValue(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 92) return normalized;

  const labeledMatch = normalized.match(
    /\b(?:vapou?r\s+barrier|vapou?r\s+retarder|air\s+barrier|air\s+sealing|baffles?|vent(?:ing|ilation)?|soffit\s+vents?|ridge\s+vents?)\b[^.;]*/i,
  );
  const source = labeledMatch?.[0]?.trim() || normalized;
  return source.length <= 92 ? source : `${source.slice(0, 89).trim()}...`;
}

function hasExtractedSignals(page: PageScore | undefined) {
  return Boolean(
    page?.scan_extracts?.r_values?.length ||
      page?.scan_extracts?.insulation_types?.length ||
      page?.scan_extracts?.window_sizes?.length ||
      page?.scan_extracts?.opening_quantity_notes?.length ||
      page?.scan_extracts?.roof_pitches?.length ||
      page?.scan_extracts?.vapor_barriers?.length ||
      page?.scan_extracts?.air_barriers?.length ||
      page?.scan_extracts?.baffles_or_venting?.length,
  );
}

function ExtractedSignalBlock({
  label,
  values,
  limit = 3,
}: {
  label: string;
  values?: string[];
  limit?: number;
}) {
  const summary = summarize(values, limit);
  if (!summary) return null;
  return (
    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
      <div className="text-[11px] font-medium text-[var(--takeoff-ink)]">{label}</div>
      <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]" title={values?.join('\n')}>
        {summary}
      </div>
    </div>
  );
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
      existing && existing.roles.length > 0
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

function RoleBadge({
  role,
  active,
}: {
  role: PageRole;
  active: boolean;
}) {
  return (
    <span
      className={`takeoff-mono rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
        active
          ? 'border-[#47644a] bg-[#eaf1e4] text-[#47644a]'
          : 'border-[#c5d0c2] bg-[#f5f8f1] text-[#8ea08f]'
      }`}
    >
      {role === 'measurement' ? 'M' : 'E'}
    </span>
  );
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
      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? 'border-[#47644a] bg-[#47644a] text-white'
          : 'border-[#c6d0c3] bg-[#edf3ea] text-[#4d6150] hover:bg-[#e1e9dd]'
      }`}
    >
      {role === 'measurement' ? 'Primary Takeoff Page' : 'Supporting Evidence'}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="takeoff-label text-[9px] font-semibold tracking-[0.18em] text-[var(--takeoff-text-subtle)]">
      {children}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white px-3 py-2.5">
      <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">{label}</div>
      <div className="takeoff-mono mt-1.5 text-[12px] text-[var(--takeoff-ink)]">{value}</div>
    </div>
  );
}

function FloatingPageChip({
  active,
  label,
  roles,
  onClick,
}: {
  active: boolean;
  label: string;
  roles: PageRole[];
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-[78px] rounded-[16px] border px-2 py-2 text-left shadow-[0_10px_20px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all ${
        active
          ? 'border-[var(--takeoff-line-strong)] bg-[rgba(255,255,255,0.88)] text-[var(--takeoff-ink)]'
          : 'border-[rgba(199,208,195,0.72)] bg-[rgba(255,255,255,0.62)] text-[var(--takeoff-ink)] hover:border-[#9eb29d] hover:bg-[rgba(255,255,255,0.82)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="takeoff-mono text-[10px]">{label}</div>
        <div className="flex gap-1">
          <span className={`takeoff-mono rounded-full border px-1 py-0.5 text-[7px] ${roles.includes('measurement') ? 'border-current/25 bg-current/8' : 'border-current/15 opacity-40'}`}>
            M
          </span>
          <span className={`takeoff-mono rounded-full border px-1 py-0.5 text-[7px] ${roles.includes('evidence') ? 'border-current/25 bg-current/8' : 'border-current/15 opacity-40'}`}>
            E
          </span>
        </div>
      </div>
      <div className="mt-1.5 h-8 rounded-[9px] border border-current/10 bg-current/5" />
      <div className="mt-1.5 text-[8px] uppercase tracking-[0.16em] text-[var(--takeoff-text-subtle)]">
        {roles.length > 0 ? 'Tagged' : 'Pending'}
      </div>
    </button>
  );
}

export function PageSelector({
  pdfUrl,
  totalPages,
  pageScores,
  isClassifying,
  classificationDone,
  classificationError,
  onConfirm,
}: PageSelectorProps) {
  const [localPageScores, setLocalPageScores] = useState<PageScore[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageCount, setPageCount] = useState(totalPages);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfLoadedRef = useRef(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const autoPreviewedRef = useRef(false);

  const setPageScoresStore = useTakeoffStore((s) => s.setPageScores);

  const effectivePageCount = pageCount || totalPages;
  const pageIndices = useMemo(
    () => Array.from({ length: effectivePageCount }, (_, i) => i),
    [effectivePageCount]
  );

  useEffect(() => {
    setLocalPageScores((prev) => mergeLocalScores(effectivePageCount, pageScores, prev));
  }, [effectivePageCount, pageScores]);

  useEffect(() => {
    if (previewIdx >= effectivePageCount && effectivePageCount > 0) {
      setPreviewIdx(0);
    }
  }, [effectivePageCount, previewIdx]);

  useEffect(() => {
    if (!classificationDone || autoPreviewedRef.current || localPageScores.length === 0) return;
    autoPreviewedRef.current = true;
    const firstMeasurement = localPageScores.find((page) => page.roles.includes('measurement'));
    const firstTagged = localPageScores.find((page) => page.roles.length > 0);
    setPreviewIdx(firstMeasurement?.page_index ?? firstTagged?.page_index ?? 0);
  }, [classificationDone, localPageScores]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 32);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.1 : 0.1;
        setZoom((value) => Math.min(3, Math.max(0.2, value + delta)));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handlePdfLoaded = useCallback((numPages: number) => {
    if (pdfLoadedRef.current) return;
    pdfLoadedRef.current = true;
    setPageCount(numPages);
  }, []);

  const fitWidth = containerWidth > 0 ? Math.min(containerWidth, 1200) : 800;
  const effectiveScores = localPageScores.length
    ? localPageScores
    : mergeLocalScores(effectivePageCount, pageScores, []);
  const selectedPages = effectiveScores.filter((page) => page.roles.length > 0);
  const measurementPages = selectedPages.filter((page) => page.roles.includes('measurement'));
  const publicClassificationError = classificationError ? getPublicAnalysisError(classificationError) : null;
  const pageAnalysis = buildPageAnalysisFromPageScores({
    totalPages: effectivePageCount,
    pageScores: effectiveScores,
  });
  const evidenceStatuses = getEvidenceRequirementStatuses(pageAnalysis);
  const requiredGaps = evidenceStatuses.filter(
    (status) => status.severity === 'required' && !status.satisfied
  );
  const currentPageScore = effectiveScores.find((score) => score.page_index === previewIdx);
  const currentPageAnalysis = pageAnalysis.find((page) => page.pageIndex === previewIdx);
  const currentLabel = currentPageScore?.label ?? `Page ${previewIdx + 1}`;
  const displayRequirementLabels: Record<string, string> = {
    measurement_page: 'Primary takeoff page',
    wall_height_reference: 'Sections / elevations',
    insulation_details: 'Insulation details / specs',
    roof_pitch_reference: 'Roof pitch',
    vapor_barrier_reference: 'Vapor / air barrier',
    opening_schedule: 'Opening schedule',
  };

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

  const handleConfirm = useCallback(() => {
    setPageScoresStore(effectiveScores);
    onConfirm();
  }, [effectiveScores, onConfirm, setPageScoresStore]);

  return (
    <div className="takeoff-shell takeoff-light-theme h-full overflow-hidden text-[var(--takeoff-ink)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.82)] px-4 py-2 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <h1 className="truncate text-[16px] font-medium tracking-[-0.03em] text-[var(--takeoff-ink)]">
                Confirm takeoff pages
              </h1>
              <span className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-2 py-0.5 text-[8px] font-medium text-[var(--takeoff-text-subtle)]">
                {selectedPages.length} reviewed
              </span>
              <span
                className={`takeoff-mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-medium ${
                  requiredGaps.length === 0
                    ? 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)]'
                    : 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] text-[var(--takeoff-warning)]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    requiredGaps.length === 0
                      ? 'bg-[var(--takeoff-ink)]'
                      : 'bg-[var(--takeoff-warning)]'
                  }`}
                />
                {requiredGaps.length === 0
                  ? 'Support coverage ready'
                  : `${requiredGaps.length} required support gap${requiredGaps.length === 1 ? '' : 's'}`}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {isClassifying ? (
                <span className="takeoff-mono flex h-7 items-center gap-1 rounded-full border border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] px-2.5 text-[8px] font-medium text-[var(--takeoff-warning)]">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  AI analyzing pages...
                </span>
              ) : publicClassificationError ? (
                <span className="takeoff-mono flex h-7 items-center gap-1 rounded-full border border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)] px-2.5 text-[8px] font-medium text-[var(--takeoff-warning)]">
                  Analysis failed
                </span>
              ) : classificationDone ? (
                <span className="takeoff-mono flex h-7 items-center gap-1 rounded-full border border-[#bfd0be] bg-[var(--takeoff-paper-strong)] px-2.5 text-[8px] font-medium text-[var(--takeoff-ink)]">
                  <Sparkles className="h-2.5 w-2.5" />
                  Vision scan loaded
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-3">
          <div className="relative h-full overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.74)] shadow-[0_30px_72px_rgba(31,39,33,0.12)] lg:grid lg:grid-cols-[minmax(0,1fr)_352px] lg:gap-3 lg:p-3">
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[rgba(255,255,255,0.92)] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[rgba(255,255,255,0.92)] to-transparent" />

            <div className="relative min-h-[420px] lg:h-full lg:min-h-0">
              <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[20rem]">
                <div className="pointer-events-auto rounded-[16px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] px-3 py-2.5 text-[var(--takeoff-ink)] shadow-[0_14px_28px_rgba(31,39,33,0.1)] backdrop-blur-lg">
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${requiredGaps.length > 0 ? 'bg-[var(--takeoff-warning)]' : 'bg-[var(--takeoff-ink)]'}`} />
                    <div className="min-w-0 flex-1">
              <div className="takeoff-label text-[9px] text-[var(--takeoff-text-subtle)]">Page Confirmation</div>
              <div className="mt-1 text-[13px] font-medium leading-5">
                        Confirm page roles before collection starts
                      </div>
                      <div className="mt-1 text-[10px] leading-4 text-[var(--takeoff-text-muted)]">
                        {publicClassificationError
                          ? `Vision analysis did not return usable results. ${publicClassificationError}`
                          : 'Review the scanned pages, keep the primary takeoff pages, and confirm which sheets support evidence, specs, and opening review.'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-2">
                {pageIndices.map((idx) => {
                  const score = effectiveScores.find((item) => item.page_index === idx);
                  return (
                    <FloatingPageChip
                      key={idx}
                      active={previewIdx === idx}
                      label={`P${idx + 1}`}
                      roles={score?.roles ?? []}
                      onClick={() => setPreviewIdx(idx)}
                    />
                  );
                })}
              </div>

              <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
                <div className="flex items-center gap-1 rounded-full border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] px-2 py-1 shadow-[0_12px_24px_rgba(31,39,33,0.08)] backdrop-blur-md">
                  <button
                    onClick={() => setZoom((value) => Math.max(0.2, value - 0.15))}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--takeoff-text-muted)] transition-colors hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
                    title="Zoom out"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="takeoff-mono min-w-[42px] text-center text-[10px] text-[var(--takeoff-text-muted)]">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={() => setZoom((value) => Math.min(3, value + 0.15))}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--takeoff-text-muted)] transition-colors hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
                    title="Zoom in"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setZoom(1)}
                    className="takeoff-mono flex h-7 items-center justify-center rounded-full px-2 text-[10px] text-[var(--takeoff-text-muted)] transition-colors hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
                    title="Fit to view"
                  >
                    Fit
                  </button>
                </div>
              </div>

              <div
                ref={(element) => {
                  (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
                  (previewContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
                }}
                className="absolute inset-0 z-10 overflow-auto rounded-[8px] border border-[var(--takeoff-line)] bg-[var(--takeoff-canvas)] shadow-[0_18px_36px_rgba(31,39,33,0.12)]"
              >
                <div className="takeoff-dot-grid min-h-full overflow-auto rounded-[8px] bg-[var(--takeoff-canvas)]">
                  <div
                    className="flex min-h-full justify-center p-6 xl:p-8"
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top center',
                      width: `${100 / zoom}%`,
                      minHeight: `${100 / zoom}%`,
                    }}
                  >
                    <Document
                      file={pdfUrl}
                      onLoadSuccess={(pdf) => handlePdfLoaded(pdf.numPages)}
                      loading={<div className="mt-16 text-sm text-[var(--takeoff-text-muted)]">Loading PDF...</div>}
                      error={<div className="mt-16 text-sm text-[var(--takeoff-accent)]">Failed to load PDF.</div>}
                    >
                      <Page
                        pageNumber={previewIdx + 1}
                        width={fitWidth}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        className="rounded-[8px] shadow-[0_24px_64px_rgba(23,33,28,0.16)]"
                      />
                    </Document>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-20 min-h-0 lg:block">
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.94)] text-[var(--takeoff-ink)] shadow-[0_18px_36px_rgba(31,39,33,0.12)] backdrop-blur-xl">
                <div className="border-b border-[var(--takeoff-line)] px-4 py-4">
                  <SectionLabel>Vision Result</SectionLabel>
                  <div className="mt-2 text-[16px] font-medium">{currentLabel}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {currentPageScore?.page_type && (
                      <span className="takeoff-mono inline-flex items-center gap-1 rounded-full border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--takeoff-text-muted)]">
                        <Tag className="h-2.5 w-2.5" />
                        {currentPageScore.page_type}
                      </span>
                    )}
                    {(currentPageScore?.ai_roles.length ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#bfd0be] bg-[#edf5e8] px-2 py-0.5 text-[10px] text-[#47644a]">
                        <Sparkles className="h-2.5 w-2.5" />
                        AI suggests {currentPageScore?.ai_roles.join(' + ')}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <RoleToggle
                      role="measurement"
                      active={currentPageScore?.roles.includes('measurement') ?? false}
                      onClick={() => toggleRole(previewIdx, 'measurement')}
                    />
                    <RoleToggle
                      role="evidence"
                      active={currentPageScore?.roles.includes('evidence') ?? false}
                      onClick={() => toggleRole(previewIdx, 'evidence')}
                    />
                    <button
                      onClick={() => clearRoles(previewIdx)}
                      className="rounded-full border border-[#c6d0c3] bg-[#edf3ea] px-3 py-1.5 text-[11px] font-medium text-[#4d6150] transition-colors hover:bg-[#e1e9dd]"
                    >
                      Clear roles
                    </button>
                  </div>

                  <div className="mt-3 text-[12px] leading-5 text-[var(--takeoff-text-muted)]">
                    {currentPageAnalysis?.notes.join(' • ') ?? 'Assign this sheet as a primary takeoff page, supporting evidence, or both before collection starts.'}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <div className="space-y-4">
                    <section>
                    <SectionLabel>Vision Summary</SectionLabel>
                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        <MetricPill label="Tagged" value={`${selectedPages.length}`} />
                        <MetricPill label="Primary" value={`${measurementPages.length}`} />
                        <MetricPill label="Evidence" value={`${selectedPages.filter((page) => page.roles.includes('evidence')).length}`} />
                        <MetricPill label="Required gaps" value={`${requiredGaps.length}`} />
                      </div>
                    </section>

                    <section>
                      <SectionLabel>Extracted Signals</SectionLabel>
                      <div className="mt-3 space-y-2">
                        <ExtractedSignalBlock label="R-values" values={currentPageScore?.scan_extracts?.r_values} limit={5} />
                        <ExtractedSignalBlock label="Insulation types" values={currentPageScore?.scan_extracts?.insulation_types} limit={4} />
                        <ExtractedSignalBlock label="Roof pitch" values={currentPageScore?.scan_extracts?.roof_pitches} limit={3} />
                        <ExtractedSignalBlock label="Vapor barrier" values={currentPageScore?.scan_extracts?.vapor_barriers} limit={3} />
                        <ExtractedSignalBlock label="Air barrier" values={currentPageScore?.scan_extracts?.air_barriers} limit={3} />
                        <ExtractedSignalBlock label="Baffles / venting" values={currentPageScore?.scan_extracts?.baffles_or_venting} limit={3} />
                        <ExtractedSignalBlock label="Window sizes" values={currentPageScore?.scan_extracts?.window_sizes} limit={4} />
                        <ExtractedSignalBlock label="Opening hints" values={currentPageScore?.scan_extracts?.opening_quantity_notes} limit={3} />
                        {!hasExtractedSignals(currentPageScore) && (
                            <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-subtle)]">
                              No explicit spec or opening values extracted from this page yet.
                            </div>
                          )}
                      </div>
                    </section>

                    <section>
                      <SectionLabel>Missing Evidence Checklist</SectionLabel>
                      <div className="mt-3 space-y-3">
                        {evidenceStatuses.map((status) => (
                          <div key={status.requirement} className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">
                                  {displayRequirementLabels[status.requirement] ?? status.label}
                                </div>
                                <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                                  {status.pageIndexes.length > 0
                                    ? `Pages ${status.pageIndexes.map((pageIndex) => pageIndex + 1).join(', ')}`
                                    : status.description}
                                </div>
                              </div>
                              <span
                                className={`takeoff-mono rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
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
                    </section>

                    <section>
                      <SectionLabel>Ready To Continue</SectionLabel>
                      <div
                        className={`mt-3 rounded-[18px] border px-3 py-3 ${
                          requiredGaps.length > 0
                            ? 'border-[var(--takeoff-warning)]/30 bg-[rgba(212,168,67,0.08)]'
                            : 'border-[var(--takeoff-line)] bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <AlertTriangle
                            className={`mt-0.5 h-4 w-4 ${
                              requiredGaps.length > 0 ? 'text-[var(--takeoff-warning)]' : 'text-[#47644a]'
                            }`}
                          />
                          <div>
                            <div className="text-[12px] font-medium text-[var(--takeoff-ink)]">
                              {requiredGaps.length > 0
                                ? 'Critical support pages are still missing from the confirmed set.'
                                : 'Required page categories are covered.'}
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                              Missing pages do not prevent you from proceeding, but the takeoff stays incomplete until required evidence gaps are resolved.
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                <div className="border-t border-[var(--takeoff-line)] px-4 py-4">
                  <div className="mb-3 text-[11px] text-[var(--takeoff-text-muted)]">
                        {measurementPages.length === 0 ? (
                      'Tag at least one primary takeoff page to continue from vision into the takeoff workspace.'
                    ) : (
                      <>
                        {selectedPages.length} reviewed page{selectedPages.length === 1 ? '' : 's'} ·{' '}
                        {measurementPages.length} primary ·{' '}
                        {selectedPages.filter((page) => page.roles.includes('evidence')).length} evidence
                        {requiredGaps.length > 0 ? ` · ${requiredGaps.length} required gap${requiredGaps.length === 1 ? '' : 's'}` : ''}
                      </>
                    )}
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={measurementPages.length === 0}
                    className={[
                      'takeoff-mono flex h-10 w-full items-center justify-center gap-2 rounded-full border px-4 text-[11px] font-semibold transition-colors',
                      measurementPages.length === 0
                        ? 'cursor-not-allowed border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[var(--takeoff-text-subtle)]'
                        : 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white hover:bg-[#202621]',
                    ].join(' ')}
                  >
                    Continue to Takeoff Workspace
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
