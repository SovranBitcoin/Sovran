/**
 * @fileoverview Standalone receiveToken route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `ReceiveTokenRoute` so this file shares
 * one canonical implementation with `(receive-flow)/receiveToken` and
 * `(transactions-flow)/receiveToken`.
 */

import { ReceiveTokenRoute } from '@/features/receive';

export default function ModalScreen() {
  return <ReceiveTokenRoute where="app.receiveToken" />;
}
