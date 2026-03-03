import { CashuState } from './types';
import type { AnyAction, Reducer } from 'redux';
import { typedUpdate } from '@/shared/lib/typedUpdate';
import { cashuState } from 'redux/store/migrationTest';

const initialState: CashuState = {
  profiles: [
    {
      selectedMint: cashuState.selectedMint,
      mints: [],
      proofs: cashuState.profiles.proofs,
      counters: cashuState.profiles.counters,
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

export const cashuReducer: Reducer<CashuState, AnyAction> = (state = initialState, action) => {
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

    default:
      return state;
  }
};
