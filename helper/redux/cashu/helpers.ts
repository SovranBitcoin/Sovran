import { CashuState, CashuProfile } from './types';

export const ensureProfileExists = (state: CashuState, profileId: number): CashuState => {
  const newProfiles = [...state.profiles];
  while (newProfiles.length < profileId + 1) {
    const profile: CashuProfile = {
      selectedMint: 'https://mint.minibits.cash/Bitcoin',
      mints: ['https://mint.minibits.cash/Bitcoin'],
      proofs: {},
      keysets: {},
      transactions: [],
      counters: {},
    };
    newProfiles.push(profile);
  }
  return {
    ...state,
    profiles: newProfiles,
  };
};
