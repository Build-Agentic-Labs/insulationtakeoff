"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase/client';
import { AlertCircle, Building2, FileImage, Loader2 } from 'lucide-react';

export default function CompanySetupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [quoteTerms, setQuoteTerms] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadExistingCompany = async () => {
      const { data: membership } = await supabase
        .from('company_members')
        .select('company_id')
        .limit(1)
        .maybeSingle();

      if (!active || !membership?.company_id) return;

      const { data: company } = await supabase
        .from('companies')
        .select('name, legal_name, email, phone, address, website, license_number, quote_terms')
        .eq('id', membership.company_id)
        .maybeSingle();

      if (!active || !company) return;

      setCompanyName(company.name ?? '');
      setLegalName(company.legal_name ?? '');
      setEmail(company.email ?? '');
      setPhone(company.phone ?? '');
      setAddress(company.address ?? '');
      setWebsite(company.website ?? '');
      setLicenseNumber(company.license_number ?? '');
      setQuoteTerms(company.quote_terms ?? '');
    };

    loadExistingCompany();

    return () => {
      active = false;
    };
  }, []);

  const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextLogo = event.target.files?.[0] ?? null;
    setLogo(nextLogo);
  };

  const handleCreateWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!companyName.trim()) {
      setError('Company name is required.');
      return;
    }

    setIsCreating(true);
    setError(null);

    const formData = new FormData();
    formData.set('companyName', companyName.trim());
    formData.set('legalName', legalName.trim());
    formData.set('email', email.trim());
    formData.set('phone', phone.trim());
    formData.set('address', address.trim());
    formData.set('website', website.trim());
    formData.set('licenseNumber', licenseNumber.trim());
    formData.set('quoteTerms', quoteTerms.trim());
    if (logo) formData.set('logo', logo);

    const response = await fetch('/api/company/bootstrap', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? 'Unable to set up company workspace.');
      setIsCreating(false);
      return;
    }

    router.replace('/');
    router.refresh();
  };

  return (
    <div className="takeoff-shell takeoff-light-theme min-h-screen bg-[var(--takeoff-paper)] text-[var(--takeoff-ink)]">
      <div className="takeoff-dot-grid flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl rounded-[30px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.92)] p-8 shadow-[0_30px_70px_rgba(31,39,33,0.14)] backdrop-blur-xl">
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
            <section className="relative min-h-[720px] overflow-hidden rounded-[24px] border border-[var(--takeoff-line)] bg-[#0e1511] p-6 text-white">
              <img
                src="/company-onboarding-hero.png"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(14,21,17,0.08)_0%,rgba(14,21,17,0.18)_38%,rgba(14,21,17,0.9)_100%),radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.48),transparent_30%)]" />
              <div className="relative flex h-full min-h-[672px] flex-col justify-end">
                <div>
                  <div className="takeoff-label text-[10px] font-semibold text-[#dce8d8]">
                    First Use Setup
                  </div>
                  <h1 className="mt-3 text-[38px] font-semibold leading-[0.98] tracking-[-0.05em] text-white">
                    Create your company workspace
                  </h1>
                  <p className="mt-4 text-[14px] leading-7 text-[#d9e2d6]">
                    This profile owns your clients, projects, takeoffs, uploaded files, and quote branding.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                Company Details
              </div>
              <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-[var(--takeoff-ink)]">
                Workspace profile
              </h2>

              {error && (
                <div className="mt-6 flex gap-3 rounded-[18px] border border-[#efc4c8] bg-[#fff5f5] px-4 py-3 text-[13px] text-[#a3151d]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleCreateWorkspace} className="mt-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="companyName" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Company Name
                    </Label>
                    <Input
                      id="companyName"
                      required
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      placeholder="Your company name"
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="legalName" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Legal Name
                    </Label>
                    <Input
                      id="legalName"
                      value={legalName}
                      onChange={(event) => setLegalName(event.target.value)}
                      placeholder="Optional"
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Company Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="office@example.com"
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Company Phone
                    </Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="(555) 000-0000"
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="website" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Website
                    </Label>
                    <Input
                      id="website"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                      placeholder="https://example.com"
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="licenseNumber" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      License Number
                    </Label>
                    <Input
                      id="licenseNumber"
                      value={licenseNumber}
                      onChange={(event) => setLicenseNumber(event.target.value)}
                      placeholder="Optional"
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                    Address
                  </Label>
                  <Input
                    id="address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Street, city, state, ZIP"
                    className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quoteTerms" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                    Default Quote Terms
                  </Label>
                  <Input
                    id="quoteTerms"
                    value={quoteTerms}
                    onChange={(event) => setQuoteTerms(event.target.value)}
                    placeholder="Example: Quote valid for 30 days"
                    className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                  />
                </div>

                <div className="rounded-[20px] border border-dashed border-[var(--takeoff-line-strong)] bg-white px-4 py-4">
                  <Label htmlFor="logo" className="flex cursor-pointer items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--takeoff-paper)]">
                      <FileImage className="h-5 w-5 text-[var(--takeoff-ink)]" />
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold text-[var(--takeoff-ink)]">Company Logo</span>
                      <span className="block text-[11px] text-[var(--takeoff-text-muted)]">
                        JPG, PNG, or WEBP up to 5MB
                      </span>
                    </span>
                  </Label>
                  <Input
                    id="logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    className="mt-3 h-11 rounded-[14px] border-[var(--takeoff-line)] bg-white text-[13px]"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isCreating}
                  className="takeoff-mono h-12 w-full rounded-[12px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-[12px] font-semibold text-white hover:bg-[#202621]"
                >
                  {isCreating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Building2 className="mr-2 h-4 w-4" />
                  )}
                  Create Workspace
                </Button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
