import assert from 'node:assert/strict';
import {
  buildProjectSlugBase,
  buildProjectSlugCandidate,
  getProjectRefColumn,
  getProjectRouteRef,
  isProjectUuid,
} from '../lib/projects/slug';

assert.equal(isProjectUuid('bd8fd7a1-9a29-45b3-b1b5-4e72e12ac329'), true);
assert.equal(isProjectUuid('test-project'), false);
assert.equal(getProjectRefColumn('bd8fd7a1-9a29-45b3-b1b5-4e72e12ac329'), 'id');
assert.equal(getProjectRefColumn('test-project'), 'slug');

assert.equal(buildProjectSlugBase('Test Project'), 'test-project');
assert.equal(buildProjectSlugBase('  123 Main St. / Phase #2  '), '123-main-st-phase-2');
assert.equal(buildProjectSlugBase('!!!'), 'project');
assert.equal(buildProjectSlugCandidate('test-project', 0), 'test-project');
assert.equal(buildProjectSlugCandidate('test-project', 1), 'test-project-2');

assert.equal(
  getProjectRouteRef({ id: 'bd8fd7a1-9a29-45b3-b1b5-4e72e12ac329', slug: 'test-project' }),
  'test-project',
);
assert.equal(
  getProjectRouteRef({ id: 'bd8fd7a1-9a29-45b3-b1b5-4e72e12ac329', slug: null }),
  'bd8fd7a1-9a29-45b3-b1b5-4e72e12ac329',
);

console.log('project-slug eval passed');
