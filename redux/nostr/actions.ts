import { UserProfile } from 'helper/apiClient';
import { SET_SEARCH } from './actionTypes';

export type NostrAction = ReturnType<typeof setSearch>;

export const setSearch = (search: { pubkey: string; profile: UserProfile }) =>
  ({
    type: SET_SEARCH,
    payload: search,
  }) as const;
