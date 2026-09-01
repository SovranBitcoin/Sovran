/** Shared API contract between the viewer server and the browser bundle.
 * The frontend must import from here with `import type` only so Bun's
 * bundler never pulls server code into the browser. */

import type { Platform } from '../../schema/capabilities';
import type { ScenarioFacets } from '../../schema/facets';

export interface GitInfo {
  sha: string;
  shortSha: string;
  branch: string;
  dirty: boolean;
}

export type RunStatus = 'complete' | 'in-progress' | 'aborted';

/** Per-scenario status within one run, derived from the event timelines:
 * pending/running only exist while the run is in-progress; a begun-but-unended
 * timeline in a finished run collapses to failed, an unbegun one to skipped. */
export type ScenarioRunStatus =
  'pending' | 'running' | 'passed' | 'failed' | 'deferred' | 'skipped';

export interface RunSummary {
  runId: string;
  suite: string;
  driver: 'fake' | 'sim' | 'android';
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
  /** Simulator device type from session-N.json (e.g. "iPhone 17 Pro"); absent
   * for fake-driver runs. Lets the player round frames to the hardware radius. */
  deviceType?: string;
  /** Status per manifest scenarioId; absent when the run has no parsable event
   * stream (dir-scan fallback) so consumers fall back to run-level status. */
  scenarioStatus?: Record<string, ScenarioRunStatus>;
  /** The scenario currently executing — only set while status is in-progress. */
  activeScenarioId?: string;
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
  /** Zustand state-mirror snapshot for this frame. Dedup means consecutive
   * frames with unchanged state share one rel path. */
  storeFile?: string;
  /** Coco SQLite dump for this frame; shares rel paths across frames like storeFile. */
  dbFile?: string;
}

export interface NamedFrame {
  /** Canonical page name (schema/pages.ts); legacy runs carry free-form names. */
  name: string;
  occurrence: number;
  file: string;
  axFile?: string;
  storeFile?: string;
  dbFile?: string;
  stepId?: string;
  /** Global artifact sequence — lets the player interleave named captures into the reel. */
  artifactSeq?: number;
  phase?: PhaseTag;
  /** Wall-clock ms of the capture event — maps the frame onto the video timeline. */
  t?: number;
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
  /** Wall-clock ms of the video artifact event, stamped at recorder stop — approximates
   * the recording's end (SIGINT finalization can add a second or two of drift), letting
   * the player anchor frame timestamps onto the video timeline. */
  videoEndT?: number;
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
  /** Which product driver executed the run — badges run rows iPhone/Android. */
  driver: RunSummary['driver'];
  ok?: boolean;
  /** This scenario's own status in the run — distinguishes the one running
   * scenario from its still-pending siblings while the run is live. */
  scenarioStatus?: ScenarioRunStatus;
}

export interface ScenarioCatalogEntry {
  id: string;
  name: string;
  description: string;
  /** Technical deep-dive companion to the plain `description`. */
  details?: string;
  lane: string;
  tags: string[];
  /** Platforms the scenario is specified to work on, derived from `requires`
   * against the per-driver capability sets (schema/capabilities.ts). */
  platforms: Platform[];
  /** Structured view of the namespaced facet tags (flow/instrument/io/…). */
  facets: ScenarioFacets;
  deferredReason?: string;
  suites: string[];
  /** Actual non-deferred attempts of this scenario, newest first. */
  runs: CatalogRunRef[];
}

type DiffPairStatus = 'diff' | 'identical' | 'added' | 'removed' | 'dimension-mismatch' | 'error';

export interface DiffPairResult {
  key: string;
  scenarioId: string;
  phase: PhaseTag | 'named';
  stepId?: string;
  name?: string;
  /** artifactSeq of the source frame (run A's, else run B's) — the reel order. */
  order?: number;
  kind?: string;
  label?: string;
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
  /** Cache format version — stale cached results are recomputed on load. */
  version: number;
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

interface PageGroup {
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
  /** Most recently discovered run, retained for backwards-compatible focus. */
  runId?: string;
  /** Every platform run produced by this sequential matrix job. */
  runIds?: string[];
  /** Command currently running (or the final command after exit). */
  argv?: string[];
  /** Complete sequential command matrix. */
  argvs?: string[][];
  progress?: { done: number; total: number };
}

export interface ClearResult {
  deleted: string[];
  skipped: { runId: string; reason: string }[];
  freedBytes: number;
}

/** A visible reel entry: a timeline frame, plus the canonical page name when
 *  the entry is a named capture rather than a step frame. */
export interface ReelFrame extends Frame {
  named?: string;
}
