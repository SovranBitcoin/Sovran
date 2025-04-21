import { AppError } from 'components/cashu';
import { getKeys, getWallet } from '.';
import {
  appendProofsV2,
  appendTransaction,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetSelectedMint,
  removeProofs,
} from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { getPaymentRequest } from './ecash';

interface SendLightningProps {
  mintUrl?: string;
  pr: string;
  unit: string;
  pubkey?: string;
  meltQuote: any;
  mpp?: boolean;
}

type SendLightningResponse = void;

export async function sendLightning({
  mintUrl = memoizedGetSelectedMint(store.getState()),
  pr,
  unit,
  pubkey,
  meltQuote,
  mpp = false,
}: SendLightningProps): Promise<SendLightningResponse> {
  const keys = await getKeys({ unit, mintUrl });

  const profileId = store.getState().nostr?.currentProfile?.id;
  const allProofs = store.getState().cashu?.profiles[profileId]?.proofs?.[mintUrl];

  const currentProofs = allProofs.filter((p: { id: string }) => p?.id === keys.id);

  let fee, amount;

  const wallet = await getWallet({ unit, mintUrl, profile: null });

  fee = meltQuote.fee_reserve;

  amount = meltQuote.amount;

  if (!amount) {
    throw new AppError('invalid_invoice', 'No amount specified in payment request');
  }

  const balance = currentProofs
    .map((p: { amount: number }) => p.amount)
    .reduce((a: number, b: number) => a + b, 0);
  if (amount + fee > balance) {
    throw new AppError('insufficient_funds', 'Insufficient funds');
  }

  try {
    const profileId = store.getState().nostr?.currentProfile?.id;

    const counter = memoizedGetCounterV2({
      profileId,
      mintUrl,
      keysetId: wallet.keysetId,
    })(store.getState());

    const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(
      meltQuote.amount + meltQuote.fee_reserve,
      currentProofs,
      {
        counter: counter, // it's going up forever, laura
      }
    );

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
        proofs: proofsToSend,
      })
    );

    store.dispatch(
      appendProofsV2({
        profileId,
        mintUrl,
        proofs: [...proofsToKeep, ...change],
      })
    );

    store.dispatch(
      appendTransaction({
        profileId,
        transaction: {
          request: pr,
          amount: amount,
          date: new Date().toISOString(),
          type: 'lightning',
          transactionType: 'send',
          unit,
          paid: true,
          meltQuote,
          mpp,
          mintUrl,
          nostr: {
            pubkey,
          },
          counter,
          proofs: {
            change,
            keep: proofsToKeep,
            send: proofsToSend,
          },
        },
      })
    );
  } catch (error) {
    throw new Error(error.message);
  }
}

interface ReceiveLightningProps {
  amount: number;
  unit: string;
  isSweep: boolean;
  isNpubcash: boolean;
  sweepId: string;
  memo?: string;
}

export async function receiveLightning({
  amount,
  unit,
  isSweep = false,
  isNpubcash = false,
  memo = undefined,
  sweepId,
}: ReceiveLightningProps): Promise<any> {
  const selectedMint = memoizedGetSelectedMint(store.getState());
  const profileId = store.getState().nostr?.currentProfile?.id;
  try {
    const wallet = await getWallet({
      unit,
      mintUrl: selectedMint,
      profile: null,
    });

    const { quote, code, detail, error, request } = await wallet.createMintQuote(amount, memo);

    if (error) {
      throw new AppError('quote_error', 'Error getting mint quote');
    }

    const transaction = {
      request,
      quote,
      code,
      detail,
      error,
      amount,
      date: new Date().toISOString(),
      type: 'lightning',
      paid: false,
      transactionType: 'receive',
      unit,
      isSweep,
      sweepId,
      isNpubcash,
      mintUrl: wallet.mint.mintUrl,
    };

    const paymentRequest_ = await getPaymentRequest({
      amount: amount,
      unit: unit,
      description: '',
    });
    transaction.payment_request = paymentRequest_.toEncodedRequest();
    paymentRequest_.description = request;
    transaction.unified_request = paymentRequest_.toEncodedRequest();

    store.dispatch(
      appendTransaction({
        profileId,
        transaction,
      })
    );

    return transaction;
  } catch (error) {
    throw error;
  }
}
