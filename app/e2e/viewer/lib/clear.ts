import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS, DIFF_CACHE } from './paths';
import { evictRun, getRunDetail, listRunDirNames } from './scan';
import type { ClearResult } from './types';

function dirSize(path: string): number {
  let total = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(path);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry);
    try {
      const stat = statSync(child, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) total += dirSize(child);
      else total += stat.size;
    } catch {
      // ignore
    }
  }
  return total;
}

/** Delete run-* dirs only. Runs with unreconciled (or unreadable) funded
 * ledgers and in-progress runs are skipped — funds records outlive the UI.
 * Diff caches referencing any deleted run are purged with it. */
export async function clearRuns(): Promise<ClearResult> {
  const deleted: string[] = [];
  const skipped: ClearResult['skipped'] = [];
  let freedBytes = 0;

  for (const runDirName of listRunDirNames()) {
    const detail = await getRunDetail(runDirName);
    if (detail?.status === 'in-progress') {
      skipped.push({ runId: runDirName, reason: 'run in progress' });
      continue;
    }
    if (!detail || !detail.fundsSafeToDelete) {
      skipped.push({ runId: runDirName, reason: 'funded ledger not reconciled' });
      continue;
    }
    const runDir = join(ARTIFACTS, runDirName);
    freedBytes += dirSize(runDir);
    rmSync(runDir, { recursive: true, force: true });
    evictRun(runDirName);
    deleted.push(runDirName);
  }

  try {
    for (const entry of readdirSync(DIFF_CACHE)) {
      const [runA, runB] = entry.split('__');
      if (deleted.includes(runA) || deleted.includes(runB)) {
        const cacheDir = join(DIFF_CACHE, entry);
        freedBytes += dirSize(cacheDir);
        rmSync(cacheDir, { recursive: true, force: true });
      }
    }
  } catch {
    // no diff cache yet
  }

  return { deleted, skipped, freedBytes };
}
