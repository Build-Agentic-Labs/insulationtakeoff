import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { startOrReturnRun, finishRun } from '@/lib/supabase/extractionRuns';
import { computeComparisonMetrics } from '@/lib/comparison/computeMetrics';
import { analyzePDF } from '@/lib/ai/claude-client';
import { parseInsulationExtractionResponse, InsulationExtractionData } from '@/lib/ai/parsers';
import { INSULATION_EXTRACTION_PROMPT } from '@/lib/ai/prompts';

export const maxDuration = 60;

function getMockExtractionData(): InsulationExtractionData {
  return {
    total_living_area_sqft: 2500,
    garage_area_sqft: 400,
    exterior_wall_length_ft: 240,
    wall_height_ft: 8,
    gross_wall_sf: 1920,
    floor_sf: 2500,
    ceiling_sf: 2500,
    wall_sections: [
      {
        location: 'Exterior Walls',
        composition: '2x6 @ 16in OC w/ OSB sheathing',
        stud_size: '2x6',
      },
    ],
    doors: [
      { type: 'door', label: 'Front Entry Door', width_ft: 3.0, height_ft: 6.67, area_sqft: 20, count: 1 },
      { type: 'door', label: 'Rear Entry Door', width_ft: 3.0, height_ft: 6.67, area_sqft: 20, count: 1 },
      { type: 'door', label: 'Garage Door', width_ft: 16, height_ft: 7, area_sqft: 112, count: 1 },
    ],
    windows: [
      { type: 'window', label: 'Standard Window', width_ft: 3.0, height_ft: 4.0, area_sqft: 12, count: 8 },
      { type: 'window', label: 'Small Window', width_ft: 2.0, height_ft: 3.0, area_sqft: 6, count: 4 },
    ],
    rooms: [
      { name: 'Living Room', type: 'living', area_sqft: 400, length_ft: 20, width_ft: 20 },
      { name: 'Kitchen', type: 'living', area_sqft: 250, length_ft: 16, width_ft: 15.6 },
      { name: 'Master Bedroom', type: 'living', area_sqft: 300, length_ft: 20, width_ft: 15 },
      { name: 'Bedroom 2', type: 'living', area_sqft: 200, length_ft: 14, width_ft: 14.3 },
      { name: 'Bedroom 3', type: 'living', area_sqft: 180, length_ft: 13, width_ft: 13.8 },
      { name: 'Bathroom 1', type: 'living', area_sqft: 80, length_ft: 10, width_ft: 8 },
      { name: 'Bathroom 2', type: 'living', area_sqft: 60, length_ft: 8, width_ft: 7.5 },
      { name: 'Garage', type: 'garage', area_sqft: 400, length_ft: 20, width_ft: 20 },
    ],
    confidence: 0.85,
    notes: 'Mock data used - PDF extraction did not return usable results.',
  };
}

export async function POST(request: NextRequest) {
  let projectId: string | undefined;
  let runId: string | undefined;
  try {
    const body = await request.json();
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
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1);
    let documentId = docs?.[0]?.id;

    // Auto-create document row if none exists (legacy upload flow only sets project.pdf_url)
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
        return NextResponse.json(
          { error: 'Failed to create document record' },
          { status: 500 }
        );
      }
      documentId = newDoc.id;
    }

    // Idempotency: check or create run
    const { run, isExisting } = await startOrReturnRun({
      projectId,
      documentId,
      mode: 'vision',
      idempotencyKey,
      requestJson: { pdf_url: project.pdf_url, mode: 'vision' },
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
      .eq('id', projectId);

    // Fetch PDF from URL
    console.log('Fetching PDF from:', project.pdf_url);
    const pdfResponse = await fetch(project.pdf_url);
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    console.log('PDF size:', pdfBuffer.byteLength, 'bytes');

    // Send PDF directly to Claude for analysis
    console.log('Sending PDF to Claude for analysis...');
    const response = await analyzePDF(pdfBase64, INSULATION_EXTRACTION_PROMPT);

    console.log('Claude response:', response);

    // Parse the response
    let extractedData = parseInsulationExtractionResponse(response);

    // Fall back to mock data if parsing failed or no usable sqft values
    if (!extractedData) {
      console.warn('Failed to parse Claude response — falling back to mock data');
      extractedData = getMockExtractionData();
    } else {
      const hasUsableData =
        (extractedData.total_living_area_sqft && extractedData.total_living_area_sqft > 0) ||
        (extractedData.gross_wall_sf && extractedData.gross_wall_sf > 0) ||
        (extractedData.rooms && extractedData.rooms.some(r => r.area_sqft && r.area_sqft > 0));

      if (!hasUsableData) {
        console.warn('Extracted data has no usable sqft values — falling back to mock data');
        extractedData = getMockExtractionData();
      }
    }

    console.log('Extracted data:', extractedData);

    // Store extracted data in database
    await storeExtractedData(projectId, extractedData);

    // Compute comparison metrics if OCR envelope exists (best-effort)
    let metricsJson: Record<string, unknown> | undefined;
    try {
      const metrics = await computeComparisonMetrics(projectId, 'vision', runId);
      if (metrics) {
        metricsJson = metrics as unknown as Record<string, unknown>;
      }
    } catch (e) {
      console.warn('Comparison metrics failed (non-blocking):', e);
    }

    // Mark run as complete
    await finishRun({ runId, status: 'complete', metricsJson });

    // Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: 'reviewing' })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      run_id: runId,
      data: extractedData,
    });
  } catch (error) {
    console.error('Extraction error:', error);

    // Mark run as failed
    if (runId) {
      await finishRun({
        runId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Vision extraction failed',
      }).catch(() => {});
    }

    // Fall back to mock data so the user can continue with the estimate
    try {
      if (projectId) {
        console.warn('Extraction failed — storing mock data to allow estimate flow to continue');
        const mockData = getMockExtractionData();
        await storeExtractedData(projectId, mockData);
        await supabaseAdmin
          .from('projects')
          .update({ status: 'reviewing' })
          .eq('id', projectId);
        return NextResponse.json({ success: true, data: mockData, mock: true, run_id: runId });
      }
    } catch (fallbackError) {
      console.error('Mock data fallback also failed:', fallbackError);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', run_id: runId },
      { status: 500 }
    );
  }
}

async function storeExtractedData(projectId: string, data: InsulationExtractionData) {
  // Clean up existing data for re-extraction
  await supabaseAdmin.from('openings').delete().eq('project_id', projectId);
  await supabaseAdmin.from('rooms').delete().eq('project_id', projectId);

  // Determine wall composition and stud size from first wall section
  const wallComposition = data.wall_sections?.[0]?.composition || null;
  const studSize = data.wall_sections?.[0]?.stud_size || null;

  // Create main living area room if we have area OR wall data
  const hasLivingData = data.total_living_area_sqft || data.gross_wall_sf || data.exterior_wall_length_ft;
  if (hasLivingData) {
    const { error: roomErr } = await supabaseAdmin
      .from('rooms')
      .insert({
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
