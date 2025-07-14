import { UserProfile } from 'helper/apiClient';
import {
  SET_CURRENT_PROFILE,
  SET_SEARCH,
  SET_PROFILES,
  SET_FOLLOWS,
  ADD_MESSAGE,
  MUTE_USER,
  REPORT_USER,
  ADD_CONTACT,
  REMOVE_CONTACT,
} from './actionTypes';
import { NostrContactProfile, Profile } from './reducer';
import { NDKUserProfile } from '@nostr-dev-kit/ndk';

export type NostrAction =
  | ReturnType<typeof muteUser>
  | ReturnType<typeof reportUser>
  | ReturnType<typeof setCurrentProfile>
  | ReturnType<typeof setSearch>
  | ReturnType<typeof addMessage>
  | ReturnType<typeof addContact>
  | ReturnType<typeof removeContact>
  | ReturnType<typeof setProfiles>
  | ReturnType<typeof setFollows>;

export const muteUser = (pubkey: string) =>
  ({
    type: MUTE_USER,
    payload: pubkey,
  }) as const;

export const reportUser = (pubkey: string) =>
  ({
    type: REPORT_USER,
    payload: pubkey,
  }) as const;

export const setCurrentProfile = (profile: Profile) =>
  ({
    type: SET_CURRENT_PROFILE,
    payload: profile,
  }) as const;

export const setSearch = (search: { pubkey: string; profile: UserProfile }) =>
  ({
    type: SET_SEARCH,
    payload: search,
  }) as const;

export const setProfiles = (profiles: Profile[]) =>
  ({
    type: SET_PROFILES,
    payload: profiles,
  }) as const;

export const setFollows = (follows: { pubkey: string, profile: NDKUserProfile }) =>
  ({
    type: SET_FOLLOWS,
    payload: follows,
  }) as const;

export const addMessage = (pubkey: string, message: string) =>
  ({
    type: ADD_MESSAGE,
    payload: { pubkey, message },
  }) as const;

export const addContact = (contact: { pubkey: string; profile: NostrContactProfile }) =>
  ({
    type: ADD_CONTACT,
    payload: contact,
  }) as const;

export const removeContact = (pubkey: string) =>
  ({
    type: REMOVE_CONTACT,
    payload: pubkey,
  }) as const;
