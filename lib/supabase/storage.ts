import { supabaseAdmin } from './server';

const BUCKET_NAME = 'pdfs';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function isAllowedFileType(mimeType: string): boolean {
  return ALLOWED_TYPES.includes(mimeType);
}

export async function uploadFile(file: File, projectId: string): Promise<string> {
  const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
  const fileName = `${projectId}.${fileExt}`;
  const filePath = `projects/${fileName}`;

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

  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

// Legacy function name for backwards compatibility
export const uploadPDF = uploadFile;

export async function deleteFile(url: string): Promise<void> {
  const path = url.split(`${BUCKET_NAME}/`)[1];

  if (!path) {
    throw new Error('Invalid file URL');
  }

  // Remove query params if present
  const cleanPath = path.split('?')[0];

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove([cleanPath]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

// Legacy function name for backwards compatibility
export const deletePDF = deleteFile;

export async function getFileUrl(projectId: string, extension: string = 'pdf'): Promise<string> {
  const { data } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(`projects/${projectId}.${extension}`);

  return data.publicUrl;
}

// Legacy function name for backwards compatibility
export const getPDFUrl = (projectId: string) => getFileUrl(projectId, 'pdf');
