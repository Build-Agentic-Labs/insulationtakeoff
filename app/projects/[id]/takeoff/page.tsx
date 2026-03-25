'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { supabase } from '@/lib/supabase/client';
import { useTakeoffStore } from '@/lib/stores/takeoff-store';
import { PageSelector } from '@/components/takeoff/PageSelector';
import { BlueprintWorkspace } from '@/components/takeoff/BlueprintWorkspace';
import type { VisionRegionSuggestion, TakeoffRegion, PageScore } from '@/lib/types/takeoff';
// pdfjs is loaded dynamically in triggerVisionAnalysis to avoid SSR issues

export default function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();

  // ── Document state ──────────────────────────────────────────────────────────
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // ── Store ───────────────────────────────────────────────────────────────────
  const currentStep = useTakeoffStore((s) => s.currentStep);
  const selectedPages = useTakeoffStore((s) => s.selectedPages);
  const session = useTakeoffStore((s) => s.session);
  const setPageScores = useTakeoffStore((s) => s.setPageScores);
  const setSession = useTakeoffStore((s) => s.setSession);
  const confirmPageSelection = useTakeoffStore((s) => s.confirmPageSelection);
  const addRegion = useTakeoffStore((s) => s.addRegion);
  const setVisionLoading = useTakeoffStore((s) => s.setVisionLoading);
  const setVisionResults = useTakeoffStore((s) => s.setVisionResults);

  // ── Load document on mount ───────────────────────────────────────────────────
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

  // ── Initialize page scores ONCE when totalPages is first known ───────────────
  const scoresInitializedRef = useRef(false);
  useEffect(() => {
    if (totalPages > 0 && !scoresInitializedRef.current) {
      scoresInitializedRef.current = true;
      const scores: PageScore[] = Array.from({ length: totalPages }, (_, i) => ({
        page_index: i,
        score: 0.5,
        label: `Page ${i + 1}`,
        ai_selected: false,
      }));
      setPageScores(scores);
    }
  }, [totalPages, setPageScores]);

  // ── Vision analysis ──────────────────────────────────────────────────────────
  const triggerVisionAnalysis = useCallback(
    async (pageIndex: number) => {
      if (!pdfUrl || !session) return;

      setVisionLoading(pageIndex, true);

      try {
        // Dynamically import pdfjs to avoid SSR issues
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        // Render the PDF page to a canvas and convert to base64
        const loadingTask = pdfjs.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageIndex + 1); // pdfjs pages are 1-indexed

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');

        await page.render({ canvasContext: ctx, viewport }).promise;

        const base64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');

        // Call the Vision analysis API
        const response = await fetch('/api/takeoff/analyze-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64, page_index: pageIndex }),
        });

        if (!response.ok) {
          throw new Error(`Vision analysis failed: ${response.statusText}`);
        }

        const data = await response.json();
        const suggestions: VisionRegionSuggestion[] = (data.regions ?? []).map(
          (r: VisionRegionSuggestion) => ({
            label: r.label,
            wall_type: r.wall_type,
            bbox: r.bbox,
          })
        );

        setVisionResults(pageIndex, suggestions);

        // Add each suggestion as a TakeoffRegion in the store
        for (const suggestion of suggestions) {
          const region: TakeoffRegion = {
            id: uuid(),
            session_id: session.id,
            page_index: pageIndex,
            label: suggestion.label,
            wall_type: suggestion.wall_type,
            source: 'ai',
            status: 'pending',
            bbox: suggestion.bbox,
            wall_length_lf: null,
            wall_height_ft: null,
            gross_sf: null,
            net_sf: null,
            openings: [],
            analysis_result: null,
            confirmed_at: null,
          };
          addRegion(region);
        }
      } catch (err) {
        console.error('[TakeoffPage] Vision analysis error:', err);
        setVisionLoading(pageIndex, false);
      }
    },
    [pdfUrl, session, addRegion, setVisionLoading, setVisionResults]
  );

  // ── Page selection confirmed ─────────────────────────────────────────────────
  const handleConfirmPageSelection = useCallback(async () => {
    // Read fresh from store (PageSelector.handleConfirm syncs just before calling this)
    const currentSelectedPages = useTakeoffStore.getState().selectedPages;
    if (!documentId || currentSelectedPages.length === 0) return;

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
        setSession({
          id: sessionData.id,
          project_id: sessionData.project_id,
          document_id: sessionData.document_id,
          status: sessionData.status,
          selected_pages: sessionData.selected_pages,
          regions: [],
          created_at: sessionData.created_at,
          updated_at: sessionData.updated_at,
        });
      }

      confirmPageSelection();

      // Trigger vision analysis on the first selected page after store transition
      const firstPage = selectedPages[0];
      if (firstPage != null) {
        // Use a short delay to allow the session state to propagate before analysis
        setTimeout(() => {
          triggerVisionAnalysis(firstPage);
        }, 0);
      }
    } catch (err) {
      console.error('[TakeoffPage] Failed to create takeoff session:', err);
    }
  }, [documentId, selectedPages, projectId, setSession, confirmPageSelection, triggerVisionAnalysis]);

  // ── Step label for header ────────────────────────────────────────────────────
  const stepLabel =
    currentStep === 'page-selection' ? 'Step 1: Select Pages' : 'Step 2: Review Regions';

  // ── Loading state ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-zinc-600 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">No document found for this project.</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* ── Minimal header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-zinc-800 flex items-center gap-3">
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="h-4 w-px bg-zinc-800" />

        <h1 className="text-sm font-medium text-zinc-300">Insulation Takeoff</h1>

        <div className="h-4 w-px bg-zinc-800" />

        <span className="text-xs text-blue-400 bg-blue-950 border border-blue-800 rounded px-2 py-0.5">
          {stepLabel}
        </span>
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {currentStep === 'page-selection' && (
          <PageSelector
            pdfUrl={pdfUrl}
            totalPages={totalPages}
            onPdfLoaded={(numPages) => setTotalPages(numPages)}
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
