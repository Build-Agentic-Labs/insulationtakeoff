import { type NextRequest } from 'next/server';
import { updateAuthSession } from '@/lib/supabase/session';

export async function proxy(request: NextRequest) {
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
