import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { uploadFile, validateUploadFile } from '@/lib/supabase/storage';
import { requireServerCompanyId } from '@/lib/supabase/company-server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectName = formData.get('name') as string;
    const clientId = formData.get('clientId') as string | null;
    const companyId = await requireServerCompanyId();

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

    const validationError = validateUploadFile(file);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    if (clientId) {
      const { data: client, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('company_id', companyId)
        .single();

      if (clientError || !client) {
        return NextResponse.json(
          { error: 'Client not found' },
          { status: 404 }
        );
      }
    }

    // Create project record first to get the ID
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert({
        name: projectName,
        company_id: companyId,
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
    const fileUrl = await uploadFile(file, project.id, companyId);

    // Update project with file URL
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({ pdf_url: fileUrl })
      .eq('id', project.id)
      .eq('company_id', companyId);

    if (updateError) {
      console.error('Error updating project:', updateError);
      return NextResponse.json(
        { error: 'Failed to update project with file URL' },
        { status: 500 }
      );
    }

    const { error: documentError } = await supabaseAdmin
      .from('documents')
      .insert({
        project_id: project.id,
        company_id: companyId,
        name: file.name,
        file_url: fileUrl,
        file_type: file.type,
        file_size: file.size,
      });

    if (documentError) {
      console.error('Error creating document record:', documentError);
      return NextResponse.json(
        { error: 'Failed to create document record' },
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
