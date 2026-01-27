import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { analyzePDF } from '@/lib/ai/claude-client';
import { parseInsulationExtractionResponse, InsulationExtractionData } from '@/lib/ai/parsers';
import { INSULATION_EXTRACTION_PROMPT } from '@/lib/ai/prompts';

export async function POST(request: NextRequest) {
  try {
    const { projectId } = await request.json();

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
    const extractedData = parseInsulationExtractionResponse(response);

    if (!extractedData) {
      console.error('Failed to parse Claude response');
      await supabaseAdmin
        .from('projects')
        .update({ status: 'uploaded' })
        .eq('id', projectId);
      return NextResponse.json(
        { error: 'Failed to parse extraction results' },
        { status: 500 }
      );
    }

    console.log('Extracted data:', extractedData);

    // Store extracted data in database
    await storeExtractedData(projectId, extractedData);

    // Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: 'reviewing' })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      data: extractedData,
    });
  } catch (error) {
    console.error('Extraction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
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

  // Create main living area room if present
  if (data.total_living_area_sqft) {
    await supabaseAdmin
      .from('rooms')
      .insert({
        project_id: projectId,
        name: 'Main Living Area',
        type: 'living',
        area_sqft: data.total_living_area_sqft,
        height_ft: data.wall_height_ft,
        perimeter_ft: data.exterior_wall_length_ft,
        wall_sf: data.gross_wall_sf,
        floor_sf: data.floor_sf,
        ceiling_sf: data.ceiling_sf,
        wall_composition: wallComposition,
        stud_size: studSize,
      });
  }

  // Create garage room if present
  if (data.garage_area_sqft) {
    await supabaseAdmin
      .from('rooms')
      .insert({
        project_id: projectId,
        name: 'Garage',
        type: 'garage',
        area_sqft: data.garage_area_sqft,
        height_ft: data.wall_height_ft,
      });
  }

  // Store individual rooms (skip duplicates of main/garage)
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

      await supabaseAdmin
        .from('rooms')
        .insert({
          project_id: projectId,
          name: extractedRoom.name,
          type: extractedRoom.type || 'living',
          area_sqft: extractedRoom.area_sqft,
        });
    }
  }

  // Store doors in openings table
  if (data.doors && Array.isArray(data.doors)) {
    for (const door of data.doors) {
      await supabaseAdmin
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
    }
  }

  // Store windows in openings table
  if (data.windows && Array.isArray(data.windows)) {
    for (const window of data.windows) {
      await supabaseAdmin
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
    }
  }
}
