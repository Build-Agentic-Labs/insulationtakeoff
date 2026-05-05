import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyAdmin, requireServerCompanyId } from '@/lib/supabase/company-server';
import { authApiErrorResponse } from '@/lib/supabase/api-errors';
import type { Database } from '@/lib/supabase/types';
import {
  assertCompanyStoragePath,
  assertProjectStoragePath,
  getMaxUploadSizeBytes,
  getMaxUploadSizeMb,
  getStoragePath,
  isAllowedFileType,
  storagePathToAppUrl,
} from '@/lib/supabase/storage';

type ProjectUpdate = Database['public']['Tables']['projects']['Update'];
type ProjectStatus = NonNullable<ProjectUpdate['status']>;
type SourceDocumentInput = {
  name: string;
  file_type: string | null;
  file_size: number | null;
};

const PROJECT_STATUSES: ProjectStatus[] = ['uploaded', 'extracting', 'reviewing', 'completed', 'manual'];

function parseSourceDocumentInput(value: unknown): SourceDocumentInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';

  if (!name) {
    return null;
  }

  return {
    name,
    file_type: typeof payload.fileType === 'string' ? payload.fileType : null,
    file_size: typeof payload.fileSize === 'number' && Number.isFinite(payload.fileSize)
      ? Math.round(payload.fileSize)
      : null,
  };
}

function validateSourceDocumentInput(value: SourceDocumentInput): string | null {
  if (value.file_type && !isAllowedFileType(value.file_type)) {
    return 'Only PDF and image files (JPG, PNG, WEBP) are allowed';
  }

  if (typeof value.file_size !== 'number' || value.file_size <= 0 || value.file_size > getMaxUploadSizeBytes()) {
    return `File size exceeds ${getMaxUploadSizeMb()}MB limit`;
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const companyId = await requireServerCompanyId();
    const sourceDocument = parseSourceDocumentInput(body.sourceDocument);

    const updates: ProjectUpdate = {};

    if (typeof body.name === 'string') {
      updates.name = body.name;
    }

    if (typeof body.pdf_url === 'string') {
      const storagePath = getStoragePath(body.pdf_url);

      if (!storagePath) {
        return NextResponse.json({ error: 'Invalid project file URL' }, { status: 400 });
      }

      try {
        assertProjectStoragePath(storagePath, companyId, id);
      } catch {
        return NextResponse.json({ error: 'Invalid project file URL' }, { status: 400 });
      }

      updates.pdf_url = storagePathToAppUrl(storagePath);
    } else if (body.pdf_url === null) {
      updates.pdf_url = null;
    }

    if (typeof body.status === 'string') {
      if (!PROJECT_STATUSES.includes(body.status as ProjectStatus)) {
        return NextResponse.json({ error: 'Invalid project status' }, { status: 400 });
      }
      updates.status = body.status as ProjectStatus;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    if (sourceDocument) {
      const sourceDocumentError = validateSourceDocumentInput(sourceDocument);
      if (sourceDocumentError) {
        return NextResponse.json({ error: sourceDocumentError }, { status: 400 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }

    if (sourceDocument && data.pdf_url) {
      const { data: existingDocument, error: existingDocumentError } = await supabaseAdmin
        .from('documents')
        .select('id')
        .eq('project_id', id)
        .eq('company_id', companyId)
        .eq('file_url', data.pdf_url)
        .maybeSingle();

      if (existingDocumentError) {
        console.error('Error checking source document:', existingDocumentError);
        return NextResponse.json({ error: 'Failed to attach source document' }, { status: 500 });
      }

      if (existingDocument) {
        const { error: documentUpdateError } = await supabaseAdmin
          .from('documents')
          .update(sourceDocument)
          .eq('id', existingDocument.id)
          .eq('company_id', companyId);

        if (documentUpdateError) {
          console.error('Error updating source document:', documentUpdateError);
          return NextResponse.json({ error: 'Failed to attach source document' }, { status: 500 });
        }
      } else {
        const { error: documentInsertError } = await supabaseAdmin
          .from('documents')
          .insert({
            project_id: id,
            company_id: companyId,
            name: sourceDocument.name,
            file_url: data.pdf_url,
            file_type: sourceDocument.file_type,
            file_size: sourceDocument.file_size,
          });

        if (documentInsertError) {
          console.error('Error creating source document:', documentInsertError);
          return NextResponse.json({ error: 'Failed to attach source document' }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true, project: data });
  } catch (error) {
    console.error('Update project error:', error);
    return authApiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { companyId } = await requireServerCompanyAdmin();

    // Get the project to find the PDF URL
    const { data: project, error: fetchError } = await supabaseAdmin
      .from('projects')
      .select('pdf_url')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (fetchError) {
      console.error('Error fetching project:', fetchError);
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Delete PDF from storage if it exists
    if (project.pdf_url) {
      const filePath = getStoragePath(project.pdf_url);
      if (filePath) {
        assertCompanyStoragePath(filePath, companyId);
        const { error: storageError } = await supabaseAdmin.storage
          .from('pdfs')
          .remove([filePath]);

        if (storageError) {
          console.error('Error deleting PDF from storage:', storageError);
          // Continue with project deletion even if storage deletion fails
        }
      }
    }

    // Delete documents associated with this project
    const { data: documents } = await supabaseAdmin
      .from('documents')
      .select('file_url')
      .eq('project_id', id)
      .eq('company_id', companyId);

    if (documents && documents.length > 0) {
      // Delete document files from storage
      for (const doc of documents) {
        if (doc.file_url) {
          const filePath = getStoragePath(doc.file_url);
          if (filePath) {
            assertCompanyStoragePath(filePath, companyId);
            await supabaseAdmin.storage.from('pdfs').remove([filePath]);
          }
        }
      }

      // Delete document records
      await supabaseAdmin
        .from('documents')
        .delete()
        .eq('project_id', id)
        .eq('company_id', companyId);
    }

    // Delete quotes associated with this project
    const { error: quotesError } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('project_id', id)
      .eq('company_id', companyId);

    if (quotesError) {
      console.error('Error deleting quotes:', quotesError);
    }

    // Delete measurements (need to get room IDs first)
    const { data: rooms } = await supabaseAdmin
      .from('rooms')
      .select('id')
      .eq('project_id', id)
      .eq('company_id', companyId);

    if (rooms && rooms.length > 0) {
      const roomIds = rooms.map(r => r.id);
      const { error: measurementsError } = await supabaseAdmin
        .from('measurements')
        .delete()
        .in('room_id', roomIds)
        .eq('company_id', companyId);

      if (measurementsError) {
        console.error('Error deleting measurements:', measurementsError);
      }
    }

    // Delete rooms
    const { error: roomsError } = await supabaseAdmin
      .from('rooms')
      .delete()
      .eq('project_id', id)
      .eq('company_id', companyId);

    if (roomsError) {
      console.error('Error deleting rooms:', roomsError);
    }

    // Delete the project
    const { error: deleteError } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (deleteError) {
      console.error('Error deleting project:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete project' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return authApiErrorResponse(error);
  }
}
