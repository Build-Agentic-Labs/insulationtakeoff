import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the document to find the file URL
    const { data: document, error: fetchError } = await supabaseAdmin
      .from('documents')
      .select('file_url')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching document:', fetchError);
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Delete file from storage
    if (document.file_url) {
      const urlParts = document.file_url.split('/pdfs/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1].split('?')[0];
        await supabaseAdmin.storage.from('pdfs').remove([filePath]);
      }
    }

    // Delete document record
    const { error: deleteError } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting document:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete document' },
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
