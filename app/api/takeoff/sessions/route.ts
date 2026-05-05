import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import type { Database } from '@/lib/supabase/types';

function toPersistedStatus(status: unknown) {
  if (status === 'completed' || status === 'abandoned') return status;
  return 'in_progress';
}

const OPTIONAL_SESSION_COLUMNS = ['window_catalog', 'door_catalog', 'estimate_rows'] as const;
type TakeoffSessionInsert = Database['public']['Tables']['takeoff_sessions']['Insert'];

function stripUnsupportedSessionColumns<T extends Record<string, unknown>>(
  payload: T,
  errorMessage: string | undefined,
) {
  if (!errorMessage || !errorMessage.includes('schema cache')) {
    return payload;
  }

  const nextPayload = { ...payload };
  let removed = false;

  for (const column of OPTIONAL_SESSION_COLUMNS) {
    if (errorMessage.includes(`'${column}'`) && column in nextPayload) {
      delete nextPayload[column as keyof typeof nextPayload];
      removed = true;
    }
  }

  return removed ? (nextPayload as T) : payload;
}

export async function POST(request: NextRequest) {
  const supabase = supabaseAdmin;
  const body = await request.json();
  const companyId = await requireServerCompanyId();

  if (!body.project_id || !body.document_id) {
    return NextResponse.json({ error: 'project_id and document_id required' }, { status: 400 });
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id, project_id')
    .eq('id', body.document_id)
    .eq('project_id', body.project_id)
    .eq('company_id', companyId)
    .single();

  if (documentError || !document) {
    return NextResponse.json({ error: 'Project document not found' }, { status: 404 });
  }

  const basePayload: TakeoffSessionInsert = {
    company_id: companyId,
    project_id: body.project_id,
    document_id: body.document_id,
    status: toPersistedStatus(body.status),
    selected_pages: body.selected_pages ?? [],
    measurement_basis: body.measurement_basis ?? 'exterior_face',
    calibrations: body.calibrations ?? {},
    traces: body.traces ?? [],
    classifications: body.classifications ?? [],
    workspace_schema_version: body.workspace_schema_version ?? 2,
    page_analysis: body.page_analysis ?? [],
    views: body.views ?? [],
    zones: body.zones ?? [],
    wall_runs: body.wall_runs ?? [],
    surfaces: body.surfaces ?? [],
    opening_items: body.opening_items ?? [],
    completion_checklist: body.completion_checklist ?? [],
    ai_suggestions: body.ai_suggestions ?? [],
    viewer_state: body.viewer_state ?? [],
    workspace_summary: body.workspace_summary ?? {},
    estimate_rows: body.estimate_rows ?? [],
    ...(body.window_catalog !== undefined ? { window_catalog: body.window_catalog } : {}),
    ...(body.door_catalog !== undefined ? { door_catalog: body.door_catalog } : {}),
  };

  const insertSession = (payload: TakeoffSessionInsert) =>
    supabase.from('takeoff_sessions').insert(payload).select().single();

  let payload = basePayload;
  let { data, error } = await insertSession(payload);

  while (error) {
    const strippedPayload = stripUnsupportedSessionColumns(payload, error.message);
    if (strippedPayload === payload) break;
    payload = strippedPayload;
    ({ data, error } = await insertSession(payload));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET(request: NextRequest) {
  const supabase = supabaseAdmin;
  const documentId = request.nextUrl.searchParams.get('document_id');
  const companyId = await requireServerCompanyId();

  if (!documentId) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('takeoff_sessions')
    .select('*')
    .eq('document_id', documentId)
    .eq('company_id', companyId)
    .in('status', ['in_progress', 'calibrating', 'tracing', 'reviewing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) return NextResponse.json({ session: null });
  return NextResponse.json({ session: data });
}
