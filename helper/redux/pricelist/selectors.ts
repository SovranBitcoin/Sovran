import { createSelector } from 'reselect';
import { RootState } from 'helper/redux/store/reducer';

export const selectPricelist = (state: RootState) => state.pricelist;

export const memoizedPricelist = createSelector([selectPricelist], (pricelist) => pricelist);
