import { SET_EVENTS, APPEND_EVENTS } from './actionTypes';

export const setEvents = (events) => ({
  type: SET_EVENTS,
  payload: events,
});

export const appendEvents = (events) => ({
  type: APPEND_EVENTS,
  payload: events,
});
