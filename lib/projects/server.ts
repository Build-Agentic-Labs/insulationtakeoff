import { supabaseAdmin } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import { buildProjectSlugBase, buildProjectSlugCandidate, getProjectRefColumn } from './slug';

type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
type ProjectRow = Database['public']['Tables']['projects']['Row'];

function isSlugConflict(error: { code?: string; message?: string } | null) {
  return error?.code === '23505' && (error.message ?? '').toLowerCase().includes('slug');
}

export async function insertProjectWithSlug(insertData: ProjectInsert) {
  const baseSlug = buildProjectSlugBase(insertData.name);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const slug = buildProjectSlugCandidate(baseSlug, attempt);
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ ...insertData, slug })
      .select()
      .single();

    if (!error || !isSlugConflict(error)) {
      return { data, error };
    }
  }

  return supabaseAdmin
    .from('projects')
    .insert({
      ...insertData,
      slug: buildProjectSlugCandidate(baseSlug, Date.now()),
    })
    .select()
    .single();
}

export async function resolveProjectByRef(
  companyId: string,
  projectRef: string,
  select = '*',
): Promise<{ data: ProjectRow | null; error: unknown }> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select(select)
    .eq('company_id', companyId)
    .eq(getProjectRefColumn(projectRef), projectRef)
    .maybeSingle();

  return { data: data as ProjectRow | null, error };
}
