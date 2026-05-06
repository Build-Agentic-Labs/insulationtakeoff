import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from './server';

export const BUCKET_NAME = 'pdfs';
export const MAX_SUPPORT_ATTACHMENTS = 5;
export const MAX_SUPPORT_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_UPLOAD_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'] as const;
export const ALLOWED_SUPPORT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_SUPPORT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export function getMaxUploadSizeMb(): number {
  const parsed = Number.parseInt(process.env.MAX_PDF_SIZE_MB || '50', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function getMaxUploadSizeBytes(): number {
  return getMaxUploadSizeMb() * 1024 * 1024;
}

export function isAllowedFileType(mimeType: string): boolean {
  return ALLOWED_UPLOAD_TYPES.includes(mimeType as (typeof ALLOWED_UPLOAD_TYPES)[number]);
}

export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

export function isAllowedFileExtension(extension: string): boolean {
  return ALLOWED_UPLOAD_EXTENSIONS.includes(extension.toLowerCase() as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number]);
}

export function validateUploadFile(file: File): string | null {
  if (!isAllowedFileType(file.type)) {
    return 'Only PDF and image files (JPG, PNG, WEBP) are allowed';
  }

  if (!isAllowedFileExtension(getFileExtension(file.name))) {
    return 'Only PDF and image files (JPG, PNG, WEBP) are allowed';
  }

  if (file.size > getMaxUploadSizeBytes()) {
    return `File size exceeds ${getMaxUploadSizeMb()}MB limit`;
  }

  return null;
}

export function safeStorageFileName(fileName: string): string {
  const safeName = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);

  return safeName || 'attachment';
}

export function validateSupportAttachment(file: File): string | null {
  if (!ALLOWED_SUPPORT_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_SUPPORT_IMAGE_TYPES)[number])) {
    return 'Support screenshots must be JPG, PNG, or WEBP images';
  }

  if (!ALLOWED_SUPPORT_IMAGE_EXTENSIONS.includes(getFileExtension(file.name) as (typeof ALLOWED_SUPPORT_IMAGE_EXTENSIONS)[number])) {
    return 'Support screenshots must use a JPG, PNG, or WEBP file extension';
  }

  if (file.size > MAX_SUPPORT_ATTACHMENT_SIZE_BYTES) {
    return 'Support screenshots must be 10MB or smaller';
  }

  return null;
}

export function validateSupportAttachments(files: File[]): string | null {
  if (files.length > MAX_SUPPORT_ATTACHMENTS) {
    return `Attach up to ${MAX_SUPPORT_ATTACHMENTS} screenshots per support request`;
  }

  for (const file of files) {
    const error = validateSupportAttachment(file);
    if (error) return error;
  }

  return null;
}

export function storagePathToAppUrl(path: string): string {
  return `/api/storage/file?path=${encodeURIComponent(path)}`;
}

export function getStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;

  if (value.startsWith(`companies/`) || value.startsWith(`projects/`)) {
    return value.split('?')[0];
  }

  try {
    const parsed = new URL(value, 'http://localhost');
    const pathParam = parsed.searchParams.get('path');
    if (parsed.pathname === '/api/storage/file' && pathParam) {
      return pathParam.split('?')[0];
    }
  } catch {
    // Fall through to legacy URL parsing.
  }

  const objectMarkers = [
    `/storage/v1/object/public/${BUCKET_NAME}/`,
    `/storage/v1/object/sign/${BUCKET_NAME}/`,
    `/${BUCKET_NAME}/`,
  ];

  for (const marker of objectMarkers) {
    const index = value.indexOf(marker);
    if (index >= 0) {
      return decodeURIComponent(value.slice(index + marker.length).split('?')[0]);
    }
  }

  return null;
}

export function assertCompanyStoragePath(path: string, companyId: string): void {
  if (!path.startsWith(`companies/${companyId}/`)) {
    throw new Error('Storage object is outside the active company scope');
  }
}

export function assertProjectStoragePath(path: string, companyId: string, projectId: string): void {
  assertCompanyStoragePath(path, companyId);

  const prefix = `companies/${companyId}/projects/${projectId}.`;
  if (!path.startsWith(prefix) || !isAllowedFileExtension(path.slice(prefix.length))) {
    throw new Error('Storage object is outside the active project scope');
  }
}

export async function createSignedStorageUrl(value: string, companyId: string, expiresIn = 300): Promise<string> {
  const path = getStoragePath(value);
  if (!path) {
    throw new Error('Invalid storage URL');
  }

  assertCompanyStoragePath(path, companyId);

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Failed to create signed file URL');
  }

  return data.signedUrl;
}

export async function uploadSupportAttachment(
  file: File,
  companyId: string,
  ticketId: string,
  index: number
): Promise<{
  storagePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}> {
  const validationError = validateSupportAttachment(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const safeName = safeStorageFileName(file.name);
  const filePath = `companies/${companyId}/support/${ticketId}/${index + 1}-${randomUUID()}-${safeName}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(filePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload support screenshot: ${error.message}`);
  }

  return {
    storagePath: filePath,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

export async function uploadFile(file: File, projectId: string, companyId?: string): Promise<string> {
  const validationError = validateUploadFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const fileExt = getFileExtension(file.name) || 'pdf';
  const fileName = `${projectId}.${fileExt}`;
  const filePath = companyId
    ? `companies/${companyId}/projects/${fileName}`
    : `projects/${fileName}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return storagePathToAppUrl(filePath);
}

// Legacy function name for backwards compatibility
export const uploadPDF = uploadFile;

export async function deleteFile(url: string): Promise<void> {
  const path = getStoragePath(url);

  if (!path) {
    throw new Error('Invalid file URL');
  }

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove([path]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

// Legacy function name for backwards compatibility
export const deletePDF = deleteFile;

export async function getFileUrl(projectId: string, extension: string = 'pdf', companyId?: string): Promise<string> {
  const path = companyId
    ? `companies/${companyId}/projects/${projectId}.${extension}`
    : `projects/${projectId}.${extension}`;

  return storagePathToAppUrl(path);
}

// Legacy function name for backwards compatibility
export const getPDFUrl = (projectId: string) => getFileUrl(projectId, 'pdf');
