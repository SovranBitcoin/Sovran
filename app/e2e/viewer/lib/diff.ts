import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { ARTIFACTS, DIFF_CACHE } from './paths';
import { getRunDetail } from './scan';
import type {
  DiffPairResult,
  DiffResult,
  DiffScenarioSummary,
  Frame,
  NamedFrame,
  RunDetail,
} from './types';

const PIXELMATCH_OPTIONS = { threshold: 0.1, includeAA: false } as const;
/** Phases whose diffs rank scenarios by default (setup/cleanup noise excluded). */
const RELEVANT: ReadonlySet<string> = new Set(['T', 'V', 'FINAL', 'named']);
/** Bump when the result.json shape changes; stale caches recompute on load.
 * v2: pairs carry order/kind/label for the player-style diff reel. */
export const DIFF_RESULT_VERSION = 2;

export function diffKey(runA: string, runB: string): string {
  return `${runA}__${runB}`;
}

export function diffCacheDir(key: string): string {
  return join(DIFF_CACHE, key);
}

/** The cached result for a key, or undefined when absent, corrupt, or written
 * by an older format version. Every cache read must go through this — a stale
 * result returned raw would silently miss the newer fields. */
export async function loadCachedDiff(key: string): Promise<DiffResult | undefined> {
  const file = Bun.file(join(diffCacheDir(key), 'result.json'));
  if (!(await file.exists())) return undefined;
  try {
    const cached = JSON.parse(await file.text());
    return cached.version === DIFF_RESULT_VERSION ? cached : undefined;
  } catch {
    return undefined;
  }
}

interface PairSource {
  key: string;
  scenarioId: string;
  phase: DiffPairResult['phase'];
  stepId?: string;
  name?: string;
  order?: number;
  kind?: string;
  label?: string;
  a?: string; // file relative to run A dir
  b?: string;
}

/** Pair keys deliberately exclude the volatile NNN capture counter so runs
 * with drifted step counts still match on stepId/name. Run A is added first,
 * so order/kind/label reflect run A's frame when the pair exists on both sides.
 * Exported for tests. */
export function collectSources(a: RunDetail, b: RunDetail): PairSource[] {
  const sources = new Map<string, PairSource>();
  const add = (side: 'a' | 'b', scenarioId: string, frames: Frame[], named: NamedFrame[]): void => {
    for (const frame of frames) {
      const key = `${scenarioId}/${frame.stepId}/${frame.kind}`;
      const source = sources.get(key) ?? {
        key,
        scenarioId,
        phase: frame.phase,
        stepId: frame.stepId,
        order: frame.artifactSeq,
        kind: frame.kind,
        label: frame.label,
      };
      source[side] = frame.file;
      sources.set(key, source);
    }
    for (const capture of named) {
      const key = `${scenarioId}/named/${capture.name}#${capture.occurrence}`;
      const source = sources.get(key) ?? {
        key,
        scenarioId,
        phase: 'named' as const,
        name: capture.name,
        order: capture.artifactSeq,
      };
      source[side] = capture.file;
      sources.set(key, source);
    }
  };
  for (const scenario of a.scenarios)
    add('a', scenario.scenarioId, scenario.frames, scenario.named);
  for (const scenario of b.scenarios)
    add('b', scenario.scenarioId, scenario.frames, scenario.named);
  return [...sources.values()].sort((x, y) => x.key.localeCompare(y.key));
}

async function readPng(runDirName: string, relPath: string): Promise<PNG | undefined> {
  try {
    const bytes = await Bun.file(join(ARTIFACTS, runDirName, relPath)).bytes();
    return PNG.sync.read(Buffer.from(bytes));
  } catch {
    return undefined;
  }
}

export interface DiffProgress {
  done: number;
  total: number;
}

/** Compute (or load) the pixel diff between two completed runs. Pairs are
 * compared strictly sequentially — two 3.2MP RGBA buffers per pair is enough
 * memory pressure without parallelism. */
export async function computeDiff(
  runA: string,
  runB: string,
  onProgress?: (progress: DiffProgress) => void
): Promise<DiffResult | { error: string }> {
  const key = diffKey(runA, runB);
  const cacheDir = diffCacheDir(key);
  // stale/corrupt caches fall through and recompute (heatmap files are
  // key-addressed and simply get rewritten)
  const cached = await loadCachedDiff(key);
  if (cached) return cached;

  const [a, b] = await Promise.all([getRunDetail(runA), getRunDetail(runB)]);
  if (!a || !b) return { error: 'unknown run' };
  for (const run of [a, b]) {
    if (run.status === 'in-progress') return { error: `run ${run.runId} is still in progress` };
    if (!run.scenarios.some((scenario) => scenario.frames.length > 0))
      return { error: `run ${run.runId} has no screenshots (smoke run?)` };
  }

  mkdirSync(join(cacheDir, 'pairs'), { recursive: true, mode: 0o700 });
  const sources = collectSources(a, b);
  const pairs: DiffPairResult[] = [];
  let done = 0;
  for (const source of sources) {
    const base: DiffPairResult = {
      key: source.key,
      scenarioId: source.scenarioId,
      phase: source.phase,
      stepId: source.stepId,
      name: source.name,
      order: source.order,
      kind: source.kind,
      label: source.label,
      status: 'error',
      aFile: source.a,
      bFile: source.b,
    };
    if (!source.a || !source.b) {
      pairs.push({ ...base, status: source.a ? 'removed' : 'added' });
    } else {
      const [pngA, pngB] = [await readPng(runA, source.a), await readPng(runB, source.b)];
      if (!pngA || !pngB) {
        pairs.push(base);
      } else if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
        pairs.push({ ...base, status: 'dimension-mismatch', diffPct: 1 });
      } else {
        const out = new PNG({ width: pngA.width, height: pngA.height });
        const changed = pixelmatch(
          pngA.data,
          pngB.data,
          out.data,
          pngA.width,
          pngA.height,
          PIXELMATCH_OPTIONS
        );
        const diffPct = changed / (pngA.width * pngA.height);
        if (changed === 0) {
          pairs.push({ ...base, status: 'identical', diffPct: 0 });
        } else {
          const diffFile = `pairs/${createHash('sha1').update(source.key).digest('hex')}.png`;
          await Bun.write(join(cacheDir, diffFile), PNG.sync.write(out), { mode: 0o600 });
          pairs.push({ ...base, status: 'diff', diffPct, diffFile });
        }
      }
    }
    done++;
    onProgress?.({ done, total: sources.length });
  }

  const byScenario = new Map<string, DiffScenarioSummary>();
  const names = new Map(
    [...a.scenarios, ...b.scenarios].map((scenario) => [scenario.scenarioId, scenario.name])
  );
  for (const pair of pairs) {
    const summary = byScenario.get(pair.scenarioId) ?? {
      scenarioId: pair.scenarioId,
      name: names.get(pair.scenarioId) ?? pair.scenarioId,
      maxDiffPct: 0,
      maxDiffPctRelevant: 0,
      changed: 0,
      identical: 0,
      added: 0,
      removed: 0,
    };
    if (pair.status === 'identical') summary.identical++;
    if (pair.status === 'added') summary.added++;
    if (pair.status === 'removed') summary.removed++;
    if (pair.status === 'diff' || pair.status === 'dimension-mismatch') {
      summary.changed++;
      const pct = pair.diffPct ?? 1;
      summary.maxDiffPct = Math.max(summary.maxDiffPct, pct);
      if (RELEVANT.has(pair.phase)) {
        summary.maxDiffPctRelevant = Math.max(summary.maxDiffPctRelevant, pct);
      }
    }
    byScenario.set(pair.scenarioId, summary);
  }

  const result: DiffResult = {
    version: DIFF_RESULT_VERSION,
    runA,
    runB,
    computedAt: new Date().toISOString(),
    pairs,
    scenarios: [...byScenario.values()].sort(
      (x, y) => y.maxDiffPctRelevant - x.maxDiffPctRelevant || y.maxDiffPct - x.maxDiffPct
    ),
  };
  await Bun.write(join(cacheDir, 'result.json'), JSON.stringify(result), { mode: 0o600 });
  return result;
}
