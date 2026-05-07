import assert from 'node:assert/strict';
import {
  getProjectReviewHref,
  getProjectWorkspaceHref,
  getQuoteHref,
  getTakeoffSummaryHref,
  parseTakeoffRouteStep,
  resolveLegacyTakeoffRedirectPath,
  resolveQuoteReviewHref,
} from '../lib/takeoff/navigation';

const projectId = 'project-123';

assert.equal(getQuoteHref(projectId, 'takeoff'), '/projects/project-123/quote?source=takeoff');
assert.equal(getQuoteHref(projectId, 'review'), '/projects/project-123/quote?source=review');
assert.equal(getTakeoffSummaryHref(projectId), '/projects/project-123/takeoff?step=summary');
assert.equal(getProjectReviewHref(projectId), '/projects/project-123/review');
assert.equal(getProjectWorkspaceHref(projectId), '/projects/project-123');

assert.equal(
  resolveQuoteReviewHref(projectId, { source: 'takeoff', hasTakeoffSession: true }),
  '/projects/project-123/takeoff?step=summary',
);
assert.equal(
  resolveQuoteReviewHref(projectId, { source: 'takeoff', hasTakeoffSession: false }),
  '/projects/project-123/takeoff?step=summary',
);
assert.equal(
  resolveQuoteReviewHref(projectId, { source: 'review', hasTakeoffSession: true }),
  '/projects/project-123/takeoff?step=summary',
);
assert.equal(
  resolveQuoteReviewHref(projectId, { source: 'review', hasTakeoffSession: false }),
  '/projects/project-123',
);
assert.equal(
  resolveQuoteReviewHref(projectId, { source: null, hasTakeoffSession: true }),
  '/projects/project-123/takeoff?step=summary',
);
assert.equal(
  resolveQuoteReviewHref(projectId, { source: null, hasTakeoffSession: false }),
  '/projects/project-123',
);

assert.equal(parseTakeoffRouteStep('summary'), 'summary');
assert.equal(parseTakeoffRouteStep('workspace'), 'workspace');
assert.equal(parseTakeoffRouteStep('bad-step'), null);
assert.equal(parseTakeoffRouteStep(null), null);

assert.equal(
  resolveLegacyTakeoffRedirectPath('/projects/project-123/review'),
  '/projects/project-123/takeoff?step=summary',
);
assert.equal(
  resolveLegacyTakeoffRedirectPath('/projects/project-123/extract'),
  '/projects/project-123/takeoff?step=summary',
);
assert.equal(resolveLegacyTakeoffRedirectPath('/projects/project-123/takeoff'), null);

console.log('takeoff-navigation eval passed');
