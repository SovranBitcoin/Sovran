/**
 * @fileoverview Lightning (BOLT11) receive screen.
 *
 * Always Lightning. Everything shared with the other mint-quote rails lives in
 * `MintQuoteReceiveShell`; what is here is only what makes a BOLT11 quote a
 * BOLT11 quote — the invoice caption, the Lightning copy target, and the
 * copyable Quote ID.
 */

import { getPaymentMethodLabel } from 'wallet';

import { mintDetailItem, quoteIdDetailItem } from '@/features/transactions';
import { truncateMiddle } from '@/shared/lib/strings';

import { MintQuoteReceiveShell, type MintQuoteScreenProps } from './MintQuoteReceiveShell';

export function LightningReceiveScreen(props: MintQuoteScreenProps) {
  const { entry, mintUrl } = props;

  return (
    <MintQuoteReceiveShell
      {...props}
      screenName="LightningReceiveScreen"
      logScope="receive.lightning"
      payment={{
        label: getPaymentMethodLabel('bolt11'),
        value: entry.paymentRequest,
        copyTarget: 'lightningInvoice',
      }}
      usedKind="lightning"
      detailRows={[
        quoteIdDetailItem(entry.quoteId),
        mintDetailItem(mintUrl),
        { title: 'Invoice', value: truncateMiddle(entry.paymentRequest, 10) },
      ]}
    />
  );
}
