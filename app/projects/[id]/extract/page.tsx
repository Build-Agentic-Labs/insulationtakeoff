"use client";

import { use, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Document, Page, pdfjs } from 'react-pdf';
import { ScanningOverlay } from '@/components/extraction/ScanningOverlay';
import { AnalysisPanel } from '@/components/extraction/AnalysisPanel';
import { TakeoffResults } from '@/components/extraction/TakeoffResults';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Lightbulb, RotateCcw, ArrowRight } from 'lucide-react';
import { DemoTooltip } from '@/components/demo/DemoTooltip';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';
import { PLAN_PRESETS, detectPlanPreset } from '@/lib/constants/planPresets';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

type OcrOutcome = 'none' | 'complete' | 'review' | 'failed';

export default function ExtractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [project, setProject] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // M8.2: automated takeoff outcome branching
  const [ocrOutcome, setOcrOutcome] = useState<OcrOutcome>('none');
  const [envelope, setEnvelope] = useState<TakeoffEnvelopeV1 | null>(null);
  const [lastIdempotencyKey, setLastIdempotencyKey] = useState<string | null>(null);

  // Plan preset
  const [planPreset, setPlanPreset] = useState<string | null>(null);
  const [detectedPreset, setDetectedPreset] = useState<string | null>(null);

  // PDF state
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfReady, setPdfReady] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);
  const pageIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadProject();
  }, [id]);

  // Measure container for full-screen PDF sizing
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Auto-advance pages during extraction
  useEffect(() => {
    if (isExtracting && numPages > 1) {
      pageIntervalRef.current = setInterval(() => {
        setCurrentPage(prev => {
          const next = prev + 1;
          return next > numPages ? 1 : next;
        });
      }, 5000);
    }

    return () => {
      if (pageIntervalRef.current) {
        clearInterval(pageIntervalRef.current);
      }
    };
  }, [isExtracting, numPages]);

  const loadProject = async () => {
    try {
      const companyId = await getActiveCompanyId();
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .eq('company_id', companyId)
        .single();
      // Auto-detect and persist preset before the user starts automated takeoff.
      if (!data?.plan_preset && data?.name) {
        const detected = detectPlanPreset(data.name);
        if (detected) {
          data.plan_preset = detected;
          setPlanPreset(detected);
          supabase.from('projects').update({ plan_preset: detected }).eq('id', id).eq('company_id', companyId);
        }
      } else if (data?.plan_preset) {
        setPlanPreset(data.plan_preset);
      }
      setProject(data);
    } catch (err) {
      console.error('Error loading project:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const startExtraction = async (opts?: { forceNewKey?: boolean; planNameOverride?: string }) => {
    const effectivePlanName = opts?.planNameOverride ?? planPreset ?? undefined;
    setIsExtracting(true);
    setHasError(false);
    setErrorMessage('');
    setOcrOutcome('none');
    setEnvelope(null);

    // Generate idempotency key (reuse on resume, new on retry/fresh)
    const idempotencyKey =
      (!opts?.forceNewKey && lastIdempotencyKey) ? lastIdempotencyKey : crypto.randomUUID();
    setLastIdempotencyKey(idempotencyKey);

    try {
      console.log('[EXTRACT] Sending request:', { projectId: id, idempotencyKey, planName: effectivePlanName, mode: 'ocr' });
      const response = await fetch('/api/extract-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, idempotencyKey, planName: effectivePlanName }),
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Automated takeoff timed out — the PDF may be too large. Please try again.');
      }

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(data.error || 'Automated takeoff is already in progress.');
        }
        throw new Error(data.error || 'Automated takeoff failed');
      }

      // Capture run_id + envelope if present
      if (data.run_id) {
        console.log('[EXTRACT] Response:', {
          run_id: data.run_id,
          cached: !!data.cached,
          status: data.takeoff_envelope?.status,
          gross_sf: data.takeoff_envelope?.summary?.gross_sf,
          page_source: data.takeoff_envelope?.page_selection?.source,
          selected_page: data.takeoff_envelope?.page_selection?.selected_page_index,
          planName: effectivePlanName,
        });
      }
      const env: TakeoffEnvelopeV1 | null = data.takeoff_envelope ?? null;
      if (env) {
        setEnvelope(env);
      }

      setIsExtracting(false);

      if (pageIntervalRef.current) {
        clearInterval(pageIntervalRef.current);
      }

      // Branch on automated takeoff outcome
      if (env) {
        if (env.status === 'complete') {
          setOcrOutcome('complete');
          setIsComplete(true);
          setTimeout(() => router.push(`/projects/${id}/review`), 1200);
          return;
        }

        if (env.status === 'review') {
          setOcrOutcome('review');
          // Stay on page — user chooses next step
          return;
        }

        // failed
        setOcrOutcome('failed');
        setHasError(true);
          setErrorMessage(
            env.errors?.[0]?.message
              || env.completeness?.degradation_reason
            || 'Automated takeoff could not complete'
          );
        return;
      }

      // Fallback for successful responses without an envelope.
      setIsComplete(true);
      setTimeout(() => router.push(`/projects/${id}/review`), 1200);
    } catch (err) {
      setHasError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Automated takeoff failed');
      setOcrOutcome('failed');
      setIsExtracting(false);
      if (pageIntervalRef.current) {
        clearInterval(pageIntervalRef.current);
      }
    }
  };

  const handleRetry = () => {
    setHasError(false);
    setErrorMessage('');
    setIsComplete(false);
    setOcrOutcome('none');
    startExtraction({ forceNewKey: true });
  };

  const handlePresetChange = async (value: string) => {
    const preset = value === 'auto' ? null : value;
    setPlanPreset(preset);
    setDetectedPreset(null);
    const companyId = await getActiveCompanyId();
    await supabase.from('projects').update({ plan_preset: preset }).eq('id', id).eq('company_id', companyId);
  };

  const handleUseSuggestion = async () => {
    if (detectedPreset) {
      setPlanPreset(detectedPreset);
      setDetectedPreset(null);
      const companyId = await getActiveCompanyId();
      await supabase.from('projects').update({ plan_preset: detectedPreset }).eq('id', id).eq('company_id', companyId);
    }
  };

  const [pdfError, setPdfError] = useState(false);

  // PDF height = container minus some padding
  const pdfHeight = containerHeight > 0 ? containerHeight - 32 : 700;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0e1511]">
        <Loader2 className="h-8 w-8 animate-spin text-[#b6c5b5]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0e1511]">
        <p className="text-[#b6c5b5]">Project not found</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0e1511]">
      {/* Minimal header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[rgba(216,222,212,0.12)] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/projects/${id}`)}
            disabled={isExtracting}
            className="text-[#b6c5b5] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="h-4 w-px bg-[rgba(216,222,212,0.12)]" />
          <h1 className="text-sm font-medium text-[#edf3ea]">{project.name}</h1>
          <div className="h-4 w-px bg-[rgba(216,222,212,0.12)]" />
          <div className="flex items-center gap-2 rounded-full border border-[rgba(216,222,212,0.14)] bg-[rgba(245,248,241,0.08)] px-2 py-1">
            <Lightbulb className="h-3 w-3 text-[#d4a843]" />
            <span className="text-xs text-[#edf3ea]">Step 2: Automated Takeoff</span>
            <DemoTooltip>
              Start extraction when you are ready. The file can stay attached to the project without being scanned.
            </DemoTooltip>
          </div>
          {/* Plan preset dropdown */}
          {!isExtracting && !isComplete && (
            <>
              <div className="flex items-center gap-2">
                <div className="h-4 w-px bg-[rgba(216,222,212,0.12)]" />
                <select
                  value={planPreset || 'auto'}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="rounded-full border border-[rgba(216,222,212,0.14)] bg-[rgba(245,248,241,0.08)] px-2 py-1.5 text-xs text-[#edf3ea] focus:outline-none focus:border-[#f5f8f1]"
                >
                  <option value="auto">Auto / Unknown</option>
                  {PLAN_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {planPreset && (
                  <span className="font-mono text-[10px] text-[#b6c5b5]">
                    preset: {planPreset}
                  </span>
                )}
              </div>
              {/* Auto-detection suggestion */}
              {!planPreset && detectedPreset && (
                <div className="flex items-center gap-1.5 text-[11px] text-[#d4a843]">
                  <span>Suggested: &ldquo;{detectedPreset}&rdquo;</span>
                  <button
                    onClick={handleUseSuggestion}
                    className="underline hover:text-[#f0c763]"
                  >
                    Use this preset
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Action buttons based on outcome */}
        <div className="flex items-center gap-2">
          {!isExtracting && !isComplete && ocrOutcome === 'none' && !hasError && (
            <Button
              size="sm"
              onClick={() => startExtraction({
                forceNewKey: true,
                planNameOverride: planPreset ?? project.plan_preset ?? undefined,
              })}
              disabled={!project.pdf_url}
              className="bg-[#f5f8f1] text-[#141814] hover:bg-white"
            >
              Start Automated Takeoff
            </Button>
          )}

          {hasError && ocrOutcome !== 'failed' && (
            <Button
              size="sm"
              onClick={handleRetry}
              className="bg-[#f5f8f1] text-[#141814] hover:bg-white"
            >
              <RotateCcw className="h-3 w-3 mr-2" />
              Retry
            </Button>
          )}

          {ocrOutcome === 'failed' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetry}
                className="border-[rgba(216,222,212,0.14)] bg-transparent text-[#b6c5b5] hover:bg-[rgba(245,248,241,0.08)] hover:text-white"
              >
                <RotateCcw className="h-3 w-3 mr-2" />
                Retry Automated Takeoff
              </Button>
            </>
          )}

          {ocrOutcome === 'review' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(`/projects/${id}/review`)}
                className="border-[rgba(216,222,212,0.14)] bg-transparent text-[#b6c5b5] hover:bg-[rgba(245,248,241,0.08)] hover:text-white"
              >
                <ArrowRight className="h-3 w-3 mr-2" />
                Go to Review
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main content: PDF + Results side panel */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden flex">
        {/* PDF area */}
        <div className={`relative overflow-hidden ${(ocrOutcome === 'complete' || ocrOutcome === 'review') && envelope ? 'flex-1' : 'w-full'}`}>
          <div className="absolute inset-0 flex items-center justify-center overflow-auto bg-[#0e1511]">
            <div
              className={`relative ${isExtracting ? 'animate-pulse-glow' : ''}`}
              style={{ borderRadius: '4px' }}
            >
              {pdfError ? (
                <div
                  className="flex flex-col items-center justify-center gap-3 rounded bg-[#122019]"
                  style={{ height: pdfHeight, width: pdfHeight * 0.77 }}
                >
                  <p className="text-sm text-[#b6c5b5]">PDF preview unavailable</p>
                  <p className="text-xs text-[#8ea08f]">
                    {isExtracting
                      ? 'Automated takeoff is still running in the background'
                      : 'The file is still attached to this project'}
                  </p>
                </div>
              ) : (
                <Document
                  file={project.pdf_url}
                  onLoadSuccess={({ numPages }) => {
                    setNumPages(numPages);
                    setPdfReady(true);
                  }}
                  onLoadError={() => setPdfError(true)}
                  loading={
                    <div
                      className="flex items-center justify-center rounded bg-[#122019]"
                      style={{ height: pdfHeight, width: pdfHeight * 0.77 }}
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-[#8ea08f]" />
                    </div>
                  }
                >
                  {pdfReady && (
                    <Page
                      pageNumber={currentPage}
                      height={pdfHeight}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  )}
                </Document>
              )}

              {/* Scanning overlay on top of PDF */}
              <ScanningOverlay isActive={isExtracting} />
            </div>
          </div>

          {/* Page indicator — bottom center */}
          {numPages > 0 && (
            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[rgba(216,222,212,0.14)] bg-[#122019]/90 px-3 py-1.5 backdrop-blur">
              <p className="text-xs text-[#b6c5b5]">
                Page {currentPage} of {numPages}
              </p>
            </div>
          )}

          {/* Floating analysis panel — bottom right (during extraction only) */}
          {(isExtracting || hasError || (ocrOutcome === 'failed')) && (
            <div className="absolute bottom-4 right-4 z-20 max-h-[60%] w-80 overflow-hidden rounded-[18px] border border-[rgba(216,222,212,0.14)] shadow-2xl shadow-black/50">
              <AnalysisPanel
                isActive={isExtracting}
                isComplete={isComplete}
                hasError={hasError}
                errorMessage={errorMessage}
                ocrOutcome={ocrOutcome}
              />
            </div>
          )}
        </div>

        {/* Results side panel — slides in when results available */}
        {(ocrOutcome === 'complete' || ocrOutcome === 'review') && envelope && (
          <div className="w-[420px] overflow-y-auto border-l border-[rgba(216,222,212,0.12)] bg-[#122019]/88 p-5">
            <TakeoffResults
              envelope={envelope}
              onGenerateQuote={() => router.push(`/projects/${id}/quote`)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
