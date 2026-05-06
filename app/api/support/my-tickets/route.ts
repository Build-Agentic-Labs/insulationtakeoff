import { NextRequest, NextResponse } from 'next/server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import { requireServerCompanyMembership } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import { SUPPORT_TICKET_WITH_THREAD_SELECT } from '@/lib/support/tickets';

type SupportStatus = Database['public']['Tables']['support_tickets']['Row']['status'];

const SUPPORT_STATUSES: SupportStatus[] = ['open', 'in_progress', 'resolved'];

export async function GET(request: NextRequest) {
  try {
    const { companyId, user } = await requireServerCompanyMembership();
    const status = request.nextUrl.searchParams.get('status');

    let query = supabaseAdmin
      .from('support_tickets')
      .select(SUPPORT_TICKET_WITH_THREAD_SELECT)
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (status && SUPPORT_STATUSES.includes(status as SupportStatus)) {
      query = query.eq('status', status as SupportStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error('My support ticket list error:', error);
      return NextResponse.json({ error: 'Failed to load your support tickets' }, { status: 500 });
    }

    return NextResponse.json({ tickets: data ?? [] });
  } catch (error) {
    console.error('My support ticket list error:', error);
    return authApiErrorResponse(error);
  }
}
