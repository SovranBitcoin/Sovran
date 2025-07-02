import { createSelector } from 'reselect';
import { RootState } from 'helper/redux/store/reducer';

export const memoizedGetRoutstrState = (state: RootState) => state.routstr;

export const memoizedGetRoutstrToken = createSelector(
  [memoizedGetRoutstrState],
  (routstr) => routstr.token
);

export const memoizedGetRoutstrBalance = createSelector(
  [memoizedGetRoutstrState],
  (routstr) => routstr.balance
);

export const memoizedGetCurrentSession = createSelector(
  [memoizedGetRoutstrState],
  (routstr) =>
    routstr.currentSessionId ? routstr.sessions[routstr.currentSessionId] : null
);

export const memoizedGetSessions = createSelector(
  [memoizedGetRoutstrState],
  (routstr) => Object.values(routstr.sessions)
);

export const memoizedGetLastToken = createSelector(
  [memoizedGetRoutstrState],
  (routstr) => routstr.lastToken
);
