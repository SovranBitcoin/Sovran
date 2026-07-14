import { describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  establishFundedRecovery,
  openFundedRecovery,
  type CashuRecoveryBackend,
  type CocodBalanceSnapshot,
  type CocodCounterparty,
  type DeclaredRecoveryAsset,
} from './index';

const APP_MNEMONIC =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';
const asset: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.sovran.money',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 100,
};
const TOKEN = 'cashuBdurably-persisted-token';

function balances(amount: number, target = asset): CocodBalanceSnapshot {
  return { [target.mintUrl]: { [target.unit]: amount } };
}

function cocodStub(overrides: Partial<CocodCounterparty> = {}): CocodCounterparty {
  return {
    status: async () => 'UNLOCKED',
    balanceSnapshot: async () => balances(0),
    exactBalance: (snapshot, requestedAsset) =>
      snapshot[requestedAsset.mintUrl]?.[requestedAsset.unit] ?? 0,
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
    ...overrides,
  };
}

function establish(): ReturnType<typeof establishFundedRecovery> {
  return establishFundedRecovery({
    runDir: mkdtempSync(join(tmpdir(), 'sovran-funded-resume-')),
    appMnemonic: APP_MNEMONIC,
    assets: [asset],
  });
}

function initialCashu(): CashuRecoveryBackend {
  return {
    restore: async (requestedAsset) => ({
      asset: requestedAsset,
      totalAmount: 100,
      proofFingerprints: ['initial-proof'],
    }),
    prepareSendAll: async (restored) => ({
      asset: restored.asset,
      token: TOKEN,
      restoredAmount: 100,
      tokenAmount: 98,
      sendFee: 2,
    }),
    inspectToken: async () => {
      throw new Error('unexpected inspectToken');
    },
  };
}

async function leavePreparedRedemption(
  recovery: ReturnType<typeof establish>,
  receiveCashu: CocodCounterparty['receiveCashu'] = async () => {
    throw new Error('simulated cocod interruption');
  },
  expectedError: RegExp = /simulated cocod interruption/
): Promise<void> {
  const cocod = cocodStub({
    balanceSnapshot: async () => balances(10),
    receiveCashu,
  });
  await expect(recovery.reconcile({ cashu: initialCashu(), cocod })).rejects.toThrow(expectedError);
  expect(readFileSync(recovery.custodyPath, 'utf8')).toContain(TOKEN);
}

describe('funded recovery restart reconciliation', () => {
  it('re-redeems an UNSPENT persisted app token and then re-probes the wallet', async () => {
    const recovery = establish();
    await leavePreparedRedemption(recovery);
    const resumed = openFundedRecovery({ runDir: join(recovery.custodyPath, '../..') });
    const inspectToken = mock(async () => ({
      totalAmount: 98,
      unspentAmount: 98,
      pendingAmount: 0,
      spentAmount: 0,
    }));
    const restore = mock(async (requestedAsset: DeclaredRecoveryAsset) => ({
      asset: requestedAsset,
      totalAmount: 0,
      proofFingerprints: [],
    }));
    const cashu: CashuRecoveryBackend = {
      restore,
      prepareSendAll: async () => {
        throw new Error('must resume instead of creating a second token');
      },
      inspectToken,
    };
    const snapshots = [balances(10), balances(108)];
    const receiveCashu = mock(async () => ({ reportedAmount: 98 }));
    const cocod = cocodStub({
      balanceSnapshot: async () => snapshots.shift()!,
      receiveCashu,
    });

    const report = await resumed.reconcile({ cashu, cocod });

    expect(inspectToken).toHaveBeenCalledTimes(1);
    expect(receiveCashu).toHaveBeenCalledWith(TOKEN);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(report.assets[0]).toMatchObject({
      restoredAmount: 100,
      tokenAmount: 98,
      counterpartyDelta: 98,
      sendFee: 2,
      receiveFee: 0,
    });
    expect(readFileSync(resumed.custodyPath, 'utf8')).not.toContain(TOKEN);
  });

  it('recognizes a SPENT token after a receive-side crash without redeeming it twice', async () => {
    const recovery = establish();
    await leavePreparedRedemption(
      recovery,
      async () => {
        throw new Error('transport failed after cocod accepted the token');
      },
      /transport failed after cocod accepted/
    );
    const resumed = openFundedRecovery({ runDir: join(recovery.custodyPath, '../..') });
    const receiveCashu = mock(async () => {
      throw new Error('must not redeem a spent token');
    });
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => ({
        asset: requestedAsset,
        totalAmount: 0,
        proofFingerprints: [],
      }),
      prepareSendAll: async () => {
        throw new Error('must not prepare a second token');
      },
      inspectToken: async () => ({
        totalAmount: 98,
        unspentAmount: 0,
        pendingAmount: 0,
        spentAmount: 98,
      }),
    };
    const cocod = cocodStub({
      balanceSnapshot: async () => balances(108),
      receiveCashu,
    });

    const report = await resumed.reconcile({ cashu, cocod });

    expect(receiveCashu).not.toHaveBeenCalled();
    expect(report.assets[0]?.counterpartyDelta).toBe(98);
    expect(readFileSync(resumed.custodyPath, 'utf8')).not.toContain(TOKEN);
  });

  it('blocks on a PENDING persisted token and keeps its custody intact', async () => {
    const recovery = establish();
    await leavePreparedRedemption(recovery);
    const resumed = openFundedRecovery({ runDir: join(recovery.custodyPath, '../..') });
    const receiveCashu = mock(async () => ({ reportedAmount: 98 }));
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => ({
        asset: requestedAsset,
        totalAmount: 0,
        proofFingerprints: [],
      }),
      prepareSendAll: async () => {
        throw new Error('unexpected prepare');
      },
      inspectToken: async () => ({
        totalAmount: 98,
        unspentAmount: 0,
        pendingAmount: 98,
        spentAmount: 0,
      }),
    };

    await expect(resumed.reconcile({ cashu, cocod: cocodStub({ receiveCashu }) })).rejects.toThrow(
      /PENDING/
    );
    expect(receiveCashu).not.toHaveBeenCalled();
    expect(readFileSync(resumed.custodyPath, 'utf8')).toContain(TOKEN);
  });

  it('does not create another cocod token while an app redemption owns the balance baseline', async () => {
    const recovery = establish();
    await leavePreparedRedemption(recovery);
    const createCashu = mock(async () => ({ token: 'cashuBsecond-token', amount: 10 }));

    await expect(
      recovery.createCounterpartyCashu({
        asset,
        amount: 10,
        cocod: cocodStub({ createCashu }),
      })
    ).rejects.toThrow(/open transfer/);
    expect(createCashu).not.toHaveBeenCalled();
  });

  it('persists a cocod-created token before returning it and redeems it on restart when still UNSPENT', async () => {
    const recovery = establish();
    const createSnapshots = [balances(100), balances(60)];
    const created = await recovery.createCounterpartyCashu({
      asset,
      amount: 40,
      cocod: cocodStub({
        createCashu: async () => ({ token: TOKEN, amount: 40 }),
        balanceSnapshot: async () => {
          const snapshot = createSnapshots.shift()!;
          if (createSnapshots.length === 0) {
            expect(readFileSync(recovery.custodyPath, 'utf8')).toContain(TOKEN);
          }
          return snapshot;
        },
      }),
    });
    expect(created).toEqual({ token: TOKEN, amount: 40 });

    const resumed = openFundedRecovery({ runDir: join(recovery.custodyPath, '../..') });
    const returnSnapshots = [balances(60), balances(100)];
    const receiveCashu = mock(async () => ({ reportedAmount: 40 }));
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => ({
        asset: requestedAsset,
        totalAmount: 0,
        proofFingerprints: [],
      }),
      prepareSendAll: async () => {
        throw new Error('unexpected prepare');
      },
      inspectToken: async () => ({
        totalAmount: 40,
        unspentAmount: 40,
        pendingAmount: 0,
        spentAmount: 0,
      }),
    };
    const report = await resumed.reconcile({
      cashu,
      cocod: cocodStub({
        balanceSnapshot: async () => returnSnapshots.shift()!,
        receiveCashu,
      }),
    });

    expect(receiveCashu).toHaveBeenCalledWith(TOKEN);
    expect(report.counterpartyTokens).toEqual([
      {
        asset,
        tokenAmount: 40,
        counterpartyDelta: 40,
        fee: 0,
        disposition: 'returned',
      },
    ]);
    expect(readFileSync(resumed.custodyPath, 'utf8')).not.toContain(TOKEN);
  });

  it('resumes a counterparty return after cocod accepted the token but the receive call crashed', async () => {
    const recovery = establish();
    const createSnapshots = [balances(100), balances(60)];
    await recovery.createCounterpartyCashu({
      asset,
      amount: 40,
      cocod: cocodStub({
        createCashu: async () => ({ token: TOKEN, amount: 40 }),
        balanceSnapshot: async () => createSnapshots.shift()!,
      }),
    });
    const cashuUnspent: CashuRecoveryBackend = {
      restore: async (requestedAsset) => ({
        asset: requestedAsset,
        totalAmount: 0,
        proofFingerprints: [],
      }),
      prepareSendAll: async () => {
        throw new Error('unexpected prepare');
      },
      inspectToken: async () => ({
        totalAmount: 40,
        unspentAmount: 40,
        pendingAmount: 0,
        spentAmount: 0,
      }),
    };
    await expect(
      recovery.reconcile({
        cashu: cashuUnspent,
        cocod: cocodStub({
          balanceSnapshot: async () => balances(60),
          receiveCashu: async () => {
            throw new Error('return transport failed after acceptance');
          },
        }),
      })
    ).rejects.toThrow(/return transport failed after acceptance/);

    const receiveCashu = mock(async () => ({ reportedAmount: 40 }));
    const cashuSpent: CashuRecoveryBackend = {
      ...cashuUnspent,
      inspectToken: async () => ({
        totalAmount: 40,
        unspentAmount: 0,
        pendingAmount: 0,
        spentAmount: 40,
      }),
    };
    const report = await openFundedRecovery({
      runDir: join(recovery.custodyPath, '../..'),
    }).reconcile({
      cashu: cashuSpent,
      cocod: cocodStub({
        balanceSnapshot: async () => balances(100),
        receiveCashu,
      }),
    });

    expect(receiveCashu).not.toHaveBeenCalled();
    expect(report.counterpartyTokens[0]).toMatchObject({
      tokenAmount: 40,
      counterpartyDelta: 40,
      disposition: 'returned',
    });
  });

  it('classifies a SPENT counterparty token only after its app asset has been swept', async () => {
    const recovery = establish();
    const createSnapshots = [balances(100), balances(60)];
    await recovery.createCounterpartyCashu({
      asset,
      amount: 40,
      cocod: cocodStub({
        createCashu: async () => ({ token: TOKEN, amount: 40 }),
        balanceSnapshot: async () => createSnapshots.shift()!,
      }),
    });
    let restoreCount = 0;
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => {
        restoreCount++;
        return {
          asset: requestedAsset,
          totalAmount: restoreCount === 1 ? 40 : 0,
          proofFingerprints: restoreCount === 1 ? ['received-proof'] : [],
        };
      },
      prepareSendAll: async (restored) => ({
        asset: restored.asset,
        token: 'cashuBapp-sweep-token',
        restoredAmount: 40,
        tokenAmount: 39,
        sendFee: 1,
      }),
      inspectToken: async () => ({
        totalAmount: 40,
        unspentAmount: 0,
        pendingAmount: 0,
        spentAmount: 40,
      }),
    };
    const sweepSnapshots = [balances(60), balances(99)];

    const report = await recovery.reconcile({
      cashu,
      cocod: cocodStub({
        balanceSnapshot: async () => sweepSnapshots.shift()!,
        receiveCashu: async () => ({ reportedAmount: 39 }),
      }),
    });

    expect(report.assets[0]).toMatchObject({ restoredAmount: 40, counterpartyDelta: 39 });
    expect(report.counterpartyTokens[0]).toMatchObject({
      tokenAmount: 40,
      counterpartyDelta: 0,
      disposition: 'spent-by-app',
    });
    expect(readFileSync(recovery.custodyPath, 'utf8')).not.toContain(TOKEN);
    recovery.disposePrivateMaterial();
  });
});

describe('multi-asset funded recovery', () => {
  it('continues reconciling independent assets after one redemption fails', async () => {
    const usdAsset: DeclaredRecoveryAsset = {
      mintUrl: 'https://mint.usd.test',
      unit: 'usd',
      accountIndex: 0,
      maxPrincipal: 100,
    };
    const recovery = establishFundedRecovery({
      runDir: mkdtempSync(join(tmpdir(), 'sovran-funded-multi-')),
      appMnemonic: APP_MNEMONIC,
      assets: [asset, usdAsset],
    });
    const restoreCounts = new Map<string, number>();
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => {
        const count = (restoreCounts.get(requestedAsset.mintUrl) ?? 0) + 1;
        restoreCounts.set(requestedAsset.mintUrl, count);
        return {
          asset: requestedAsset,
          totalAmount: count === 1 ? 50 : 0,
          proofFingerprints: count === 1 ? [`proof-${requestedAsset.unit}`] : [],
        };
      },
      prepareSendAll: async (restored) => ({
        asset: restored.asset,
        token: `cashuBtoken-${restored.asset.unit}`,
        restoredAmount: 50,
        tokenAmount: 49,
        sendFee: 1,
      }),
      inspectToken: async () => {
        throw new Error('unexpected inspect');
      },
    };
    const snapshots = [balances(0), balances(0, usdAsset), balances(49, usdAsset)];
    const receiveCashu = mock(async (token: string) => {
      if (token.endsWith('-sat')) throw new Error('sat redemption failed');
      return { reportedAmount: 49 };
    });
    const cocod = cocodStub({
      balanceSnapshot: async () => snapshots.shift()!,
      receiveCashu,
    });

    await expect(recovery.reconcile({ cashu, cocod })).rejects.toThrow(/incomplete/);

    expect(receiveCashu).toHaveBeenCalledTimes(2);
    const custody = JSON.parse(readFileSync(recovery.custodyPath, 'utf8')) as {
      assetReconciliations: { asset: DeclaredRecoveryAsset }[];
      redemptions: { asset: DeclaredRecoveryAsset; phase: string }[];
    };
    expect(custody.assetReconciliations.map(({ asset: item }) => item.unit)).toEqual(['usd']);
    expect(custody.redemptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asset: expect.objectContaining({ unit: 'sat' }),
          phase: 'prepared',
        }),
        expect.objectContaining({
          asset: expect.objectContaining({ unit: 'usd' }),
          phase: 'reconciled',
        }),
      ])
    );
  });

  it('detects duplicate proof secrets across assets before preparing either send', async () => {
    const secondAsset: DeclaredRecoveryAsset = {
      mintUrl: 'https://second.mint.test',
      unit: 'sat',
      accountIndex: 0,
      maxPrincipal: 100,
    };
    const recovery = establishFundedRecovery({
      runDir: mkdtempSync(join(tmpdir(), 'sovran-funded-duplicate-')),
      appMnemonic: APP_MNEMONIC,
      assets: [asset, secondAsset],
    });
    const prepareSendAll = mock(async () => {
      throw new Error('must not prepare after an incomplete global scan');
    });
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => ({
        asset: requestedAsset,
        totalAmount: 10,
        proofFingerprints: ['same-secret-fingerprint'],
      }),
      prepareSendAll,
      inspectToken: async () => {
        throw new Error('unexpected inspect');
      },
    };

    await expect(recovery.reconcile({ cashu, cocod: cocodStub() })).rejects.toThrow(
      /duplicate proof secret/
    );
    expect(prepareSendAll).not.toHaveBeenCalled();
  });
});
