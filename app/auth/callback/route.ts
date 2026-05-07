import { NextRequest } from 'next/server';
import { handleSupabaseAuthRedirect } from '@/lib/supabase/auth-redirect';

export async function GET(request: NextRequest) {
  return handleSupabaseAuthRedirect(request);
}
