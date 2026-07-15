/** Shared API contract between the viewer server and the browser bundle.
 * The frontend must import from here with `import type` only so Bun's
 * bundler never pulls server code into the browser. */

import type { ScenarioFacets } from '../../schema/facets';

export interface GitInfo {
  sha: string;
  shortSha: string;
  branch: string;
  dirty: boolean;
}

export type RunStatus = 'complete' | 'in-progress' | 'aborted';

export interface RunSummary {
  runId: string;
  suite: string;
  driver: 'fake' | 'sim';
  proof: 'product-run' | 'orchestration-smoke';
  startedAt: string;
  scenarioIds: string[];
  git?: GitInfo;
  /** git present && !git.dirty — screenshots attributable to a single SHA. */
  commitRun: boolean;
  /** "#a1b2c3d" for commit runs, formatted local time otherwise. */
  label: string;
  status: RunStatus;
  result?: {
    passed: number;
    failed: number;
    skipped: number;
    deferred: number;
    durationMs: number;
    funds: string;
  };
  fundsSafeToDelete: boolean;
}

export type PhaseTag = 'P' | 'T' | 'V' | 'C' | 'FINAL';

export interface Frame {
  artifactSeq: number;
  stepId: string;
  phase: PhaseTag;
  kind: string;
  label?: string;
  ok?: boolean;
  error?: string;
  t?: number;
  /** Relative to the run dir, e.g. "toast.receive-lightning/001-P01-launch.png". */
  file: string;
  axFile?: string;
}

export interface NamedFrame {
  /** Canonical page name (schema/pages.ts); legacy runs carry free-form names. */
  name: string;
  occurrence: number;
  file: string;
  axFile?: string;
  stepId?: string;
  /** Global artifact sequence — lets the player interleave named captures into the reel. */
  artifactSeq?: number;
  phase?: PhaseTag;
}

export interface ScenarioTimeline {
  scenarioId: string;
  name: string;
  lane: string;
  description?: string;
  ok?: boolean;
  durationMs?: number;
  deferred?: boolean;
  frames: Frame[];
  named: NamedFrame[];
  /** Test+verify screen recording, relative to the run dir (e.g. "mint.add.url/video.mp4"). */
  videoFile?: string;
  finalState?: { expected: string; actual: string; ok: boolean };
}

export interface RunDetail extends RunSummary {
  scenarios: ScenarioTimeline[];
}

export interface CatalogRunRef {
  runId: string;
  label: string;
  commitRun: boolean;
  startedAt: string;
  status: RunStatus;
  proof: RunSummary['proof'];
  ok?: boolean;
}

export interface ScenarioCatalogEntry {
  id: string;
  name: string;
  description: string;
  lane: string;
  tags: string[];
  /** Structured view of the namespaced facet tags (flow/instrument/io/…). */
  facets: ScenarioFacets;
  deferredReason?: string;
  suites: string[];
  /** Runs containing this scenario, newest first. */
  runs: CatalogRunRef[];
}

export type DiffPairStatus =
  | 'diff'
  | 'identical'
  | 'added'
  | 'removed'
  | 'dimension-mismatch'
  | 'error';

export interface DiffPairResult {
  key: string;
  scenarioId: string;
  phase: PhaseTag | 'named';
  stepId?: string;
  name?: string;
  status: DiffPairStatus;
  diffPct?: number;
  aFile?: string;
  bFile?: string;
  /** Relative to this diff's cache dir. */
  diffFile?: string;
}

export interface DiffScenarioSummary {
  scenarioId: string;
  name: string;
  maxDiffPct: number;
  /** Max over T/V/FINAL/named pairs only. */
  maxDiffPctRelevant: number;
  changed: number;
  identical: number;
  added: number;
  removed: number;
}

export interface DiffResult {
  runA: string;
  runB: string;
  computedAt: string;
  pairs: DiffPairResult[];
  /** Sorted desc by maxDiffPctRelevant. */
  scenarios: DiffScenarioSummary[];
}

export interface PageCapture {
  page: string;
  occurrence: number;
  /** Relative to the run dir (serve via /api/runs/run-<runId>/file/*). */
  file: string;
  runId: string;
  runLabel: string;
  startedAt: string;
  scenarioId: string;
  scenarioName: string;
  stepId?: string;
}

export interface PageGroup {
  page: string;
  captures: PageCapture[];
}

export interface PagesIndex {
  allRuns: boolean;
  pages: PageGroup[];
}

export type TriggerRequest = (
  | { kind: 'scenario'; scenarioId: string }
  | { kind: 'suite'; suite: 'default' | 'full' }
  | { kind: 'commit-run'; suite?: 'default' | 'full' }
) & { acceptFundLoss?: boolean };

export interface JobStatus {
  id: string;
  kind: 'run' | 'diff';
  status: 'running' | 'exited';
  exitCode?: number;
  runId?: string;
  argv?: string[];
  progress?: { done: number; total: number };
}

export interface ClearResult {
  deleted: string[];
  skipped: { runId: string; reason: string }[];
  freedBytes: number;
}
