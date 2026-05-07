"use client";

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getProjectRouteRef } from '@/lib/projects/slug';
import {
  ArrowLeft,
  Loader2,
  Building2,
  Mail,
  Phone,
  MapPin,
  Plus,
  FolderOpen,
  FileText,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

interface Project {
  id: string;
  slug: string | null;
  name: string;
  status: string;
  created_at: string;
  pdf_url: string | null;
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Client | null>(null);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const companyId = await getActiveCompanyId();
      // Load client
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('company_id', companyId)
        .single();

      if (clientError) throw clientError;
      setClient(clientData);
      setEditForm(clientData);

      // Load projects for this client
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .eq('company_id', companyId)
        .eq('client_id', id)
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;
      setProjects(projectsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editForm) return;

    setIsSaving(true);
    try {
      const companyId = await getActiveCompanyId();
      const { error } = await supabase
        .from('clients')
        .update({
          name: editForm.name,
          email: editForm.email,
          phone: editForm.phone,
          address: editForm.address,
          notes: editForm.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('company_id', companyId);

      if (error) throw error;

      setClient(editForm);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving client:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this client? All associated projects will be unlinked.')) {
      return;
    }

    try {
      const companyId = await getActiveCompanyId();
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id)
        .eq('company_id', companyId);

      if (error) throw error;

      router.push('/clients');
    } catch (error) {
      console.error('Error deleting client:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'ev-status-completed';
      case 'extracted':
        return 'ev-status-extracted';
      default:
        return 'ev-status-default';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="ev-page ev-page-grid min-h-screen">
        <div className="ev-container">
          <p className="text-[var(--takeoff-text-muted)]">Client not found</p>
        </div>
      </div>
    );
  }

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

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="ev-icon-box h-16 w-16 rounded-[22px]">
              <Building2 className="h-8 w-8" />
            </div>
            <div>
              <p className="ev-label">Client Record</p>
              <h1 className="ev-title mt-1 text-[42px]">{client.name}</h1>
              <p className="ev-muted mt-2 text-sm">
                Client since {new Date(client.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              className="text-[var(--takeoff-accent)] hover:bg-[#fff5f5] hover:text-[var(--takeoff-accent)]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Client Info */}
        <div className="lg:col-span-1">
          <Card className="ev-card">
            <CardHeader>
              <CardTitle className="text-lg">Client Details</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={editForm?.name || ''}
                      onChange={(e) => setEditForm({ ...editForm!, name: e.target.value })}
                      className="ev-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={editForm?.email || ''}
                      onChange={(e) => setEditForm({ ...editForm!, email: e.target.value })}
                      className="ev-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={editForm?.phone || ''}
                      onChange={(e) => setEditForm({ ...editForm!, phone: e.target.value })}
                      className="ev-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                      value={editForm?.address || ''}
                      onChange={(e) => setEditForm({ ...editForm!, address: e.target.value })}
                      className="ev-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <textarea
                      value={editForm?.notes || ''}
                      onChange={(e) => setEditForm({ ...editForm!, notes: e.target.value })}
                      rows={3}
                      className="ev-input w-full rounded-[18px] border px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleSave} disabled={isSaving} size="sm">
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      <span className="ml-2">Save</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditing(false);
                        setEditForm(client);
                      }}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {client.email && (
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
                      <a href={`mailto:${client.email}`} className="text-sm hover:text-primary transition-colors">
                        {client.email}
                      </a>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-[var(--takeoff-text-subtle)]" />
                      <a href={`tel:${client.phone}`} className="text-sm hover:text-primary transition-colors">
                        {client.phone}
                      </a>
                    </div>
                  )}
                  {client.address && (
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-0.5 h-4 w-4 text-[var(--takeoff-text-subtle)]" />
                      <span className="text-sm text-[var(--takeoff-text-muted)]">{client.address}</span>
                    </div>
                  )}
                  {client.notes && (
                    <div className="border-t border-[var(--takeoff-line)] pt-4">
                      <p className="text-sm italic text-[var(--takeoff-text-muted)]">{client.notes}</p>
                    </div>
                  )}
                  {!client.email && !client.phone && !client.address && !client.notes && (
                    <p className="text-sm text-[var(--takeoff-text-subtle)]">No contact details added</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Projects */}
        <div className="lg:col-span-2">
          <Card className="ev-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Projects</CardTitle>
                <CardDescription>{projects.length} total projects</CardDescription>
              </div>
              <Link href={`/projects/new?clientId=${id}`}>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Project
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen className="mx-auto mb-4 h-12 w-12 text-[var(--takeoff-text-subtle)]" />
                  <h3 className="mb-2 text-lg font-semibold text-[var(--takeoff-ink)]">
                    No projects yet
                  </h3>
                  <p className="ev-muted mb-6">
                    Create the first project for this client
                  </p>
                  <Link href={`/projects/new?clientId=${id}`}>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Project
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.map((project, index) => (
                    <Link
                      key={project.id}
                      href={`/projects/${getProjectRouteRef(project)}`}
                      className="group block"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="ev-card-hover flex items-center justify-between rounded-[18px] border border-[var(--takeoff-line)] bg-white p-4 transition-all duration-200">
                        <div className="flex items-center gap-4">
                          <div className="ev-icon-box h-10 w-10 rounded-[14px]">
                            <FileText className="h-5 w-5 text-[var(--takeoff-accent)]" />
                          </div>
                          <div>
                            <h4 className="font-medium text-[var(--takeoff-ink)] transition-colors group-hover:text-[var(--takeoff-accent)]">
                              {project.name}
                            </h4>
                            <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--takeoff-text-muted)]">
                              <span>{new Date(project.created_at).toLocaleDateString()}</span>
                              {project.pdf_url && (
                                <span className="inline-flex items-center gap-1 rounded-[10px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-2 py-0.5 text-[11px] font-medium text-[var(--takeoff-ink)]">
                                  <FileText className="h-3 w-3" />
                                  Plan attached
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`ev-status ${getStatusColor(project.status)}`}>
                            {project.status}
                          </span>
                          <ChevronRight className="h-5 w-5 text-[var(--takeoff-text-subtle)] transition-all duration-200 group-hover:translate-x-1 group-hover:text-[var(--takeoff-accent)]" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}
