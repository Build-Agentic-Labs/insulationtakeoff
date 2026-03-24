import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = supabaseAdmin;
  const body = await request.json();

  const { data, error } = await supabase
    .from('takeoff_regions')
    .insert({ ...body, session_id: sessionId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = supabaseAdmin;
  const body = await request.json();
  const regionId = request.nextUrl.searchParams.get('region_id');

  if (!regionId) {
    return NextResponse.json({ error: 'region_id required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('takeoff_regions')
    .update(body)
    .eq('id', regionId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
