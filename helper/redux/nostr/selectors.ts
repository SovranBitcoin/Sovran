import { createSelector } from 'reselect';
import _ from 'lodash';
import { RootState } from '../store/reducer';

export const memoizedGetCurrentProfile = createSelector(
  [(state: RootState) => state.nostr.profiles?.[state?.nostr?.currentProfile?.id]],
  (profile) => {
    return profile || {};
  }
);

export const memoizedGetNostrProfile = ({ nostrPubkey }: { nostrPubkey: string }) =>
  createSelector(
    [(state: RootState) => [...state.nostr.search, ...state.nostr.profiles]],
    (profiles = []) => {
      return _.find(profiles, { pubkey: nostrPubkey });
    }
  );
