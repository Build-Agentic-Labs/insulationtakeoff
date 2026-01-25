import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { analyzePDF } from '@/lib/ai/claude-client';
import { parseFloorPlanResponse, validateFloorPlanData } from '@/lib/ai/parsers';

const EXTRACTION_PROMPT = `You are analyzing architectural floor plans to extract insulation-related measurements.

Analyze this PDF document and extract ALL measurements relevant for insulation quoting:

1. **Total Living Area** - Look for labels like "TOTAL LIVING AREA", "LIVING AREA", "HEATED AREA", or similar. This is typically shown in square feet.

2. **Garage Area** - Look for garage square footage, often labeled separately.

3. **Individual Rooms** - Extract dimensions (length x width) or area for each labeled room.

4. **Wall Heights** - Look for section views that show wall heights (floor to ceiling).

5. **Building Perimeter** - If shown, extract the total perimeter length.

Return your response as a JSON object with this EXACT structure:
{
  "living_area_sqft": <number or null>,
  "garage_area_sqft": <number or null>,
  "wall_height_ft": <number or null>,
  "perimeter_ft": <number or null>,
  "rooms": [
    {
      "name": "<room name>",
      "type": "living" | "garage" | "attic" | "crawlspace",
      "area_sqft": <number or null>,
      "length_ft": <number or null>,
      "width_ft": <number or null>
    }
  ],
  "confidence": <number between 0 and 1>
}

IMPORTANT:
- Only include values you can clearly see in the document
- Use null for any values not found
- For the sample PDF provided, look specifically for the "TOTAL LIVING AREA" and "GARAGE" labels
- The confidence should reflect how certain you are about the extracted data
- Return ONLY the JSON object, no other text`;

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
    const response = await analyzePDF(pdfBase64, EXTRACTION_PROMPT);

    console.log('Claude response:', response);

    // Parse the response
    const extractedData = parseFloorPlanResponse(response);

    if (!extractedData) {
      console.error('Failed to parse Claude response');
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

async function storeExtractedData(projectId: string, data: any) {
  // Create main living area room if present
  if (data.living_area_sqft) {
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .insert({
        project_id: projectId,
        name: 'Main Living Area',
        type: 'living',
        area_sqft: data.living_area_sqft,
        height_ft: data.wall_height_ft,
        perimeter_ft: data.perimeter_ft,
      })
      .select()
      .single();

    if (room) {
      await supabaseAdmin.from('measurements').insert({
        room_id: room.id,
        field: 'area_sqft',
        extracted_value: data.living_area_sqft,
        source_page: 1,
        confidence: data.confidence,
      });

      if (data.wall_height_ft) {
        await supabaseAdmin.from('measurements').insert({
          room_id: room.id,
          field: 'height_ft',
          extracted_value: data.wall_height_ft,
          source_page: 1,
          confidence: data.confidence,
        });
      }

      if (data.perimeter_ft) {
        await supabaseAdmin.from('measurements').insert({
          room_id: room.id,
          field: 'perimeter_ft',
          extracted_value: data.perimeter_ft,
          source_page: 1,
          confidence: data.confidence,
        });
      }
    }
  }

  // Create garage room if present
  if (data.garage_area_sqft) {
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .insert({
        project_id: projectId,
        name: 'Garage',
        type: 'garage',
        area_sqft: data.garage_area_sqft,
        height_ft: data.wall_height_ft,
      })
      .select()
      .single();

    if (room) {
      await supabaseAdmin.from('measurements').insert({
        room_id: room.id,
        field: 'area_sqft',
        extracted_value: data.garage_area_sqft,
        source_page: 1,
        confidence: data.confidence,
      });
    }
  }

  // Store individual rooms
  if (data.rooms && Array.isArray(data.rooms)) {
    for (const extractedRoom of data.rooms) {
      if (!extractedRoom.area_sqft && !extractedRoom.length_ft && !extractedRoom.width_ft) {
        continue;
      }

      const { data: room } = await supabaseAdmin
        .from('rooms')
        .insert({
          project_id: projectId,
          name: extractedRoom.name,
          type: extractedRoom.type || 'living',
          area_sqft: extractedRoom.area_sqft,
        })
        .select()
        .single();

      if (room) {
        if (extractedRoom.area_sqft) {
          await supabaseAdmin.from('measurements').insert({
            room_id: room.id,
            field: 'area_sqft',
            extracted_value: extractedRoom.area_sqft,
            source_page: 1,
            confidence: data.confidence,
          });
        }

        if (extractedRoom.length_ft) {
          await supabaseAdmin.from('measurements').insert({
            room_id: room.id,
            field: 'length_ft',
            extracted_value: extractedRoom.length_ft,
            source_page: 1,
            confidence: data.confidence,
          });
        }

        if (extractedRoom.width_ft) {
          await supabaseAdmin.from('measurements').insert({
            room_id: room.id,
            field: 'width_ft',
            extracted_value: extractedRoom.width_ft,
            source_page: 1,
            confidence: data.confidence,
          });
        }
      }
    }
  }
}
