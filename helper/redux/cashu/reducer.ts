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
  SET_AUDIT,
} from './actionTypes';
import { ensureProfileExists } from './helpers';
import { CashuState } from './types';
import { CashuAction } from './actions';
import { Reducer } from 'redux';
import { typedUpdate } from 'helper/typedUpdate';

const initialState: CashuState = {
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
  keysets: {},
  keys: {},
  info: {},
  audits: {},
};
export const cashuReducer: Reducer<CashuState, CashuAction> = (
  state = initialState,
  action
): CashuState => {
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
      return typedUpdate('keysets', (ks) => ({
        ...ks,
        [action.payload.mintUrl]: action.payload.keysets,
      }), state);

    case SET_KEYS:
      return typedUpdate('keys', (ks) => ({
        ...ks,
        [action.payload.mintUrl]: action.payload.keys,
      }), state);

    case SET_INFO:
      return typedUpdate('info', (info) => ({
        ...info,
        [action.payload.mintUrl]: action.payload.mintInfo,
      }), state);

    case SET_AUDIT:
      return typedUpdate('audits', (audits) => ({
        ...audits,
        [action.payload.mintUrl]: action.payload.audit,
      }), state);

    case SET_PROOFS:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const updated = {
          ...prof,
          proofs: {
            ...prof.proofs,
            [action.payload.mintUrl]: action.payload.proofs,
          },
        };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case SET_TRANSACTIONS:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const updated = { ...prof, transactions: action.payload.transactions };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case UPDATE_TRANSACTION: {
      const { profileId, updateFn, matcher = () => false } = action.payload;
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[profileId];
        const updated = {
          ...prof,
          transactions: prof.transactions.map((tx) =>
            matcher(tx) ? updateFn(tx) : tx
          ),
        };
        return profiles.map((p, idx) => (idx === profileId ? updated : p));
      }, state);
    }

    case APPEND_TRANSACTION: {
      const { profileId, transaction } = action.payload;
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[profileId];
        const updated = {
          ...prof,
          transactions: [...prof.transactions, transaction],
        };
        return profiles.map((p, idx) => (idx === profileId ? updated : p));
      }, state);
    }

    case APPEND_TRANSACTIONS_V2:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const updated = {
          ...prof,
          transactions: [...prof.transactions, ...action.payload.transactions],
        };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case SET_SELECTED_MINT:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const updated = { ...prof, selectedMint: action.payload.mintUrl };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case APPEND_PROOFS_V2:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const existing = prof.proofs[action.payload.mintUrl] || [];
        const combined = [...existing, ...action.payload.proofs];
        const deduped = combined.filter(
          (item, index, self) => index === self.findIndex((t) => JSON.stringify(t) === JSON.stringify(item))
        );
        const updated = {
          ...prof,
          proofs: { ...prof.proofs, [action.payload.mintUrl]: deduped },
        };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case REMOVE_PROOFS:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const filtered = (prof.proofs[action.payload.mintUrl] || []).filter((proof) => {
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
            return _.isEqual(proofPicked, usedProofPicked);
          });
          return !shouldRemove;
        });
        const updated = {
          ...prof,
          proofs: { ...prof.proofs, [action.payload.mintUrl]: filtered },
        };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case INCREMENT_COUNTER:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const current = prof.counters[action.payload.mintUrl] || 1;
        const updated = {
          ...prof,
          counters: { ...prof.counters, [action.payload.mintUrl]: current + action.payload.amount },
        };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case RESET_COUNTER:
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[action.payload.profileId];
        const updated = { ...prof, counters: {} };
        return profiles.map((p, idx) => (idx === action.payload.profileId ? updated : p));
      }, state);

    case INCREASE_COUNTER_V2: {
      const { profileId, mintUrl, keysetId, amount } = action.payload;
      return typedUpdate('profiles', (profiles) => {
        const prof = profiles[profileId];
        const mintCounters = (prof.counters[mintUrl] as Record<string, number>) || {};
        const current = mintCounters[keysetId] || 1;
        const updatedCounters = {
          ...prof.counters,
          [mintUrl]: { ...mintCounters, [keysetId]: current + amount },
        };
        const updated = { ...prof, counters: updatedCounters };
        return profiles.map((p, idx) => (idx === profileId ? updated : p));
      }, state);
    }

    default:
      return state;
  }
};
