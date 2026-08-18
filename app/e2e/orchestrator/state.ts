/**
 * Durable orchestrator campaign state. Saved atomically (tmp + rename) after
 * every attempt and status transition so a killed orchestrator resumes from
 * exactly what it recorded — and so SUMMARY.md is always a pure projection of
 * this file, never a second source of truth.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { PLATFORMS } from '../schema/capabilities';
import type { ChunkPlan, ChunkPlanEntry } from './matrix';

const attemptOutcomeSchema = z.enum([
  'passed',
  'scenario-failed',
  'infra-aborted',
  'funded-quarantined',
  'preflight-failed',
  'interrupted',
]);
export type AttemptOutcome = z.infer<typeof attemptOutcomeSchema>;

const attemptRecordSchema = z.object({
  attempt: z.number().int().min(1),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  /** Run dir name (e.g. "run-2026-…-abcd1234"); absent iff the child died
   * before creating a run dir. */
  runId: z.string().optional(),
  exitCode: z.number().int().optional(),
  outcome: attemptOutcomeSchema,
  failure: z
    .object({
      scenarioId: z.string(),
      stepId: z.string().optional(),
      error: z.string().optional(),
      screenshot: z.string().optional(),
      axFile: z.string().optional(),
    })
    .optional(),
  artifacts: z
    .object({
      runDir: z.string(),
      events: z.string(),
      metroLogs: z.array(z.string()),
    })
    .optional(),
});
export type AttemptRecord = z.infer<typeof attemptRecordSchema>;

const chunkStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'flaky-pass',
  'consistent-fail',
  'infra-exhausted',
  'funded-blocked',
  'skipped',
]);
type ChunkStatus = z.infer<typeof chunkStatusSchema>;

const chunkStateSchema = z.object({
  chunkId: z.string(),
  platform: z.enum(PLATFORMS),
  driver: z.enum(['sim', 'android']),
  targetScenarioId: z.string(),
  memberIds: z.array(z.string()),
  supportedMemberIds: z.array(z.string()),
  expectedPairKeys: z.array(z.string()),
  funded: z.boolean(),
  status: chunkStatusSchema,
  /** Why the chunk was skipped (e.g. "funded-halted: unlock cocod"). */
  skipReason: z.string().optional(),
  /** True when a fresh-matrix audit — not an attempt in this campaign —
   * proved every expected pair. */
  coveredByAudit: z.boolean().optional(),
  attempts: z.array(attemptRecordSchema),
});
export type ChunkState = z.infer<typeof chunkStateSchema>;

const orchestratorStateSchema = z.object({
  version: z.literal(1),
  campaignId: z.string(),
  /** ISO start — doubles as the fresh-matrix audit cutoff. */
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceFingerprint: z.string(),
  status: z.enum(['running', 'interrupted', 'complete', 'funded-halted', 'source-drift']),
  config: z.object({
    platforms: z.array(z.enum(PLATFORMS)),
    lane: z.string().optional(),
    noRecord: z.boolean(),
    acceptTestFundLoss: z.boolean(),
    retries: z.object({
      scenarioFail: z.number().int().min(1),
      infraAbort: z.record(z.enum(PLATFORMS), z.number().int().min(1)),
    }),
  }),
  /** Full-matrix pair keys, recorded so status/summary need no re-derivation. */
  expectedPairKeys: z.array(z.string()),
  chunks: z.array(chunkStateSchema),
  /** Embedded result of the finalizing fresh-matrix audit. */
  finalAudit: z
    .object({
      covered: z.number().int(),
      expected: z.number().int(),
      complete: z.boolean(),
      missing: z.array(z.object({ pairKey: z.string(), reasons: z.array(z.string()) })),
    })
    .optional(),
});
export type OrchestratorState = z.infer<typeof orchestratorStateSchema>;

export const DEFAULT_RETRIES = {
  scenarioFail: 2,
  infraAbort: { ios: 3, android: 4 },
} as const;

interface CreateStateOptions {
  campaignId: string;
  nowIso: string;
  sourceFingerprint: string;
  plan: ChunkPlan;
  config: OrchestratorState['config'];
}

export function createState(options: CreateStateOptions): OrchestratorState {
  return {
    version: 1,
    campaignId: options.campaignId,
    createdAt: options.nowIso,
    updatedAt: options.nowIso,
    sourceFingerprint: options.sourceFingerprint,
    status: 'running',
    config: options.config,
    expectedPairKeys: options.plan.expectedPairKeys,
    chunks: options.plan.chunks.map((chunk) => chunkFromPlan(chunk)),
  };
}

function chunkFromPlan(chunk: ChunkPlanEntry): ChunkState {
  return {
    chunkId: chunk.chunkId,
    platform: chunk.platform,
    driver: chunk.driver,
    targetScenarioId: chunk.targetScenarioId,
    memberIds: chunk.memberIds,
    supportedMemberIds: chunk.supportedMemberIds,
    expectedPairKeys: chunk.expectedPairKeys,
    funded: chunk.funded,
    status: 'pending',
    attempts: [],
  };
}

const STATE_FILE = 'state.json';

export function saveState(campaignDir: string, state: OrchestratorState, nowIso: string): void {
  state.updatedAt = nowIso;
  mkdirSync(campaignDir, { recursive: true });
  const tmp = join(campaignDir, `${STATE_FILE}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, join(campaignDir, STATE_FILE));
}

export function loadState(campaignDir: string): Result<OrchestratorState, string> {
  let raw: string;
  try {
    raw = readFileSync(join(campaignDir, STATE_FILE), 'utf8');
  } catch (cause) {
    return err(
      `cannot read ${STATE_FILE} in ${campaignDir}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(`${STATE_FILE} is not valid JSON`);
  }
  const checked = orchestratorStateSchema.safeParse(parsed);
  if (!checked.success) {
    return err(`${STATE_FILE} failed schema validation: ${checked.error.issues[0]?.message}`);
  }
  return ok(checked.data);
}

/** Chunks a killed orchestrator left mid-flight; their last attempt's run dir
 * must be classified post-hoc before the campaign continues. */
export function chunksNeedingReconciliation(state: OrchestratorState): ChunkState[] {
  return state.chunks.filter((chunk) => chunk.status === 'running');
}

/** Terminal chunk statuses — the resume loop never re-enters these. */
export function isTerminalChunkStatus(status: ChunkStatus): boolean {
  return status !== 'pending' && status !== 'running';
}
