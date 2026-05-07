export type QuoteSource = 'takeoff' | 'review';
export type TakeoffRouteStep = 'analysis' | 'zones' | 'workspace' | 'summary';

const TAKEOFF_ROUTE_STEPS: TakeoffRouteStep[] = ['analysis', 'zones', 'workspace', 'summary'];

export function parseTakeoffRouteStep(value: string | null | undefined): TakeoffRouteStep | null {
  return TAKEOFF_ROUTE_STEPS.includes(value as TakeoffRouteStep)
    ? (value as TakeoffRouteStep)
    : null;
}

export function getProjectReviewHref(projectId: string) {
  return `/projects/${projectId}/review`;
}

export function getProjectWorkspaceHref(projectId: string) {
  return `/projects/${projectId}`;
}

export function getTakeoffSummaryHref(projectId: string) {
  return `/projects/${projectId}/takeoff?step=summary`;
}

export function resolveLegacyTakeoffRedirectPath(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)\/(?:review|extract)\/?$/);
  return match ? getTakeoffSummaryHref(match[1]) : null;
}

export function getQuoteHref(projectId: string, source: QuoteSource) {
  return `/projects/${projectId}/quote?source=${source}`;
}

export function resolveQuoteReviewHref(
  projectId: string,
  options: {
    source?: string | null;
    hasTakeoffSession: boolean;
  },
) {
  if (options.source === 'takeoff') return getTakeoffSummaryHref(projectId);

  return options.hasTakeoffSession
    ? getTakeoffSummaryHref(projectId)
    : getProjectWorkspaceHref(projectId);
}
