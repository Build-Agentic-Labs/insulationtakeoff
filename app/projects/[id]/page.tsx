"use client";

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import {
  FileText,
  FileCheck,
  Eye,
  Loader2,
  ArrowLeft,
  Trash2,
  Building2,
  Upload,
  File,
  Image as ImageIcon,
  FileSpreadsheet,
  FileArchive,
  Plus,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  status: string;
  pdf_url: string | null;
  created_at: string;
  client_id: string | null;
  client: {
    id: string;
    name: string;
  } | null;
}

interface Document {
  id: string;
  name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

function getFileIcon(fileType: string) {
  if (fileType?.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-blue-500" />;
  if (fileType?.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
  if (fileType?.includes('spreadsheet') || fileType?.includes('excel') || fileType?.includes('csv'))
    return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
  if (fileType?.includes('zip') || fileType?.includes('archive') || fileType?.includes('rar'))
    return <FileArchive className="h-5 w-5 text-amber-500" />;
  return <File className="h-5 w-5 text-zinc-500" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatProjectStatus(status: string): string {
  switch (status) {
    case 'manual':
      return 'Manual entry';
    case 'uploaded':
      return 'Source ready';
    case 'processing':
      return 'Processing';
    case 'completed':
      return 'Quote ready';
    default:
      return status.replace(/_/g, ' ');
  }
}

function projectStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'border-[rgba(110,139,94,0.24)] bg-[rgba(110,139,94,0.12)] text-[#48613d]';
    case 'processing':
      return 'border-[rgba(183,121,31,0.24)] bg-[rgba(183,121,31,0.12)] text-[#8e621b]';
    case 'uploaded':
      return 'border-[rgba(20,24,20,0.12)] bg-[rgba(20,24,20,0.06)] text-[var(--takeoff-ink)]';
    case 'manual':
      return 'border-[rgba(23,33,28,0.12)] bg-white text-[var(--takeoff-text-muted)]';
    default:
      return 'border-[rgba(23,33,28,0.12)] bg-white text-[var(--takeoff-text-muted)]';
  }
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  useEffect(() => {
    loadProject();
    loadDocuments();
  }, [id]);

  const loadProject = async () => {
    try {
      const companyId = await getActiveCompanyId();
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          client:clients(id, name)
        `)
        .eq('id', id)
        .eq('company_id', companyId)
        .single();

      if (error) throw error;
      setProject(data);
    } catch (error) {
      console.error('Error fetching project:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDocuments = async () => {
    try {
      const response = await fetch(`/api/documents?projectId=${id}`);
      const data = await response.json();
      if (data.documents) {
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete project');
      }

      if (project?.client_id) {
        router.push(`/clients/${project.client_id}`);
      } else {
        router.push('/');
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(Array.from(e.dataTransfer.files));
    }
  }, [id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(Array.from(e.target.files));
    }
  };

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', id);

        const response = await fetch('/api/documents', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Upload failed');
        }
      }

      await loadDocuments();
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    setDeletingDocId(docId);
    try {
      const response = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      setDocuments(documents.filter(d => d.id !== docId));
    } catch (error) {
      console.error('Error deleting document:', error);
    } finally {
      setDeletingDocId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="takeoff-shell takeoff-light-theme min-h-screen">
        <div className="takeoff-dot-grid flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-3 rounded-full border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] px-5 py-3 text-[12px] text-[var(--takeoff-text-muted)] shadow-[0_18px_36px_rgba(31,39,33,0.08)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--takeoff-ink)]" />
            Loading project workspace
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="takeoff-shell takeoff-light-theme min-h-screen">
        <div className="takeoff-dot-grid flex min-h-screen items-center justify-center px-8">
          <div className="max-w-md rounded-[28px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] px-6 py-6 text-center shadow-[0_24px_48px_rgba(31,39,33,0.08)]">
            <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
              Project
            </div>
            <p className="mt-3 text-[22px] font-semibold tracking-[-0.03em] text-[var(--takeoff-ink)]">
              Project not found
            </p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--takeoff-text-muted)]">
              This project may have been removed or the link is no longer valid.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const statusLabel = formatProjectStatus(project.status);
  const statusBadgeClass = projectStatusBadgeClass(project.status);
  const primaryButtonClass =
    'takeoff-mono inline-flex h-11 items-center justify-center rounded-[12px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-5 text-[11px] font-semibold text-white shadow-[0_10px_28px_rgba(31,39,33,0.18)] transition-[background-color,border-color,transform,box-shadow] hover:-translate-y-[1px] hover:bg-[#202621] hover:shadow-[0_12px_32px_rgba(31,39,33,0.22)]';

  return (
    <div className="min-h-screen takeoff-shell takeoff-light-theme text-[var(--takeoff-ink)]">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,17,14,0.52)] px-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-[28px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.96)] p-6 shadow-[0_28px_64px_rgba(17,24,19,0.24)] animate-in zoom-in-95 duration-200">
            <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
              Project
            </div>
            <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--takeoff-ink)]">
              Delete Project
            </h3>
            <p className="mt-2 text-[13px] leading-6 text-[var(--takeoff-text-muted)]">
              Are you sure you want to delete <span className="font-semibold text-[var(--takeoff-ink)]">{project.name}</span>? This will permanently remove the project,
              all extracted data, documents, and any generated quotes. This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="takeoff-mono rounded-[12px] border-[var(--takeoff-line)] bg-white px-4 text-[11px] font-semibold text-[var(--takeoff-ink)] hover:bg-[var(--takeoff-paper)]"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
                className="takeoff-mono rounded-[12px] border border-[#d71921] bg-[#d71921] px-4 text-[11px] font-semibold text-white hover:bg-[#be1520]"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Project
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="takeoff-dot-grid min-h-screen px-8 py-8">
        <div className="mx-auto max-w-[1480px] space-y-6">
          <Link
            href={project.client_id ? `/clients/${project.client_id}` : '/'}
            className="ev-secondary-action inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-[11px] font-semibold transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {project.client_id ? 'Back to Client' : 'Back to Dashboard'}
          </Link>

          <section className="relative overflow-hidden rounded-[28px] border border-[var(--takeoff-line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(245,248,241,0.92))] px-6 py-5 shadow-[0_24px_52px_rgba(31,39,33,0.1)] backdrop-blur-xl">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--takeoff-accent),var(--takeoff-ink))]" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="absolute right-6 top-6 h-10 w-10 rounded-[12px] border-[var(--takeoff-line)] bg-white p-0 text-[#d71921] hover:border-[#e0b1b5] hover:bg-[#fff5f5]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <div className="flex items-start gap-4 pr-14">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-[var(--takeoff-line)] bg-white shadow-[0_14px_30px_rgba(31,39,33,0.08)]">
                <FileText className="h-7 w-7 text-[var(--takeoff-accent)]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[40px] font-semibold tracking-[-0.05em] text-[var(--takeoff-ink)]">
                  {project.name}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--takeoff-text-muted)]">
                  {project.client && (
                    <Link
                      href={`/clients/${project.client.id}`}
                      className="inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 py-1.5 transition-colors hover:border-[var(--takeoff-line-strong)] hover:text-[var(--takeoff-ink)]"
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      <span>{project.client.name}</span>
                    </Link>
                  )}
                  <span className={`takeoff-mono inline-flex rounded-[12px] border px-3 py-1.5 text-[11px] font-semibold ${statusBadgeClass}`}>
                    {statusLabel}
                  </span>
                  {project.pdf_url && (
                    <a
                      href={project.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 py-1.5 transition-colors hover:border-[var(--takeoff-line-strong)] hover:text-[var(--takeoff-accent)]"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View plan
                    </a>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Link
              href={`/projects/${project.id}/takeoff`}
              className="group flex min-h-[132px] items-center justify-between gap-4 rounded-[28px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] px-6 py-5 text-white shadow-[0_24px_48px_rgba(31,39,33,0.18)] transition-[transform,box-shadow,background-color] hover:-translate-y-[2px] hover:bg-[#202621] hover:shadow-[0_28px_56px_rgba(31,39,33,0.22)]"
            >
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] border border-white/15 bg-white/10">
                  <FileCheck className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <p className="takeoff-label text-[9px] font-semibold text-white/56">Primary</p>
                  <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.04em]">
                    Open Takeoff
                  </h2>
                  <p className="mt-1 text-[12px] text-white/68">
                    Measure and review the job scope.
                  </p>
                </div>
              </div>
              <span className="takeoff-mono hidden rounded-[12px] border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-white/80 transition-colors group-hover:bg-white/15 sm:inline-flex">
                Open
              </span>
            </Link>

            <Link
              href={`/projects/${project.id}/quote`}
              className="group flex min-h-[132px] items-center justify-between gap-4 rounded-[28px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.92)] px-6 py-5 shadow-[0_20px_44px_rgba(31,39,33,0.08)] transition-[transform,box-shadow,border-color,background-color] hover:-translate-y-[2px] hover:border-[var(--takeoff-line-strong)] hover:bg-white hover:shadow-[0_24px_52px_rgba(31,39,33,0.12)]"
            >
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                  {project.status === 'completed' ? (
                    <Eye className="h-6 w-6 text-[var(--takeoff-ink)]" />
                  ) : (
                    <FileCheck className="h-6 w-6 text-[var(--takeoff-ink)]" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="takeoff-label text-[9px] font-semibold text-[var(--takeoff-text-subtle)]">Output</p>
                  <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.04em] text-[var(--takeoff-ink)]">
                    {project.status === 'completed' ? 'View Quote' : 'Generate Quote'}
                  </h2>
                  <p className="mt-1 text-[12px] text-[var(--takeoff-text-muted)]">
                    Build the client quote package.
                  </p>
                </div>
              </div>
              <span className="takeoff-mono hidden rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 py-1.5 text-[10px] font-semibold text-[var(--takeoff-text-muted)] transition-colors group-hover:border-[var(--takeoff-line-strong)] group-hover:text-[var(--takeoff-ink)] sm:inline-flex">
                {project.status === 'completed' ? 'View' : 'Create'}
              </span>
            </Link>
          </section>

          <section className="rounded-[28px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.86)] px-6 py-5 shadow-[0_20px_44px_rgba(31,39,33,0.08)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                  <File className="h-5 w-5 text-[var(--takeoff-ink)]" />
                </div>
                <div>
                  <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-[var(--takeoff-ink)]">
                    Documents
                  </h2>
                  <p className="text-[12px] text-[var(--takeoff-text-muted)]">
                    {documents.length} {documents.length === 1 ? 'file' : 'files'}
                  </p>
                </div>
              </div>
              <label>
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isUploading}
                />
                <Button size="sm" className={`${primaryButtonClass} h-10 cursor-pointer px-4`} asChild disabled={isUploading}>
                  <span>
                    {isUploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add Files
                  </span>
                </Button>
              </label>
            </div>

            {documents.length === 0 ? (
              <div
                className={`mt-4 rounded-[22px] border-2 border-dashed px-6 py-8 text-center transition-colors ${
                  dragActive
                    ? 'border-[var(--takeoff-line-strong)] bg-[rgba(255,255,255,0.72)]'
                    : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                {isUploading ? (
                  <div className="flex items-center justify-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--takeoff-ink)]" />
                    <p className="text-[13px] text-[var(--takeoff-text-muted)]">Uploading files</p>
                  </div>
                ) : (
                  <>
                    <Upload className="mx-auto h-6 w-6 text-[var(--takeoff-ink)]" />
                    <p className="mt-3 text-[13px] font-medium text-[var(--takeoff-ink)]">
                      Drop files here or use Add Files
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => window.location.assign(doc.file_url)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        window.location.assign(doc.file_url);
                      }
                    }}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-[22px] border border-[var(--takeoff-line)] bg-white px-4 py-4 shadow-[0_12px_24px_rgba(31,39,33,0.05)] transition-[background-color,box-shadow,transform] hover:-translate-y-[1px] hover:bg-[var(--takeoff-paper)] hover:shadow-[0_16px_30px_rgba(31,39,33,0.09)] focus:outline-none focus:ring-2 focus:ring-[var(--takeoff-ink)]/10"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                        {getFileIcon(doc.file_type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-[var(--takeoff-ink)]">
                          {doc.name}
                        </p>
                        <p className="mt-1 text-[11px] text-[var(--takeoff-text-muted)]">
                          {formatFileSize(doc.file_size)} · {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <a
                        href={doc.file_url}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Open ${doc.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] transition-colors hover:border-[var(--takeoff-line-strong)] hover:text-[var(--takeoff-ink)]"
                      >
                        <Eye className="h-4 w-4" />
                      </a>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteDocument(doc.id);
                        }}
                        disabled={deletingDocId === doc.id}
                        aria-label={`Delete ${doc.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[rgba(215,25,33,0.14)] bg-white text-[#d71921] transition-colors hover:bg-[#fff5f5]"
                      >
                        {deletingDocId === doc.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[var(--takeoff-text-subtle)]" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
