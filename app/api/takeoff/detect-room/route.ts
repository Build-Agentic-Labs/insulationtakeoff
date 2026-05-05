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
    const clickX = typeof body.click_x === 'number' ? body.click_x : null;
    const clickY = typeof body.click_y === 'number' ? body.click_y : null;

    if (!pdfUrl || pageIndex === null || clickX === null || clickY === null) {
      return NextResponse.json(
        { error: 'pdf_url, page_index, click_x, and click_y are required' },
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
    const response = await fetch(`${PDFENGINE_URL}/room/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_url: signedPdfUrl,
        page_index: pageIndex,
        click_x: clickX,
        click_y: clickY,
        dilation_px: typeof body.dilation_px === 'number' ? body.dilation_px : 5,
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
    console.error('Room detect error:', error);
    return authApiErrorResponse(error);
  }
}
