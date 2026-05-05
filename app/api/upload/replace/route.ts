import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { getFileExtension, storagePathToAppUrl, validateUploadFile } from '@/lib/supabase/storage';
import { requireServerCompanyId } from '@/lib/supabase/company-server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;
    const companyId = await requireServerCompanyId();

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Verify project exists
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('company_id', companyId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const validationError = validateUploadFile(file);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Get file extension
    const fileExt = getFileExtension(file.name) || 'pdf';

    // Delete old file if it exists (try common extensions)
    const extensions = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
    for (const ext of extensions) {
      const oldPath = `companies/${companyId}/projects/${projectId}.${ext}`;
      await supabaseAdmin.storage.from('pdfs').remove([oldPath]);
      await supabaseAdmin.storage.from('pdfs').remove([`projects/${projectId}.${ext}`]);
    }

    // Upload new file
    const filePath = `companies/${companyId}/projects/${projectId}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('pdfs')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    const fileUrl = `${storagePathToAppUrl(filePath)}&t=${Date.now()}`;

    // Update project with new file URL and reset status
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        pdf_url: fileUrl,
        status: 'uploaded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('company_id', companyId);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update project' },
        { status: 500 }
      );
    }

    // Delete existing rooms and measurements for this project
    // (they'll be re-extracted from the new file)
    await supabaseAdmin
      .from('rooms')
      .delete()
      .eq('project_id', projectId)
      .eq('company_id', companyId);

    await supabaseAdmin
      .from('openings')
      .delete()
      .eq('project_id', projectId)
      .eq('company_id', companyId);

    // Delete existing quotes (they're no longer valid)
    await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('project_id', projectId)
      .eq('company_id', companyId);

    await supabaseAdmin
      .from('takeoff_sessions')
      .delete()
      .eq('project_id', projectId)
      .eq('company_id', companyId);

    await supabaseAdmin
      .from('extraction_runs')
      .delete()
      .eq('project_id', projectId)
      .eq('company_id', companyId);

    const { data: document, error: documentError } = await supabaseAdmin
      .from('documents')
      .insert({
        company_id: companyId,
        project_id: projectId,
        name: file.name,
        file_url: fileUrl,
        file_type: file.type,
        file_size: file.size,
      })
      .select()
      .single();

    if (documentError || !document) {
      console.error('Document replace record error:', documentError);
      return NextResponse.json(
        { error: 'Failed to create replacement document record' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      pdfUrl: fileUrl,
      document,
    });
  } catch (error) {
    console.error('Replace file error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
