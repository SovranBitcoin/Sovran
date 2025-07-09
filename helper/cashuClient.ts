import { decode } from '@gandlaf21/bolt11-decode';
import {
  appendProofsV2,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetTransactions,
  updateTransaction,
  setAudit,
  setInfo,
  setKeys,
  setKeysets,
  appendTransaction,
  memoizedGetSelectedMint,
  removeProofs,
  memoizedGetBalance,
  memoizedGetProofs,
} from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { Alert, Platform } from 'react-native';
import { publishWalletEvent } from 'helper/nostr/cashu';
import { convertTime } from 'helper/time';
import dayjs from 'dayjs';
import { auditMint } from 'helper/apiClient';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { mnemonicToSeedSync } from 'bip39';
import { useState, useEffect } from 'react';

import {
  MeltQuoteResponse,
  CashuWallet,
  MintKeyset,
  CashuMint,
  decodePaymentRequest,
  getDecodedToken,
  ProofState,
  MintQuoteResponse,
  Proof,
  Token,
  getEncodedToken,
  PaymentRequest,
  PaymentRequestTransport,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts';

import { getPublicKey, nip19 } from 'nostr-tools';
import { v4 as uuidv4 } from 'uuid';
import { SheetManager } from 'react-native-actions-sheet';
import { bytesToHex } from '@noble/hashes/utils';

// TYPES

interface GetWalletParams {
  unit: string;
  mintUrl: string;
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

  counter?: number;
  nostr?: {
    pubkey: string;
  };
}

interface BaseLightningTransaction extends BaseTransaction {
  type: 'lightning';
  request: string;
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

interface BaseEcashTransaction extends BaseTransaction {
  type: 'ecash';
  token: string;
}

interface EcashSendTransaction extends BaseEcashTransaction {
  transactionType: 'send';
  paymentRequest?: string;
  proofs: {
    keep: Proof[];
    send: Proof[];
  };
}

interface EcashReceiveTransaction extends BaseEcashTransaction {
  transactionType: 'receive';
  fromNIP05?: string; // Used for when we redeem from npubx.cash or other lightning servers
  proofs: {
    keep: Proof[];
  };
}

type Transaction =
  | EcashReceiveTransaction
  | EcashSendTransaction
  | LightningReceiveTransaction
  | LightningSendTransaction;

interface GetMintParams {
  mintUrl: string;
  forceRefresh?: boolean;
}

interface GetKeysParams {
  unit: string;
  mintUrl: string;
  forceRefresh?: boolean;
}

// wallet caches for all the mints
let walletCache: { [key: string]: CashuWallet } = {};

// MAIN UTILITIES

export async function getWallet({ unit, mintUrl, profile, forceRefresh = false }: GetWalletParams) {
  if (walletCache?.[mintUrl]?.[unit] && !forceRefresh) {
    return walletCache[mintUrl][unit];
  }

  const currentProfile = profile?.pubkey ? profile : memoizedGetCurrentProfile(store.getState());

  let mintInfo = store.getState().cashu?.info?.[mintUrl];
  let keys = store.getState().cashu?.keys?.[mintUrl];
  let keysets = store.getState().cashu?.keysets?.[mintUrl];
  let audits = store.getState().cashu?.audits?.[mintUrl];
  const lastFetched = audits?.lastFetched ?? 0;
  const shouldRefresh = forceRefresh || !mintInfo || !keys || !keysets;

  const mint = await getMint({
    mintUrl,
    forceRefresh: shouldRefresh,
  });

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
        store.dispatch(setAudit({ mintUrl, audit: auditWithTimestamp }));
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

  return wallet;
}

export async function getMint({ mintUrl, forceRefresh = false }: GetMintParams) {
  const mint = new CashuMint(mintUrl);

  if (forceRefresh) {
    const mintInfo = await mint.getInfo();

    store.dispatch(
      setInfo({
        mintUrl,
        mintInfo,
      })
    );
    store.dispatch(setKeysets({ mintUrl, keysets: (await mint.getKeySets()).keysets }));
    store.dispatch(setKeys({ mintUrl, keys: (await mint.getKeys()).keysets }));
  }

  return mint;
}

export async function getKeys({
  unit,
  mintUrl,
  forceRefresh = false,
}: GetKeysParams): Promise<MintKeyset | undefined> {
  const mint = getMint({ mintUrl });

  // check if keysets and keys are already cached
  if (store.getState().cashu.keysets[mintUrl] && !forceRefresh) {
    return store.getState().cashu.keysets[mintUrl].find((k) => k.unit === unit);
  }

  const keysets = (await (await mint).getKeySets()).keysets;
  const keys = (await (await mint).getKeys()).keysets;

  const key = keysets.find((k) => k.unit === unit);

  // Store the keyset in cache
  store.dispatch(
    setKeysets({
      mintUrl,
      keysets,
    })
  );

  store.dispatch(
    setKeys({
      mintUrl,
      keys,
    })
  );

  return key;
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
  mintUrl: string;
  mppAmount?: number;
}): Promise<MeltQuoteResponse> {
  const wallet = await getWallet({ unit, mintUrl, profile: null });
  const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
  const keysetId = activeKeyset.id;
  wallet.keysetId = keysetId;

  const options = mppAmount ? { options: { mpp: { amount: mppAmount } } } : {};

  const meltQuote = await wallet.mint.createMeltQuote({
    request: pr,
    unit,
    ...options,
  });

  return meltQuote;
}

export async function sendLightning({
  mintUrl = memoizedGetSelectedMint(store.getState()),
  pr,
  unit,
  pubkey,
  meltQuote,
  email,
  lud16,
}: {
  mintUrl: string;
  pr: string;
  unit: string;
  pubkey?: string;
  meltQuote: MeltQuoteResponse;
  email?: string;
  lud16?: string;
}): Promise<LightningSendTransaction> {
  const state = store.getState();
  const profile = memoizedGetCurrentProfile(state);

  let expiry: Date | null = null;
  try {
    expiry = getRawExpiry({ pr });
  } catch {
    throw new AppError('invalid_invoice', 'Invalid payment request');
  }
  if (expiry && new Date(Date.now() + 60_000) > expiry) {
    throw new AppError('invoice_expired', 'Invoice expired');
  }

  // Retry logic for wallet operations
  const attemptSend = async (forceRefresh = false): Promise<LightningSendTransaction> => {
    const currentProofs = memoizedGetProofs(unit)(state);

    const wallet = await getWallet({
      unit,
      mintUrl,
      profile: null,
      ...(forceRefresh && { forceRefresh: true }),
    });

    const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    if (!meltQuote.amount) {
      throw new AppError('invalid_invoice', 'No amount specified in payment request');
    }

    const balance = currentProofs
      .map((p: { amount: number }) => p.amount)
      .reduce((a: number, b: number) => a + b, 0);
    if (meltQuote.amount + meltQuote.fee_reserve > balance) {
      throw new AppError('insufficient_funds', 'Insufficient funds');
    }

    const profileId = store.getState().nostr?.currentProfile?.id;

    const counter = memoizedGetCounterV2({
      profileId,
      mintUrl,
      keysetId: wallet.keysetId,
    })(store.getState());

    const { send: proofsToSend, keep: proofsToKeep } = wallet.selectProofsToSend(
      currentProofs,
      Number(meltQuote.amount) + Number(meltQuote.fee_reserve),
      true
    );

    const used = getUsedProofs(currentProofs, proofsToKeep);

    const keyset_fee =
      proofsToSend.reduce((acc, proof) => acc + proof.amount, 0) -
      Number(meltQuote.amount) -
      Number(meltQuote.fee_reserve);

    store.dispatch(
      increaseCounterV2({
        profileId,
        mintUrl: mintUrl,
        keysetId: wallet.keysetId,
        amount: proofsToKeep.length + proofsToSend.length,
      })
    );

    const counter2 = memoizedGetCounterV2({
      profileId,
      mintUrl,
      keysetId: wallet.keysetId,
    })(store.getState());

    const { change } = await wallet.meltProofs(meltQuote, proofsToSend, {
      counter: counter2, // it's going up forever, laura
      keysetId,
    });

    store.dispatch(
      increaseCounterV2({
        profileId,
        mintUrl: mintUrl,
        keysetId: wallet.keysetId,
        amount: change.length,
      })
    );

    store.dispatch(
      removeProofs({
        profileId,
        mintUrl,
        proofs: used,
      })
    );

    store.dispatch(
      appendProofsV2({
        profileId,
        mintUrl,
        proofs: [...proofsToKeep, ...change],
      })
    );

    const transaction: LightningSendTransaction = {
      request: pr,
      amount: meltQuote.amount,
      date: new Date().toISOString(),
      type: 'lightning',
      transactionType: 'send',
      unit,
      paid: true,
      meltQuote,
      lud16,
      fees: {
        lightning_fee: meltQuote.fee_reserve,
        keyset_fee: keyset_fee,
      },
      mintUrl,
      email,
      nostr: {
        pubkey: pubkey || '',
      },
      counter,
      proofs: {
        change,
        keep: proofsToKeep,
        send: proofsToSend,
      },
    };

    store.dispatch(
      appendTransaction({
        profileId: profile.id,
        transaction,
      })
    );

    return transaction;
  };

  // First attempt
  try {
    return await attemptSend(false);
  } catch (error) {
    // Check if it's the specific keyset inactive error
    if (error.message === 'keyset id inactive.') {
      Alert.alert('Updating keyset...');
      try {
        return await attemptSend(true);
      } catch (retryError) {
        throw retryError;
      }
    }

    // Re-throw other errors
    throw error;
  }
}

export async function receiveLightning({
  amount,
  unit,
  memo,
}: {
  amount: number;
  unit: string;
  memo?: string;
}): Promise<LightningReceiveTransaction> {
  const selectedMint = memoizedGetSelectedMint(store.getState());
  const profile = memoizedGetCurrentProfile(store.getState());

  Alert.alert('a', JSON.stringify(unit, selectedMint));
  const wallet = await getWallet({
    unit,
    mintUrl: selectedMint,
    profile: null,
  });

  const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
  const keysetId = activeKeyset.id;
  wallet.keysetId = keysetId;

  const mintQuote = await wallet.createMintQuote(amount, memo);

  if (mintQuote.error) {
    throw new AppError('quote_error', 'Error getting mint quote');
  }

  const paymentRequest = await getPaymentRequest({
    amount: amount,
    unit: unit,
    description: memo || '',
  });

  const unifiedRequest = paymentRequest;
  unifiedRequest.description = mintQuote.request;

  const transaction: LightningReceiveTransaction = {
    request: mintQuote.request,
    amount,
    mintQuote,
    date: new Date().toISOString(),
    type: 'lightning',
    paid: false,
    transactionType: 'receive',
    unit,
    mintUrl: wallet.mint.mintUrl,
    paymentRequest: paymentRequest.toEncodedRequest(),
    unifiedRequest: unifiedRequest.toEncodedRequest(),
    memo,
  };

  store.dispatch(
    appendTransaction({
      profileId: profile.id,
      transaction,
    })
  );

  return transaction;
}

export async function sendEcash({
  amount,
  unit,
  memo,
  to,
  p2pk,
  paymentRequest,
}: {
  amount: number;
  unit: string;
  memo?: string;
  to?: string;
  p2pk?: { pubkey?: string; privkey?: string };
  paymentRequest?: string;
}): Promise<EcashSendTransaction> {
  const state = store.getState();
  const selectedMint = memoizedGetSelectedMint(state);
  const profile = memoizedGetCurrentProfile(state);

  // Retry logic for wallet operations
  const attemptSend = async (forceRefresh = false): Promise<EcashSendTransaction> => {
    const currentProofs = memoizedGetProofs(unit)(state);
    const balance = memoizedGetBalance(unit)(state);

    if (amount > balance) {
      throw new AppError('insufficient_funds', 'Insufficient funds');
    }

    const wallet = await getWallet({
      unit,
      mintUrl: selectedMint,
      profile: null,
      ...(forceRefresh && { forceRefresh: true }),
    });

    if (!wallet) {
      throw new AppError('wallet_not_found', 'Wallet not found');
    }

    const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    const counter = memoizedGetCounterV2({
      profileId: profile.id,
      mintUrl: wallet.mint.mintUrl,
      keysetId: wallet.keysetId,
    })(state);

    const { keep, send, used } = await wallet._send(Number(amount), currentProofs, {
      ...(p2pk?.pubkey ? { pubkey: p2pk.pubkey } : {}),
      counter,
      keysetId,
    });

    store.dispatch(
      removeProofs({
        profileId: profile.id,
        mintUrl: wallet.mint.mintUrl,
        proofs: used,
      })
    );

    store.dispatch(
      appendProofsV2({
        profileId: profile.id,
        mintUrl: wallet.mint.mintUrl,
        proofs: keep,
      })
    );

    const token: Token = {
      proofs: send,
      mint: wallet.mint.mintUrl,
      unit,
      memo,
    };

    store.dispatch(
      increaseCounterV2({
        profileId: profile.id,
        mintUrl: wallet.mint.mintUrl,
        keysetId: wallet.keysetId,
        amount: send.length + keep.length,
      })
    );

    const encodedToken = getEncodedToken(token, {
      version: 4,
    });

    const transaction: EcashSendTransaction = {
      amount,
      date: new Date().toISOString(),
      type: 'ecash',
      token: encodedToken,
      memo,
      transactionType: 'send',
      unit,
      paid: false,
      ...(paymentRequest ? { paymentRequest } : {}),
      nostr: {
        pubkey: to,
      },
      mintUrl: wallet.mint.mintUrl,
      counter,
      // proofs: {
      //   send,
      //   keep,
      // },
      ...(p2pk ? { p2pk: { pubkey: p2pk.pubkey, privkey: p2pk.privkey } } : {}),
    };

    store.dispatch(
      appendTransaction({
        profileId: profile.id,
        transaction,
      })
    );

    return transaction;
  };

  // First attempt
  try {
    return await attemptSend(false);
  } catch (error) {
    // Check if it's the specific keyset inactive error
    if (error.message === 'keyset id inactive.') {
      Alert.alert('Updating keyset...');
      try {
        return await attemptSend(true);
      } catch (retryError) {
        console.error('[sendEcash] Retry failed:', retryError);
        throw retryError;
      }
    }

    // Re-throw other errors
    throw error;
  }
}

export async function receiveEcash({
  token,
  unit,
  from,
  memo,
  fromNIP05,
  refund,
}: {
  token: string;
  unit: string;
  from?: string;
  memo?: string;
  fromNIP05?: string;
  refund?: boolean;
}): Promise<EcashReceiveTransaction> {
  const state = store.getState();
  const profile = memoizedGetCurrentProfile(state);
  const decodedToken = getDecodedToken(token);
  const receiveMintUrl = decodedToken.mint;

  const getPubkeyFromToken = (token: string) => {
    const decodedToken = getDecodedToken(token);

    try {
      return JSON.parse(decodedToken.proofs[0].secret)[0] === 'P2PK'
        ? JSON.parse(decodedToken.proofs[0].secret)[1].data
        : null;
    } catch (error) {
      console.error('Error parsing token secret:', error);
      return null;
    }
  };

  const key = (() => {
    const decoded = nip19.decode(profile.nsec).data as Uint8Array;
    const pubkey = getPublicKey(decoded);
    return getPubkeyFromToken(token) === pubKeyTo02(pubkey)
      ? {
        privkey: bytesToHex(decoded),
        pubkey,
      }
      : null;
  })();

  // Retry logic for wallet operations
  const attemptReceive = async (forceRefresh = false): Promise<EcashReceiveTransaction> => {
    const wallet = await getWallet({
      unit,
      mintUrl: receiveMintUrl,
      profile: null,
      ...(forceRefresh && { forceRefresh: true }),
    });

    if (!wallet) {
      throw new AppError('wallet_not_found', 'Wallet not found');
    }

    const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    const counter = memoizedGetCounterV2({
      profileId: profile.id,
      mintUrl: receiveMintUrl,
      keysetId: keysetId,
    })(state);

    const response = await wallet.receive(token, {
      counter,
      keysetId,
      ...(key?.privkey ? { privkey: key.privkey } : {}),
    });

    if (!response) {
      throw new AppError('invalid_token', 'Invalid token');
    }

    const newProofs = [...response];

    store.dispatch(
      increaseCounterV2({
        profileId: profile.id,
        mintUrl: receiveMintUrl,
        keysetId: wallet.keysetId,
        amount: newProofs.length,
      })
    );

    await store.dispatch(
      appendProofsV2({ profileId: profile.id, mintUrl: receiveMintUrl, proofs: newProofs })
    );

    const totalAmount = decodedToken.proofs.map((p) => p.amount).reduce((a, b) => a + b, 0);

    const transaction: EcashReceiveTransaction = {
      amount: totalAmount,
      date: new Date().toISOString(),
      type: 'ecash',
      token,
      transactionType: 'receive',
      unit,
      memo,
      mintUrl: receiveMintUrl,
      paid: true,
      counter,
      ...(from ? { nostr: { pubkey: from } } : {}),
      refund,
      fromNIP05,
      ...(key?.privkey
        ? {
          p2pk: {
            pubkey: key.pubkey,
            privkey: key.privkey,
          },
        }
        : {}),
    };

    store.dispatch(
      appendTransaction({
        profileId: profile.id,
        transaction,
      })
    );

    await publishWalletEvent([
      ...new Set([
        ...memoizedGetTransactions({ id: profile.id })(store.getState()).map((t) => t.mintUrl),
        receiveMintUrl,
      ]),
    ]);

    return transaction;
  };

  // First attempt
  try {
    return await attemptReceive(false);
  } catch (error) {
    // Check if it's the specific keyset inactive error
    if (
      error.message === 'keyset id inactive.' ||
      error?.message?.startsWith('Could not calculate fees. No keyset found with id:')
    ) {
      Alert.alert('Updating keyset...');
      try {
        return await attemptReceive(true);
      } catch (retryError) {
        console.error('[receiveEcash] Retry failed:', retryError);
        throw retryError;
      }
    }

    // Re-throw other errors
    throw error;
  }
}

export async function getPaymentRequest({
  amount,
  unit,
  description,
  singleUse = true,
}): Promise<PaymentRequest> {
  const state = store.getState();
  const mint = memoizedGetSelectedMint(state);
  const currentProfile = memoizedGetCurrentProfile(state);
  const nprofile = nip19.nprofileEncode({
    pubkey: currentProfile?.pubkey,
  });

  return new PaymentRequest(
    [
      {
        type: PaymentRequestTransportType.NOSTR,
        target: nprofile,
        tags: [['n', '17']],
      } as PaymentRequestTransport,
    ],
    uuidv4(),
    amount,
    unit,
    [mint],
    description,
    singleUse
  );
}

export async function cancelEcashTransaction(
  transaction: Transaction,
  navigation: any
): Promise<void> {
  await receiveEcash({
    token: transaction.token as string,
    unit: transaction.unit,
    refund: true,
  });

  const profileId = store.getState().nostr?.currentProfile?.id;
  store.dispatch(
    updateTransaction({
      profileId,
      matcher: (t: Transaction) => t.token === transaction.token,
      updateFn: (t: Transaction) => ({
        ...t,
        paid: true,
        isCancel: true,
      }),
    })
  );

  SheetManager.hide('button-handler');
  navigation.navigate('', {}, { closeParents: true });
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

export function useWallet({ unit, mintUrl, profile, forceRefresh = false }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchWallet = async () => {
      try {
        setLoading(true);
        setError(null);

        const walletInstance = await getWallet({
          unit,
          mintUrl,
          profile,
          forceRefresh,
        });

        if (isMounted) {
          setWallet(walletInstance);
        }
      } catch (err) {
        if (isMounted) {
          setError(err);
          console.error('Failed to get wallet:', err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (mintUrl) {
      fetchWallet();
    } else {
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [unit, mintUrl, profile, forceRefresh]);

  const refetch = () => {
    if (mintUrl) {
      setWallet(null);
      setError(null);
      setLoading(true);

      getWallet({
        unit,
        mintUrl,
        profile,
        forceRefresh: true,
      })
        .then(setWallet)
        .catch(setError)
        .finally(() => setLoading(false));
    }
  };

  return {
    wallet,
    loading,
    error,
    refetch,
  };
}

/**
 * Checks if a token has been spent
 */
export async function checkTokenSpent({ token }) {
  const decodedToken = getDecodedToken(token);
  const { unit, mint, proofs } = decodedToken;

  const wallet = await getWallet({ unit, mintUrl: mint });
  return (await wallet.checkProofsStates(proofs)).some((p) => p.state === 'SPENT');
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
  try {
    getDecodedToken(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if a string is a valid payment request
 */
export function isValidPaymentRequest(paymentRequest: string): boolean {
  try {
    return !!decodePaymentRequest(paymentRequest);
  } catch {
    return false;
  }
}

// Lightning invoice parsing utilities
export function getLightningAmount({ pr }) {
  try {
    const decodedPR = decode(pr as string);
    return decodedPR?.sections?.find((route) => route?.name === 'amount')?.value / 1000;
  } catch {
    return null;
  }
}

export function getTimestamp({ pr }) {
  const decodedPR = decode(pr as string);
  const timestamp = decodedPR.sections.find((route) => route.name === 'timestamp')?.value;
  return convertTime(new Date(timestamp * 1000));
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

export function getExpiresIn({ pr }) {
  const expiry = getRawExpiry({ pr });
  return dayjs(expiry).fromNow();
}

export function getDescription({ pr }) {
  const decodedPR = decode(pr as string);
  return decodedPR.sections.find((route) => route.name === 'description')?.value;
}

export function isValidLNURL(url: string): boolean {
  try {
    decode(url);
    return true;
  } catch {
    return false;
  }
}

export function npubToPublicKey(key: string) {
  // Check and convert npub to P2PK
  if (key && key.startsWith('npub1')) {
    const { type, data } = nip19.decode(key);
    if (type === 'npub' && data.length === 64) {
      return data;
    }
  }
  return key;
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
  try {
    let response = {};
    const mint = await getMint({ mintUrl });

    const keysets = (await mint.getKeySets()).keysets;

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

      const wallet = await getWallet({ unit: keyset.unit, mintUrl, profile });
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
  } catch (err) {
    return null;
  }
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
  const wallet = await getWallet({ unit: keyset.unit, mintUrl, profile: null });

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

// ERROR

export class AppError extends Error {
  static messageMap = {};

  constructor(name, message) {
    const mappedError = AppError.messageMap[message];
    super(mappedError?.message || message);
    this.name = mappedError?.name || name;
  }
}
