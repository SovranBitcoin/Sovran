import { SET_VPN, UPDATE_VPN } from './actionTypes';
import { Vpn, VpnOrder } from './types';

export type VpnAction =
  | ReturnType<typeof setVpn>
  | ReturnType<typeof updateVpn>;

export const setVpn = (vpn: Vpn) =>
  ({
    type: SET_VPN,
    payload: vpn,
  }) as const;

export const updateVpn = (request: string, payload: VpnOrder) =>
  ({
    type: UPDATE_VPN,
    payload: { request, ...payload },
  }) as const;
