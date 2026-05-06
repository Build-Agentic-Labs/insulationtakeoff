import { Resend } from 'resend';

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

function cleanEmailHeaderValue(value: string) {
  return value.replace(/[\r\n<>"]/g, '').trim();
}

export function getSupportEmailConfig(submitterEmail?: string | null) {
  const to = process.env.SUPPORT_EMAIL_TO;
  const configuredFrom = process.env.SUPPORT_EMAIL_FROM;

  if (!to) {
    throw new Error('SUPPORT_EMAIL_TO is not configured');
  }

  const cleanSubmitterEmail = submitterEmail ? cleanEmailHeaderValue(submitterEmail) : '';
  const from = configuredFrom || (
    cleanSubmitterEmail
      ? `Support from ${cleanSubmitterEmail} <onboarding@resend.dev>`
      : 'Insulation Takeoff Support <onboarding@resend.dev>'
  );

  return { to, from };
}

export function getAppBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const vercelUrl = process.env.VERCEL_URL;
  const baseUrl = configuredUrl || (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000');

  return baseUrl.replace(/\/$/, '');
}
