import { createHash } from 'node:crypto';

import {
  Amount,
  CheckStateEnum,
  getEncodedToken,
  Mint,
  Wallet,
  type CounterSource,
  type MintKeyset,
  type Proof,
  type ProofState,
  type SendResponse,
  type Token,
} from '@cashu/cashu-ts';

import type { DeclaredRecoveryAsset, RestorePolicy } from './types';
import { normalizeMintUrl } from './mint-url';

export interface CashuWalletPort {
  listKeysets(): Promise<Pick<MintKeyset, 'id' | 'unit'>[]>;
  batchRestore(
    keysetId: string,
    gapLimit: number,
    batchSize: number
  ): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }>;
  checkProofStates(proofs: Proof[]): Promise<ProofState[]>;
  decodeToken?(token: string): Token;
  maxSpendableAfterFees(proofs: Proof[]): Amount;
  sendAll(
    amount: Amount,
    proofs: Proof[],
    options: {
      includeFees: true;
      privkey?: string;
    }
  ): Promise<SendResponse>;
}

export type CashuWalletFactory = (options: {
  asset: DeclaredRecoveryAsset;
  seed: Uint8Array;
  counters: CounterSource;
}) => Promise<CashuWalletPort>;

export interface RecoveredCashuAsset {
  readonly asset: DeclaredRecoveryAsset;
  readonly totalAmount: number;
  /** SHA-256 fingerprints only; raw proof secrets never leave this module. */
  readonly proofFingerprints: readonly string[];
}

export interface PreparedCashuToken {
  readonly asset: DeclaredRecoveryAsset;
  readonly token: string;
  readonly restoredAmount: number;
  readonly tokenAmount: number;
  readonly sendFee: number;
}

export interface CashuRecoveryBackend {
  restore(
    asset: DeclaredRecoveryAsset,
    seed: Uint8Array,
    counters: CounterSource,
    policy: RestorePolicy
  ): Promise<RecoveredCashuAsset>;
  prepareSendAll(
    recovered: RecoveredCashuAsset,
    options?: { p2pkPrivateKey?: string }
  ): Promise<PreparedCashuToken>;
  inspectToken(
    asset: DeclaredRecoveryAsset,
    token: string,
    seed: Uint8Array,
    counters: CounterSource
  ): Promise<InspectedCashuToken>;
}

export interface InspectedCashuToken {
  readonly totalAmount: number;
  readonly unspentAmount: number;
  readonly pendingAmount: number;
  readonly spentAmount: number;
}

interface IssuedRecovery extends RecoveredCashuAsset {
  readonly wallet: CashuWalletPort;
  readonly proofs: Proof[];
}

const proofFingerprint = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

function proofIdentity(proof: Proof): string {
  return JSON.stringify({
    id: proof.id,
    amount: proof.amount.toString(),
    C: proof.C,
    dleq: proof.dleq ?? null,
    p2pk_e: proof.p2pk_e ?? null,
    witness: proof.witness ?? null,
  });
}

function dedupeProofSecrets(proofs: readonly Proof[]): Proof[] {
  const bySecret = new Map<string, { identity: string; proof: Proof }>();
  for (const proof of proofs) {
    const identity = proofIdentity(proof);
    const existing = bySecret.get(proof.secret);
    if (!existing) {
      bySecret.set(proof.secret, { identity, proof });
      continue;
    }
    if (existing.identity !== identity) {
      throw new Error('restored conflicting duplicate proof secret');
    }
  }
  return [...bySecret.values()].map(({ proof }) => proof);
}

function safeAmount(amount: Amount, context: string): number {
  try {
    return amount.toNumber();
  } catch {
    throw new Error(`${context} exceeds the safe test-harness amount range`);
  }
}

function sumProofs(proofs: readonly Proof[]): number {
  return safeAmount(Amount.sum(proofs.map((proof) => proof.amount)), 'proof total');
}

const REAL_WALLET_FACTORY: CashuWalletFactory = async ({ asset, seed, counters }) => {
  const mint = new Mint(asset.mintUrl);
  const wallet = new Wallet(mint, {
    unit: asset.unit,
    bip39seed: new Uint8Array(seed),
    counterSource: counters,
  });
  await wallet.loadMint();
  return {
    listKeysets: async () => (await mint.getKeySets()).keysets,
    // cashu-ts 5 replaced batchRestore's positional args with a config object.
    batchRestore: (keysetId, gapLimit, batchSize) =>
      wallet.batchRestore({ keysetId, gapLimit, batchSize, counter: 0 }),
    checkProofStates: (proofs) => wallet.checkProofsStates(proofs),
    decodeToken: (token) => wallet.decodeToken(token),
    maxSpendableAfterFees: (proofs) => wallet.maxSpendableAfterFees(proofs),
    sendAll: async (amount, proofs, options) => {
      // `.asDeterministic()` with no explicit counter is cashu-ts 4.5.1's
      // CounterSource-driven mode. It reserves from the durable high-water
      // supplied to this wallet; it never restarts at counter zero.
      let builder = wallet.ops
        .send(amount, proofs)
        .asDeterministic()
        .keepAsDeterministic()
        .includeFees(options.includeFees);
      if (options.privkey) builder = builder.privkey(options.privkey);
      return builder.run();
    },
  };
};

export function createCashuTsRecoveryBackend(
  options: { walletFactory?: CashuWalletFactory } = {}
): CashuRecoveryBackend {
  const walletFactory = options.walletFactory ?? REAL_WALLET_FACTORY;
  const issued = new WeakSet<object>();

  return {
    async restore(asset, seed, counters, policy) {
      if (asset.accountIndex !== 0) throw new Error('Cashu recovery supports only account 0');
      if (seed.length !== 64) throw new Error('Cashu recovery requires a 64-byte seed');
      const wallet = await walletFactory({ asset, seed: new Uint8Array(seed), counters });
      const allKeysets = await wallet.listKeysets();
      const seenKeysets = new Set<string>();
      const keysets = allKeysets.filter((keyset) => {
        if (keyset.unit !== asset.unit || seenKeysets.has(keyset.id)) return false;
        seenKeysets.add(keyset.id);
        return true;
      });
      if (keysets.length === 0) {
        throw new Error('mint exposes no keyset for the declared recovery unit');
      }

      const restored: Proof[] = [];
      for (const keyset of keysets) {
        const result = await wallet.batchRestore(keyset.id, policy.gapLimit, policy.batchSize);
        if (result.lastCounterWithSignature !== undefined) {
          if (
            !Number.isSafeInteger(result.lastCounterWithSignature) ||
            result.lastCounterWithSignature < 0 ||
            result.lastCounterWithSignature === Number.MAX_SAFE_INTEGER
          ) {
            throw new Error('restore returned an invalid counter high-water');
          }
          await counters.advanceToAtLeast(keyset.id, result.lastCounterWithSignature + 1);
        } else if (result.proofs.length > 0) {
          throw new Error('restore returned proofs without a counter high-water');
        }
        restored.push(...result.proofs);
      }

      const unique = dedupeProofSecrets(restored);
      if (unique.length === 0) {
        const empty: IssuedRecovery = {
          asset,
          totalAmount: 0,
          proofFingerprints: [],
          wallet,
          proofs: [],
        };
        issued.add(empty);
        return empty;
      }

      const states = await wallet.checkProofStates(unique);
      if (!Array.isArray(states) || states.length !== unique.length) {
        throw new Error('mint returned a malformed proof state response');
      }
      const unspent: Proof[] = [];
      let pending = 0;
      for (const [index, state] of states.entries()) {
        if (state?.state === CheckStateEnum.UNSPENT) unspent.push(unique[index]);
        else if (state?.state === CheckStateEnum.PENDING) pending++;
        else if (state?.state !== CheckStateEnum.SPENT) {
          throw new Error('mint returned an unknown proof state');
        }
      }
      if (pending > 0) {
        throw new Error(`refusing recovery while ${pending} proof(s) are PENDING`);
      }

      const recovery: IssuedRecovery = {
        asset,
        totalAmount: sumProofs(unspent),
        proofFingerprints: unspent.map(({ secret }) => proofFingerprint(secret)),
        wallet,
        proofs: unspent,
      };
      issued.add(recovery);
      return recovery;
    },

    async prepareSendAll(recovered, sendOptions = {}) {
      if (!issued.has(recovered as object)) throw new Error('unrecognized recovered Cashu asset');
      const internal = recovered as IssuedRecovery;
      if (internal.proofs.length === 0 || internal.totalAmount === 0) {
        throw new Error('cannot prepare a token from an empty recovered asset');
      }
      const amount = internal.wallet.maxSpendableAfterFees(internal.proofs);
      const maxSpendable = safeAmount(amount, 'max spendable amount');
      if (maxSpendable <= 0) throw new Error('recovered proofs are not spendable after fees');

      const response = await internal.wallet.sendAll(amount, internal.proofs, {
        includeFees: true,
        ...(sendOptions.p2pkPrivateKey ? { privkey: sendOptions.p2pkPrivateKey } : {}),
      });
      const keepAmount = sumProofs(response.keep);
      const tokenAmount = sumProofs(response.send);
      if (keepAmount !== 0) throw new Error('send-all returned residual keep proofs');
      if (tokenAmount !== maxSpendable) {
        throw new Error('send-all token amount does not match maxSpendableAfterFees');
      }
      const sendFee = internal.totalAmount - tokenAmount;
      if (sendFee < 0) throw new Error('send-all violated amount conservation');
      const token = getEncodedToken({
        mint: internal.asset.mintUrl,
        unit: internal.asset.unit,
        proofs: response.send,
      });
      return {
        asset: internal.asset,
        token,
        restoredAmount: internal.totalAmount,
        tokenAmount,
        sendFee,
      };
    },

    async inspectToken(asset, token, seed, counters) {
      if (asset.accountIndex !== 0) throw new Error('Cashu recovery supports only account 0');
      if (seed.length !== 64) throw new Error('Cashu recovery requires a 64-byte seed');
      const wallet = await walletFactory({ asset, seed: new Uint8Array(seed), counters });
      if (!wallet.decodeToken) throw new Error('Cashu token inspection is unavailable');
      let decoded: Token;
      try {
        decoded = wallet.decodeToken(token);
      } catch {
        throw new Error('persisted Cashu token could not be decoded');
      }
      if (
        normalizeMintUrl(decoded.mint) !== normalizeMintUrl(asset.mintUrl) ||
        decoded.unit !== asset.unit
      ) {
        throw new Error('persisted Cashu token does not match its declared asset');
      }
      const proofs = dedupeProofSecrets(decoded.proofs);
      const states = await wallet.checkProofStates(proofs);
      if (!Array.isArray(states) || states.length !== proofs.length) {
        throw new Error('mint returned a malformed proof state response');
      }
      const totals = {
        totalAmount: sumProofs(proofs),
        unspentAmount: 0,
        pendingAmount: 0,
        spentAmount: 0,
      };
      for (const [index, state] of states.entries()) {
        const amount = safeAmount(proofs[index].amount, 'proof amount');
        if (state?.state === CheckStateEnum.UNSPENT) totals.unspentAmount += amount;
        else if (state?.state === CheckStateEnum.PENDING) totals.pendingAmount += amount;
        else if (state?.state === CheckStateEnum.SPENT) totals.spentAmount += amount;
        else throw new Error('mint returned an unknown proof state');
      }
      return totals;
    },
  };
}
