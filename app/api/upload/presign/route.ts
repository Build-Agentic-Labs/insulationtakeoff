import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import {
  getMaxUploadSizeBytes,
  getMaxUploadSizeMb,
  isAllowedFileExtension,
  isAllowedFileType,
  storagePathToAppUrl,
} from '@/lib/supabase/storage';

export async function POST(request: NextRequest) {
  try {
    const { projectId, fileExtension, fileSize, fileType } = await request.json();
    const companyId = await requireServerCompanyId();

    if (!projectId || !fileExtension || typeof fileSize !== 'number' || typeof fileType !== 'string') {
      return NextResponse.json(
        { error: 'projectId, fileExtension, fileSize, and fileType are required' },
        { status: 400 }
      );
    }

    const normalizedExtension = String(fileExtension).toLowerCase();
    if (!/^[a-z0-9]+$/.test(normalizedExtension) || !isAllowedFileExtension(normalizedExtension)) {
      return NextResponse.json(
        { error: 'Only PDF and image files (JPG, PNG, WEBP) are allowed' },
        { status: 400 }
      );
    }

    if (!isAllowedFileType(fileType)) {
      return NextResponse.json(
        { error: 'Only PDF and image files (JPG, PNG, WEBP) are allowed' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > getMaxUploadSizeBytes()) {
      return NextResponse.json(
        { error: `File size exceeds ${getMaxUploadSizeMb()}MB limit` },
        { status: 400 }
      );
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('company_id', companyId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const filePath = `companies/${companyId}/projects/${projectId}.${normalizedExtension}`;

    // Create a signed upload URL (valid for 60 minutes)
    const { data, error } = await supabaseAdmin.storage
      .from('pdfs')
      .createSignedUploadUrl(filePath, { upsert: true });

    if (error) {
      console.error('Signed URL error:', error);
      return NextResponse.json(
        { error: 'Failed to create upload URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      publicUrl: storagePathToAppUrl(filePath),
    });
  } catch (error) {
    console.error('Presign error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
