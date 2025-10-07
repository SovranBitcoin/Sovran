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
) => {
  // Ensure profile exists for actions that need it
  if (
    'payload' in action &&
    action.payload &&
    typeof action.payload === 'object' &&
    'profileId' in action.payload &&
    typeof action.payload.profileId === 'number'
  ) {
    // Simple profile existence check - just ensure the profile exists
    if (!state.profiles[action.payload.profileId]) {
      state = {
        ...state,
        profiles: [
          ...state.profiles,
          ...Array(action.payload.profileId - state.profiles.length + 1).fill({
            selectedMint: undefined,
            mints: [],
            proofs: {},
            counters: {},
            keysets: {},
            transactions: [],
          }),
        ],
      };
    }
  }

  switch (action.type) {
    case 'SET_SELECTED_MINT':
      return typedUpdate(
        `profiles[${action.payload.profileId}].selectedMint` as const,
        () => action.payload.mintUrl,
        state
      );

    case 'SET_ALLOCATION':
      return typedSet(['allocation'] as const, action.payload.allocation, state);

    case 'UPDATE_CURRENCY_ALLOCATION':
      return typedUpdate(
        ['allocation', action.payload.currency] as const,
        () => action.payload.allocation,
        state
      );

    case 'RESET_ALLOCATION':
      return typedSet(['allocation'] as const, {}, state);

    default:
      return state;
  }
};
