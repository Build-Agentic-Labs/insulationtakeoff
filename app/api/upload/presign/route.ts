import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { projectId, fileExtension } = await request.json();

    if (!projectId || !fileExtension) {
      return NextResponse.json(
        { error: 'projectId and fileExtension are required' },
        { status: 400 }
      );
    }

    const filePath = `projects/${projectId}.${fileExtension}`;

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

    // Also get the public URL for after upload
    const { data: urlData } = supabaseAdmin.storage
      .from('pdfs')
      .getPublicUrl(filePath);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      publicUrl: urlData.publicUrl,
    });
  } catch (error) {
    console.error('Presign error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
