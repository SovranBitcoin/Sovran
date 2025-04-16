import { createSelector } from "reselect";
import _ from "lodash";

export const memoizedGetCurrentProfile = createSelector(
  [(state) => state.nostr.profiles[state.nostr.currentProfile.id]],
  (profile) => {
    return profile;
  }
);