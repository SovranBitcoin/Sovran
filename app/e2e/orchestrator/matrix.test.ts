import { describe, expect, test } from 'bun:test';

import { buildChunkPlan, chunkArgv, pairKey } from './matrix';

describe('buildChunkPlan (real authoring tree)', () => {
  const plan = buildChunkPlan({ platforms: ['ios', 'android'] });

  test('matches the fresh-matrix invariant: 126 scenarios, 215 pairs', () => {
    expect(plan.isOk()).toBe(true);
    const value = plan._unsafeUnwrap();
    expect(value.scenarioCount).toBe(126);
    expect(value.expectedPairKeys.length).toBe(215);
    expect(new Set(value.expectedPairKeys).size).toBe(215);
  });

  test('one chunk per session group per supported platform, iOS first', () => {
    const value = plan._unsafeUnwrap();
    const ios = value.chunks.filter((chunk) => chunk.platform === 'ios');
    const android = value.chunks.filter((chunk) => chunk.platform === 'android');
    expect(ios.length + android.length).toBe(value.chunks.length);
    // Requested order is execution order: every iOS chunk precedes every android chunk.
    const firstAndroid = value.chunks.findIndex((chunk) => chunk.platform === 'android');
    expect(value.chunks.slice(0, firstAndroid).every((chunk) => chunk.platform === 'ios')).toBe(
      true
    );
    // Chunks jointly prove exactly the full matrix.
    const proved = new Set(value.chunks.flatMap((chunk) => chunk.expectedPairKeys));
    expect(proved.size).toBe(215);
  });

  test('multi-member groups keep the last member as --scenario target', () => {
    const value = plan._unsafeUnwrap();
    const multi = value.chunks.filter((chunk) => chunk.memberIds.length > 1);
    for (const chunk of multi) {
      expect(chunk.targetScenarioId).toBe(chunk.memberIds.at(-1)!);
      // Supported members must be a subset of members, in order.
      expect(chunk.supportedMemberIds.every((id) => chunk.memberIds.includes(id))).toBe(true);
    }
    // The known 2-member group: recovery.reinstall is iOS-only but still the
    // android chunk's target — its predecessor runs, reinstall defers.
    const androidReinstall = value.chunks.find(
      (chunk) => chunk.platform === 'android' && chunk.targetScenarioId === 'recovery.reinstall'
    );
    if (androidReinstall) {
      expect(androidReinstall.supportedMemberIds).not.toContain('recovery.reinstall');
      expect(androidReinstall.supportedMemberIds.length).toBeGreaterThan(0);
    }
  });

  test('lane narrowing keeps only chunks with a matching member', () => {
    const funded = buildChunkPlan({ platforms: ['ios'], lane: 'funded' })._unsafeUnwrap();
    expect(funded.chunks.length).toBeGreaterThan(0);
    expect(funded.chunks.every((chunk) => chunk.funded)).toBe(true);
  });

  test('rejects empty or duplicate platform lists', () => {
    expect(buildChunkPlan({ platforms: [] }).isErr()).toBe(true);
    expect(buildChunkPlan({ platforms: ['ios', 'ios'] }).isErr()).toBe(true);
  });
});

describe('chunkArgv', () => {
  const chunk = {
    chunkId: 'ios:mint.add.url',
    platform: 'ios' as const,
    driver: 'sim' as const,
    targetScenarioId: 'mint.add.url',
    memberIds: ['mint.add.url'],
    supportedMemberIds: ['mint.add.url'],
    expectedPairKeys: [pairKey('mint.add.url', 'ios')],
    funded: false,
  };

  test('forwards only the operator-granted safety flags', () => {
    expect(chunkArgv(chunk, { acceptTestFundLoss: true, noRecord: false })).toEqual([
      'bun',
      'e2e/cli.ts',
      'run',
      '--driver',
      'sim',
      '--i-approve-destructive-reset',
      '--suite',
      'full',
      '--scenario',
      'mint.add.url',
    ]);
    expect(
      chunkArgv({ ...chunk, funded: true }, { acceptTestFundLoss: true, noRecord: true })
    ).toEqual([
      'bun',
      'e2e/cli.ts',
      'run',
      '--driver',
      'sim',
      '--i-approve-destructive-reset',
      '--suite',
      'full',
      '--scenario',
      'mint.add.url',
      '--i-accept-test-fund-loss',
      '--no-record',
    ]);
    // Never synthesized: funded chunk without consent gets no fund-loss flag.
    expect(
      chunkArgv({ ...chunk, funded: true }, { acceptTestFundLoss: false, noRecord: false })
    ).not.toContain('--i-accept-test-fund-loss');
  });
});
