/**
 * @fileoverview Transactions-flow route for a custom NUT-04 payment method.
 */

import { CustomReceiveRoute } from '@/features/receive';

export default function CustomReceiveTransactionsRoute() {
  return <CustomReceiveRoute where="transactions-flow.customReceive" />;
}
