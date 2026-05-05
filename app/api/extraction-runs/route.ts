import { NextRequest, NextResponse } from 'next/server';
import { getRecentRuns } from '@/lib/supabase/extractionRuns';
import { requireServerCompanyId } from '@/lib/supabase/company-server';

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10', 10);
  const companyId = await requireServerCompanyId();

  const runs = await getRecentRuns(companyId, projectId, Math.min(limit, 50));

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      attempt: r.attempt,
      started_at: r.started_at,
      finished_at: r.finished_at,
      error: r.error,
      has_envelope: r.takeoff_envelope !== null,
      has_metrics: r.metrics_json !== null,
      metrics_json: r.metrics_json,
      created_at: r.created_at,
    })),
  });
}
