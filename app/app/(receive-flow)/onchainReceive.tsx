/**
 * @fileoverview Receive-flow Onchain receive route.
 */

import { OnchainReceiveRoute } from '@/features/receive';
import { useReceiveRailRoute } from '@/features/receive/hooks/useReceiveRailRoute';

export default function OnchainReceiveRouteWrapper() {
  const { onRequestMintList } = useReceiveRailRoute({
    where: 'receive-flow.onchainReceive',
    readyEvent: 'receive.onchain.route.ready',
    mintListEvent: 'receive.onchain.mint_list.requested',
  });

  return (
    <OnchainReceiveRoute
      where="receive-flow.onchainReceive"
      onRequestMintList={onRequestMintList}
    />
  );
}
