"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2, Users, Building2 } from 'lucide-react';

export default function NewClientPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError('Client name is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const companyId = await getActiveCompanyId();
      const { data, error: insertError } = await supabase
        .from('clients')
        .insert({
          company_id: companyId,
          name: formData.name.trim(),
          email: formData.email.trim() || null,
          phone: formData.phone.trim() || null,
          address: formData.address.trim() || null,
          notes: formData.notes.trim() || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      router.push(`/clients/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
      setIsLoading(false);
    }
  };

  return (
    <div className="ev-page ev-page-grid min-h-screen">
      <div className="ev-container">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/clients"
          className="ev-secondary-action mb-4 inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-[11px] font-semibold transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Link>
        <p className="ev-label">Client Intake</p>
        <h1 className="ev-title mt-2 text-[42px]">Add New Client</h1>
        <p className="ev-muted mt-2 text-sm">
          Create a new client to organize their projects
        </p>
      </div>

      <div className="max-w-2xl">
        <Card className="ev-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="ev-icon-box h-10 w-10 rounded-[14px]">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Client Information</CardTitle>
                <CardDescription>Enter the client&apos;s details below</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Client Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g., Johnson Construction"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="ev-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="client@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="ev-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="ev-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  placeholder="123 Main St, City, State 12345"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="ev-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  placeholder="Any additional notes about this client..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="ev-input w-full rounded-[18px] border px-3 py-2 text-sm"
                />
              </div>

              {error && (
                <div className="rounded-[14px] border border-[#e0b1b5] bg-[#fff5f5] p-3 text-sm text-[var(--takeoff-accent)]">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={isLoading} className="ev-primary-action flex-1">
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Users className="mr-2 h-4 w-4" />
                      Create Client
                    </>
                  )}
                </Button>
                <Link href="/clients">
                  <Button type="button" variant="outline" disabled={isLoading}>
                    Cancel
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
