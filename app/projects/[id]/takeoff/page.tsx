'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { supabase } from '@/lib/supabase/client';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { PageSelector } from '@/components/takeoff/PageSelector';
import { BlueprintWorkspace } from '@/components/takeoff/BlueprintWorkspace';
import type { PageScore } from '@/lib/types/takeoff';

// Classification result from the API
interface PageClassification {
  page_index: number;
  page_type: string;
  page_name: string;
  has_dimensions: boolean;
  is_floor_plan: boolean;
  confidence: number;
}

export default function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();

  // ── Document state ──────────────────────────────────────────────────────────
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // ── AI classification state ─────────────────────────────────────────────────
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationDone, setClassificationDone] = useState(false);
  const [classifications, setClassifications] = useState<PageClassification[]>([]);
  const classifyStartedRef = useRef(false);

  // ── Store ───────────────────────────────────────────────────────────────────
  const currentStep = useTakeoffStore((s) => s.currentStep);
  const session = useTakeoffStore((s) => s.session);
  const setSession = useTakeoffStore((s) => s.setSession);
  const confirmPageSelection = useTakeoffStore((s) => s.confirmPageSelection);

  // ── Load document on mount ─────────────────────────────────────────────────
  useEffect(() => {
    async function loadDocument() {
      try {
        const { data: docs } = await supabase
          .from('documents')
          .select('id, file_url')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (docs && docs.length > 0) {
          setPdfUrl(docs[0].file_url);
          setDocumentId(docs[0].id);
        }
      } catch (err) {
        console.error('[TakeoffPage] Failed to load document:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadDocument();
  }, [projectId]);

  // ── Classify pages with Vision AI (cached per document) ─────────────────────
  const classifyPages = useCallback(async (url: string, numPages: number) => {
    if (classifyStartedRef.current) return;
    classifyStartedRef.current = true;

    // Check localStorage cache first
    const cacheKey = `takeoff_classify_${documentId}_${numPages}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const results: PageClassification[] = JSON.parse(cached);
        setClassifications(results);
        setClassificationDone(true);
        return;
      }
    } catch {}

    setIsClassifying(true);

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const loadingTask = pdfjs.getDocument(url);
      const pdf = await loadingTask.promise;

      // Render all pages as low-res thumbnails (scale 0.5)
      const pages: Array<{ image_base64: string }> = [];
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const base64 = canvas.toDataURL('image/jpeg', 0.6).replace(/^data:image\/jpeg;base64,/, '');
        pages.push({ image_base64: base64 });
      }

      const response = await fetch('/api/takeoff/classify-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages }),
      });

      if (response.ok) {
        const data = await response.json();
        const results: PageClassification[] = data.pages ?? [];
        setClassifications(results);

        // Cache to localStorage
        try {
          localStorage.setItem(cacheKey, JSON.stringify(results));
        } catch {}
      }
    } catch (err) {
      console.error('[TakeoffPage] Page classification failed:', err);
    } finally {
      setIsClassifying(false);
      setClassificationDone(true);
    }
  }, [documentId]);

  // ── When PDF loads, trigger classification ─────────────────────────────────
  const handlePdfLoaded = useCallback((numPages: number) => {
    setTotalPages(numPages);
    if (pdfUrl && numPages > 0) {
      classifyPages(pdfUrl, numPages);
    }
  }, [pdfUrl, classifyPages]);

  // ── Build PageScore array from classifications ─────────────────────────────
  const pageScores: PageScore[] = Array.from({ length: totalPages }, (_, i) => {
    const cls = classifications.find((c) => c.page_index === i);
    return {
      page_index: i,
      score: cls?.confidence ?? 0.5,
      label: cls?.page_name ?? `Page ${i + 1}`,
      ai_selected: cls?.is_floor_plan ?? false,
    };
  });

  // ── Page selection confirmed ───────────────────────────────────────────────
  const handleConfirmPageSelection = useCallback(async () => {
    const currentSelectedPages = useTakeoffStore.getState().selectedPages;
    if (!documentId || currentSelectedPages.length === 0) return;

    let sessionId = uuid();
    try {
      const { data: sessionData } = await supabase
        .from('takeoff_sessions')
        .insert({
          project_id: projectId,
          document_id: documentId,
          status: 'in_progress',
          selected_pages: currentSelectedPages,
        })
        .select()
        .single();

      if (sessionData) {
        sessionId = sessionData.id;
      }
    } catch (err) {
      console.warn('[TakeoffPage] DB insert failed, using local session:', err);
    }

    setSession({
      id: sessionId,
      project_id: projectId,
      document_id: documentId,
      status: 'in_progress',
      selected_pages: currentSelectedPages,
      regions: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    confirmPageSelection();
  }, [documentId, projectId, setSession, confirmPageSelection]);

  // ── Step label ─────────────────────────────────────────────────────────────
  const stepLabel =
    currentStep === 'page-selection' ? 'Step 1: Select Pages' : 'Step 2: Review Regions';

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="h-full bg-white flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-zinc-300 border-t-blue-500 animate-spin" />
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="h-full bg-white flex items-center justify-center">
        <p className="text-zinc-500 text-sm">No document found for this project.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 flex items-center gap-3">
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="h-4 w-px bg-zinc-200" />

        <h1 className="text-sm font-medium text-zinc-800">Insulation Takeoff</h1>

        <div className="h-4 w-px bg-zinc-200" />

        <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
          {stepLabel}
        </span>

        {isClassifying && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 ml-auto">
            <Loader2 className="h-3 w-3 animate-spin" />
            AI analyzing pages…
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {currentStep === 'page-selection' && (
          <PageSelector
            pdfUrl={pdfUrl}
            totalPages={totalPages}
            pageScores={pageScores}
            isClassifying={isClassifying}
            classificationDone={classificationDone}
            onPdfLoaded={handlePdfLoaded}
            onConfirm={handleConfirmPageSelection}
          />
        )}

        {currentStep === 'workspace' && session && (
          <BlueprintWorkspace
            pdfUrl={pdfUrl}
            documentId={documentId!}
            sessionId={session.id}
            onGenerateQuote={() => router.push(`/projects/${projectId}/quote`)}
          />
        )}
      </div>
    </div>
  );
}
