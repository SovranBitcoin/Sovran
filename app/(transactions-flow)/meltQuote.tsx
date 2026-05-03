/**
 * @fileoverview Transactions-flow meltQuote route — re-entry from the
 * transactions list. The route body and zod schema live on
 * `MeltQuoteRoute`. Mint-pill callbacks stay undefined here: this route
 * renders the entry read-only. `Stack.Screen` title comes from
 * `(transactions-flow)/_layout.tsx`.
 */

import { MeltQuoteRoute } from '@/features/send';

export default function ModalScreen() {
  return <MeltQuoteRoute where="transactions-flow.meltQuote" />;
}
