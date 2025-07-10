import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { setVpn, updateVpn } from './actions';
import { memoizedVpn } from './selectors';
import { Vpn, VpnOrder } from './types';

export const useVpn = () => {
  const dispatch = useDispatch();
  const vpn = useSelector(memoizedVpn);

  const updateVpnCallback = useCallback(
    (request: string, payload: VpnOrder) =>
      dispatch(updateVpn(request, payload)),
    [dispatch]
  );

  const setVpnCallback = useCallback(
    (vpnData: Vpn) => dispatch(setVpn(vpnData)),
    [dispatch]
  );

  return {
    vpn,
    updateVpn: updateVpnCallback,
    setVpn: setVpnCallback,
  };
};
