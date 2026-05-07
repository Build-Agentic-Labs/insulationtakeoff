import { NextRequest, NextResponse } from 'next/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { insertProjectWithSlug } from '@/lib/projects/server';

const PROJECT_STATUSES = ['uploaded', 'extracting', 'reviewing', 'completed', 'manual'] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, clientId } = body;
    const companyId = await requireServerCompanyId();

    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    if (body.status !== undefined && !PROJECT_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: 'Invalid project status' },
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

    // Create project record
    // Use 'reviewing' as default status (database constraint doesn't allow 'manual')
    const insertData = {
      name: name.trim(),
      company_id: companyId,
      pdf_url: '',
      status: body.status || 'reviewing',
      client_id: clientId || null,
    };

    const { data: project, error: projectError } = await insertProjectWithSlug(insertData);

    if (projectError) {
      console.error('Error creating project:', projectError);
      console.error('Project error details:', JSON.stringify(projectError, null, 2));
      return NextResponse.json(
        { error: `Failed to create project: ${projectError.message || projectError.code || 'Unknown error'}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (error) {
    console.error('Create project error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
