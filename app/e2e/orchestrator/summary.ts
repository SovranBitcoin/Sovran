/**
 * SUMMARY.md / summary.json renderers — pure projections of the campaign
 * state, rewritten after every attempt so an agent with a fresh context can
 * read one file and know exactly what failed, where the evidence lives, and
 * how to reproduce it. Failures come first; the full matrix last.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Platform } from '../schema/capabilities';
import type { AttemptRecord, ChunkState, OrchestratorState } from './state';

export type PairStatus =
  | 'pending'
  | 'passed'
  | 'flaky-pass'
  | 'consistent-fail'
  | 'infra-exhausted'
  | 'funded-blocked'
  | 'skipped'
  | 'out-of-scope';

export interface PairSummary {
  scenarioId: string;
  platform: Platform;
  status: PairStatus;
  chunkId?: string;
  /** Run dir name of the green attempt, when one exists. */
  runId?: string;
  attempts: number;
}

const CHUNK_TO_PAIR_STATUS: Record<ChunkState['status'], PairStatus> = {
  pending: 'pending',
  running: 'pending',
  passed: 'passed',
  'flaky-pass': 'flaky-pass',
  'consistent-fail': 'consistent-fail',
  'infra-exhausted': 'infra-exhausted',
  'funded-blocked': 'funded-blocked',
  skipped: 'skipped',
};

const GLYPH: Record<PairStatus, string> = {
  passed: '✓',
  'flaky-pass': '~',
  'consistent-fail': '✗',
  'infra-exhausted': '‼',
  'funded-blocked': '⛔',
  skipped: '⊘',
  pending: '…',
  'out-of-scope': '·',
};

export function derivePairSummaries(state: OrchestratorState): PairSummary[] {
  const chunkByPair = new Map<string, ChunkState>();
  for (const chunk of state.chunks) {
    for (const key of chunk.expectedPairKeys) chunkByPair.set(key, chunk);
  }
  return state.expectedPairKeys.map((key) => {
    const [scenarioId, platform] = key.split('|') as [string, Platform];
    const chunk = chunkByPair.get(key);
    if (!chunk) return { scenarioId, platform, status: 'out-of-scope', attempts: 0 };
    return {
      scenarioId,
      platform,
      status: CHUNK_TO_PAIR_STATUS[chunk.status],
      chunkId: chunk.chunkId,
      runId: greenAttempt(chunk)?.runId,
      attempts: chunk.attempts.length,
    };
  });
}

const greenAttempt = (chunk: ChunkState): AttemptRecord | undefined =>
  [...chunk.attempts].reverse().find((attempt) => attempt.outcome === 'passed');

const lastAttempt = (chunk: ChunkState): AttemptRecord | undefined => chunk.attempts.at(-1);

export function reproCommand(chunk: ChunkState, acceptTestFundLoss: boolean): string {
  const parts = [
    'bun e2e/cli.ts run',
    `--driver ${chunk.driver}`,
    '--suite full',
    `--scenario ${chunk.targetScenarioId}`,
    '--i-approve-destructive-reset',
  ];
  if (chunk.funded && acceptTestFundLoss) parts.push('--i-accept-test-fund-loss');
  return parts.join(' ');
}

function attemptHistoryLine(chunk: ChunkState): string {
  return chunk.attempts
    .map((attempt) => {
      const where = attempt.runId ?? 'no-run-dir';
      const step = attempt.failure?.stepId ? `(${attempt.failure.stepId})` : '';
      return `#${attempt.attempt} ${where} ${attempt.outcome}${step}`;
    })
    .join(' · ');
}

function failureBlock(chunk: ChunkState, state: OrchestratorState): string[] {
  const attempt =
    [...chunk.attempts].reverse().find((candidate) => candidate.failure) ?? lastAttempt(chunk);
  const lines = [
    `### ${chunk.targetScenarioId} — ${chunk.platform} — ${chunk.attempts.length} attempt(s)`,
  ];
  const failure = attempt?.failure;
  if (failure) {
    lines.push(
      `- failing scenario: \`${failure.scenarioId}\`${failure.stepId ? ` at step \`${failure.stepId}\`` : ''}`
    );
    if (failure.error) lines.push(`- error: ${failure.error}`);
    if (failure.screenshot) lines.push(`- screenshot: ${failure.screenshot}`);
    if (failure.axFile) lines.push(`- ax: ${failure.axFile}`);
  }
  if (attempt?.artifacts) {
    lines.push(`- run dir: ${attempt.artifacts.runDir} (exit ${attempt.exitCode ?? '?'})`);
    lines.push(`- events: ${attempt.artifacts.events}`);
    for (const metro of attempt.artifacts.metroLogs) lines.push(`- metro: ${metro}`);
  }
  lines.push(`- attempts: ${attemptHistoryLine(chunk)}`);
  lines.push(`- repro: \`${reproCommand(chunk, state.config.acceptTestFundLoss)}\``);
  return lines;
}

export function renderSummaryMarkdown(state: OrchestratorState): string {
  const pairs = derivePairSummaries(state);
  const inScope = pairs.filter((pair) => pair.status !== 'out-of-scope');
  const green = inScope.filter((pair) => pair.status === 'passed' || pair.status === 'flaky-pass');
  const byPlatform = (platform: Platform, items: PairSummary[]) =>
    items.filter((pair) => pair.platform === platform).length;

  const counts = new Map<PairStatus, number>();
  for (const pair of inScope) counts.set(pair.status, (counts.get(pair.status) ?? 0) + 1);
  const countLine = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status} ${count}`)
    .join(' · ');

  const consistentFails = state.chunks.filter((chunk) => chunk.status === 'consistent-fail');
  const infraExhausted = state.chunks.filter((chunk) => chunk.status === 'infra-exhausted');
  const flaky = state.chunks.filter((chunk) => chunk.status === 'flaky-pass');
  const fundedBlocked = state.chunks.filter((chunk) => chunk.status === 'funded-blocked');
  const skipped = state.chunks.filter((chunk) => chunk.status === 'skipped');
  const pending = state.chunks.filter(
    (chunk) => chunk.status === 'pending' || chunk.status === 'running'
  );

  const lines: string[] = [
    `# E2E Orchestration — campaign ${state.campaignId}`,
    '',
    `status: **${state.status}** · started ${state.createdAt} · updated ${state.updatedAt} · source \`${state.sourceFingerprint.slice(0, 12)}\``,
    `progress: **${green.length}/${inScope.length} pairs** (iOS ${byPlatform('ios', green)}/${byPlatform('ios', inScope)}, Android ${byPlatform('android', green)}/${byPlatform('android', inScope)})`,
    countLine,
    '',
    `resume: \`bun e2e/orchestrate.ts run --resume ${state.campaignId} --i-approve-destructive-reset${state.config.acceptTestFundLoss ? ' --i-accept-test-fund-loss' : ''}\``,
    `verify: \`bun e2e/audit/fresh-matrix-cli.ts --cutoff ${state.createdAt}\``,
  ];
  if (state.finalAudit) {
    lines.push(
      '',
      `final audit: ${state.finalAudit.covered}/${state.finalAudit.expected} covered — ${state.finalAudit.complete ? '✓ complete' : `${state.finalAudit.missing.length} missing`}`
    );
    for (const missing of state.finalAudit.missing.slice(0, 20)) {
      lines.push(`- missing ${missing.pairKey}: ${missing.reasons.join('; ')}`);
    }
  }

  const section = (
    title: string,
    chunks: ChunkState[],
    render: (chunk: ChunkState) => string[]
  ) => {
    if (chunks.length === 0) return;
    lines.push('', `## ${title}`, '');
    for (const chunk of chunks) {
      lines.push(...render(chunk), '');
    }
  };

  section('Consistent failures (fix these first)', consistentFails, (chunk) =>
    failureBlock(chunk, state)
  );
  section('Infra-exhausted (device/session aborts, not scenario logic)', infraExhausted, (chunk) =>
    failureBlock(chunk, state)
  );

  if (flaky.length > 0) {
    lines.push(
      '',
      '## Flaky passes',
      '',
      '| scenario | platform | attempts | first failure |',
      '|---|---|---|---|'
    );
    for (const chunk of flaky) {
      const first = chunk.attempts.find((attempt) => attempt.outcome !== 'passed');
      lines.push(
        `| ${chunk.targetScenarioId} | ${chunk.platform} | ${chunk.attempts.length} | ${first ? `${first.outcome}${first.failure?.stepId ? ` at ${first.failure.stepId}` : ''}` : '—'} |`
      );
    }
  }

  section('Funded-blocked', fundedBlocked, (chunk) => [
    `### ${chunk.targetScenarioId} — ${chunk.platform}`,
    `- ${chunk.skipReason ?? 'funded preflight or reconciliation failed'}`,
    `- check: \`bun e2e/cli.ts funds-status\``,
    ...failureBlock(chunk, state).slice(1),
  ]);

  if (skipped.length > 0) {
    lines.push('', '## Skipped', '');
    for (const chunk of skipped) {
      lines.push(`- ${chunk.chunkId}: ${chunk.skipReason ?? 'skipped'}`);
    }
  }

  if (pending.length > 0) {
    lines.push('', '## Pending', '', `${pending.length} chunk(s); next: ${pending[0]!.chunkId}`);
  }

  lines.push('', '## Full matrix', '', '| scenario | iOS | Android |', '|---|---|---|');
  const byScenario = new Map<string, Partial<Record<Platform, PairSummary>>>();
  for (const pair of pairs) {
    const row = byScenario.get(pair.scenarioId) ?? {};
    row[pair.platform] = pair;
    byScenario.set(pair.scenarioId, row);
  }
  for (const [scenarioId, row] of byScenario) {
    const cell = (platform: Platform) => {
      const pair = row[platform];
      if (!pair) return '◌';
      const glyph = GLYPH[pair.status];
      return pair.runId ? `${glyph} ${pair.runId}` : glyph;
    };
    lines.push(`| ${scenarioId} | ${cell('ios')} | ${cell('android')} |`);
  }
  lines.push(
    '',
    'Legend: ✓ passed · ~ flaky-pass · ✗ consistent-fail · ‼ infra-exhausted · ⛔ funded-blocked · ⊘ skipped · … pending · ◌ not-supported · · out-of-scope',
    ''
  );
  return lines.join('\n');
}

export function buildSummaryJson(state: OrchestratorState): Record<string, unknown> {
  const pairs = derivePairSummaries(state);
  const byStatus: Record<string, number> = {};
  for (const pair of pairs) byStatus[pair.status] = (byStatus[pair.status] ?? 0) + 1;
  return {
    campaign: {
      campaignId: state.campaignId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      status: state.status,
      sourceFingerprint: state.sourceFingerprint,
      config: state.config,
    },
    byStatus,
    pairs,
    chunks: state.chunks,
    finalAudit: state.finalAudit,
  };
}

export function writeSummary(campaignDir: string, state: OrchestratorState): void {
  mkdirSync(campaignDir, { recursive: true });
  const writes: [string, string][] = [
    ['SUMMARY.md', renderSummaryMarkdown(state)],
    ['summary.json', `${JSON.stringify(buildSummaryJson(state), null, 2)}\n`],
  ];
  for (const [name, content] of writes) {
    const tmp = join(campaignDir, `${name}.tmp`);
    writeFileSync(tmp, content);
    renameSync(tmp, join(campaignDir, name));
  }
}
