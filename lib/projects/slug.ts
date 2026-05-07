const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROJECT_SLUG_LENGTH = 80;

export interface ProjectRouteRef {
  id: string;
  slug?: string | null;
}

export function isProjectUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function getProjectRefColumn(value: string) {
  return isProjectUuid(value) ? 'id' : 'slug';
}

export function getProjectRouteRef(project: ProjectRouteRef) {
  return project.slug || project.id;
}

export function buildProjectSlugBase(name: string, fallback = 'project') {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_PROJECT_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return normalized || fallback;
}

export function buildProjectSlugCandidate(base: string, attempt: number) {
  if (attempt <= 0) return base;

  const suffix = `-${attempt + 1}`;
  return `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
}
