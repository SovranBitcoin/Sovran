/**
 * @fileoverview Receive-flow Lightning receive route.
 */

import { LightningReceiveRoute } from '@/features/receive';

export default function LightningReceiveRouteWrapper() {
  return <LightningReceiveRoute where="receive-flow.lightningReceive" editableMint />;
}
