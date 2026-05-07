import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { storagePathToAppUrl } from '@/lib/supabase/storage';

const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const formData = await request.formData();
  const companyName = String(formData.get('companyName') ?? '').trim();
  const legalName = String(formData.get('legalName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const address = String(formData.get('address') ?? '').trim();
  const website = String(formData.get('website') ?? '').trim();
  const licenseNumber = String(formData.get('licenseNumber') ?? '').trim();
  const quoteTerms = String(formData.get('quoteTerms') ?? '').trim();
  const defaultTaxRateRaw = String(formData.get('defaultTaxRate') ?? '0').trim().replace(',', '.');
  const defaultTaxRate = defaultTaxRateRaw ? Number(defaultTaxRateRaw) : 0;
  const logo = formData.get('logo');

  if (!companyName) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
  }

  if (!Number.isFinite(defaultTaxRate) || defaultTaxRate < 0 || defaultTaxRate > 100) {
    return NextResponse.json({ error: 'Default tax rate must be between 0 and 100 percent' }, { status: 400 });
  }

  if (logo instanceof File && logo.size > 0) {
    if (!ALLOWED_LOGO_TYPES.includes(logo.type)) {
      return NextResponse.json({ error: 'Logo must be a JPG, PNG, or WEBP image' }, { status: 400 });
    }

    if (logo.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Logo must be 5MB or smaller' }, { status: 400 });
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { data: existingMembership } = await supabaseAdmin
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (existingMembership?.company_id) {
    if (existingMembership.role !== 'owner' && existingMembership.role !== 'admin') {
      return NextResponse.json({ error: 'Workspace admin access required' }, { status: 403 });
    }

    const companyId = existingMembership.company_id;
    const { error: updateCompanyError } = await supabaseAdmin
      .from('companies')
      .update({
        name: companyName,
        legal_name: legalName || null,
        email: email || user.email || null,
        phone: phone || null,
        address: address || null,
        website: website || null,
        license_number: licenseNumber || null,
        quote_terms: quoteTerms || null,
        default_tax_rate: defaultTaxRate,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (updateCompanyError) {
      return NextResponse.json({ error: updateCompanyError.message }, { status: 500 });
    }

    const logoUrl = await uploadCompanyLogo(companyId, logo);
    if (logoUrl instanceof NextResponse) return logoUrl;

    return NextResponse.json({ companyId, logoUrl });
  }

  const { count: companyCount, error: companyCountError } = await supabaseAdmin
    .from('companies')
    .select('id', { count: 'exact', head: true });

  if (companyCountError) {
    return NextResponse.json({ error: companyCountError.message }, { status: 500 });
  }

  if ((companyCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Workspace access required. Ask an owner or admin to add this Supabase Auth user to the company workspace.' },
      { status: 403 }
    );
  }

  const { data: createdCompany, error: createCompanyError } = await supabaseAdmin
    .from('companies')
    .insert({
      name: companyName,
      legal_name: legalName || null,
      email: email || user.email || null,
      phone: phone || null,
      address: address || null,
      website: website || null,
      license_number: licenseNumber || null,
      quote_terms: quoteTerms || null,
      default_tax_rate: defaultTaxRate,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select('id')
    .single();

  if (createCompanyError) {
    return NextResponse.json({ error: createCompanyError.message }, { status: 500 });
  }

  const logoUrl = await uploadCompanyLogo(createdCompany.id, logo);
  if (logoUrl instanceof NextResponse) {
    await supabaseAdmin.from('companies').delete().eq('id', createdCompany.id);
    return logoUrl;
  }

  const { error: memberError } = await supabaseAdmin
    .from('company_members')
    .insert({
      company_id: createdCompany.id,
      user_id: user.id,
      role: 'owner',
    });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({ companyId: createdCompany.id, logoUrl });
}

async function uploadCompanyLogo(companyId: string, logo: FormDataEntryValue | null): Promise<string | null | NextResponse> {
  if (!(logo instanceof File) || logo.size === 0) {
    return null;
  }

  const extension = logo.type === 'image/png' ? 'png' : logo.type === 'image/webp' ? 'webp' : 'jpg';
  const filePath = `companies/${companyId}/branding/logo.${extension}`;

  const { error: logoUploadError } = await supabaseAdmin.storage
    .from('pdfs')
    .upload(filePath, logo, {
      cacheControl: '3600',
      contentType: logo.type,
      upsert: true,
    });

  if (logoUploadError) {
    return NextResponse.json({ error: logoUploadError.message }, { status: 500 });
  }

  const logoUrl = storagePathToAppUrl(filePath);

  await supabaseAdmin
    .from('companies')
    .update({ logo_url: logoUrl })
    .eq('id', companyId);

  return logoUrl;
}
