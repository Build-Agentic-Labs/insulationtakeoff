import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CLASSIFY_PROMPT = `You are an expert architectural blueprint analyst. I'm showing you thumbnail images of pages from a residential construction blueprint set.

For EACH page (numbered starting from 1), determine:
1. **page_type**: What kind of drawing is this?
   - "floor_plan" — shows room layout, walls, doors, windows with dimensions (MOST USEFUL for insulation takeoff)
   - "elevation" — side view of the building exterior
   - "section" — cross-section cut through the building
   - "foundation" — foundation/footing plan
   - "roof" — roof framing or plan
   - "site" — site plan showing lot, setbacks, utilities
   - "schedule" — tables of doors, windows, finishes
   - "detail" — construction details, callouts
   - "title" — title block, cover sheet
   - "electrical" — electrical plan
   - "plumbing" — plumbing plan
   - "other" — anything else

2. **page_name**: Extract the actual title/name printed on the drawing (e.g., "MAIN FLOOR PLAN", "LOWER LEVEL", "WEST ELEVATION"). If no title is visible, describe it briefly.

3. **has_dimensions**: Does this page show wall dimensions (dimension strings like 14'-0", 9'-0", etc.)? true/false

4. **is_floor_plan**: Is this a floor plan useful for measuring exterior wall lengths? true/false. Only floor plans with visible dimension chains are useful.

5. **confidence**: How confident are you in this classification? 0.0-1.0

Return ONLY a valid JSON array, one object per page in order:
[
  { "page_number": 1, "page_type": "...", "page_name": "...", "has_dimensions": true/false, "is_floor_plan": true/false, "confidence": 0.95 },
  ...
]`;

export async function POST(request: NextRequest) {
  try {
    const { pages } = await request.json();

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { error: 'pages array with base64 images is required' },
        { status: 400 }
      );
    }

    // Build content array: all page thumbnails + the classification prompt
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (let i = 0; i < pages.length; i++) {
      content.push({
        type: 'text',
        text: `--- Page ${i + 1} ---`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: pages[i].image_base64,
        },
      });
    }

    content.push({
      type: 'text',
      text: CLASSIFY_PROMPT,
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    });

    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({
        pages: [],
        error: 'Could not parse classification response',
      });
    }

    let classified: Array<{
      page_number: number;
      page_type: string;
      page_name: string;
      has_dimensions: boolean;
      is_floor_plan: boolean;
      confidence: number;
    }>;

    try {
      classified = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({
        pages: [],
        error: 'Failed to parse classification JSON',
      });
    }

    // Validate and normalize
    const results = classified.map((p, i) => ({
      page_index: (p.page_number ?? i + 1) - 1,
      page_type: p.page_type ?? 'other',
      page_name: p.page_name ?? `Page ${i + 1}`,
      has_dimensions: p.has_dimensions ?? false,
      is_floor_plan: p.is_floor_plan ?? false,
      confidence: Math.min(1, Math.max(0, p.confidence ?? 0.5)),
    }));

    return NextResponse.json({ pages: results });
  } catch (error: any) {
    console.error('Page classification error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error', pages: [] },
      { status: 500 }
    );
  }
}
