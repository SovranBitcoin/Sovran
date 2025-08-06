import _ from 'lodash/fp';
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
import { ensureProfileExists } from './helpers';
import { CashuState } from './types';
import { Reducer } from 'redux';
import { CashuAction } from './actions';
import { typedSet, typedUpdate } from 'helper/typedUpdate';

const initialState: CashuState = {
  profiles: [
    {
      selectedMint: undefined,
      mints: [],
      proofs: {},
      counters: {},
      keysets: {},
      transactions: [],
    },
  ],
  audits: {},
  info: {},
  keys: {},
  keysets: {},
  allocation: {},
};

export const cashuReducer: Reducer<CashuState, CashuAction> = (
  state = initialState,
  action
): CashuState => {
  if (
    'payload' in action &&
    action.payload &&
    typeof action.payload === 'object' &&
    'profileId' in action.payload &&
    typeof action.payload.profileId === 'number'
  ) {
    state = ensureProfileExists(state, action.payload.profileId);
  }

  switch (action.type) {
    case ADD_MINTS:
      return typedUpdate(
        `profiles[${action.payload.profileId}].mints`,
        (existingMints = ['https://mint.sovran.money']) => [
          ...existingMints,
          ...action.payload.mints,
        ],
        state
      );
    case ENSURE_PROFILE_EXISTS:
      return ensureProfileExists(state, action.payload.profileId);

    case REMOVE_MINTS:
      return typedUpdate(
        `profiles[${action.payload.profileId}].mints` as const,
        (mints = []) => mints.filter((mint) => !action.payload.mints.includes(mint)),
        state
      );

    case SET_KEYSETS:
      return typedSet(['keysets', action.payload.mintUrl] as const, action.payload.keysets, state);

    case SET_KEYS:
      return typedSet(['keys', action.payload.mintUrl] as const, action.payload.keys, state);

    case SET_INFO:
      return typedSet(['info', action.payload.mintUrl] as const, action.payload.mintInfo, state);

    case SET_AUDIT:
      return typedSet(['audits', action.payload.mintUrl] as const, action.payload.audit, state);

    case SET_TRANSACTIONS:
      return typedSet(
        `profiles[${action.payload.profileId}].transactions` as const,
        action.payload.transactions,
        state
      );

    case UPDATE_TRANSACTION: {
      const { profileId, updateFn, matcher = () => false } = action.payload;

      return typedUpdate(
        `profiles[${profileId}].transactions` as const,
        // map over the existing list (defaulting to [] if undefined)
        (transactions = []) => transactions.map((tx) => (matcher(tx) ? updateFn(tx) : tx)),
        state
      );
    }

    case APPEND_TRANSACTION: {
      const { profileId, transaction } = action.payload;

      return typedUpdate(
        `profiles[${profileId}].transactions` as const,
        // append the new transaction (defaulting to [] if undefined)
        (transactions = []) => [...transactions, transaction],
        state
      );
    }

    case APPEND_TRANSACTIONS_V2: {
      const { profileId, transactions: newTxs } = action.payload;
      return typedUpdate(
        `profiles[${profileId}].transactions` as const,
        (transactions = []) => [...transactions, ...newTxs],
        state
      );
    }

    case SET_SELECTED_MINT: {
      const { profileId, mintUrl } = action.payload;
      return typedSet(`profiles[${profileId}].selectedMint` as const, mintUrl, state);
    }

    case APPEND_PROOFS_V2: {
      const { profileId, mintUrl, proofs: newProofs } = action.payload;

      return typedUpdate(
        ['profiles', profileId, 'proofs', mintUrl] as const,
        // append & dedupe
        (proofs = []) => {
          const combined = [...proofs, ...newProofs];
          return combined.filter(
            (item, index, self) =>
              index === self.findIndex((t) => JSON.stringify(t) === JSON.stringify(item))
          );
        },
        state
      );
    }

    case REMOVE_PROOFS: {
      const { profileId, mintUrl, proofs: toRemove } = action.payload;

      return typedUpdate(
        ['profiles', profileId, 'proofs', mintUrl] as const,
        (proofs = []) =>
          proofs.filter((proof) => {
            // remove if it matches any of the proofs in toRemove
            const shouldRemove = toRemove.some((usedProof) => {
              const pick = ({ C, secret, amount }: any) => ({ C, secret, amount });
              return _.isEqual(pick(proof), pick(usedProof));
            });
            return !shouldRemove;
          }),
        state
      );
    }

    case RESET_COUNTER: {
      const { profileId } = action.payload;
      return typedSet(
        // reset the entire counters object
        `profiles[${profileId}].counters` as const,
        {},
        state
      );
    }

    case INCREASE_COUNTER_V2: {
      const { profileId, mintUrl, keysetId, amount } = action.payload;
      return typedUpdate(
        // drill into the specific counter
        ['profiles', profileId, 'counters', mintUrl, keysetId] as const,
        // default is 1, then add the payload amount
        (count = 1) => count + amount,
        state
      );
    }

    case SET_ALLOCATION: {
      return typedUpdate('allocation' as const, () => action.payload, state);
    }

    case UPDATE_CURRENCY_ALLOCATION: {
      return typedUpdate(
        'allocation' as const,
        (allocation) => ({
          ...allocation,
          [action.payload.currency]: action.payload.allocation,
        }),
        state
      );
    }

    case RESET_ALLOCATION: {
      return typedUpdate('allocation' as const, () => ({}), state);
    }

    default:
      return state;
  }
};
