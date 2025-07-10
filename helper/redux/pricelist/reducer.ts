import { SET_PRICELIST } from './actionTypes';

const initialState = {
  usd: {
    btc: 113377,
  },
};

export const pricelistReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_PRICELIST: {
      return {
        ...state,
        usd: {
          btc: action.payload,
        },
      };
    }
    default: {
      return state;
    }
  }
};
