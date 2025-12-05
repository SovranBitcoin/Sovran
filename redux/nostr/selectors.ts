import { createSelector } from 'reselect';
import _ from 'lodash';
import { RootState } from '../store/reducer';

export const memoizedGetNostrProfile = ({ nostrPubkey }: { nostrPubkey: string }) =>
  createSelector(
    [(state: RootState) => state.nostr.search, (state: RootState) => state.nostr.profiles],
    (search, profiles) => {
      const allProfiles = [...search, ...profiles];
      return _.find(allProfiles, { pubkey: nostrPubkey });
    }
  );
