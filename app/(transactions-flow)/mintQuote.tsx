/**
 * @fileoverview Transactions-flow legacy mintQuote route — re-entry from the
 * transactions list. The route body and zod schema live on
 * `MintQuoteRoute`, which dispatches to the rail-specific receive screen.
 * Mint-pill callbacks stay undefined here: this route renders the entry
 * read-only.
 */

import { MintQuoteRoute } from '@/features/receive';

export default function ModalScreen() {
  return <MintQuoteRoute where="transactions-flow.mintQuote" />;
}
