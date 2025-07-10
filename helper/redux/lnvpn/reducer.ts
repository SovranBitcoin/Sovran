import { Reducer } from 'redux';
import { SET_VPN, UPDATE_VPN } from './actionTypes';
import { VpnState } from './types';
import { VpnAction } from './actions';
import { typedUpdate } from 'helper/typedUpdate';

const initialState: VpnState = {
  vpns: [],
};

export const vpnReducer: Reducer<VpnState, VpnAction> = (
  state = initialState,
  action
): VpnState => {
  switch (action.type) {
    case SET_VPN:
      return typedUpdate('vpns', (vpns) => [...vpns, action.payload], state);
    case UPDATE_VPN:
      return typedUpdate(
        'vpns',
        (vpns) =>
          vpns.map((vpn) =>
            vpn.payment_request === action.payload.request
              ? { ...vpn, order: { ...action.payload } }
              : vpn
          ),
        state
      );
    default:
      return state;
  }
};
