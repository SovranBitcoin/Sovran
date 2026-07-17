import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS, isValidRunDirName } from './paths';
import { parseEvents, runLabel, timelinesFromDirScan } from './timeline';
import type { RunDetail, RunSummary } from './types';

/** A run with no run.end whose events file went quiet for this long is
 * considered aborted rather than in-progress. */
const IN_PROGRESS_WINDOW_MS = 120_000;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  detail: RunDetail;
  /** run.end seen — the run dir is immutable, skip all future stat checks. */
  pinned: boolean;
}

const cache = new Map<string, CacheEntry>();

/** RunIds the viewer's own job manager currently owns; keeps status honest
 * for slow runs that pause longer than the mtime window. */
export const liveRunIds = new Set<string>();

function eventsStat(runDir: string): { mtimeMs: number; size: number } {
  try {
    const stat = statSync(join(runDir, 'events.jsonl'));
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
}

async function readManifest(runDir: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await Bun.file(join(runDir, 'manifest.json')).text());
  } catch {
    return undefined;
  }
}

/** Simulator device type from the first session-N.json (sim runs only). */
async function readDeviceType(runDir: string): Promise<string | undefined> {
  let sessionFile: string | undefined;
  try {
    sessionFile = readdirSync(runDir)
      .filter((name) => /^session-\d+\.json$/.test(name))
      .sort()[0];
  } catch {
    return undefined;
  }
  if (!sessionFile) return undefined;
  try {
    const session = JSON.parse(await Bun.file(join(runDir, sessionFile)).text());
    const deviceType = session?.simulator?.deviceType;
    return typeof deviceType === 'string' ? deviceType : undefined;
  } catch {
    return undefined;
  }
}

/** Every funded leg that was opened (intent/funded) must close with a
 * reconciled entry. Unparseable ledgers fail closed. */
export function ledgerSafeToDelete(ledgerText: string): boolean {
  const opened = new Set<string>();
  const reconciled = new Set<string>();
  for (const line of ledgerText.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    const key = `${entry.runId}:${entry.legId}`;
    if (entry.kind === 'intent' || entry.kind === 'funded') opened.add(key);
    if (entry.kind === 'reconciled') reconciled.add(key);
  }
  return [...opened].every((key) => reconciled.has(key));
}

async function fundsSafeToDelete(runDir: string): Promise<boolean> {
  let sessions: string[] = [];
  try {
    sessions = readdirSync(runDir).filter((name) => /^session-\d+$/.test(name));
  } catch {
    return false;
  }
  for (const session of sessions) {
    const ledgerPath = join(runDir, session, 'funded-liability', 'ledger.jsonl');
    const ledger = Bun.file(ledgerPath);
    if (!(await ledger.exists())) continue;
    try {
      if (!ledgerSafeToDelete(await ledger.text())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function getRunDetail(runDirName: string): Promise<RunDetail | undefined> {
  if (!isValidRunDirName(runDirName)) return undefined;
  const runDir = join(ARTIFACTS, runDirName);
  const cached = cache.get(runDirName);
  if (cached?.pinned) return cached.detail;
  const stat = eventsStat(runDir);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return refreshVolatileStatus(cached.detail);
  }

  const manifest = await readManifest(runDir);
  if (!manifest) return undefined;

  let eventsText = '';
  try {
    eventsText = await Bun.file(join(runDir, 'events.jsonl')).text();
  } catch {
    // fall through to dir scan
  }
  const scenarioIds = Array.isArray(manifest.scenarios) ? manifest.scenarios.map(String) : [];
  const parsed = parseEvents(eventsText, runDirName);
  const scenarios =
    parsed.scenarios.length > 0 ? parsed.scenarios : timelinesFromDirScan(runDir, scenarioIds);

  const git = manifest.git as RunDetail['git'];
  const detail: RunDetail = {
    runId: runDirName.replace(/^run-/, ''),
    suite: String(manifest.suite ?? ''),
    driver: manifest.driver === 'sim' ? 'sim' : 'fake',
    proof: manifest.proof === 'product-run' ? 'product-run' : 'orchestration-smoke',
    startedAt: String(manifest.startedAt ?? ''),
    scenarioIds,
    git,
    commitRun: Boolean(git && !git.dirty),
    label: runLabel({ git, startedAt: String(manifest.startedAt ?? '') }),
    status: 'complete',
    result: parsed.runEnd,
    fundsSafeToDelete: await fundsSafeToDelete(runDir),
    scenarios,
  };
  const deviceType = await readDeviceType(runDir);
  if (deviceType) detail.deviceType = deviceType;
  if (!parsed.runEnd) {
    detail.status =
      liveRunIds.has(runDirName) || Date.now() - stat.mtimeMs < IN_PROGRESS_WINDOW_MS
        ? 'in-progress'
        : 'aborted';
  }

  cache.set(runDirName, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    detail,
    pinned: Boolean(parsed.runEnd),
  });
  return detail;
}

/** In-progress vs aborted can flip on wall-clock alone; recompute cheaply
 * without reparsing. */
function refreshVolatileStatus(detail: RunDetail): RunDetail {
  if (detail.result) return detail;
  const runDirName = `run-${detail.runId}`;
  const stat = eventsStat(join(ARTIFACTS, runDirName));
  detail.status =
    liveRunIds.has(runDirName) || Date.now() - stat.mtimeMs < IN_PROGRESS_WINDOW_MS
      ? 'in-progress'
      : 'aborted';
  return detail;
}

export function toSummary(detail: RunDetail): RunSummary {
  const { scenarios: _scenarios, ...summary } = detail;
  return summary;
}

export function listRunDirNames(): string[] {
  try {
    return readdirSync(ARTIFACTS)
      .filter((name) => name.startsWith('run-') && isValidRunDirName(name))
      .sort()
      .reverse(); // runIds start with an ISO timestamp — lexical == chronological
  } catch {
    return [];
  }
}

export async function listRuns(): Promise<RunDetail[]> {
  const details: RunDetail[] = [];
  for (const name of listRunDirNames()) {
    const detail = await getRunDetail(name);
    if (detail) details.push(detail);
  }
  return details;
}

export function evictRun(runDirName: string): void {
  cache.delete(runDirName);
}
