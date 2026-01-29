"use client";

import { use, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Document, Page, pdfjs } from 'react-pdf';
import { ScanningOverlay } from '@/components/extraction/ScanningOverlay';
import { AnalysisPanel } from '@/components/extraction/AnalysisPanel';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Play, Lightbulb } from 'lucide-react';
import { DemoTooltip } from '@/components/demo/DemoTooltip';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

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
  useEffect(() => {
    if (project && !autoStarted && !isExtracting && !isComplete) {
      setAutoStarted(true);
      startExtraction();
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
      setProject(data);
    } catch (err) {
      console.error('Error loading project:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const startExtraction = async () => {
    setIsExtracting(true);
    setHasError(false);
    setErrorMessage('');

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id }),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Extraction timed out — the PDF may be too large. Please try again.');
      }

      if (!response.ok) {
        throw new Error(data.error || 'Extraction failed');
      }

      setIsComplete(true);
      setIsExtracting(false);

      if (pageIntervalRef.current) {
        clearInterval(pageIntervalRef.current);
      }

      setTimeout(() => {
        router.push(`/projects/${id}/review`);
      }, 2000);
    } catch (err) {
      setHasError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Extraction failed');
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
    startExtraction();
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
        </div>

        {hasError && (
          <Button
            size="sm"
            onClick={handleRetry}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            <Play className="h-3 w-3 mr-2" />
            Retry
          </Button>
        )}
      </div>

      {/* Full-screen PDF with floating overlay */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {/* PDF fills the entire area */}
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

        {/* Floating analysis panel — bottom right */}
        <div className="absolute bottom-4 right-4 z-20 w-80 max-h-[60%] rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-zinc-800">
          <AnalysisPanel
            isActive={isExtracting}
            isComplete={isComplete}
            hasError={hasError}
            errorMessage={errorMessage}
          />
        </div>
      </div>
    </div>
  );
}
