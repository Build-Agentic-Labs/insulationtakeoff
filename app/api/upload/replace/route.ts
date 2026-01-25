import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { isAllowedFileType } from '@/lib/supabase/storage';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;

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
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Validate file type
    if (!isAllowedFileType(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF and image files (JPG, PNG, WEBP) are allowed' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Get file extension
    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';

    // Delete old file if it exists (try common extensions)
    const extensions = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
    for (const ext of extensions) {
      const oldPath = `projects/${projectId}.${ext}`;
      await supabaseAdmin.storage.from('pdfs').remove([oldPath]);
    }

    // Upload new file
    const filePath = `projects/${projectId}.${fileExt}`;
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

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('pdfs')
      .getPublicUrl(filePath);

    // Add cache-busting timestamp to URL
    const fileUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Update project with new file URL and reset status
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        pdf_url: fileUrl,
        status: 'uploaded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

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
      .eq('project_id', projectId);

    // Delete existing quotes (they're no longer valid)
    await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('project_id', projectId);

    return NextResponse.json({
      success: true,
      pdfUrl: fileUrl,
    });
  } catch (error) {
    console.error('Replace file error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
