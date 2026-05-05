import { NextRequest, NextResponse } from 'next/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { createSignedStorageUrl } from '@/lib/supabase/storage';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';

export async function GET(request: NextRequest) {
  try {
    const companyId = await requireServerCompanyId();
    const path = request.nextUrl.searchParams.get('path');

    if (!path) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 });
    }

    const signedUrl = await createSignedStorageUrl(path, companyId, 300);
    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error('Storage file error:', error);
    return authApiErrorResponse(error);
  }
}
