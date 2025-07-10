import { createSelector } from 'reselect';
import { RootState } from '../store/reducer';

export const selectEvents = (state: RootState) => state.bitrefill.events;

export const memoizedEvents = createSelector([selectEvents], (events) => events);
