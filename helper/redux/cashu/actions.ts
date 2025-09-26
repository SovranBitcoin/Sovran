import { getMint } from 'helper/cashuClient';
import { toResult } from 'helper/toResult';
import {
  SET_KEYSETS,
  SET_INFO,
  APPEND_TRANSACTIONS_V2,
  SET_SELECTED_MINT,
  APPEND_PROOFS_V2,
  ADD_MINTS,
  REMOVE_MINTS,
  INCREASE_COUNTER_V2,
  REMOVE_PROOFS,
  UPDATE_TRANSACTION,
  APPEND_TRANSACTION,
  SET_KEYS,
  SET_AUDIT,
  SET_ALLOCATION,
  UPDATE_CURRENCY_ALLOCATION,
  RESET_ALLOCATION,
  CLEAR_AUDIT_FOR_MINT,
} from './actionTypes';
import { MintKeys, MintKeyset, Proof } from '@cashu/cashu-ts';
import { TransactionData } from './types';
import { AppThunk } from '../store/reducer';
type MintInfo = any;

export type CashuAction =
  | ReturnType<typeof addMints>
  | ReturnType<typeof removeMints>
  | ReturnType<typeof setSelectedMint>
  | ReturnType<typeof setKeysets>
  | ReturnType<typeof setKeys>
  | ReturnType<typeof setInfo>
  | ReturnType<typeof setAudit>
  | ReturnType<typeof updateTransaction>
  | ReturnType<typeof appendTransaction>
  | ReturnType<typeof appendTransactionsV2>
  | ReturnType<typeof appendProofsV2>
  | ReturnType<typeof removeProofs>
  | ReturnType<typeof increaseCounterV2>
  | ReturnType<typeof setAllocation>
  | ReturnType<typeof updateCurrencyAllocation>
  | ReturnType<typeof resetAllocation>
  | { type: 'CLEAR_PROOFS_FOR_MINT'; payload: { profileId: number; mintUrl: string } }
  | ReturnType<typeof clearAuditForMint>;

export const addMints = ({ profileId, mints }: { profileId: number; mints: string[] }) =>
  ({
    type: ADD_MINTS,
    payload: { profileId, mints },
  }) as const;

export const removeMints = ({ profileId, mints }: { profileId: number; mints: string[] }) =>
  ({
    type: REMOVE_MINTS,
    payload: { profileId, mints },
  }) as const;

// Thunk to perform full mint removal cleanup logic
export const removeMintsAction = ({
  profileId,
  mints,
}: {
  profileId: number;
  mints: string[];
}): AppThunk<{ success: boolean }> => {
  return async (dispatch: any, getState: any) => {
    // Debug: starting removeMintsAction
    console.log('[removeMintsAction] start', { profileId, mints });

    const state = getState();
    console.log('[removeMintsAction] current allocation snapshot', state.cashu?.allocation);

    // 1) Remove from the user's mint list
    console.log('[removeMintsAction] removing from profile mints array');
    dispatch(
      removeMints({
        profileId,
        mints,
      })
    );

    // 2) Clear keysets and keys for each mint
    mints.forEach((mintUrl) => {
      console.log('[removeMintsAction] clearing keysets/keys', mintUrl);
      dispatch(
        setKeysets({
          mintUrl,
          keysets: [],
        })
      );

      dispatch(
        setKeys({
          mintUrl,
          keys: [],
        })
      );
    });

    // 3) Remove proofs key only if empty
    mints.forEach((mintUrl) => {
      const proofsForMint = state.cashu?.profiles?.[profileId]?.proofs?.[mintUrl];
      console.log('[removeMintsAction] proofs check', mintUrl, {
        hasProofs: Array.isArray(proofsForMint) && proofsForMint.length > 0,
        length: proofsForMint?.length ?? 0,
      });
      if (!proofsForMint || proofsForMint.length === 0) {
        console.log('[removeMintsAction] clearing empty proofs key', mintUrl);
        dispatch({
          type: 'CLEAR_PROOFS_FOR_MINT',
          payload: { profileId, mintUrl },
        });
      }
    });

    // 4) Allocation redistribution per currency if needed
    const allocation: Record<string, Record<string, number>> = state.cashu.allocation || {};
    const updatedAllocation: Record<string, Record<string, number>> = { ...allocation };

    Object.keys(allocation).forEach((currency) => {
      const currencyAllocation = { ...allocation[currency] };
      let didChangeCurrency = false;
      mints.forEach((mintUrl) => {
        const value = currencyAllocation[mintUrl];
        if (typeof value !== 'number') {
          // not present, nothing to do
          return;
        }

        if (value <= 0) {
          // just delete this key
          console.log('[removeMintsAction] allocation delete (zero)', { currency, mintUrl });
          const { [mintUrl]: _, ...rest } = currencyAllocation;
          updatedAllocation[currency] = rest;
          didChangeCurrency = true;
          return;
        }

        // redistribute this value among other mints that have positive allocation
        const others = Object.entries(currencyAllocation)
          .filter(([url, v]) => url !== mintUrl && typeof v === 'number' && v > 0)
          .map(([url, v]) => ({ url, value: v as number }));

        if (others.length === 0) {
          // last one with value, remove it entirely
          console.log('[removeMintsAction] allocation last-one removal', { currency, mintUrl });
          const { [mintUrl]: _, ...rest } = currencyAllocation;
          updatedAllocation[currency] = rest;
          didChangeCurrency = true;
          return;
        }

        // Evenly distribute "value" across the remaining mints with positive allocation
        const base = Math.floor(value / others.length);
        const remainder = value - base * others.length;
        console.log('[removeMintsAction] allocation redistribute', {
          currency,
          mintUrl,
          value,
          others: others.map((o) => o.url),
          base,
          remainder,
        });

        const nextCurrencyAllocation = { ...currencyAllocation };
        // remove deleted mint
        delete nextCurrencyAllocation[mintUrl];

        others.forEach((other, index) => {
          const extra = index < remainder ? 1 : 0; // distribute remainder across first N
          nextCurrencyAllocation[other.url] = other.value + base + extra;
        });

        updatedAllocation[currency] = nextCurrencyAllocation;
        didChangeCurrency = true;
      });
      if (didChangeCurrency) {
        console.log(
          '[removeMintsAction] updated currency allocation',
          currency,
          updatedAllocation[currency]
        );
      }
    });

    // Update allocation if it changed
    if (JSON.stringify(updatedAllocation) !== JSON.stringify(allocation)) {
      console.log('[removeMintsAction] dispatch setAllocation');
      dispatch(setAllocation(updatedAllocation));
    }

    // 5) Clear audits for these mints
    mints.forEach((mintUrl) => {
      console.log('[removeMintsAction] clearing audit', mintUrl);
      dispatch(clearAuditForMint(mintUrl));
    });

    console.log('[removeMintsAction] done');
    return { success: true };
  };
};

export const setSelectedMint = ({ profileId, mintUrl }: { profileId: number; mintUrl: string }) =>
  ({
    type: SET_SELECTED_MINT,
    payload: { profileId, mintUrl },
  }) as const;

export const setKeysets = ({ mintUrl, keysets }: { mintUrl: string; keysets: MintKeyset[] }) =>
  ({
    type: SET_KEYSETS,
    payload: { mintUrl, keysets },
  }) as const;

export const setKeys = ({ mintUrl, keys }: { mintUrl: string; keys: MintKeys[] }) =>
  ({
    type: SET_KEYS,
    payload: { mintUrl, keys },
  }) as const;

export const setInfo = ({ mintUrl, mintInfo }: { mintUrl: string; mintInfo: MintInfo }) =>
  ({
    type: SET_INFO,
    payload: { mintUrl, mintInfo },
  }) as const;

export const setAudit = ({ mintUrl, audit }: { mintUrl: string; audit: any }) =>
  ({
    type: SET_AUDIT,
    payload: { mintUrl, audit },
  }) as const;

export const updateTransaction = ({
  profileId,
  matcher,
  updateFn,
}: {
  profileId: number;
  matcher: (tx: TransactionData) => boolean;
  updateFn: (tx: TransactionData) => TransactionData;
}) =>
  ({
    type: UPDATE_TRANSACTION,
    payload: {
      profileId,
      matcher,
      updateFn,
    },
  }) as const;

// Append Transaction Action Creator
export const appendTransaction = ({
  profileId,
  transaction,
}: {
  profileId: number;
  transaction: TransactionData;
}) =>
  ({
    type: APPEND_TRANSACTION,
    payload: {
      profileId,
      transaction,
    },
  }) as const;

export const appendTransactionsV2 = ({
  profileId,
  transactions,
}: {
  profileId: number;
  transactions: TransactionData[];
}) =>
  ({
    type: APPEND_TRANSACTIONS_V2,
    payload: { profileId, transactions },
  }) as const;

export const appendProofsV2 = ({
  profileId,
  mintUrl,
  proofs,
}: {
  profileId: number;
  mintUrl: string;
  proofs: Proof[];
}) =>
  ({
    type: APPEND_PROOFS_V2,
    payload: { profileId, mintUrl, proofs },
  }) as const;

export const removeProofs = ({
  profileId,
  mintUrl,
  proofs,
}: {
  profileId: number;
  mintUrl: string;
  proofs: Proof[];
}) =>
  ({
    type: REMOVE_PROOFS,
    payload: { profileId, mintUrl, proofs },
  }) as const;

export const increaseCounterV2 = ({
  profileId,
  mintUrl,
  keysetId,
  amount,
}: {
  profileId: number;
  mintUrl: string;
  keysetId: string;
  amount: number;
}) =>
  ({
    type: INCREASE_COUNTER_V2,
    payload: { profileId, mintUrl, keysetId, amount },
  }) as const;

export const updateMint = ({ mintUrl }: { mintUrl: string }): AppThunk<{ success: boolean }> => {
  return async (dispatch: any) => {
    const mintRes = await getMint({ mintUrl, forceRefresh: true });
    if (mintRes.isErr()) {
      return { success: false };
    }
    const mint = mintRes.value;

    const keysetsRes = await toResult(mint.getKeySets());
    const keysRes = await toResult(mint.getKeys());
    if (keysetsRes.isErr() || keysRes.isErr()) {
      return { success: false };
    }

    dispatch(
      setKeysets({
        mintUrl,
        keysets: keysetsRes.value.keysets,
      })
    );

    dispatch(
      setKeys({
        mintUrl,
        keys: keysRes.value.keysets,
      })
    );

    const mintInfoRes = await toResult(mint.getInfo());
    if (mintInfoRes.isErr()) {
      return { success: false };
    }

    dispatch(
      setInfo({
        mintUrl,
        mintInfo: mintInfoRes.value,
      })
    );

    return { success: true };
  };
};

export const addMintsAction = ({
  profileId,
  mintUrls,
}: {
  profileId: number;
  mintUrls: string[];
}): AppThunk<{ success: boolean; error?: string }> => {
  return async (dispatch: any) => {
    // First update all mints (fetch and store keysets and info)
    const updatePromises = mintUrls.map((mintUrl: string) => dispatch(updateMint({ mintUrl })));

    const results = await Promise.all(updatePromises);

    const allSuccessful = results.every((result) => result.success);

    if (allSuccessful) {
      dispatch(
        addMints({
          profileId,
          mints: mintUrls,
        })
      );

      return { success: true };
    } else {
      return { success: false, error: 'Some mint updates failed' };
    }
  };
};

export const setAllocation = (allocation: Record<string, Record<string, number>>) =>
  ({
    type: SET_ALLOCATION,
    payload: allocation,
  }) as const;

export const updateCurrencyAllocation = (currency: string, allocation: Record<string, number>) =>
  ({
    type: UPDATE_CURRENCY_ALLOCATION,
    payload: {
      currency,
      allocation,
    },
  }) as const;

export const resetAllocation = () =>
  ({
    type: RESET_ALLOCATION,
  }) as const;

export const clearAuditForMint = (mintUrl: string) =>
  ({
    type: CLEAR_AUDIT_FOR_MINT,
    payload: { mintUrl },
  }) as const;
