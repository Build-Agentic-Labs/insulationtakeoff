"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { FileUpload } from '@/components/upload/FileUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  Loader2,
  Building2,
  Plus,
  Check,
  FolderOpen,
  ChevronDown,
  Upload,
  PenLine,
} from 'lucide-react';
import { DemoInstructions } from '@/components/demo/DemoInstructions';
import { DemoTooltip } from '@/components/demo/DemoTooltip';

interface Client {
  id: string;
  name: string;
  email: string | null;
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <NewProjectContent />
    </Suspense>
  );
}

function NewProjectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedClientId = searchParams.get('clientId');

  const [projectName, setProjectName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingManual, setIsCreatingManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client selection state
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(preselectedClientId);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  // New client inline form
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, email')
        .order('name');

      if (error) throw error;
      setClients(data || []);
    } catch (err: any) {
      console.error('Error loading clients:', err?.message || String(err));
    } finally {
      setIsLoadingClients(false);
    }
  };

  const handleCreateClient = async () => {
    if (!newClientName.trim()) return;

    setIsCreatingClient(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .insert({
          name: newClientName.trim(),
          email: newClientEmail.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Add to clients list and select it
      setClients([...clients, data]);
      setSelectedClientId(data.id);
      setShowNewClientForm(false);
      setNewClientName('');
      setNewClientEmail('');
    } catch (err) {
      console.error('Error creating client:', err);
    } finally {
      setIsCreatingClient(false);
    }
  };

  const handleUpload = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name');
      return;
    }

    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // 1. Create project record via API (small JSON, no file)
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName,
          clientId: selectedClientId,
          status: 'uploaded',
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || 'Failed to create project');

      const projectId = createData.project.id;

      // 2. Get a signed upload URL from the server
      const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || 'pdf';
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, fileExtension: fileExt }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || 'Failed to get upload URL');

      // 3. Upload file directly to Supabase Storage via signed URL (bypasses Vercel 4.5MB limit)
      const uploadRes = await fetch(presignData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      });
      if (!uploadRes.ok) throw new Error('File upload failed');

      // 4. Update project with the public file URL
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_url: presignData.publicUrl }),
      });

      router.push(`/projects/${projectId}/extract`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setIsUploading(false);
    }
  };

  const handleCreateManual = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name');
      return;
    }

    setIsCreatingManual(true);
    setError(null);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectName,
          clientId: selectedClientId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      router.push(`/projects/${data.project.id}/review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setIsCreatingManual(false);
    }
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Projects
        </Link>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">New Project</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1">
          Create a new project with file extraction or build it manually
        </p>
      </div>

      <div className="max-w-2xl">
        <DemoInstructions
          title="Step 1: Create a New Project"
          steps={[
            "Optionally select or create a client to associate with this project",
            "Enter a project name (e.g., the lot number or address)",
            "Upload a PDF floor plan or image to auto-extract measurements",
            "Or skip the file to enter measurements manually"
          ]}
          tip="For best results, upload architectural floor plans with room dimensions labeled."
        />

        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Project Details</CardTitle>
                <CardDescription>Enter project information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Client Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Client
                <DemoTooltip>
                  Link this project to a client for easy organization. Quotes will be addressed to the selected client.
                </DemoTooltip>
              </Label>
              {isLoadingClients ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading clients...
                </div>
              ) : showNewClientForm ? (
                <div className="border rounded-lg p-4 bg-zinc-50 dark:bg-zinc-900 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Create New Client</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNewClientForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Name *</Label>
                      <Input
                        placeholder="Client name"
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        className="mt-1 bg-white dark:bg-zinc-800"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input
                        type="email"
                        placeholder="Email (optional)"
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                        className="mt-1 bg-white dark:bg-zinc-800"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleCreateClient}
                    disabled={!newClientName.trim() || isCreatingClient}
                    size="sm"
                  >
                    {isCreatingClient ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    Create Client
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowClientDropdown(!showClientDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-primary transition-colors text-left"
                  >
                    {selectedClient ? (
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        <span>{selectedClient.name}</span>
                      </div>
                    ) : (
                      <span className="text-zinc-400">Select a client (optional)</span>
                    )}
                    <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${showClientDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showClientDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="p-2 border-b border-zinc-100 dark:border-zinc-700">
                        <Input
                          placeholder="Search clients..."
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          className="bg-zinc-50 dark:bg-zinc-900"
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {selectedClientId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedClientId(null);
                              setShowClientDropdown(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                          >
                            No client (skip)
                          </button>
                        )}
                        {filteredClients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => {
                              setSelectedClientId(client.id);
                              setShowClientDropdown(false);
                              setClientSearch('');
                            }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center justify-between ${
                              selectedClientId === client.id ? 'bg-primary/5 text-primary' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" />
                              <span>{client.name}</span>
                            </div>
                            {selectedClientId === client.id && <Check className="h-4 w-4" />}
                          </button>
                        ))}
                        {filteredClients.length === 0 && (
                          <div className="px-3 py-4 text-sm text-zinc-500 text-center">
                            No clients found
                          </div>
                        )}
                      </div>
                      <div className="p-2 border-t border-zinc-100 dark:border-zinc-700">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewClientForm(true);
                            setShowClientDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-primary/5 rounded-md flex items-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          Create New Client
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Project Name */}
            <div className="space-y-2">
              <Label htmlFor="project-name" className="flex items-center gap-2">
                Project Name <span className="text-red-500">*</span>
                <DemoTooltip>
                  Use a descriptive name like the lot number, address, or builder reference. This will appear on the final quote.
                </DemoTooltip>
              </Label>
              <Input
                id="project-name"
                placeholder="e.g., Lot 4 - Golden Ridge"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={isUploading || isCreatingManual}
                className="bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
              />
            </div>

            {/* File Upload (Optional) */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                File (PDF or Image) <span className="text-zinc-400 text-sm font-normal">- optional</span>
                <DemoTooltip>
                  Upload architectural plans (PDF) or photos. Our AI will scan the document to extract room dimensions, wall measurements, and door/window counts.
                </DemoTooltip>
              </Label>
              <FileUpload
                onFileSelect={setSelectedFile}
                maxSize={50}
              />
              <p className="text-xs text-zinc-500">
                Upload a file to auto-extract measurements, or skip to enter data manually
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3 pt-4">
              {selectedFile ? (
                // If file selected, show upload button
                <Button
                  onClick={handleUpload}
                  disabled={isUploading || !projectName.trim()}
                  className="w-full"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload & Extract
                    </>
                  )}
                </Button>
              ) : (
                // If no file, show create manually button as primary
                <Button
                  onClick={handleCreateManual}
                  disabled={isCreatingManual || !projectName.trim()}
                  className="w-full"
                >
                  {isCreatingManual ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <PenLine className="mr-2 h-4 w-4" />
                      Create & Build Manually
                    </>
                  )}
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => router.push('/projects')}
                disabled={isUploading || isCreatingManual}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
