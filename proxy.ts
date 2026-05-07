import { NextResponse, type NextRequest } from 'next/server';
import { updateAuthSession } from '@/lib/supabase/session';
import { resolveLegacyTakeoffRedirectPath } from '@/lib/takeoff/navigation';

function hasSupabaseAuthParams(request: NextRequest) {
  return request.nextUrl.searchParams.has('code') || request.nextUrl.searchParams.has('token_hash');
}

function createSupabaseAuthRedirect(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  const nextSearchParams = new URLSearchParams(request.nextUrl.searchParams);
  nextSearchParams.delete('code');
  nextSearchParams.delete('token_hash');
  nextSearchParams.delete('type');

  const nextSearch = nextSearchParams.toString();
  const nextPath = `${request.nextUrl.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
  redirectUrl.pathname = '/auth/callback';
  redirectUrl.searchParams.set('next', nextPath);
  return redirectUrl;
}

export async function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/auth/') && hasSupabaseAuthParams(request)) {
    return NextResponse.redirect(createSupabaseAuthRedirect(request));
  }

  const legacyTakeoffRedirectPath = resolveLegacyTakeoffRedirectPath(request.nextUrl.pathname);
  if (legacyTakeoffRedirectPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = legacyTakeoffRedirectPath.split('?')[0];
    redirectUrl.search = legacyTakeoffRedirectPath.split('?')[1] ?? '';
    return NextResponse.redirect(redirectUrl);
  }

  return updateAuthSession(request);
}

export const config = {
  matcher: [
    /*
     * Protect app pages. API route authorization will be tightened per route in
     * the tenancy phase so JSON error handling stays explicit.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
