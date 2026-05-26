/**
 * @fileoverview Transactions-flow Onchain receive route.
 */

import { OnchainReceiveRoute } from '@/features/receive';

export default function OnchainReceiveTransactionsRoute() {
  return <OnchainReceiveRoute where="transactions-flow.onchainReceive" />;
}
