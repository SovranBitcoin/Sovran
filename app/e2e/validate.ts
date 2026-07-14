#!/usr/bin/env bun
/* eslint-disable no-console -- this file is the human-facing validation CLI */
/** Dedicated compact-format + schema + cross-file suite gate. The loader is the
 * single validation authority used by both this package script and cli.ts. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadE2E, type Loaded } from './core/loader';
import { formatDoc, parseJson } from './schema';

const JSON_DIRS = ['suites', 'scenarios', 'fixtures'] as const;

export function validateTree(e2eDir: string, fix = false): Loaded {
  if (fix) {
    for (const dir of JSON_DIRS) {
      const absolute = join(e2eDir, dir);
      if (!existsSync(absolute)) continue;
      for (const file of readdirSync(absolute).filter((name) => name.endsWith('.json'))) {
        const path = join(absolute, file);
        const parsed = parseJson(readFileSync(path, 'utf8'));
        if (parsed.ok) writeFileSync(path, formatDoc(parsed.value));
      }
    }
  }
  return loadE2E(e2eDir);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--fix');
  if (unknown.length) {
    console.error(`✗ unknown argument(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  const e2eDir = dirname(new URL(import.meta.url).pathname);
  const loaded = validateTree(e2eDir, args.includes('--fix'));
  for (const { file, issue } of loaded.issues)
    console.log(`  ✗ ${file} — ${issue.path}: ${issue.message}`);
  console.log(
    loaded.issues.length
      ? `\n[validate] ✗ ${loaded.issues.length} issue(s)`
      : '\n[validate] ✓ all e2e JSON valid + compact + suite-complete'
  );
  process.exit(loaded.issues.length ? 1 : 0);
}
