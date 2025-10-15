import { CashuState } from './types';
import { Reducer } from 'redux';
import { CashuAction } from './actions';
import { typedSet, typedUpdate } from 'helper/typedUpdate';

const initialState: CashuState = {
  profiles: [
    {
      selectedMint: undefined,
      mints: [],
      proofs: {
        'https://mint.minibits.cash/Bitcoin': [
          {
            secret: 'c9d204059fc998bf0a761e283cb7f1651d5f09596b062612acdaee131746ec18',
            C: '03f53518ee4ea9552e228b02d60d75183b531bf1c2e5676b56ee89bb5729d07e78',
            amount: 1,
            id: '00500550f0494146',
            dleq: {
              r: '7642cc90af07d74b9c1b16462ab6f591e51469a2028c520bfaee3ea077e95037',
              s: 'a604b6bf600951677975f76909ab558fe6e2b096dddf652d0483f74ea2a11f6a',
              e: '1d5268d698a8dcb2a2857f8f85a3e2e17ed1a201393e8a07f4ed6be851532f44',
            },
          },
          {
            secret: 'cddc9db7ff9ec1e61b7644376cc254d13ef6a4e78a11bdec1a8506b177c59f94',
            C: '0285187ec36e4b2e14dca2963824161860ffe5e41ad0b27061560de5037507d1ed',
            amount: 1,
            id: '00500550f0494146',
            dleq: {
              r: '00bbb2a9ca261facc013f6fd43ad618c5c276daa99d55899887b75a3b746f07c',
              s: '605946ffde17d6978e8e93f55edad8b25e48ba531bfeb933dce04871558c1797',
              e: 'e2d33edf31dfad84a50f4497993a90d531c2ba2d1c0bed2463dc1b658091c553',
            },
          },
        ],
      },
      counters: {
        'https://mint.minibits.cash/Bitcoin': {
          '00500550f0494146': 1111,
        },
      },
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

export const cashuReducer: Reducer<CashuState, CashuAction> = (state = initialState, action) => {
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
