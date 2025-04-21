import {
  SET_CURRENT_PROFILE,
  SET_SEARCH,
  SET_PROFILES,
  SET_FOLLOWS,
  UPDATE_MESSAGE_STATUS,
  ADD_MESSAGE,
  APPEND_QUERY,
} from './actionTypes';

export const setCurrentProfile = (profile) => ({
  type: SET_CURRENT_PROFILE,
  payload: profile,
});

export const setSearch = (keysets) => ({
  type: SET_SEARCH,
  payload: keysets,
});

export const appendQuery = (query) => ({
  type: APPEND_QUERY,
  payload: query,
});

export const setProfiles = (profiles) => ({
  type: SET_PROFILES,
  payload: profiles,
});

export const setFollows = (follows) => ({
  type: SET_FOLLOWS,
  payload: follows,
});

export const updateMessageStatus = (pubkey, messageId, status) => ({
  type: UPDATE_MESSAGE_STATUS,
  payload: { pubkey, messageId, status },
});

export const addMessage = (pubkey, message) => ({
  type: ADD_MESSAGE,
  payload: { pubkey, message },
});
