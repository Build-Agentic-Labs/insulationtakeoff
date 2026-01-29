import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, clientId } = body;

    console.log('Creating project with:', { name, clientId, status: body.status });

    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    // Create project record
    const insertData = {
      name: name.trim(),
      pdf_url: '',
      status: body.status || 'manual',
      client_id: clientId || null,
    };
    console.log('Insert data:', insertData);

    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert(insertData)
      .select()
      .single();

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
