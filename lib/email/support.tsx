import {
  buildSupportMessageHtml,
  buildSupportMessageText,
  buildSupportTicketHtml,
  buildSupportTicketText,
  type SupportMessageEmailProps,
  type SupportTicketEmailProps,
} from '@/emails/support-ticket';
import { getSupportTicketReplyTo } from '@/lib/support/tickets';
import { getResendClient, getSupportEmailConfig, getSupportEmailFrom } from './resend';

export async function sendSupportTicketEmail(props: SupportTicketEmailProps) {
  const resend = getResendClient();
  const { from, to } = getSupportEmailConfig(props.submitterEmail);
  const replyTo = getSupportTicketReplyTo(props.ticketId, props.submitterEmail);
  const emailProps = {
    ...props,
    replyToAddress: replyTo,
  };

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `[Support] ${props.subject}`,
    replyTo,
    html: buildSupportTicketHtml(emailProps),
    text: buildSupportTicketText(emailProps),
  });

  if (error) {
    throw new Error(error.message || 'Failed to send support ticket email');
  }

  return data?.id ?? null;
}

export async function sendSupportMessageEmail({
  to,
  fromDisplayEmail,
  ...props
}: SupportMessageEmailProps & {
  to: string | string[];
  fromDisplayEmail?: string | null;
}) {
  const resend = getResendClient();
  const from = getSupportEmailFrom(fromDisplayEmail);
  const replyTo = getSupportTicketReplyTo(props.ticketId, fromDisplayEmail ?? null);
  const emailProps = {
    ...props,
    replyToAddress: replyTo,
  };

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `[Support] ${props.subject}`,
    replyTo,
    html: buildSupportMessageHtml(emailProps),
    text: buildSupportMessageText(emailProps),
  });

  if (error) {
    throw new Error(error.message || 'Failed to send support message email');
  }

  return data?.id ?? null;
}
