import { NextRequest, NextResponse } from 'next/server';
import { sendSupportMessageEmail } from '@/lib/email/support';
import { getAppBaseUrl, getResendClient, getSupportEmailTo } from '@/lib/email/resend';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import {
  extractEmailAddress,
  extractSupportTicketIdFromAddresses,
  getConfiguredSupportEmails,
  getSupportTicketReplyAddress,
  htmlToPlainText,
  normalizeEmailAddress,
  stripQuotedEmailText,
} from '@/lib/support/tickets';

type SupportAuthorRole = Database['public']['Tables']['support_ticket_messages']['Row']['author_role'];
type SupportMessageInsert = Database['public']['Tables']['support_ticket_messages']['Insert'];

interface ResendReceivedEmailEvent {
  type: string;
  data?: {
    email_id?: string;
    to?: string[];
    from?: string;
  };
}

function verifyResendWebhook(payload: string, request: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error('RESEND_WEBHOOK_SECRET is not configured');
  }

  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');

  if (!id || !timestamp || !signature) {
    throw new Error('Missing Resend webhook signature headers');
  }

  return getResendClient().webhooks.verify({
    payload,
    headers: {
      id,
      timestamp,
      signature,
    },
    webhookSecret,
  }) as ResendReceivedEmailEvent;
}

function getInboundBody(text: string | null, html: string | null) {
  const source = text?.trim() || (html ? htmlToPlainText(html) : '');
  return stripQuotedEmailText(source);
}

async function notifyForInboundMessage(options: {
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

export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    const event = verifyResendWebhook(payload, request);

    if (event.type !== 'email.received' || !event.data?.email_id) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const resend = getResendClient();
    const { data: receivedEmail, error: receivedEmailError } = await resend.emails.receiving.get(event.data.email_id);

    if (receivedEmailError || !receivedEmail) {
      throw new Error(receivedEmailError?.message || 'Failed to fetch received support email');
    }

    const ticketId = extractSupportTicketIdFromAddresses([
      ...(receivedEmail.to ?? []),
      ...(event.data.to ?? []),
    ]);

    if (!ticketId) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'no_ticket_address' });
    }

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('support_tickets')
      .select('id, company_id, user_id, submitter_email, subject, status')
      .eq('id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'ticket_not_found' });
    }

    const fromEmail = normalizeEmailAddress(receivedEmail.from || event.data.from);
    const submitterEmail = normalizeEmailAddress(ticket.submitter_email);
    const supportEmails = getConfiguredSupportEmails();

    let authorRole: SupportAuthorRole | null = null;

    if (fromEmail && submitterEmail && fromEmail === submitterEmail) {
      authorRole = 'customer';
    } else if (fromEmail && supportEmails.includes(fromEmail)) {
      authorRole = 'support';
    }

    if (!authorRole || !fromEmail) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'sender_not_allowed' });
    }

    const messageBody = getInboundBody(receivedEmail.text, receivedEmail.html);

    if (messageBody.length < 1) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'empty_message' });
    }

    const messagePayload: SupportMessageInsert = {
      ticket_id: ticket.id,
      company_id: ticket.company_id,
      author_user_id: authorRole === 'customer' ? ticket.user_id : null,
      author_email: extractEmailAddress(receivedEmail.from) ?? fromEmail,
      author_role: authorRole,
      body: messageBody,
      source: 'email',
      inbound_email_id: receivedEmail.id,
      inbound_message_id: receivedEmail.message_id,
      notification_status: 'pending',
      created_at: receivedEmail.created_at,
    };

    const { data: message, error: messageError } = await supabaseAdmin
      .from('support_ticket_messages')
      .upsert(messagePayload, {
        onConflict: 'inbound_email_id',
        ignoreDuplicates: true,
      })
      .select()
      .maybeSingle();

    if (messageError) {
      console.error('Inbound support message insert error:', messageError);
      throw new Error('Failed to save inbound support reply');
    }

    if (!message) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const nextStatus = authorRole === 'support' ? 'in_progress' : 'open';
    await supabaseAdmin
      .from('support_tickets')
      .update({
        status: nextStatus,
        resolved_by: null,
        resolved_at: null,
      })
      .eq('id', ticket.id)
      .eq('company_id', ticket.company_id);

    let notificationStatus: 'sent' | 'failed' = 'sent';
    let outboundEmailId: string | null = null;
    let notificationError: string | null = null;

    try {
      const recipientEmail = authorRole === 'support'
        ? ticket.submitter_email
        : getSupportEmailTo();

      outboundEmailId = await notifyForInboundMessage({
        ticketId: ticket.id,
        subject: ticket.subject,
        body: messageBody,
        authorEmail: fromEmail,
        authorRole,
        recipientEmail,
      });
    } catch (error) {
      notificationStatus = 'failed';
      notificationError = error instanceof Error ? error.message : 'Failed to send inbound support notification';
      console.error('Inbound support notification error:', error);
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
      .eq('company_id', ticket.company_id);

    return NextResponse.json({
      ok: true,
      ticketId: ticket.id,
      messageId: message.id,
      notificationStatus,
    });
  } catch (error) {
    console.error('Support inbound webhook error:', error);
    return NextResponse.json({ error: 'Failed to process inbound support email' }, { status: 500 });
  }
}
