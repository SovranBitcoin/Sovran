/**
 * @fileoverview Standalone sendToken route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `SendTokenRoute` so this file shares one
 * canonical implementation with `(send-flow)/sendToken` and
 * `(transactions-flow)/sendToken`.
 */

import { SendTokenRoute } from '@/features/send';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function ModalScreen() {
  return (
    <FormSheetChrome title="Send Ecash">
      <SendTokenRoute where="app.sendToken" />
    </FormSheetChrome>
  );
}
