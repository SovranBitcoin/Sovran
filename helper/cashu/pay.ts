import { Alert } from 'react-native';
import { AppError } from 'components/cashu';
import { getKeys, getWallet } from '.';
import {
  appendProofsV2,
  appendTransaction,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetSelectedMint,
  memoizedGetTransactions,
  removeProofs,
} from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { MeltQuoteResponse, MintQuoteResponse, Proof, Token } from '@cashu/cashu-ts';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import {
  getDecodedToken,
  getEncodedToken,
  PaymentRequest,
  PaymentRequestTransport,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts';
import { memoizedGetBalance, memoizedGetProofs, updateTransaction } from 'helper/redux/cashu';
import { giveaways } from './secrets';
import { publishWalletEvent } from '../nostr/cashu';
import { nip19 } from 'nostr-tools';
import { v4 as uuidv4 } from 'uuid';
import { showMessage } from '../popup/popups';
import { SheetManager } from 'react-native-actions-sheet';
import { getUsedProofs } from './wallet';

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
  console.log('[sendLightning]', { mintUrl, pr, unit, pubkey, meltQuote, email });
  const state = store.getState();
  const profile = memoizedGetCurrentProfile(state);

  // Retry logic for wallet operations
  const attemptSend = async (forceRefresh = false): Promise<LightningSendTransaction> => {
    const currentProofs = memoizedGetProofs(unit)(state);

    const wallet = await getWallet({
      unit,
      mintUrl,
      profile: null,
      ...(forceRefresh && { forceRefresh: true }),
    });

    console.log('[sendLightning] wallet', wallet);

    const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    console.log('[sendLightning] activeKeyset', activeKeyset);

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

    console.log('[sendLightning] counter', counter, meltQuote);

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

    console.log('[sendLightning] counter2', { counter2, meltQuote, proofsToSend });
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
    console.log(323986, error.message);
    // Check if it's the specific keyset inactive error
    if (error.message === 'keyset id inactive.') {
      Alert.alert('Updating keyset...');
      console.log('[sendLightning] Keyset inactive, retrying with forceRefresh');
      try {
        return await attemptSend(true);
      } catch (retryError) {
        console.error('[sendLightning] Retry failed:', retryError);
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

export async function sendEcash({
  amount,
  unit,
  memo,
  to,
  p2pk,
}: {
  amount: number;
  unit: string;
  memo?: string;
  to?: string;
  p2pk?: { pubkey?: string; privkey?: string };
}): Promise<EcashSendTransaction> {
  console.log('[sendEcash]', { amount, unit, memo, to, p2pk });
  const state = store.getState();
  const selectedMint = memoizedGetSelectedMint(state);
  const profile = memoizedGetCurrentProfile(state);

  // Retry logic for wallet operations
  const attemptSend = async (forceRefresh = false): Promise<EcashSendTransaction> => {
    const currentProofs = memoizedGetProofs(unit)(state);
    const balance = memoizedGetBalance(unit)(state);

    console.log('[sendEcash] balance', { balance, amount, currentProofs, selectedMint });

    if (amount > balance) {
      throw new AppError('insufficient_funds', 'Insufficient funds');
    }

    console.log('[sendEcash] getting wallet', { forceRefresh });

    const wallet = await getWallet({
      unit,
      mintUrl: selectedMint,
      profile: null,
      ...(forceRefresh && { forceRefresh: true }),
    });

    console.log('[sendEcash] got wallet', wallet);

    if (!wallet) {
      throw new AppError('wallet_not_found', 'Wallet not found');
    }

    const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    console.log('[sendEcash] activeKeyset', activeKeyset);

    const counter = memoizedGetCounterV2({
      profileId: profile.id,
      mintUrl: wallet.mint.mintUrl,
      keysetId: wallet.keysetId,
    })(state);

    console.log('awd', { currentProofs });

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
    console.log(error.message);
    // Check if it's the specific keyset inactive error
    if (error.message === 'keyset id inactive.') {
      Alert.alert('Updating keyset...');
      console.log('[sendEcash] Keyset inactive, retrying with forceRefresh');
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
    console.log('[receiveEcash] decodedToken', decodedToken);

    try {
      return JSON.parse(decodedToken.proofs[0].secret)[0] === 'P2PK'
        ? JSON.parse(decodedToken.proofs[0].secret)[1].data
        : null;
    } catch (error) {
      console.error('Error parsing token secret:', error);
      return null;
    }
  };

  const giveaway = Object.values(giveaways).find(({ public_key }) => {
    return getPubkeyFromToken(token) === public_key;
  });

  // Retry logic for wallet operations
  const attemptReceive = async (forceRefresh = false): Promise<EcashReceiveTransaction> => {
    console.log('[receiveEcash] getting wallet', { forceRefresh });
    const wallet = await getWallet({
      unit,
      mintUrl: receiveMintUrl,
      profile: null,
      ...(forceRefresh && { forceRefresh: true }),
    });
    console.log('[receiveEcash] got wallet', wallet);

    if (!wallet) {
      throw new AppError('wallet_not_found', 'Wallet not found');
    }

    const activeKeyset = wallet.getActiveKeyset(wallet.keysets.filter((key) => key.unit === unit));
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    console.log('[receiveEcash] activeKeyset', activeKeyset);

    const counter = memoizedGetCounterV2({
      profileId: profile.id,
      mintUrl: receiveMintUrl,
      keysetId: keysetId,
    })(state);

    console.log('[receiveEcash] counter', counter);

    const response = await wallet.receive(token, {
      counter,
      keysetId,
      ...(giveaway ? { privkey: giveaway.private_key } : {}),
    });

    console.log('[receiveEcash] response', response);

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
      ...(giveaway
        ? {
            p2pk: {
              pubkey: giveaway.public_key,
              privkey: giveaway.private_key,
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
    console.log(error.message);
    // Check if it's the specific keyset inactive error
    if (
      error.message === 'keyset id inactive.' ||
      error?.message?.startsWith('Could not calculate fees. No keyset found with id:')
    ) {
      Alert.alert('Updating keyset...');
      console.log('[receiveEcash] Keyset inactive, retrying with forceRefresh');
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
  console.log('[cancelEcashTransaction]', transaction);
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
