import { decode } from '@gandlaf21/bolt11-decode';
import { store } from 'redux/store';
import { auditMint } from 'helper/apiClient';
import { memoizedGetCurrentProfile } from 'redux/nostr';
import { mnemonicToSeedSync } from 'bip39';

import { CashuWallet, CashuMint, decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';

import { getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { toResult, toResultSync } from 'helper/toResult';
import { ok, err, Result } from 'neverthrow';
import { sha256 } from '@noble/hashes/sha256';

// TYPES

interface GetWalletParams {
  unit?: string;
  mintUrl?: string;
  profile: any;
  forceRefresh?: boolean;
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
