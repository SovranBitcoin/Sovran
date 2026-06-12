/**
 * @fileoverview Standalone receiveToken route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `ReceiveTokenRoute` so this file shares
 * one canonical implementation with `(receive-flow)/receiveToken` and
 * `(transactions-flow)/receiveToken`.
 */

import { ReceiveTokenRoute } from '@/features/receive';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function ModalScreen() {
  return (
    <FormSheetChrome title="Receive Ecash">
      <ReceiveTokenRoute where="app.receiveToken" />
    </FormSheetChrome>
  );
}
