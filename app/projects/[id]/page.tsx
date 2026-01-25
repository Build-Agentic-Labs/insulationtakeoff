"use client";

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileText,
  Search,
  Edit,
  FileCheck,
  RefreshCw,
  Eye,
  Loader2,
  ArrowLeft,
  Trash2,
  Building2,
  Upload,
  File,
  Image,
  FileSpreadsheet,
  FileArchive,
  X,
  Download,
  Plus,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  status: string;
  pdf_url: string;
  created_at: string;
  client_id: string | null;
  client?: {
    id: string;
    name: string;
  };
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
  if (fileType?.startsWith('image/')) return <Image className="h-5 w-5 text-blue-500" />;
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
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          client:clients(id, name)
        `)
        .eq('id', id)
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
        router.push('/projects');
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
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-zinc-500">Project not found</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
              Delete Project
            </h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">
              Are you sure you want to delete "{project.name}"? This will permanently remove the project,
              all extracted data, documents, and any generated quotes. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700"
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

      {/* Header */}
      <div className="mb-8">
        <Link
          href={project.client_id ? `/clients/${project.client_id}` : '/projects'}
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.client_id ? 'Back to Client' : 'Back to Projects'}
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <FileText className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">{project.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                {project.client && (
                  <Link
                    href={`/clients/${project.client.id}`}
                    className="flex items-center gap-1 text-zinc-500 hover:text-primary transition-colors"
                  >
                    <Building2 className="h-4 w-4" />
                    <span>{project.client.name}</span>
                  </Link>
                )}
                <span className="text-zinc-400">
                  Created {new Date(project.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Project Info Card */}
      <Card className="mb-6 border-zinc-200 dark:border-zinc-700 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Project Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Status</p>
              <p className="font-medium capitalize text-zinc-900 dark:text-white">
                {project.status === 'manual' ? 'Manual Entry' : project.status}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Source File</p>
              {project.pdf_url ? (
                <a
                  href={project.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  <FileText className="h-4 w-4" />
                  View File
                </a>
              ) : (
                <span className="text-zinc-400 text-sm">No file - manual entry</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Cards */}
      <div className={`grid gap-4 mb-6 ${project.status === 'manual' || !project.pdf_url ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {/* Only show extraction card if project has a source file */}
        {project.pdf_url && (
          <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm hover:border-primary hover:shadow-md transition-all flex flex-col">
            <CardHeader className="flex-1 pb-3">
              {project.status === 'uploaded' ? (
                <Search className="h-8 w-8 mb-2 text-primary" />
              ) : (
                <RefreshCw className="h-8 w-8 mb-2 text-primary" />
              )}
              <CardTitle>
                {project.status === 'uploaded' ? 'Extract Data' : 'Re-Extract Data'}
              </CardTitle>
              <CardDescription>
                {project.status === 'uploaded'
                  ? 'Use AI to extract measurements from the file'
                  : 'Run extraction again to update measurements'}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Link href={`/projects/${project.id}/extract`}>
                <Button className="w-full" variant={project.status === 'uploaded' ? 'default' : 'outline'}>
                  {project.status === 'uploaded' ? 'Start Extraction' : 'Re-Extract'}
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm hover:border-primary hover:shadow-md transition-all flex flex-col">
          <CardHeader className="flex-1 pb-3">
            <Edit className="h-8 w-8 mb-2 text-primary" />
            <CardTitle>
              {project.status === 'manual' ? 'Enter Data' : 'Review Data'}
            </CardTitle>
            <CardDescription>
              {project.status === 'manual'
                ? 'Manually add rooms and measurements'
                : 'Review and edit extracted measurements'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Link href={`/projects/${project.id}/review`}>
              <Button className="w-full" variant={project.status === 'manual' ? 'default' : 'outline'}>
                {project.status === 'manual' ? 'Add Data' : 'Review'}
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm hover:border-primary hover:shadow-md transition-all flex flex-col">
          <CardHeader className="flex-1 pb-3">
            {project.status === 'completed' ? (
              <Eye className="h-8 w-8 mb-2 text-primary" />
            ) : (
              <FileCheck className="h-8 w-8 mb-2 text-primary" />
            )}
            <CardTitle>
              {project.status === 'completed' ? 'View Quote' : 'Generate Quote'}
            </CardTitle>
            <CardDescription>
              {project.status === 'completed'
                ? 'View or regenerate your quote'
                : 'Create a professional PDF quote'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Link href={`/projects/${project.id}/quote`}>
              <Button className="w-full" variant={project.status === 'completed' ? 'default' : 'outline'}>
                {project.status === 'completed' ? 'View Quote' : 'Generate'}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Documents Section */}
      <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Documents</CardTitle>
              <CardDescription>
                Upload and manage project-related files
              </CardDescription>
            </div>
            <label>
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={isUploading}
              />
              <Button size="sm" className="cursor-pointer" asChild disabled={isUploading}>
                <span>
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add Files
                </span>
              </Button>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-all mb-4 ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-zinc-500">Uploading...</p>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 mx-auto text-zinc-400 mb-2" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Drag and drop files here to upload
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Any file type up to 50MB
                </p>
              </>
            )}
          </div>

          {/* Documents List */}
          {documents.length === 0 ? (
            <div className="text-center py-6">
              <File className="h-10 w-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No documents uploaded yet
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-100 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-10 w-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      {getFileIcon(doc.file_type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-900 dark:text-white truncate">
                        {doc.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatFileSize(doc.file_size)} • {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md transition-colors"
                    >
                      <Download className="h-4 w-4 text-zinc-500" />
                    </a>
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      disabled={deletingDocId === doc.id}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-md transition-colors"
                    >
                      {deletingDocId === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-red-500" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
