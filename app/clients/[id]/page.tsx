"use client";

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  name: string;
  status: string;
  created_at: string;
  pdf_url: string;
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
      // Load client
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .single();

      if (clientError) throw clientError;
      setClient(clientData);
      setEditForm(clientData);

      // Load projects for this client
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
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
        .eq('id', id);

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
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id);

      if (error) throw error;

      router.push('/clients');
    } catch (error) {
      console.error('Error deleting client:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'extracted':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400';
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
      <div className="p-8">
        <p className="text-zinc-500">Client not found</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/clients"
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">{client.name}</h1>
              <p className="text-zinc-500 dark:text-zinc-400 mt-1">
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
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Client Info */}
        <div className="lg:col-span-1">
          <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
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
                      className="bg-zinc-50 dark:bg-zinc-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={editForm?.email || ''}
                      onChange={(e) => setEditForm({ ...editForm!, email: e.target.value })}
                      className="bg-zinc-50 dark:bg-zinc-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={editForm?.phone || ''}
                      onChange={(e) => setEditForm({ ...editForm!, phone: e.target.value })}
                      className="bg-zinc-50 dark:bg-zinc-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                      value={editForm?.address || ''}
                      onChange={(e) => setEditForm({ ...editForm!, address: e.target.value })}
                      className="bg-zinc-50 dark:bg-zinc-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <textarea
                      value={editForm?.notes || ''}
                      onChange={(e) => setEditForm({ ...editForm!, notes: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 rounded-md border bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-sm"
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
                      <Mail className="h-4 w-4 text-zinc-400" />
                      <a href={`mailto:${client.email}`} className="text-sm hover:text-primary transition-colors">
                        {client.email}
                      </a>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-zinc-400" />
                      <a href={`tel:${client.phone}`} className="text-sm hover:text-primary transition-colors">
                        {client.phone}
                      </a>
                    </div>
                  )}
                  {client.address && (
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-zinc-400 mt-0.5" />
                      <span className="text-sm text-zinc-600 dark:text-zinc-300">{client.address}</span>
                    </div>
                  )}
                  {client.notes && (
                    <div className="pt-4 border-t border-zinc-100 dark:border-zinc-700">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">{client.notes}</p>
                    </div>
                  )}
                  {!client.email && !client.phone && !client.address && !client.notes && (
                    <p className="text-sm text-zinc-400">No contact details added</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Projects */}
        <div className="lg:col-span-2">
          <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
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
                  <FolderOpen className="h-12 w-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
                    No projects yet
                  </h3>
                  <p className="text-zinc-500 dark:text-zinc-400 mb-6">
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
                      href={`/projects/${project.id}`}
                      className="group block"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-100 dark:border-zinc-700 hover:border-primary hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-200">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
                          </div>
                          <div>
                            <h4 className="font-medium text-zinc-900 dark:text-white group-hover:text-primary transition-colors">
                              {project.name}
                            </h4>
                            <p className="text-sm text-zinc-500">
                              {new Date(project.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(project.status)}`}>
                            {project.status}
                          </span>
                          <ChevronRight className="h-5 w-5 text-zinc-300 dark:text-zinc-600 group-hover:text-primary group-hover:translate-x-1 transition-all duration-200" />
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
  );
}
