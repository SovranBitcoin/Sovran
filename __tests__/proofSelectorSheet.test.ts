/**
 * @jest-environment node
 */

import {
  getProofSuggestionDisplay,
  submitProofSuggestion,
} from '@/shared/lib/popup/popups/proofSelectorSheet';

jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('heroui-native', () => ({
  BottomSheet: { Title: 'BottomSheet.Title' },
  Menu: Object.assign('Menu', { Item: 'Menu.Item', ItemTitle: 'Menu.ItemTitle' }),
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
});
