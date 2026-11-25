/**
 * @jest-environment node
 *
 * Saved balance-split weights survive a trusted mint whose info is still
 * loading. While any trusted mint's units are unknown, the screen must not
 * initialise (and so prune) the saved split: a 70/30 split across A and B
 * stays 70/30 once B's info arrives, never 100/0.
 */
import TestRenderer, { act } from 'react-test-renderer';

import { MintDistributionScreen } from '@/features/mint/screens/MintDistributionScreen';
import { useMintDistributionStore } from '@/shared/stores/profile/mintDistributionStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockMints: { mintUrl: string; mintInfo?: { units: string[] } }[] = [];

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('wallet', () => ({
  ACCOUNT_UNITS: ['sat', 'usd', 'eur', 'tsat'],
  accountUnitLabel: (unit: string) => unit.toUpperCase(),
  deriveSupportedUnitsFromInfo: (info: { units: string[] }) => info.units,
  toAccountUnit: (unit: string) => unit,
}));
jest.mock('@cashu/coco-react', () => ({ useMints: () => ({ trustedMints: mockMints }) }));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({ useRouteParams: () => ({}) }));
jest.mock('@/features/mint/hooks/useStickyCurrencyTabs', () => ({
  useStickyCurrencyTabs: () => ({
    setTotalHeaderHeight: jest.fn(),
    handleScroll: jest.fn(),
    currencyTabs: null,
    headerSpacer: null,
  }),
}));
jest.mock('@/features/mint/hooks/useMintManagement', () => ({
  useMintManagement: () => ({ getMintInfo: jest.fn(async () => null) }),
}));
jest.mock('@/features/wallet/hooks/useMintKeysetUnits', () => ({ useMintKeysetUnits: () => ({}) }));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => () => false,
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => ['black'] }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/navigation/headerItems', () => ({ withGlassHeaderItems: (o: object) => o }));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({
  ScreenScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
let capturedSwitchProps: { isDisabled?: boolean; onSelectedChange?: (next: boolean) => void } = {};
jest.mock('@/shared/ui/primitives/Switch', () => ({
  Switch: (props: { isDisabled?: boolean; onSelectedChange?: (next: boolean) => void }) => {
    capturedSwitchProps = props;
    return null;
  },
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: () => null }));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: () => null }));
jest.mock('@/features/mint/components/MintCurrencyTabs', () => ({ MINT_CURRENCY_TABS_HEIGHT: 40 }));
jest.mock('@/features/mint/components/distribution/MintDistributionCards', () => ({
  MintDistributionCards: () => null,
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    log: sink,
    storeLog: sink,
    useLifecycleLogger: jest.fn(),
    mintUrlLogFields: () => ({}),
    redactError: (error: unknown) => error,
  };
});

const A = 'https://a.example';
const B = 'https://b.example';

let renderer: TestRenderer.ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('keeps saved weights while a trusted mint is still loading its info', () => {
  useMintDistributionStore.setState({ distributions: { sat: { [A]: 7000, [B]: 3000 } } });

  mockMints = [{ mintUrl: A, mintInfo: { units: ['sat'] } }, { mintUrl: B }];
  act(() => {
    renderer = TestRenderer.create(<MintDistributionScreen />);
  });
  expect(useMintDistributionStore.getState().distributions.sat).toEqual({ [A]: 7000, [B]: 3000 });

  mockMints = [
    { mintUrl: A, mintInfo: { units: ['sat'] } },
    { mintUrl: B, mintInfo: { units: ['sat'] } },
  ];
  act(() => {
    renderer!.update(<MintDistributionScreen />);
  });
  expect(useMintDistributionStore.getState().distributions.sat).toEqual({ [A]: 7000, [B]: 3000 });
});

it('blocks Split evenly from pruning saved weights while a trusted mint is still loading', () => {
  useMintDistributionStore.setState({ distributions: { sat: { [A]: 7000, [B]: 3000 } } });
  capturedSwitchProps = {};

  mockMints = [{ mintUrl: A, mintInfo: { units: ['sat'] } }, { mintUrl: B }];
  act(() => {
    renderer = TestRenderer.create(<MintDistributionScreen />);
  });
  expect(capturedSwitchProps.isDisabled).toBe(true);
  act(() => {
    capturedSwitchProps.onSelectedChange?.(true);
  });
  expect(useMintDistributionStore.getState().distributions.sat).toEqual({ [A]: 7000, [B]: 3000 });

  mockMints = [
    { mintUrl: A, mintInfo: { units: ['sat'] } },
    { mintUrl: B, mintInfo: { units: ['sat'] } },
  ];
  act(() => {
    renderer!.update(<MintDistributionScreen />);
  });
  expect(capturedSwitchProps.isDisabled).toBe(false);
  expect(useMintDistributionStore.getState().distributions.sat).toEqual({ [A]: 7000, [B]: 3000 });
});
