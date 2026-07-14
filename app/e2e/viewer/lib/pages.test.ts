import { describe, expect, it } from 'bun:test';

import { groupPages } from './pages';
import type { RunDetail, ScenarioTimeline } from './types';

const timeline = (
  scenarioId: string,
  ok: boolean,
  named: { name: string; occurrence: number; seq: number }[]
): ScenarioTimeline => ({
  scenarioId,
  name: scenarioId,
  lane: 'funded',
  ok,
  frames: [],
  named: named.map((capture) => ({
    name: capture.name,
    occurrence: capture.occurrence,
    file: `${scenarioId}/named/${capture.name}-${String(capture.seq).padStart(3, '0')}.png`,
    artifactSeq: capture.seq,
    phase: 'T' as const,
  })),
});

const run = (
  runId: string,
  startedAt: string,
  scenarios: ScenarioTimeline[],
  over: Partial<RunDetail> = {}
): RunDetail => ({
  runId,
  suite: 'full',
  driver: 'sim',
  proof: 'product-run',
  startedAt,
  scenarioIds: scenarios.map((scenario) => scenario.scenarioId),
  commitRun: false,
  label: startedAt,
  status: 'complete',
  fundsSafeToDelete: true,
  scenarios,
  ...over,
});

describe('groupPages', () => {
  const newest = run('r2', '2026-07-14T02:00:00Z', [
    timeline('receive.lightning.sat', true, [
      { name: 'wallet', occurrence: 1, seq: 17 },
      { name: 'lightning-receive', occurrence: 1, seq: 29 },
      { name: 'wallet', occurrence: 2, seq: 39 },
    ]),
    timeline('send.cashu.sat', false, [{ name: 'send-token', occurrence: 1, seq: 53 }]),
  ]);
  const older = run('r1', '2026-07-14T01:00:00Z', [
    timeline('receive.lightning.sat', true, [{ name: 'wallet', occurrence: 1, seq: 17 }]),
    timeline('send.cashu.sat', true, [{ name: 'send-token', occurrence: 1, seq: 53 }]),
  ]);
  const smoke = run('r0', '2026-07-14T00:00:00Z', [
    timeline('receive.lightning.sat', true, [{ name: 'wallet', occurrence: 1, seq: 17 }]),
  ]);
  smoke.proof = 'orchestration-smoke';

  it('keeps only the newest passing product run per scenario by default', () => {
    const index = groupPages([newest, older, smoke], false);
    const wallet = index.pages.find((group) => group.page === 'wallet')!;
    // receive.lightning.sat comes from r2 (newest pass); its two occurrences both appear.
    expect(wallet.captures.map((capture) => capture.runId)).toEqual(['r2', 'r2']);
    // send.cashu.sat failed in r2, so its send-token capture comes from r1.
    const sendToken = index.pages.find((group) => group.page === 'send-token')!;
    expect(sendToken.captures.map((capture) => capture.runId)).toEqual(['r1']);
    // smoke runs never contribute.
    expect(index.pages.flatMap((group) => group.captures).some((c) => c.runId === 'r0')).toBe(
      false
    );
  });

  it('widens to every product run when allRuns is set', () => {
    const index = groupPages([newest, older, smoke], true);
    const wallet = index.pages.find((group) => group.page === 'wallet')!;
    expect(wallet.captures).toHaveLength(3); // r2 ×2 + r1 ×1, never the smoke run
  });

  it('orders groups by the canonical registry, legacy names last', () => {
    const legacy = run('r3', '2026-07-14T03:00:00Z', [
      timeline('old.scenario', true, [{ name: 'wallet-start', occurrence: 1, seq: 1 }]),
    ]);
    const index = groupPages([legacy, newest], false);
    const names = index.pages.map((group) => group.page);
    expect(names.indexOf('wallet')).toBeLessThan(names.indexOf('wallet-start'));
  });
});
