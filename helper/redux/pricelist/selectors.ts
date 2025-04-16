import { createSelector } from "reselect";

export const selectPricelist = (state) => state.pricelist;

export const memoizedPricelist = createSelector(
  [selectPricelist],
  (pricelist) => pricelist
);