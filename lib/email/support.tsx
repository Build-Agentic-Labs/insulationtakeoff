import SupportTicketEmail, { buildSupportTicketText, type SupportTicketEmailProps } from '@/emails/support-ticket';
import { getResendClient, getSupportEmailConfig } from './resend';

export async function sendSupportTicketEmail(props: SupportTicketEmailProps) {
  const resend = getResendClient();
  const { from, to } = getSupportEmailConfig(props.submitterEmail);

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `[Support] ${props.subject}`,
    replyTo: props.submitterEmail,
    react: <SupportTicketEmail {...props} />,
    text: buildSupportTicketText(props),
  });

  if (error) {
    throw new Error(error.message || 'Failed to send support ticket email');
  }

  return data?.id ?? null;
}
