import { getMint } from 'helper/cashu';
import {
  ENSURE_PROFILE_EXISTS,
  SET_KEYSETS,
  SET_INFO,
  SET_TRANSACTIONS,
  APPEND_TRANSACTIONS_V2,
  SET_SELECTED_MINT,
  APPEND_PROOFS_V2,
  INCREMENT_COUNTER,
  ADD_MINTS,
  REMOVE_MINTS,
  INCREASE_COUNTER_V2,
  REMOVE_PROOFS,
  RESET_COUNTER,
  UPDATE_TRANSACTION,
  APPEND_TRANSACTION,
  SET_KEYS,
  SET_AUDIT,
} from './actionTypes';
import { MintKeys, MintKeyset, Proof } from '@cashu/cashu-ts';
import { MintInfo } from '@cashu/cashu-ts/lib/types/model/MintInfo';
import { TransactionData } from './selectors';

export const addMints = ({ profileId, mints }: { profileId: number; mints: string[] }) => ({
  type: ADD_MINTS,
  payload: { profileId, mints },
});

export const removeMints = ({ profileId, mints }: { profileId: number; mints: string[] }) => ({
  type: REMOVE_MINTS,
  payload: { profileId, mints },
});

export const setSelectedMint = ({
  profileId,
  mintUrl,
}: {
  profileId: number;
  mintUrl: string;
}) => ({
  type: SET_SELECTED_MINT,
  payload: { profileId, mintUrl },
});

export const setKeysets = ({ mintUrl, keysets }: { mintUrl: string; keysets: MintKeyset[] }) => ({
  type: SET_KEYSETS,
  payload: { mintUrl, keysets },
});

export const setKeys = ({ mintUrl, keys }: { mintUrl: string; keys: MintKeys[] }) => ({
  type: SET_KEYS,
  payload: { mintUrl, keys },
});

export const setInfo = ({ mintUrl, mintInfo }: { mintUrl: string; mintInfo: MintInfo }) => ({
  type: SET_INFO,
  payload: { mintUrl, mintInfo },
});

export const setAudit = ({ mintUrl, audit }) => ({
  type: SET_AUDIT,
  payload: { mintUrl, audit },
});

export const setTransactions = ({
  profileId,
  transactions,
}: {
  profileId: number;
  transactions: TransactionData[];
}) => ({
  type: SET_TRANSACTIONS,
  payload: { profileId, transactions },
});

export const updateTransaction = ({ profileId, matcher, updateFn }) => ({
  type: UPDATE_TRANSACTION,
  payload: {
    profileId,
    matcher,
    updateFn,
  },
});

// Append Transaction Action Creator
export const appendTransaction = ({
  profileId,
  transaction,
}: {
  profileId: number;
  transaction: TransactionData;
}) => ({
  type: APPEND_TRANSACTION,
  payload: {
    profileId,
    transaction,
  },
});

export const appendTransactionsV2 = ({
  profileId,
  transactions,
}: {
  profileId: number;
  transactions: TransactionData[];
}) => ({
  type: APPEND_TRANSACTIONS_V2,
  payload: { profileId, transactions },
});

export const appendProofsV2 = ({
  profileId,
  mintUrl,
  proofs,
}: {
  profileId: number;
  mintUrl: string;
  proofs: Proof[];
}) => ({
  type: APPEND_PROOFS_V2,
  payload: { profileId, mintUrl, proofs },
});

export const removeProofs = ({
  profileId,
  mintUrl,
  proofs,
}: {
  profileId: number;
  mintUrl: string;
  proofs: Proof[];
}) => ({
  type: REMOVE_PROOFS,
  payload: { profileId, mintUrl, proofs },
});

export const incrementCounter = ({
  profileId,
  mintUrl,
  amount,
}: {
  profileId: number;
  mintUrl: string;
  amount: number;
}) => ({
  type: INCREMENT_COUNTER,
  payload: { profileId, mintUrl, amount },
});

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
}) => ({
  type: INCREASE_COUNTER_V2,
  payload: { profileId, mintUrl, keysetId, amount },
});

export const resetCounter = ({ profileId }: { profileId: number }) => ({
  type: RESET_COUNTER,
  payload: { profileId },
});

export const ensureProfileExistsAction = (profileId: number) => ({
  type: ENSURE_PROFILE_EXISTS,
  payload: { profileId },
});

export const updateMint = ({ mintUrl }: { mintUrl: string }) => {
  return async (dispatch) => {
    try {
      const mint = getMint({ mintUrl });

      // Fetch the keyset from the provided mintUrl if not found in cache
      const keysets = (await (await mint).getKeySets()).keysets;
      const keys = (await (await mint).getKeys()).keysets;

      // Step 2: Set the keysets in the store
      dispatch(
        setKeysets({
          mintUrl,
          keysets,
        })
      );

      dispatch(
        setKeys({
          mintUrl,
          keys,
        })
      );

      const mintInfo = await (await mint).getInfo();

      dispatch(
        setInfo({
          mintUrl,
          mintInfo,
        })
      );

      return { success: true };
    } catch (error) {
      // You might want to dispatch an error action here
      return { success: false };
    }
  };
};

export const addMintsAction = ({ profileId, mintUrls }) => {
  return async (dispatch) => {
    try {
      // First update all mints (fetch and store keysets and info)
      const updatePromises = mintUrls.map((mintUrl) => dispatch(updateMint({ mintUrl })));

      // Wait for all updates to complete
      const results = await Promise.all(updatePromises);

      // Check if all updates were successful
      const allSuccessful = results.every((result) => result.success);

      if (allSuccessful) {
        // Add all mints to the profile
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
    } catch (error) {
      return { success: false };
    }
  };
};
