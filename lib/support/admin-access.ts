const SUPPORT_ADMIN_EMAIL = 'rosendolopez2014@gmail.com';

export function isSupportAdminEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === SUPPORT_ADMIN_EMAIL;
}
