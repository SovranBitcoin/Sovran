import { createHash, randomUUID } from 'node:crypto';

import {
  createCashuTsRecoveryBackend,
  type CashuRecoveryBackend,
  type InspectedCashuToken,
  type RecoveredCashuAsset,
} from './cashu';
import type { CocodCounterparty } from './cocod';
import {
  assetIdentity,
  RecoveryCustody,
  type CustodyCounterpartyToken,
  type CustodyRecord,
  type CustodyRedemption,
} from './custody';
import { deriveSovranAccount0CashuSeed } from './derivation';
import { controlledP2PKPublicKey } from './p2pk';
import { isValuelessTestMint } from './test-mints';
import type {
  AssetReconciliation,
  CounterpartyTokenReconciliation,
  DeclaredRecoveryAsset,
  FundedRecoveryReport,
  RestorePolicy,
} from './types';

const tokenFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

function assertSafeAmount(amount: number, context: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${context} is outside the safe amount range`);
  }
}

function assertTokenIntegrity(token: string, fingerprint: string): void {
  if (tokenFingerprint(token) !== fingerprint) {
    throw new Error('durable Cashu token fingerprint mismatch');
  }
}

function assertTerminalTokenState(
  inspected: InspectedCashuToken,
  expectedAmount: number
): 'UNSPENT' | 'SPENT' {
  if (inspected.totalAmount !== expectedAmount) {
    throw new Error('persisted Cashu token amount does not match custody');
  }
  if (inspected.pendingAmount > 0) {
    throw new Error('persisted Cashu token is PENDING');
  }
  if (inspected.unspentAmount === expectedAmount && inspected.spentAmount === 0) {
    return 'UNSPENT';
  }
  if (inspected.spentAmount === expectedAmount && inspected.unspentAmount === 0) {
    return 'SPENT';
  }
  throw new Error('persisted Cashu token has mixed or incomplete proof states');
}

function emptyReconciliation(asset: DeclaredRecoveryAsset): AssetReconciliation {
  return {
    asset,
    restoredAmount: 0,
    tokenAmount: 0,
    counterpartyDelta: 0,
    sendFee: 0,
    receiveFee: 0,
    residualAmount: 0,
  };
}

function upsertAssetReconciliation(
  record: CustodyRecord,
  reconciliation: AssetReconciliation
): void {
  const id = assetIdentity(reconciliation.asset);
  const index = record.assetReconciliations.findIndex(
    (candidate) => assetIdentity(candidate.asset) === id
  );
  if (index === -1) record.assetReconciliations.push(reconciliation);
  else record.assetReconciliations[index] = reconciliation;
}

function reconciliationReport(record: CustodyRecord): FundedRecoveryReport {
  const reconciliations = new Map(
    record.assetReconciliations.map((reconciliation) => [
      assetIdentity(reconciliation.asset),
      reconciliation,
    ])
  );
  const assets = record.assets.flatMap((asset) => {
    const reconciliation = reconciliations.get(assetIdentity(asset));
    return reconciliation ? [reconciliation] : [];
  });
  const counterpartyTokens = record.counterpartyTokens.flatMap(
    (entry): CounterpartyTokenReconciliation[] => {
      if (entry.phase !== 'reconciled' || !entry.disposition) return [];
      const counterpartyDelta = entry.counterpartyDelta ?? 0;
      const fee = (entry.creationFee ?? 0) + (entry.returnFee ?? 0);
      return [
        {
          asset: entry.asset,
          tokenAmount: entry.amount,
          counterpartyDelta,
          fee,
          disposition: entry.disposition,
        },
      ];
    }
  );
  return { assets, counterpartyTokens };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown recovery error';
  return message
    .replace(/cashu[AB][A-Za-z0-9_-]+/g, '[redacted Cashu token]')
    .replace(/ln(?:bc|tb|bcrt)[a-z0-9]+/gi, '[redacted BOLT11 invoice]');
}

export class FundedRecovery {
  readonly #custody: RecoveryCustody;

  constructor(custody: RecoveryCustody) {
    this.#custody = custody;
  }

  get custodyPath(): string {
    return this.#custody.path;
  }

  get assets(): DeclaredRecoveryAsset[] {
    return this.#custody.snapshot().assets;
  }

  get controlledP2PKPublicKey(): string | undefined {
    const privateKey = this.#custody.snapshot().p2pkPrivateKey;
    return privateKey ? controlledP2PKPublicKey(privateKey) : undefined;
  }

  /** Inspect an app-created bearer token before any counterparty consumes it.
   * This is read-only at the mint and binds mint, unit, amount, and NUT-07
   * state to the same seed/counter custody used by crash recovery. */
  async inspectCashuToken(options: {
    asset: DeclaredRecoveryAsset;
    token: string;
    cashu?: CashuRecoveryBackend;
  }): Promise<InspectedCashuToken> {
    return this.#custody.runExclusive('inspect app Cashu token', async () => {
      const snapshot = this.#custody.snapshot();
      const asset = this.#declaredAsset(snapshot, options.asset);
      const seed = deriveSovranAccount0CashuSeed(snapshot.appMnemonic);
      try {
        return await (options.cashu ?? createCashuTsRecoveryBackend()).inspectToken(
          asset,
          options.token,
          seed,
          this.#custody.counterSource(asset)
        );
      } finally {
        seed.fill(0);
      }
    });
  }

  async createCounterpartyCashu(options: {
    asset: DeclaredRecoveryAsset;
    amount: number;
    cocod: CocodCounterparty;
  }): Promise<{ token: string; amount: number }> {
    return this.#custody.runExclusive('create counterparty Cashu token', async () => {
      const snapshot = this.#custody.snapshot();
      const asset = this.#declaredAsset(snapshot, options.asset);
      const id = assetIdentity(asset);
      if (
        snapshot.redemptions.some(
          (entry) => entry.phase !== 'reconciled' && assetIdentity(entry.asset) === id
        ) ||
        snapshot.counterpartyTokens.some(
          (entry) =>
            (entry.phase === 'returning' || entry.phase === 'returned') &&
            assetIdentity(entry.asset) === id
        )
      ) {
        throw new Error('cannot change cocod balance while this asset has an open transfer');
      }
      assertSafeAmount(options.amount, 'counterparty Cashu amount');
      if (options.amount <= 0 || options.amount > asset.maxPrincipal) {
        throw new Error('counterparty Cashu amount exceeds the declared asset principal');
      }
      await this.#assertUnlocked(options.cocod);
      const beforeSnapshot = await options.cocod.balanceSnapshot();
      const beforeBalance = options.cocod.exactBalance(beforeSnapshot, asset);
      const created = await options.cocod.createCashu(asset, options.amount);
      if (!/^cashu[AB][A-Za-z0-9_-]+$/.test(created.token)) {
        throw new Error('cocod returned an invalid Cashu token');
      }

      // The token is durable before any validation or later balance call can
      // throw and before the caller can hand it to the simulator.
      const tokenId = randomUUID();
      this.#custody.update((record) => {
        record.counterpartyTokens.push({
          id: tokenId,
          asset,
          phase: 'prepared',
          token: created.token,
          tokenFingerprint: tokenFingerprint(created.token),
          amount: options.amount,
          beforeBalance,
        });
        record.assetReconciliations = record.assetReconciliations.filter(
          (entry) => assetIdentity(entry.asset) !== assetIdentity(asset)
        );
      });

      if (created.amount !== options.amount) {
        throw new Error('cocod created a token for a different amount');
      }
      const afterSnapshot = await options.cocod.balanceSnapshot();
      const afterCreateBalance = options.cocod.exactBalance(afterSnapshot, asset);
      const debitedAmount = beforeBalance - afterCreateBalance;
      this.#custody.update((record) => {
        const entry = record.counterpartyTokens.find((candidate) => candidate.id === tokenId);
        if (!entry) throw new Error('durable counterparty token record disappeared');
        entry.afterCreateBalance = afterCreateBalance;
        if (debitedAmount >= 0) entry.debitedAmount = debitedAmount;
        if (debitedAmount >= options.amount) entry.creationFee = debitedAmount - options.amount;
      });
      if (debitedAmount < options.amount) {
        throw new Error('cocod balance did not reconcile the created Cashu token');
      }
      return created;
    });
  }

  async reconcile(dependencies: {
    cashu?: CashuRecoveryBackend;
    cocod: CocodCounterparty;
    /** Empty scans are retryable by default. Callers may terminalize an empty
     * asset only after independently proving that no funding effect occurred or
     * that observed outflows consumed its full declared principal. */
    acceptEmptyAssets?: readonly DeclaredRecoveryAsset[];
  }): Promise<FundedRecoveryReport> {
    return this.#custody.runExclusive('reconcile funded recovery', async () => {
      const cashu = dependencies.cashu ?? createCashuTsRecoveryBackend();
      const initial = this.#custody.snapshot();
      const acceptedEmptyAssets = new Set<string>();
      for (const requested of dependencies.acceptEmptyAssets ?? []) {
        const declared = this.#declaredAsset(initial, requested);
        const id = assetIdentity(declared);
        if (acceptedEmptyAssets.has(id)) {
          throw new Error('duplicate accepted empty recovery asset');
        }
        acceptedEmptyAssets.add(id);
      }
      const seed = deriveSovranAccount0CashuSeed(initial.appMnemonic);
      const errors: Error[] = [];
      const blockedAssets = new Set<string>();
      const retryableEmptyAssets: AssetReconciliation[] = [];
      try {
        for (const redemption of initial.redemptions) {
          if (redemption.phase === 'reconciled') continue;
          try {
            await this.#resumeRedemption(
              redemption,
              cashu,
              dependencies.cocod,
              seed,
              initial.restore
            );
          } catch (error) {
            blockedAssets.add(assetIdentity(redemption.asset));
            errors.push(new Error(`resume ${redemption.asset.unit}: ${errorMessage(error)}`));
          }
        }

        for (const token of this.#custody.snapshot().counterpartyTokens) {
          if (token.phase === 'reconciled' || token.phase === 'spent') continue;
          // Valueless test-mint tokens need no inspection or return — the
          // asset's principal is written off by the caller either way.
          if (isValuelessTestMint(token.asset.mintUrl)) continue;
          try {
            await this.#reconcileCounterpartyToken(token, cashu, dependencies.cocod, seed);
          } catch (error) {
            blockedAssets.add(assetIdentity(token.asset));
            errors.push(new Error(`counterparty ${token.asset.unit}: ${errorMessage(error)}`));
          }
        }

        const beforeScan = this.#custody.snapshot();
        const reconciledAssets = new Set(
          beforeScan.assetReconciliations.map(({ asset }) => assetIdentity(asset))
        );
        const openRedemptionAssets = new Set(
          beforeScan.redemptions
            .filter(({ phase }) => phase !== 'reconciled')
            .map(({ asset }) => assetIdentity(asset))
        );
        const recovered: RecoveredCashuAsset[] = [];
        const fingerprints = new Set<string>();
        let scanFailed = false;

        for (const asset of beforeScan.assets) {
          const id = assetIdentity(asset);
          if (reconciledAssets.has(id) || openRedemptionAssets.has(id) || blockedAssets.has(id)) {
            continue;
          }
          // Valueless test mints are outside the custody guarantee: never
          // scan or sweep them — callers write the principal off instead.
          if (isValuelessTestMint(asset.mintUrl)) {
            this.#custody.markAssetReconciled(emptyReconciliation(asset));
            continue;
          }
          try {
            const recovery = await cashu.restore(
              asset,
              seed,
              this.#custody.counterSource(asset),
              beforeScan.restore
            );
            this.#assertRecovery(asset, recovery);
            for (const fingerprint of recovery.proofFingerprints) {
              if (fingerprints.has(fingerprint)) {
                throw new Error('duplicate proof secret found across declared assets');
              }
              fingerprints.add(fingerprint);
            }
            recovered.push(recovery);
          } catch (error) {
            scanFailed = true;
            blockedAssets.add(id);
            errors.push(new Error(`scan ${asset.unit}: ${errorMessage(error)}`));
          }
        }

        // No new value-moving effects start unless every eligible asset was
        // successfully scanned, so cross-asset duplicate detection is complete.
        if (!scanFailed) {
          for (const recovery of recovered) {
            try {
              if (recovery.totalAmount === 0) {
                const returnedPrincipal = this.#custody
                  .snapshot()
                  .counterpartyTokens.filter(
                    (entry) =>
                      assetIdentity(entry.asset) === assetIdentity(recovery.asset) &&
                      entry.phase === 'reconciled' &&
                      entry.disposition === 'returned'
                  )
                  .reduce((sum, entry) => sum + entry.amount, 0);
                const empty = emptyReconciliation(recovery.asset);
                if (
                  acceptedEmptyAssets.has(assetIdentity(recovery.asset)) ||
                  returnedPrincipal > 0
                ) {
                  this.#custody.markAssetReconciled(empty);
                } else {
                  retryableEmptyAssets.push(empty);
                }
              } else {
                await this.#redeemRecovered(
                  recovery,
                  cashu,
                  dependencies.cocod,
                  initial.p2pkPrivateKey,
                  seed,
                  initial.restore
                );
              }
            } catch (error) {
              blockedAssets.add(assetIdentity(recovery.asset));
              errors.push(new Error(`redeem ${recovery.asset.unit}: ${errorMessage(error)}`));
            }
          }
        }

        this.#finalizeSpentCounterpartyTokens();
        const report = reconciliationReport(this.#custody.snapshot());
        for (const empty of retryableEmptyAssets) {
          if (
            !report.assets.some(({ asset }) => assetIdentity(asset) === assetIdentity(empty.asset))
          ) {
            report.assets.push(empty);
          }
        }
        if (errors.length > 0) {
          throw new Error(
            `funded recovery incomplete (${errors.length} operation${
              errors.length === 1 ? '' : 's'
            }): ${errors.map(({ message }) => message).join('; ')}`
          );
        }
        return report;
      } finally {
        seed.fill(0);
      }
    });
  }

  async #resumeRedemption(
    redemption: CustodyRedemption,
    cashu: CashuRecoveryBackend,
    cocod: CocodCounterparty,
    seed: Uint8Array,
    restore: RestorePolicy
  ): Promise<void> {
    const token = redemption.token;
    if (!token) throw new Error('unfinished redemption is missing its durable token');
    assertTokenIntegrity(token, redemption.tokenFingerprint);
    const inspected = await cashu.inspectToken(
      redemption.asset,
      token,
      seed,
      this.#custody.counterSource(redemption.asset)
    );
    const tokenState = assertTerminalTokenState(inspected, redemption.tokenAmount);

    let afterBalance = redemption.afterBalance;
    let counterpartyDelta = redemption.counterpartyDelta;
    let receiveFee = redemption.receiveFee;
    if (redemption.phase === 'prepared') {
      if (tokenState === 'UNSPENT') {
        await this.#assertUnlocked(cocod);
        const currentSnapshot = await cocod.balanceSnapshot();
        const currentBalance = cocod.exactBalance(currentSnapshot, redemption.asset);
        if (currentBalance !== redemption.beforeBalance) {
          throw new Error('cocod balance changed before persisted token retry');
        }
        const received = await cocod.receiveCashu(token);
        if (received.reportedAmount !== redemption.tokenAmount) {
          throw new Error('cocod reported a different Cashu token amount');
        }
        const afterSnapshot = await cocod.balanceSnapshot();
        afterBalance = cocod.exactBalance(afterSnapshot, redemption.asset);
      } else {
        const afterSnapshot = await cocod.balanceSnapshot();
        afterBalance = cocod.exactBalance(afterSnapshot, redemption.asset);
      }
      counterpartyDelta = afterBalance - redemption.beforeBalance;
      if (counterpartyDelta <= 0 || counterpartyDelta > redemption.tokenAmount) {
        throw new Error('cocod balance delta cannot reconcile the persisted token');
      }
      receiveFee = redemption.tokenAmount - counterpartyDelta;
      this.#custody.update((record) => {
        const entry = record.redemptions.find(({ id }) => id === redemption.id);
        if (!entry) throw new Error('durable redemption record disappeared');
        entry.phase = 'received';
        entry.afterBalance = afterBalance;
        entry.counterpartyDelta = counterpartyDelta;
        entry.receiveFee = receiveFee;
      });
    } else if (redemption.phase === 'received' && tokenState !== 'SPENT') {
      throw new Error('received Cashu token is unexpectedly still UNSPENT');
    }

    if (afterBalance === undefined || counterpartyDelta === undefined || receiveFee === undefined) {
      throw new Error('received redemption is missing exact reconciliation values');
    }
    await this.#finishRedemption(redemption, cashu, seed, restore, counterpartyDelta, receiveFee);
  }

  async #redeemRecovered(
    recovery: RecoveredCashuAsset,
    cashu: CashuRecoveryBackend,
    cocod: CocodCounterparty,
    p2pkPrivateKey: string | undefined,
    seed: Uint8Array,
    restore: RestorePolicy
  ): Promise<void> {
    await this.#assertUnlocked(cocod);
    const beforeSnapshot = await cocod.balanceSnapshot();
    const beforeBalance = cocod.exactBalance(beforeSnapshot, recovery.asset);
    const prepared = await cashu.prepareSendAll(recovery, {
      ...(p2pkPrivateKey ? { p2pkPrivateKey } : {}),
    });
    if (!/^cashu[AB][A-Za-z0-9_-]+$/.test(prepared.token)) {
      throw new Error('Cashu backend returned an invalid send-all token');
    }
    assertSafeAmount(prepared.tokenAmount, 'send-all token amount');
    if (prepared.tokenAmount <= 0 || prepared.tokenAmount > recovery.totalAmount) {
      throw new Error('Cashu send-all returned an invalid token amount');
    }

    const redemptionId = randomUUID();
    const durableRedemption: CustodyRedemption = {
      id: redemptionId,
      asset: recovery.asset,
      phase: 'prepared',
      token: prepared.token,
      tokenFingerprint: tokenFingerprint(prepared.token),
      restoredAmount: recovery.totalAmount,
      tokenAmount: prepared.tokenAmount,
      sendFee: recovery.totalAmount - prepared.tokenAmount,
      beforeBalance,
    };
    this.#custody.update((record) => {
      record.redemptions.push(durableRedemption);
    });

    if (
      assetIdentity(prepared.asset) !== assetIdentity(recovery.asset) ||
      prepared.restoredAmount !== recovery.totalAmount ||
      prepared.sendFee !== durableRedemption.sendFee
    ) {
      throw new Error('Cashu send-all result violated exact asset conservation');
    }
    await this.#assertUnlocked(cocod);
    const received = await cocod.receiveCashu(prepared.token);
    if (received.reportedAmount !== prepared.tokenAmount) {
      throw new Error('cocod reported a different Cashu token amount');
    }
    const afterSnapshot = await cocod.balanceSnapshot();
    const afterBalance = cocod.exactBalance(afterSnapshot, recovery.asset);
    const counterpartyDelta = afterBalance - beforeBalance;
    if (counterpartyDelta <= 0 || counterpartyDelta > prepared.tokenAmount) {
      throw new Error('cocod balance delta cannot reconcile the redeemed token');
    }
    const receiveFee = prepared.tokenAmount - counterpartyDelta;
    this.#custody.update((record) => {
      const redemption = record.redemptions.find(({ id }) => id === redemptionId);
      if (!redemption) throw new Error('durable redemption record disappeared');
      redemption.phase = 'received';
      redemption.reportedAmount = received.reportedAmount;
      redemption.afterBalance = afterBalance;
      redemption.counterpartyDelta = counterpartyDelta;
      redemption.receiveFee = receiveFee;
    });
    await this.#finishRedemption(
      durableRedemption,
      cashu,
      seed,
      restore,
      counterpartyDelta,
      receiveFee
    );
  }

  async #finishRedemption(
    redemption: CustodyRedemption,
    cashu: CashuRecoveryBackend,
    seed: Uint8Array,
    restore: RestorePolicy,
    counterpartyDelta: number,
    receiveFee: number
  ): Promise<void> {
    const reprobe = await cashu.restore(
      redemption.asset,
      seed,
      this.#custody.counterSource(redemption.asset),
      restore
    );
    this.#assertRecovery(redemption.asset, reprobe);
    if (reprobe.totalAmount !== 0 || reprobe.proofFingerprints.length !== 0) {
      throw new Error('post-redemption Cashu re-probe found a non-zero residual');
    }
    const reconciliation: AssetReconciliation = {
      asset: redemption.asset,
      restoredAmount: redemption.restoredAmount,
      tokenAmount: redemption.tokenAmount,
      counterpartyDelta,
      sendFee: redemption.sendFee,
      receiveFee,
      residualAmount: 0,
    };
    if (
      reconciliation.restoredAmount !==
      reconciliation.counterpartyDelta + reconciliation.sendFee + reconciliation.receiveFee
    ) {
      throw new Error('funded recovery failed exact amount conservation');
    }
    this.#custody.update((record) => {
      const entry = record.redemptions.find(({ id }) => id === redemption.id);
      if (!entry) throw new Error('durable redemption record disappeared');
      entry.phase = 'reconciled';
      delete entry.token;
      upsertAssetReconciliation(record, reconciliation);
    });
  }

  async #reconcileCounterpartyToken(
    tokenRecord: CustodyCounterpartyToken,
    cashu: CashuRecoveryBackend,
    cocod: CocodCounterparty,
    seed: Uint8Array
  ): Promise<void> {
    if (tokenRecord.phase === 'returned') {
      this.#finishReturnedCounterpartyToken(tokenRecord.id);
      return;
    }
    const token = tokenRecord.token;
    if (!token) throw new Error('open counterparty token is missing its durable token');
    assertTokenIntegrity(token, tokenRecord.tokenFingerprint);
    const inspected = await cashu.inspectToken(
      tokenRecord.asset,
      token,
      seed,
      this.#custody.counterSource(tokenRecord.asset)
    );
    const tokenState = assertTerminalTokenState(inspected, tokenRecord.amount);

    if (tokenState === 'SPENT' && tokenRecord.phase === 'prepared') {
      this.#custody.update((record) => {
        const entry = record.counterpartyTokens.find(({ id }) => id === tokenRecord.id);
        if (!entry) throw new Error('durable counterparty token record disappeared');
        entry.phase = 'spent';
        entry.disposition = 'spent-by-app';
      });
      return;
    }

    let returnBeforeBalance = tokenRecord.returnBeforeBalance;
    const retryingReturn = tokenRecord.phase === 'returning';
    if (tokenRecord.phase === 'prepared') {
      if (tokenState !== 'UNSPENT') {
        throw new Error('prepared counterparty token has an invalid terminal state');
      }
      await this.#assertUnlocked(cocod);
      const beforeSnapshot = await cocod.balanceSnapshot();
      returnBeforeBalance = cocod.exactBalance(beforeSnapshot, tokenRecord.asset);
      this.#custody.update((record) => {
        const entry = record.counterpartyTokens.find(({ id }) => id === tokenRecord.id);
        if (!entry) throw new Error('durable counterparty token record disappeared');
        entry.phase = 'returning';
        entry.returnBeforeBalance = returnBeforeBalance;
      });
    }
    if (returnBeforeBalance === undefined) {
      throw new Error('returning counterparty token is missing its balance checkpoint');
    }

    let returnAfterBalance: number;
    let reportedAmount: number | undefined;
    if (tokenState === 'UNSPENT') {
      if (retryingReturn) {
        const currentSnapshot = await cocod.balanceSnapshot();
        const currentBalance = cocod.exactBalance(currentSnapshot, tokenRecord.asset);
        if (currentBalance !== returnBeforeBalance) {
          throw new Error('cocod balance changed before counterparty token retry');
        }
      }
      const received = await cocod.receiveCashu(token);
      reportedAmount = received.reportedAmount;
      if (reportedAmount !== tokenRecord.amount) {
        throw new Error('cocod reported a different counterparty token amount');
      }
      const afterSnapshot = await cocod.balanceSnapshot();
      returnAfterBalance = cocod.exactBalance(afterSnapshot, tokenRecord.asset);
    } else {
      const afterSnapshot = await cocod.balanceSnapshot();
      returnAfterBalance = cocod.exactBalance(afterSnapshot, tokenRecord.asset);
    }
    const counterpartyDelta = returnAfterBalance - returnBeforeBalance;
    if (counterpartyDelta <= 0 || counterpartyDelta > tokenRecord.amount) {
      throw new Error('cocod balance delta cannot reconcile the counterparty token');
    }
    const returnFee = tokenRecord.amount - counterpartyDelta;
    this.#custody.update((record) => {
      const entry = record.counterpartyTokens.find(({ id }) => id === tokenRecord.id);
      if (!entry) throw new Error('durable counterparty token record disappeared');
      entry.phase = 'returned';
      entry.returnAfterBalance = returnAfterBalance;
      if (reportedAmount !== undefined) entry.reportedAmount = reportedAmount;
      entry.counterpartyDelta = counterpartyDelta;
      entry.returnFee = returnFee;
      entry.disposition = 'returned';
    });
    this.#finishReturnedCounterpartyToken(tokenRecord.id);
  }

  #finishReturnedCounterpartyToken(id: string): void {
    this.#custody.update((record) => {
      const entry = record.counterpartyTokens.find((candidate) => candidate.id === id);
      if (!entry) throw new Error('durable counterparty token record disappeared');
      if (
        entry.phase !== 'returned' ||
        entry.counterpartyDelta === undefined ||
        entry.returnFee === undefined ||
        entry.disposition !== 'returned'
      ) {
        throw new Error('counterparty return lacks exact reconciliation values');
      }
      entry.phase = 'reconciled';
      delete entry.token;
    });
  }

  #finalizeSpentCounterpartyTokens(): void {
    this.#custody.update((record) => {
      const reconciledAssets = new Set(
        record.assetReconciliations.map(({ asset }) => assetIdentity(asset))
      );
      for (const entry of record.counterpartyTokens) {
        if (
          entry.phase === 'spent' &&
          reconciledAssets.has(assetIdentity(entry.asset)) &&
          entry.disposition === 'spent-by-app'
        ) {
          entry.phase = 'reconciled';
          delete entry.token;
        }
      }
    });
  }

  #assertRecovery(asset: DeclaredRecoveryAsset, recovery: RecoveredCashuAsset): void {
    if (assetIdentity(recovery.asset) !== assetIdentity(asset)) {
      throw new Error('Cashu backend returned recovery for the wrong asset');
    }
    assertSafeAmount(recovery.totalAmount, 'restored amount');
    if (recovery.totalAmount > asset.maxPrincipal) {
      throw new Error('restored value exceeds the declared asset principal');
    }
  }

  #declaredAsset(record: CustodyRecord, requested: DeclaredRecoveryAsset): DeclaredRecoveryAsset {
    const id = assetIdentity(requested);
    const declared = record.assets.find((asset) => assetIdentity(asset) === id);
    if (!declared || declared.maxPrincipal !== requested.maxPrincipal) {
      throw new Error('counterparty operation requested an undeclared recovery asset');
    }
    return declared;
  }

  async #assertUnlocked(cocod: CocodCounterparty): Promise<void> {
    if ((await cocod.status()) !== 'UNLOCKED') {
      throw new Error('cocod must be UNLOCKED before a funded value operation');
    }
  }

  disposePrivateMaterial(): void {
    this.#custody.disposePrivateMaterial();
  }
}

export function establishFundedRecovery(options: {
  runDir: string;
  appMnemonic: string;
  assets: readonly DeclaredRecoveryAsset[];
  restore?: RestorePolicy;
  p2pkPrivateKey?: string;
}): FundedRecovery {
  return new FundedRecovery(RecoveryCustody.establish(options));
}

export function openFundedRecovery(options: { runDir: string }): FundedRecovery {
  return new FundedRecovery(RecoveryCustody.open(options.runDir));
}
