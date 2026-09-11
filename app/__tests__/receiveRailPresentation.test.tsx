/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ReceiveReusableQuoteTab } from '@/features/receive/components/ReceiveReusableQuoteTab';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { ReceiveRailListScreen } from '@/features/receive/screens/ReceiveRailListScreen';
import { __resetGuardForTests } from '@/shared/hooks/useGuardedRouter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockPush = jest.fn();
const mockPaymentInfo = jest.fn();
const mockLoadItems = jest.fn();
const mockQuote = jest.fn<unknown, unknown[]>(() => ({
  quote: { request: 'lno-fixture', expiry: 10_000_000_000 },
  error: null,
  rotate: jest.fn(),
}));
let mockSupports = true;
let mockRail = 'bolt12';
const mockManager = {};
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Stack: { Screen: () => null },
}));
jest.mock('wallet/react', () => ({
  useReusableMintQuote: (...args: unknown[]) => mockQuote(...args),
  useColadaManager: () => mockManager,
}));
jest.mock('wallet', () => ({
  getMintMethodCapability: () => ({ supported: true }),
  buildBip321OnchainUri: (value: string) => value,
  standingPaymentRequestKey: (unit: string) => unit,
}));
jest.mock('@/features/receive/hooks/useReceiveMethodMint', () => ({
  useReceiveMethodMint: () => ({ mintUrl: 'https://mint.example', anyMintSupports: mockSupports }),
}));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: () => null }));
jest.mock('@/shared/hooks/useMempoolAddressSummary', () => ({
  useMempoolAddressSummary: () => ({ summary: null }),
}));
jest.mock('@/features/receive/lib/standingQuoteIdentityStore', () => ({
  standingQuoteIdentityStore: {},
}));
jest.mock('@/shared/blocks/PaymentInfo', () => ({
  PaymentInfo: (props: unknown) => {
    mockPaymentInfo(props);
    return null;
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/shared/lib/popup', () => ({
  copyPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/shared/lib/nav/transactionDetailRoutes', () => ({
  navigateToTransactionDetail: jest.fn(),
}));
jest.mock('@/shared/lib/strings', () => ({ truncateMiddle: (value: string) => value }));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: () => '1 sat' }));
jest.mock('@/shared/lib/date', () => ({ formatRelative: () => 'Just now' }));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({
  useRouteParams: () => ({ rail: mockRail, unit: 'sat' }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  // eslint-disable-next-line no-restricted-syntax -- fixture theme colors must parse as hex
  useThemeColor: (tokens: string[]) => tokens.map(() => '#ffffff'),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ standingQuotes: {} }) },
}));
jest.mock('@/features/receive/lib/receiveRailItems', () => ({
  isExpiryElapsed: () => false,
  buildBolt12Items: (...args: unknown[]) => mockLoadItems(...args),
  buildOnchainItems: (...args: unknown[]) => mockLoadItems(...args),
  buildPaymentRequestItems: (...args: unknown[]) => mockLoadItems(...args),
  isRailItemCopyable: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({ EnhancedHaptics: { copyHaptic: jest.fn() } }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: Record<string, unknown>) => <button {...props} />,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Badge', () => ({
  Badge: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Spinner', () => ({
  Spinner: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/composed/GradientCard', () => ({
  GradientCard: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: () => null }));
jest.mock('@/shared/ui/composed/CopyRequestCard', () => ({ CopyRequestCard: () => null }));
jest.mock('@/shared/ui/composed/ActionSegmentsCard', () => ({ ActionSegmentsCard: () => null }));
jest.mock('@/features/transactions', () => ({ HistoryEntryRefresh: () => null }));
jest.mock('@/features/receive/components/ReceiveRailPlaceholder', () => ({
  ReceiveRailPlaceholder: () => null,
}));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement(name, props, children);
  const ListGroup = Object.assign(host('ListGroup'), {
    Item: host('Item'),
    ItemPrefix: host('Prefix'),
    ItemContent: host('Content'),
    ItemSuffix: host('Suffix'),
    ItemTitle: host('Title'),
    ItemDescription: host('Description'),
  });
  return {
    ListGroup,
    Separator: () => null,
    PressableFeedback: Object.assign(host('Pressable'), {
      Scale: host('Scale'),
      Ripple: () => null,
    }),
  };
});

const action = () => ({ available: true, loading: false, execute: jest.fn() });
const actions = {
  back: action(),
  copy: action(),
  share: action(),
  changeNpcMint: action(),
  changeBolt12Mint: action(),
  changeOnchainMint: action(),
};
const props = {
  method: 'bolt12' as const,
  unit: 'sat',
  walletContext: { trustedMintUrls: ['https://mint.example'], mintBalances: {} },
  actions,
  muted: 'white',
};

describe('receive rail presentation', () => {
  beforeEach(() => {
    mockSupports = true;
    mockPaymentInfo.mockClear();
    mockQuote.mockClear();
    mockPush.mockClear();
    __resetGuardForTests();
  });
  it('keeps the standing quote subscribed while its hidden QR is unmounted', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceiveReusableQuoteTab {...props} active={false} />);
    });
    expect(mockQuote).toHaveBeenCalledWith(
      { mintUrl: 'https://mint.example', method: 'bolt12', unit: 'sat' },
      {}
    );
    expect(mockPaymentInfo).not.toHaveBeenCalled();
    act(() => renderer.update(<ReceiveReusableQuoteTab {...props} active />));
    expect(mockPaymentInfo).toHaveBeenCalledTimes(1);
    act(() => renderer.update(<ReceiveReusableQuoteTab {...props} active={false} />));
    expect(mockPaymentInfo).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
  it('opens Discover only once on a rapid double tap', () => {
    mockSupports = false;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceiveReusableQuoteTab {...props} />);
    });
    const button = renderer.root.findByProps({ testID: 'receive-bolt12-find-mints' });
    act(() => {
      button.props.onPress();
      button.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(mint-flow)/add',
      params: { method: 'bolt12', unit: 'sat' },
    });
    act(() => renderer.unmount());
  });
  it.each(['paymentRequest', 'bolt12'])(
    'shows one spinner until the %s list resolves',
    async (rail) => {
      mockRail = rail;
      let resolve!: (items: unknown[]) => void;
      mockLoadItems.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        })
      );
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(<ReceiveRailListScreen />);
      });
      expect(
        renderer.root.findAllByProps({ testID: 'receive-rail-list-loading' }).length
      ).toBeGreaterThan(0);
      expect(renderer.root.findAllByType(Spinner)).toHaveLength(1);
      expect(renderer.root.findAll((node) => (node.type as unknown) === 'Title')).toHaveLength(0);
      await act(async () =>
        resolve([
          {
            key: 'fixture',
            rail,
            request: 'fixture',
            status: 'reusable',
            createdAt: 1,
            copyTarget: 'paymentRequest',
          },
        ])
      );
      expect(renderer.root.findAllByProps({ testID: 'receive-rail-list-loading' })).toHaveLength(0);
      expect(
        renderer.root.findAll((node) => (node.type as unknown) === 'Title')[0].props.numberOfLines
      ).toBe(1);
      expect(
        renderer.root.findAll((node) => (node.type as unknown) === 'Description')[0].props
          .numberOfLines
      ).toBe(1);
      act(() => renderer.unmount());
    }
  );
});
