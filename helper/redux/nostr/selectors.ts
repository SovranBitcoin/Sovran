import { createSelector } from 'reselect';
import _ from 'lodash';
import { RootState } from '../store/reducer';

export const memoizedGetCurrentProfile = createSelector(
  [(state: RootState) => state.nostr.profiles?.[state?.nostr?.currentProfile?.id]],
  (profile) => {
    return profile || {};
  }
);
