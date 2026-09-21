/**
 * @fileoverview Standalone receiveToken route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `ReceiveTokenRoute` so this file shares
 * one canonical implementation with `(receive-flow)/receiveToken` and
 * `(transactions-flow)/receiveToken`.
 */

import { ReceiveTokenRoute } from '@/features/receive';
import { railHeaderTitle } from 'wallet';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function ModalScreen() {
  return (
    <FormSheetChrome title={railHeaderTitle('ecashReceive')}>
      <ReceiveTokenRoute where="app.receiveToken" />
    </FormSheetChrome>
  );
}
