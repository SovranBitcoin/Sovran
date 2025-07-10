import { SET_PRICELIST } from './actionTypes';

export type PricelistAction = ReturnType<typeof setPricelist>;

export const setPricelist = (price: number) =>
  ({
    type: SET_PRICELIST,
    payload: price,
  }) as const;
