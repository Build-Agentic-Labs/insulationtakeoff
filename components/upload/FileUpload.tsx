"use client";

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Image, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FileUploadProps {
  onFileSelect: (file: File | null) => void;
  maxSize?: number; // in MB
}

const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

const ACCEPTED_EXTENSIONS = ['PDF', 'JPG', 'JPEG', 'PNG', 'WEBP'];

export function FileUpload({ onFileSelect, maxSize = 50 }: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isImageFile = (file: File) => {
    return file.type.startsWith('image/');
  };

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    setError(null);

    if (rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      if (rejection.errors[0]?.code === 'file-too-large') {
        setError(`File is too large. Maximum size is ${maxSize}MB.`);
      } else if (rejection.errors[0]?.code === 'file-invalid-type') {
        setError(`Invalid file type. Accepted formats: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      } else {
        setError('Invalid file. Please try again.');
      }
      return;
    }

    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFile(file);
      onFileSelect(file);
    }
  }, [maxSize, onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: maxSize * 1024 * 1024,
    multiple: false,
  });

  const clearFile = () => {
    setSelectedFile(null);
    setError(null);
    onFileSelect(null);
  };

  return (
    <div className="w-full">
      {!selectedFile ? (
        <div
          {...getRootProps()}
          className={`cursor-pointer rounded-[22px] border-2 border-dashed p-12 text-center transition-colors ${
            isDragActive
              ? 'border-[var(--takeoff-line-strong)] bg-white'
              : 'border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] hover:border-[var(--takeoff-line-strong)]'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="mx-auto mb-4 h-12 w-12 text-[var(--takeoff-text-muted)]" />
          <p className="text-lg font-medium mb-2">
            {isDragActive ? 'Drop the file here' : 'Drag & drop a file here'}
          </p>
          <p className="mb-4 text-sm text-[var(--takeoff-text-muted)]">
            or click to browse
          </p>
          <p className="text-xs text-[var(--takeoff-text-subtle)]">
            Accepted formats: {ACCEPTED_EXTENSIONS.join(', ')} (max {maxSize}MB)
          </p>
        </div>
      ) : (
        <div className="rounded-[22px] border border-[var(--takeoff-line)] bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isImageFile(selectedFile) ? (
                <Image className="h-10 w-10 text-[#47644a]" />
              ) : (
                <FileText className="h-10 w-10 text-[var(--takeoff-accent)]" />
              )}
              <div>
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-[var(--takeoff-text-muted)]">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearFile}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
