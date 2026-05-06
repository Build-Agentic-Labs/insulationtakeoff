export const SUPPORT_TICKET_WITH_THREAD_SELECT = `
  *,
  project:projects(id, name),
  attachments:support_ticket_attachments(*),
  messages:support_ticket_messages(*)
`;

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TICKET_ADDRESS_PATTERN = new RegExp(`(?:ticket|support|reply)(?:\\+|-|_)?(${UUID_PATTERN})`, 'i');

export function cleanEmailHeaderValue(value: string) {
  return value.replace(/[\r\n<>"]/g, '').trim();
}

export function normalizeEmailAddress(value: string | null | undefined) {
  return extractEmailAddress(value)?.toLowerCase() ?? null;
}

export function extractEmailAddress(value: string | null | undefined) {
  if (!value) return null;
  const angleMatch = value.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim();

  const plainMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch?.[0]?.trim() ?? null;
}

export function getConfiguredSupportEmails() {
  return (process.env.SUPPORT_EMAIL_TO ?? '')
    .split(',')
    .map((email) => normalizeEmailAddress(email))
    .filter((email): email is string => Boolean(email));
}

export function getSupportTicketReplyAddress(ticketId: string) {
  const domain = process.env.SUPPORT_INBOUND_DOMAIN?.trim().replace(/^@/, '').toLowerCase();
  if (!domain) return null;
  return `ticket-${ticketId}@${domain}`;
}

export function getSupportTicketReplyTo(ticketId: string, fallbackEmail?: string | null) {
  return getSupportTicketReplyAddress(ticketId) ?? fallbackEmail ?? undefined;
}

export function extractSupportTicketIdFromAddresses(addresses: Array<string | null | undefined>) {
  for (const address of addresses) {
    if (!address) continue;
    const match = address.match(TICKET_ADDRESS_PATTERN);
    if (match?.[1]) return match[1].toLowerCase();
  }

  return null;
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(html: string) {
  return decodeBasicHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

export function stripQuotedEmailText(value: string) {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = normalized.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^>/.test(trimmed)) break;
    if (/^On .+ wrote:$/.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break;
    if (/^From:\s/i.test(trimmed)) break;
    if (/^Sent:\s/i.test(trimmed)) break;
    if (/^To:\s/i.test(trimmed)) break;
    if (/^Subject:\s/i.test(trimmed)) break;

    kept.push(line);
  }

  return kept.join('\n').trim().slice(0, 5000);
}
