import { SET_ESIM, UPDATE_ESIM } from './actionTypes';

export const setEsims = (keysets) => ({
  type: SET_ESIM,
  payload: keysets,
});

export const updateEsim = (request, payload) => ({
  type: UPDATE_ESIM,
  payload: { request, ...payload },
});
