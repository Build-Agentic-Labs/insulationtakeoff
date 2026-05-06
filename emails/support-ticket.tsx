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

const bodyStyle = {
  backgroundColor: '#f5f7f2',
  color: '#141814',
  fontFamily: 'Arial, sans-serif',
  margin: 0,
};

const containerStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #d8ded4',
  borderRadius: '12px',
  margin: '32px auto',
  maxWidth: '640px',
  padding: '28px',
};

const labelStyle = {
  color: '#879287',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.12em',
  margin: '0 0 4px',
  textTransform: 'uppercase' as const,
};

const valueStyle = {
  color: '#141814',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0 0 18px',
};

export default function SupportTicketEmail({
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
  return (
    <html>
      <head>
        <title>{subject}</title>
        <meta name="description" content={subject} />
      </head>
      <body style={bodyStyle}>
        <div style={containerStyle}>
          <p style={labelStyle}>Support ticket</p>
          <h1 style={{ color: '#141814', fontSize: '24px', lineHeight: '30px', margin: '0 0 12px' }}>
            {subject}
          </h1>
          <p style={{ ...valueStyle, color: '#5f6d61' }}>
            Ticket {ticketId.slice(0, 8)} from {submitterEmail}
          </p>

          <div>
            <p style={labelStyle}>Company</p>
            <p style={valueStyle}>{companyName}</p>

            {projectName ? (
              <>
                <p style={labelStyle}>Project</p>
                <p style={valueStyle}>{projectName}</p>
              </>
            ) : null}

            <p style={labelStyle}>Question</p>
            <p style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{message}</p>
          </div>

          <hr style={{ borderColor: '#d8ded4', margin: '24px 0' }} />

          <div>
            {pageUrl ? (
              <>
                <p style={labelStyle}>Page</p>
                <p style={valueStyle}>
                  <a href={pageUrl} style={{ color: '#141814' }}>
                    {pageUrl}
                  </a>
                </p>
              </>
            ) : null}

            {browserInfo ? (
              <>
                <p style={labelStyle}>Browser</p>
                <p style={valueStyle}>{browserInfo}</p>
              </>
            ) : null}

            <p style={labelStyle}>Admin queue</p>
            <p style={valueStyle}>
              <a href={supportTicketUrl} style={{ color: '#141814', fontWeight: 700 }}>
                Open support inbox
              </a>
            </p>
          </div>

          {attachmentLinks.length > 0 ? (
            <>
              <hr style={{ borderColor: '#d8ded4', margin: '24px 0' }} />
              <p style={labelStyle}>Screenshots</p>
              {attachmentLinks.map((attachment, index) => (
                <p key={`${attachment.fileName}-${index}`} style={valueStyle}>
                  <a href={attachment.url} style={{ color: '#141814' }}>
                    {attachment.fileName}
                  </a>
                </p>
              ))}
            </>
          ) : null}
        </div>
      </body>
    </html>
  );
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
