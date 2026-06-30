/**
 * @fileoverview Transactions-flow receiveToken route — re-entry from
 * the transactions list. The route body and zod schema live on
 * `ReceiveTokenRoute`. `Stack.Screen` title comes from
 * `(transactions-flow)/_layout.tsx`.
 */

import { ReceiveTokenRoute } from '@/features/receive';

export default function ModalScreen() {
  return <ReceiveTokenRoute where="transactions-flow.receiveToken" />;
}
