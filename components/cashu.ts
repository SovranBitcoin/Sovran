import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { decode } from '@gandlaf21/bolt11-decode';
import {
  appendProofsV2,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetTransactions,
  updateTransaction,
} from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { getKeys, getWallet, sendLightning } from 'helper/cashu';
import { Alert } from 'react-native';
import { publishWalletEvent } from 'helper/nostr/cashu';
import { convertTime } from 'helper/time';
import { showMessage } from 'helper/popup/popups';
import dayjs from 'dayjs';

// Lightning invoice parsing utilities
export function getLightningAmount({ pr }) {
  const decodedPR = decode(pr as string);
  return decodedPR.sections.find((route) => route.name === 'amount')?.value / 1000;
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
  } catch (error) {
    return false;
  }
}

// Error handling
export class AppError extends Error {
  static messageMap = {};

  constructor(name, message) {
    const mappedError = AppError.messageMap[message];
    super(mappedError?.message || message);
    this.name = mappedError?.name || name;
  }
}

// Transaction processing utilities
export async function checkSpecificTransaction({ quoteToCheck }) {
  const profileId = store.getState().nostr?.currentProfile?.id;
  const transactions = memoizedGetTransactions({ id: profileId })(store.getState());

  // Find and validate transaction
  const tx = transactions.find((transaction) => transaction.quote === quoteToCheck);
  if (!tx || tx.paid) return;

  const { quote, amount, unit, mintUrl } = tx;
  const keyset = await getKeys({ unit, mintUrl });

  try {
    const wallet = await getWallet({ unit, mintUrl });
    const isUnpaid = (await wallet.checkMintQuote(quote)).state === 'UNPAID';
    if (isUnpaid) return;

    const proofs = await wallet.mintProofs(amount, quote, { keysetId: keyset.id });
    const balance = proofs.reduce((total, proof) => total + proof.amount, 0);

    if (balance > 0) {
      showMessage('funds_received', { amount: balance, unit: keyset.unit }, { emoji: '🎉' });
    }

    await updateStateAfterPayment(profileId, proofs, quote, mintUrl);
  } catch (error) {
    // Silent error handling
  }
}

// Helper to update state after successful payment
export async function updateStateAfterPayment(profileId, proofs, quote, mintUrl) {
  await store.dispatch(
    appendProofsV2({
      profileId,
      mintUrl,
      proofs: proofs,
    })
  );

  await store.dispatch(
    updateTransaction({
      profileId,
      matcher: (tx) =>
        tx?.mintQuote?.quote === quote || (!tx.paid && tx.fromNIP05 && tx.type === 'ecash'),
      updateFn: (tx) => ({ ...tx, paid: true }),
    })
  );
}

// Payment checking utilities
export async function loopOverCheckLnPaymentComplete({
  transaction = {},
  abortSignal,
  callback = () => {},
}) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  while (!abortSignal?.aborted) {
    await checkLNPaymentComplete({ transaction, callback });
    await delay(3000);
  }
}

export async function checkLNPaymentComplete({ transaction, callback = () => {} }) {
  const profileId = store.getState().nostr?.currentProfile?.id;
  console.log('[checkLNPaymentComplete.profileId]', profileId);
  const transactions = memoizedGetTransactions({ id: profileId })(store.getState());
  console.log('[checkLNPaymentComplete.transactions]', transactions);
  const sortedTransactions = transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log('[checkLNPaymentComplete.sortedTransactions]', sortedTransactions);
  const transactionsToCheck = transaction.quote
    ? [transactions.find((t) => t.mintQuote.quote === transaction.mintQuote.quote)]
    : sortedTransactions;
  console.log('[checkLNPaymentComplete.transactionsToCheck]', transactionsToCheck);
  for (const tx of transactionsToCheck) {
    if (!tx || tx.paid || new Date() > getRawExpiry({ pr: tx.request })) continue;
    // Skip if another transaction with the same sweepId is already paid
    if (
      tx.isSweep &&
      sortedTransactions.some((t) => t.isSweep && t.sweepId === tx.sweepId && t.paid)
    ) {
      continue;
    }
    console.log('[checkLNPaymentComplete.transaction]', tx);
    const { mintQuote, amount, unit, mintUrl } = tx;
    const keyset = await getKeys({ unit, mintUrl });
    try {
      const wallet = await getWallet({ unit, mintUrl, profile: null });
      const isUnpaid = (await wallet.checkMintQuote(mintQuote.quote)).state === 'UNPAID';

      if (isUnpaid) continue;

      const counter = memoizedGetCounterV2({
        profileId,
        mintUrl,
        keysetId: wallet.keysetId,
      })(store.getState());

      const proofs = await wallet.mintProofs(amount, mintQuote.quote, {
        counter,
        keysetId: wallet.keysetId,
      });
      console.log('[checkLNPaymentComplete.proofs]', proofs);

      store.dispatch(
        increaseCounterV2({
          profileId,
          mintUrl,
          keysetId: wallet.keysetId,
          amount: proofs.length,
        })
      );
      const balance = proofs.reduce((total, proof) => total + proof.amount, 0);
      if (balance > 0) {
        showMessage('funds_received', { amount: balance, unit: keyset.unit }, { emoji: '🎉' }, () =>
          callback()
        );
      }
      await updateStateAfterPayment(profileId, proofs, mintQuote.quote, mintUrl);
      publishWalletEvent([
        ...new Set([
          ...store.getState().cashu?.profiles?.[profileId]?.transactions.map((t) => t.mintUrl),
          mintUrl,
        ]),
      ]);
    } catch (err) {
      console.log('[checkLNPaymentComplete.error]', err);
      Alert.alert('error', JSON.stringify(err));
    }
  }
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

  console.log(123233, { meltQuote });

  return meltQuote;
}

export async function sendMultiPathPayment({ pr }) {
  try {
    const quoteA = await getMeltQuote({
      pr,
      unit: 'sat',
      mintUrl: 'https://mint.utxo.one',
      mppAmount: 10,
    });

    const quoteB = await getMeltQuote({
      pr,
      unit: 'sat',
      mintUrl: 'https://mint.utxo.one',
      mppAmount: 10,
    });

    await sendLightning({
      pr,
      unit: 'sat',
      meltQuote: quoteA,
      mintUrl: 'https://mint.utxo.one',
      mpp: true,
    });

    await sendLightning({
      pr,
      unit: 'sat',
      meltQuote: quoteB,
      mintUrl: 'https://mint.103100.xyz',
      mpp: true,
    });
  } catch (err) {
    // Silent error handling
  }
}

// WebSocket monitoring
export async function monitorLightningPayment({
  mintUrl,
  subId,
  bolt11Invoice,
  subscriptionKind = 'bolt11_mint_quote',
  onUpdate,
}) {
  const wsUrl = `${mintUrl.replace(/\/$/, '')}/v1/ws`;
  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    const subscribeMessage = {
      jsonrpc: '2.0',
      method: 'subscribe',
      params: {
        kind: subscriptionKind,
        subId: subId,
        filters: [bolt11Invoice],
      },
      id: 1,
    };
    socket.send(JSON.stringify(subscribeMessage));
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'subscribe' && data.params?.subId === subId) {
      onUpdate(data.params.payload);
    } else if (data.error) {
    }
  };

  socket.onerror = (error) => {};

  return () => {
    const unsubscribeMessage = {
      jsonrpc: '2.0',
      method: 'unsubscribe',
      params: { subId: subId },
      id: 2,
    };
    socket.send(JSON.stringify(unsubscribeMessage));
    socket.close();
  };
}

export async function startMonitoringLightningInvoice(invoice) {
  const mintUrl = 'https://mint.minibits.cash/Bitcoin';
  const subId = 'your-unique-subscription-id';

  return monitorLightningPayment({
    mintUrl,
    subId,
    bolt11Invoice: invoice,
    subscriptionKind: 'bolt11_mint_quote',
    onUpdate: (payload) => {
      // Handler for updates
    },
  });
}

export * from '../helper/cashu/index';
