import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude-client';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';

/**
 * POST /api/takeoff/suggest-traces
 * Send a floor plan page to Claude Vision and get back room boundary polygons.
 */
export async function POST(request: NextRequest) {
  try {
    await requireServerCompanyId();
    const body = await request.json();
    const { image_base64, page_width, page_height } = body as {
      image_base64: string;
      page_width: number;
      page_height: number;
    };

    if (!image_base64) {
      return NextResponse.json({ error: 'image_base64 required' }, { status: 400 });
    }

    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: image_base64 },
          },
          {
            type: 'text',
            text: `This is a residential floor plan image that is ${page_width} x ${page_height} pixels.

Identify EVERY distinct room/space visible in this floor plan. For each room, provide the boundary polygon as pixel coordinates (x,y pairs) that trace the room's walls.

Rules:
- Include ALL rooms: bedrooms, bathrooms, kitchen, living rooms, garage, closets, hallways, utility rooms, storage areas
- The polygon should follow the INTERIOR wall faces (inside of the room)
- Door openings should be treated as part of the wall line — draw the polygon straight across doorways
- Window locations should also be treated as part of the wall line
- Coordinates are in pixels relative to the image (0,0 = top-left)
- Each polygon should have 4-8 points for rectangular rooms, more for L-shaped or complex rooms
- For each room, also identify: room name, approximate ceiling height if noted, floor material if noted

Return ONLY valid JSON array — no markdown, no explanation:
[
  {
    "room_name": "MASTER BEDROOM",
    "polygon": [{"x": 100, "y": 200}, {"x": 400, "y": 200}, {"x": 400, "y": 500}, {"x": 100, "y": 500}],
    "ceiling_height_ft": 10.08,
    "floor_material": "WOOD",
    "room_type": "bedroom"
  }
]

room_type should be one of: bedroom, bathroom, kitchen, living_room, dining_room, garage, closet, hallway, utility, storage, entry, office, laundry, other`,
          },
        ],
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const rooms = JSON.parse(jsonMatch[0]);
        return NextResponse.json({ success: true, rooms, raw: text });
      } catch {
        return NextResponse.json({ success: true, rooms: [], raw: text, parse_error: 'Failed to parse JSON' });
      }
    }

    return NextResponse.json({ success: true, rooms: [], raw: text });
  } catch (err) {
    const authResponse = authApiErrorResponse(err);
    if (authResponse.status !== 500) return authResponse;

    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
