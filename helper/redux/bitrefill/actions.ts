import { SET_EVENTS, APPEND_EVENTS } from './actionTypes';
import { BitrefillEvent } from './types';

export type BitrefillAction =
  | ReturnType<typeof setEvents>
  | ReturnType<typeof appendEvents>;

export const setEvents = (events: BitrefillEvent[]) =>
  ({
    type: SET_EVENTS,
    payload: events,
  }) as const;

export const appendEvents = (events: BitrefillEvent[]) =>
  ({
    type: APPEND_EVENTS,
    payload: events,
  }) as const;
