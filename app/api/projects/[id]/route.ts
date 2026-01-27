import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = ['pdf_url', 'status', 'name'];
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }

    return NextResponse.json({ success: true, project: data });
  } catch (error) {
    console.error('Update project error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the project to find the PDF URL
    const { data: project, error: fetchError } = await supabaseAdmin
      .from('projects')
      .select('pdf_url')
      .eq('id', id)
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
      // Extract the file path from the URL
      // URL format: https://xxx.supabase.co/storage/v1/object/public/pdfs/project-id/filename.pdf
      const urlParts = project.pdf_url.split('/pdfs/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
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
      .eq('project_id', id);

    if (documents && documents.length > 0) {
      // Delete document files from storage
      for (const doc of documents) {
        if (doc.file_url) {
          const urlParts = doc.file_url.split('/pdfs/');
          if (urlParts.length > 1) {
            const filePath = urlParts[1].split('?')[0];
            await supabaseAdmin.storage.from('pdfs').remove([filePath]);
          }
        }
      }

      // Delete document records
      await supabaseAdmin
        .from('documents')
        .delete()
        .eq('project_id', id);
    }

    // Delete quotes associated with this project
    const { error: quotesError } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('project_id', id);

    if (quotesError) {
      console.error('Error deleting quotes:', quotesError);
    }

    // Delete measurements (need to get room IDs first)
    const { data: rooms } = await supabaseAdmin
      .from('rooms')
      .select('id')
      .eq('project_id', id);

    if (rooms && rooms.length > 0) {
      const roomIds = rooms.map(r => r.id);
      const { error: measurementsError } = await supabaseAdmin
        .from('measurements')
        .delete()
        .in('room_id', roomIds);

      if (measurementsError) {
        console.error('Error deleting measurements:', measurementsError);
      }
    }

    // Delete rooms
    const { error: roomsError } = await supabaseAdmin
      .from('rooms')
      .delete()
      .eq('project_id', id);

    if (roomsError) {
      console.error('Error deleting rooms:', roomsError);
    }

    // Delete the project
    const { error: deleteError } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', id);

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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
