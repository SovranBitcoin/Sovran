import { Reducer } from 'redux';
import { SET_ESIM, UPDATE_ESIM } from './actionTypes';
import { EsimState } from './types';
import { EsimAction } from './actions';
import { typedUpdate } from 'helper/typedUpdate';

const initialState: EsimState = {
  esims: [],
};

export const esimReducer: Reducer<EsimState, EsimAction> = (
  state = initialState,
  action
): EsimState => {
  switch (action.type) {
    case SET_ESIM:
      return typedUpdate('esims' as const, (esims) => [...esims, action.payload], state);
    case UPDATE_ESIM:
      return typedUpdate(
        'esims' as const,
        (esims) =>
          esims.map((esim) =>
            esim.request === action.payload.request
              ? { ...esim, order: { ...action.payload } }
              : esim
          ),
        state
      );
    default:
      return state;
  }
};
