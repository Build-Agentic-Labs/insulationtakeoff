'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FileUp, MousePointer2, PenLine, Ruler } from 'lucide-react';
import { pdfjs } from 'react-pdf';
import { BlueprintViewer, type BlueprintViewerHandle } from '@/components/takeoff/BlueprintViewer';
import { CalibrationOverlay } from '@/components/takeoff/CalibrationOverlay';
import { SegmentList } from '@/components/takeoff/SegmentList';
import { WallThicknessOverlay } from '@/components/takeoff/WallThicknessOverlay';
import { WallTraceOverlay } from '@/components/takeoff/WallTraceOverlay';
import { useBlueprintPageHotkeys } from '@/components/takeoff/useBlueprintPageHotkeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { getWallPreset } from '@/lib/takeoff/presets';
import type { TakeoffSession } from '@/lib/types/takeoff';

function createDemoSession(pageCount: number): TakeoffSession {
  const safePageCount = Math.max(1, pageCount);
  const selectedPages = Array.from({ length: safePageCount }, (_, index) => index);
  const now = new Date().toISOString();

  return {
    id: `wall-demo-${safePageCount}`,
    projectId: 'wall-trace-demo',
    documentId: 'local-pdf',
    status: 'calibrating',
    measurementBasis: 'centerline',
    selectedPages,
    calibrations: {},
    traces: [],
    classifications: [],
    createdAt: now,
    updatedAt: now,
  };
}

function formatVariance(variancePercent?: number) {
  if (variancePercent === undefined || !Number.isFinite(variancePercent)) {
    return 'Pending';
  }

  return `${variancePercent.toFixed(2)}%`;
}

function formatBandWidth(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return 'Calibrate first';
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} px`;
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
      <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
        {label}
      </div>
      <div className="takeoff-mono mt-2 text-[18px] font-semibold text-[var(--takeoff-ink)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
        {helper}
      </div>
    </div>
  );
}

export function PdfWallTraceDemo() {
  const viewerRef = useRef<BlueprintViewerHandle>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState('No PDF selected');
  const [pageCount, setPageCount] = useState(0);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const activePageIndex = useTakeoffStore((state) => state.activePageIndex);
  const calibrationStep = useTakeoffStore((state) => state.calibrationStep);
  const drawingPreset = useTakeoffStore((state) => state.drawingPreset);
  const session = useTakeoffStore((state) => state.session);
  const tool = useTakeoffStore((state) => state.tool);
  const setActivePage = useTakeoffStore((state) => state.setActivePage);
  const setDrawingPreset = useTakeoffStore((state) => state.setDrawingPreset);
  const setSession = useTakeoffStore((state) => state.setSession);
  const setTool = useTakeoffStore((state) => state.setTool);
  const setWallPreset = useTakeoffStore((state) => state.setWallPreset);
  const startCalibration = useTakeoffStore((state) => state.startCalibration);
  const startTrace = useTakeoffStore((state) => state.startTrace);
  const getCalibration = useTakeoffStore((state) => state.getCalibration);
  const getRunningTotal = useTakeoffStore((state) => state.getRunningTotal);

  const calibration = getCalibration();
  const totals = getRunningTotal();
  const wallPreset = getWallPreset('exterior_2x6');
  const isVerified = Boolean(calibration?.verification);
  const showCalibrationOverlay =
    calibrationStep !== 'idle' && calibrationStep !== 'done';
  const pageIndexes = session?.selectedPages ?? Array.from({ length: Math.max(pageCount, 1) }, (_, index) => index);

  useEffect(() => {
    setSession(createDemoSession(1));
    setDrawingPreset('wall');
    setWallPreset('exterior_2x6');
    setTool('pointer');
  }, [setDrawingPreset, setSession, setTool, setWallPreset]);

  useEffect(() => {
    if (!pdfUrl) {
      setPageCount(0);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingPdf(true);
    setLoadError(null);

    const loadingTask = pdfjs.getDocument(pdfUrl);

    loadingTask.promise
      .then((document) => {
        if (cancelled) return;

        setPageCount(document.numPages);
        setSession(createDemoSession(document.numPages));
        setDrawingPreset('wall');
        setWallPreset('exterior_2x6');
        setTool('pointer');
        setActivePage(0);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        console.error('[PdfWallTraceDemo] Failed to load PDF metadata', error);
        setLoadError(error.message || 'Failed to load PDF.');
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPdf(false);
        }
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [pdfUrl, setActivePage, setDrawingPreset, setSession, setTool, setWallPreset]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    setPdfUrl(objectUrl);
    setFileLabel(file.name);
    setPageCount(0);
    setLoadError(null);
    setSession(createDemoSession(1));
    setDrawingPreset('wall');
    setWallPreset('exterior_2x6');
    setTool('pointer');
    setActivePage(0);
  };

  const handleTraceWall = () => {
    if (!isVerified) return;

    setDrawingPreset('wall');
    setWallPreset('exterior_2x6');
    startTrace('linear');
  };

  const sixInchBandWidth = (() => {
    const viewer = viewerRef.current;
    if (!viewer || !calibration) return null;

    const origin = viewer.pageCoordsToCss(0, 0);
    const offset = viewer.pageCoordsToCss(calibration.pdfPointsPerFoot * 0.5, 0);

    if (!origin || !offset) return null;

    return Math.abs(offset.x - origin.x);
  })();

  const instructionText = (() => {
    if (!pdfUrl) {
      return 'Upload a PDF to start the demo.';
    }

    switch (calibrationStep) {
      case 'primary_a':
        return 'Pick the first endpoint of a known dimension.';
      case 'primary_input':
        return 'Enter the first known dimension to establish scale.';
      case 'verify_a':
        return 'Pick a second known dimension to verify the scale.';
      case 'verify_input':
        return 'Enter the verification dimension to lock the 6-inch wall band.';
      default:
        if (!isVerified) {
          return 'Run the full two-point calibration before tracing.';
        }

        if (drawingPreset === 'wall') {
          return 'Trace wall centerlines and the calibrated 6-inch band will render over the PDF.';
        }

        return 'Switch back to the wall tool to test 6-inch tracing.';
    }
  })();

  const currentPageTraceCount =
    session?.traces.filter((trace) => trace.pageIndex === activePageIndex && trace.type === 'linear')
      .length ?? 0;

  useBlueprintPageHotkeys({
    activePageIndex,
    selectedPages: pageIndexes,
    setActivePage,
    disabled: tool === 'trace' || showCalibrationOverlay,
  });

  return (
    <div className="takeoff-shell takeoff-light-theme min-h-screen bg-[radial-gradient(circle_at_top,rgba(233,239,229,0.82),rgba(245,247,242,0.96)_56%,rgba(250,250,247,1)_100%)] text-[var(--takeoff-ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col gap-4 p-4 xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] px-5 py-4 shadow-[0_24px_48px_rgba(31,39,33,0.08)] backdrop-blur-xl">
          <div className="min-w-0">
            <div className="takeoff-label text-[10px] font-semibold tracking-[0.18em] text-[var(--takeoff-text-subtle)]">
              PDF Tool Library Demo
            </div>
            <h1 className="mt-2 truncate text-[28px] font-semibold tracking-[-0.04em] text-[var(--takeoff-ink)]">
              6&quot; wall trace test page
            </h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--takeoff-text-muted)]">
              Upload a PDF, calibrate from two known dimensions, then trace wall runs with a
              calibrated 6-inch band so you can judge whether the tool matches the wall thickness
              on the sheet.
            </p>
          </div>

          <div className="w-full max-w-md rounded-[20px] border border-[var(--takeoff-line)] bg-white/90 p-3 shadow-[0_16px_32px_rgba(31,39,33,0.06)]">
            <label className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
              PDF upload
            </label>
            <div className="mt-2 flex items-center gap-3 rounded-[18px] border border-dashed border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-3">
              <div className="rounded-full border border-[var(--takeoff-line)] bg-white p-2 text-[var(--takeoff-ink)]">
                <FileUp className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--takeoff-ink)]">
                  {fileLabel}
                </div>
                <div className="mt-1 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                  Local uploads work for calibration and tracing. Vector snapping is skipped for
                  blob URLs.
                </div>
              </div>
            </div>
            <Input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="mt-3 cursor-pointer bg-white"
            />
            {loadError ? (
              <div className="mt-2 text-[11px] text-[var(--takeoff-accent)]">{loadError}</div>
            ) : null}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative min-h-[640px] overflow-hidden rounded-[28px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.72)] shadow-[0_36px_72px_rgba(31,39,33,0.12)]">
            {!pdfUrl ? (
              <div className="flex h-full items-center justify-center px-6">
                <div className="max-w-lg text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--takeoff-line)] bg-white">
                    <FileUp className="h-7 w-7 text-[var(--takeoff-ink)]" />
                  </div>
                  <div className="mt-5 text-[22px] font-semibold tracking-[-0.03em] text-[var(--takeoff-ink)]">
                    Load a plan sheet
                  </div>
                  <div className="mt-2 text-[13px] leading-6 text-[var(--takeoff-text-muted)]">
                    This sandbox page is isolated from projects. Once a PDF is loaded, calibrate on
                    two known dimensions and then trace with the 6-inch wall band preview.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="absolute left-4 top-4 z-20 max-w-[24rem] rounded-[20px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] px-4 py-3 shadow-[0_18px_36px_rgba(31,39,33,0.12)] backdrop-blur-xl">
                  <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                    Active instruction
                  </div>
                  <div className="mt-2 text-[14px] font-medium text-[var(--takeoff-ink)]">
                    {instructionText}
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                    {isVerified
                      ? `The ${wallPreset.label} tool renders as a ${formatBandWidth(
                          sixInchBandWidth,
                        )} band at the current calibration.`
                      : 'Calibration must complete before the wall-band preview can match sheet thickness.'}
                  </div>
                </div>

                <div className="absolute bottom-4 left-4 z-20 flex flex-wrap gap-2">
                  {pageIndexes.map((pageIndex) => {
                    const pageCalibration = session?.calibrations[pageIndex];
                    const verified = Boolean(pageCalibration?.verification);

                    return (
                      <button
                        key={pageIndex}
                        onClick={() => setActivePage(pageIndex)}
                        className={`takeoff-mono rounded-full border px-3 py-2 text-[11px] font-medium shadow-[0_12px_24px_rgba(31,39,33,0.1)] backdrop-blur-xl transition-colors ${
                          activePageIndex === pageIndex
                            ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
                            : 'border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] text-[var(--takeoff-ink)] hover:border-[#9eb29d]'
                        }`}
                      >
                        P{pageIndex + 1} {verified ? 'Verified' : 'Pending'}
                      </button>
                    );
                  })}
                </div>

                <div className="h-full bg-[var(--takeoff-canvas)]">
                  <BlueprintViewer
                    ref={viewerRef}
                    pdfUrl={pdfUrl}
                    pageNumber={activePageIndex + 1}
                    cursorMode={
                      calibrationStep !== 'idle' && calibrationStep !== 'done'
                        ? 'crosshair'
                        : 'default'
                    }
                  >
                    {(dims) => (
                      <>
                        <WallThicknessOverlay
                          viewerRef={viewerRef}
                          pageWidth={dims.width}
                          pageHeight={dims.height}
                          defaultThicknessIn={6}
                        />
                        <WallTraceOverlay
                          viewerRef={viewerRef}
                          pageWidth={dims.width}
                          pageHeight={dims.height}
                          pdfUrl={pdfUrl}
                        />
                        {showCalibrationOverlay ? (
                          <CalibrationOverlay
                            viewerRef={viewerRef}
                            pageWidth={dims.width}
                            pageHeight={dims.height}
                          />
                        ) : null}
                      </>
                    )}
                  </BlueprintViewer>
                </div>
              </>
            )}

            {isLoadingPdf ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(255,255,255,0.66)] backdrop-blur-sm">
                <div className="takeoff-mono rounded-full border border-[var(--takeoff-line)] bg-white px-4 py-2 text-[11px] text-[var(--takeoff-text-muted)] shadow-[0_12px_24px_rgba(31,39,33,0.08)]">
                  Reading PDF metadata...
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-[28px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)] p-4 shadow-[0_28px_56px_rgba(31,39,33,0.1)] backdrop-blur-xl">
            <div className="space-y-4">
              <section className="rounded-[22px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-4">
                <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Tool controls
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTool('pointer')}
                    className="h-auto rounded-[18px] border-[var(--takeoff-line)] bg-white px-3 py-3 text-left text-[var(--takeoff-ink)] hover:bg-[var(--takeoff-paper)]"
                  >
                    <div className="flex flex-col items-start gap-2">
                      <MousePointer2 className="h-4 w-4" />
                      <span className="text-xs font-medium">Inspect</span>
                    </div>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => startCalibration()}
                    className="h-auto rounded-[18px] border-[var(--takeoff-line)] bg-white px-3 py-3 text-left text-[var(--takeoff-ink)] hover:bg-[var(--takeoff-paper)]"
                  >
                    <div className="flex flex-col items-start gap-2">
                      <Ruler className="h-4 w-4" />
                      <span className="text-xs font-medium">Calibrate</span>
                    </div>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTraceWall}
                    disabled={!pdfUrl || !isVerified}
                    className="h-auto rounded-[18px] border-[var(--takeoff-line)] bg-white px-3 py-3 text-left text-[var(--takeoff-ink)] hover:bg-[var(--takeoff-paper)]"
                  >
                    <div className="flex flex-col items-start gap-2">
                      <PenLine className="h-4 w-4" />
                      <span className="text-xs font-medium">Trace 6&quot; wall</span>
                    </div>
                  </Button>
                </div>
                <div className="mt-3 rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3 text-[11px] leading-5 text-[var(--takeoff-text-muted)]">
                  The wall tool stays on the 2x6 preset by default. Trace centerlines; the red band
                  shows calibrated wall thickness over the PDF.
                </div>
              </section>

              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label="6-inch band"
                  value={formatBandWidth(sixInchBandWidth)}
                  helper="Rendered width of the active wall tool after calibration."
                />
                <MetricCard
                  label="Calibration"
                  value={
                    !calibration
                      ? 'Required'
                      : calibration.verification
                        ? calibration.confidence.toUpperCase()
                        : '1 of 2'
                  }
                  helper={
                    calibration?.verification
                      ? `Variance ${formatVariance(calibration.variancePercent)}`
                      : 'Primary + verification dimensions required.'
                  }
                />
                <MetricCard
                  label="Current page"
                  value={pdfUrl ? `P${activePageIndex + 1}` : 'No file'}
                  helper={
                    pageCount > 0 ? `${pageCount} total pages in this upload.` : 'Upload a PDF to populate pages.'
                  }
                />
                <MetricCard
                  label="Wall traces"
                  value={`${currentPageTraceCount}`}
                  helper={`${totals.segmentCount} measured segments on the active page.`}
                />
                <MetricCard
                  label="Linear feet"
                  value={`${Math.round(totals.totalLf).toLocaleString()} LF`}
                  helper="Total calibrated wall length on the current page."
                />
                <MetricCard
                  label="Net wall area"
                  value={`${Math.round(totals.netSf).toLocaleString()} SF`}
                  helper="Gross minus openings based on the traced segments."
                />
              </div>

              <section className="rounded-[22px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-4">
                <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Calibration details
                </div>
                {!calibration ? (
                  <div className="mt-3 text-[12px] leading-6 text-[var(--takeoff-text-muted)]">
                    No calibration has been captured on this page yet.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3 text-[12px] leading-6 text-[var(--takeoff-text-muted)]">
                    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
                      <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                        Primary dimension
                      </div>
                      <div className="mt-1 text-[13px] font-medium text-[var(--takeoff-ink)]">
                        {calibration.primary.dimensionText ?? `${calibration.primary.knownValueFt} ft`}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
                      <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                        Verification dimension
                      </div>
                      <div className="mt-1 text-[13px] font-medium text-[var(--takeoff-ink)]">
                        {calibration.verification?.dimensionText ??
                          'Still required to lock the final scale'}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-3 py-3">
                      <div className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">
                        PDF points per foot
                      </div>
                      <div className="takeoff-mono mt-1 text-[13px] font-medium text-[var(--takeoff-ink)]">
                        {calibration.pdfPointsPerFoot.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-[22px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-4">
                <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                  How to test
                </div>
                <div className="mt-3 space-y-2 text-[12px] leading-6 text-[var(--takeoff-text-muted)]">
                  <p>1. Upload a floor plan PDF.</p>
                  <p>2. Click Calibrate and measure one known dimension, then a second one.</p>
                  <p>3. Click Trace 6&quot; wall and draw along the wall centerline.</p>
                  <p>4. Compare the red wall band to the printed wall thickness on the sheet.</p>
                </div>
              </section>

              <section className="rounded-[22px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-4">
                <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Object inspector
                </div>
                <div className="mt-3">
                  <SegmentList />
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
