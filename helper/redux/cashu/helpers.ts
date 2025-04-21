export const ensureProfileExists = (state, profileId) => {
  const newProfiles = [...state.profiles];
  while (newProfiles.length < profileId + 1) {
    newProfiles.push({
      selectedMint: 'https://mint.minibits.cash/Bitcoin',
      mints: ['https://mint.minibits.cash/Bitcoin'],
      proofs: [],
      keysets: {},
      transactions: [],
      counters: {},
    });
  }
  return {
    ...state,
    profiles: newProfiles,
  };
};
