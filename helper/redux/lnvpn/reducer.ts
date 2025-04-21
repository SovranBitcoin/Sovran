import { SET_VPN, UPDATE_VPN } from './actionTypes';

const initialState = {
  vpns: [],
};

export const vpnReducer = (state = initialState, action) => {
  switch (action.type) {
    case SET_VPN: {
      return {
        vpns: [...state.vpns, action.payload],
      };
    }
    case UPDATE_VPN: {
      return {
        vpns: state.vpns.map((vpn) =>
          vpn.payment_request === action.payload.request
            ? { ...vpn, order: { ...action.payload } }
            : vpn
        ),
      };
    }
    default: {
      return state;
    }
  }
};
