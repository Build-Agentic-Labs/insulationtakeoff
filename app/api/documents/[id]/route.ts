import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { assertCompanyStoragePath, getStoragePath } from '@/lib/supabase/storage';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const companyId = await requireServerCompanyId();

    // Get the document to find the file URL
    const { data: document, error: fetchError } = await supabaseAdmin
      .from('documents')
      .select('file_url')
      .eq('id', id)
      .eq('company_id', companyId)
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
      const filePath = getStoragePath(document.file_url);
      if (filePath) {
        assertCompanyStoragePath(filePath, companyId);
        await supabaseAdmin.storage.from('pdfs').remove([filePath]);
      }
    }

    // Delete document record
    const { error: deleteError } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

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
