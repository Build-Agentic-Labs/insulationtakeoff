/**
 * Static guardrail: production API routes that access service-role Supabase
 * clients or paid AI vision endpoints must explicitly require a company context.
 *
 * Run: node tests/api-company-guards.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiRoot = path.join(root, 'app', 'api');

const intentionallyPublic = new Set([]);

function walkRoutes(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const routes = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...walkRoutes(fullPath));
      continue;
    }

    if (entry.name === 'route.ts') {
      routes.push(fullPath);
    }
  }

  return routes;
}

function relative(filePath) {
  return path.relative(root, filePath);
}

const protectedRouteMarkers = [
  'requireServerCompanyId',
  'requireServerCompanyMembership',
  'requireServerCompanyAdmin',
  'createServerSupabaseClient',
];

const sensitiveMarkers = [
  'supabaseAdmin',
  'Anthropic',
  'analyzeMultipleImages',
  'anthropic.messages.create',
];

const failures = [];
const routes = walkRoutes(apiRoot);

for (const routePath of routes) {
  const relPath = relative(routePath);
  if (intentionallyPublic.has(relPath)) continue;

  const source = fs.readFileSync(routePath, 'utf8');
  const isSensitive = sensitiveMarkers.some((marker) => source.includes(marker));
  const hasCompanyGuard = protectedRouteMarkers.some((marker) => source.includes(marker));

  if (isSensitive && !hasCompanyGuard) {
    failures.push(`${relPath} uses a sensitive backend capability without an explicit company/auth guard.`);
  }
}

if (failures.length > 0) {
  console.error('\nAPI company guard check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`API company guard check passed for ${routes.length} route files.`);
