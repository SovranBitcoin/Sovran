/**
 * @fileoverview Standalone legacy mintQuote route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `MintQuoteRoute`, which dispatches to the
 * rail-specific receive screen. Mint-pill callbacks stay undefined here:
 * this route renders the entry read-only.
 */

import { MintQuoteRoute } from '@/features/receive';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function ModalScreen() {
  return (
    <FormSheetChrome title="Receive Lightning">
      <MintQuoteRoute where="app.mintQuote" />
    </FormSheetChrome>
  );
}
