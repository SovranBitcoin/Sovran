import _ from 'lodash/fp';
import {
  ENSURE_PROFILE_EXISTS,
  SET_KEYSETS,
  SET_INFO,
  SET_PROOFS,
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
import { ensureProfileExists } from './helpers';

const initialState = {
  profiles: [
    {
      selectedMint: null,
      mints: [],
      proofs: {},
      counters: {},
      keysets: {},
      transactions: [],
    },
  ],
};

export const cashuReducer = (state = initialState, action) => {
  if (action?.payload?.profileId !== undefined) {
    state = ensureProfileExists(state, action.payload.profileId);
  }

  switch (action.type) {
    case ADD_MINTS:
      return _.update(
        ['profiles', action.payload.profileId, 'mints'],
        (mints = []) => [...mints, ...action.payload.mints],
        state
      );

    case REMOVE_MINTS:
      return _.update(
        ['profiles', action.payload.profileId, 'mints'],
        (mints = []) => mints.filter((mint) => !action.payload.mints.includes(mint)),
        state
      );

    case ENSURE_PROFILE_EXISTS:
      return ensureProfileExists(state, action.payload.profileId);

    case SET_KEYSETS:
      return _.set(['keysets', action.payload.mintUrl], action.payload.keysets, state);

    case SET_KEYS:
      return _.set(['keys', action.payload.mintUrl], action.payload.keys, state);

    case SET_INFO:
      return _.set(['info', action.payload.mintUrl], action.payload.mintInfo, state);

    case SET_PROOFS:
      return _.set(
        ['profiles', action.payload.profileId, 'proofs', action.payload.mintUrl],
        action.payload.proofs,
        state
      );

    case SET_TRANSACTIONS:
      return _.set(
        ['profiles', action.payload.profileId, 'transactions'],
        action.payload.transactions,
        state
      );

    case UPDATE_TRANSACTION: {
      const { profileId, updateFn, matcher = () => false } = action.payload;

      return _.update(
        ['profiles', profileId, 'transactions'],
        _.map((tx) => (matcher(tx) ? updateFn(tx) : tx)),
        state
      );
    }

    case APPEND_TRANSACTION: {
      const { profileId, transaction } = action.payload;

      return _.update(
        ['profiles', profileId, 'transactions'],
        (transactions = []) => {
          return _.concat(transactions, transaction);
        },
        state
      );
    }

    case APPEND_TRANSACTIONS_V2:
      // check if tx already exists inside transactions and return early
      return _.update(
        ['profiles', action.payload.profileId, 'transactions'],
        (transactions = []) => _.concat(transactions, action.payload.transactions),
        state
      );

    case SET_SELECTED_MINT:
      return _.set(
        ['profiles', action.payload.profileId, 'selectedMint'],
        action.payload.mintUrl,
        state
      );

    case APPEND_PROOFS_V2:
      return _.update(
        ['profiles', action.payload.profileId, 'proofs', action.payload.mintUrl],
        (proofs = []) => {
          return _.unionBy(proofs, action.payload.proofs, 'secret');
        },
        state
      );

    case REMOVE_PROOFS:
      return _.update(
        ['profiles', action.payload.profileId, 'proofs', action.payload.mintUrl],
        (proofs = []) => {
          console.log('action.payload.proofs', action.payload.proofs);
          // Remove proofs from state which are in action.payload.proofs
          // _.isEqual(
          //   _.pick(existingProof, ['C', 'secret', 'amount']),
          //   _.pick(usedProof, ['C', 'secret', 'amount'])
          // )
          // So loop over every proof, and check if the same C , secret and amount exists in action.payload.proofs
          console.log('proofs', proofs);
          return proofs.filter((proof) => {
            console.log('proof', proof);
            const shouldRemove = action.payload.proofs.some((usedProof) => {
              const proofPicked = {
                C: proof.C,
                secret: proof.secret,
                amount: proof.amount,
              };
              const usedProofPicked = {
                C: usedProof.C,
                secret: usedProof.secret,
                amount: usedProof.amount,
              };
              const isMatch = _.isEqual(proofPicked, usedProofPicked);

              if (isMatch) {
                console.log('Match found:', { proofPicked, usedProofPicked });
              }

              return isMatch;
            });

            return !shouldRemove; // Keep proofs that shouldn't be removed
          });
        },
        state
      );

    case INCREMENT_COUNTER:
      return _.update(
        ['profiles', action.payload.profileId, 'counters', action.payload.mintUrl],
        (count = 1) => count + action.payload.amount,
        state
      );

    case RESET_COUNTER:
      const { profileId } = action.payload;
      return _.set(['profiles', profileId, 'counters'], {}, state);

    case INCREASE_COUNTER_V2: {
      const { profileId, mintUrl, keysetId, amount } = action.payload;
      return _.update(
        ['profiles', profileId, 'counters', mintUrl, keysetId],
        (count = 1) => count + amount,
        state
      );
    }

    default:
      return state;
  }
};
