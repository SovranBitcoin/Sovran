import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { setEvents, appendEvents } from './actions';
import { memoizedEvents } from './selectors';
import { BitrefillEvent } from './types';

export const useBitrefill = () => {
  const dispatch = useDispatch();
  const events = useSelector(memoizedEvents);

  const setEventsCallback = useCallback(
    (evts: BitrefillEvent[]) => dispatch(setEvents(evts)),
    [dispatch]
  );

  const appendEventsCallback = useCallback(
    (evts: BitrefillEvent[]) => dispatch(appendEvents(evts)),
    [dispatch]
  );

  return {
    events,
    setEvents: setEventsCallback,
    appendEvents: appendEventsCallback,
  };
};
