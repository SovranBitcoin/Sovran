import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveSovranAccount0CashuSeed,
  establishFundedRecovery,
  generateControlledP2PKKeypair,
  openFundedRecovery,
  type CashuRecoveryBackend,
  type CocodBalanceSnapshot,
  type CocodCounterparty,
} from './index';

const APP_MNEMONIC =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';
const ACCOUNT_0_SEED_HEX =
  '1a1721f6118d4acf240ed1674d9f26ab3f504fe2ea9c95741f98b344eacb18421d87ad400927a43369409638272adccd538a96632c1d0858c471ba01183886f0';

const asset = {
  mintUrl: 'https://mint.sovran.money',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 100,
} as const;

describe('funded recovery custody', () => {
  it('derives the exact Sovran account-0 Cashu seed from the app mnemonic', () => {
    expect(Buffer.from(deriveSovranAccount0CashuSeed(APP_MNEMONIC)).toString('hex')).toBe(
      ACCOUNT_0_SEED_HEX
    );
  });

  it('establishes mode-0600 recovery custody that can be reopened without the mnemonic', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-recovery-'));
    const established = establishFundedRecovery({
      runDir,
      appMnemonic: APP_MNEMONIC,
      assets: [asset],
    });

    expect(statSync(established.custodyPath).mode & 0o777).toBe(0o600);
    expect(established.assets).toEqual([asset]);

    const reopened = openFundedRecovery({ runDir });
    expect(reopened.custodyPath).toBe(established.custodyPath);
    expect(reopened.assets).toEqual([asset]);
  });

  it('rejects non-account-0 and duplicate asset declarations before writing custody', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-recovery-'));
    expect(() =>
      establishFundedRecovery({
        runDir,
        appMnemonic: APP_MNEMONIC,
        assets: [{ ...asset, accountIndex: 1 as 0 }],
      })
    ).toThrow(/account 0/);

    expect(() =>
      establishFundedRecovery({
        runDir,
        appMnemonic: APP_MNEMONIC,
        assets: [asset, asset],
      })
    ).toThrow(/duplicate asset/);
  });

  it('keeps an optional controlled P2PK private key in custody and exposes only its 02-prefixed public key', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-recovery-'));
    const keypair = generateControlledP2PKKeypair();
    const established = establishFundedRecovery({
      runDir,
      appMnemonic: APP_MNEMONIC,
      assets: [asset],
      p2pkPrivateKey: keypair.privateKey,
    });

    expect(keypair.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keypair.publicKey).toMatch(/^02[0-9a-f]{64}$/);
    expect(established.controlledP2PKPublicKey).toBe(keypair.publicKey);
    expect(openFundedRecovery({ runDir }).controlledP2PKPublicKey).toBe(keypair.publicKey);
  });

  it('inspects an app token through the same exact-asset seed custody before redemption', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-recovery-'));
    const recovery = establishFundedRecovery({
      runDir,
      appMnemonic: APP_MNEMONIC,
      assets: [asset],
    });
    let inspected = false;
    const cashu: CashuRecoveryBackend = {
      restore: async () => {
        throw new Error('not used');
      },
      prepareSendAll: async () => {
        throw new Error('not used');
      },
      inspectToken: async (requestedAsset, token, seed) => {
        inspected = true;
        expect(requestedAsset).toEqual(asset);
        expect(token).toBe('cashuAtest-token');
        expect(Buffer.from(seed).toString('hex')).toBe(ACCOUNT_0_SEED_HEX);
        return {
          totalAmount: 40,
          unspentAmount: 40,
          pendingAmount: 0,
          spentAmount: 0,
        };
      },
    };

    await expect(
      recovery.inspectCashuToken({ asset, token: 'cashuAtest-token', cashu })
    ).resolves.toEqual({
      totalAmount: 40,
      unspentAmount: 40,
      pendingAmount: 0,
      spentAmount: 0,
    });
    expect(inspected).toBe(true);
  });
});

function balances(amount: number, mintUrl = asset.mintUrl): CocodBalanceSnapshot {
  return { [mintUrl]: { sat: amount } };
}

describe('funded recovery reconciliation', () => {
  it('keeps an unexplained empty scan retryable until the caller proves it is terminal', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-recovery-'));
    const recovery = establishFundedRecovery({
      runDir,
      appMnemonic: APP_MNEMONIC,
      assets: [asset],
    });
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset) => ({
        asset: requestedAsset,
        totalAmount: 0,
        proofFingerprints: [],
      }),
      prepareSendAll: async () => {
        throw new Error('empty recovery must not prepare a token');
      },
      inspectToken: async () => {
        throw new Error('empty recovery has no token to inspect');
      },
    };
    const cocod: CocodCounterparty = {
      status: async () => 'UNLOCKED',
      balanceSnapshot: async () => balances(0),
      exactBalance: () => 0,
      createCashu: async () => {
        throw new Error('not used');
      },
      receiveCashu: async () => {
        throw new Error('not used');
      },
      createBolt11: async () => {
        throw new Error('not used');
      },
      payBolt11: async () => {
        throw new Error('not used');
      },
      npcAddress: async () => {
        throw new Error('not used');
      },
    };

    expect((await recovery.reconcile({ cashu, cocod })).assets).toEqual([
      expect.objectContaining({ asset, restoredAmount: 0 }),
    ]);
    expect(JSON.parse(readFileSync(recovery.custodyPath, 'utf8')).assetReconciliations).toEqual([]);
    expect(() => recovery.disposePrivateMaterial()).toThrow(/every asset is reconciled/);

    await recovery.reconcile({ cashu, cocod, acceptEmptyAssets: [asset] });
    recovery.disposePrivateMaterial();
    expect(existsSync(recovery.custodyPath)).toBe(false);
  });

  it('persists the send-all token before cocod redemption, re-probes zero, and reconciles exact amounts', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-recovery-'));
    const recovery = establishFundedRecovery({
      runDir,
      appMnemonic: APP_MNEMONIC,
      assets: [asset],
    });
    let restoreCount = 0;
    const cashu: CashuRecoveryBackend = {
      restore: async (requestedAsset, _seed, counters) => {
        await counters.advanceToAtLeast('keyset-1', 9);
        restoreCount++;
        return restoreCount === 1
          ? {
              asset: requestedAsset,
              totalAmount: 100,
              proofFingerprints: ['proof-fingerprint'],
            }
          : { asset: requestedAsset, totalAmount: 0, proofFingerprints: [] };
      },
      prepareSendAll: async (restored, options) => {
        expect(options?.p2pkPrivateKey).toBeUndefined();
        return {
          asset: restored.asset,
          token: 'cashuBpersist-before-redeem',
          restoredAmount: 100,
          tokenAmount: 98,
          sendFee: 2,
        };
      },
      inspectToken: async () => {
        throw new Error('new token should not need pre-redeem inspection');
      },
    };
    const snapshots = [balances(10), balances(108)];
    const cocod: CocodCounterparty = {
      status: async () => 'UNLOCKED',
      balanceSnapshot: async () => snapshots.shift()!,
      exactBalance: (snapshot, requestedAsset) =>
        snapshot[requestedAsset.mintUrl]?.[requestedAsset.unit] ?? 0,
      createCashu: async () => {
        throw new Error('not used');
      },
      receiveCashu: async (token) => {
        const persisted = readFileSync(recovery.custodyPath, 'utf8');
        expect(persisted).toContain(token);
        return { reportedAmount: 98 };
      },
      createBolt11: async () => {
        throw new Error('not used');
      },
      payBolt11: async () => {
        throw new Error('not used');
      },
      npcAddress: async () => {
        throw new Error('not used');
      },
    };

    const report = await recovery.reconcile({ cashu, cocod });

    expect(report.assets).toEqual([
      {
        asset,
        restoredAmount: 100,
        tokenAmount: 98,
        counterpartyDelta: 98,
        sendFee: 2,
        receiveFee: 0,
        residualAmount: 0,
      },
    ]);
    expect(restoreCount).toBe(2);
    expect(readFileSync(recovery.custodyPath, 'utf8')).not.toContain('cashuBpersist-before-redeem');

    recovery.disposePrivateMaterial();
    expect(existsSync(recovery.custodyPath)).toBe(false);
  });
});
