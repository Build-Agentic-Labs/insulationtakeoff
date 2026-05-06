import { NextRequest, NextResponse } from 'next/server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import { requireServerCompanyAdmin } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

type SupportStatus = Database['public']['Tables']['support_tickets']['Row']['status'];

const SUPPORT_STATUSES: SupportStatus[] = ['open', 'in_progress', 'resolved'];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { companyId } = await requireServerCompanyAdmin();

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select(`
        *,
        project:projects(id, name),
        attachments:support_ticket_attachments(*)
      `)
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 });
    }

    return NextResponse.json({ ticket: data });
  } catch (error) {
    console.error('Support ticket detail error:', error);
    return authApiErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { companyId, user } = await requireServerCompanyAdmin();
    const body = await request.json();

    if (!SUPPORT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid support ticket status' }, { status: 400 });
    }

    const status = body.status as SupportStatus;
    const now = new Date().toISOString();
    const updates: Database['public']['Tables']['support_tickets']['Update'] = {
      status,
      resolved_by: status === 'resolved' ? user.id : null,
      resolved_at: status === 'resolved' ? now : null,
    };

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select(`
        *,
        project:projects(id, name),
        attachments:support_ticket_attachments(*)
      `)
      .single();

    if (error || !data) {
      console.error('Support ticket update error:', error);
      return NextResponse.json({ error: 'Failed to update support ticket' }, { status: 500 });
    }

    return NextResponse.json({ success: true, ticket: data });
  } catch (error) {
    console.error('Support ticket update error:', error);
    return authApiErrorResponse(error);
  }
}
