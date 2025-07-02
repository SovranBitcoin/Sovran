import {
  SET_ROUTSTR_TOKEN,
  SET_ROUTSTR_BALANCE,
  ADD_ROUTSTR_SESSION,
  ADD_ROUTSTR_MESSAGE,
  SET_CURRENT_SESSION,
  SET_LAST_TOKEN,
} from './actionTypes';

export const setRoutstrToken = (token: string) => ({
  type: SET_ROUTSTR_TOKEN,
  payload: token,
});

export const setRoutstrBalance = (balance: number) => ({
  type: SET_ROUTSTR_BALANCE,
  payload: balance,
});

export const addRoutstrSession = (sessionId: string) => ({
  type: ADD_ROUTSTR_SESSION,
  payload: { sessionId },
});

export const addRoutstrMessage = (
  sessionId: string,
  message: { role: string; content: string }
) => ({
  type: ADD_ROUTSTR_MESSAGE,
  payload: { sessionId, message },
});

export const setCurrentSession = (sessionId: string) => ({
  type: SET_CURRENT_SESSION,
  payload: sessionId,
});

export const setLastToken = (token: string) => ({
  type: SET_LAST_TOKEN,
  payload: token,
});
