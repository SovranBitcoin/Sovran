import _ from 'lodash/fp';
import { SET_EVENTS, APPEND_EVENTS } from "./actionTypes";

const initialState = {
  events: [],
};

export const bitrefillReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_EVENTS: {
      return _.set('events', action.payload, state);
    }
    case APPEND_EVENTS: {
      return _.update('events', (events = []) => [...events, ...action.payload], state);
    }
    default: {
      return state;
    }
  }
};