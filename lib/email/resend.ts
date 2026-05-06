import { Resend } from 'resend';
import { cleanEmailHeaderValue } from '@/lib/support/tickets';

let cachedResend: Resend | null = null;

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  if (!cachedResend) {
    cachedResend = new Resend(apiKey);
  }

  return cachedResend;
}

export function getSupportEmailTo() {
  const to = process.env.SUPPORT_EMAIL_TO;

  if (!to) {
    throw new Error('SUPPORT_EMAIL_TO is not configured');
  }

  const recipients = to
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error('SUPPORT_EMAIL_TO is not configured');
  }

  return recipients.length === 1 ? recipients[0] : recipients;
}

export function getSupportEmailFrom(submitterEmail?: string | null) {
  const configuredFrom = process.env.SUPPORT_EMAIL_FROM;
  const cleanSubmitterEmail = submitterEmail ? cleanEmailHeaderValue(submitterEmail) : '';

  return configuredFrom || (
    cleanSubmitterEmail
      ? `Support from ${cleanSubmitterEmail} <onboarding@resend.dev>`
      : 'Insulation Takeoff Support <onboarding@resend.dev>'
  );
}

export function getSupportEmailConfig(submitterEmail?: string | null) {
  const to = getSupportEmailTo();
  const from = getSupportEmailFrom(submitterEmail);

  return { to, from };
}

export function getAppBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const vercelUrl = process.env.VERCEL_URL;
  const baseUrl = configuredUrl || (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000');

  return baseUrl.replace(/\/$/, '');
}
