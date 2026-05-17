import { CompanyRoleRequiredError } from '@/lib/supabase/company';
import { requireServerCompanyAdmin } from '@/lib/supabase/company-server';
import { isSupportAdminEmail } from './admin-access';

export async function requireServerSupportAdmin() {
  const membership = await requireServerCompanyAdmin();

  if (!isSupportAdminEmail(membership.user.email)) {
    throw new CompanyRoleRequiredError();
  }

  return membership;
}
