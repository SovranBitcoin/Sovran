/**
 * @fileoverview Standalone Onchain receive route.
 */

import { OnchainReceiveRoute } from '@/features/receive';

export default function OnchainReceiveStandaloneRoute() {
  return <OnchainReceiveRoute where="app.onchainReceive" />;
}
