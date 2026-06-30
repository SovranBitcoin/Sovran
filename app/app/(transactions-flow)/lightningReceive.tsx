/**
 * @fileoverview Transactions-flow Lightning receive route.
 */

import { LightningReceiveRoute } from '@/features/receive';

export default function LightningReceiveTransactionsRoute() {
  return <LightningReceiveRoute where="transactions-flow.lightningReceive" />;
}
