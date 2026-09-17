/**
 * @fileoverview Receive screen for a NUT-04 method with no NUT of its own.
 *
 * NUT-04 pins `method` only to the grammar `[a-z0-9_-]+`; which methods exist
 * is up to the mint, published in its NUT-06 info. Three have a dedicated spec
 * (NUT-23 bolt11, NUT-25 bolt12, NUT-30 onchain) and their own screens.
 * Everything else lands here: `mint.sortug.com` serves `venmo` and `paypal`,
 * and a mint may invent another tomorrow.
 *
 * So nothing on this screen is written per method. The caption, the glyph and
 * the detail-row title all come from the quote's own method string through
 * `wallet/src/payment-methods.ts`, which falls back to a tidied label and a
 * generic value-transfer icon for a name the wallet has never seen. A new
 * method renders legibly without a release.
 *
 * The payload is shown as-is. A custom method's `request` is whatever the mint
 * chose (`venmo:84be897a-…`) — not a URI scheme the wallet can parse, act on,
 * or decorate, so it is presented and copied verbatim rather than dressed up
 * as something the app understands.
 */

import { getPaymentMethodPresentation } from 'wallet';

import { mintDetailItem, quoteIdDetailItem } from '@/features/transactions';
import { truncateMiddle } from '@/shared/lib/strings';

import { MintQuoteReceiveShell, type MintQuoteScreenProps } from './MintQuoteReceiveShell';

interface CustomReceiveScreenProps extends MintQuoteScreenProps {
  /** The mint-advertised method string, e.g. `venmo`. */
  method: string;
}

export function CustomReceiveScreen({ method, ...props }: CustomReceiveScreenProps) {
  const { entry, mintUrl } = props;
  const { label, noun } = getPaymentMethodPresentation(method);
  // `noun` is a sentence fragment ("bank transfer"); a details row is a title.
  const payloadRowTitle = noun.charAt(0).toUpperCase() + noun.slice(1);

  return (
    <MintQuoteReceiveShell
      {...props}
      screenName="CustomReceiveScreen"
      logScope="receive.custom"
      payment={{
        label,
        value: entry.paymentRequest,
        // Not a Lightning invoice and not an address — the honest generic
        // toast. Claiming a format the payload does not have would send the
        // user to the wrong app.
        copyTarget: 'paymentRequest',
      }}
      // A custom method is none of the three BIP-321 categories, so no icon is
      // marked as used.
      detailRows={[
        { title: 'Method', value: label },
        quoteIdDetailItem(entry.quoteId),
        mintDetailItem(mintUrl),
        { title: payloadRowTitle, value: truncateMiddle(entry.paymentRequest, 10) },
      ]}
      logFields={{ method }}
    />
  );
}
