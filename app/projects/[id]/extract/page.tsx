"use client";

import { use, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Document, Page, pdfjs } from 'react-pdf';
import { ScanningOverlay } from '@/components/extraction/ScanningOverlay';
import { AnalysisPanel } from '@/components/extraction/AnalysisPanel';
import { ScopeCard } from '@/components/extraction/ScopeCard';
import { TakeoffResults } from '@/components/extraction/TakeoffResults';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Lightbulb, Eye, RotateCcw, ArrowRight } from 'lucide-react';
import { DemoTooltip } from '@/components/demo/DemoTooltip';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';
import { PLAN_PRESETS, detectPlanPreset } from '@/lib/constants/planPresets';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

type OcrOutcome = 'none' | 'complete' | 'review' | 'failed';

const DEFAULT_MODE: 'vision' | 'ocr' =
  (process.env.NEXT_PUBLIC_DEFAULT_EXTRACTION_MODE as 'vision' | 'ocr') || 'ocr';

export default function ExtractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [project, setProject] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [autoStarted, setAutoStarted] = useState(false);
  const [extractionMode, setExtractionMode] = useState<'vision' | 'ocr'>(DEFAULT_MODE);

  // M8.2: OCR outcome branching + Vision fallback
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

  // Auto-start extraction once project loads
  // Pass project.plan_preset directly to avoid race condition —
  // planPreset state isn't populated yet when this effect fires.
  useEffect(() => {
    if (project && !autoStarted && !isExtracting && !isComplete) {
      setAutoStarted(true);
      startExtraction({ planNameOverride: project.plan_preset || undefined });
    }
  }, [project]);

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
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      // Auto-detect and persist preset before setting project,
      // so the auto-start effect sees it on project.plan_preset.
      if (!data?.plan_preset && data?.name) {
        const detected = detectPlanPreset(data.name);
        if (detected) {
          data.plan_preset = detected;
          setPlanPreset(detected);
          supabase.from('projects').update({ plan_preset: detected }).eq('id', id);
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

  const startExtraction = async (opts?: { forceNewKey?: boolean; modeOverride?: 'vision' | 'ocr'; planNameOverride?: string }) => {
    const mode = opts?.modeOverride ?? extractionMode;
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
      const endpoint = mode === 'ocr' ? '/api/extract-ocr' : '/api/extract';
      console.log('[EXTRACT] Sending request:', { projectId: id, idempotencyKey, planName: effectivePlanName, mode });
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, idempotencyKey, planName: effectivePlanName }),
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Extraction timed out — the PDF may be too large. Please try again.');
      }

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(data.error || 'Extraction already in progress.');
        }
        throw new Error(data.error || 'Extraction failed');
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

      // Branch on OCR outcome
      if (mode === 'ocr' && env) {
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
            || 'OCR could not complete extraction'
        );
        return;
      }

      // Vision mode (or OCR without envelope)
      setIsComplete(true);
      setTimeout(() => router.push(`/projects/${id}/review`), 1200);
    } catch (err) {
      setHasError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Extraction failed');
      if (mode === 'ocr') {
        setOcrOutcome('failed');
      }
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

  const handleVisionFallback = () => {
    setHasError(false);
    setErrorMessage('');
    setIsComplete(false);
    setOcrOutcome('none');
    setExtractionMode('vision');
    startExtraction({ forceNewKey: true, modeOverride: 'vision' });
  };

  const handlePresetChange = async (value: string) => {
    const preset = value === 'auto' ? null : value;
    setPlanPreset(preset);
    setDetectedPreset(null);
    await supabase.from('projects').update({ plan_preset: preset }).eq('id', id);
  };

  const handleUseSuggestion = async () => {
    if (detectedPreset) {
      setPlanPreset(detectedPreset);
      setDetectedPreset(null);
      await supabase.from('projects').update({ plan_preset: detectedPreset }).eq('id', id);
    }
  };

  const [pdfError, setPdfError] = useState(false);

  // PDF height = container minus some padding
  const pdfHeight = containerHeight > 0 ? containerHeight - 32 : 700;

  if (isLoading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-500">Project not found</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Minimal header */}
      <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/projects/${id}`)}
            disabled={isExtracting}
            className="text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="h-4 w-px bg-zinc-800" />
          <h1 className="text-sm font-medium text-zinc-300">{project.name}</h1>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/20">
            <Lightbulb className="h-3 w-3 text-cyan-400" />
            <span className="text-xs text-cyan-300">Step 2: AI Extraction</span>
            <DemoTooltip>
              Our AI is analyzing your document page-by-page, extracting room dimensions, wall measurements, door counts, and window counts. This typically takes 15-30 seconds.
            </DemoTooltip>
          </div>
          {!isExtracting && !isComplete && ocrOutcome === 'none' && !hasError && (
            <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setExtractionMode('vision')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  extractionMode === 'vision'
                    ? 'bg-cyan-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Vision
              </button>
              <button
                onClick={() => setExtractionMode('ocr')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  extractionMode === 'ocr'
                    ? 'bg-cyan-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                OCR
              </button>
            </div>
          )}
          {/* Plan preset dropdown */}
          {!isExtracting && !isComplete && (
            <>
              <div className="flex items-center gap-2">
                <div className="h-4 w-px bg-zinc-800" />
                <select
                  value={planPreset || 'auto'}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="auto">Auto / Unknown</option>
                  {PLAN_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {planPreset && (
                  <span className="text-[10px] text-cyan-400 font-mono">
                    preset: {planPreset}
                  </span>
                )}
              </div>
              {/* Auto-detection suggestion */}
              {!planPreset && detectedPreset && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80">
                  <span>Suggested: &ldquo;{detectedPreset}&rdquo;</span>
                  <button
                    onClick={handleUseSuggestion}
                    className="underline hover:text-amber-300"
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
          {hasError && ocrOutcome !== 'failed' && (
            <Button
              size="sm"
              onClick={handleRetry}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
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
                className="border-zinc-700 text-zinc-300 hover:text-white"
              >
                <RotateCcw className="h-3 w-3 mr-2" />
                Retry OCR
              </Button>
              <Button
                size="sm"
                onClick={handleVisionFallback}
                className="bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                <Eye className="h-3 w-3 mr-2" />
                Try Vision
              </Button>
            </>
          )}

          {ocrOutcome === 'review' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(`/projects/${id}/review`)}
                className="border-zinc-700 text-zinc-300 hover:text-white"
              >
                <ArrowRight className="h-3 w-3 mr-2" />
                Go to Review
              </Button>
              <Button
                size="sm"
                onClick={handleVisionFallback}
                className="bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                <Eye className="h-3 w-3 mr-2" />
                Run Vision to cross-check
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main content: PDF + Results side panel */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden flex">
        {/* PDF area */}
        <div className={`relative overflow-hidden ${(ocrOutcome === 'complete' || ocrOutcome === 'review') && envelope ? 'flex-1' : 'w-full'}`}>
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 overflow-auto">
            <div
              className={`relative ${isExtracting ? 'animate-pulse-glow' : ''}`}
              style={{ borderRadius: '4px' }}
            >
              {pdfError ? (
                <div
                  className="flex flex-col items-center justify-center bg-zinc-900 rounded gap-3"
                  style={{ height: pdfHeight, width: pdfHeight * 0.77 }}
                >
                  <p className="text-zinc-400 text-sm">PDF preview unavailable</p>
                  <p className="text-zinc-600 text-xs">Extraction is still running in the background</p>
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
                      className="flex items-center justify-center bg-zinc-900 rounded"
                      style={{ height: pdfHeight, width: pdfHeight * 0.77 }}
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
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
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-zinc-800/90 backdrop-blur px-3 py-1.5 rounded-full">
              <p className="text-xs text-zinc-400">
                Page {currentPage} of {numPages}
              </p>
            </div>
          )}

          {/* Floating analysis panel — bottom right (during extraction only) */}
          {(isExtracting || hasError || (ocrOutcome === 'failed')) && (
            <div className="absolute bottom-4 right-4 z-20 w-80 max-h-[60%] rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-zinc-800">
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
          <div className="w-[420px] border-l border-zinc-800 bg-zinc-900/80 overflow-y-auto p-5">
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
