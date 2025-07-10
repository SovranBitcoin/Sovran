import { Reducer } from 'redux';
import { SET_EVENTS, APPEND_EVENTS } from './actionTypes';
import { BitrefillState } from './types';
import { BitrefillAction } from './actions';
import { typedUpdate } from 'helper/typedUpdate';

const initialState: BitrefillState = {
  events: [],
};

export const bitrefillReducer: Reducer<BitrefillState, BitrefillAction> = (
  state = initialState,
  action
): BitrefillState => {
  switch (action.type) {
    case SET_EVENTS:
      return typedUpdate('events', () => action.payload, state);
    case APPEND_EVENTS:
      return typedUpdate('events', (events) => [...events, ...action.payload], state);
    default:
      return state;
  }
};
