import { NextRequest, NextResponse } from 'next/server';
import { sendSupportTicketEmail } from '@/lib/email/support';
import { getAppBaseUrl } from '@/lib/email/resend';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import { requireServerCompanyAdmin, requireServerCompanyMembership } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { Database, Json } from '@/lib/supabase/types';
import { SUPPORT_TICKET_WITH_THREAD_SELECT } from '@/lib/support/tickets';
import {
  createSignedStorageUrl,
  MAX_SUPPORT_ATTACHMENTS,
  uploadSupportAttachment,
  validateSupportAttachments,
} from '@/lib/supabase/storage';

type SupportTicketInsert = Database['public']['Tables']['support_tickets']['Insert'];
type SupportAttachmentInsert = Database['public']['Tables']['support_ticket_attachments']['Insert'];
type SupportMessageInsert = Database['public']['Tables']['support_ticket_messages']['Insert'];
type SupportStatus = Database['public']['Tables']['support_tickets']['Row']['status'];

const SUPPORT_STATUSES: SupportStatus[] = ['open', 'in_progress', 'resolved'];
const SUPPORT_ATTACHMENT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

function getTextField(formData: FormData, key: string, maxLength: number) {
  const value = String(formData.get(key) ?? '').trim();
  return value.slice(0, maxLength);
}

function parseBrowserInfo(value: string): Json {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Json;
  } catch {
    return {};
  }
}

function browserInfoSummary(browserInfo: Json) {
  if (!browserInfo || typeof browserInfo !== 'object' || Array.isArray(browserInfo)) return null;
  const info = browserInfo as Record<string, Json | undefined>;
  const parts = [
    typeof info.userAgent === 'string' ? info.userAgent : null,
    typeof info.viewport === 'string' ? `Viewport ${info.viewport}` : null,
    typeof info.language === 'string' ? `Language ${info.language}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

function getAttachmentFiles(formData: FormData) {
  return formData
    .getAll('attachments')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function POST(request: NextRequest) {
  let createdTicketId: string | null = null;
  const uploadedPaths: string[] = [];

  try {
    const { companyId, user } = await requireServerCompanyMembership();
    const formData = await request.formData();
    const subject = getTextField(formData, 'subject', 140);
    const message = getTextField(formData, 'message', 5000);
    const pageUrl = getTextField(formData, 'pageUrl', 2048) || null;
    const projectId = getTextField(formData, 'projectId', 64) || null;
    const browserInfo = parseBrowserInfo(getTextField(formData, 'browserInfo', 4000));
    const attachments = getAttachmentFiles(formData);

    if (subject.length < 3) {
      return NextResponse.json({ error: 'Subject must be at least 3 characters' }, { status: 400 });
    }

    if (message.length < 5) {
      return NextResponse.json({ error: 'Question must be at least 5 characters' }, { status: 400 });
    }

    const attachmentError = validateSupportAttachments(attachments);
    if (attachmentError) {
      return NextResponse.json({ error: attachmentError }, { status: 400 });
    }

    if (attachments.length > MAX_SUPPORT_ATTACHMENTS) {
      return NextResponse.json({ error: `Attach up to ${MAX_SUPPORT_ATTACHMENTS} screenshots` }, { status: 400 });
    }

    let projectName: string | null = null;

    if (projectId) {
      const { data: project, error: projectError } = await supabaseAdmin
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .eq('company_id', companyId)
        .maybeSingle();

      if (projectError || !project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      projectName = project.name;
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .maybeSingle();

    if (companyError || !company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const insertPayload: SupportTicketInsert = {
      company_id: companyId,
      user_id: user.id,
      submitter_email: user.email ?? 'unknown user',
      project_id: projectId,
      subject,
      message,
      page_url: pageUrl,
      browser_info: browserInfo,
    };

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('support_tickets')
      .insert(insertPayload)
      .select()
      .single();

    if (ticketError || !ticket) {
      console.error('Support ticket insert error:', ticketError);
      return NextResponse.json({ error: 'Failed to create support ticket' }, { status: 500 });
    }

    createdTicketId = ticket.id;

    const initialMessagePayload: SupportMessageInsert = {
      ticket_id: ticket.id,
      company_id: companyId,
      author_user_id: user.id,
      author_email: user.email ?? 'unknown user',
      author_role: 'customer',
      body: message,
      source: 'app',
      notification_status: 'pending',
    };

    const { data: initialMessage, error: initialMessageError } = await supabaseAdmin
      .from('support_ticket_messages')
      .insert(initialMessagePayload)
      .select()
      .single();

    if (initialMessageError || !initialMessage) {
      console.error('Support initial message insert error:', initialMessageError);
      throw new Error('Failed to create support ticket message');
    }

    const attachmentRows: SupportAttachmentInsert[] = [];

    for (const [index, file] of attachments.entries()) {
      const uploaded = await uploadSupportAttachment(file, companyId, ticket.id, index);
      uploadedPaths.push(uploaded.storagePath);
      attachmentRows.push({
        ticket_id: ticket.id,
        company_id: companyId,
        storage_path: uploaded.storagePath,
        file_name: uploaded.fileName,
        file_type: uploaded.fileType,
        file_size: uploaded.fileSize,
      });
    }

    if (attachmentRows.length > 0) {
      const { error: attachmentInsertError } = await supabaseAdmin
        .from('support_ticket_attachments')
        .insert(attachmentRows);

      if (attachmentInsertError) {
        console.error('Support attachment insert error:', attachmentInsertError);
        throw new Error('Failed to save support screenshots');
      }
    }

    let notificationStatus: 'sent' | 'failed' = 'sent';
    let notificationId: string | null = null;
    let notificationError: string | null = null;

    try {
      const attachmentLinks = [];

      for (const attachment of attachmentRows) {
        attachmentLinks.push({
          fileName: attachment.file_name,
          url: await createSignedStorageUrl(attachment.storage_path, companyId, SUPPORT_ATTACHMENT_LINK_TTL_SECONDS),
        });
      }

      notificationId = await sendSupportTicketEmail({
        ticketId: ticket.id,
        subject,
        message,
        submitterEmail: user.email ?? 'unknown user',
        companyName: company.name,
        projectName,
        pageUrl,
        browserInfo: browserInfoSummary(browserInfo),
        supportTicketUrl: `${getAppBaseUrl()}/support?ticket=${encodeURIComponent(ticket.id)}`,
        attachmentLinks,
      });
    } catch (error) {
      notificationStatus = 'failed';
      notificationError = error instanceof Error ? error.message : 'Failed to send support email';
      console.error('Support email error:', error);
    }

    await supabaseAdmin
      .from('support_ticket_messages')
      .update({
        notification_status: notificationStatus,
        outbound_email_id: notificationId,
        notification_error: notificationError,
        notified_at: notificationStatus === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', initialMessage.id)
      .eq('company_id', companyId);

    const { data: updatedTicket } = await supabaseAdmin
      .from('support_tickets')
      .update({
        notification_status: notificationStatus,
        notification_id: notificationId,
        notification_error: notificationError,
        notified_at: notificationStatus === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', ticket.id)
      .eq('company_id', companyId)
      .select(SUPPORT_TICKET_WITH_THREAD_SELECT)
      .single();

    return NextResponse.json({
      success: true,
      ticket: updatedTicket ?? ticket,
      notificationStatus,
    });
  } catch (error) {
    console.error('Support ticket error:', error);

    if (uploadedPaths.length > 0) {
      await supabaseAdmin.storage.from('pdfs').remove(uploadedPaths);
    }

    if (createdTicketId) {
      await supabaseAdmin.from('support_tickets').delete().eq('id', createdTicketId);
    }

    return authApiErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireServerCompanyAdmin();
    const status = request.nextUrl.searchParams.get('status');

    let query = supabaseAdmin
      .from('support_tickets')
      .select(SUPPORT_TICKET_WITH_THREAD_SELECT)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (status && SUPPORT_STATUSES.includes(status as SupportStatus)) {
      query = query.eq('status', status as SupportStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Support ticket list error:', error);
      return NextResponse.json({ error: 'Failed to load support tickets' }, { status: 500 });
    }

    return NextResponse.json({ tickets: data ?? [] });
  } catch (error) {
    console.error('Support ticket list error:', error);
    return authApiErrorResponse(error);
  }
}
