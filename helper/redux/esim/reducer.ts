import { SET_ESIM, UPDATE_ESIM } from './actionTypes';

const initialState = {
  esims: [],
};

export const esimReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_ESIM:
      return {
        esims: [...state.esims, action.payload],
      };
    case UPDATE_ESIM:
      return {
        esims: state.esims.map((esim) =>
          esim.request === action.payload.request
            ? {
                ...esim,
                order: { ...action.payload },
              }
            : esim
        ),
      };
    default:
      return state;
  }
};
