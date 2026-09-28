/** @jest-environment node */
import TestRenderer, { act } from 'react-test-renderer';
import { AiHeaderTitle } from '@/features/ai/components/AiHeaderTitle';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

const mockFund = jest.fn();
let mockBalance = 0;
let mockProvider: string | null = 'https://provider.example';
jest.mock('@/features/ai/lib/navigateToAddFunds', () => ({
  useNavigateToAddFunds: () => mockFund,
}));
jest.mock('@/features/ai/hooks/useRoutstrFunds', () => ({
  useRoutstrFunds: () => ({ balanceSats: mockBalance }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ selectedMint: null }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ mockMode: false }),
}));
jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ userNodeBaseUrl: mockProvider, knownProviders: {} }),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ getMockMintBalance: jest.fn() }));
jest.mock('@/shared/lib/routstr/providerHealth', () => ({
  cachedProbe: () => null,
  probeProviders: jest.fn(),
}));
jest.mock('@/features/ai/components/ProviderAvatar', () => ({ ProviderPillIcon: () => null }));
jest.mock(
  '@/shared/ui/composed/BalancePill',
  () => ({
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      jest.requireActual<typeof import('react')>('react').createElement('pill', props),
  }),
  { virtual: true }
);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  jest.clearAllMocks();
  mockBalance = 0;
  mockProvider = 'https://provider.example';
});
test.each([
  [0, 'https://provider.example', 'Add funds', true],
  [100, 'https://provider.example', undefined, false],
  [0, null, 'Pick one', false],
])(
  'balance %s and provider %s route the header action correctly',
  async (balance, provider, label, funding) => {
    mockBalance = balance;
    mockProvider = provider;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<AiHeaderTitle />);
    });
    try {
      const pill = renderer.root.findByType('pill' as never);
      expect(pill.props.ctaLabel).toBe(label);
      expect(pill.props.testID).toBe('ai-funds-button');
      await act(async () => pill.props.onPress());
      expect(mockFund).toHaveBeenCalledTimes(funding ? 1 : 0);
      if (funding) expect(guardedRouter.navigate).not.toHaveBeenCalled();
      else expect(guardedRouter.navigate).toHaveBeenCalledWith('/(ai-flow)/providers');
    } finally {
      await act(async () => renderer.unmount());
    }
  }
);
