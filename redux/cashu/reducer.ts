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
        // 'https://nofees.testnut.cashu.space': [
        //   {
        //     secret: 'dea000bf4fbb5d0c48697e3262910b45f8602d6f4d469c2e43900d8280b25408',
        //     C: '0399ef07d55993f7ca314774a0cbb8f36a360945da989314c29e355442f29363e0',
        //     amount: 32,
        //     id: '00ba2e3e5779e035',
        //     dleq: {
        //       r: '99d9147f84788346ece94acd6d234553f7e537a891683ce63ce686c373fd4e84',
        //       s: '5fead6b85bf41de7c656e57c7c237ee34f4b15fee99115cdd8b98fe0c3fa6b16',
        //       e: '2bd82da55b34aa8966b4babbb87251e41a7c696ab31644922b59e64c13c2ce1f',
        //     },
        //   },
        //   {
        //     secret: '795682b9f84af77a7d0432fa0829551c745e711dbcb7ad9474ffa859c3a27d06',
        //     C: '02845ad8a45915b4f77c6a4bb2d638ea34a9ef0bf9e1ff5ad0fecabd736d112e80',
        //     amount: 16,
        //     id: '00ba2e3e5779e035',
        //     dleq: {
        //       r: '3cc70e9844393f9f3cf9c6c3c3e31c0aa63baed57ebc02bdf7cc04238192ee12',
        //       s: '8cfa7a1b3b6d9279b800c9dd25ed655451bddc5d82d5d3b1c0d3abb27e31a964',
        //       e: '86ee38078aefccbf9b7051cca0016806cde8528d650f7abcb3e60a0bef779e87',
        //     },
        //   },
        //   {
        //     secret: 'a24f4c85314e4d8291456dbae5ffb0925874e461a9c2e0b2c6d723f52aa7fd18',
        //     C: '0201e5c29015495b56d18c5487d8caee0b0445ff6b22fc145560853438528027d6',
        //     amount: 1,
        //     id: '00ba2e3e5779e035',
        //     dleq: {
        //       r: '85ea1ff0d0351744aea3aa9e1fbf25b98084fb8a7a8f6c0176822da4331ced16',
        //       s: '62b459b7d1a5ba1c8b0a46ec829e3c0ae981c395da80f778eef96c4c6e344b92',
        //       e: 'b828b1dd2c4b336d537d6b3556448d11709476130c3854739c8fb9cb38ec5e8b',
        //     },
        //   },
        //   {
        //     secret: '2ba9b3f8b84f6ffd511f71e4d75433339056c471eb3fa6beb1f1a3522c408915',
        //     C: '02a8f4e10157f71a8d13864db682c4a018f117ae5b90ce6f71d291e55efdb4586d',
        //     amount: 1,
        //     id: '00ba2e3e5779e035',
        //     dleq: {
        //       r: 'ab31625350ab988d7455e8c3d2b32da627348f8ff43b1bb33ca86994c18f2092',
        //       s: '0f296c39e4c5c1f0352b5dbbcfebcddfbf1b0b7bc680b2209173a5b940144666',
        //       e: 'b914d272e38c05ffac13a512cf0d62edd6bba2cdda895f7afec834f6b435e37e',
        //     },
        //   },
        // ],
      },
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
