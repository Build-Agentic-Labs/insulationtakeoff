import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { Database } from './types';

function getSupabaseSessionEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return { supabaseUrl, supabaseAnonKey };
}

export async function createServerSupabaseClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseSessionEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

export async function updateAuthSession(request: NextRequest) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseSessionEnv();
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginRoute = pathname === '/login';
  const isAuthRoute = pathname.startsWith('/auth/');
  const isCompanySetupRoute = pathname === '/company/setup';
  const isCompanyInviteRoute = pathname.startsWith('/company/invite/');

  if (!user && !isLoginRoute && !isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isLoginRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (user && !isCompanySetupRoute && !isCompanyInviteRoute && !isAuthRoute) {
    const { data: memberships, error: membershipError } = await supabase
      .from('company_members')
      .select('company_id, company:companies(onboarding_completed)')
      .limit(1);

    if (!membershipError && memberships.length === 0) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/company/setup';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }

    const company = memberships?.[0]?.company;
    const onboardingCompleted = Array.isArray(company)
      ? company[0]?.onboarding_completed
      : company?.onboarding_completed;

    if (!membershipError && memberships.length > 0 && onboardingCompleted === false) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/company/setup';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}
