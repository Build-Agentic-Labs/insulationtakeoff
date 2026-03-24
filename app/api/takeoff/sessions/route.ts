import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = supabaseAdmin;
  const body = await request.json();

  const { data, error } = await supabase
    .from('takeoff_sessions')
    .insert({
      project_id: body.project_id,
      document_id: body.document_id,
      selected_pages: body.selected_pages ?? [],
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET(request: NextRequest) {
  const supabase = supabaseAdmin;
  const documentId = request.nextUrl.searchParams.get('document_id');

  if (!documentId) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('takeoff_sessions')
    .select('*, takeoff_regions(*)')
    .eq('document_id', documentId)
    .eq('status', 'in_progress')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) return NextResponse.json({ session: null });
  return NextResponse.json({ session: data });
}
