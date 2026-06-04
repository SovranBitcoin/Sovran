/**
 * @jest-environment node
 */

import {
  getProofSuggestionDisplay,
  shouldShowProofSelectorMintChange,
  submitProofSuggestion,
} from '@/shared/lib/popup/popups/proofSelectorSheet';

jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('heroui-native', () => ({
  BottomSheet: { Title: 'BottomSheet.Title' },
  Menu: Object.assign('Menu', { Item: 'Menu.Item', ItemTitle: 'Menu.ItemTitle' }),
}));
jest.mock('colada', () => ({
  decodeUrlOrAddress: (value: string) =>
    value.includes('@') || value.toLowerCase().startsWith('lnurlp://') ? 'https://lnurl' : null,
  isLightningInvoiceBolt11: (value: string) => value.toLowerCase().startsWith('lnbc'),
}));
jest.mock('assets/icons', () => 'Icon', { virtual: true });
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: 'AmountFormatter' }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: 'HStack' }));
jest.mock('@/shared/lib/popup/popups/bridge', () => ({ showActionSheet: jest.fn() }));

const fiatDisplay = {
  inputMode: 'fiat' as const,
  rawInput: '0.01',
  fiatCurrency: 'usd',
  fiatSymbol: '$',
  btcPrice: 50_000,
  displayFiat: 0.01,
  displaySats: 20,
  autoOptimized: true,
};

describe('proof selector suggestion display', () => {
  it('renders sat-mode suggestions as sats', () => {
    expect(getProofSuggestionDisplay(96, 'sat', { displayMetadata: undefined })).toEqual({
      kind: 'sat',
      amount: 96,
      unit: 'sat',
    });
  });

  it('renders fiat-mode suggestions as fiat labels', () => {
    expect(getProofSuggestionDisplay(20, 'sat', { displayMetadata: fiatDisplay })).toEqual({
      kind: 'fiat',
      label: '$0.01',
    });
  });

  it('submits sats to machine.chooseProofs', () => {
    const machine = { chooseProofs: jest.fn(async () => {}) };

    submitProofSuggestion(machine as never, 20);

    expect(machine.chooseProofs).toHaveBeenCalledWith(20);
  });

  it('hides mint change for lightning melt amount fallback', () => {
    expect(
      shouldShowProofSelectorMintChange({
        meltTarget: 'lnbc1...',
        paymentRequest: undefined,
      })
    ).toBe(false);
  });

  it('keeps mint change for ecash/payment-request fallbacks', () => {
    expect(
      shouldShowProofSelectorMintChange({
        meltTarget: undefined,
        paymentRequest: undefined,
      })
    ).toBe(true);
    expect(
      shouldShowProofSelectorMintChange({
        meltTarget: undefined,
        paymentRequest: 'creq1...',
      })
    ).toBe(true);
  });

  it('keeps mint change for non-lightning melt fallbacks', () => {
    expect(
      shouldShowProofSelectorMintChange({
        meltTarget: 'bitcoin:bc1qexample',
        paymentRequest: undefined,
      })
    ).toBe(true);
  });
});
