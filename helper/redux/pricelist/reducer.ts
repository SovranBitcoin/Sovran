import { SET_PRICELIST } from './actionTypes';
import { PricelistAction } from './actions';
import { Reducer } from 'redux';
import { typedUpdate } from 'helper/typedUpdate';

export interface PricelistState {
  usd: {
    btc: number;
  };
}

const initialState: PricelistState = {
  usd: {
    btc: 113377,
  },
};

export const pricelistReducer: Reducer<PricelistState, PricelistAction> = (
  state = initialState,
  action
): PricelistState => {
  switch (action.type) {
    case SET_PRICELIST: {
      return typedUpdate('usd.btc', () => action.payload, state);
    }
    default: {
      return state;
    }
  }
};
