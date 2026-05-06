import { NextRequest, NextResponse } from 'next/server';
import { sendSupportMessageEmail } from '@/lib/email/support';
import { getAppBaseUrl, getSupportEmailTo } from '@/lib/email/resend';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import { requireServerCompanyMembership } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import { getSupportTicketReplyAddress, SUPPORT_TICKET_WITH_THREAD_SELECT } from '@/lib/support/tickets';

type SupportMessageInsert = Database['public']['Tables']['support_ticket_messages']['Insert'];
type SupportAuthorRole = Database['public']['Tables']['support_ticket_messages']['Row']['author_role'];

function getMessageBody(value: unknown) {
  return String(value ?? '').trim().slice(0, 5000);
}

async function loadTicket(ticketId: string, companyId: string) {
  return supabaseAdmin
    .from('support_tickets')
    .select(SUPPORT_TICKET_WITH_THREAD_SELECT)
    .eq('id', ticketId)
    .eq('company_id', companyId)
    .single();
}

async function notifyForMessage(options: {
  ticketId: string;
  subject: string;
  body: string;
  authorEmail: string;
  authorRole: SupportAuthorRole;
  recipientEmail: string | string[];
}) {
  const actionPath = options.authorRole === 'support'
    ? `/support/tickets?ticket=${encodeURIComponent(options.ticketId)}`
    : `/support?ticket=${encodeURIComponent(options.ticketId)}`;
  const recipientLabel = options.authorRole === 'support' ? 'Customer ticket page' : 'Admin support inbox';

  return sendSupportMessageEmail({
    ticketId: options.ticketId,
    subject: options.subject,
    message: options.body,
    authorEmail: options.authorEmail,
    actionUrl: `${getAppBaseUrl()}${actionPath}`,
    recipientLabel,
    to: options.recipientEmail,
    fromDisplayEmail: options.authorRole === 'customer' ? options.authorEmail : null,
    replyToAddress: getSupportTicketReplyAddress(options.ticketId),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { companyId, user, role } = await requireServerCompanyMembership();
    const body = await request.json().catch(() => ({}));
    const messageBody = getMessageBody(body.message);

    if (messageBody.length < 1) {
      return NextResponse.json({ error: 'Reply message is required' }, { status: 400 });
    }

    const { data: ticket, error: ticketError } = await loadTicket(id, companyId);

    if (ticketError || !ticket) {
      return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 });
    }

    const isAdmin = role === 'owner' || role === 'admin';
    const isSubmitter = ticket.user_id === user.id;
    const requestedRole = body.authorRole === 'support' ? 'support' : 'customer';

    if (requestedRole === 'support' && !isAdmin) {
      return NextResponse.json({ error: 'Workspace admin access required' }, { status: 403 });
    }

    if (requestedRole === 'customer' && !isSubmitter) {
      return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 });
    }

    const authorRole = requestedRole as SupportAuthorRole;
    const authorEmail = user.email ?? 'unknown user';
    const messagePayload: SupportMessageInsert = {
      ticket_id: ticket.id,
      company_id: companyId,
      author_user_id: user.id,
      author_email: authorEmail,
      author_role: authorRole,
      body: messageBody,
      source: 'app',
      notification_status: 'pending',
    };

    const { data: message, error: messageError } = await supabaseAdmin
      .from('support_ticket_messages')
      .insert(messagePayload)
      .select()
      .single();

    if (messageError || !message) {
      console.error('Support message insert error:', messageError);
      return NextResponse.json({ error: 'Failed to save support reply' }, { status: 500 });
    }

    const nextStatus = authorRole === 'support' ? 'in_progress' : 'open';
    const { error: statusError } = await supabaseAdmin
      .from('support_tickets')
      .update({
        status: nextStatus,
        resolved_by: null,
        resolved_at: null,
      })
      .eq('id', ticket.id)
      .eq('company_id', companyId);

    if (statusError) {
      console.error('Support message status update error:', statusError);
    }

    let notificationStatus: 'sent' | 'failed' | 'skipped' = 'sent';
    let outboundEmailId: string | null = null;
    let notificationError: string | null = null;

    try {
      const recipientEmail = authorRole === 'support'
        ? ticket.submitter_email
        : getSupportEmailTo();

      outboundEmailId = await notifyForMessage({
        ticketId: ticket.id,
        subject: ticket.subject,
        body: messageBody,
        authorEmail,
        authorRole,
        recipientEmail,
      });
    } catch (error) {
      notificationStatus = 'failed';
      notificationError = error instanceof Error ? error.message : 'Failed to send support reply notification';
      console.error('Support message notification error:', error);
    }

    await supabaseAdmin
      .from('support_ticket_messages')
      .update({
        notification_status: notificationStatus,
        outbound_email_id: outboundEmailId,
        notification_error: notificationError,
        notified_at: notificationStatus === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', message.id)
      .eq('company_id', companyId);

    const { data: updatedTicket, error: updatedTicketError } = await loadTicket(ticket.id, companyId);

    if (updatedTicketError || !updatedTicket) {
      return NextResponse.json({ error: 'Failed to load support ticket' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      ticket: updatedTicket,
      notificationStatus,
    });
  } catch (error) {
    console.error('Support message error:', error);
    return authApiErrorResponse(error);
  }
}
