import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';

export const selectEsims = (state: RootState) => state.esim.esims;

export const memoizedEsims = createSelector([selectEsims], (esims) => esims);
