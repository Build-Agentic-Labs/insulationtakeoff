export interface SupportTicketEmailProps {
  ticketId: string;
  subject: string;
  message: string;
  submitterEmail: string;
  companyName: string;
  projectName: string | null;
  pageUrl: string | null;
  browserInfo: string | null;
  supportTicketUrl: string;
  attachmentLinks: Array<{
    fileName: string;
    url: string;
  }>;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraph(label: string, value: string) {
  return `
    <p style="color:#879287;font-size:11px;font-weight:700;letter-spacing:0.12em;margin:0 0 4px;text-transform:uppercase;">${escapeHtml(label)}</p>
    <p style="color:#141814;font-size:14px;line-height:20px;margin:0 0 18px;">${value}</p>
  `;
}

function linkParagraph(label: string, href: string, text = href) {
  const safeHref = escapeHtml(href);
  return paragraph(label, `<a href="${safeHref}" style="color:#141814;">${escapeHtml(text)}</a>`);
}

export function buildSupportTicketHtml({
  ticketId,
  subject,
  message,
  submitterEmail,
  companyName,
  projectName,
  pageUrl,
  browserInfo,
  supportTicketUrl,
  attachmentLinks,
}: SupportTicketEmailProps) {
  const screenshotLinks = attachmentLinks.length > 0
    ? `
      <hr style="border-color:#d8ded4;margin:24px 0;" />
      <p style="color:#879287;font-size:11px;font-weight:700;letter-spacing:0.12em;margin:0 0 4px;text-transform:uppercase;">Screenshots</p>
      ${attachmentLinks.map((attachment) => `
        <p style="color:#141814;font-size:14px;line-height:20px;margin:0 0 18px;">
          <a href="${escapeHtml(attachment.url)}" style="color:#141814;">${escapeHtml(attachment.fileName)}</a>
        </p>
      `).join('')}
    `
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="background-color:#f5f7f2;color:#141814;font-family:Arial,sans-serif;margin:0;">
    <div style="background-color:#ffffff;border:1px solid #d8ded4;border-radius:12px;margin:32px auto;max-width:640px;padding:28px;">
      <p style="color:#879287;font-size:11px;font-weight:700;letter-spacing:0.12em;margin:0 0 4px;text-transform:uppercase;">Support ticket</p>
      <h1 style="color:#141814;font-size:24px;line-height:30px;margin:0 0 12px;">${escapeHtml(subject)}</h1>
      <p style="color:#5f6d61;font-size:14px;line-height:20px;margin:0 0 18px;">
        Ticket ${escapeHtml(ticketId.slice(0, 8))} from ${escapeHtml(submitterEmail)}
      </p>

      ${paragraph('Company', escapeHtml(companyName))}
      ${projectName ? paragraph('Project', escapeHtml(projectName)) : ''}
      ${paragraph('Question', `<span style="white-space:pre-wrap;">${escapeHtml(message)}</span>`)}

      <hr style="border-color:#d8ded4;margin:24px 0;" />
      ${pageUrl ? linkParagraph('Page', pageUrl) : ''}
      ${browserInfo ? paragraph('Browser', escapeHtml(browserInfo)) : ''}
      ${linkParagraph('Admin queue', supportTicketUrl, 'Open support inbox')}
      ${screenshotLinks}
    </div>
  </body>
</html>`;
}

export function buildSupportTicketText(props: SupportTicketEmailProps) {
  return [
    `Support ticket: ${props.subject}`,
    `Ticket: ${props.ticketId}`,
    `From: ${props.submitterEmail}`,
    `Company: ${props.companyName}`,
    props.projectName ? `Project: ${props.projectName}` : null,
    props.pageUrl ? `Page: ${props.pageUrl}` : null,
    props.browserInfo ? `Browser: ${props.browserInfo}` : null,
    '',
    props.message,
    '',
    `Admin queue: ${props.supportTicketUrl}`,
    props.attachmentLinks.length > 0 ? 'Screenshots:' : null,
    ...props.attachmentLinks.map((attachment) => `${attachment.fileName}: ${attachment.url}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
