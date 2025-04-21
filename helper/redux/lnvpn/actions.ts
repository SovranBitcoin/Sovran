import { SET_VPN, UPDATE_VPN } from './actionTypes';

export const setVpn = (keysets) => ({
  type: SET_VPN,
  payload: keysets,
});

export const updateVpn = (request, payload) => ({
  type: UPDATE_VPN,
  payload: { request, ...payload },
});
