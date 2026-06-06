/**
 * @fileoverview Standalone Lightning receive route.
 */

import { LightningReceiveRoute } from '@/features/receive';

export default function LightningReceiveStandaloneRoute() {
  return <LightningReceiveRoute where="app.lightningReceive" />;
}
