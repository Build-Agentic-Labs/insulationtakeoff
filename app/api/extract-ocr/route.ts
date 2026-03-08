import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { startOrReturnRun, finishRun } from '@/lib/supabase/extractionRuns';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';

export const maxDuration = 120;

const PDFENGINE_BASE_URL = process.env.PDFENGINE_BASE_URL || 'http://localhost:8000';
const PDFENGINE_API_KEY = process.env.PDFENGINE_API_KEY || '';

export async function POST(request: NextRequest) {
  let projectId: string | undefined;
  let documentId: string | undefined;
  let runId: string | undefined;

  try {
    const body = await request.json();
    projectId = body.projectId;
    documentId = body.documentId;
    const idempotencyKey: string = body.idempotencyKey || crypto.randomUUID();

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Get project
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

    // If no documentId provided, find the first document for this project
    if (!documentId) {
      const { data: docs } = await supabaseAdmin
        .from('documents')
        .select('id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1);
      documentId = docs?.[0]?.id;
    }

    if (!documentId) {
      return NextResponse.json({ error: 'No document found for project' }, { status: 400 });
    }

    // Idempotency: check or create run
    const { run, isExisting } = await startOrReturnRun({
      projectId,
      documentId,
      mode: 'ocr',
      idempotencyKey,
      requestJson: { pdf_url: project.pdf_url, mode: 'ocr_only' },
    });
    runId = run.id;

    // If run already exists and is finished, return cached result
    if (isExisting && run.finished_at) {
      return NextResponse.json({
        ok: true,
        run_id: run.id,
        takeoff_envelope: run.takeoff_envelope as TakeoffEnvelopeV1 | null,
        document_id: documentId,
        cached: true,
      });
    }

    // If run exists and is still in progress, return 409
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

    // Call pdfengine API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (PDFENGINE_API_KEY) {
      headers['Authorization'] = `Bearer ${PDFENGINE_API_KEY}`;
    }

    const pdfengineResponse = await fetch(`${PDFENGINE_BASE_URL}/api/v1/extract`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pdf_url: project.pdf_url,
        mode: 'ocr_only',
        plan_name: null,
        document_id: documentId,
      }),
      signal: AbortSignal.timeout(110_000), // slightly under maxDuration
    });

    if (!pdfengineResponse.ok) {
      const errText = await pdfengineResponse.text();
      console.error('pdfengine error:', pdfengineResponse.status, errText);

      const errMsg = `pdfengine returned ${pdfengineResponse.status}`;

      // Mark run as failed (don't touch document envelope)
      await finishRun({ runId, status: 'failed', error: errMsg });

      await supabaseAdmin
        .from('projects')
        .update({ status: 'reviewing' })
        .eq('id', projectId);

      return NextResponse.json(
        { ok: false, run_id: runId, error: errMsg, details: errText },
        { status: 502 }
      );
    }

    const responseData = await pdfengineResponse.json();

    // The response may be the envelope directly, or wrapped in { takeoff_envelope: ... }
    const envelope: TakeoffEnvelopeV1 = responseData.takeoff_envelope || responseData;

    // Determine run status from envelope
    const runStatus = envelope.status === 'complete' ? 'complete'
      : envelope.status === 'review' ? 'review'
      : 'failed';

    // Persist to run row
    await finishRun({
      runId,
      status: runStatus,
      envelope,
      error: runStatus === 'failed' ? (envelope.errors?.[0]?.message || 'extraction failed') : undefined,
    });

    // Persist envelope to documents table (on success or review, not failure)
    if (runStatus !== 'failed') {
      await supabaseAdmin
        .from('documents')
        .update({ takeoff_envelope: envelope as any })
        .eq('id', documentId);
    }

    // Update project status based on envelope
    const newStatus = envelope.status === 'failed' ? 'uploaded' : 'reviewing';
    await supabaseAdmin
      .from('projects')
      .update({ status: newStatus })
      .eq('id', projectId);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      takeoff_envelope: envelope,
      document_id: documentId,
    });
  } catch (error) {
    console.error('OCR extraction error:', error);

    // Mark run as failed if we have one
    if (runId) {
      await finishRun({
        runId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'OCR extraction failed',
      }).catch(() => {}); // best-effort
    }

    // Reset project status
    if (projectId) {
      await supabaseAdmin
        .from('projects')
        .update({ status: 'reviewing' })
        .eq('id', projectId);
    }

    return NextResponse.json(
      {
        ok: false,
        run_id: runId,
        error: error instanceof Error ? error.message : 'OCR extraction failed',
      },
      { status: 500 }
    );
  }
}
