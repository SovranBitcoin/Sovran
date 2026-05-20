/**
 * @fileoverview Transactions-flow mintQuote route — re-entry from the
 * transactions list. The route body and zod schema live on
 * `MintQuoteRoute`. Mint-pill callbacks stay undefined here: this route
 * renders the entry read-only. `Stack.Screen` title comes from
 * `(transactions-flow)/_layout.tsx`.
 */

import { MintQuoteRoute } from '@/features/receive';

export default function ModalScreen() {
  return <MintQuoteRoute where="transactions-flow.mintQuote" />;
}
