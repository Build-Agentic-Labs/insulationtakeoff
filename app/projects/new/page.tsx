"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
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
  FileText,
} from 'lucide-react';
import { DemoInstructions } from '@/components/demo/DemoInstructions';
import { DemoTooltip } from '@/components/demo/DemoTooltip';
import { getProjectRouteRef } from '@/lib/projects/slug';

interface Client {
  id: string;
  name: string;
  email: string | null;
}

type UploadStage = 'creating' | 'uploading' | 'saving' | 'opening';

const uploadSteps: Array<{ id: UploadStage; title: string; description: string }> = [
  {
    id: 'creating',
    title: 'Creating project',
    description: 'Setting up the project profile',
  },
  {
    id: 'uploading',
    title: 'Uploading plan',
    description: 'Saving the PDF to storage',
  },
  {
    id: 'saving',
    title: 'Attaching file',
    description: 'Linking the PDF to the client/project profile',
  },
  {
    id: 'opening',
    title: 'Opening profile',
    description: 'Taking you to the saved project',
  },
];

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
  const [uploadStage, setUploadStage] = useState<UploadStage>('creating');
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
      const companyId = await getActiveCompanyId();
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, email')
        .eq('company_id', companyId)
        .order('name');

      if (error) throw error;
      setClients(data || []);
    } catch (err) {
      console.error('Error loading clients:', err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingClients(false);
    }
  };

  const handleCreateClient = async () => {
    if (!newClientName.trim()) return;

    setIsCreatingClient(true);
    try {
      const companyId = await getActiveCompanyId();
      const { data, error } = await supabase
        .from('clients')
        .insert({
          company_id: companyId,
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

    setUploadStage('creating');
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
      setUploadStage('uploading');

      // 2. Get a signed upload URL from the server
      const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || 'pdf';
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          fileExtension: fileExt,
          fileSize: selectedFile.size,
          fileType: selectedFile.type,
        }),
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
      setUploadStage('saving');

      // 4. Attach the uploaded file to the project without starting extraction
      const attachRes = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdf_url: presignData.publicUrl,
          status: 'uploaded',
          sourceDocument: {
            name: selectedFile.name,
            fileType: selectedFile.type || 'application/octet-stream',
            fileSize: selectedFile.size,
          },
        }),
      });
      const attachData = await attachRes.json();
      if (!attachRes.ok) throw new Error(attachData.error || 'Failed to attach uploaded file');

      setUploadStage('opening');
      router.push(selectedClientId ? `/clients/${selectedClientId}` : `/projects/${getProjectRouteRef(createData.project)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setIsUploading(false);
      setUploadStage('creating');
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

      router.push(`/projects/${getProjectRouteRef(data.project)}`);
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
    <div className="ev-page ev-page-grid min-h-screen">
      <div className="ev-container">
        <div className="mx-auto max-w-[1280px]">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/"
              className="ev-secondary-action mb-4 inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-[11px] font-semibold transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Link>
            <p className="ev-label">Intake</p>
            <h1 className="ev-title mt-2 text-[42px]">New Project</h1>
            <p className="ev-muted mt-2 text-sm">
              Create a project, attach plans, and decide the next estimating step later
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,780px)_minmax(340px,1fr)] lg:items-start">
            <div>
              <Card className="ev-card">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="ev-icon-box h-10 w-10 rounded-[14px]">
                      <FolderOpen className="h-5 w-5" />
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
                      <div className="flex items-center gap-2 text-sm text-[var(--takeoff-text-muted)]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading clients...
                      </div>
                    ) : showNewClientForm ? (
                      <div className="animate-in slide-in-from-top-2 space-y-4 rounded-[18px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] p-4 duration-200">
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
                              className="ev-input mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Email</Label>
                            <Input
                              type="email"
                              placeholder="Email (optional)"
                              value={newClientEmail}
                              onChange={(e) => setNewClientEmail(e.target.value)}
                              className="ev-input mt-1"
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
                          className="flex w-full items-center justify-between rounded-[12px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.82)] px-3 py-2.5 text-left transition-colors hover:border-[var(--takeoff-line-strong)]"
                        >
                          {selectedClient ? (
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-primary" />
                              <span>{selectedClient.name}</span>
                            </div>
                          ) : (
                            <span className="text-[var(--takeoff-text-subtle)]">Select a client (optional)</span>
                          )}
                          <ChevronDown className={`h-4 w-4 text-[var(--takeoff-text-subtle)] transition-transform ${showClientDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showClientDropdown && (
                          <div className="animate-in fade-in slide-in-from-top-2 absolute z-10 mt-1 w-full overflow-hidden rounded-[18px] border border-[var(--takeoff-line)] bg-white shadow-lg duration-200">
                            <div className="border-b border-[var(--takeoff-line)] p-2">
                              <Input
                                placeholder="Search clients..."
                                value={clientSearch}
                                onChange={(e) => setClientSearch(e.target.value)}
                                className="ev-input"
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
                                  className="w-full px-3 py-2 text-left text-sm text-[var(--takeoff-text-muted)] hover:bg-[var(--takeoff-paper)]"
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
                                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--takeoff-paper)] ${
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
                                <div className="px-3 py-4 text-center text-sm text-[var(--takeoff-text-muted)]">
                                  No clients found
                                </div>
                              )}
                            </div>
                            <div className="border-t border-[var(--takeoff-line)] p-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowNewClientForm(true);
                                  setShowClientDropdown(false);
                                }}
                                className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm text-[var(--takeoff-ink)] hover:bg-[var(--takeoff-paper)]"
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
                      className="ev-input"
                    />
                  </div>

                  {/* File Upload (Optional) */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      File (PDF or Image) <span className="text-zinc-400 text-sm font-normal">- optional</span>
                      <DemoTooltip>
                        Upload architectural plans (PDF) or photos. The file is saved to the project first; extraction starts only when you choose it later.
                      </DemoTooltip>
                    </Label>
                    <FileUpload
                      onFileSelect={setSelectedFile}
                      maxSize={50}
                    />
                    <p className="text-xs text-[var(--takeoff-text-muted)]">
                      Upload a file to attach it to the client/project profile, or skip to enter data manually
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-[14px] border border-[#e0b1b5] bg-[#fff5f5] p-3 text-sm text-[var(--takeoff-accent)]">
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
                        className="ev-primary-action w-full"
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            Create Project
                          </>
                        )}
                      </Button>
                    ) : (
                      // If no file, show create manually button as primary
                      <Button
                        onClick={handleCreateManual}
                        disabled={isCreatingManual || !projectName.trim()}
                        className="ev-primary-action w-full"
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
                      onClick={() => router.push('/')}
                      disabled={isUploading || isCreatingManual}
                      className="ev-secondary-action w-full"
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <aside className="lg:sticky lg:top-8">
              <DemoInstructions
                title="Step 1: Create a New Project"
                steps={[
                  "Optionally select or create a client to associate with this project",
                  "Enter a project name (e.g., the lot number or address)",
                  "Upload a PDF floor plan or image to keep it attached to the client profile",
                  "Or skip the file to enter measurements manually",
                ]}
                tip="For best results, upload architectural floor plans with room dimensions labeled."
              />
            </aside>
          </div>
        </div>
      </div>

      {isUploading && selectedFile && (
        <UploadProgressOverlay fileName={selectedFile.name} stage={uploadStage} />
      )}
    </div>
  );
}

function UploadProgressOverlay({ fileName, stage }: { fileName: string; stage: UploadStage }) {
  const activeIndex = uploadSteps.findIndex((step) => step.id === stage);
  const activeStep = uploadSteps[activeIndex] ?? uploadSteps[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(245,247,242,0.78)] p-6 backdrop-blur-md animate-in fade-in duration-300">
      <div className="ev-card w-full max-w-[460px] overflow-hidden rounded-[26px] bg-white p-5 shadow-2xl animate-in slide-in-from-bottom-3 zoom-in-95 duration-300">
        <div className="flex items-start gap-4">
          <div className="ev-icon-box relative h-12 w-12 shrink-0 overflow-hidden rounded-[18px]">
            <FileText className="h-5 w-5" />
            <span className="absolute inset-x-0 bottom-0 h-1 bg-[var(--takeoff-accent)]" />
          </div>
          <div className="min-w-0">
            <p className="ev-label">Creating Project</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.04em] text-[var(--takeoff-ink)]">
              {activeStep.title}
            </h2>
            <p className="mt-1 truncate text-sm text-[var(--takeoff-text-muted)]">{fileName}</p>
          </div>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--takeoff-paper)]">
          <div className="ev-upload-progress-fill h-full rounded-full bg-[var(--takeoff-ink)]" />
        </div>

        <div className="mt-5 space-y-3">
          {uploadSteps.map((step, index) => {
            const isComplete = index < activeIndex;
            const isActive = index === activeIndex;

            return (
              <div
                key={step.id}
                className={`flex items-start gap-3 rounded-[16px] border px-3 py-3 transition-colors duration-300 ${
                  isActive
                    ? 'border-[var(--takeoff-line-strong)] bg-[var(--takeoff-paper)]'
                    : 'border-transparent bg-transparent'
                }`}
              >
                <div
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                    isComplete || isActive
                      ? 'border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white'
                      : 'border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-subtle)]'
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--takeoff-ink)]">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-[var(--takeoff-text-muted)]">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-5 rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-2 text-xs leading-5 text-[var(--takeoff-text-muted)]">
          The PDF is only being attached to the profile. Automated takeoff will stay off until you start it later.
        </p>
      </div>
    </div>
  );
}
