/**
 * @jest-environment node
 *
 * The width the mint pill is drawn at: the caller's `width` when it passes
 * one, otherwise the wallet-header width for the current window, following a
 * rotation. Read from the dimensions the pill itself resolves
 * (`useBalancePillDimensions`) from what `MintSelector` hands it.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import MintSelector from '@/features/wallet/components/MintSelector/MintSelector';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockWindowWidth = 390;
// The preset compiles `react-native` imports to react-native-web export paths.
jest.mock('react-native-web/dist/exports/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth, height: 844, scale: 3, fontScale: 1 }),
}));
jest.mock(
  '@/shared/ui/composed/BalancePill',
  () => {
    const R = jest.requireActual<typeof import('react')>('react');
    const { useBalancePillDimensions } = jest.requireActual(
      '@/shared/ui/composed/BalancePill/useBalancePillDimensions'
    );
    return {
      __esModule: true,
      default: (props: { width?: number; contentHeight?: number }) =>
        R.createElement('PillProbe', {
          buttonWidth: useBalancePillDimensions(props).buttonWidth,
        }),
    };
  },
  { virtual: true }
);
jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ mints: [], isLoading: false }),
}));
jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: { byMint: {} } }),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (select: (s: { selectedMint: string | undefined }) => unknown) =>
    select({ selectedMint: undefined }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => {
  const state = { mockMode: false, mockNoGlass: false };
  const useSettingsStore = (select: (s: typeof state) => unknown) => select(state);
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ getMockMintBalance: () => 0 }));
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: () => null }));
jest.mock('@/features/mint/hooks/useMintLiveness', () => ({ useMintLiveness: () => 'unknown' }));
jest.mock('@/shared/ui/primitives/PresenceDot', () => ({ PresenceDot: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: () => null }));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
    walletLog: sink,
    storeLog: sink,
    cashuLog: sink,
    log: { ...sink, child: () => sink },
    mintUrlLogFields: () => ({}),
    redactError: (error: unknown) => error,
  };
});

let renderer: TestRenderer.ReactTestRenderer;
const drawnWidth = () => renderer.root.findByType('PillProbe' as never).props.buttonWidth;

afterEach(() => {
  act(() => renderer?.unmount());
  mockWindowWidth = 390;
});

describe('the mint pill width', () => {
  it('without a width, is the header width for the window, and follows a rotation', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<MintSelector />);
    });
    expect(drawnWidth()).toBe(getHeaderTitleWidthFromWidth(390));

    mockWindowWidth = 844;
    await act(async () => {
      renderer.update(<MintSelector />);
    });
    expect(drawnWidth()).toBe(getHeaderTitleWidthFromWidth(844));
  });

  it('with a width, is that width whatever the window', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<MintSelector width={280} />);
    });
    expect(drawnWidth()).toBe(280);

    mockWindowWidth = 844;
    await act(async () => {
      renderer.update(<MintSelector width={280} />);
    });
    expect(drawnWidth()).toBe(280);
  });
});
