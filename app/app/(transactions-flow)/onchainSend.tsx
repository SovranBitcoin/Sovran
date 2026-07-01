/**
 * @fileoverview Transactions-flow Onchain send route.
 */

import { OnchainSendRoute } from '@/features/send';

export default function OnchainSendTransactionsRoute() {
  return <OnchainSendRoute where="transactions-flow.onchainSend" />;
}
