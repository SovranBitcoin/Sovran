import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';

export const selectVpn = (state: RootState) => state.vpns.vpns;

export const memoizedVpn = createSelector([selectVpn], (vpns) => vpns);
