import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { createSignedStorageUrl } from '@/lib/supabase/storage';

const PDFENGINE_URL = process.env.PDFENGINE_BASE_URL ?? process.env.PDFENGINE_URL ?? '';
const USE_MOCK = !PDFENGINE_URL && process.env.NODE_ENV !== 'production';

export async function POST(request: NextRequest) {
  try {
    const { document_id, page_index, bbox, dpi = 150 } = await request.json();
    const companyId = await requireServerCompanyId();

    if (!document_id || page_index == null || !bbox) {
      return NextResponse.json(
        { error: 'document_id, page_index, and bbox required' },
        { status: 400 }
      );
    }

    // Mock mode: return realistic fake data so the UI is fully testable
    if (USE_MOCK) {
      const wallWidth = bbox.width * 0.6; // rough estimate from bbox
      const mockLength = Math.round(8 + Math.random() * 30); // 8-38 LF
      const mockHeight = [8, 9, 10][Math.floor(Math.random() * 3)];
      const grossSf = mockLength * mockHeight;
      const doorArea = 3 * 6.8; // standard door
      const windowArea = 3 * 4; // standard window
      const hasDoor = Math.random() > 0.4;
      const hasWindow = Math.random() > 0.3;
      const openingsArea = (hasDoor ? doorArea : 0) + (hasWindow ? windowArea : 0);

      return NextResponse.json({
        detected_dimensions: [
          {
            id: crypto.randomUUID(),
            value_ft: mockLength,
            raw_text: `${mockLength}'-0"`,
            confidence: 0.85 + Math.random() * 0.1,
            position: { x: 30, y: 50 },
            selected: true,
          },
        ],
        suggested_wall_length_lf: mockLength,
        detected_height_ft: mockHeight,
        openings: [
          ...(hasDoor
            ? [
                {
                  id: crypto.randomUUID(),
                  type: 'door' as const,
                  width_ft: 3,
                  height_ft: 6.8,
                  area_sf: doorArea,
                  confidence: 0.9,
                  label: "3'-0\" × 6'-8\" Door",
                },
              ]
            : []),
          ...(hasWindow
            ? [
                {
                  id: crypto.randomUUID(),
                  type: 'window' as const,
                  width_ft: 3,
                  height_ft: 4,
                  area_sf: windowArea,
                  confidence: 0.85,
                  label: "3'-0\" × 4'-0\" Window",
                },
              ]
            : []),
        ],
        gross_sf: grossSf,
        net_sf: Math.max(0, grossSf - openingsArea),
        confidence: 0.82,
      });
    }

    if (!PDFENGINE_URL) {
      return NextResponse.json(
        { error: 'PDF extraction engine is not configured' },
        { status: 503 }
      );
    }

    // Production mode: call pdfengine
    const supabase = supabaseAdmin;
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('file_url')
      .eq('id', document_id)
      .eq('company_id', companyId)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const signedPdfUrl = await createSignedStorageUrl(doc.file_url, companyId);

    const res = await fetch(`${PDFENGINE_URL}/takeoff/analyze-region`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: signedPdfUrl,
        page_index,
        bbox,
        dpi,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `pdfengine error: ${errText}` },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Region analysis error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
