/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { MintMethodCapabilityMap } from 'wallet';
import { ReceiveReusableQuoteTab } from '@/features/receive/components/ReceiveReusableQuoteTab';
import { useBip321RailSelection } from '@/features/receive/hooks/useBip321RailSelection';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real "Receiving with" resolver and capability reads, from the explicit
// pick and the wallet context through to what the Unified rails and the
// standing-quote tab decide. Only stores, the quote hook and UI leaves are faked.
const REAL = 'https://real.example';
const OTHER = 'https://other.example';
const TESTNUT = 'https://testnut.example';
let mockPicks: Partial<Record<'bolt12' | 'onchain', string>> = {};
let mockTestnut = false;
let mockContext: {
  trustedMintUrls: string[];
  mintBalances: Record<string, number>;
  mintMethodCapabilities: MintMethodCapabilityMap;
};
const mockQuote = jest.fn((_input: unknown, _store: unknown) => ({
  quote: null,
  isLoading: false,
  error: null,
  rotate: jest.fn(),
}));

jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => mockContext,
}));
jest.mock('@/features/wallet/hooks/useActiveUnit', () => ({
  useActiveUnit: () => ({ testnut: mockTestnut }),
}));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => (mintUrl: string) => mintUrl.includes('testnut'),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: Object.assign(
    (selector: (state: { receiveMintByMethod: typeof mockPicks }) => unknown) =>
      selector({ receiveMintByMethod: mockPicks }),
    { getState: () => ({ activeUnit: 'sat' }) }
  ),
}));
jest.mock('wallet/react', () => ({
  useReusableMintQuote: (input: unknown, store: unknown) => mockQuote(input, store),
}));
jest.mock('@/features/receive/lib/standingQuoteIdentityStore', () => ({
  standingQuoteIdentityStore: {},
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { push: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/features/receive/lib/receiveRailItems', () => ({ isExpiryElapsed: () => false }));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: () => null }));
jest.mock('@/shared/hooks/useMempoolAddressSummary', () => ({
  useMempoolAddressSummary: () => ({ summary: null }),
}));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn(), staticPopup: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({ EnhancedHaptics: { copyHaptic: jest.fn() } }));
jest.mock('@/shared/blocks/PaymentInfo', () => ({ PaymentInfo: () => null }));
jest.mock('@/shared/ui/composed/CopyRequestCard', () => ({ CopyRequestCard: () => null }));
jest.mock('@/shared/ui/composed/ActionSegmentsCard', () => ({ ActionSegmentsCard: () => null }));
jest.mock('@/features/receive/components/OnchainDepositLimitsCard', () => ({
  OnchainDepositLimitsCard: () => null,
}));
jest.mock('@/features/receive/components/ReceiveRailPlaceholder', () => ({
  ReceiveRailPlaceholder: () => null,
}));
jest.mock('@/features/transactions', () => ({ HistoryEntryRefresh: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

function capability(method: 'bolt12' | 'onchain', supported: boolean, disabled = false) {
  return { supported, disabled, method, unit: 'sat' };
}

const action = () => ({ available: true, loading: false, execute: jest.fn() });
const actions = {
  back: action(),
  copy: action(),
  share: action(),
  changeNpcMint: action(),
  changeBolt12Mint: action(),
  changeOnchainMint: action(),
};

let selection: ReturnType<typeof useBip321RailSelection> | null = null;
function Probe({ method }: { method: 'bolt12' | 'onchain' }) {
  selection = useBip321RailSelection('sat', useWalletContext());
  return (
    <ReceiveReusableQuoteTab
      method={method}
      unit="sat"
      walletContext={useWalletContext()}
      actions={actions}
      muted="white"
    />
  );
}

function render(method: 'bolt12' | 'onchain' = 'bolt12') {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe method={method} />);
  });
  return renderer;
}

const rail = (id: string) => selection!.selection.rails.find((r) => r.id === id)!;
const has = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAllByProps({ testID }).length > 0;

describe('receive method mint, resolver to rails and tab', () => {
  beforeEach(() => {
    mockPicks = {};
    mockTestnut = false;
    mockQuote.mockClear();
    mockContext = {
      trustedMintUrls: [REAL, OTHER],
      mintBalances: {},
      mintMethodCapabilities: {
        [REAL]: {
          mint: { bolt12: capability('bolt12', false), onchain: capability('onchain', true, true) },
          melt: {},
        },
        [OTHER]: {
          mint: { bolt12: capability('bolt12', true), onchain: capability('onchain', true) },
          melt: {},
        },
      },
    };
  });

  it('backs a rail with the first capable mint when nothing is picked', () => {
    const renderer = render();
    expect(selection!.bolt12Mint).toBe(OTHER);
    expect(selection!.onchainMint).toBe(OTHER);
    expect(rail('bolt12').state).toBe('included');
    expect(rail('onchain').state).toBe('included');
    expect(rail('creq').state).toBe('included');
    expect(mockQuote).toHaveBeenLastCalledWith(
      { mintUrl: OTHER, method: 'bolt12', unit: 'sat' },
      {}
    );
    expect(has(renderer, 'receive-bolt12-pick-mint')).toBe(false);
    act(() => renderer.unmount());
  });

  it('keeps an explicit incapable pick, names why, and asks for a new mint', () => {
    mockPicks = { bolt12: REAL, onchain: REAL };
    const renderer = render();
    expect(selection!.bolt12Mint).toBe(REAL);
    expect(rail('bolt12')).toMatchObject({
      state: 'unavailable',
      reason: 'No trusted mint supports BOLT 12 for sat',
    });
    expect(rail('onchain')).toMatchObject({
      state: 'unavailable',
      reason: 'Onchain is disabled by the selected mint for sat',
    });
    expect(mockQuote).toHaveBeenLastCalledWith(null, {});
    expect(has(renderer, 'receive-bolt12-pick-mint')).toBe(true);
    act(() => renderer.unmount());
  });

  it('sets aside a pick from the other side of the testnut split', () => {
    mockPicks = { onchain: TESTNUT };
    mockContext.trustedMintUrls = [REAL, OTHER, TESTNUT];
    const renderer = render('onchain');
    expect(selection!.onchainMint).toBe(OTHER);
    expect(rail('onchain').state).toBe('included');
    expect(has(renderer, 'receive-onchain-pick-mint')).toBe(false);
    act(() => renderer.unmount());
  });

  it('shows the discovery prompt when no trusted mint can serve the rail', () => {
    mockContext.trustedMintUrls = [];
    const renderer = render();
    expect(rail('bolt12').state).toBe('unavailable');
    expect(rail('creq')).toMatchObject({
      state: 'unavailable',
      reason: 'No trusted mint is available for Cashu requests in sat',
    });
    expect(has(renderer, 'receive-bolt12-find-mints')).toBe(true);
    act(() => renderer.unmount());
  });
});
