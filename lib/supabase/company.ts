import { supabase } from './client';

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthRequiredError';
  }
}

export class CompanyRequiredError extends Error {
  constructor() {
    super('Company workspace required');
    this.name = 'CompanyRequiredError';
  }
}

export class CompanyRoleRequiredError extends Error {
  constructor() {
    super('Workspace admin access required');
    this.name = 'CompanyRoleRequiredError';
  }
}

export async function getActiveCompanyId() {
  const membership = await getActiveCompanyMembership();
  return membership.companyId;
}

export async function getActiveCompanyMembership() {
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
