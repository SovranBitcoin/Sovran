/**
 * @fileoverview Standalone mintQuote route — used for direct
 * navigation, deep links, and PaymentStatusToast re-entry. The route
 * body and zod schema live on `MintQuoteRoute`. Mint-pill callbacks
 * stay undefined here: this route renders the entry read-only.
 */

import { MintQuoteRoute } from '@/features/receive';

export default function ModalScreen() {
  return <MintQuoteRoute where="app.mintQuote" />;
}
