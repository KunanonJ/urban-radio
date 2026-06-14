#!/usr/bin/env node
/**
 * Wave RM-γ post-build fix.
 *
 * Next 15 strict-types each `app/.../route.ts` and rejects any named export
 * that isn't an HTTP verb (`GET`/`POST`/…) or a reserved config key
 * (`config`, `runtime`, `dynamic`, …). Wave β's routes all export inner
 * helpers (e.g. `getCatalogIndex`, `postLogin`) alongside their verb wrappers
 * so tests can call them with dependency injection.
 *
 * This script splits each `route.ts` into:
 *   route.ts        — only verb exports (delegates into the impl module)
 *   route-impl.ts   — every non-verb top-level export (the inner helpers,
 *                     interfaces, types, helper functions)
 *
 * Test files that previously imported helpers from `@/app/api/.../route` get
 * rewritten to import from `.../route-impl`.
 *
 * Idempotent: skips any route.ts that already has a sibling route-impl.ts.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const API_DIR = join(ROOT, 'src/app/api');
const TESTS_DIR = join(ROOT, 'src/server/__tests__');

const HTTP_VERBS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
const KNOWN_CONFIG_KEYS = new Set([
  'config',
  'runtime',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'preferredRegion',
  'maxDuration',
  'generateStaticParams',
]);

function walk(dir, predicate, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

function classifySource(src) {
  const lines = src.split('\n');
  const exports = new Map();

  const fnRe =
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const constRe = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
  const typeRe = /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/;
  const reexportRe = /^export\s*\{([^}]+)\}/;

  for (const line of lines) {
    let m;
    if ((m = line.match(fnRe))) exports.set(m[1], 'function');
    else if ((m = line.match(constRe))) exports.set(m[1], 'const');
    else if ((m = line.match(typeRe))) exports.set(m[1], 'type');
    else if ((m = line.match(reexportRe))) {
      const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
      for (const n of names) if (n) exports.set(n, 'reexport');
    }
  }
  return exports;
}

function splitFile(routePath) {
  const dir = dirname(routePath);
  const implPath = join(dir, 'route-impl.ts');
  if (existsSync(implPath)) return { skipped: true, path: routePath };

  const src = readFileSync(routePath, 'utf8');
  const exports = classifySource(src);

  const verbNames = [];
  const nonVerbExportNames = [];
  for (const [name] of exports) {
    if (HTTP_VERBS.has(name)) verbNames.push(name);
    else if (!KNOWN_CONFIG_KEYS.has(name)) nonVerbExportNames.push(name);
  }

  if (nonVerbExportNames.length === 0) return { skipped: true, path: routePath };
  if (verbNames.length === 0) {
    return { skipped: true, reason: 'no verbs', path: routePath };
  }

  writeFileSync(implPath, src, 'utf8');

  const shim = [
    '/**',
    ' * Next.js Route Handler shim. Only HTTP-verb exports are allowed in',
    ' * `route.ts` (Next 15 strict route type-check), so the actual handler',
    ' * implementations + their inner helpers live in `./route-impl.ts` where',
    ' * tests can also import them.',
    ' */',
    '',
    `export { ${verbNames.sort().join(', ')} } from './route-impl';`,
    '',
  ].join('\n');
  writeFileSync(routePath, shim, 'utf8');

  return {
    skipped: false,
    path: routePath,
    verbs: verbNames,
    helpers: nonVerbExportNames,
  };
}

function rewriteTestImports() {
  const testFiles = walk(TESTS_DIR, (p) => p.endsWith('.test.ts'));
  const changes = [];
  for (const tf of testFiles) {
    const src = readFileSync(tf, 'utf8');
    const importRe = /from\s+(['"])(@\/app\/api\/[^'"]+\/route)\1/g;
    const updated = src.replace(importRe, (_m, q, mod) => `from ${q}${mod}-impl${q}`);
    if (updated !== src) {
      writeFileSync(tf, updated, 'utf8');
      changes.push(relative(ROOT, tf));
    }
  }
  return changes;
}

function main() {
  const files = walk(API_DIR, (p) => p.endsWith('/route.ts'));
  const results = files.map(splitFile);
  const split = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log(`Split: ${split.length}, skipped: ${skipped.length}`);
  for (const r of split) {
    console.log(`  ${relative(ROOT, r.path)} → verbs=[${r.verbs.join(',')}]`);
  }
  if (skipped.length) {
    for (const r of skipped) {
      console.log(`  SKIP ${relative(ROOT, r.path)}${r.reason ? ` (${r.reason})` : ''}`);
    }
  }
  const tests = rewriteTestImports();
  console.log(`Tests updated: ${tests.length}`);
  for (const t of tests) console.log(`  ${t}`);
}

main();
