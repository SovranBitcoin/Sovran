/**
 * @fileoverview Transactions-flow legacy meltQuote route — re-entry from the
 * transactions list. The route body and zod schema live on
 * `MeltQuoteRoute`, which dispatches to the rail-specific send screen.
 * Mint-pill callbacks stay undefined here: this route renders the entry
 * read-only.
 */

import { MeltQuoteRoute } from '@/features/send';

export default function ModalScreen() {
  return <MeltQuoteRoute where="transactions-flow.meltQuote" />;
}
