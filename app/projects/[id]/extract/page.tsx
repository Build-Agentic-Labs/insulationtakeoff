"use client";

import { use, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Search, CheckCircle2, AlertCircle, Upload, FileText, RefreshCw, Image } from 'lucide-react';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const ACCEPTED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp';

function isAllowedFileType(mimeType: string): boolean {
  return ALLOWED_TYPES.includes(mimeType);
}

function isImageFile(url: string): boolean {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  return ['jpg', 'jpeg', 'png', 'webp'].includes(ext || '');
}

export default function ExtractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [showUpload, setShowUpload] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    try {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      setProject(data);
    } catch (err) {
      console.error('Error loading project:', err);
    } finally {
      setIsLoading(false);
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

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!isAllowedFileType(file.type)) {
      setError('Please upload a PDF or image file (JPG, PNG, WEBP)');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', id);

      const response = await fetch('/api/upload/replace', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      // Refresh project data
      await loadProject();
      setShowUpload(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleExtract = async () => {
    setIsExtracting(true);
    setError(null);
    setProgress('Starting extraction...');

    try {
      setProgress('Analyzing file with Claude AI...');

      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Extraction failed');
      }

      setProgress('Extraction completed successfully!');

      // Wait a moment to show success message
      setTimeout(() => {
        router.push(`/projects/${id}/review`);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setIsExtracting(false);
      setProgress('');
    }
  };

  const isReExtract = project?.status !== 'uploaded';
  const currentFileIsImage = project?.pdf_url && isImageFile(project.pdf_url);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Current File Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {currentFileIsImage ? (
                <Image className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
              Current File
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${
                  currentFileIsImage
                    ? 'bg-blue-100 dark:bg-blue-900/30'
                    : 'bg-red-100 dark:bg-red-900/30'
                }`}>
                  {currentFileIsImage ? (
                    <Image className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <FileText className="h-6 w-6 text-red-600 dark:text-red-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{project?.name}</p>
                  <a
                    href={project?.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    View {currentFileIsImage ? 'Image' : 'PDF'}
                  </a>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUpload(!showUpload)}
                disabled={isExtracting || isUploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                Replace File
              </Button>
            </div>

            {/* Upload New File Section */}
            {showUpload && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-3">
                  Upload a new PDF or image to replace the current file
                </p>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                    dragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-zinc-300 dark:border-zinc-600 hover:border-primary'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Uploading...</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground mb-2">
                        Drag and drop a file here, or
                      </p>
                      <label>
                        <input
                          type="file"
                          accept={ACCEPTED_EXTENSIONS}
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        <span className="text-sm text-primary hover:underline cursor-pointer">
                          browse to select
                        </span>
                      </label>
                      <p className="text-xs text-muted-foreground mt-2">
                        PDF, JPG, PNG, or WEBP
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Extraction Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isReExtract ? (
                <RefreshCw className="h-6 w-6" />
              ) : (
                <Search className="h-6 w-6" />
              )}
              {isReExtract ? 'Re-Extract Data' : 'AI Data Extraction'}
            </CardTitle>
            <CardDescription>
              {isReExtract
                ? 'Run extraction again to update measurements from the file'
                : 'Extract measurements from architectural plans using Claude AI'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isReExtract && (
              <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>Note:</strong> Re-extracting will replace the existing extracted data.
                  Any manual edits you made in the review page will be overwritten.
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div className="border-l-4 border-primary pl-4 py-2">
                <h3 className="font-semibold mb-2">What will be extracted:</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>• Living area square footage</li>
                  <li>• Garage area square footage</li>
                  <li>• Wall heights from section views</li>
                  <li>• Attic/ceiling area from roof plans</li>
                  <li>• Individual room dimensions</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm">
                  <strong>Note:</strong> The extraction process may take 1-3 minutes depending on the complexity of your file.
                  Claude AI will analyze the content and extract relevant measurements.
                </p>
              </div>
            </div>

            {isExtracting && (
              <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div className="flex-1">
                  <p className="font-medium text-blue-900 dark:text-blue-100">
                    {progress}
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Please wait...
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-3 p-4 bg-destructive/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <div className="flex-1">
                  <p className="font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/90">{error}</p>
                </div>
              </div>
            )}

            {progress === 'Extraction completed successfully!' && (
              <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div className="flex-1">
                  <p className="font-medium text-green-900 dark:text-green-100">
                    Success!
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Redirecting to review page...
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={handleExtract}
                disabled={isExtracting || isUploading}
                className="flex-1"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Extracting...
                  </>
                ) : isReExtract ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Re-Extract Data
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Start Extraction
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/projects/${id}`)}
                disabled={isExtracting}
              >
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
