import { useDispatch, useSelector } from 'react-redux';
import { setVpn, updateVpn } from './actions';

export const useVpn = () => {
  const dispatch = useDispatch();
  const vpn = useSelector((state) => state.vpns.vpns);

  return {
    vpn,
    updateVpn: (request, vpn) => dispatch(updateVpn(request, vpn)),
    setVpn: (vpn) => dispatch(setVpn(vpn)),
  };
};
