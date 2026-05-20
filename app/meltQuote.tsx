/**
 * @fileoverview Standalone meltQuote route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `MeltQuoteRoute`. Mint-pill callbacks
 * stay undefined here: this route renders the entry read-only.
 */

import { MeltQuoteRoute } from '@/features/send';

export default function ModalScreen() {
  return <MeltQuoteRoute where="app.meltQuote" />;
}
