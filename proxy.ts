import { NextResponse, type NextRequest } from 'next/server';
import { updateAuthSession } from '@/lib/supabase/session';
import { resolveLegacyTakeoffRedirectPath } from '@/lib/takeoff/navigation';

export async function proxy(request: NextRequest) {
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
