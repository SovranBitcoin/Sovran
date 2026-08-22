/**
 * @fileoverview Receive-flow Lightning receive route.
 */

import { LightningReceiveRoute } from '@/features/receive';
import { useReceiveRailRoute } from '@/features/receive/hooks/useReceiveRailRoute';

export default function LightningReceiveRouteWrapper() {
  const { onRequestMintList } = useReceiveRailRoute({
    where: 'receive-flow.lightningReceive',
    readyEvent: 'receive.lightning.route.ready',
    mintListEvent: 'receive.lightning.mint_list.requested',
  });

  return (
    <LightningReceiveRoute
      where="receive-flow.lightningReceive"
      onRequestMintList={onRequestMintList}
    />
  );
}
