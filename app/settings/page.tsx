"use client";

import { ChangeEvent, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyMembership } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Copy, FileImage, Settings as SettingsIcon, Save, Loader2, Trash2, UserPlus } from 'lucide-react';

interface Settings {
  r_values: {
    wall: number | null;
    attic: number | null;
    garage_wall: number | null;
    floor: number | null;
  };
  pricing: {
    wall_per_sqft: number;
    attic_per_sqft: number;
    garage_wall_per_sqft: number;
    floor_per_sqft: number;
  };
}

interface CompanyProfile {
  name: string;
  legalName: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  licenseNumber: string;
  quoteTerms: string;
  logoUrl: string | null;
}

interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

interface TeamInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  expires_at: string;
  created_at: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    r_values: {
      wall: null,
      attic: null,
      garage_wall: null,
      floor: null,
    },
    pricing: {
      wall_per_sqft: 1.5,
      attic_per_sqft: 2.0,
      garage_wall_per_sqft: 1.75,
      floor_per_sqft: 2.5,
    },
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [companyMessage, setCompanyMessage] = useState<string | null>(null);
  const [companyLogo, setCompanyLogo] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'member' | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamInvitations, setTeamInvitations] = useState<TeamInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [teamMessage, setTeamMessage] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyProfile>({
    name: '',
    legalName: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    licenseNumber: '',
    quoteTerms: '',
    logoUrl: null,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const membership = await getActiveCompanyMembership();

      setUserRole(membership.role);
      setCompanyId(membership.companyId);

      const isWorkspaceAdmin = membership.role === 'owner' || membership.role === 'admin';

      const { data: rValuesData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'r_values')
        .eq('company_id', membership.companyId)
        .single();

      const { data: pricingData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pricing')
        .eq('company_id', membership.companyId)
        .single();

      if (rValuesData?.value) {
        setSettings((prev) => ({
          ...prev,
          r_values: rValuesData.value as any,
        }));
      }

      if (pricingData?.value) {
        setSettings((prev) => ({
          ...prev,
          pricing: pricingData.value as any,
        }));
      }

      const { data: companyData } = await supabase
        .from('companies')
        .select('name, legal_name, email, phone, address, website, license_number, quote_terms, logo_url')
        .eq('id', membership.companyId)
        .maybeSingle();

      if (companyData) {
        setCompany({
          name: companyData.name ?? '',
          legalName: companyData.legal_name ?? '',
          email: companyData.email ?? '',
          phone: companyData.phone ?? '',
          address: companyData.address ?? '',
          website: companyData.website ?? '',
          licenseNumber: companyData.license_number ?? '',
          quoteTerms: companyData.quote_terms ?? '',
          logoUrl: companyData.logo_url ?? null,
        });
      }

      if (isWorkspaceAdmin) {
        await loadTeam();
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTeam = async () => {
    const response = await fetch('/api/company/team');
    if (!response.ok) return;

    const data = await response.json();
    setTeamMembers(data.members ?? []);
    setTeamInvitations(data.invitations ?? []);
  };

  const handleCompanyLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCompanyLogo(event.target.files?.[0] ?? null);
  };

  const saveCompanyProfile = async () => {
    const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';
    if (!isWorkspaceAdmin) {
      alert('Workspace admin access required.');
      return;
    }

    setIsSavingCompany(true);
    setCompanyMessage(null);

    try {
      const formData = new FormData();
      formData.set('companyName', company.name.trim());
      formData.set('legalName', company.legalName.trim());
      formData.set('email', company.email.trim());
      formData.set('phone', company.phone.trim());
      formData.set('address', company.address.trim());
      formData.set('website', company.website.trim());
      formData.set('licenseNumber', company.licenseNumber.trim());
      formData.set('quoteTerms', company.quoteTerms.trim());
      if (companyLogo) formData.set('logo', companyLogo);

      const response = await fetch('/api/company/bootstrap', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to save company profile.');
      }

      if (data.logoUrl) {
        setCompany((prev) => ({ ...prev, logoUrl: data.logoUrl }));
      }
      setCompanyLogo(null);
      setCompanyMessage('Company profile saved.');
      setTimeout(() => setCompanyMessage(null), 3000);
    } catch (error) {
      console.error('Error saving company profile:', error);
      alert(error instanceof Error ? error.message : 'Failed to save company profile.');
    } finally {
      setIsSavingCompany(false);
    }
  };

  const createInvitation = async () => {
    const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';
    if (!isWorkspaceAdmin) {
      alert('Workspace admin access required.');
      return;
    }

    setIsInviting(true);
    setTeamMessage(null);

    try {
      const response = await fetch('/api/company/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to create invitation.');
      }

      const emailSent = Boolean(data.emailSent);
      const emailError = typeof data.emailError === 'string' ? data.emailError : null;

      setInviteEmail('');
      setInviteRole('member');
      setTeamMessage(
        emailSent
          ? 'Invitation email sent through Supabase. The invite link is also shown below.'
          : `Invitation created, but Supabase could not send the email${emailError ? `: ${emailError}` : '.'} Share the link below manually.`
      );
      await loadTeam();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create invitation.');
    } finally {
      setIsInviting(false);
    }
  };

  const updateMemberRole = async (memberId: string, role: TeamMember['role']) => {
    const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';
    if (!isWorkspaceAdmin) {
      alert('Workspace admin access required.');
      return;
    }

    const response = await fetch('/api/company/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, role }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(data.error ?? 'Failed to update member role.');
      return;
    }

    await loadTeam();
  };

  const removeMember = async (memberId: string) => {
    const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';
    if (!isWorkspaceAdmin) {
      alert('Workspace admin access required.');
      return;
    }

    const response = await fetch(`/api/company/team?memberId=${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(data.error ?? 'Failed to remove member.');
      return;
    }

    await loadTeam();
  };

  const cancelInvitation = async (invitationId: string) => {
    const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';
    if (!isWorkspaceAdmin) {
      alert('Workspace admin access required.');
      return;
    }

    const response = await fetch(`/api/company/team?invitationId=${encodeURIComponent(invitationId)}`, {
      method: 'DELETE',
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(data.error ?? 'Failed to cancel invitation.');
      return;
    }

    await loadTeam();
  };

  const getInviteLink = (token: string) => {
    if (typeof window === 'undefined') return `/company/invite/${token}`;
    return `${window.location.origin}/company/invite/${token}`;
  };

  const copyInviteLink = async (token: string) => {
    const inviteUrl = getInviteLink(token);

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setTeamMessage('Invite link copied.');
      setTimeout(() => setTeamMessage(null), 3000);
    } catch {
      setTeamMessage('Clipboard permission was denied. Select and copy the visible invite link manually.');
    }
  };

  const saveSettings = async () => {
    const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';
    if (!isWorkspaceAdmin) {
      alert('Workspace admin access required.');
      return;
    }

    setIsSaving(true);
    setSuccessMessage(null);

    try {
      if (!companyId) {
        throw new Error('Company workspace is required before saving settings.');
      }

      const { error: rValuesError } = await supabase
        .from('settings')
        .upsert(
          { company_id: companyId, key: 'r_values', value: settings.r_values },
          { onConflict: 'company_id,key' }
        );

      if (rValuesError) throw rValuesError;

      const { error: pricingError } = await supabase
        .from('settings')
        .upsert(
          { company_id: companyId, key: 'pricing', value: settings.pricing },
          { onConflict: 'company_id,key' }
        );

      if (pricingError) throw pricingError;

      setSuccessMessage('Settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="takeoff-shell takeoff-light-theme flex min-h-screen items-center justify-center px-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isWorkspaceAdmin = userRole === 'owner' || userRole === 'admin';

  return (
    <div className="ev-page ev-page-grid min-h-screen px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="ev-icon-box h-12 w-12 rounded-[16px]">
            <SettingsIcon className="h-6 w-6" />
          </div>
          <div>
            <p className="ev-label">Workspace Defaults</p>
            <h1 className="ev-title mt-1 text-[42px]">Settings</h1>
            <p className="ev-muted text-sm">
              Configure R-values and pricing for insulation quotes
            </p>
          </div>
        </div>

        {!isWorkspaceAdmin && (
          <Card className="ev-card border-amber-200 bg-amber-50/70">
            <CardContent className="py-4 text-sm text-amber-900">
              You can view workspace defaults, but only owners and admins can update company settings, pricing, R-values, or team access.
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={isWorkspaceAdmin ? 'company' : 'r-values'} className="w-full">
          <TabsList className={`grid w-full ${isWorkspaceAdmin ? 'grid-cols-4' : 'grid-cols-2'}`}>
            {isWorkspaceAdmin && <TabsTrigger value="company">Company</TabsTrigger>}
            {isWorkspaceAdmin && <TabsTrigger value="team">Team</TabsTrigger>}
            <TabsTrigger value="r-values">R-Values</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
          </TabsList>

          {isWorkspaceAdmin && (
          <TabsContent value="company" className="space-y-4">
            <Card className="ev-card">
              <CardHeader>
                <CardTitle>Company Profile</CardTitle>
                <CardDescription>
                  This information appears in your workspace and quote output.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-4 rounded-[20px] border border-[var(--takeoff-line)] bg-white p-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                    {company.logoUrl ? (
                      <img src={company.logoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Building2 className="h-7 w-7 text-[var(--takeoff-ink)]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--takeoff-ink)]">{company.name || 'Company workspace'}</p>
                    <p className="text-sm text-[var(--takeoff-text-muted)]">
                      Upload a square logo for best quote output.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="company-name">Company Name</Label>
                    <Input
                      id="company-name"
                      value={company.name}
                      onChange={(event) => setCompany({ ...company, name: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="legal-name">Legal Name</Label>
                    <Input
                      id="legal-name"
                      value={company.legalName}
                      onChange={(event) => setCompany({ ...company, legalName: event.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="company-email">Company Email</Label>
                    <Input
                      id="company-email"
                      type="email"
                      value={company.email}
                      onChange={(event) => setCompany({ ...company, email: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="company-phone">Company Phone</Label>
                    <Input
                      id="company-phone"
                      value={company.phone}
                      onChange={(event) => setCompany({ ...company, phone: event.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="company-website">Website</Label>
                    <Input
                      id="company-website"
                      value={company.website}
                      onChange={(event) => setCompany({ ...company, website: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="license-number">License Number</Label>
                    <Input
                      id="license-number"
                      value={company.licenseNumber}
                      onChange={(event) => setCompany({ ...company, licenseNumber: event.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="company-address">Address</Label>
                  <Input
                    id="company-address"
                    value={company.address}
                    onChange={(event) => setCompany({ ...company, address: event.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="company-quote-terms">Default Quote Terms</Label>
                  <Input
                    id="company-quote-terms"
                    value={company.quoteTerms}
                    onChange={(event) => setCompany({ ...company, quoteTerms: event.target.value })}
                  />
                </div>

                <div className="rounded-[20px] border border-dashed border-[var(--takeoff-line-strong)] bg-white px-4 py-4">
                  <Label htmlFor="company-logo" className="flex cursor-pointer items-center gap-3">
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
                    id="company-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleCompanyLogoChange}
                    className="mt-3"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <Button onClick={saveCompanyProfile} disabled={isSavingCompany || !company.name.trim()} className="ev-primary-action">
                    {isSavingCompany ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save Company Profile
                  </Button>
                  {companyMessage && <p className="text-sm text-[#47644a]">{companyMessage}</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {isWorkspaceAdmin && (
          <TabsContent value="team" className="space-y-4">
            <Card className="ev-card">
              <CardHeader>
                <CardTitle>Team Access</CardTitle>
                <CardDescription>
                  Invite users into this company workspace and manage their role.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-[22px] border border-[var(--takeoff-line)] bg-white p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--takeoff-paper)]">
                      <UserPlus className="h-5 w-5 text-[var(--takeoff-ink)]" />
                    </span>
                    <div>
                      <p className="font-semibold text-[var(--takeoff-ink)]">Invite teammate</p>
                      <p className="text-sm text-[var(--takeoff-text-muted)]">
                        Send a Supabase email link and keep a manual invite link as backup.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_150px_auto]">
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="teammate@example.com"
                    />
                    <select
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')}
                      className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button onClick={createInvitation} disabled={isInviting || !inviteEmail.trim()} className="ev-primary-action">
                      {isInviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                      Invite
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[var(--takeoff-ink)]">Members</h3>
                    <span className="takeoff-mono text-xs text-[var(--takeoff-text-muted)]">{teamMembers.length} active</span>
                  </div>
                  {teamMembers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--takeoff-paper)] text-sm font-semibold">
                        {member.email.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-[var(--takeoff-ink)]">{member.email}</p>
                        <p className="text-xs capitalize text-[var(--takeoff-text-muted)]">{member.role}</p>
                      </div>
                      <select
                        value={member.role}
                        onChange={(event) => updateMemberRole(member.id, event.target.value as TeamMember['role'])}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                      <Button variant="ghost" size="sm" onClick={() => removeMember(member.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[var(--takeoff-ink)]">Pending Invites</h3>
                    <span className="takeoff-mono text-xs text-[var(--takeoff-text-muted)]">{teamInvitations.length} pending</span>
                  </div>
                  {teamInvitations.length === 0 ? (
                    <div className="rounded-[18px] border border-dashed border-[var(--takeoff-line)] bg-white px-4 py-6 text-sm text-[var(--takeoff-text-muted)]">
                      No pending invites.
                    </div>
                  ) : (
                    teamInvitations.map((invitation) => (
                      <div key={invitation.id} className="rounded-[18px] border border-[var(--takeoff-line)] bg-white px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-[var(--takeoff-ink)]">{invitation.email}</p>
                            <p className="text-xs capitalize text-[var(--takeoff-text-muted)]">
                              {invitation.role} · expires {new Date(invitation.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => copyInviteLink(invitation.token)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Link
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => cancelInvitation(invitation.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Input
                          readOnly
                          value={getInviteLink(invitation.token)}
                          onFocus={(event) => event.currentTarget.select()}
                          className="mt-3 bg-[var(--takeoff-paper)] text-xs"
                          aria-label={`Invite link for ${invitation.email}`}
                        />
                      </div>
                    ))
                  )}
                </div>

                {teamMessage && <p className="text-sm text-[#47644a]">{teamMessage}</p>}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="r-values" className="space-y-4">
            <Card className="ev-card">
              <CardHeader>
                <CardTitle>R-Value Configuration</CardTitle>
                <CardDescription>
                  Set the R-values for different insulation areas. Leave blank to skip an area in quotes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <fieldset disabled={!isWorkspaceAdmin} className="space-y-4 disabled:opacity-70">
                <div>
                  <Label htmlFor="wall-rvalue">Wall R-Value</Label>
                  <Input
                    id="wall-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 15"
                    value={settings.r_values.wall || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          wall: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="ev-muted mt-1 text-xs">
                    Common values: R-13, R-15, R-19, R-21
                  </p>
                </div>

                <div>
                  <Label htmlFor="attic-rvalue">Attic/Ceiling R-Value</Label>
                  <Input
                    id="attic-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 38"
                    value={settings.r_values.attic || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          attic: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="ev-muted mt-1 text-xs">
                    Common values: R-30, R-38, R-49, R-60
                  </p>
                </div>

                <div>
                  <Label htmlFor="garage-rvalue">Garage Wall R-Value</Label>
                  <Input
                    id="garage-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 13"
                    value={settings.r_values.garage_wall || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          garage_wall: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="ev-muted mt-1 text-xs">
                    Common values: R-11, R-13, R-15
                  </p>
                </div>

                <div>
                  <Label htmlFor="floor-rvalue">Floor/Crawlspace R-Value</Label>
                  <Input
                    id="floor-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 19"
                    value={settings.r_values.floor || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          floor: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="ev-muted mt-1 text-xs">
                    Common values: R-19, R-25, R-30
                  </p>
                </div>
                </fieldset>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pricing" className="space-y-4">
            <Card className="ev-card">
              <CardHeader>
                <CardTitle>Pricing Configuration</CardTitle>
                <CardDescription>
                  Set the price per square foot for different insulation areas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <fieldset disabled={!isWorkspaceAdmin} className="space-y-4 disabled:opacity-70">
                <div>
                  <Label htmlFor="wall-price">Wall Price ($/sq ft)</Label>
                  <Input
                    id="wall-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 1.50"
                    value={settings.pricing.wall_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          wall_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="attic-price">Attic/Ceiling Price ($/sq ft)</Label>
                  <Input
                    id="attic-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.00"
                    value={settings.pricing.attic_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          attic_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="garage-price">Garage Wall Price ($/sq ft)</Label>
                  <Input
                    id="garage-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 1.75"
                    value={settings.pricing.garage_wall_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          garage_wall_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="floor-price">Floor/Crawlspace Price ($/sq ft)</Label>
                  <Input
                    id="floor-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.50"
                    value={settings.pricing.floor_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          floor_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>
                </fieldset>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-4">
          <Button onClick={saveSettings} disabled={isSaving || !isWorkspaceAdmin} className="ev-primary-action">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>

          {successMessage && (
            <p className="text-sm text-[#47644a]">{successMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
