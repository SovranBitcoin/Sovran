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
} from './actionTypes';

export const addMints = ({ profileId, mints }) => ({
  type: ADD_MINTS,
  payload: { profileId, mints },
});

export const removeMints = ({ profileId, mints }) => ({
  type: REMOVE_MINTS,
  payload: { profileId, mints },
});

export const setSelectedMint = ({ profileId, mintUrl }) => ({
  type: SET_SELECTED_MINT,
  payload: { profileId, mintUrl },
});

export const setKeysets = ({ mintUrl, keysets }) => ({
  type: SET_KEYSETS,
  payload: { mintUrl, keysets },
});

export const setKeys = ({ mintUrl, keys }) => ({
  type: SET_KEYS,
  payload: { mintUrl, keys },
});

export const setInfo = ({ mintUrl, mintInfo }) => ({
  type: SET_INFO,
  payload: { mintUrl, mintInfo },
});

export const setTransactions = ({ profileId, transactions }) => ({
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
export const appendTransaction = ({ profileId, transaction }) => ({
  type: APPEND_TRANSACTION,
  payload: {
    profileId,
    transaction,
  },
});

export const appendTransactionsV2 = ({ profileId, transactions }) => ({
  type: APPEND_TRANSACTIONS_V2,
  payload: { profileId, transactions },
});

export const appendProofsV2 = ({ profileId, mintUrl, proofs }) => ({
  type: APPEND_PROOFS_V2,
  payload: { profileId, mintUrl, proofs },
});

export const removeProofs = ({ profileId, mintUrl, proofs }) => ({
  type: REMOVE_PROOFS,
  payload: { profileId, mintUrl, proofs },
});

export const incrementCounter = ({ profileId, mintUrl, amount }) => ({
  type: INCREMENT_COUNTER,
  payload: { profileId, mintUrl, amount },
});

export const increaseCounterV2 = ({ profileId, mintUrl, keysetId, amount }) => ({
  type: INCREASE_COUNTER_V2,
  payload: { profileId, mintUrl, keysetId, amount },
});

export const resetCounter = ({ profileId, mintUrl, keysetId }) => ({
  type: RESET_COUNTER,
  payload: { profileId },
});

export const ensureProfileExistsAction = (profileId) => ({
  type: ENSURE_PROFILE_EXISTS,
  payload: { profileId },
});

export const updateMint = ({ mintUrl }) => {
  return async (dispatch) => {
    try {
      const mint = getMint({ mintUrl });

      // Fetch the keyset from the provided mintUrl if not found in cache
      const keysets = (await (await mint).getKeys()).keysets;

      // Step 2: Set the keysets in the store
      dispatch(
        setKeysets({
          mintUrl,
          keysets,
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
