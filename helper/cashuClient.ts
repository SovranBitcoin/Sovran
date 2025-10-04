import { decode } from '@gandlaf21/bolt11-decode';
import { TransactionData } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { Platform } from 'react-native';
import { convertTime } from 'helper/time';
import { auditMint } from 'helper/apiClient';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { mnemonicToSeedSync } from 'bip39';

import {
  MeltQuoteResponse,
  CashuWallet,
  CashuMint,
  decodePaymentRequest,
  getDecodedToken,
  ProofState,
  MintQuoteResponse,
  Proof,
} from '@cashu/cashu-ts';

import { getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { toResult, toResultSync } from 'helper/toResult';
import { ok, err, Result } from 'neverthrow';
import { sha256 } from '@noble/hashes/sha256';
import { getGiveaway } from 'app/ecashReceiveConfirmation';

// TYPES

interface GetWalletParams {
  unit?: string;
  mintUrl?: string;
  profile: any;
  forceRefresh?: boolean;
}

interface BaseTransaction {
  amount: number;
  date: string;
  type: 'ecash' | 'lightning';
  transactionType: 'send' | 'receive';
  unit: 'sat' | 'usd' | 'eur' | 'gbp' | string;
  mintUrl: string;
  paid: boolean;
  memo?: string;
  batchId?: string;

  counter?: number;
  nostr?: {
    pubkey: string;
  };
}

interface BaseLightningTransaction extends BaseTransaction {
  type: 'lightning';
  request: string;
  lud16?: string;
}

interface LightningSendTransaction extends BaseLightningTransaction {
  transactionType: 'send';
  meltQuote: MeltQuoteResponse;
  proofs: {
    keep: Proof[];
    send: Proof[];
    change: Proof[];
  };
}

interface LightningReceiveTransaction extends BaseLightningTransaction {
  transactionType: 'receive';
  mintQuote: MintQuoteResponse;
  paymentRequest: string;
  unifiedRequest: string;
}

interface GetMintParams {
  mintUrl?: string;
  forceRefresh?: boolean;
}

// wallet caches for all the mints
let walletCache: { [key: string]: CashuWallet } = {};

// MAIN UTILITIES

export async function getWallet({
  unit,
  mintUrl,
  profile,
  forceRefresh = false,
}: GetWalletParams): Promise<Result<CashuWallet, Error>> {
  if (!mintUrl) return err(new AppError('invalid_mint_url', 'Invalid mint URL'));

  if (walletCache?.[mintUrl]?.[unit] && !forceRefresh) {
    return ok(walletCache[mintUrl][unit]);
  }

  const currentProfile = profile?.pubkey ? profile : memoizedGetCurrentProfile(store.getState());

  let mintInfo = store.getState().cashu?.info?.[mintUrl];
  let keys = store.getState().cashu?.keys?.[mintUrl];
  let keysets = store.getState().cashu?.keysets?.[mintUrl];
  let audits = store.getState().cashu?.audits?.[mintUrl];
  const lastFetched = audits?.lastFetched ?? 0;
  const shouldRefresh = forceRefresh || !mintInfo || !keys || !keysets;

  const mintRes = await getMint({
    mintUrl,
    forceRefresh: shouldRefresh,
  });
  if (mintRes.isErr()) return err(mintRes.error);

  const mint = mintRes.value;

  mintInfo = store.getState().cashu?.info?.[mintUrl];
  keys = store.getState().cashu?.keys?.[mintUrl];
  keysets = store.getState().cashu?.keysets?.[mintUrl];

  const cashuMnemonic = currentProfile.nut13; // its better than recomputing it

  const wallet = new CashuWallet(mint, {
    ...(shouldRefresh ? { keys, keysets, mintInfo } : { keys, keysets, mintInfo }),
    bip39seed: mnemonicToSeedSync(cashuMnemonic),
    unit,
  });

  wallet.audits = audits;

  const isAuditStale = Date.now() - lastFetched > 24 * 60 * 60 * 1000;
  if (forceRefresh || !audits || isAuditStale) {
    auditMint({ mintUrl }).then((res) => {
      if (res.isOk()) {
        const data = res.value;
        const auditWithTimestamp = { ...data, lastFetched: Date.now() };
        // Note: Coco now manages audit state internally, no need to dispatch to Redux
        wallet.audits = auditWithTimestamp;
      } else {
        console.error(`Audit fetch failed for ${mintUrl}:`, res.error.message);
      }
    });
  }

  wallet._send = async function (amount, currentProofs, options = {}) {
    const { keep, send } = await this.send(Number(amount), currentProofs, options);
    const used = getUsedProofs(currentProofs, keep);
    return { keep, send, used };
  };

  walletCache = {
    [mintUrl]: {
      [unit]: wallet,
      ...walletCache?.[mintUrl],
    },
    ...walletCache,
  };

  return ok(wallet);
}

export async function getMint({
  mintUrl,
  forceRefresh = false,
}: GetMintParams): Promise<Result<CashuMint, Error>> {
  if (!mintUrl) return err(new AppError('invalid_mint_url', 'Invalid mint URL'));

  const mint = new CashuMint(mintUrl);

  if (forceRefresh) {
    const infoRes = await toResult(mint.getInfo());
    if (infoRes.isErr()) return err(infoRes.error);

    const keysetsRes = await toResult(mint.getKeySets());
    if (keysetsRes.isErr()) return err(keysetsRes.error);

    const keysRes = await toResult(mint.getKeys());
    if (keysRes.isErr()) return err(keysRes.error);

    // here we should check if there is a collision and refuse to update the keyset.
    const existingKeysetIds = memoizedGetAllKeysetIdsFromAllMints(mintUrl)(store.getState());

    const newKeysetIds = keysetsRes.value.keysets.map((keyset) => keyset.id);
    if (newKeysetIds.some((id) => isCollidingKeysetId(id, existingKeysetIds))) {
      return err(new AppError('colliding_keyset_id', 'Colliding keyset ID'));
    }

    store.dispatch(
      setInfo({
        mintUrl,
        mintInfo: infoRes.value,
      })
    );
    store.dispatch(setKeysets({ mintUrl, keysets: keysetsRes.value.keysets }));
    store.dispatch(setKeys({ mintUrl, keys: keysRes.value.keysets }));
  }

  return ok(mint);
}

// Melt quote and payment functions
export async function getMeltQuote({
  pr,
  unit,
  mintUrl,
  mppAmount,
}: {
  pr: string;
  unit: string;
  mintUrl?: string;
  mppAmount?: number;
}): Promise<Result<MeltQuoteResponse, Error>> {
  if (!mintUrl) {
    return err(new AppError('invalid_mint_url', 'Invalid mint URL'));
  }

  const walletRes = await getWallet({ unit, mintUrl, profile: null });
  if (walletRes.isErr()) return err(walletRes.error);
  const wallet = walletRes.value;

  const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
  const keysetId = activeKeyset.id;
  wallet.keysetId = keysetId;

  const options = mppAmount ? { options: { mpp: { amount: mppAmount * 1000 } } } : {};

  const meltQuoteRes = await toResult(
    wallet.mint.createMeltQuote({
      request: pr,
      unit,
      ...options,
    })
  );

  if (meltQuoteRes.isErr()) return err(meltQuoteRes.error);

  return ok(meltQuoteRes.value);
}

export function getUsedProofs(currentProofs, keepProofs) {
  const usedProofs = [];

  for (const currentProof of currentProofs) {
    const isKept = keepProofs.some(
      (keepProof) =>
        keepProof.C === currentProof.C &&
        keepProof.secret === currentProof.secret &&
        keepProof.amount === currentProof.amount
    );

    if (!isKept) {
      usedProofs.push(currentProof);
    }
  }

  return usedProofs;
}

// HELPER FUNCTIONS

export const giveaways = {
  christmas_2024_ios: {
    id: 'christmas_2024_ios',
    start: new Date('2024-12-25T00:00:00Z'),
    end: new Date('2025-01-05T23:59:59Z'),
    private_key: process.env.CHRISTMAS_2024_IOS_PRIVATE_KEY,
    public_key: process.env.CHRISTMAS_2024_IOS_PUBLIC_KEY,
    note: "Sovran's Christmas Giveaway 🎁",
    condition: () => Platform.OS === 'ios',
    error: () =>
      Platform.OS !== 'ios' && {
        title: 'Not redeemable on Android',
        message:
          'This ecash token is part of our iOS Christmas giveaway and is only redeemable on that platform.',
      },
  },
  christmas_2024_android: {
    id: 'christmas_2024_android',
    start: new Date('2024-12-25T00:00:00Z'),
    end: new Date('2025-01-05T23:59:59Z'),
    private_key: process.env.CHRISTMAS_2024_ANDROID_PRIVATE_KEY,
    public_key: process.env.CHRISTMAS_2024_ANDROID_PUBLIC_KEY,
    note: "Sovran's Christmas Giveaway 🎁",
    condition: () => Platform.OS === 'android',
    error: () =>
      Platform.OS !== 'android' && {
        title: 'Not redeemable on iOS',
        message:
          'This ecash token is part of our Android Christmas giveaway and is only redeemable on that platform.',
      },
  },
};

/**
 * Validates if a string is a valid ecash token
 */
export function isValidEcashToken(token: string): boolean {
  return toResultSync(() => getDecodedToken(token)).isOk();
}

/**
 * Validates if a string is a valid payment request
 */
export function isValidPaymentRequest(paymentRequest: string): boolean {
  return toResultSync(() => decodePaymentRequest(paymentRequest)).isOk();
}

// Lightning invoice parsing utilities
export function getLightningAmount({ pr }) {
  const res = toResultSync(() => decode(pr as string));
  if (res.isErr()) return null;
  const decodedPR = res.value;
  return decodedPR?.sections?.find((route) => route?.name === 'amount')?.value / 1000;
}

export function getRawExpiry({ pr }) {
  if (!pr) return null;
  const decodedPR = decode(pr as string);
  const timestamp = decodedPR.sections.find((route) => route.name === 'timestamp')?.value;
  const expiry = decodedPR.sections.find((route) => route.name === 'expiry')?.value || 3600;
  return new Date((timestamp + expiry) * 1000);
}

export function getExpiry({ pr }) {
  return convertTime(getRawExpiry({ pr }));
}

export function maybeConvertNpub(key: string) {
  // Check and convert npub to P2PK
  if (key && key.startsWith('npub1')) {
    const { type, data } = nip19.decode(key);
    if (type === 'npub' && data.length === 64) {
      key = '02' + data;
    }
  }
  return key;
}

export function pubKeyTo02(key: string) {
  return '02' + key;
}

// RESTORE FUNCTIONALITY

// https://github.com/cashubtc/cashu.me/blob/8cdb2b45d7353fac5b5d2af3388a5783ee9fae9b/src/stores/restore.ts
export async function* restoreMint({
  mintUrl,
  profile,
  BATCH_SIZE = 100,
  MAX_GAP = 2,
  allowedUnits = ['sat', 'usd', 'eur', 'gbp'],
}: {
  mintUrl: string;
  profile: string;
  BATCH_SIZE?: number;
  MAX_GAP?: number;
  allowedUnits?: string[];
}) {
  let response = {};
  const mintResult = await getMint({ mintUrl });

  if (mintResult.isErr()) {
    return err(mintResult.error);
  }

  const keysets = (await mintResult.value.getKeySets()).keysets;

  const uniqueUnits = keysets
    .filter((keyset, index, self) => index === self.findIndex((k) => k.unit === keyset.unit))
    .filter((keyset) => allowedUnits.includes(keyset.unit));

  yield {
    label: 'INIT',
    progress: 0,
    totalUnits: uniqueUnits.length,
    currentUnit: 0,
    message: 'Starting restoration process',
    mintUrl,
    response,
  };

  for (let i = 0; i < uniqueUnits.length; i++) {
    const keyset = uniqueUnits[i];

    yield {
      label: 'RESTORING KEYSET',
      unit: keyset.unit,
      progress: i / uniqueUnits.length,
      currentUnit: i + 1,
      totalUnits: uniqueUnits.length,
      message: `Restoring keyset for ${keyset.unit}`,
      mintUrl,
      response,
    };

    const walletResult = await getWallet({ unit: keyset.unit, mintUrl, profile });
    if (walletResult.isErr()) {
      return err(walletResult.error);
    }
    const wallet = walletResult.value;

    let start: number = 0;
    let emptyBatchCount: number = 0;
    let restoredProofs: Proof[] = [];
    let totalProofsProcessed = 0;
    let firstEmptyStart = 0; // Track the first position where proofs begin to be empty

    while (emptyBatchCount < MAX_GAP) {
      yield {
        label: 'RESTORING BATCH',
        unit: keyset.unit,
        batchStart: start,
        batchEnd: start + BATCH_SIZE,
        currentUnit: i + 1,
        totalUnits: uniqueUnits.length,
        message: `Fetching proofs ${start} to ${start + BATCH_SIZE}`,
        mintUrl,
        response,
      };

      // Fetch a batch of proofs
      const uncheckedProofs: Proof[] = (
        await wallet.restore(start, BATCH_SIZE, { keysetId: keyset.id })
      ).proofs;

      if (uncheckedProofs.length === 0) {
        if (emptyBatchCount === 0) {
          firstEmptyStart = start;
        }
        emptyBatchCount++;
      } else {
        emptyBatchCount = 0;
        firstEmptyStart = 0; // Reset if we find proofs again
        totalProofsProcessed += uncheckedProofs.length;

        // Process this batch immediately instead of waiting
        if (uncheckedProofs.length > 0) {
          yield {
            label: 'CHECKING BATCH',
            unit: keyset.unit,
            batchStart: start,
            batchSize: uncheckedProofs.length,
            currentUnit: i + 1,
            totalUnits: uniqueUnits.length,
            message: `Checking states for ${uncheckedProofs.length} proofs`,
            mintUrl,
            response,
          };

          // Check states of this batch
          const proofStates: ProofState[] = await wallet.checkProofsStates(uncheckedProofs);

          // Filter and keep only the unspent proofs
          const unspentProofs = uncheckedProofs.filter(
            (p, index) => proofStates[index].state === 'UNSPENT'
          );

          // Add unspent proofs to our collection
          restoredProofs = restoredProofs.concat(unspentProofs);

          yield {
            label: 'BATCH_PROCESSED',
            unit: keyset.unit,
            batchStart: start,
            unspentCount: unspentProofs.length,
            totalUnspent: restoredProofs.length,
            totalProcessed: totalProofsProcessed,
            currentUnit: i + 1,
            totalUnits: uniqueUnits.length,
            message: `Found ${unspentProofs.length} unspent proofs in batch`,
            mintUrl,
            response,
          };
        }
      }

      start += BATCH_SIZE;
    }

    // Calculate the final index after searching
    const keysetIndex = firstEmptyStart !== 0 ? firstEmptyStart : start - MAX_GAP * BATCH_SIZE;

    // Build the full response
    response = {
      ...response,
      [keyset.unit]: {
        proofs: restoredProofs,
        keysets: {
          ...response?.[keyset?.unit]?.keysets,
          [keyset.id]: keysetIndex,
        },
      },
    };

    yield {
      label: 'KEYSET_COMPLETE',
      unit: keyset.unit,
      progress: (i + 1) / uniqueUnits.length,
      currentUnit: i + 1,
      totalUnits: uniqueUnits.length,
      proofCount: restoredProofs.length,
      index: keysetIndex, // Add index to the yield data
      message: `Completed keyset for ${keyset.unit} with ${restoredProofs.length} proofs, index: ${keysetIndex}`,
      mintUrl,
      response,
    };
  }

  yield {
    label: 'COMPLETE',
    progress: 1,
    message: 'Restoration complete',
    mintUrl,
    response,
  };

  return response;
}

export async function restoreCounter({
  keyset,
  mintUrl,
  BATCH_SIZE = 25,
  MAX_GAP = 2,
}: {
  keyset: any;
  mintUrl: string;
  BATCH_SIZE?: number;
  MAX_GAP?: number;
}): Promise<number> {
  const walletResult = await getWallet({ unit: keyset.unit, mintUrl, profile: null });

  if (walletResult.isErr()) throw walletResult.error;
  const wallet = walletResult.value;

  let start = 0;
  let emptyBatchCount = 0;
  let firstEmptyStart = 0;

  while (emptyBatchCount < MAX_GAP) {
    const { proofs } = await wallet.restore(start, BATCH_SIZE, {
      keysetId: keyset.id,
    });

    if (proofs.length === 0) {
      if (emptyBatchCount === 0) {
        firstEmptyStart = start;
      }
      emptyBatchCount++;
    } else {
      emptyBatchCount = 0;
      firstEmptyStart = 0;
    }

    if (emptyBatchCount >= MAX_GAP) {
      break;
    }

    start += BATCH_SIZE;
  }

  return firstEmptyStart;
}

export const checkIfAlreadyRedeemed = (token: string): boolean => {
  const profileId = store.getState().nostr?.currentProfile?.id;
  const transactions = memoizedGetTransactions({ id: profileId })(store.getState());

  const giveaway = getGiveaway({ token });
  if (!giveaway) return false;

  return transactions.some(
    (tx: TransactionData) =>
      tx.privkey === giveaway.private_key && tx.transactionType === 'receive' && !tx.isRefund
  );
};

export class AppError extends Error {
  type: string;
  code?: string;

  constructor(message: string, type: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.code = code;
  }
}

export function deriveMintBackupKeys(mnemonic: string): {
  privateKeyHex: string;
  publicKeyHex: string;
  privateKeyBytes: Uint8Array;
} {
  // Derive seed from mnemonic
  const seed: Uint8Array = mnemonicToSeedSync(mnemonic);
  const domainSeparator = new TextEncoder().encode('cashu-mint-backup');
  const combinedData = new Uint8Array(seed.length + domainSeparator.length);
  combinedData.set(seed);
  combinedData.set(domainSeparator, seed.length);

  // Use SHA256 of combined data as private key
  const privateKeyBytes = sha256(combinedData);
  const privateKeyHex = bytesToHex(privateKeyBytes);
  const publicKeyHex = getPublicKey(privateKeyBytes);

  return { privateKeyHex, privateKeyBytes, publicKeyHex };
}
