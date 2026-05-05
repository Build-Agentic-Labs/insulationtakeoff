import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import type { Database } from '@/lib/supabase/types';

type TakeoffRegionInsert = Database['public']['Tables']['takeoff_regions']['Insert'];
type TakeoffRegionUpdate = Database['public']['Tables']['takeoff_regions']['Update'];

function stripTenantControlledFields(body: Record<string, unknown>): Record<string, unknown> {
  const {
    id,
    company_id,
    session_id,
    created_at,
    updated_at,
    ...safeBody
  } = body;

  return safeBody;
}

async function verifySessionAccess(sessionId: string, companyId: string) {
  const { data, error } = await supabaseAdmin
    .from('takeoff_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  return !error && Boolean(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = supabaseAdmin;
  const body = await request.json();
  const companyId = await requireServerCompanyId();
  const hasSessionAccess = await verifySessionAccess(sessionId, companyId);

  if (!hasSessionAccess) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('takeoff_regions')
    .insert({
      ...stripTenantControlledFields(body),
      company_id: companyId,
      session_id: sessionId,
    } as TakeoffRegionInsert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = supabaseAdmin;
  const body = await request.json();
  const regionId = request.nextUrl.searchParams.get('region_id');
  const companyId = await requireServerCompanyId();

  if (!regionId) {
    return NextResponse.json({ error: 'region_id required' }, { status: 400 });
  }

  const hasSessionAccess = await verifySessionAccess(sessionId, companyId);

  if (!hasSessionAccess) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('takeoff_regions')
    .update(stripTenantControlledFields(body) as TakeoffRegionUpdate)
    .eq('id', regionId)
    .eq('session_id', sessionId)
    .eq('company_id', companyId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
