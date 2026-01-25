import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { uploadFile, isAllowedFileType } from '@/lib/supabase/storage';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectName = formData.get('name') as string;
    const clientId = formData.get('clientId') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!projectName) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!isAllowedFileType(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF and image files (JPG, PNG, WEBP) are allowed' },
        { status: 400 }
      );
    }

    // Validate file size (50MB max)
    const maxSize = parseInt(process.env.MAX_PDF_SIZE_MB || '50') * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File size exceeds ${process.env.MAX_PDF_SIZE_MB || '50'}MB limit` },
        { status: 400 }
      );
    }

    // Create project record first to get the ID
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert({
        name: projectName,
        pdf_url: '', // Will update after upload
        status: 'uploaded',
        client_id: clientId || null,
      })
      .select()
      .single();

    if (projectError) {
      console.error('Error creating project:', projectError);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    // Upload file to storage
    const fileUrl = await uploadFile(file, project.id);

    // Update project with file URL
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({ pdf_url: fileUrl })
      .eq('id', project.id);

    if (updateError) {
      console.error('Error updating project:', updateError);
      return NextResponse.json(
        { error: 'Failed to update project with file URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      project: {
        ...project,
        pdf_url: fileUrl,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
