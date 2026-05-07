import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { startOrReturnRun, finishRun } from '@/lib/supabase/extractionRuns';
import { computeComparisonMetrics } from '@/lib/comparison/computeMetrics';
import { analyzePDF } from '@/lib/ai/claude-client';
import { parseInsulationExtractionResponse, InsulationExtractionData } from '@/lib/ai/parsers';
import { INSULATION_EXTRACTION_PROMPT } from '@/lib/ai/prompts';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { createSignedStorageUrl } from '@/lib/supabase/storage';

export const maxDuration = 60;

const LEGACY_EXTRACTION_ENABLED = process.env.ENABLE_LEGACY_PDF_ENGINE === 'true';
const LEGACY_EXTRACTION_DISABLED_MESSAGE =
  'Legacy automated extraction is temporarily unavailable. Use the manual takeoff workspace.';

export async function POST(request: NextRequest) {
  if (!LEGACY_EXTRACTION_ENABLED) {
    return NextResponse.json(
      { error: LEGACY_EXTRACTION_DISABLED_MESSAGE },
      { status: 410 },
    );
  }

  let projectId: string | undefined;
  let runId: string | undefined;
  let companyId: string | undefined;
  try {
    const body = await request.json();
    companyId = await requireServerCompanyId();
    projectId = body.projectId;
    const idempotencyKey: string = body.idempotencyKey || crypto.randomUUID();

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Get project from database
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('company_id', companyId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    if (!project.pdf_url) {
      return NextResponse.json(
        { error: 'Project has no PDF uploaded' },
        { status: 400 }
      );
    }

    // Find or auto-create document for this project
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('id, file_url')
      .eq('project_id', projectId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1);
    let documentId = docs?.[0]?.id;
    let documentFileUrl = docs?.[0]?.file_url ?? null;

    // Auto-create document row if none exists (legacy upload flow only sets project.pdf_url)
    if (!documentId) {
      const { data: newDoc, error: docError } = await supabaseAdmin
        .from('documents')
        .insert({
          company_id: companyId,
          project_id: projectId,
          name: project.name || 'Uploaded PDF',
          file_url: project.pdf_url,
          file_type: 'application/pdf',
          file_size: 0,
        })
        .select('id')
        .single();
      if (docError || !newDoc) {
        return NextResponse.json(
          { error: 'Failed to create document record' },
          { status: 500 }
        );
      }
      documentId = newDoc.id;
      documentFileUrl = project.pdf_url;
    }

    const activePdfUrl = documentFileUrl || project.pdf_url;

    // Idempotency: check or create run
    const { run, isExisting } = await startOrReturnRun({
      companyId,
      projectId,
      documentId,
      mode: 'vision',
      idempotencyKey,
      requestJson: { pdf_url: activePdfUrl, mode: 'vision' },
    });
    runId = run.id;

    // If run already exists and is finished, return cached result
    if (isExisting && run.finished_at) {
      return NextResponse.json({
        success: true,
        run_id: run.id,
        data: null,
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
      .eq('id', projectId)
      .eq('company_id', companyId);

    const signedPdfUrl = await createSignedStorageUrl(activePdfUrl, companyId);

    // Fetch PDF from signed storage URL
    console.log('Fetching PDF from company-scoped storage');
    const pdfResponse = await fetch(signedPdfUrl);
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    console.log('PDF size:', pdfBuffer.byteLength, 'bytes');

    // Send PDF directly to Claude for analysis
    console.log('Sending PDF to Claude for analysis...');
    const response = await analyzePDF(pdfBase64, INSULATION_EXTRACTION_PROMPT);

    console.log('Claude response:', response);

    // Parse the response. Do not seed fabricated quantities into real projects.
    const extractedData = parseInsulationExtractionResponse(response);
    if (!extractedData) {
      throw new Error('Vision extraction did not return parseable insulation data.');
    }

    const hasUsableData =
      (extractedData.total_living_area_sqft && extractedData.total_living_area_sqft > 0) ||
      (extractedData.gross_wall_sf && extractedData.gross_wall_sf > 0) ||
      (extractedData.rooms && extractedData.rooms.some(r => r.area_sqft && r.area_sqft > 0));

    if (!hasUsableData) {
      throw new Error('Vision extraction returned no usable square-footage values.');
    }

    console.log('Extracted data:', extractedData);

    // Store extracted data in database
    await storeExtractedData(companyId, projectId, extractedData);

    // Compute comparison metrics if OCR envelope exists (best-effort)
    let metricsJson: Record<string, unknown> | undefined;
    try {
      const metrics = await computeComparisonMetrics(companyId, projectId, 'vision', runId);
      if (metrics) {
        metricsJson = metrics as unknown as Record<string, unknown>;
      }
    } catch (e) {
      console.warn('Comparison metrics failed (non-blocking):', e);
    }

    // Mark run as complete
    await finishRun({ companyId, runId, status: 'complete', metricsJson });

    // Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: 'reviewing' })
      .eq('id', projectId)
      .eq('company_id', companyId);

    return NextResponse.json({
      success: true,
      run_id: runId,
      data: extractedData,
    });
  } catch (error) {
    console.error('Extraction error:', error);

    // Mark run as failed
    if (runId && companyId) {
      await finishRun({
        companyId,
        runId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Vision extraction failed',
      }).catch(() => {});
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', run_id: runId },
      { status: 500 }
    );
  }
}

async function storeExtractedData(companyId: string, projectId: string, data: InsulationExtractionData) {
  // Clean up existing data for re-extraction
  await supabaseAdmin.from('openings').delete().eq('project_id', projectId).eq('company_id', companyId);
  await supabaseAdmin.from('rooms').delete().eq('project_id', projectId).eq('company_id', companyId);

  // Determine wall composition and stud size from first wall section
  const wallComposition = data.wall_sections?.[0]?.composition || null;
  const studSize = data.wall_sections?.[0]?.stud_size || null;

  // Create main living area room if we have area OR wall data
  const hasLivingData = data.total_living_area_sqft || data.gross_wall_sf || data.exterior_wall_length_ft;
  if (hasLivingData) {
    const { error: roomErr } = await supabaseAdmin
      .from('rooms')
      .insert({
        company_id: companyId,
        project_id: projectId,
        name: 'Main Living Area',
        type: 'living',
        area_sqft: data.total_living_area_sqft || null,
        height_ft: data.wall_height_ft || null,
        perimeter_ft: data.exterior_wall_length_ft || null,
        wall_sf: data.gross_wall_sf || null,
        floor_sf: data.floor_sf || null,
        ceiling_sf: data.ceiling_sf || null,
        wall_composition: wallComposition,
        stud_size: studSize,
      });
    if (roomErr) {
      console.error('Failed to insert Main Living Area room:', roomErr);
    }
  }

  // Create garage room if present
  if (data.garage_area_sqft) {
    const { error: garageErr } = await supabaseAdmin
      .from('rooms')
      .insert({
        company_id: companyId,
        project_id: projectId,
        name: 'Garage',
        type: 'garage',
        area_sqft: data.garage_area_sqft,
        height_ft: data.wall_height_ft,
      });
    if (garageErr) {
      console.error('Failed to insert Garage room:', garageErr);
    }
  }

  // Store individual rooms (skip duplicates of main/garage)
  let roomsInserted = hasLivingData ? 1 : 0;
  if (data.rooms && Array.isArray(data.rooms)) {
    for (const extractedRoom of data.rooms) {
      if (!extractedRoom.area_sqft && !extractedRoom.length_ft && !extractedRoom.width_ft) {
        continue;
      }

      // Skip if this is essentially the main living area or garage already stored
      const nameLower = extractedRoom.name.toLowerCase();
      if (
        (nameLower.includes('total') && nameLower.includes('living')) ||
        (nameLower === 'garage' && extractedRoom.type === 'garage')
      ) {
        continue;
      }

      const { error: indRoomErr } = await supabaseAdmin
        .from('rooms')
        .insert({
          company_id: companyId,
          project_id: projectId,
          name: extractedRoom.name,
          type: extractedRoom.type || 'living',
          area_sqft: extractedRoom.area_sqft,
        });
      if (indRoomErr) {
        console.error(`Failed to insert room "${extractedRoom.name}":`, indRoomErr);
      } else {
        roomsInserted++;
      }
    }
  }

  // Store doors in openings table
  let openingsInserted = 0;
  if (data.doors && Array.isArray(data.doors)) {
    for (const door of data.doors) {
      const { error: doorErr } = await supabaseAdmin
        .from('openings')
        .insert({
          company_id: companyId,
          project_id: projectId,
          type: 'door',
          label: door.label || 'Door',
          width_ft: door.width_ft,
          height_ft: door.height_ft,
          area_sqft: door.area_sqft,
          count: door.count || 1,
          confidence: data.confidence,
        });
      if (doorErr) {
        console.error(`Failed to insert door "${door.label}":`, doorErr);
      } else {
        openingsInserted++;
      }
    }
  }

  // Store windows in openings table
  if (data.windows && Array.isArray(data.windows)) {
    for (const window of data.windows) {
      const { error: winErr } = await supabaseAdmin
        .from('openings')
        .insert({
          company_id: companyId,
          project_id: projectId,
          type: 'window',
          label: window.label || 'Window',
          width_ft: window.width_ft,
          height_ft: window.height_ft,
          area_sqft: window.area_sqft,
          count: window.count || 1,
          confidence: data.confidence,
        });
      if (winErr) {
        console.error(`Failed to insert window "${window.label}":`, winErr);
      } else {
        openingsInserted++;
      }
    }
  }

  console.log(`storeExtractedData: persisted ${roomsInserted} rooms, ${openingsInserted} openings for project ${projectId}`);
}
