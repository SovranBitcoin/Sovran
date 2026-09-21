/**
 * The "Choose how to pay" rows name the RAIL a payment option is paid over.
 * The mapping used to be two membership lists with a `return kind` fallthrough,
 * so the one kind in neither list — `bolt12Offer` — reached the sheet as its
 * own raw enum name. A total record makes that unrepresentable; these lock the
 * behavior the record encodes.
 */
import { METHOD_PRESENTATION } from '@/shared/lib/popup/popups/paymentMethodPresentation';

describe('payment method presentation', () => {
  const kinds = Object.keys(METHOD_PRESENTATION) as (keyof typeof METHOD_PRESENTATION)[];

  it('presents a BOLT-12 offer as Lightning, like an invoice or an address', () => {
    expect(METHOD_PRESENTATION.bolt12Offer).toEqual(METHOD_PRESENTATION.lightningInvoice);
    expect(METHOD_PRESENTATION.bolt12Offer.label).toBe('Lightning');
    expect(METHOD_PRESENTATION.bolt12Offer.icon).toBe('mdi:lightning-bolt');
  });

  it('never shows a raw option kind as the label', () => {
    for (const kind of kinds) {
      expect(METHOD_PRESENTATION[kind].label).not.toBe(kind);
    }
  });

  it('gives every kind a non-empty label and icon', () => {
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(METHOD_PRESENTATION[kind].label).toMatch(/\S/);
      expect(METHOD_PRESENTATION[kind].icon).toMatch(/\S/);
    }
  });

  it('groups the rails the user actually chooses between', () => {
    const byLabel = kinds.reduce<Record<string, string[]>>((acc, kind) => {
      (acc[METHOD_PRESENTATION[kind].label] ??= []).push(kind);
      return acc;
    }, {});
    expect(byLabel).toEqual({
      Cashu: ['ecashToken', 'paymentRequest'],
      Lightning: ['lightningInvoice', 'bolt12Offer', 'lightningAddress', 'lnurlp'],
      Onchain: ['onchainAddress'],
    });
  });
});
