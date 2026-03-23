import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { startOrReturnRun, finishRun } from '@/lib/supabase/extractionRuns';
import { computeComparisonMetrics } from '@/lib/comparison/computeMetrics';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';
import { canonicalizePreset } from '@/lib/constants/planPresets';

export const maxDuration = 300;

const PDFENGINE_BASE_URL = process.env.PDFENGINE_BASE_URL || 'http://localhost:8000';
const PDFENGINE_API_KEY = process.env.PDFENGINE_API_KEY || '';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 280_000; // slightly under maxDuration

/** Build headers for pdfengine requests */
function pdfHeaders(contentType?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (contentType) h['Content-Type'] = contentType;
  if (PDFENGINE_API_KEY) h['Authorization'] = `Bearer ${PDFENGINE_API_KEY}`;
  return h;
}

/** Create a project in pdfengine, returns pdfengine project_id */
async function ensurePdfengineProject(name: string): Promise<string> {
  const res = await fetch(`${PDFENGINE_BASE_URL}/api/v1/projects`, {
    method: 'POST',
    headers: pdfHeaders('application/json'),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pdfengine create project failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.id;
}

/** Upload PDF to pdfengine project, returns pdfengine document_id */
async function uploadToPdfengine(pdfengineProjectId: string, pdfUrl: string, filename: string): Promise<string> {
  // Fetch the PDF from Supabase storage
  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`Failed to fetch PDF from ${pdfUrl}: ${pdfRes.status}`);
  const pdfBlob = await pdfRes.blob();

  const formData = new FormData();
  formData.append('file', pdfBlob, filename);

  const res = await fetch(`${PDFENGINE_BASE_URL}/api/v1/projects/${pdfengineProjectId}/documents`, {
    method: 'POST',
    headers: pdfHeaders(), // no content-type — FormData sets it
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pdfengine upload failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.id;
}

/** Trigger processing and poll until complete/failed */
async function processAndPoll(
  pdfengineProjectId: string,
  pdfengineDocId: string,
  mode: string = 'hybrid',
  pageIndex?: number,
  planName?: string,
): Promise<{ status: string; extraction_result?: any; error_message?: string; takeoff_envelope?: any }> {
  // Trigger processing
  let processUrl = `${PDFENGINE_BASE_URL}/api/v1/projects/${pdfengineProjectId}/documents/${pdfengineDocId}/process?mode=${mode}`;
  if (pageIndex !== undefined && pageIndex !== null) {
    processUrl += `&page_index=${pageIndex}`;
  }
  if (planName) {
    processUrl += `&plan_name=${encodeURIComponent(planName)}`;
  }
  const processRes = await fetch(
    processUrl,
    { method: 'POST', headers: pdfHeaders('application/json') },
  );
  if (!processRes.ok) {
    const text = await processRes.text();
    throw new Error(`pdfengine process failed (${processRes.status}): ${text}`);
  }

  // Poll status until complete/review/failed
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const statusRes = await fetch(
      `${PDFENGINE_BASE_URL}/api/v1/projects/${pdfengineProjectId}/documents/${pdfengineDocId}/status`,
      { headers: pdfHeaders() },
    );
    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();
    console.log('pdfengine status:', statusData.status, statusData.progress?.message || '');

    if (statusData.status === 'complete' || statusData.status === 'review') {
      return statusData;
    }
    if (statusData.status === 'failed' || statusData.status === 'error') {
      return statusData;
    }
    // still processing — continue polling
  }

  throw new Error(`pdfengine processing timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

export async function POST(request: NextRequest) {
  let projectId: string | undefined;
  let documentId: string | undefined;
  let runId: string | undefined;

  try {
    const body = await request.json();
    projectId = body.projectId;
    documentId = body.documentId;
    const idempotencyKey: string = body.idempotencyKey || crypto.randomUUID();
    const pageOverride: number | undefined = body.pageOverride;
    // Validate plan name against canonical list — unknown values are silently dropped
    const planName: string | undefined = canonicalizePreset(body.planName) ?? undefined;
    if (body.planName && !planName) {
      console.warn(`Unknown plan preset "${body.planName}" — running with default config`);
    }

    console.log('[EXTRACT-OCR] Received:', { projectId, planName, pageOverride, idempotencyKey: idempotencyKey.slice(0, 8) + '...' });

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Get project from Supabase
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.pdf_url) {
      return NextResponse.json({ error: 'Project has no PDF uploaded' }, { status: 400 });
    }

    // Find or auto-create Supabase document row
    if (!documentId) {
      const { data: docs } = await supabaseAdmin
        .from('documents')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1);
      documentId = docs?.[0]?.id;

      if (!documentId) {
        const { data: newDoc, error: docError } = await supabaseAdmin
          .from('documents')
          .insert({
            project_id: projectId,
            name: project.name || 'Uploaded PDF',
            file_url: project.pdf_url,
            file_type: 'application/pdf',
            file_size: 0,
          })
          .select('id')
          .single();
        if (docError || !newDoc) {
          return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
        }
        documentId = newDoc.id;
      }
    }

    // Idempotency: check or create run
    const { run, isExisting } = await startOrReturnRun({
      projectId,
      documentId,
      mode: 'hybrid',
      idempotencyKey,
      requestJson: { pdf_url: project.pdf_url, mode: 'hybrid' },
    });
    runId = run.id;

    if (isExisting && run.finished_at) {
      return NextResponse.json({
        ok: true,
        run_id: run.id,
        takeoff_envelope: run.takeoff_envelope as TakeoffEnvelopeV1 | null,
        document_id: documentId,
        cached: true,
      });
    }

    if (isExisting && !run.finished_at) {
      return NextResponse.json(
        {
          error: 'Extraction already in progress for this project.',
          run_id: run.id,
          project_status: 'extracting',
          project_id: projectId,
        },
        { status: 409 }
      );
    }

    // Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: 'extracting' })
      .eq('id', projectId);

    // === pdfengine 3-step flow ===
    // 1. Create project in pdfengine
    console.log('Creating pdfengine project...');
    const peProjectId = await ensurePdfengineProject(project.name || 'extraction');

    // 2. Upload PDF to pdfengine
    console.log('Uploading PDF to pdfengine...');
    const peDocId = await uploadToPdfengine(peProjectId, project.pdf_url, `${project.name || 'document'}.pdf`);

    // 3. Process + poll
    console.log('Starting pdfengine processing (mode=hybrid)...',
      planName ? `plan_name=${planName}` : 'no plan_name',
      pageOverride !== undefined ? `page_index=${pageOverride}` : 'auto page');
    const result = await processAndPoll(peProjectId, peDocId, 'hybrid', pageOverride, planName);

    console.log('pdfengine result status:', result.status);

    if (result.status === 'failed' || result.status === 'error') {
      const errMsg = result.error_message || 'pdfengine processing failed';
      await finishRun({ runId, status: 'failed', error: errMsg });
      await supabaseAdmin.from('projects').update({ status: 'reviewing' }).eq('id', projectId);
      return NextResponse.json({ ok: false, run_id: runId, error: errMsg }, { status: 502 });
    }

    // Get the takeoff envelope — prefer the typed envelope from status response
    let envelope: TakeoffEnvelopeV1 | null = null;

    // 1. Status response includes takeoff_envelope (best source — typed, normalized)
    if (result.takeoff_envelope && result.takeoff_envelope.status) {
      envelope = result.takeoff_envelope;
    }

    // 2. Fallback: extraction_result from status
    if (!envelope && result.extraction_result?.takeoff_envelope?.status) {
      envelope = result.extraction_result.takeoff_envelope;
    }

    // 3. Last resort: fetch from /takeoff endpoint
    if (!envelope) {
      try {
        const takeoffRes = await fetch(
          `${PDFENGINE_BASE_URL}/api/v1/projects/${peProjectId}/takeoff`,
          { headers: pdfHeaders() },
        );
        if (takeoffRes.ok) {
          const takeoffData = await takeoffRes.json();
          if (takeoffData.takeoff_envelope?.status) {
            envelope = takeoffData.takeoff_envelope;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch takeoff envelope:', e);
      }
    }

    // Determine run status
    const runStatus = envelope?.status === 'complete' ? 'complete'
      : envelope?.status === 'review' ? 'review'
      : result.status === 'complete' ? 'complete'
      : result.status === 'review' ? 'review'
      : 'failed';

    // Compute comparison metrics (best-effort)
    let metricsJson: Record<string, unknown> | undefined;
    if (runStatus !== 'failed') {
      try {
        const metrics = await computeComparisonMetrics(projectId, 'hybrid', runId);
        if (metrics) metricsJson = metrics as unknown as Record<string, unknown>;
      } catch (e) {
        console.warn('Comparison metrics failed (non-blocking):', e);
      }
    }

    // Persist to extraction_runs
    await finishRun({
      runId,
      status: runStatus,
      envelope: envelope || undefined,
      error: runStatus === 'failed' ? 'No envelope returned' : undefined,
      metricsJson,
    });

    // Persist envelope to documents table
    if (envelope && runStatus !== 'failed') {
      await supabaseAdmin
        .from('documents')
        .update({ takeoff_envelope: envelope as any })
        .eq('id', documentId);
    }

    // Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: runStatus === 'failed' ? 'uploaded' : 'reviewing' })
      .eq('id', projectId);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      takeoff_envelope: envelope,
      document_id: documentId,
    });
  } catch (error) {
    console.error('OCR extraction error:', error);

    const isConnectionError = error instanceof TypeError
      && (error.message === 'fetch failed' || (error.cause as any)?.code === 'ECONNREFUSED');
    const errMsg = isConnectionError
      ? `Hybrid extraction engine is not reachable at ${PDFENGINE_BASE_URL}. Start pdfengine or try Vision mode.`
      : (error instanceof Error ? error.message : 'OCR extraction failed');

    if (runId) {
      await finishRun({ runId, status: 'failed', error: errMsg }).catch(() => {});
    }
    if (projectId) {
      await supabaseAdmin.from('projects').update({ status: 'reviewing' }).eq('id', projectId);
    }

    return NextResponse.json({ ok: false, run_id: runId, error: errMsg }, { status: 502 });
  }
}
