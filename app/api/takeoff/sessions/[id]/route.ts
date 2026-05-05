import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import type { Database } from '@/lib/supabase/types';

function toPersistedStatus(status: unknown) {
  if (status === 'completed' || status === 'abandoned') return status;
  return 'in_progress';
}

const OPTIONAL_SESSION_COLUMNS = ['window_catalog', 'door_catalog', 'estimate_rows'] as const;
type TakeoffSessionUpdate = Database['public']['Tables']['takeoff_sessions']['Update'];

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

/** PATCH /api/takeoff/sessions/[id] — save session state (calibrations, traces, classifications) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const companyId = await requireServerCompanyId();
  const expectedUpdatedAt =
    typeof body.expected_updated_at === 'string'
      ? body.expected_updated_at
      : undefined;

  const updatePayload: TakeoffSessionUpdate = {
    updated_at: new Date().toISOString(),
  };

  // Only update fields that are present in the request
  if (body.status !== undefined) updatePayload.status = toPersistedStatus(body.status);
  if (body.measurement_basis !== undefined) updatePayload.measurement_basis = body.measurement_basis;
  if (body.calibrations !== undefined) updatePayload.calibrations = body.calibrations;
  if (body.traces !== undefined) updatePayload.traces = body.traces;
  if (body.classifications !== undefined) updatePayload.classifications = body.classifications;
  if (body.window_catalog !== undefined) updatePayload.window_catalog = body.window_catalog;
  if (body.door_catalog !== undefined) updatePayload.door_catalog = body.door_catalog;
  if (body.selected_pages !== undefined) updatePayload.selected_pages = body.selected_pages;
  if (body.workspace_schema_version !== undefined) updatePayload.workspace_schema_version = body.workspace_schema_version;
  if (body.page_analysis !== undefined) updatePayload.page_analysis = body.page_analysis;
  if (body.views !== undefined) updatePayload.views = body.views;
  if (body.zones !== undefined) updatePayload.zones = body.zones;
  if (body.wall_runs !== undefined) updatePayload.wall_runs = body.wall_runs;
  if (body.surfaces !== undefined) updatePayload.surfaces = body.surfaces;
  if (body.opening_items !== undefined) updatePayload.opening_items = body.opening_items;
  if (body.completion_checklist !== undefined) updatePayload.completion_checklist = body.completion_checklist;
  if (body.ai_suggestions !== undefined) updatePayload.ai_suggestions = body.ai_suggestions;
  if (body.viewer_state !== undefined) updatePayload.viewer_state = body.viewer_state;
  if (body.workspace_summary !== undefined) updatePayload.workspace_summary = body.workspace_summary;
  if (body.estimate_rows !== undefined) updatePayload.estimate_rows = body.estimate_rows;

  const updateSession = (
    payload: TakeoffSessionUpdate,
    expectedTimestamp?: string,
  ) => {
    let query = supabaseAdmin
      .from('takeoff_sessions')
      .update(payload)
      .eq('id', id)
      .eq('company_id', companyId);

    if (expectedTimestamp) {
      query = query.eq('updated_at', expectedTimestamp);
    }

    return query.select();
  };

  let payload = updatePayload;
  let { data, error } = await updateSession(payload, expectedUpdatedAt);

  while (error) {
    const strippedPayload = stripUnsupportedSessionColumns(payload, error.message);
    if (strippedPayload === payload) break;
    payload = strippedPayload;
    ({ data, error } = await updateSession(payload, expectedUpdatedAt));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data || data.length === 0) {
    const { data: currentRow, error: currentRowError } = await supabaseAdmin
      .from('takeoff_sessions')
      .select('updated_at')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (currentRowError) {
      return NextResponse.json({ error: currentRowError.message }, { status: 400 });
    }

    if (!currentRow) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        error: 'Session has a newer revision on the server',
        current_updated_at: currentRow.updated_at,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(data[0]);
}

/** GET /api/takeoff/sessions/[id] — load session */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const companyId = await requireServerCompanyId();

  const { data, error } = await supabaseAdmin
    .from('takeoff_sessions')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json(data);
}
