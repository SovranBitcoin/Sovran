import { useDispatch, useSelector } from 'react-redux';
import { setEvents, appendEvents } from './actions';

export const useBitrefill = () => {
  const dispatch = useDispatch();
  const events = useSelector((state) => state.bitrefill?.events);

  return {
    events,
    setEvents: (events) => dispatch(setEvents(events)),
    appendEvents: (events) => dispatch(appendEvents(events)),
  };
};
