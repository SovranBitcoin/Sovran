import { createSelector } from 'reselect';
import { RootState } from 'redux/store/reducer';

export const selectPricelist = (state: RootState) => state.pricelist;

export const memoizedPricelist = createSelector([selectPricelist], (pricelist) => pricelist);
