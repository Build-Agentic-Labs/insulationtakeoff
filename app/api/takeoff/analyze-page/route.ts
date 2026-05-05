import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude-client';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';

interface WallRegion {
  label: string;
  wall_type: 'exterior' | 'garage';
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const VISION_PROMPT = `You are an expert at identifying exterior wall regions on architectural floor plans and blueprints.

Analyze this PDF page image and identify all exterior wall sections. For each wall region, provide:
1. A descriptive label (e.g., "North Wall", "East Wall", "Garage Wall", etc.)
2. Wall type: either "exterior" for main building exterior walls, or "garage" for garage walls
3. Bounding box coordinates as percentages (0-100) of the image dimensions:
   - x: left edge percentage
   - y: top edge percentage
   - width: region width as percentage of image width
   - height: region height as percentage of image height

Return ONLY a valid JSON array with no additional text. Each element should have the structure:
{
  "label": "string",
  "wall_type": "exterior" or "garage",
  "bbox": {
    "x": number 0-100,
    "y": number 0-100,
    "width": number 0-100,
    "height": number 0-100
  }
}

Focus on continuous wall sections and avoid overlapping regions. If you cannot identify clear wall regions, return an empty array [].`;

export async function POST(request: NextRequest) {
  try {
    await requireServerCompanyId();
    const { image_base64, page_index } = await request.json();

    // Validate inputs
    if (!image_base64 || typeof image_base64 !== 'string') {
      return NextResponse.json(
        { error: 'image_base64 is required and must be a string' },
        { status: 400 }
      );
    }

    if (page_index == null || typeof page_index !== 'number') {
      return NextResponse.json(
        { error: 'page_index is required and must be a number' },
        { status: 400 }
      );
    }

    // Call Claude Vision API
    const message = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image_base64,
              },
            },
            {
              type: 'text',
              text: VISION_PROMPT,
            },
          ],
        },
      ],
    });

    // Extract text response
    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json(
        {
          regions: [],
          page_index,
          error: 'Could not parse JSON from response',
        }
      );
    }

    let regions: WallRegion[];
    try {
      regions = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return NextResponse.json(
        {
          regions: [],
          page_index,
          error: 'Failed to parse wall regions JSON',
        }
      );
    }

    // Validate and clamp regions
    const validatedRegions: WallRegion[] = [];
    for (const region of regions) {
      // Validate required fields
      if (
        !region.label ||
        !region.wall_type ||
        !region.bbox ||
        typeof region.label !== 'string' ||
        !['exterior', 'garage'].includes(region.wall_type)
      ) {
        continue;
      }

      const { x, y, width, height } = region.bbox;

      // Validate bbox is numeric
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof width !== 'number' ||
        typeof height !== 'number'
      ) {
        continue;
      }

      // Clamp values to 0-100
      const clampedRegion: WallRegion = {
        label: region.label,
        wall_type: region.wall_type,
        bbox: {
          x: Math.max(0, Math.min(100, x)),
          y: Math.max(0, Math.min(100, y)),
          width: Math.max(0, Math.min(100, width)),
          height: Math.max(0, Math.min(100, height)),
        },
      };

      validatedRegions.push(clampedRegion);
    }

    return NextResponse.json({
      regions: validatedRegions,
      page_index,
    });
  } catch (error: any) {
    const authResponse = authApiErrorResponse(error);
    if (authResponse.status !== 500) return authResponse;

    console.error('Vision analysis error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Internal server error',
        regions: [],
      },
      { status: 500 }
    );
  }
}
