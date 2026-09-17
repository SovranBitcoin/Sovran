/**
 * @fileoverview Receive-flow route for a custom NUT-04 payment method.
 */

import { CustomReceiveRoute } from '@/features/receive';
import { useReceiveRailRoute } from '@/features/receive/hooks/useReceiveRailRoute';

export default function CustomReceiveRouteWrapper() {
  const { onRequestMintList } = useReceiveRailRoute({
    where: 'receive-flow.customReceive',
    readyEvent: 'receive.custom.route.ready',
    mintListEvent: 'receive.custom.mint_list.requested',
  });

  return (
    <CustomReceiveRoute where="receive-flow.customReceive" onRequestMintList={onRequestMintList} />
  );
}
