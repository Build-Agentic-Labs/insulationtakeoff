import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const PDFENGINE_URL = process.env.PDFENGINE_URL ?? 'http://178.104.21.251:8000';

export async function POST(request: NextRequest) {
  try {
    const { document_id, page_index, bbox, dpi = 150 } = await request.json();

    if (!document_id || page_index == null || !bbox) {
      return NextResponse.json(
        { error: 'document_id, page_index, and bbox required' },
        { status: 400 }
      );
    }

    // Get document PDF URL from Supabase
    const supabase = supabaseAdmin;
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('file_url')
      .eq('id', document_id)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Call pdfengine region analysis endpoint
    const res = await fetch(`${PDFENGINE_URL}/takeoff/analyze-region`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: doc.file_url,
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
