import type { EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from './session';

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return Boolean(value && EMAIL_OTP_TYPES.has(value as EmailOtpType));
}

function getSafeNextPath(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next') ?? '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

function createAppRedirect(request: NextRequest, path: string) {
  return new URL(path, request.nextUrl.origin);
}

function createLoginRedirect(request: NextRequest, error: string) {
  const url = createAppRedirect(request, '/login');
  url.searchParams.set('error', error);
  return url;
}

export async function handleSupabaseAuthRedirect(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const redirectTo = createAppRedirect(request, getSafeNextPath(request));
  const supabase = await createServerSupabaseClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(redirectTo);

    const loginUrl = createLoginRedirect(request, 'auth_callback_failed');
    loginUrl.searchParams.set('details', error.message);
    return NextResponse.redirect(loginUrl);
  }

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) return NextResponse.redirect(redirectTo);

    const loginUrl = createLoginRedirect(request, 'auth_confirmation_failed');
    loginUrl.searchParams.set('details', error.message);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(createLoginRedirect(request, 'missing_auth_token'));
}
