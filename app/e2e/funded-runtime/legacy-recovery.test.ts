import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import type {
  CocodBalanceSnapshot,
  CocodCounterparty,
  DeclaredRecoveryAsset,
  FundedRecoveryReport,
} from '../funded';
import { storeRecovery } from '../ledger/custody';
import {
  auditLegacyFundedArtifacts,
  describeRequiredLegacyDeferrals,
  recoverLegacyFundedArtifacts,
  type LegacyRecoveryFactory,
  type LegacyRecoveryPort,
} from './legacy-recovery';

const FIRST_SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SECOND_SEED =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';
const ASSET: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.example',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 200,
};
const MINIBITS_ASSET: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.minibits.cash/Bitcoin',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 200,
};

function root(): string {
  return mkdtempSync(join(tmpdir(), 'sovran-legacy-recovery-'));
}

function writePrivate(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, value, { mode: 0o600 });
}

function writeLegacy(rootDir: string, seeds: readonly string[]): string {
  const path = join(rootDir, 'legacy-SEEDS.json');
  writePrivate(
    path,
    JSON.stringify(
      seeds.map((seed, index) => ({
        app: 'Sovran',
        flow: 'retired-harness',
        seed,
        accountIndex: 0,
        mint: ASSET.mintUrl,
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        swept: 'cashuBretired-bearer-value',
        sweptSats: 1,
      }))
    )
  );
  return path;
}

function writeMetro(rootDir: string, seed: string): string {
  const path = join(rootDir, 'metro.log');
  writePrivate(path, `ordinary line\n LOG  E2E_SEED_EXPORT ${seed}\nlast line\n`);
  return path;
}

function cocod(): CocodCounterparty {
  return {
    status: async () => 'UNLOCKED',
    balanceSnapshot: async () => ({}) satisfies CocodBalanceSnapshot,
    exactBalance: () => 0,
    createCashu: async () => {
      throw new Error('unexpected createCashu');
    },
    receiveCashu: async () => {
      throw new Error('unexpected receiveCashu');
    },
    createBolt11: async () => {
      throw new Error('unexpected createBolt11');
    },
    payBolt11: async () => {
      throw new Error('unexpected payBolt11');
    },
    npcAddress: async () => {
      throw new Error('unexpected npcAddress');
    },
  };
}

function emptyReport(assets: readonly DeclaredRecoveryAsset[]): FundedRecoveryReport {
  return {
    assets: assets.map((asset) => ({
      asset,
      restoredAmount: 0,
      tokenAmount: 0,
      counterpartyDelta: 0,
      sendFee: 0,
      receiveFee: 0,
      residualAmount: 0,
    })),
    counterpartyTokens: [],
  };
}

function fakeFactory(
  options: {
    failEstablishments?: number;
    failEstablishmentAt?: number;
    failReconciliations?: number;
    unreachableMints?: Set<string>;
    failCombinedReconcile?: boolean;
    combinedAssets?: readonly DeclaredRecoveryAsset[];
    report?: (assets: readonly DeclaredRecoveryAsset[]) => FundedRecoveryReport;
  } = {}
) {
  let establishmentFailures = options.failEstablishments ?? 0;
  let failuresRemaining = options.failReconciliations ?? 0;
  let establishCalls = 0;
  let openCalls = 0;
  let reconcileCalls = 0;
  const assetsByRun = new Map<string, DeclaredRecoveryAsset[]>();

  const port = (runDir: string): LegacyRecoveryPort => {
    const custodyPath = join(runDir, 'funded-custody', 'recovery.json');
    const assets = [...(assetsByRun.get(runDir) ?? options.combinedAssets ?? [ASSET])];
    return {
      custodyPath,
      assets,
      reconcile: async ({ acceptEmptyAssets }) => {
        reconcileCalls++;
        expect(acceptEmptyAssets).toEqual(assets);
        if (options.unreachableMints?.has(assets[0].mintUrl)) {
          throw new Error('mint transport unavailable');
        }
        if (options.failCombinedReconcile && assets.length > 1) {
          throw new Error('combined re-verification unavailable');
        }
        if (failuresRemaining > 0) {
          failuresRemaining--;
          throw new Error(`must never surface ${FIRST_SEED}`);
        }
        return (options.report ?? emptyReport)(assets);
      },
      disposePrivateMaterial: () => {
        if (existsSync(custodyPath)) unlinkSync(custodyPath);
      },
    };
  };

  const factory: LegacyRecoveryFactory = {
    establish: ({ runDir, assets }) => {
      establishCalls++;
      if (options.failEstablishmentAt === establishCalls || establishmentFailures > 0) {
        if (establishmentFailures > 0) establishmentFailures--;
        throw new Error(`must never surface ${FIRST_SEED}`);
      }
      assetsByRun.set(
        runDir,
        assets.map((asset) => ({ ...asset }))
      );
      writePrivate(join(runDir, 'funded-custody', 'recovery.json'), '{"managed":true}');
      return port(runDir);
    },
    open: ({ runDir }) => {
      openCalls++;
      return port(runDir);
    },
  };
  return {
    factory,
    counts: () => ({ establishCalls, openCalls, reconcileCalls }),
  };
}

function custodyFiles(rootDir: string): { secret: string; sidecar: string } {
  const handle = storeRecovery(join(rootDir, 'custody'), 'mnemonic', FIRST_SEED);
  const dir = join(rootDir, 'custody', 'custody');
  return {
    secret: join(dir, `${handle.id}.secret`),
    sidecar: join(dir, `${handle.id}.json`),
  };
}

describe('retired harness funded recovery', () => {
  it('describes only deferred custody that blocks the selected assets', () => {
    expect(
      describeRequiredLegacyDeferrals(
        {
          status: 'blocked',
          canRunRequiredAssets: false,
          deferredAssets: [
            { ...MINIBITS_ASSET, custodyCount: 13 },
            { ...ASSET, custodyCount: 1 },
          ],
          retainedCombinedCustodies: 1,
        },
        [MINIBITS_ASSET]
      )
    ).toBe('https://mint.minibits.cash/Bitcoin (sat, account 0, 13 retained custodies)');
  });

  it('deduplicates legacy JSON, custody, and Metro seeds without surfacing them', async () => {
    const artifactsRoot = root();
    writeLegacy(artifactsRoot, [FIRST_SEED, FIRST_SEED]);
    custodyFiles(artifactsRoot);
    const metroPath = writeMetro(artifactsRoot, FIRST_SEED);
    const fake = fakeFactory();

    const result = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET],
      factory: fake.factory,
      now: () => new Date('2026-07-12T12:00:00.000Z'),
    });

    expect(fake.counts()).toEqual({ establishCalls: 1, openCalls: 1, reconcileCalls: 1 });
    expect(result.summary).toMatchObject({
      sourceRecords: { legacyJson: 2, custody: 1, metro: 1 },
      uniqueSeeds: 1,
      declaredAssets: 1,
    });
    const metro = readFileSync(metroPath, 'utf8');
    expect(metro).toBe('ordinary line\n LOG  E2E_SEED_EXPORT [captured]\nlast line\n');
    expect(metro).not.toContain(FIRST_SEED);
  });

  it('allows Sovran-only selection while Minibits custody is deferred, then retries deterministically', async () => {
    const artifactsRoot = root();
    const legacyPath = writeLegacy(artifactsRoot, [FIRST_SEED]);
    const metroPath = writeMetro(artifactsRoot, FIRST_SEED);
    const unreachableMints = new Set([MINIBITS_ASSET.mintUrl]);
    const fake = fakeFactory({
      unreachableMints,
      combinedAssets: [ASSET, MINIBITS_ASSET],
    });
    const digest = createHash('sha256').update(FIRST_SEED).digest('hex');
    const combinedPath = join(
      artifactsRoot,
      'legacy-recovery-work',
      `seed-${digest}`,
      'funded-custody',
      'recovery.json'
    );
    writePrivate(combinedPath, '{"managed":true}');

    const deferred = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET, MINIBITS_ASSET],
      requiredAssets: [ASSET],
      factory: fake.factory,
    });

    expect(deferred.status).toBe('deferred');
    expect(deferred.summary?.deferredAssets).toEqual([{ ...MINIBITS_ASSET, custodyCount: 1 }]);
    expect(fake.counts()).toEqual({ establishCalls: 2, openCalls: 1, reconcileCalls: 1 });
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(metroPath, 'utf8')).toContain('E2E_SEED_EXPORT [captured]');
    expect(readFileSync(metroPath, 'utf8')).not.toContain(FIRST_SEED);
    const deferredRecoveryFiles = readdirSync(join(artifactsRoot, 'legacy-recovery-work'), {
      recursive: true,
    })
      .map(String)
      .filter((entry) => entry.endsWith('recovery.json'))
      .map((entry) => join(artifactsRoot, 'legacy-recovery-work', entry));
    expect(deferredRecoveryFiles).toHaveLength(2);
    expect(deferredRecoveryFiles.every((path) => (statSync(path).mode & 0o777) === 0o600)).toBe(
      true
    );
    const deferredSummary = readFileSync(deferred.summaryPath!, 'utf8');
    expect(statSync(deferred.summaryPath!).mode & 0o777).toBe(0o600);
    expect(deferredSummary).not.toContain(FIRST_SEED);
    const reconciliationFiles = readdirSync(join(artifactsRoot, 'legacy-recovery-work'), {
      recursive: true,
    })
      .map(String)
      .filter((entry) => entry.endsWith('reconciliation.json'))
      .map((entry) => join(artifactsRoot, 'legacy-recovery-work', entry));
    expect(reconciliationFiles).toHaveLength(1);
    expect(statSync(reconciliationFiles[0]).mode & 0o777).toBe(0o600);
    expect(readFileSync(reconciliationFiles[0], 'utf8')).not.toContain(FIRST_SEED);

    expect(auditLegacyFundedArtifacts({ artifactsRoot, requiredAssets: [ASSET] })).toMatchObject({
      status: 'deferred',
      canRunRequiredAssets: true,
      retainedCombinedCustodies: 1,
    });
    expect(
      auditLegacyFundedArtifacts({ artifactsRoot, requiredAssets: [MINIBITS_ASSET] })
    ).toMatchObject({
      status: 'blocked',
      canRunRequiredAssets: false,
    });

    const deferredAssetCustody = deferredRecoveryFiles.find((path) => path !== combinedPath)!;
    const deferredAssetCustodyRaw = readFileSync(deferredAssetCustody, 'utf8');
    unlinkSync(deferredAssetCustody);
    expect(auditLegacyFundedArtifacts({ artifactsRoot, requiredAssets: [ASSET] })).toMatchObject({
      status: 'blocked',
      canRunRequiredAssets: false,
      reason: 'invalid-quarantine',
    });
    writePrivate(deferredAssetCustody, deferredAssetCustodyRaw);

    unreachableMints.clear();
    const retried = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET, MINIBITS_ASSET],
      requiredAssets: [MINIBITS_ASSET],
      factory: fake.factory,
    });

    expect(retried.status).toBe('clean');
    expect(retried.summary?.deferredAssets).toEqual([]);
    expect(retried.summary?.reconciledCustodies).toBe(2);
    expect(retried.summary?.retainedCombinedCustodies).toBe(0);
    expect(existsSync(combinedPath)).toBe(false);
    expect(auditLegacyFundedArtifacts({ artifactsRoot })).toMatchObject({
      status: 'clean',
      canRunRequiredAssets: true,
    });
  });

  it('scopes a failed combined retirement to unreachable mints so healthy mints stay runnable', async () => {
    const artifactsRoot = root();
    writeLegacy(artifactsRoot, [FIRST_SEED]);
    const fake = fakeFactory({
      failCombinedReconcile: true,
      combinedAssets: [ASSET, MINIBITS_ASSET],
    });
    const digest = createHash('sha256').update(FIRST_SEED).digest('hex');
    const combinedPath = join(
      artifactsRoot,
      'legacy-recovery-work',
      `seed-${digest}`,
      'funded-custody',
      'recovery.json'
    );
    writePrivate(combinedPath, '{"managed":true}');

    // Per-asset legs reconcile (both mints answer their per-asset scans); only
    // the atomic combined re-verification fails, with Minibits down.
    const result = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET, MINIBITS_ASSET],
      factory: fake.factory,
      probeMintHealth: async (mintUrl) => mintUrl !== MINIBITS_ASSET.mintUrl,
    });

    expect(result.status).toBe('deferred');
    expect(result.summary?.deferredAssets).toEqual([{ ...MINIBITS_ASSET, custodyCount: 1 }]);
    expect(result.summary?.retainedCombinedCustodies).toBe(1);
    expect(existsSync(combinedPath)).toBe(true);
    expect(auditLegacyFundedArtifacts({ artifactsRoot, requiredAssets: [ASSET] })).toMatchObject({
      status: 'deferred',
      canRunRequiredAssets: true,
    });
    expect(
      auditLegacyFundedArtifacts({ artifactsRoot, requiredAssets: [MINIBITS_ASSET] })
    ).toMatchObject({ status: 'blocked', canRunRequiredAssets: false });
  });

  it('defers every declared asset when a combined retirement fails with no unreachable mint', async () => {
    const artifactsRoot = root();
    writeLegacy(artifactsRoot, [FIRST_SEED]);
    const fake = fakeFactory({
      failCombinedReconcile: true,
      combinedAssets: [ASSET, MINIBITS_ASSET],
    });
    const digest = createHash('sha256').update(FIRST_SEED).digest('hex');
    writePrivate(
      join(
        artifactsRoot,
        'legacy-recovery-work',
        `seed-${digest}`,
        'funded-custody',
        'recovery.json'
      ),
      '{"managed":true}'
    );

    const result = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET, MINIBITS_ASSET],
      factory: fake.factory,
      probeMintHealth: async () => true,
    });

    expect(result.status).toBe('deferred');
    expect(result.summary?.deferredAssets).toEqual([
      { ...ASSET, custodyCount: 1 },
      { ...MINIBITS_ASSET, custodyCount: 1 },
    ]);
    expect(auditLegacyFundedArtifacts({ artifactsRoot, requiredAssets: [ASSET] })).toMatchObject({
      status: 'blocked',
      canRunRequiredAssets: false,
    });
  });

  it('retains every raw source when durable quarantine establishment fails', async () => {
    const artifactsRoot = root();
    const legacyPath = writeLegacy(artifactsRoot, [FIRST_SEED, SECOND_SEED]);
    const custody = custodyFiles(artifactsRoot);
    const metroPath = writeMetro(artifactsRoot, FIRST_SEED);
    const fake = fakeFactory({ failEstablishmentAt: 2 });

    await expect(
      recoverLegacyFundedArtifacts({
        artifactsRoot,
        cocod: cocod(),
        assets: [ASSET],
        factory: fake.factory,
      })
    ).rejects.toThrow('raw sources and managed recovery were retained');

    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(custody.secret)).toBe(true);
    expect(existsSync(custody.sidecar)).toBe(true);
    expect(readFileSync(metroPath, 'utf8')).toContain(FIRST_SEED);
    expect(existsSync(join(artifactsRoot, 'legacy-recovery-summary.json'))).toBe(false);
    expect(
      readdirSync(join(artifactsRoot, 'legacy-recovery-work'), { recursive: true })
        .map(String)
        .some((entry) => entry.endsWith('recovery.json'))
    ).toBe(true);

    await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET],
      factory: fake.factory,
    });
    expect(fake.counts().establishCalls).toBeGreaterThan(1);
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(custody.secret)).toBe(false);
    expect(existsSync(custody.sidecar)).toBe(false);
  });

  it('deletes raw sources only after a compact safe mode-0600 summary and Metro rewrite', async () => {
    const artifactsRoot = root();
    const legacyPath = writeLegacy(artifactsRoot, [SECOND_SEED]);
    const custody = custodyFiles(artifactsRoot);
    const metroPath = writeMetro(artifactsRoot, FIRST_SEED);
    const fake = fakeFactory();

    const result = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET],
      factory: fake.factory,
      now: () => new Date('2026-07-12T13:00:00.000Z'),
    });

    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(custody.secret)).toBe(false);
    expect(existsSync(custody.sidecar)).toBe(false);
    expect(readFileSync(metroPath, 'utf8')).not.toContain(FIRST_SEED);
    expect(statSync(metroPath).mode & 0o777).toBe(0o600);
    const summaryPath = result.summaryPath!;
    const summaryRaw = readFileSync(summaryPath, 'utf8');
    const summary = JSON.parse(summaryRaw);
    expect(summaryRaw).toBe(JSON.stringify(summary));
    expect(statSync(summaryPath).mode & 0o777).toBe(0o600);
    expect(summaryRaw).not.toContain(FIRST_SEED);
    expect(summaryRaw).not.toContain(SECOND_SEED);
    expect(summaryRaw).not.toContain('cashuB');
    expect(summary).toEqual({
      version: 2,
      status: 'reconciled',
      sourceRecords: { legacyJson: 1, custody: 1, metro: 1 },
      uniqueSeeds: 2,
      declaredAssets: 1,
      reconciledCustodies: 2,
      retainedCombinedCustodies: 0,
      deferredAssets: [],
      completedAt: '2026-07-12T13:00:00.000Z',
    });
  });

  it('fails closed on malformed seed sources before opening recovery or modifying raw files', async () => {
    const artifactsRoot = root();
    const legacyPath = join(artifactsRoot, 'legacy-SEEDS.json');
    writePrivate(legacyPath, '[{"seed":"not a valid mnemonic"}]');
    const metroPath = join(artifactsRoot, 'metro.log');
    writePrivate(metroPath, 'LOG E2E_SEED_EXPORT malformed record\n');
    const fake = fakeFactory();

    await expect(
      recoverLegacyFundedArtifacts({
        artifactsRoot,
        cocod: cocod(),
        assets: [ASSET],
        factory: fake.factory,
      })
    ).rejects.toThrow(/malformed seed record|invalid seed custody/);

    expect(fake.counts()).toEqual({ establishCalls: 0, openCalls: 0, reconcileCalls: 0 });
    expect(readFileSync(legacyPath, 'utf8')).toBe('[{"seed":"not a valid mnemonic"}]');
    expect(readFileSync(metroPath, 'utf8')).toBe('LOG E2E_SEED_EXPORT malformed record\n');
    expect(existsSync(join(artifactsRoot, 'legacy-recovery-summary.json'))).toBe(false);
  });

  it('parses the terminal v1 summary as a safe completed migration', async () => {
    const artifactsRoot = root();
    const summaryPath = join(artifactsRoot, 'legacy-recovery-summary.json');
    writePrivate(
      summaryPath,
      JSON.stringify({
        version: 1,
        status: 'reconciled',
        sourceRecords: { legacyJson: 2, custody: 9, metro: 1 },
        uniqueSeeds: 1,
        declaredAssets: 2,
        completedAt: '2026-07-12T12:00:00.000Z',
      })
    );

    const result = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET, MINIBITS_ASSET],
    });

    expect(result).toMatchObject({
      status: 'clean',
      summary: {
        version: 2,
        status: 'reconciled',
        reconciledCustodies: 2,
        retainedCombinedCustodies: 0,
        deferredAssets: [],
      },
    });
    expect(auditLegacyFundedArtifacts({ artifactsRoot })).toMatchObject({
      status: 'clean',
      canRunRequiredAssets: true,
    });
  });

  it('quarantines an inexact managed report without deleting its private recovery', async () => {
    const artifactsRoot = root();
    const legacyPath = writeLegacy(artifactsRoot, [FIRST_SEED]);
    const fake = fakeFactory({
      report: () => ({ assets: [], counterpartyTokens: [] }),
    });

    const result = await recoverLegacyFundedArtifacts({
      artifactsRoot,
      cocod: cocod(),
      assets: [ASSET],
      factory: fake.factory,
    });

    expect(result.status).toBe('deferred');
    expect(existsSync(legacyPath)).toBe(false);
    expect(result.summary?.deferredAssets).toEqual([{ ...ASSET, custodyCount: 1 }]);
    const workEntries = readdirSync(join(artifactsRoot, 'legacy-recovery-work'), {
      recursive: true,
    }).map(String);
    expect(workEntries.some((entry) => entry.endsWith('recovery.json'))).toBe(true);
  });
});
