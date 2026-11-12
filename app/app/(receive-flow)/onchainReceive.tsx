/**
 * @fileoverview Receive-flow Onchain receive route.
 */

import { OnchainReceiveRoute } from '@/features/receive';

export default function OnchainReceiveRouteWrapper() {
  return <OnchainReceiveRoute where="receive-flow.onchainReceive" editableMint />;
}
