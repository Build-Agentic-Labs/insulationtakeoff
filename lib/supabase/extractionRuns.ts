import { supabaseAdmin } from './server';
import type { Database } from './types';

type RunRow = Database['public']['Tables']['extraction_runs']['Row'];
type RunInsert = Database['public']['Tables']['extraction_runs']['Insert'];

export interface StartRunResult {
  run: RunRow;
  isExisting: boolean;
}

/**
 * Try to create a new extraction run. If a run with the same
 * (project_id, idempotency_key) already exists, return it instead.
 *
 * Returns { run, isExisting } so the caller knows whether to proceed
 * with extraction or return the cached result.
 */
export async function startOrReturnRun(params: {
  projectId: string;
  documentId: string;
  mode: 'ocr' | 'vision';
  idempotencyKey: string;
  requestJson?: Record<string, unknown>;
}): Promise<StartRunResult> {
  const { projectId, documentId, mode, idempotencyKey, requestJson } = params;

  // Check for existing run with this idempotency key
  const { data: existing } = await supabaseAdmin
    .from('extraction_runs')
    .select('*')
    .eq('project_id', projectId)
    .eq('idempotency_key', idempotencyKey)
    .single();

  if (existing) {
    return { run: existing, isExisting: true };
  }

  // Create new run
  const { data: newRun, error } = await supabaseAdmin
    .from('extraction_runs')
    .insert({
      project_id: projectId,
      document_id: documentId,
      mode,
      idempotency_key: idempotencyKey,
      status: 'started',
      request_json: requestJson as any,
    })
    .select()
    .single();

  if (error) {
    // Race condition: another request created it between our check and insert
    if (error.code === '23505') { // unique_violation
      const { data: raced } = await supabaseAdmin
        .from('extraction_runs')
        .select('*')
        .eq('project_id', projectId)
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (raced) {
        return { run: raced, isExisting: true };
      }
    }
    throw error;
  }

  return { run: newRun, isExisting: false };
}

/**
 * Mark a run as finished (complete, review, or failed).
 */
export async function finishRun(params: {
  runId: string;
  status: 'complete' | 'review' | 'failed';
  envelope?: unknown;
  error?: string;
  metricsJson?: Record<string, unknown>;
}): Promise<void> {
  const { runId, status, envelope, error, metricsJson } = params;

  await supabaseAdmin
    .from('extraction_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      takeoff_envelope: envelope as any ?? undefined,
      error: error ?? undefined,
      metrics_json: metricsJson as any ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

/**
 * Get recent extraction runs for a project.
 */
export async function getRecentRuns(projectId: string, limit = 10): Promise<RunRow[]> {
  const { data } = await supabaseAdmin
    .from('extraction_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
}
