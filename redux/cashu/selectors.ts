import { createSelector } from 'reselect';
import { RootState } from 'redux/store/reducer';

// Only keep selectors that are still needed for migration
export const memoizedGetSelectedMint = createSelector(
  [
    (state: RootState) => state.cashu.profiles,
    (state: RootState) => state.nostr.currentProfile?.id,
  ],
  (profiles, profileId) => {
    return profiles[profileId].selectedMint;
  }
);

// Removed memoizedGetMintInfo - now using Coco's getMintInfo

export const memoizedGetAllocation = createSelector(
  [(state: RootState) => state.cashu.allocation],
  (allocation) => allocation || {}
);
