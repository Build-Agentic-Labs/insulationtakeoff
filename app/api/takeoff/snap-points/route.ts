import { NextRequest, NextResponse } from 'next/server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { createSignedStorageUrl } from '@/lib/supabase/storage';

const PDFENGINE_URL = process.env.PDFENGINE_BASE_URL ?? process.env.PDFENGINE_URL ?? '';

export async function POST(request: NextRequest) {
  try {
    const companyId = await requireServerCompanyId();
    const body = await request.json();
    const pdfUrl = typeof body.pdf_url === 'string' ? body.pdf_url : '';
    const pageIndex = typeof body.page_index === 'number' ? body.page_index : null;

    if (!pdfUrl || pageIndex === null) {
      return NextResponse.json(
        { error: 'pdf_url and page_index are required' },
        { status: 400 }
      );
    }

    if (!PDFENGINE_URL) {
      return NextResponse.json(
        { error: 'PDF extraction engine is not configured' },
        { status: 503 }
      );
    }

    const signedPdfUrl = await createSignedStorageUrl(pdfUrl, companyId);
    const response = await fetch(`${PDFENGINE_URL}/snap/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: signedPdfUrl,
        page_index: pageIndex,
        min_line_length: typeof body.min_line_length === 'number' ? body.min_line_length : 10,
        min_connections: typeof body.min_connections === 'number' ? body.min_connections : 2,
      }),
    });

    const responseText = await response.text();
    return new NextResponse(responseText, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error('Snap points error:', error);
    return authApiErrorResponse(error);
  }
}
