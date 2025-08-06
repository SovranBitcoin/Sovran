import { getMint } from 'helper/cashuClient';
import { toResult } from 'helper/toResult';
import {
  ENSURE_PROFILE_EXISTS,
  SET_KEYSETS,
  SET_INFO,
  SET_TRANSACTIONS,
  APPEND_TRANSACTIONS_V2,
  SET_SELECTED_MINT,
  APPEND_PROOFS_V2,
  ADD_MINTS,
  REMOVE_MINTS,
  INCREASE_COUNTER_V2,
  REMOVE_PROOFS,
  RESET_COUNTER,
  UPDATE_TRANSACTION,
  APPEND_TRANSACTION,
  SET_KEYS,
  SET_AUDIT,
  SET_ALLOCATION,
  UPDATE_CURRENCY_ALLOCATION,
  RESET_ALLOCATION,
} from './actionTypes';
import { MintKeys, MintKeyset, Proof } from '@cashu/cashu-ts';
import { MintInfo } from '@cashu/cashu-ts/lib/types/model/MintInfo';
import { TransactionData } from './types';
import { AppThunk } from '../store/reducer';

export type CashuAction =
  | ReturnType<typeof addMints>
  | ReturnType<typeof removeMints>
  | ReturnType<typeof setSelectedMint>
  | ReturnType<typeof setKeysets>
  | ReturnType<typeof setKeys>
  | ReturnType<typeof setInfo>
  | ReturnType<typeof setAudit>
  | ReturnType<typeof setTransactions>
  | ReturnType<typeof updateTransaction>
  | ReturnType<typeof appendTransaction>
  | ReturnType<typeof appendTransactionsV2>
  | ReturnType<typeof appendProofsV2>
  | ReturnType<typeof removeProofs>
  | ReturnType<typeof increaseCounterV2>
  | ReturnType<typeof resetCounter>
  | ReturnType<typeof ensureProfileExistsAction>
  | ReturnType<typeof setAllocation>
  | ReturnType<typeof updateCurrencyAllocation>
  | ReturnType<typeof resetAllocation>;

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

export const setTransactions = ({
  profileId,
  transactions,
}: {
  profileId: number;
  transactions: TransactionData[];
}) =>
  ({
    type: SET_TRANSACTIONS,
    payload: { profileId, transactions },
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

export const resetCounter = ({ profileId }: { profileId: number }) =>
  ({
    type: RESET_COUNTER,
    payload: { profileId },
  }) as const;

export const ensureProfileExistsAction = (profileId: number) =>
  ({
    type: ENSURE_PROFILE_EXISTS,
    payload: { profileId },
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
