/**
 * @jest-environment node
 *
 * Balance split opened for a unit (`?unit=usd`) starts on that unit's tab on
 * its first frame, not on SAT. A trusted mint whose info has not loaded yet is
 * not assumed to be a sat mint: it is left out until its units are known, so
 * the SAT split is never initialised with a mint that may not issue sats.
 */
import TestRenderer, { act } from 'react-test-renderer';

import { MintDistributionScreen } from '@/features/mint/screens/MintDistributionScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockParams: { unit?: string } = {};
let mockMints: { mintUrl: string; mintInfo?: { units: string[] } }[] = [];
const mockTabs: { currencies: string[]; selectedCurrency: string }[] = [];
const mockInitialize = jest.fn();

jest.mock('wallet', () => ({
  ACCOUNT_UNITS: ['sat', 'usd', 'eur', 'tsat'],
  accountUnitLabel: (unit: string) => unit.toUpperCase(),
  deriveSupportedUnitsFromInfo: (info: { units: string[] }) => info.units,
  toAccountUnit: (unit: string) => unit,
}));
jest.mock('@cashu/coco-react', () => ({ useMints: () => ({ trustedMints: mockMints }) }));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({ useRouteParams: () => mockParams }));
jest.mock('@/features/mint/hooks/useStickyCurrencyTabs', () => ({
  useStickyCurrencyTabs: (args: { currencies: string[]; selectedCurrency: string }) => {
    mockTabs.push({ currencies: args.currencies, selectedCurrency: args.selectedCurrency });
    return {
      setTotalHeaderHeight: jest.fn(),
      handleScroll: jest.fn(),
      currencyTabs: null,
      headerSpacer: null,
    };
  },
}));
jest.mock('@/shared/stores/profile/mintDistributionStore', () => {
  const state = {
    distributions: {},
    setMintDistribution: jest.fn(),
    initializeDistribution: (...args: unknown[]) => mockInitialize(...args),
    equalizeMints: jest.fn(),
    minMint: jest.fn(),
    getDistribution: () => ({}),
  };
  const useMintDistributionStore = (selector: (s: typeof state) => unknown) => selector(state);
  useMintDistributionStore.getState = () => state;
  return { EMPTY_DISTRIBUTION: {}, TOTAL_BASIS_POINTS: 10_000, useMintDistributionStore };
});
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
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({ ScreenScrollView: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: () => null }));
jest.mock('@/shared/ui/primitives/Switch', () => ({ Switch: () => null }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: () => null }));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: () => null }));
jest.mock('@/features/mint/components/MintCurrencyTabs', () => ({ MINT_CURRENCY_TABS_HEIGHT: 40 }));
jest.mock('@/features/mint/components/distribution/MintDistributionCards', () => ({
  MintDistributionCards: () => null,
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), debug: jest.fn(), warn: jest.fn() };
  return { log: sink, useLifecycleLogger: jest.fn(), mintUrlLogFields: () => ({}) };
});

let renderer: TestRenderer.ReactTestRenderer;
function render() {
  act(() => {
    renderer = TestRenderer.create(<MintDistributionScreen />);
  });
}

beforeEach(() => {
  mockTabs.length = 0;
  mockInitialize.mockClear();
  mockParams = {};
  mockMints = [];
});
afterEach(() => act(() => renderer?.unmount()));

it('starts on the route unit from the first frame', () => {
  mockParams = { unit: 'usd' };
  mockMints = [{ mintUrl: 'a', mintInfo: { units: ['sat', 'usd'] } }];
  render();
  expect(mockTabs[0].selectedCurrency).toBe('USD');
  expect(mockTabs.every((tabs) => tabs.selectedCurrency === 'USD')).toBe(true);
});

it('treats btc in the route as the SAT tab and no unit as SAT', () => {
  mockParams = { unit: 'btc' };
  mockMints = [{ mintUrl: 'a', mintInfo: { units: ['sat'] } }];
  render();
  expect(mockTabs[0].selectedCurrency).toBe('SAT');
  act(() => renderer.unmount());

  mockTabs.length = 0;
  mockParams = {};
  render();
  expect(mockTabs[0].selectedCurrency).toBe('SAT');
});

it('does not count a mint whose info has not loaded as a sat mint', () => {
  mockMints = [{ mintUrl: 'loaded', mintInfo: { units: ['sat'] } }, { mintUrl: 'unloaded' }];
  render();
  // Membership is pending until every mint's units are known: nothing is
  // initialised (or pruned) yet, and the unloaded mint is never assumed sat.
  expect(mockInitialize).not.toHaveBeenCalled();
});

it('initialises once every trusted mint has loaded its info', () => {
  mockMints = [
    { mintUrl: 'loaded', mintInfo: { units: ['sat'] } },
    { mintUrl: 'usd-only', mintInfo: { units: ['usd'] } },
  ];
  render();
  expect(mockInitialize).toHaveBeenCalledWith('SAT', ['loaded']);
});
