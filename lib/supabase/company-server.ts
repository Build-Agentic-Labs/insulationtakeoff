import { AuthRequiredError, CompanyRequiredError, CompanyRoleRequiredError } from './company';
import { createServerSupabaseClient } from './session';

export async function requireServerCompanyId() {
  const membership = await requireServerCompanyMembership();
  return membership.companyId;
}

export async function requireServerCompanyMembership() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new AuthRequiredError();

  const { data, error } = await supabase
    .from('company_members')
    .select('company_id, role')
    .limit(1)
    .single();

  if (error || !data?.company_id) throw new CompanyRequiredError();
  return {
    companyId: data.company_id,
    role: data.role,
    user,
  };
}

export async function requireServerCompanyAdmin() {
  const membership = await requireServerCompanyMembership();

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new CompanyRoleRequiredError();
  }

  return membership;
}
